import type { Budget, BudgetItem, Frequency } from '@prisma/client';
import type { Deps } from './context.js';
import * as repo from '../repositories/budgets.js';
import { listBuckets } from '../repositories/buckets.js';
import { listCategories, findCategoriesByIds } from '../repositories/categories.js';
import { getHousehold, updateHousehold } from '../repositories/households.js';
import { listRecurring } from '../repositories/recurring.js';
import { spendingRows, type SpendingRow } from '../repositories/reporting.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { cents, dateIn, dateOut, dateOutOrNull, decimalOut } from '../lib/serialize.js';
import { calculateBucketAllocation } from '../finance/allocation.js';
import { buildBudgetSummary, calculateBudgetVariance } from '../finance/budget.js';
import { calculateIncomeAt, convertFrequency, periodTypeToFrequency, type BudgetPeriodType, type FrequencySpec } from '../finance/frequency.js';
import { nextPeriod, periodContaining, previousPeriod, type Period } from '../finance/periods.js';
import { calculateCategorySpending, calculateIncomeTotal } from '../finance/spending.js';
import { dateInTimeZone } from '../finance/dates.js';

export interface BudgetInput {
  name: string;
  periodType: BudgetPeriodType;
  anchorDate: string;
  isActive?: boolean;
}

export interface ItemInput {
  amountCents: number;
  enteredFrequency: Frequency;
  frequencyInterval?: number | null;
  notes?: string | null;
}

type BudgetWithItems = Budget & { items: BudgetItem[] };

const serializeItem = (i: BudgetItem, periodFreq: FrequencySpec) => ({
  categoryId: i.categoryId,
  amountCents: cents(i.amountCents),
  enteredFrequency: i.enteredFrequency,
  frequencyInterval: i.frequencyInterval,
  notes: i.notes,
  periodAmountCents: convertFrequency(cents(i.amountCents), { frequency: i.enteredFrequency, interval: i.frequencyInterval }, periodFreq),
});

export function serializeBudget(b: BudgetWithItems) {
  const periodFreq = periodTypeToFrequency(b.periodType);
  return {
    id: b.id,
    name: b.name,
    periodType: b.periodType,
    anchorDate: dateOut(b.anchorDate),
    isActive: b.isActive,
    items: b.items.map((i) => serializeItem(i, periodFreq)),
  };
}

/** Income schedules active in a period, as frequency sources for normalisation. */
export async function incomeSources(deps: Deps, householdId: string, period: Period) {
  const schedules = await listRecurring(deps.db, householdId);
  return schedules
    .filter((r) => r.type === 'INCOME' && dateOut(r.startDate) <= period.end && (!r.endDate || dateOutOrNull(r.endDate)! >= period.start))
    .map((r) => ({ amountCents: cents(r.amountCents), frequency: r.frequency, interval: r.interval }));
}

