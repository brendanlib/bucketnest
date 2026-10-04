import { type Cents } from './money.js';
import type { TransactionType } from './balance.js';

export interface SplitForSpending {
  categoryId: string;
  amountCents: Cents;
  transactionType: TransactionType;
  isSinkingFundPayment?: boolean;
}

/**
 * Category actuals (spec §3.4). Expense splits add, refund splits subtract.
 * Debt-repayment and savings-contribution splits add too: they carry the
 * minimum (Bills) and Fire Extinguisher parts. Income, transfers and balance
 * adjustments never count. Sinking-fund payments are excluded by default
 * because the fund's contributions are the budgeted actual (spec §9).
 */
export function calculateCategorySpending(
  splits: Iterable<SplitForSpending>,
  options: { includeSinkingFundPayments?: boolean } = {},
): Map<string, Cents> {
  const totals = new Map<string, Cents>();
  for (const s of splits) {
    if (s.isSinkingFundPayment && !options.includeSinkingFundPayments) continue;
    let signed: Cents;
    switch (s.transactionType) {
      case 'EXPENSE':
      case 'DEBT_REPAYMENT':
      case 'SAVINGS_CONTRIBUTION':
        signed = s.amountCents;
        break;
      case 'REFUND':
        signed = -s.amountCents;
        break;
      default:
        continue;
    }
    totals.set(s.categoryId, (totals.get(s.categoryId) ?? 0) + signed);
  }
  return totals;
}

/** Income is only Income-type transactions; transfers in are never income. */
export function calculateIncomeTotal(splits: Iterable<SplitForSpending>): Cents {
  let total = 0;
  for (const s of splits) if (s.transactionType === 'INCOME') total += s.amountCents;
  return total;
}

/** Rolls category actuals up to buckets. Categories without a bucket are skipped. */
export function calculateBucketActuals(
  categorySpending: Map<string, Cents>,
  bucketOfCategory: (categoryId: string) => string | null | undefined,
): Map<string, Cents> {
  const totals = new Map<string, Cents>();
  for (const [categoryId, amount] of categorySpending) {
    const bucket = bucketOfCategory(categoryId);
    if (!bucket) continue;
    totals.set(bucket, (totals.get(bucket) ?? 0) + amount);
  }
  return totals;
}
