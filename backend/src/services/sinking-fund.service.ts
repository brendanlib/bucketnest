import type { Frequency, Prisma } from '@prisma/client';
import type { Deps } from './context.js';
import type { TransactionService } from './transaction.service.js';
import { exceptionsOf, specOf } from './recurring.service.js';
import { findAccount } from '../repositories/accounts.js';
import { findCategoriesByIds } from '../repositories/categories.js';
import { findRecurring, postedOccurrences } from '../repositories/recurring.js';
import { getHousehold } from '../repositories/households.js';
import { notFound, validationError } from '../lib/errors.js';
import { cents, centsOrNull, dateIn, dateOut } from '../lib/serialize.js';
import { calculateSinkingFundContribution, countContributionDates } from '../finance/goals.js';
import { percentage } from '../finance/money.js';
import { nextOccurrence } from '../finance/recurrence.js';
import { addDays, addMonthsClamped, dateInTimeZone, diffDays, type DateOnly } from '../finance/dates.js';

export interface SinkingFundInput {
  name: string;
  targetCents?: number | null;
  dueDate?: string | null;
  contributionFrequency: Frequency;
  contributionInterval?: number | null;
  contributionAnchorDate?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  recurringId?: string | null;
  repeats?: boolean;
  manualCurrentCents?: number | null;
  isActive?: boolean;
  notes?: string | null;
}

export type FundStatus = 'funded' | 'on_track' | 'due_soon' | 'due_short';
const DUE_SOON_DAYS = 30;

const include = {
  account: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, bucket: { select: { key: true } } } },
  recurring: { include: { exceptions: true, account: { select: { id: true, name: true } }, toAccount: { select: { id: true, name: true, class: true, repaymentTreatment: true } }, category: { select: { id: true, name: true, bucketId: true, bucket: { select: { key: true } } } } } },
} satisfies Prisma.SinkingFundInclude;

type FundRow = Prisma.SinkingFundGetPayload<{ include: typeof include }>;

