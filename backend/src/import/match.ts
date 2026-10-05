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

export interface ScheduleLike {
  type: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  amountCents: number;
  amountKind: 'FIXED' | 'ESTIMATE';
}

export interface TransactionLike {
  type: string;
  accountId: string;
  toAccountId: string | null;
  amountCents: number;
  categoryIds: string[];
}

/**
 * Whether a schedule "explains" a past transaction that isn't linked to it —
 * typically history entered or imported before the schedule existed. Same
 * account(s), same kind of transaction, the schedule's category (when it has
 * one) and its amount (fixed exactly, estimates within ±20%). Used so the
 * forecast doesn't count a recurring bill twice.
 */
export function scheduleExplains(s: ScheduleLike, t: TransactionLike): boolean {
  const sameType =
    s.type === t.type ||
    // Transfers into loans are stored as debt repayments, and into Fire Extinguisher accounts as savings contributions.
    (s.type === 'TRANSFER' && (t.type === 'DEBT_REPAYMENT' || t.type === 'SAVINGS_CONTRIBUTION')) ||
    (t.type === 'TRANSFER' && (s.type === 'DEBT_REPAYMENT' || s.type === 'SAVINGS_CONTRIBUTION'));
  if (!sameType || s.accountId !== t.accountId) return false;
  if ((s.toAccountId ?? null) !== (t.toAccountId ?? null)) return false;
  if (s.categoryId && (s.type === 'EXPENSE' || s.type === 'INCOME') && !t.categoryIds.includes(s.categoryId)) return false;
  return amountsMatch(s.amountCents, t.amountCents, s.amountKind);
}
