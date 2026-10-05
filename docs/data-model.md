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