export function createSinkingFundService(deps: Deps, transactions: TransactionService) {
  const { db } = deps;

  async function today(householdId: string) {
    return dateInTimeZone(deps.now(), (await getHousehold(db, householdId)).timezone);
  }

  async function loadOrThrow(householdId: string, id: string) {
    const f = await db.sinkingFund.findFirst({ where: { householdId, id }, include });
    if (!f) throw notFound('Sinking fund');
    return f;
  }

  /** Target and due date: from the linked bill's next unpaid occurrence, or the fund's own, rolled forward yearly when it repeats. */
  async function effectiveTarget(householdId: string, f: FundRow, todayDate: DateOnly) {
    if (f.recurring) {
      const posted = await postedOccurrences(db, householdId, [f.recurring.id], dateIn(addDays(todayDate, -400)));
      const next = nextOccurrence(specOf(f.recurring), addDays(todayDate, -60), exceptionsOf(f.recurring), (d) => posted.has(`${f.recurring!.id}|${d}`));
      if (next) return { targetCents: next.amountCents, dueDate: next.date, source: 'schedule' as const };
    }
    let due = dateOut(f.dueDate);
    if (f.repeats) while (due < todayDate) due = addMonthsClamped(due, 12);
    return { targetCents: cents(f.targetCents), dueDate: due, source: 'fund' as const };
  }

  async function amounts(householdId: string, f: FundRow, todayDate: DateOnly) {
    const [contrib, paid] = await Promise.all([
      db.sinkingFundContribution.aggregate({ where: { householdId, sinkingFundId: f.id }, _sum: { amountCents: true } }),
      db.transactionSplit.aggregate({ where: { householdId, sinkingFundId: f.id, isSinkingFundPayment: true }, _sum: { amountCents: true } }),
    ]);
    const contributions = cents(contrib._sum.amountCents ?? 0n);
    const payments = cents(paid._sum.amountCents ?? 0n);
    if (f.accountId) {
      const balance = (await transactions.balanceOf(householdId, f.accountId, todayDate)) ?? 0;
      return { currentCents: balance, source: 'account' as const, contributions, payments };
    }
    return { currentCents: (centsOrNull(f.manualCurrentCents) ?? 0) + contributions - payments, source: 'contributions' as const, contributions, payments };
  }

  async function serialize(householdId: string, f: FundRow, todayDate: DateOnly) {
    const t = await effectiveTarget(householdId, f, todayDate);
    const a = await amounts(householdId, f, todayDate);
    const plan = { frequency: f.contributionFrequency, interval: f.contributionInterval, anchorDate: dateOut(f.contributionAnchorDate) };
    // Contributions must land before the due date.
    const datesLeft = countContributionDates(plan, todayDate, addDays(t.dueDate, -1));
    const rec = calculateSinkingFundContribution({ targetCents: t.targetCents, currentCents: a.currentCents, datesLeft });
    const status: FundStatus = rec.funded ? 'funded' : t.dueDate <= todayDate ? 'due_short' : diffDays(t.dueDate, todayDate) <= DUE_SOON_DAYS ? 'due_soon' : 'on_track';
    return {
      id: f.id,
      name: f.name,
      targetCents: t.targetCents,
      dueDate: t.dueDate,
      targetSource: t.source,
      ownTargetCents: cents(f.targetCents),
      ownDueDate: dateOut(f.dueDate),
      contributionFrequency: f.contributionFrequency,
      contributionInterval: f.contributionInterval,
      contributionAnchorDate: plan.anchorDate,
      accountId: f.accountId,
      accountName: f.account?.name ?? null,
      categoryId: f.categoryId,
      categoryName: f.category?.name ?? null,
      bucketKey: f.category?.bucket?.key ?? null,
      recurringId: f.recurringId,
      recurringName: f.recurring?.name ?? null,
      repeats: f.repeats,
      manualCurrentCents: centsOrNull(f.manualCurrentCents),
      isActive: f.isActive,
      notes: f.notes,
      currentCents: a.currentCents,
      currentSource: a.source,
      contributionsCents: a.contributions,
      paymentsCents: a.payments,
      remainingCents: rec.remainingCents,
      progressPercent: percentage(Math.max(0, a.currentCents), t.targetCents),
      datesLeft,
      recommendedContributionCents: rec.contributionCents,
      status,
      shortfallCents: status === 'due_short' ? rec.remainingCents : 0,
    };
  }

  async function validate(householdId: string, input: SinkingFundInput) {
    if (!input.recurringId && (!input.targetCents || input.targetCents <= 0)) throw validationError('Enter the amount to save', { field: 'targetCents' });
    if (!input.recurringId && !input.dueDate) throw validationError('Enter when it is due', { field: 'dueDate' });
    if (input.contributionFrequency.startsWith('EVERY_N_') && !input.contributionInterval) {
      throw validationError('Enter how many days, weeks or months', { field: 'contributionInterval' });
    }
    if (input.accountId) {
      const a = await findAccount(db, householdId, input.accountId);
      if (!a || a.class !== 'ASSET') throw validationError('Link an account you hold money in', { field: 'accountId' });
    }
    if (input.categoryId) {
      const [c] = await findCategoriesByIds(db, householdId, [input.categoryId]);
      if (!c || c.isGroup || c.kind !== 'EXPENSE') throw validationError('Choose a spending category', { field: 'categoryId' });
    }
    if (input.recurringId) {
      const r = await findRecurring(db, householdId, input.recurringId);
      if (!r) throw validationError('Unknown schedule', { field: 'recurringId' });
      if (r.type !== 'EXPENSE' && r.type !== 'DEBT_REPAYMENT') throw validationError('Link a bill or expense schedule', { field: 'recurringId' });
    }
  }

  async function toData(householdId: string, input: SinkingFundInput) {
    let target = input.targetCents ?? null;
    let due = input.dueDate ?? null;
    let categoryId = input.categoryId ?? null;
    if (input.recurringId) {
      // The schedule fills the target, due date and category (spec §9).
      const r = (await findRecurring(db, householdId, input.recurringId))!;
      const next = nextOccurrence(specOf(r), await today(householdId), exceptionsOf(r));
      target ??= next?.amountCents ?? cents(r.amountCents);
      due ??= next?.date ?? dateOut(r.startDate);
      categoryId ??= r.categoryId;
    }
    return {
      name: input.name,
      targetCents: BigInt(target!),
      dueDate: dateIn(due!),
      contributionFrequency: input.contributionFrequency,
      contributionInterval: input.contributionFrequency.startsWith('EVERY_N_') ? (input.contributionInterval ?? null) : null,
      ...(input.contributionAnchorDate ? { contributionAnchorDate: dateIn(input.contributionAnchorDate) } : {}),
      accountId: input.accountId ?? null,
      categoryId,
      recurringId: input.recurringId ?? null,
      repeats: input.repeats ?? true,
      manualCurrentCents: input.manualCurrentCents == null ? null : BigInt(input.manualCurrentCents),
      isActive: input.isActive ?? true,
      notes: input.notes ?? null,
    };
  }

  return {
    serialize,

    async list(householdId: string, opts: { includeInactive?: boolean } = {}) {
      const rows = await db.sinkingFund.findMany({ where: { householdId, ...(opts.includeInactive ? {} : { isActive: true }) }, include, orderBy: [{ dueDate: 'asc' }, { name: 'asc' }] });
      const t = await today(householdId);
      const out = await Promise.all(rows.map((f) => serialize(householdId, f, t)));
      return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name)));
    },

    async get(householdId: string, id: string) {
      const f = await loadOrThrow(householdId, id);
      const contributions = await db.sinkingFundContribution.findMany({ where: { householdId, sinkingFundId: id }, orderBy: { date: 'desc' }, take: 100 });
      return {
        ...(await serialize(householdId, f, await today(householdId))),
        contributions: contributions.map((c) => ({ id: c.id, date: dateOut(c.date), amountCents: cents(c.amountCents), transactionId: c.transactionId, notes: c.notes })),
      };
    },

    async create(householdId: string, input: SinkingFundInput) {
      await validate(householdId, input);
      const data = await toData(householdId, input);
      const f = await db.sinkingFund.create({ data: { householdId, ...data, contributionAnchorDate: data.contributionAnchorDate ?? dateIn(await today(householdId)) } });
      return this.get(householdId, f.id);
    },

    async update(householdId: string, id: string, input: SinkingFundInput) {
      await loadOrThrow(householdId, id);
      await validate(householdId, input);
      await db.sinkingFund.updateMany({ where: { householdId, id }, data: await toData(householdId, input) });
      return this.get(householdId, id);
    },

    async remove(householdId: string, id: string) {
      await loadOrThrow(householdId, id);
      // Payments keep their history but stop pointing at the fund (FK sets null); contributions go with it.
      await db.transactionSplit.updateMany({ where: { householdId, sinkingFundId: id }, data: { isSinkingFundPayment: false } });
      await db.sinkingFund.deleteMany({ where: { householdId, id } });
    },

    /**
     * Records a contribution. With a linked account and a from-account, the money
     * moves as a transfer; `transactionId` links a transfer already recorded;
     * without an account the money is simply set aside.
     */
    async contribute(householdId: string, userId: string, id: string, input: { amountCents?: number; date: string; fromAccountId?: string | null; transactionId?: string | null; notes?: string | null }) {
      const f = await loadOrThrow(householdId, id);
      let amount = input.amountCents;
      let transactionId: string | null = null;
      if (input.transactionId) {
        if (!f.accountId) throw validationError('This fund has no account to link a transfer to', { field: 'transactionId' });
        const t = await db.transaction.findFirst({ where: { householdId, id: input.transactionId }, include: { sinkingFundContribution: true } });
        if (!t || t.toAccountId !== f.accountId) throw validationError('Choose a transfer into the fund’s account', { field: 'transactionId' });
        if (t.sinkingFundContribution) throw validationError('That transfer is already a contribution', { field: 'transactionId' });
        amount = cents(t.amountCents);
        transactionId = t.id;
      } else if (f.accountId && input.fromAccountId) {
        if (!amount || amount <= 0) throw validationError('Enter an amount', { field: 'amountCents' });
        const t = await transactions.create(householdId, userId, {
          date: input.date,
          description: `Sinking fund: ${f.name}`,
          amountCents: amount,
          type: 'TRANSFER',
          accountId: input.fromAccountId,
          toAccountId: f.accountId,
          notes: input.notes ?? null,
        });
        transactionId = t.id;
      } else if (f.accountId) {
        throw validationError('Choose the account the money comes from', { field: 'fromAccountId' });
      }
      if (!amount || amount <= 0) throw validationError('Enter an amount', { field: 'amountCents' });
      await db.sinkingFundContribution.create({
        data: { householdId, sinkingFundId: id, date: dateIn(input.date), amountCents: BigInt(amount), transactionId, notes: input.notes ?? null },
      });
      return this.get(householdId, id);
    },

    async deleteContribution(householdId: string, id: string, contributionId: string) {
      await loadOrThrow(householdId, id);
      const r = await db.sinkingFundContribution.deleteMany({ where: { householdId, sinkingFundId: id, id: contributionId } });
      if (r.count === 0) throw notFound('Contribution');
      return this.get(householdId, id);
    },

    /** Contributions per fund in a date range (the funds' budget actuals). */
    async contributionsBetween(householdId: string, from: string, to: string) {
      const rows = await db.sinkingFundContribution.groupBy({
        by: ['sinkingFundId'],
        where: { householdId, date: { gte: dateIn(from), lte: dateIn(to) } },
        _sum: { amountCents: true },
      });
      return new Map(rows.map((r) => [r.sinkingFundId, cents(r._sum.amountCents ?? 0n)]));
    },
  };
}

export type SinkingFundService = ReturnType<typeof createSinkingFundService>;
