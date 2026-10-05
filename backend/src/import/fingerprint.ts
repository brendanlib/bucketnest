import { createHash } from 'node:crypto';
import { normaliseDescription } from './parse.js';

export interface FingerprintInput {
  date: string;
  amountCents: number;
  direction: 'debit' | 'credit';
  description: string;
}

/**
 * Fingerprint = hash of account, date, signed amount, normalised description and
 * an index for identical rows on the same day (spec §13), so two genuine $4.50
 * coffees on one day stay distinct while re-importing a file matches exactly.
 */
export function fingerprintRows<T extends FingerprintInput>(accountId: string, rows: T[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = `${r.date}|${r.direction === 'debit' ? -r.amountCents : r.amountCents}|${normaliseDescription(r.description)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return createHash('sha256').update(`${accountId}|${key}|${n}`).digest('hex');
  });
}
