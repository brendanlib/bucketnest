import type { Deps } from './context.js';
import type { BudgetService } from './budget.service.js';
import type { RecurringService } from './recurring.service.js';
import type { AccountService } from './account.service.js';
import type { TransactionService } from './transaction.service.js';
import type { SinkingFundService } from './sinking-fund.service.js';
import type { GoalService } from './goal.service.js';
import type { NetWorthService } from './networth.service.js';
import { listCategories } from '../repositories/categories.js';
import { debtMovements } from '../repositories/reporting.js';
import { dateIn } from '../lib/serialize.js';
import { percentage } from '../finance/money.js';
import { addDays } from '../finance/dates.js';
import { lastMonthEnds } from '../finance/periods.js';
import { SYSTEM_CATEGORY } from '../seed/defaults.js';

const BILLS_WINDOW_DAYS = 14;
const OVERDUE_LOOKBACK_DAYS = 31;

/** Everything the dashboard shows for one budget period, in one call (spec §11). */
export function createDashboardService(
  deps: Deps,
  services: { budgets: BudgetService; recurring: RecurringService; accounts: AccountService; transactions: TransactionService; sinkingFunds: SinkingFundService; goals: GoalService; netWorth: NetWorthService },
) {
  const { db } = deps;

  /** Net worth now (accounts and asset valuations) with month ends for the last 12 months. */
  async function netWorth(householdId: string, today: string) {
    const months = lastMonthEnds(today, 12);
    const [current, series] = await Promise.all([services.netWorth.at(householdId, today), services.netWorth.series(householdId, `${months[0]!.slice(0, 8)}01`, today)]);
    return {
      date: today,
      assetsCents: current.assetsCents,
      liabilitiesCents: current.liabilitiesCents,
      netWorthCents: current.netWorthCents,
      history: series.map((p) => ({ date: p.date, netWorthCents: p.netWorthCents })),
    };
  }

  return {
    async get(householdId: string, opts: { date?: string; basis?: 'PLANNED' | 'ACTUAL' }) {
      const budget = await services.budgets.ensureActive(householdId);
      const summary = await services.budgets.summarise(householdId, budget, { date: opts.date, basis: opts.basis });
      const { period, income } = summary;
      const today = period.today;

      const categories = await listCategories(db, householdId, { includeInactive: true });
      const investment = categories.find((c) => c.systemKey === SYSTEM_CATEGORY.investmentContributions)?.id;
      const fireBucket = summary.buckets.find((b) => b.key === 'FIRE_EXTINGUISHER');
      const fireCategories = new Set(categories.filter((c) => c.bucketId === fireBucket?.bucketId).map((c) => c.id));
      const contributions = { savingsCents: 0, investmentCents: 0, extraRepaymentsCents: 0 };
      for (const r of summary.rows) {
        if (r.transactionType === 'SAVINGS_CONTRIBUTION') {
          if (r.categoryId === investment) contributions.investmentCents += r.amountCents;
          else contributions.savingsCents += r.amountCents;
        } else if (r.transactionType === 'DEBT_REPAYMENT' && fireCategories.has(r.categoryId)) {
          contributions.extraRepaymentsCents += r.amountCents;
        }
      }
      const debt = await debtMovements(db, householdId, dateIn(period.start), dateIn(period.end));
      const [funds, goals] = await Promise.all([services.sinkingFunds.list(householdId), services.goals.list(householdId)]);
      const goalCards = goals.slice(0, 3).map((g) => ({ id: g.id, name: g.name, type: g.type, targetCents: g.targetCents, currentCents: g.currentCents, progressPercent: g.progressPercent, onTrack: g.onTrack }));

      const cards = summary.buckets.map((b) => ({
        bucketId: b.bucketId,
        key: b.key,
        name: b.name,
        colour: b.colour,
        percentage: b.percentage,
        allocatedCents: b.allocatedCents,
        actualCents: b.actualCents,
        remainingCents: b.allocation.remainingCents,
        percentUsed: b.allocation.percentUsed,
        percentOfIncome: percentage(b.actualCents, income.allocationIncomeCents),
        status: b.allocation.status,
        plannedCents: b.budgetCents,
        overAllocatedCents: b.overAllocatedCents,
        ...(b.key === 'FIRE_EXTINGUISHER'
          ? { fire: { ...contributions, principalReducedCents: Math.max(0, debt.repaidCents - debt.interestCents), goals: goalCards } }
          : {}),
      }));

      const alerts = summary.buckets
        .flatMap((b) => b.groups.flatMap((g) => g.lines.map((l) => ({ ...l, bucketKey: b.key, bucketName: b.name, colour: b.colour }))))
        .filter((l) => l.status === 'amber' || l.status === 'red')
        .sort((a, b) => (b.percentUsed ?? 0) - (a.percentUsed ?? 0))
        .map((l) => ({
          categoryId: l.categoryId,
          name: l.name,
          bucketKey: l.bucketKey,
          bucketName: l.bucketName,
          colour: l.colour,
          budgetCents: l.budgetCents,
          actualCents: l.actualCents,
          remainingCents: l.remainingCents,
          percentUsed: l.percentUsed,
          status: l.status as 'amber' | 'red',
        }));

      const occurrences = await services.recurring.occurrences(householdId, {
        from: addDays(today, -OVERDUE_LOOKBACK_DAYS),
        to: addDays(today, BILLS_WINDOW_DAYS),
      });
      const billsDue = occurrences.filter(
        (o) => o.bucketKey === 'BILLS' && (o.type === 'EXPENSE' || o.type === 'DEBT_REPAYMENT') && (o.status === 'overdue' || o.status === 'due' || o.status === 'upcoming'),
      );

      return {
        budget: { id: budget.id, name: budget.name, periodType: budget.periodType },
        period,
        income: {
          expected: income.expected,
          plannedCents: income.plannedCents,
          plannedSource: income.plannedSource,
          actualCents: income.actualCents,
          scheduledCents: income.scheduledActualCents,
          otherCents: income.actualCents - income.scheduledActualCents,
          allocationBasis: income.allocationBasis,
          allocationIncomeCents: income.allocationIncomeCents,
        },
        buckets: cards,
        billsDue,
        alerts,
        // Sinking funds due within 30 days and not funded, and goals projected to miss their date.
        watch: [
          ...funds
            .filter((f) => f.status === 'due_soon' || f.status === 'due_short')
            .map((f) => ({ kind: 'sinking_fund' as const, id: f.id, name: f.name, date: f.dueDate, targetCents: f.targetCents, currentCents: f.currentCents, shortfallCents: f.remainingCents, status: f.status as 'due_soon' | 'due_short' })),
          ...goals
            .filter((g) => g.onTrack === false)
            .map((g) => ({ kind: 'goal' as const, id: g.id, name: g.name, date: g.targetDate, targetCents: g.targetCents, currentCents: g.currentCents, shortfallCents: g.remainingCents, status: 'behind' as const })),
        ],
        netWorth: await netWorth(householdId, period.end < today ? period.end : today),
        uncategorisedCount: await services.transactions.countUncategorised(householdId),
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
