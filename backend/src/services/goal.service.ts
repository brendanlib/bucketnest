import type { Frequency, GoalType } from '@prisma/client';
import type { Deps } from './context.js';
import type { TransactionService } from './transaction.service.js';
import { findAccount } from '../repositories/accounts.js';
import { getHousehold } from '../repositories/households.js';
import { notFound, validationError } from '../lib/errors.js';
import { cents, centsOrNull, dateIn, dateOutOrNull } from '../lib/serialize.js';
import { calculateGoalProgress } from '../finance/goals.js';
import { dateInTimeZone } from '../finance/dates.js';

export interface GoalInput {
  name: string;
  type: GoalType;
  targetCents: number;
  targetDate?: string | null;
  priority?: number;
  accountId?: string | null;
  manualCurrentCents?: number | null;
  contributionCents?: number | null;
  contributionFrequency?: Frequency | null;
  contributionInterval?: number | null;
  isActive?: boolean;
  notes?: string | null;
}

export function createGoalService(deps: Deps, transactions: TransactionService) {
  const { db } = deps;

  async function serialize(householdId: string, g: Awaited<ReturnType<typeof db.financialGoal.findFirstOrThrow>> & { account: { name: string } | null }, today: string) {
    const current = g.accountId ? ((await transactions.balanceOf(householdId, g.accountId, today)) ?? 0) : (centsOrNull(g.manualCurrentCents) ?? 0);
    const contributed = await db.transaction.aggregate({ where: { householdId, goalId: g.id }, _sum: { amountCents: true } });
    const plan = g.contributionFrequency
      ? { frequency: g.contributionFrequency, interval: g.contributionInterval, anchorDate: dateInTimeZone(g.createdAt, (await getHousehold(db, householdId)).timezone) }
      : null;
    const progress = calculateGoalProgress({
      targetCents: cents(g.targetCents),
      currentCents: current,
      today,
      targetDate: dateOutOrNull(g.targetDate),
      contributionCents: centsOrNull(g.contributionCents),
      plan,
    });
    return {
      id: g.id,
      name: g.name,
      type: g.type,
      targetCents: cents(g.targetCents),
      targetDate: dateOutOrNull(g.targetDate),
      priority: g.priority,
      accountId: g.accountId,
      accountName: g.account?.name ?? null,
      manualCurrentCents: centsOrNull(g.manualCurrentCents),
      contributionCents: centsOrNull(g.contributionCents),
      contributionFrequency: g.contributionFrequency,
      contributionInterval: g.contributionInterval,
      isActive: g.isActive,
      notes: g.notes,
      currentCents: current,
      currentSource: g.accountId ? ('account' as const) : ('manual' as const),
      contributedCents: cents(contributed._sum.amountCents ?? 0n),
      ...progress,
    };
  }

  async function validate(householdId: string, input: GoalInput) {
    if (input.accountId) {
      const a = await findAccount(db, householdId, input.accountId);
      if (!a || a.class !== 'ASSET') throw validationError('Link an account you hold money in', { field: 'accountId' });
    }
    if (input.contributionCents && !input.contributionFrequency) throw validationError('Say how often you contribute', { field: 'contributionFrequency' });
    if (input.contributionFrequency?.startsWith('EVERY_N_') && !input.contributionInterval) {
      throw validationError('Enter how many days, weeks or months', { field: 'contributionInterval' });
    }
  }

  const toData = (input: GoalInput) => ({
    name: input.name,
    type: input.type,
    targetCents: BigInt(input.targetCents),
    targetDate: input.targetDate ? dateIn(input.targetDate) : null,
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    accountId: input.accountId ?? null,
    manualCurrentCents: input.manualCurrentCents == null ? null : BigInt(input.manualCurrentCents),
    contributionCents: input.contributionCents == null ? null : BigInt(input.contributionCents),
    contributionFrequency: input.contributionFrequency ?? null,
    contributionInterval: input.contributionFrequency?.startsWith('EVERY_N_') ? (input.contributionInterval ?? null) : null,
    isActive: input.isActive ?? true,
    notes: input.notes ?? null,
  });

  const today = async (householdId: string) => dateInTimeZone(deps.now(), (await getHousehold(db, householdId)).timezone);

  async function loadOrThrow(householdId: string, id: string) {
    const g = await db.financialGoal.findFirst({ where: { householdId, id }, include: { account: { select: { name: true } } } });
    if (!g) throw notFound('Goal');
    return g;
  }

  return {
    async list(householdId: string, opts: { includeInactive?: boolean } = {}) {
      const rows = await db.financialGoal.findMany({
        where: { householdId, ...(opts.includeInactive ? {} : { isActive: true }) },
        include: { account: { select: { name: true } } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });
      const t = await today(householdId);
      return Promise.all(rows.map((g) => serialize(householdId, g, t)));
    },

    async get(householdId: string, id: string) {
      return serialize(householdId, await loadOrThrow(householdId, id), await today(householdId));
    },

    async create(householdId: string, input: GoalInput) {
      await validate(householdId, input);
      const max = await db.financialGoal.aggregate({ where: { householdId }, _max: { priority: true } });
      const g = await db.financialGoal.create({ data: { householdId, ...toData(input), priority: input.priority ?? (max._max.priority ?? 0) + 10, createdAt: deps.now() } });
      return this.get(householdId, g.id);
    },

    async update(householdId: string, id: string, input: GoalInput) {
      await loadOrThrow(householdId, id);
      await validate(householdId, input);
      await db.financialGoal.updateMany({ where: { householdId, id }, data: toData(input) });
      return this.get(householdId, id);
    },

    async remove(householdId: string, id: string) {
      await loadOrThrow(householdId, id);
      await db.financialGoal.deleteMany({ where: { householdId, id } });
    },
  };
}

export type GoalService = ReturnType<typeof createGoalService>;
