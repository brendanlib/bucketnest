import type { CategorisationRule, TransactionType } from '@prisma/client';
import type { Deps } from './context.js';
import type { TransactionInput, TransactionService } from './transaction.service.js';
import { findAccountsByIds } from '../repositories/accounts.js';
import { findCategoriesByIds } from '../repositories/categories.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { cents, centsOrNull, dateOut } from '../lib/serialize.js';
import { firstMatchingRule, ruleMatches, type RuleSpec } from '../import/rules.js';
import { balanceEffect } from '../finance/balance.js';

export interface RuleInput {
  name?: string | null;
  matchField: 'DESCRIPTION' | 'PAYEE';
  matchType: 'CONTAINS' | 'STARTS_WITH' | 'EQUALS';
  matchValue: string;
  minAmountCents?: number | null;
  maxAmountCents?: number | null;
  direction?: 'ANY' | 'DEBIT' | 'CREDIT';
  accountId?: string | null;
  setCategoryId?: string | null;
  setType?: 'EXPENSE' | 'INCOME' | 'REFUND' | 'TRANSFER' | null;
  setToAccountId?: string | null;
  setPayee?: string | null;
  addNote?: string | null;
  isActive?: boolean;
}

/** What a rule (or the defaults) says an imported or existing row should become. */
export interface Suggestion {
  type: TransactionType;
  categoryId: string | null;
  toAccountId: string | null;
  /** For transfers into this account, the other account the money came from. */
  fromAccountId: string | null;
  payee: string | null;
  notes: string | null;
  ruleId: string | null;
  ruleName: string | null;
}

export const toSpec = (r: CategorisationRule): RuleSpec => ({
  id: r.id,
  priority: r.priority,
  isActive: r.isActive,
  matchField: r.matchField,
  matchType: r.matchType,
  matchValue: r.matchValue,
  minAmountCents: centsOrNull(r.minAmountCents),
  maxAmountCents: centsOrNull(r.maxAmountCents),
  direction: r.direction,
  accountId: r.accountId,
});

export function serializeRule(r: CategorisationRule & { setCategory?: { name: string } | null; setToAccount?: { name: string } | null; account?: { name: string } | null }) {
  return {
    id: r.id,
    name: r.name,
    priority: r.priority,
    matchField: r.matchField,
    matchType: r.matchType,
    matchValue: r.matchValue,
    minAmountCents: centsOrNull(r.minAmountCents),
    maxAmountCents: centsOrNull(r.maxAmountCents),
    direction: r.direction,
    accountId: r.accountId,
    accountName: r.account?.name ?? null,
    setCategoryId: r.setCategoryId,
    setCategoryName: r.setCategory?.name ?? null,
    setType: r.setType,
    setToAccountId: r.setToAccountId,
    setToAccountName: r.setToAccount?.name ?? null,
    setPayee: r.setPayee,
    addNote: r.addNote,
    isActive: r.isActive,
  };
}

const include = { setCategory: { select: { name: true } }, setToAccount: { select: { name: true } }, account: { select: { name: true } } };

