import { diffDays } from '../finance/dates.js';

export const MATCH_WINDOW_DAYS = 3;
export const ESTIMATE_TOLERANCE = 0.2;

export interface Candidate {
  date: string;
  amountCents: number;
  direction: 'debit' | 'credit';
}

/** Within ±3 days, same direction; fixed amounts exact, estimates within ±20% (spec §8). */
export function amountsMatch(expected: number, actual: number, kind: 'FIXED' | 'ESTIMATE'): boolean {
  if (kind === 'FIXED') return expected === actual;
  // |actual − expected| ≤ 20% of expected, in integer arithmetic.
  return Math.abs(actual - expected) * 5 <= expected;
}

export function withinWindow(a: string, b: string): boolean {
  return Math.abs(diffDays(a, b)) <= MATCH_WINDOW_DAYS;
}

/**
 * Pairs each row with at most one candidate, closest date first, never using a
 * candidate twice. Returns row index → candidate index.
 */
export function pairClosest<R extends Candidate, C extends Candidate>(
  rows: (R | null)[],
  candidates: C[],
  fits: (row: R, candidate: C) => boolean,
): Map<number, number> {
  const pairs: { r: number; c: number; distance: number }[] = [];
  rows.forEach((row, r) => {
    if (!row) return;
    candidates.forEach((cand, c) => {
      if (row.direction === cand.direction && withinWindow(row.date, cand.date) && fits(row, cand)) {
        pairs.push({ r, c, distance: Math.abs(diffDays(row.date, cand.date)) });
      }
    });
  });
  pairs.sort((a, b) => a.distance - b.distance || a.r - b.r || a.c - b.c);
  const usedRows = new Set<number>();
  const usedCands = new Set<number>();
  const result = new Map<number, number>();
  for (const p of pairs) {
    if (usedRows.has(p.r) || usedCands.has(p.c)) continue;
    usedRows.add(p.r);
    usedCands.add(p.c);
    result.set(p.r, p.c);
  }
  return result;
}
