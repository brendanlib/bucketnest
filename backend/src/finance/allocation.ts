import { Dec, type Cents, MoneyError, assertCents } from './money.js';
import type { Decimal } from 'decimal.js';

export interface BucketShare {
  id: string;
  /** Percentage as a decimal string or number, e.g. "60.00". */
  percentage: Decimal.Value;
  sortOrder: number;
}

export interface BucketAllocation {
  id: string;
  amountCents: Cents;
}

export class AllocationError extends MoneyError {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}

/** Percentages must each be 0–100 with at most 2 dp, and total exactly 100.00. */
export function validateBucketPercentages(percentages: Decimal.Value[]): void {
  let total = new Dec(0);
  for (const p of percentages) {
    const d = new Dec(p);
    if (!d.isFinite() || d.isNegative() || d.greaterThan(100)) {
      throw new AllocationError('Each bucket percentage must be between 0 and 100');
    }
    if (d.decimalPlaces() > 2) throw new AllocationError('Bucket percentages allow at most 2 decimal places');
    total = total.plus(d);
  }
  if (!total.equals(100)) {
    throw new AllocationError(`Bucket percentages must total 100.00% (currently ${total.toFixed(2)}%)`);
  }
}

/**
 * Splits income across buckets with the largest-remainder method (spec §3.3):
 * each bucket gets the floor of its exact share, then leftover cents go one at a
 * time to the largest fractional remainders, ties to the lower sort order.
 * Allocations always sum exactly to the income.
 */
export function calculateBucketAllocation(incomeCents: Cents, buckets: BucketShare[]): BucketAllocation[] {
  assertCents(incomeCents, 'income');
  if (incomeCents < 0) throw new AllocationError('Income to allocate cannot be negative');
  validateBucketPercentages(buckets.map((b) => b.percentage));

  const shares = buckets.map((b) => {
    const exact = new Dec(incomeCents).times(b.percentage).dividedBy(100);
    const floor = exact.floor();
    return { id: b.id, sortOrder: b.sortOrder, floor: floor.toNumber(), remainder: exact.minus(floor) };
  });

  let leftover = incomeCents - shares.reduce((sum, s) => sum + s.floor, 0);
  const order = [...shares].sort((a, b) => b.remainder.comparedTo(a.remainder) || a.sortOrder - b.sortOrder);
  const extra = new Map<string, number>();
  for (const s of order) {
    if (leftover <= 0) break;
    extra.set(s.id, 1);
    leftover -= 1;
  }

  return shares.map((s) => ({ id: s.id, amountCents: s.floor + (extra.get(s.id) ?? 0) }));
}
