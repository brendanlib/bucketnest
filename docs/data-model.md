# Data model and financial rules

The schema is in `backend/prisma/schema.prisma`. This note records the rules behind it, including decisions made where the spec left room.

## Ownership

Every data table has a non-null, indexed `household_id`. Repositories in `backend/src/repositories` take a `householdId` as their first argument and include it in every query, so another household's record behaves exactly like one that doesn't exist (404). Database triggers also refuse a transaction or split that points at another household's account or category.

Users, sessions and reset tokens are identity records rather than household data. They belong to a user, and users reach households through `household_members`.

## Money

- **Amounts** are integer cents (`BIGINT`) and travel through the API as `amountCents`.
- **Interest rates** are `NUMERIC(7,4)` annual percentages.
- **Bucket percentages** are `NUMERIC(5,2)` and must total exactly 100.00.
- **Maths** lives in `backend/src/finance` as pure functions, using decimal.js where fractions appear. Rounding is half away from zero, and only at the end.

## Balances

An account's balance is its opening balance plus the effect of its transactions. For liabilities, the balance is the **amount owed**, as a positive number. Money moving into an account raises an asset and lowers a liability:

| Type | On `account_id` | On `to_account_id` |
| --- | --- | --- |
| Income, Refund | in | — |
| Expense, Interest charge | out | — |
| Transfer, Debt repayment, Savings contribution | out | in |
| Balance adjustment | `direction`: INCREASE or DECREASE of the displayed balance | — |

Amounts are always positive. Only the type and the accounts decide direction. Balance adjustments carry a `direction`, because positive amounts alone can't say which way they go.

## What counts (spec §3.4–3.5)

Splits attribute money to categories, and buckets follow from categories.

| Splits on a … | Count toward the category as |
| --- | --- |
| Expense | + spending |
| Refund | − spending |
| Debt repayment | + minimum part (a Bills category), + extra part (*Extra debt repayments*, Fire Extinguisher) |
| Savings contribution | + one Fire Extinguisher category (default *Savings contributions*) |
| Income | income, never spending |

Transfers and balance adjustments never have splits. Splits either don't exist or sum exactly to the transaction amount. A deferred constraint trigger enforces this at commit.

### Type normalisation

So the money counts the same way however it was entered, the API stores some transactions as a more specific type:

- A **transfer into a liability with Debt repayment treatment** (a mortgage or loan) becomes a **debt repayment** and is split automatically.
- A **transfer from a non-Fire Extinguisher account into a Fire Extinguisher-tagged account** becomes a **savings contribution**.
- An **interest charge on a Transfer-treatment liability** (a credit card) becomes an **expense** in *Interest and fees*. On loans, interest charges only raise the balance and are never spending.

The API returns the stored type, and the UI tells the user when it changed.

### Debt repayment split

Each repayment is split on its own: up to the debt profile's minimum goes to the Bills category, and the rest is extra. With no debt profile (Phase 3 adds them), the whole repayment is the minimum. The Bills category is the debt profile's category, or else *Mortgage*, *Loan repayments*, *Credit card repayments* or *Other mandatory repayments*, depending on the account type.

## System categories

Categories with a `system_key` (Mortgage, Interest and fees, Loan repayments, Credit card repayments, Other mandatory repayments, the four Fire Extinguisher categories, Salary and wages, Other income) are what the rules above rely on. You can rename and move them, but not delete or disable them.

## Uncategorised

Expenses, refunds and income with no splits are "uncategorised". The API requires a category for manual entry. Imports (Phase 5) may create uncategorised rows, and they are flagged and counted.

## Constraints Prisma can't express

These live in SQL in the first migration:

- category names unique per group (`NULLS NOT DISTINCT`)
- lower-case emails
- positive amounts and the 1900–2100 date range
- to-account and direction required exactly when the type needs them
- the split-sum trigger and the household-match triggers

When generating a future migration with `prisma migrate diff`, check the output doesn't drop the `categories_household_parent_name_key` index, which Prisma doesn't know about.

## Budget periods (spec §3.8, §9)

| Period | Boundaries |
| --- | --- |
| Weekly, fortnightly | Repeat every 7 or 14 days from the anchor date. For fortnightly, the anchor is a payday. |
| Monthly | Start on the anchor's day of the month, clamped at month end (an anchor of the 31st starts on the 28th or 29th in February). |
| Annual | Start on the anchor's day and month each year. |

- "Today" is the date in the household time zone.
- Each budget item stores the amount and frequency as entered, and is converted to the period with the §3.2 factors, rounding once.
- The plan carries into every period automatically. A new period starts with the previous plan because the plan isn't tied to any one period.
- The active budget's period and anchor mirror the household's budget settings, whichever side changes.
- Every household always has exactly one active budget. One is created on first use if none exists.

### What's planned and what's actual

