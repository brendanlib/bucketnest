import { Prisma, type TransactionType } from '@prisma/client';
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

export interface MonthlyRow extends SpendingRow {
  /** 'YYYY-MM' */
  month: string;
}

export interface ReportFilters {
  accountId?: string;
  bucketId?: string;
  categoryId?: string;
}

/** Split totals per month and category in a range, with optional account, bucket and category filters. */
export async function monthlySpendingRows(db: DbTx, householdId: string, from: Date, to: Date, f: ReportFilters = {}): Promise<MonthlyRow[]> {
  const account = f.accountId ? Prisma.sql`AND t.account_id = ${f.accountId}::uuid` : Prisma.empty;
  const bucket = f.bucketId ? Prisma.sql`AND c.bucket_id = ${f.bucketId}::uuid` : Prisma.empty;
  const category = f.categoryId ? Prisma.sql`AND s.category_id = ${f.categoryId}::uuid` : Prisma.empty;
  const budgetOnly = f.accountId ? Prisma.empty : Prisma.sql`AND a.include_in_budget`;
  const rows = await db.$queryRaw<{ month: string; category_id: string; type: TransactionType; is_sinking_fund_payment: boolean; scheduled: boolean; total: bigint }[]>`
    SELECT to_char(t.date, 'YYYY-MM') AS month, s.category_id, t.type, s.is_sinking_fund_payment, (t.recurring_id IS NOT NULL) AS scheduled,
           SUM(s.amount_cents)::bigint AS total
    FROM transaction_splits s
    JOIN transactions t ON t.id = s.transaction_id
    JOIN accounts a ON a.id = t.account_id
    JOIN categories c ON c.id = s.category_id
    WHERE s.household_id = ${householdId}::uuid AND t.household_id = ${householdId}::uuid
      AND t.date >= ${from}::date AND t.date <= ${to}::date
      ${budgetOnly} ${account} ${bucket} ${category}
    GROUP BY 1, 2, 3, 4, 5`;
  return rows.map((r) => ({
    month: r.month,
    categoryId: r.category_id,
    transactionType: r.type,
    isSinkingFundPayment: r.is_sinking_fund_payment,
    scheduled: r.scheduled,
    amountCents: centsFromBigInt(r.total),
  }));
}

export async function earliestTransactionDate(db: DbTx, householdId: string): Promise<Date | null> {
  const r = await db.transaction.aggregate({ where: { householdId }, _min: { date: true } });
  return r._min.date;
}

/** Transactions with their splits in a range, for transaction-level analysis (the forecast). */
export async function historyTransactions(db: DbTx, householdId: string, from: Date, to: Date) {
  const rows = await db.transaction.findMany({
    where: { householdId, date: { gte: from, lte: to } },
    select: {
      date: true,
      type: true,
      direction: true,
      amountCents: true,
      accountId: true,
      toAccountId: true,
      recurringId: true,
      account: { select: { includeInBudget: true } },
      splits: { select: { categoryId: true, amountCents: true, isSinkingFundPayment: true } },
    },
  });
  return rows.map((t) => ({
    month: t.date.toISOString().slice(0, 7),
    type: t.type,
    direction: t.direction,
    amountCents: centsFromBigInt(t.amountCents),
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    linked: t.recurringId !== null,
    inBudget: t.account.includeInBudget,
    splits: t.splits.map((s) => ({ categoryId: s.categoryId, amountCents: centsFromBigInt(s.amountCents), isSinkingFundPayment: s.isSinkingFundPayment })),
  }));
}
