/**
 * Categorisation rules (spec §13): plain, case-insensitive text matching — never
 * user-supplied regex — plus optional amount range, account and direction.
 * Rules run in priority order and the first match wins.
 */
export interface RuleSpec {
  id: string;
  priority: number;
  isActive: boolean;
  matchField: 'DESCRIPTION' | 'PAYEE';
  matchType: 'CONTAINS' | 'STARTS_WITH' | 'EQUALS';
  matchValue: string;
  minAmountCents?: number | null;
  maxAmountCents?: number | null;
  direction?: 'ANY' | 'DEBIT' | 'CREDIT';
  accountId?: string | null;
}

export interface RuleSubject {
  description: string;
  payee?: string | null;
  amountCents: number;
  direction: 'debit' | 'credit';
  accountId: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function ruleMatches(rule: RuleSpec, t: RuleSubject): boolean {
  if (!rule.isActive) return false;
  const value = norm(rule.matchValue);
  if (!value) return false;
  const text = norm(rule.matchField === 'PAYEE' ? (t.payee ?? '') : t.description);
  const textOk =
    rule.matchType === 'EQUALS' ? text === value : rule.matchType === 'STARTS_WITH' ? text.startsWith(value) : text.includes(value);
  if (!textOk) return false;
  if (rule.accountId && rule.accountId !== t.accountId) return false;
  if (rule.direction === 'DEBIT' && t.direction !== 'debit') return false;
  if (rule.direction === 'CREDIT' && t.direction !== 'credit') return false;
  if (rule.minAmountCents !== null && rule.minAmountCents !== undefined && t.amountCents < rule.minAmountCents) return false;
  if (rule.maxAmountCents !== null && rule.maxAmountCents !== undefined && t.amountCents > rule.maxAmountCents) return false;
  return true;
}

/** The first matching active rule by priority (then id for stability), or null. */
export function firstMatchingRule<R extends RuleSpec>(rules: R[], t: RuleSubject): R | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
  return ordered.find((r) => ruleMatches(r, t)) ?? null;
}