- **Planned income:** the household's active income schedules normalised to the period. With no income schedules, the budget's income lines are used instead.
- **Actual income:** income transactions dated in the period.
- **Allocation basis:** planned income by default, or income received. Allocations use the largest-remainder method (§3.3).
- **Actuals:** follow the split rules above. Only accounts with *Include in budget* count, and sinking-fund payments are excluded from variance.
- **% used and status:**
  - % used is actual ÷ budget × 100, or "—" when the budget is 0.
  - The line turns amber at the amber threshold.
  - It turns red only *above* the red threshold, so exactly 100% used is still amber.
  - Spending with no budget is flagged unbudgeted.
- **Over-allocated:** a bucket is over-allocated when its planned lines exceed its allocation.

## Recurring schedules (spec §3.7, §8)

- **Occurrence engine:** `generateOccurrences` in `backend/src/finance/recurrence.ts` is pure. Monthly-style frequencies keep the start day and clamp at month end, so a schedule on the 31st never drifts to the 28th.
- **Weekend rule:** moves Saturday or Sunday dates to the Friday before or the Monday after. Public holidays are out of scope.
- **Occurrence identity:** an occurrence is identified by its **nominal** date, the date the pattern gives before any weekend move or edit. Exceptions and posted transactions use that date, and `transactions (recurring_id, occurrence_date)` is unique.
- **Exceptions:** *skip* hides an occurrence. *Edit* changes its amount and/or date. Both apply after generation.
- **Editing from a date onward:** the schedule ends the day before that date and a new schedule carries on with the changes. A schedule with a fixed count keeps its total, and occurrences already posted from that date move to the new schedule.
- **Auto-post:**
  - A job checks every 15 minutes and posts occurrences once 02:00 household time has passed on their date.
  - It only posts occurrences dated on or after the day the schedule was created, so it never back-fills history you may have entered yourself.
  - The job holds a PostgreSQL advisory lock, and the unique key makes reruns harmless.
- **Deleting an auto-posted transaction:** this records a *skip*, so the job doesn't post the occurrence again.
- **Where schedules are managed:** the Bills page lists Bills-bucket schedules (expenses in Bills categories, plus debt repayments). Income, transfers and every other schedule are managed on the **Recurring** page. The spec's navigation had no page for them, so Recurring was added under Money.

## CSV import (spec §13)

- **Stateless parsing:** `POST /api/import/parse` reads the file, applies the mapping (given, saved for the account, or guessed) and classifies every row. Nothing is stored. `POST /api/import/commit` sends the same file and mapping back with the user's decisions. The server parses again and applies everything in one database transaction, so nothing the browser computed is trusted.
- **Fingerprints:** hash of account, date, signed amount, normalised description and an index for identical rows on the same day.
- **Import links:** each imported bank row is recorded in `import_links` as (transaction, account, fingerprint, batch), unique per account.
  - A transfer between two of your accounts can be linked twice, once from each account's statement. That's why links live in their own table rather than in a single `transactions.fingerprint` column. The `transactions.fingerprint` column is still filled in for transactions an import creates.
  - Duplicates are rows whose fingerprint already has a link for that account.