export function createBudgetService(deps: Deps) {
  const { db } = deps;

  async function loadOrThrow(householdId: string, id: string) {
    const b = await repo.findBudget(db, householdId, id);
    if (!b) throw notFound('Budget');
    return b;
  }

  /** The active budget, creating one from the household settings if there is none. */
  async function ensureActive(householdId: string): Promise<BudgetWithItems> {
    const active = await repo.findActiveBudget(db, householdId);
    if (active) return active;
    // Serialised per household so two first requests cannot both create one.
    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'home-budget:budget:' + householdId}))`;
      const again = await repo.findActiveBudget(tx, householdId);
      if (again) return again;
      const any = (await repo.listBudgets(tx, householdId))[0];
      if (any) {
        await repo.updateBudget(tx, householdId, any.id, { isActive: true });
        return { ...any, isActive: true };
      }
      const h = await getHousehold(tx, householdId);
      return repo.createBudget(tx, householdId, {
        name: 'Household budget',
        periodType: h.budgetPeriodType,
        anchorDate: h.budgetAnchorDate,
        isActive: true,
      });
    });
  }

  /** The active budget's period mirrors the household's budget settings. */
  async function syncHousehold(householdId: string, b: { periodType: BudgetPeriodType; anchorDate: Date }) {
    await updateHousehold(db, householdId, { budgetPeriodType: b.periodType, budgetAnchorDate: b.anchorDate });
  }

  async function summarise(householdId: string, budget: BudgetWithItems, opts: { date?: string; basis?: 'PLANNED' | 'ACTUAL'; includeEmpty?: boolean }) {
    const household = await getHousehold(db, householdId);
    const today = dateInTimeZone(deps.now(), household.timezone);
    const anchor = dateOut(budget.anchorDate);
    const period = periodContaining(budget.periodType, anchor, opts.date ?? today);
    const periodFreq = periodTypeToFrequency(budget.periodType);

    const [categories, buckets, rows, sources] = await Promise.all([
      listCategories(db, householdId, { includeInactive: true }),
      listBuckets(db, householdId),
      spendingRows(db, householdId, dateIn(period.start), dateIn(period.end)),
      incomeSources(deps, householdId, period),
    ]);
    const splits = rows.map((r: SpendingRow) => ({ ...r }));
    const spending = calculateCategorySpending(splits);
    const actualIncome = calculateIncomeTotal(splits);

    const items = budget.items.map((i) => serializeItem(i, periodFreq));
    const kindOf = new Map(categories.map((c) => [c.id, c.kind]));
    const incomeItems = items.filter((i) => kindOf.get(i.categoryId) === 'INCOME');

    // Planned income: income schedules normalised to the period; without any, the budget's income lines.
    const fromSchedules = sources.length > 0;
    const plannedIncome = fromSchedules ? calculateIncomeAt(sources, periodFreq) : incomeItems.reduce((s, i) => s + i.periodAmountCents, 0);
    const basis = opts.basis ?? household.allocationBasis;
    const allocationIncome = basis === 'ACTUAL' ? actualIncome : plannedIncome;
    const allocation = calculateBucketAllocation(
      Math.max(0, allocationIncome),
      buckets.map((b) => ({ id: b.id, percentage: b.percentage.toString(), sortOrder: b.sortOrder })),
    );

    const thresholds = { amber: household.amberThreshold.toString(), red: household.redThreshold.toString() };
    const summary = buildBudgetSummary({
      categories: categories.map((c) => ({ ...c, kind: c.kind })),
      buckets: buckets.map((b) => ({ id: b.id, key: b.key, name: b.name, colour: b.colour, sortOrder: b.sortOrder })),
      items: items.filter((i) => kindOf.get(i.categoryId) === 'EXPENSE'),
      spending,
      allocations: new Map(allocation.map((a) => [a.id, a.amountCents])),
      thresholds,
      includeEmpty: opts.includeEmpty,
    });

    const incomeByCategory = new Map<string, number>();
    for (const r of rows) if (r.transactionType === 'INCOME') incomeByCategory.set(r.categoryId, (incomeByCategory.get(r.categoryId) ?? 0) + r.amountCents);
    const incomeLines = categories
      .filter((c) => c.kind === 'INCOME' && !c.isGroup && (incomeByCategory.has(c.id) || incomeItems.some((i) => i.categoryId === c.id)))
      .map((c) => ({
        categoryId: c.id,
        name: c.name,
        budgetCents: incomeItems.find((i) => i.categoryId === c.id)?.periodAmountCents ?? 0,
        actualCents: incomeByCategory.get(c.id) ?? 0,
      }));

    const prev = previousPeriod(budget.periodType, anchor, period);
    const next = nextPeriod(budget.periodType, anchor, period);
    return {
      budget: serializeBudget(budget),
      period: { ...period, previousStart: prev.start, nextStart: next.start, isCurrent: period.start <= today && today <= period.end, today },
      income: {
        plannedCents: plannedIncome,
        plannedSource: fromSchedules ? ('schedules' as const) : incomeItems.length ? ('budget' as const) : ('none' as const),
        actualCents: actualIncome,
        scheduledActualCents: rows.filter((r) => r.transactionType === 'INCOME' && r.scheduled).reduce((s, r) => s + r.amountCents, 0),
        // Each equivalent is converted straight from the sources, rounding once.
        expected: {
          weekly: calculateIncomeAt(sources, { frequency: 'WEEKLY' }),
          fortnightly: calculateIncomeAt(sources, { frequency: 'FORTNIGHTLY' }),
          monthly: calculateIncomeAt(sources, { frequency: 'MONTHLY' }),
          annual: calculateIncomeAt(sources, { frequency: 'ANNUALLY' }),
        },
        allocationBasis: basis,
        allocationIncomeCents: Math.max(0, allocationIncome),
        variance: calculateBudgetVariance(plannedIncome, actualIncome, thresholds),
      },
      buckets: summary.buckets.map((b) => ({ ...b, percentage: decimalOut(buckets.find((x) => x.id === b.bucketId)!.percentage) })),
      total: summary.total,
      incomeLines,
      thresholds: { amber: Number(household.amberThreshold), red: Number(household.redThreshold) },
      rows,
    };
  }

  return {
    ensureActive,
    summarise,

    async list(householdId: string) {
      await ensureActive(householdId);
      return (await repo.listBudgets(db, householdId)).map(serializeBudget);
    },

    async get(householdId: string, id: string) {
      return serializeBudget(await loadOrThrow(householdId, id));
    },

    async create(householdId: string, input: BudgetInput) {
      const created = await db.$transaction(async (tx) => {
        const b = await repo.createBudget(tx, householdId, {
          name: input.name,
          periodType: input.periodType,
          anchorDate: dateIn(input.anchorDate),
          isActive: input.isActive ?? false,
        });
        if (b.isActive) await repo.deactivateOtherBudgets(tx, householdId, b.id);
        return b;
      });
      if (created.isActive) await syncHousehold(householdId, created);
      await ensureActive(householdId);
      return this.get(householdId, created.id);
    },

    async update(householdId: string, id: string, input: Partial<BudgetInput>) {
      const existing = await loadOrThrow(householdId, id);
      if (input.isActive === false && existing.isActive) {
        throw validationError('Make another budget active instead', { field: 'isActive' });
      }
      await db.$transaction(async (tx) => {
        await repo.updateBudget(tx, householdId, id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.periodType !== undefined ? { periodType: input.periodType } : {}),
          ...(input.anchorDate !== undefined ? { anchorDate: dateIn(input.anchorDate) } : {}),
          ...(input.isActive ? { isActive: true } : {}),
        });
        if (input.isActive) await repo.deactivateOtherBudgets(tx, householdId, id);
      });
      const updated = await loadOrThrow(householdId, id);
      if (updated.isActive) await syncHousehold(householdId, updated);
      return serializeBudget(updated);
    },

    async remove(householdId: string, id: string) {
      const b = await loadOrThrow(householdId, id);
      if (b.isActive) throw conflict('ACTIVE_BUDGET', 'Make another budget active before deleting this one');
      await repo.deleteBudget(db, householdId, id);
    },

    /** Copies a budget and its plan. The copy starts inactive. */
    async copy(householdId: string, id: string, name?: string) {
      const source = await loadOrThrow(householdId, id);
      const created = await db.$transaction(async (tx) => {
        const b = await repo.createBudget(tx, householdId, {
          name: name ?? `${source.name} (copy)`,
          periodType: source.periodType,
          anchorDate: source.anchorDate,
          isActive: false,
        });
        await repo.replaceItems(
          tx,
          householdId,
          b.id,
          source.items.map((i) => ({ categoryId: i.categoryId, amountCents: cents(i.amountCents), enteredFrequency: i.enteredFrequency, frequencyInterval: i.frequencyInterval, notes: i.notes })),
        );
        return b;
      });
      return this.get(householdId, created.id);
    },

    async setItem(householdId: string, budgetId: string, categoryId: string, input: ItemInput) {
      await loadOrThrow(householdId, budgetId);
      const [c] = await findCategoriesByIds(db, householdId, [categoryId]);
      if (!c || c.isGroup) throw validationError('Unknown category', { field: 'categoryId' });
      if (input.enteredFrequency.startsWith('EVERY_N_') && !input.frequencyInterval) {
        throw validationError('Enter how many days, weeks or months', { field: 'frequencyInterval' });
      }
      await repo.upsertItem(db, householdId, budgetId, categoryId, {
        ...input,
        frequencyInterval: input.enteredFrequency.startsWith('EVERY_N_') ? input.frequencyInterval : null,
      });
      return this.get(householdId, budgetId);
    },

    async deleteItem(householdId: string, budgetId: string, categoryId: string) {
      await loadOrThrow(householdId, budgetId);
      await repo.deleteItem(db, householdId, budgetId, categoryId);
      return this.get(householdId, budgetId);
    },

    async summary(householdId: string, id: string, opts: { date?: string; basis?: 'PLANNED' | 'ACTUAL'; includeEmpty?: boolean }) {
      const { rows: _rows, ...rest } = await summarise(householdId, await loadOrThrow(householdId, id), opts);
      return rest;
    },
  };
}

export type BudgetService = ReturnType<typeof createBudgetService>;
