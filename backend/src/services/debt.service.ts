import type { Frequency } from '@prisma/client';
import type { Deps } from './context.js';
import type { TransactionService } from './transaction.service.js';
import type { BudgetService } from './budget.service.js';
import { findAccount } from '../repositories/accounts.js';
import { findCategoriesByIds } from '../repositories/categories.js';
import { listBuckets } from '../repositories/buckets.js';
import { getHousehold } from '../repositories/households.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { cents, dateIn, dateOutOrNull } from '../lib/serialize.js';
import { calculateDebtProgress, compareExtraRepayment, simulateDebtPayoff, simulatePayoffPlan, type DebtInput, type PlanDebt } from '../finance/debt.js';
import { convertFrequency } from '../finance/frequency.js';
import { dateInTimeZone, daysInMonth, formatDateOnly, parseDateOnly, type DateOnly } from '../finance/dates.js';

export interface DebtProfileInput {
  accountId: string;
  originalBalanceCents?: number | null;
  annualRate: string | number;
  minRepaymentCents: number;
  repaymentFrequency: Frequency;
  repaymentInterval?: number | null;
  extraRepaymentCents?: number;
  dueDay?: number | null;
  startDate?: string | null;
  categoryId?: string | null;
  indexationOnly?: boolean;
  includeInPayoff?: boolean;
}

const MONTHLY_LIKE: Frequency[] = ['MONTHLY', 'QUARTERLY', 'SIX_MONTHLY', 'ANNUALLY', 'EVERY_N_MONTHS'];