- **Row classification**, in priority order:
  1. errors, and duplicates (skipped);
  2. a scheduled occurrence on that account within ±3 days, same direction, fixed amount exact or estimate within ±20% (*match*: recorded as that occurrence, using the bank's date and amount);
  3. an existing transaction on that account within ±3 days with the same amount and no link from this account yet (*merge*: the bank row is linked to it, and the existing entry is never changed);
  4. otherwise a new transaction, typed and categorised by the first matching rule. With no rule, money out is an expense; money in is income on asset accounts and a refund on cards and loans.

  Each row and each candidate is paired at most once, closest date first.
- **Merges with auto-posts:** an auto-posted occurrence that later appears in an import is offered as a merge, so it's counted once.
- **Undo:** deletes the transactions the batch created (including any edits made to them since) and its remaining links, which are its merges. Pre-existing entries are never deleted. The batch is kept, marked undone.
- **Limits:** 5 MB and 20,000 rows per file.

## Sinking funds (spec §9)

- **Target and due date:**
  - A fund linked to a recurring bill uses that bill's next unpaid, unskipped occurrence. After the bill is paid, the next occurrence takes over, so the fund rolls forward by itself.
  - An unlinked fund uses its own target and due date. If it repeats, the due date moves forward a year at a time once it has passed.
- **Current amount:** the linked account's balance; or, with no account, "already saved" plus contributions minus payments made from the fund.
- **Contributions:** each is a row in `sinking_fund_contributions`.
  - Moving money into the fund's account records a transfer and links it.
  - Deleting that transfer also removes the contribution.
- **Recommended contribution:** what is left to save ÷ the contribution dates (on the fund's own pattern from its anchor date) from today until the day before it is due, rounded up to the cent.
- **Statuses:** *funded*, *due soon* (within 30 days, not funded), *due — short by $X* (due date reached, not funded), otherwise *on track*.
- **In the budget:**
  - A fund with a category gets its own budget line in that category's group. The budget is the recommended contribution converted to the budget period; the actual is the contributions made in that period.
  - The recommended contribution is today's figure, even when you look at a past period.
- **Paying the bill:** a split with `sinking_fund_id` set counts as a payment from the fund. It is excluded from period variance but still appears in the category's history.

## Goals (spec §10)

- **Current amount:** the linked account's balance, or a figure entered by hand.
- **Contributions:** counted on the goal's frequency from the day it was created.
- **Required contribution:** what is left ÷ the contribution dates up to and including the target date, rounded up.
- **Projected date:** the date of the contribution that reaches the target at the current amount.
- **Behind:** a goal is behind when its projected date is after its target date.
- **Priority:** sets the display order and which goal gets spare Fire Extinguisher money first.

## Debts (spec §10)

- **Profile:** a debt profile sits on a liability account. The balance is always the account's balance.
- **Repayment dates:** monthly, quarterly and annual debts with a due day repay on that day (clamped at month end). Other frequencies follow a repayment date.
- **Interest:** per period = (balance − linked offset balances, floored at 0) × annual rate × days in period ÷ 365, rounded to the cent each period.
  - Repayments that don't exceed the first period's interest return *not paid off at this repayment*.
  - Simulations stop at 600 periods.
- **HECS/HELP:** indexed once a year on 1 June instead of charging interest.
- **This period:** principal reduced = repayments into the account − interest charged on it, from actual transactions in the current budget period.
- **Payoff plan:**
  - The plan simulates monthly. Every debt is paid its minimum, converted to a monthly amount.
  - On top of that, the debts' extras (or an amount you choose) go to the debts in strategy order: snowball takes the smallest starting balance first, avalanche the highest rate. That order is fixed at the start.
  - A cleared debt's repayment joins the pool.

## Reports (spec §12)

- **What counts as spending:** category actuals net of refunds, including bills paid from sinking funds (reports are history, not period variance). Fire Extinguisher money is shown by bucket but counted as saving, not spending.
- **Savings rate:** (income − spending) ÷ income, where spending excludes Fire Extinguisher saving.
- **Account filter:** filtering by account uses that account's own transactions and ignores *Include in budget*.
- **CSV exports:**
  - Money is written as plain decimals (`1234.56`).
  - Text a spreadsheet would read as a formula is prefixed with `'`.
  - Plain numbers, including negative ones, are left as numbers.

## Forecast

- **History:** completed months only, from the household's first transaction and at most 12 months back. The current partial month is never used.
- **Per category:** scheduled occurrences in each future month + the average of the category's *unscheduled* spending over the method's window (3, 6 or 12 months). The window can be set for the household or overridden per category, and a category can use a manual monthly amount instead.
  - With fewer completed months than the window, the average uses what there is and is flagged *limited history*.
- **What counts as scheduled:** a past transaction is treated as scheduled if it is linked to a schedule, **or** an active schedule explains it.
  - "Explains" means the same account(s), the same kind of transaction (a transfer into a loan matches a debt repayment), the schedule's category, and its amount (fixed exactly, estimates within ±20%).
  - This matters for real data: history imported or entered before a schedule existed would otherwise be counted twice, once in the average and once as the scheduled occurrence.
- **Debt and savings schedules:** debt-repayment schedules are forecast in the debt's Bills category, at the full repayment amount. Card repayments (Transfer treatment) are not spending. Savings-contribution schedules go to their Fire Extinguisher category.
- **Income:** scheduled income + the average of unscheduled income.
- **Account month-end balances:** today's balance, plus scheduled movements from today on (anything already recorded is skipped), plus the account's average unscheduled monthly change.

## Net worth

- **At any date:** included asset-account balances + the latest valuation on or before that date of each included asset − included liability balances. Accounts count from their opening date.
- **History:** month ends, recomputed from transactions and valuations. Editing the past updates the history.
- **Snapshots:** a job stores one per household for the 1st of each month. It is idempotent, and a missed run loses nothing because history can always be recomputed.
- **Valuations:** one per asset per day; a second valuation on the same day replaces the first. To record a sale, add a $0 valuation on the sale date, which keeps the history.

## Calendar

Each schedule's occurrences (posted ones link to their transaction), sinking fund due dates and goal target dates, up to 100 days per request.

## Colours

- **Bucket colours:** Bills `#2A78D6`, Smile `#4A3AA7`, Splurge `#1BAF7A`, Fire Extinguisher `#EB6834`. This set passed the palette validator on all pairs in light mode: CVD ΔE ≥ 9.2 and normal-vision ΔE ≥ 16.3.
- **Dark mode:** uses `#256ABF`, `#9085E9`, `#1BAF7A`, `#D95926`, which also pass on all pairs.
- **Contrast relief:** aqua is under 3:1 on white, so every chart that uses it carries labels, a legend or a table view.
- **Migration:** an earlier default set put Smile and Splurge 3.8 ΔE apart under deuteranopia. Households still on those defaults were migrated to the new set.
