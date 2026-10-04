import { type Cents, assertCents } from './money.js';

/**
 * Splits a debt repayment (spec §3.5): the part up to the minimum is a Bills
 * cost, anything above it is a Fire Extinguisher extra repayment.
 * With no known minimum the whole repayment is treated as the minimum.
 */
export function splitDebtRepayment(
  amountCents: Cents,
  minimumCents: Cents | null | undefined,
): { minimumCents: Cents; extraCents: Cents } {
  assertCents(amountCents);
  if (amountCents <= 0) throw new RangeError('Repayment must be greater than 0');
  if (minimumCents === null || minimumCents === undefined) return { minimumCents: amountCents, extraCents: 0 };
  assertCents(minimumCents, 'minimum repayment');
  const minimumPart = Math.min(amountCents, Math.max(0, minimumCents));
  return { minimumCents: minimumPart, extraCents: amountCents - minimumPart };
}
