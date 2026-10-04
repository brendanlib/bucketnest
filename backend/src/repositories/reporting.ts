import type { TransactionType } from '@prisma/client';
import type { DbTx } from '../db.js';
import { centsFromBigInt } from '../finance/money.js';

export interface SpendingRow {
  categoryId: string;
  transactionType: TransactionType;
  isSinkingFundPayment: boolean;
  scheduled: boolean;
  amountCents: number;
}

/**
 * Split totals in a date range, grouped by category, transaction type, the
 * sinking-fund flag and whether the transaction came from a schedule. Only
 * accounts included in the budget count. Sums only leave the database.
 */
export async function spendingRows(db: DbTx, householdId: string, from: Date, to: Date): Promise<SpendingRow[]> {
  const rows = await db.$queryRaw<
    { category_id: string; type: TransactionType; is_sinking_fund_payment: boolean; scheduled: boolean; total: bigint }[]
  >`
    SELECT s.category_id, t.type, s.is_sinking_fund_payment, (t.recurring_id IS NOT NULL) AS scheduled, SUM(s.amount_cents)::bigint AS total
    FROM transaction_splits s
    JOIN transactions t ON t.id = s.transaction_id
    JOIN accounts a ON a.id = t.account_id
    WHERE s.household_id = ${householdId}::uuid
      AND t.household_id = ${householdId}::uuid
      AND t.date >= ${from}::date AND t.date <= ${to}::date
      AND a.include_in_budget
    GROUP BY 1, 2, 3, 4`;
  return rows.map((r) => ({
    categoryId: r.category_id,
    transactionType: r.type,
    isSinkingFundPayment: r.is_sinking_fund_payment,
    scheduled: r.scheduled,
    amountCents: centsFromBigInt(r.total),
  }));
}

/** Debt repayments into, and interest charged on, Debt-repayment liabilities in a range. */
export async function debtMovements(db: DbTx, householdId: string, from: Date, to: Date) {
  const rows = await db.$queryRaw<{ repaid: bigint | null; interest: bigint | null }[]>`
    SELECT
      SUM(CASE WHEN t.type = 'DEBT_REPAYMENT' AND t.to_account_id = l.id THEN t.amount_cents END)::bigint AS repaid,
      SUM(CASE WHEN t.type = 'INTEREST_CHARGE' AND t.account_id = l.id THEN t.amount_cents END)::bigint AS interest
    FROM transactions t
    JOIN accounts l ON l.id = COALESCE(CASE WHEN t.type = 'DEBT_REPAYMENT' THEN t.to_account_id END, t.account_id)
    WHERE t.household_id = ${householdId}::uuid
      AND t.date >= ${from}::date AND t.date <= ${to}::date
      AND t.type IN ('DEBT_REPAYMENT', 'INTEREST_CHARGE')
      AND l.class = 'LIABILITY' AND l.repayment_treatment = 'DEBT_REPAYMENT'`;
  return { repaidCents: centsFromBigInt(rows[0]?.repaid ?? 0n), interestCents: centsFromBigInt(rows[0]?.interest ?? 0n) };
}