export function createRuleService(deps: Deps, transactions: TransactionService) {
  const { db } = deps;

  async function loadOrThrow(householdId: string, id: string) {
    const r = await db.categorisationRule.findFirst({ where: { householdId, id }, include });
    if (!r) throw notFound('Rule');
    return r;
  }

  async function validate(householdId: string, input: RuleInput) {
    if (!input.matchValue.trim()) throw validationError('Enter the text to match', { field: 'matchValue' });
    if (input.minAmountCents != null && input.maxAmountCents != null && input.minAmountCents > input.maxAmountCents) {
      throw validationError('The minimum is above the maximum', { field: 'minAmountCents' });
    }
    if (!input.setCategoryId && !input.setType && !input.setPayee && !input.addNote) {
      throw validationError('Choose at least one thing for the rule to do', { field: 'setCategoryId' });
    }
    const accountIds = [input.accountId, input.setToAccountId].filter((x): x is string => Boolean(x));
    const accounts = await findAccountsByIds(db, householdId, accountIds);
    if (input.accountId && !accounts.some((a) => a.id === input.accountId)) throw validationError('Unknown account', { field: 'accountId' });
    if (input.setType === 'TRANSFER') {
      if (!input.setToAccountId) throw validationError('Choose the other account for the transfer', { field: 'setToAccountId' });
      if (!accounts.some((a) => a.id === input.setToAccountId)) throw validationError('Unknown account', { field: 'setToAccountId' });
      if (input.setCategoryId) throw validationError('Transfers do not take a category', { field: 'setCategoryId' });
    }
    if (input.setCategoryId) {
      const [c] = await findCategoriesByIds(db, householdId, [input.setCategoryId]);
      if (!c || c.isGroup) throw validationError('Unknown category', { field: 'setCategoryId' });
      if (!c.isActive) throw validationError(`${c.name} is disabled`, { field: 'setCategoryId' });
      if (input.setType === 'INCOME' && c.kind !== 'INCOME') throw validationError(`${c.name} is not an income category`, { field: 'setCategoryId' });
      if ((input.setType === 'EXPENSE' || input.setType === 'REFUND') && c.kind !== 'EXPENSE') {
        throw validationError(`${c.name} is an income category`, { field: 'setCategoryId' });
      }
    }
  }

  const toData = (input: RuleInput) => ({
    name: input.name?.trim() || null,
    matchField: input.matchField,
    matchType: input.matchType,
    matchValue: input.matchValue.trim(),
    minAmountCents: input.minAmountCents == null ? null : BigInt(input.minAmountCents),
    maxAmountCents: input.maxAmountCents == null ? null : BigInt(input.maxAmountCents),
    direction: input.direction ?? 'ANY',
    accountId: input.accountId ?? null,
    setCategoryId: input.setCategoryId ?? null,
    setType: input.setType ?? null,
    setToAccountId: input.setType === 'TRANSFER' ? (input.setToAccountId ?? null) : null,
    setPayee: input.setPayee?.trim() || null,
    addNote: input.addNote?.trim() || null,
    isActive: input.isActive ?? true,
  });

  /** Recent transactions as rule subjects, from the point of view of their own account. */
  async function recentSubjects(householdId: string, limit = 1000) {
    const rows = await db.transaction.findMany({
      where: { householdId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { account: { select: { class: true } }, splits: { select: { id: true } } },
    });
    return rows.map((t) => {
      const effect = balanceEffect({ type: t.type, direction: t.direction, amountCents: cents(t.amountCents), role: 'from' }, t.account.class);
      const credit = t.account.class === 'ASSET' ? effect > 0 : effect < 0;
      return {
        t,
        subject: { description: t.description, payee: t.payee, amountCents: cents(t.amountCents), direction: credit ? ('credit' as const) : ('debit' as const), accountId: t.accountId },
      };
    });
  }

  return {
    async list(householdId: string) {
      const rows = await db.categorisationRule.findMany({ where: { householdId }, include, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
      return rows.map(serializeRule);
    },

    async activeSpecs(householdId: string) {
      return db.categorisationRule.findMany({ where: { householdId, isActive: true }, include: { setCategory: true } });
    },

    async create(householdId: string, input: RuleInput) {
      await validate(householdId, input);
      const max = await db.categorisationRule.aggregate({ where: { householdId }, _max: { priority: true } });
      const r = await db.categorisationRule.create({ data: { householdId, priority: (max._max.priority ?? 0) + 10, ...toData(input) }, include });
      return serializeRule(r);
    },

    async update(householdId: string, id: string, input: RuleInput) {
      await loadOrThrow(householdId, id);
      await validate(householdId, input);
      await db.categorisationRule.updateMany({ where: { householdId, id }, data: toData(input) });
      return serializeRule(await loadOrThrow(householdId, id));
    },

    async remove(householdId: string, id: string) {
      await loadOrThrow(householdId, id);
      await db.categorisationRule.deleteMany({ where: { householdId, id } });
    },

    /** Sets the order: the first id runs first. Every rule must be listed. */
    async reorder(householdId: string, ids: string[]) {
      const existing = await db.categorisationRule.findMany({ where: { householdId }, select: { id: true } });
      const known = new Set(existing.map((r) => r.id));
      if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
        throw validationError('Send every rule exactly once', { field: 'ids' });
      }
      await db.$transaction(ids.map((id, i) => db.categorisationRule.updateMany({ where: { householdId, id }, data: { priority: (i + 1) * 10 } })));
      return this.list(householdId);
    },

    /** Previews which recent transactions a rule (saved or draft) would match. */
    async test(householdId: string, input: RuleInput) {
      const spec: RuleSpec = { id: 'draft', priority: 0, ...toData(input), isActive: true, minAmountCents: input.minAmountCents ?? null, maxAmountCents: input.maxAmountCents ?? null };
      const subjects = await recentSubjects(householdId);
      const matches = subjects.filter((s) => ruleMatches(spec, s.subject));
      return {
        scanned: subjects.length,
        matchCount: matches.length,
        uncategorisedCount: matches.filter((m) => ['EXPENSE', 'INCOME', 'REFUND'].includes(m.t.type) && m.t.splits.length === 0).length,
        items: matches.slice(0, 50).map(({ t }) => ({
          id: t.id,
          date: dateOut(t.date),
          description: t.description,
          payee: t.payee,
          amountCents: cents(t.amountCents),
          type: t.type,
          uncategorised: ['EXPENSE', 'INCOME', 'REFUND'].includes(t.type) && t.splits.length === 0,
        })),
      };
    },

    /**
     * Applies one rule to existing uncategorised transactions (expenses, refunds
     * and income with no category). Others are left alone.
     */
    async apply(householdId: string, id: string) {
      const rule = await loadOrThrow(householdId, id);
      if (!rule.isActive) throw conflict('RULE_DISABLED', 'Enable the rule before applying it');
      const spec = toSpec(rule);
      const candidates = await db.transaction.findMany({
        where: { householdId, type: { in: ['EXPENSE', 'INCOME', 'REFUND'] }, splits: { none: {} } },
        include: { account: { select: { class: true } } },
        take: 5000,
      });
      const category = rule.setCategoryId ? (await findCategoriesByIds(db, householdId, [rule.setCategoryId]))[0] : null;
      let updated = 0;
      let skipped = 0;
      for (const t of candidates) {
        const effect = balanceEffect({ type: t.type, direction: t.direction, amountCents: cents(t.amountCents), role: 'from' }, t.account.class);
        const direction = (t.account.class === 'ASSET' ? effect > 0 : effect < 0) ? 'credit' : 'debit';
        const subject = { description: t.description, payee: t.payee, amountCents: cents(t.amountCents), direction: direction as 'credit' | 'debit', accountId: t.accountId };
        if (!ruleMatches(spec, subject)) continue;
        const s = suggestFromRule(rule, category?.kind ?? null, subject, t.account.class);
        const input = suggestionToInput(s, { date: dateOut(t.date), description: t.description, amountCents: cents(t.amountCents), accountId: t.accountId, payee: t.payee, notes: t.notes, cleared: t.cleared });
        try {
          await transactions.update(householdId, t.id, input, { allowUncategorised: true });
          updated++;
        } catch {
          skipped++;
        }
      }
      return { updated, skipped };
    },
  };
}

export type RuleService = ReturnType<typeof createRuleService>;

/** Default treatment of a bank row with no rule: money out is an expense, money in is income (assets) or a refund (cards and loans). */
export function defaultSuggestion(direction: 'debit' | 'credit', accountClass: 'ASSET' | 'LIABILITY'): Suggestion {
  return {
    type: direction === 'debit' ? 'EXPENSE' : accountClass === 'ASSET' ? 'INCOME' : 'REFUND',
    categoryId: null,
    toAccountId: null,
    fromAccountId: null,
    payee: null,
    notes: null,
    ruleId: null,
    ruleName: null,
  };
}

/**
 * What a matching rule turns a row into. With a category but no type, the type
 * follows the category and direction: income category → Income; expense
 * category → Expense for money out, Refund for money in.
 */
export function suggestFromRule(
  rule: Pick<CategorisationRule, 'id' | 'name' | 'matchValue' | 'setCategoryId' | 'setType' | 'setToAccountId' | 'setPayee' | 'addNote'>,
  categoryKind: 'INCOME' | 'EXPENSE' | null,
  subject: { direction: 'debit' | 'credit' },
  accountClass: 'ASSET' | 'LIABILITY' = 'ASSET',
): Suggestion {
  const base = defaultSuggestion(subject.direction, accountClass);
  let type: TransactionType = base.type;
  if (rule.setType === 'TRANSFER') type = 'TRANSFER';
  else if (rule.setType) type = rule.setType;
  else if (categoryKind === 'INCOME') type = 'INCOME';
  else if (categoryKind === 'EXPENSE') type = subject.direction === 'debit' ? 'EXPENSE' : 'REFUND';
  const transfer = type === 'TRANSFER';
  return {
    type,
    categoryId: transfer ? null : rule.setCategoryId,
    toAccountId: transfer && subject.direction === 'debit' ? rule.setToAccountId : null,
    fromAccountId: transfer && subject.direction === 'credit' ? rule.setToAccountId : null,
    payee: rule.setPayee,
    notes: rule.addNote,
    ruleId: rule.id,
    ruleName: rule.name ?? rule.matchValue,
  };
}

/** Builds a transaction from a bank row and its suggestion. Transfers in are recorded from the other account. */
export function suggestionToInput(
  s: Pick<Suggestion, 'type' | 'categoryId' | 'toAccountId' | 'fromAccountId' | 'payee' | 'notes'>,
  row: { date: string; description: string; amountCents: number; accountId: string; payee?: string | null; notes?: string | null; cleared?: boolean },
): TransactionInput {
  const transferIn = s.type === 'TRANSFER' && s.fromAccountId;
  return {
    date: row.date,
    description: row.description,
    payee: s.payee ?? row.payee ?? null,
    amountCents: row.amountCents,
    type: s.type,
    accountId: transferIn ? s.fromAccountId! : row.accountId,
    toAccountId: s.type === 'TRANSFER' ? (transferIn ? row.accountId : s.toAccountId) : null,
    splits: s.categoryId && s.type !== 'TRANSFER' ? [{ categoryId: s.categoryId, amountCents: row.amountCents }] : [],
    notes: [row.notes, s.notes].filter(Boolean).join(' · ') || null,
    cleared: row.cleared ?? true,
  };
}

export { firstMatchingRule };
