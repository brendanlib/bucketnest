import type { Deps } from './context.js';
import type { BudgetService } from './budget.service.js';
import type { RecurringService } from './recurring.service.js';
import type { AccountService } from './account.service.js';
import type { TransactionService } from './transaction.service.js';
import { listAccounts } from '../repositories/accounts.js';
import { listCategories } from '../repositories/categories.js';
import { debtMovements } from '../repositories/reporting.js';
import { dateIn } from '../lib/serialize.js';
import { calculateNetWorth } from '../finance/balance.js';
import { percentage } from '../finance/money.js';
import { addDays } from '../finance/dates.js';
import { lastMonthEnds } from '../finance/periods.js';
import { SYSTEM_CATEGORY } from '../seed/defaults.js';

const BILLS_WINDOW_DAYS = 14;
const OVERDUE_LOOKBACK_DAYS = 31;

/** Everything the dashboard shows for one budget period, in one call (spec §11). */
export function createDashboardService(
  deps: Deps,
  services: { budgets: BudgetService; recurring: RecurringService; accounts: AccountService; transactions: TransactionService },
) {
  const { db } = deps;

  async function netWorth(householdId: string, today: string) {
    const accounts = (await listAccounts(db, householdId, { includeClosed: true })).filter((a) => a.includeInNetWorth);
    const at = async (date: string) => {
      const balances = await services.accounts.balancesFor(householdId, accounts, dateIn(date));
      return calculateNetWorth({
        accounts: accounts.map((a) => ({ accountClass: a.class, balanceCents: balances.get(a.id) ?? 0 })),
        assetValuationsCents: [],
      });
    };
    const points = await Promise.all(lastMonthEnds(today, 12).map(async (date) => ({ date, ...(await at(date)) })));
    const current = points[points.length - 1]!;
    return { ...current, history: points.map((p) => ({ date: p.date, netWorthCents: p.netWorthCents })) };
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
          ? { fire: { ...contributions, principalReducedCents: Math.max(0, debt.repaidCents - debt.interestCents), goals: [] as unknown[] } }
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
        netWorth: await netWorth(householdId, period.end < today ? period.end : today),
        uncategorisedCount: await services.transactions.countUncategorised(householdId),
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