export function createDebtService(deps: Deps, services: { transactions: TransactionService; budgets: BudgetService }) {
  const { db } = deps;

  async function context(householdId: string) {
    const h = await getHousehold(db, householdId);
    return { today: dateInTimeZone(deps.now(), h.timezone), strategy: h.debtPayoffStrategy };
  }

  const loadAll = (householdId: string) =>
    db.debt.findMany({
      where: { householdId },
      include: { account: { include: { offsets: { where: { isClosed: false }, select: { id: true, name: true } } } }, category: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  type DebtRow = Awaited<ReturnType<typeof loadAll>>[number];

  /** The repayment pattern: monthly-style debts use the due day this month; others the start date. */
  function anchorFor(d: DebtRow, today: DateOnly): DateOnly {
    if (d.dueDay && MONTHLY_LIKE.includes(d.repaymentFrequency)) {
      const t = parseDateOnly(today);
      return formatDateOnly(t.year, t.month, Math.min(d.dueDay, daysInMonth(t.year, t.month)));
    }
    return dateOutOrNull(d.startDate) ?? today;
  }

  async function inputFor(householdId: string, d: DebtRow, today: DateOnly, repaymentCents?: number): Promise<DebtInput & { offsetCents: number }> {
    const balance = (await services.transactions.balanceOf(householdId, d.accountId, today)) ?? 0;
    let offset = 0;
    for (const o of d.account.offsets) offset += Math.max(0, (await services.transactions.balanceOf(householdId, o.id, today)) ?? 0);
    return {
      balanceCents: Math.max(0, balance),
      annualRate: d.annualRate.toString(),
      repaymentCents: repaymentCents ?? cents(d.minRepaymentCents) + cents(d.extraRepaymentCents),
      frequency: d.repaymentFrequency,
      interval: d.repaymentInterval,
      anchorDate: anchorFor(d, today),
      today,
      offsetCents: offset,
      indexationOnly: d.indexationOnly,
    };
  }

  async function serialize(householdId: string, d: DebtRow, today: DateOnly, period?: { start: string; end: string }) {
    const input = await inputFor(householdId, d, today);
    const minimum = cents(d.minRepaymentCents);
    const extra = cents(d.extraRepaymentCents);
    const projection = simulateDebtPayoff(input);
    const minimumOnly = extra > 0 ? simulateDebtPayoff({ ...input, repaymentCents: minimum }) : projection;
    let principalReduced = 0;
    if (period) {
      const [repaid, charged] = await Promise.all([
        db.transaction.aggregate({ where: { householdId, toAccountId: d.accountId, type: { in: ['DEBT_REPAYMENT', 'TRANSFER'] }, date: { gte: dateIn(period.start), lte: dateIn(period.end) } }, _sum: { amountCents: true } }),
        db.transaction.aggregate({ where: { householdId, accountId: d.accountId, type: 'INTEREST_CHARGE', date: { gte: dateIn(period.start), lte: dateIn(period.end) } }, _sum: { amountCents: true } }),
      ]);
      principalReduced = Math.max(0, cents(repaid._sum.amountCents ?? 0n) - cents(charged._sum.amountCents ?? 0n));
    }
    return {
      id: d.id,
      accountId: d.accountId,
      accountName: d.account.name,
      accountType: d.account.type,
      originalBalanceCents: cents(d.originalBalanceCents),
      currentBalanceCents: input.balanceCents,
      annualRate: d.annualRate.toFixed(4),
      minRepaymentCents: minimum,
      repaymentFrequency: d.repaymentFrequency,
      repaymentInterval: d.repaymentInterval,
      extraRepaymentCents: extra,
      dueDay: d.dueDay,
      startDate: dateOutOrNull(d.startDate),
      categoryId: d.categoryId,
      categoryName: d.category?.name ?? null,
      indexationOnly: d.indexationOnly,
      includeInPayoff: d.includeInPayoff,
      offsetAccounts: d.account.offsets,
      offsetCents: input.offsetCents,
      ...calculateDebtProgress(cents(d.originalBalanceCents), input.balanceCents),
      principalReducedThisPeriodCents: principalReduced,
      nextInterestCents: projection.nextInterestCents,
      payoffDate: projection.payoffDate,
      totalInterestCents: projection.totalInterestCents,
      repayments: projection.repayments,
      warning: projection.warning,
      minimumOnlyPayoffDate: minimumOnly.payoffDate,
      minimumOnlyInterestCents: minimumOnly.totalInterestCents,
    };
  }

  async function loadOrThrow(householdId: string, id: string) {
    const d = (await loadAll(householdId)).find((x) => x.id === id);
    if (!d) throw notFound('Debt');
    return d;
  }

  async function validate(householdId: string, input: DebtProfileInput, existingId?: string) {
    const account = await findAccount(db, householdId, input.accountId);
    if (!account || account.class !== 'LIABILITY') throw validationError('Choose a card or loan account', { field: 'accountId' });
    if (account.debt && account.debt.id !== existingId) throw conflict('DEBT_EXISTS', `${account.name} already has a debt profile`);
    const rate = Number(input.annualRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100 || !/^\d{1,3}(\.\d{1,4})?$/.test(String(input.annualRate))) {
      throw validationError('Enter the annual rate as a percentage, e.g. 6.25', { field: 'annualRate' });
    }
    if (input.repaymentFrequency.startsWith('EVERY_N_') && !input.repaymentInterval) throw validationError('Enter how many days, weeks or months', { field: 'repaymentInterval' });
    if (input.dueDay != null && (input.dueDay < 1 || input.dueDay > 31)) throw validationError('Due day is 1–31', { field: 'dueDay' });
    if (input.categoryId) {
      const [c] = await findCategoriesByIds(db, householdId, [input.categoryId]);
      const bills = (await listBuckets(db, householdId)).find((b) => b.key === 'BILLS');
      if (!c || c.isGroup || c.bucketId !== bills?.id) throw validationError('Choose a Bills category for the minimum repayment', { field: 'categoryId' });
    }
    return account;
  }

  return {
    async list(householdId: string) {
      const { today } = await context(householdId);
      const budget = await services.budgets.ensureActive(householdId);
      const summary = await services.budgets.periodOf(householdId, budget, today);
      return Promise.all((await loadAll(householdId)).map((d) => serialize(householdId, d, today, summary)));
    },

    async get(householdId: string, id: string) {
      const { today } = await context(householdId);
      const budget = await services.budgets.ensureActive(householdId);
      return serialize(householdId, await loadOrThrow(householdId, id), today, await services.budgets.periodOf(householdId, budget, today));
    },

    async create(householdId: string, input: DebtProfileInput) {
      const account = await validate(householdId, input);
      const hecs = account.type === 'HECS_HELP';
      const d = await db.debt.create({
        data: {
          householdId,
          accountId: account.id,
          originalBalanceCents: BigInt(input.originalBalanceCents ?? cents(account.openingBalanceCents)),
          annualRate: String(input.annualRate),
          minRepaymentCents: BigInt(input.minRepaymentCents),
          repaymentFrequency: input.repaymentFrequency,
          repaymentInterval: input.repaymentFrequency.startsWith('EVERY_N_') ? (input.repaymentInterval ?? null) : null,
          extraRepaymentCents: BigInt(input.extraRepaymentCents ?? 0),
          dueDay: input.dueDay ?? null,
          startDate: input.startDate ? dateIn(input.startDate) : null,
          categoryId: input.categoryId ?? null,
          indexationOnly: input.indexationOnly ?? hecs,
          includeInPayoff: input.includeInPayoff ?? !hecs,
        },
      });
      return this.get(householdId, d.id);
    },

    async update(householdId: string, id: string, input: DebtProfileInput) {
      const existing = await loadOrThrow(householdId, id);
      if (input.accountId !== existing.accountId) throw validationError('A debt profile stays on its account', { field: 'accountId' });
      await validate(householdId, input, id);
      await db.debt.updateMany({
        where: { householdId, id },
        data: {
          ...(input.originalBalanceCents != null ? { originalBalanceCents: BigInt(input.originalBalanceCents) } : {}),
          annualRate: String(input.annualRate),
          minRepaymentCents: BigInt(input.minRepaymentCents),
          repaymentFrequency: input.repaymentFrequency,
          repaymentInterval: input.repaymentFrequency.startsWith('EVERY_N_') ? (input.repaymentInterval ?? null) : null,
          extraRepaymentCents: BigInt(input.extraRepaymentCents ?? 0),
          dueDay: input.dueDay ?? null,
          startDate: input.startDate ? dateIn(input.startDate) : null,
          categoryId: input.categoryId ?? null,
          ...(input.indexationOnly !== undefined ? { indexationOnly: input.indexationOnly } : {}),
          ...(input.includeInPayoff !== undefined ? { includeInPayoff: input.includeInPayoff } : {}),
        },
      });
      return this.get(householdId, id);
    },

    async remove(householdId: string, id: string) {
      await loadOrThrow(householdId, id);
      await db.debt.deleteMany({ where: { householdId, id } });
    },

    /** Minimum-only against minimum + extra (default: the profile's extra), with both schedules. */
    async payoff(householdId: string, id: string, extraCents?: number) {
      const { today } = await context(householdId);
      const d = await loadOrThrow(householdId, id);
      const input = await inputFor(householdId, d, today, cents(d.minRepaymentCents));
      const extra = extraCents ?? cents(d.extraRepaymentCents);
      const c = compareExtraRepayment(input, extra);
      return { debtId: d.id, accountName: d.account.name, balanceCents: input.balanceCents, offsetCents: input.offsetCents, ...c };
    },

    /** Payoff order across every included debt (spec §10). Extra defaults to the debts' extras, per month. */
    async plan(householdId: string, opts: { strategy?: 'SNOWBALL' | 'AVALANCHE'; extraMonthlyCents?: number }) {
      const { today, strategy } = await context(householdId);
      const debts = (await loadAll(householdId)).filter((d) => d.includeInPayoff && !d.indexationOnly);
      const items: (PlanDebt & { name: string })[] = [];
      let extras = 0;
      for (const d of debts) {
        const input = await inputFor(householdId, d, today);
        if (input.balanceCents <= 0) continue;
        const freq = { frequency: d.repaymentFrequency, interval: d.repaymentInterval };
        items.push({
          id: d.id,
          name: d.account.name,
          balanceCents: input.balanceCents,
          annualRate: d.annualRate.toString(),
          minimumMonthlyCents: convertFrequency(cents(d.minRepaymentCents), freq, { frequency: 'MONTHLY' }),
          offsetCents: input.offsetCents,
        });
        extras += convertFrequency(cents(d.extraRepaymentCents), freq, { frequency: 'MONTHLY' });
      }
      const chosen = opts.strategy ?? strategy;
      const extra = opts.extraMonthlyCents ?? extras;
      const result = simulatePayoffPlan(items, chosen, extra, today);
      const other = simulatePayoffPlan(items, chosen === 'SNOWBALL' ? 'AVALANCHE' : 'SNOWBALL', extra, today);
      return {
        ...result,
        extraMonthlyCents: extra,
        debts: result.debts.map((r) => ({ ...r, name: items.find((i) => i.id === r.id)!.name, balanceCents: items.find((i) => i.id === r.id)!.balanceCents, annualRate: String(items.find((i) => i.id === r.id)!.annualRate) })),
        alternative: { strategy: other.strategy, debtFreeDate: other.debtFreeDate, totalInterestCents: other.totalInterestCents },
      };
    },
  };
}

export type DebtService = ReturnType<typeof createDebtService>;
