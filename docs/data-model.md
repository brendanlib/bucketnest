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
