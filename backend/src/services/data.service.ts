import type { Deps } from './context.js';
import type { AccountService } from './account.service.js';
import { forbidden, validationError } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { centsToDecimal, toCsv, type CsvColumn } from '../lib/csv.js';
import { dateOut, dateOutOrNull } from '../lib/serialize.js';

export const EXPORT_ENTITIES = ['transactions', 'accounts', 'categories', 'budget', 'recurring', 'sinking-funds', 'goals', 'debts', 'assets', 'rules'] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

const n = (v: bigint | null | undefined) => (v === null || v === undefined ? null : Number(v));
const money = (v: bigint | number | null | undefined) => (v === null || v === undefined ? null : centsToDecimal(Number(v)));

/**
 * Full household export (spec §14) — a portable copy, not a backup. Money is in
 * cents in JSON and decimal in CSV. Password hashes, sessions and tokens are never exported.
 */
export function createDataService(deps: Deps, accounts: AccountService) {
  const { db } = deps;

  async function load(householdId: string) {
    const [household, members, buckets, categories, accountRows, transactions, budgets, recurring, funds, goals, debts, assets, rules, profiles, notificationSettings] = await Promise.all([
      db.household.findUniqueOrThrow({ where: { id: householdId } }),
      db.householdMember.findMany({ where: { householdId }, include: { user: { select: { name: true, email: true } } } }),
      db.bucket.findMany({ where: { householdId }, orderBy: { sortOrder: 'asc' } }),
      db.category.findMany({ where: { householdId }, orderBy: [{ sortOrder: 'asc' }] }),
      db.account.findMany({ where: { householdId }, orderBy: { createdAt: 'asc' } }),
      db.transaction.findMany({ where: { householdId }, include: { splits: true }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      db.budget.findMany({ where: { householdId }, include: { items: true } }),
      db.recurringTransaction.findMany({ where: { householdId }, include: { exceptions: true } }),
      db.sinkingFund.findMany({ where: { householdId }, include: { contributions: true } }),
      db.financialGoal.findMany({ where: { householdId } }),
      db.debt.findMany({ where: { householdId } }),
      db.asset.findMany({ where: { householdId }, include: { valuations: true } }),
      db.categorisationRule.findMany({ where: { householdId }, orderBy: { priority: 'asc' } }),
      db.importProfile.findMany({ where: { householdId } }),
      db.notificationSetting.findMany({ where: { householdId } }),
    ]);
    const balances = await accounts.balancesFor(householdId, accountRows);
    return { household, members, buckets, categories, accountRows, transactions, budgets, recurring, funds, goals, debts, assets, rules, profiles, notificationSettings, balances };
  }

  return {
    async exportJson(householdId: string) {
      const d = await load(householdId);
      const cat = new Map(d.categories.map((c) => [c.id, c.name]));
      return {
        format: 'home-budget-export',
        version: 1,
        exportedAt: deps.now().toISOString(),
        note: 'Money amounts are integer cents. Dates are YYYY-MM-DD.',
        household: {
          name: d.household.name,
          currency: d.household.currency,
          locale: d.household.locale,
          timezone: d.household.timezone,
          fyStartMonth: d.household.fyStartMonth,
          weekStartDay: d.household.weekStartDay,
          budgetPeriodType: d.household.budgetPeriodType,
          budgetAnchorDate: dateOut(d.household.budgetAnchorDate),
          allocationBasis: d.household.allocationBasis,
          amberThreshold: d.household.amberThreshold.toString(),
          redThreshold: d.household.redThreshold.toString(),
          forecastMethod: d.household.forecastMethod,
          debtPayoffStrategy: d.household.debtPayoffStrategy,
        },
        members: d.members.map((m) => ({ name: m.user.name, email: m.user.email, role: m.role })),
        buckets: d.buckets.map((b) => ({ id: b.id, key: b.key, name: b.name, percentage: b.percentage.toString(), colour: b.colour })),
        categories: d.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, bucketId: c.bucketId, parentId: c.parentId, isGroup: c.isGroup, isActive: c.isActive, systemKey: c.systemKey })),
        accounts: d.accountRows.map((a) => ({
          id: a.id, name: a.name, type: a.type, class: a.class, institution: a.institution, last4: a.last4,
          openingBalanceCents: n(a.openingBalanceCents), openingDate: dateOut(a.openingDate), balanceCents: d.balances.get(a.id) ?? 0,
          bucketTagId: a.bucketTagId, includeInBudget: a.includeInBudget, includeInNetWorth: a.includeInNetWorth,
          repaymentTreatment: a.repaymentTreatment, offsetForAccountId: a.offsetForAccountId, isClosed: a.isClosed, notes: a.notes,
        })),
        transactions: d.transactions.map((t) => ({
          id: t.id, date: dateOut(t.date), description: t.description, payee: t.payee, amountCents: n(t.amountCents), type: t.type, direction: t.direction,
          accountId: t.accountId, toAccountId: t.toAccountId, recurringId: t.recurringId, occurrenceDate: dateOutOrNull(t.occurrenceDate),
          goalId: t.goalId, cleared: t.cleared, notes: t.notes, gstCents: n(t.gstCents),
          splits: t.splits.map((s) => ({ categoryId: s.categoryId, category: cat.get(s.categoryId), amountCents: n(s.amountCents), isExtraRepayment: s.isExtraRepayment, sinkingFundId: s.sinkingFundId })),
        })),
        budgets: d.budgets.map((b) => ({
          id: b.id, name: b.name, periodType: b.periodType, anchorDate: dateOut(b.anchorDate), isActive: b.isActive,
          items: b.items.map((i) => ({ categoryId: i.categoryId, category: cat.get(i.categoryId), amountCents: n(i.amountCents), enteredFrequency: i.enteredFrequency, frequencyInterval: i.frequencyInterval, notes: i.notes })),
        })),
        recurring: d.recurring.map((r) => ({
          id: r.id, name: r.name, type: r.type, amountCents: n(r.amountCents), amountKind: r.amountKind, frequency: r.frequency, interval: r.interval,
          startDate: dateOut(r.startDate), endDate: dateOutOrNull(r.endDate), occurrenceCount: r.occurrenceCount, weekendRule: r.weekendRule, autoPost: r.autoPost,
          accountId: r.accountId, toAccountId: r.toAccountId, categoryId: r.categoryId, isActive: r.isActive, notes: r.notes,
          exceptions: r.exceptions.map((e) => ({ occurrenceDate: dateOut(e.occurrenceDate), action: e.action, overrideAmountCents: n(e.overrideAmountCents), overrideDate: dateOutOrNull(e.overrideDate) })),
        })),
        sinkingFunds: d.funds.map((f) => ({
          id: f.id, name: f.name, targetCents: n(f.targetCents), dueDate: dateOut(f.dueDate), contributionFrequency: f.contributionFrequency, contributionInterval: f.contributionInterval,
          contributionAnchorDate: dateOut(f.contributionAnchorDate), accountId: f.accountId, categoryId: f.categoryId, recurringId: f.recurringId, repeats: f.repeats,
          manualCurrentCents: n(f.manualCurrentCents), isActive: f.isActive,
          contributions: f.contributions.map((c) => ({ date: dateOut(c.date), amountCents: n(c.amountCents), transactionId: c.transactionId })),
        })),
        goals: d.goals.map((g) => ({
          id: g.id, name: g.name, type: g.type, targetCents: n(g.targetCents), targetDate: dateOutOrNull(g.targetDate), priority: g.priority, accountId: g.accountId,
          manualCurrentCents: n(g.manualCurrentCents), contributionCents: n(g.contributionCents), contributionFrequency: g.contributionFrequency, isActive: g.isActive,
        })),
        debts: d.debts.map((x) => ({
          id: x.id, accountId: x.accountId, originalBalanceCents: n(x.originalBalanceCents), annualRate: x.annualRate.toString(), minRepaymentCents: n(x.minRepaymentCents),
          repaymentFrequency: x.repaymentFrequency, extraRepaymentCents: n(x.extraRepaymentCents), dueDay: x.dueDay, indexationOnly: x.indexationOnly, includeInPayoff: x.includeInPayoff,
        })),
        assets: d.assets.map((a) => ({ id: a.id, name: a.name, type: a.type, includeInNetWorth: a.includeInNetWorth, valuations: a.valuations.map((v) => ({ date: dateOut(v.date), valueCents: n(v.valueCents) })) })),
        rules: d.rules.map((r) => ({
          name: r.name, priority: r.priority, matchField: r.matchField, matchType: r.matchType, matchValue: r.matchValue, minAmountCents: n(r.minAmountCents), maxAmountCents: n(r.maxAmountCents),
          direction: r.direction, accountId: r.accountId, setCategoryId: r.setCategoryId, setType: r.setType, setToAccountId: r.setToAccountId, setPayee: r.setPayee, addNote: r.addNote, isActive: r.isActive,
        })),
        importProfiles: d.profiles.map((p) => ({ accountId: p.accountId, delimiter: p.delimiter, hasHeader: p.hasHeader, dateFormat: p.dateFormat, signConvention: p.signConvention, dateColumn: p.dateColumn, descriptionColumn: p.descriptionColumn, amountColumn: p.amountColumn, debitColumn: p.debitColumn, creditColumn: p.creditColumn, balanceColumn: p.balanceColumn, payeeColumn: p.payeeColumn })),
        notificationSettings: d.notificationSettings.map((s) => ({ type: s.type, enabled: s.enabled, daysBefore: s.daysBefore, emailEnabled: s.emailEnabled })),
      };
    },

    /** One CSV per kind of record. Transactions have one row per category split. */
    async exportCsv(householdId: string, entity: ExportEntity): Promise<string> {
      const d = await load(householdId);
      const cat = new Map(d.categories.map((c) => [c.id, c]));
      const acct = new Map(d.accountRows.map((a) => [a.id, a.name]));
      const bucket = new Map(d.buckets.map((b) => [b.id, b.name]));
      const csv = <T,>(rows: T[], cols: CsvColumn<T>[]) => toCsv(rows, cols);
      switch (entity) {
        case 'transactions': {
          type Split = (typeof d.transactions)[number]['splits'][number];
          const rows: { t: (typeof d.transactions)[number]; s: Split | null }[] = d.transactions.flatMap((t) =>
            t.splits.length ? t.splits.map((s) => ({ t, s: s as Split | null })) : [{ t, s: null }],
          );
          return csv(rows, [
            { label: 'Date', value: (r) => dateOut(r.t.date) },
            { label: 'Description', value: (r) => r.t.description },
            { label: 'Payee', value: (r) => r.t.payee },
            { label: 'Type', value: (r) => r.t.type },
            { label: 'Account', value: (r) => acct.get(r.t.accountId) },
            { label: 'To account', value: (r) => (r.t.toAccountId ? acct.get(r.t.toAccountId) : null) },
            { label: 'Transaction amount', value: (r) => money(r.t.amountCents) },
            { label: 'Category', value: (r) => (r.s ? cat.get(r.s.categoryId)?.name : null) },
            { label: 'Bucket', value: (r) => (r.s ? bucket.get(cat.get(r.s.categoryId)?.bucketId ?? '') : null) },
            { label: 'Split amount', value: (r) => (r.s ? money(r.s.amountCents) : null) },
            { label: 'Cleared', value: (r) => (r.t.cleared ? 'yes' : 'no') },
            { label: 'Notes', value: (r) => r.t.notes },
          ]);
        }
        case 'accounts':
          return csv(d.accountRows, [
            { label: 'Name', value: (a) => a.name },
            { label: 'Type', value: (a) => a.type },
            { label: 'Institution', value: (a) => a.institution },
            { label: 'Opening balance', value: (a) => money(a.openingBalanceCents) },
            { label: 'Opening date', value: (a) => dateOut(a.openingDate) },
            { label: 'Balance', value: (a) => money(d.balances.get(a.id) ?? 0) },
            { label: 'Closed', value: (a) => (a.isClosed ? 'yes' : 'no') },
          ]);
        case 'categories':
          return csv(d.categories.filter((c) => !c.isGroup), [
            { label: 'Category', value: (c) => c.name },
            { label: 'Group', value: (c) => (c.parentId ? cat.get(c.parentId)?.name : null) },
            { label: 'Bucket', value: (c) => (c.bucketId ? bucket.get(c.bucketId) : 'Income') },
            { label: 'Active', value: (c) => (c.isActive ? 'yes' : 'no') },
          ]);
        case 'budget':
          return csv(
            d.budgets.flatMap((b) => b.items.map((i) => ({ b, i }))),
            [
              { label: 'Budget', value: (r) => r.b.name },
              { label: 'Category', value: (r) => cat.get(r.i.categoryId)?.name },
              { label: 'Amount', value: (r) => money(r.i.amountCents) },
              { label: 'Per', value: (r) => r.i.enteredFrequency },
              { label: 'Notes', value: (r) => r.i.notes },
            ],
          );
        case 'recurring':
          return csv(d.recurring, [
            { label: 'Name', value: (r) => r.name },
            { label: 'Type', value: (r) => r.type },
            { label: 'Amount', value: (r) => money(r.amountCents) },
            { label: 'Frequency', value: (r) => r.frequency },
            { label: 'Start', value: (r) => dateOut(r.startDate) },
            { label: 'End', value: (r) => dateOutOrNull(r.endDate) },
            { label: 'Account', value: (r) => acct.get(r.accountId) },
            { label: 'Category', value: (r) => (r.categoryId ? cat.get(r.categoryId)?.name : null) },
          ]);
        case 'sinking-funds':
          return csv(d.funds, [
            { label: 'Name', value: (f) => f.name },
            { label: 'Target', value: (f) => money(f.targetCents) },
            { label: 'Due', value: (f) => dateOut(f.dueDate) },
            { label: 'Contributed', value: (f) => money(f.contributions.reduce((s, c) => s + Number(c.amountCents), 0)) },
            { label: 'Account', value: (f) => (f.accountId ? acct.get(f.accountId) : null) },
          ]);
        case 'goals':
          return csv(d.goals, [
            { label: 'Name', value: (g) => g.name },
            { label: 'Type', value: (g) => g.type },
            { label: 'Target', value: (g) => money(g.targetCents) },
            { label: 'Target date', value: (g) => dateOutOrNull(g.targetDate) },
            { label: 'Account', value: (g) => (g.accountId ? acct.get(g.accountId) : null) },
          ]);
        case 'debts':
          return csv(d.debts, [
            { label: 'Account', value: (x) => acct.get(x.accountId) },
            { label: 'Balance', value: (x) => money(d.balances.get(x.accountId) ?? 0) },
            { label: 'Annual rate %', value: (x) => x.annualRate.toString() },
            { label: 'Minimum repayment', value: (x) => money(x.minRepaymentCents) },
            { label: 'Frequency', value: (x) => x.repaymentFrequency },
            { label: 'Extra repayment', value: (x) => money(x.extraRepaymentCents) },
          ]);
        case 'assets':
          return csv(
            d.assets.flatMap((a) => a.valuations.map((v) => ({ a, v }))),
            [
              { label: 'Asset', value: (r) => r.a.name },
              { label: 'Type', value: (r) => r.a.type },
              { label: 'Date', value: (r) => dateOut(r.v.date) },
              { label: 'Value', value: (r) => money(r.v.valueCents) },
            ],
          );
        case 'rules':
          return csv(d.rules, [
            { label: 'Order', value: (r) => r.priority },
            { label: 'Field', value: (r) => r.matchField },
            { label: 'Match', value: (r) => r.matchType },
            { label: 'Text', value: (r) => r.matchValue },
            { label: 'Category', value: (r) => (r.setCategoryId ? cat.get(r.setCategoryId)?.name : null) },
            { label: 'Type', value: (r) => r.setType },
            { label: 'Active', value: (r) => (r.isActive ? 'yes' : 'no') },
          ]);
      }
    },

    /**
     * Deletes the household and all its data (owner only). Members who belong to no
     * other household lose their login too. Confirmed by typing the household name
     * and the owner's password.
     */
    async deleteHousehold(householdId: string, userId: string, role: 'OWNER' | 'MEMBER', input: { confirmName: string; password: string }) {
      if (role !== 'OWNER') throw forbidden('NOT_OWNER', 'Only the household owner can delete it');
      const household = await db.household.findUniqueOrThrow({ where: { id: householdId } });
      if (input.confirmName.trim() !== household.name) throw validationError('Type the household name exactly to confirm', { field: 'confirmName' });
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (!(await verifyPassword(user.passwordHash, input.password))) throw validationError('Password is incorrect', { field: 'password' });
      const members = await db.householdMember.findMany({ where: { householdId }, select: { userId: true } });
      await db.$transaction(async (tx) => {
        await tx.household.delete({ where: { id: householdId } });
        for (const m of members) {
          const others = await tx.householdMember.count({ where: { userId: m.userId } });
          if (others === 0) await tx.user.delete({ where: { id: m.userId } });
        }
      });
      deps.log.info({ householdId, userId }, 'household deleted');
    },
  };
}

export type DataService = ReturnType<typeof createDataService>;
