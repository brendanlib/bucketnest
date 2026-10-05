import type { Deps } from './context.js';
import type { BudgetService } from './budget.service.js';
import type { NetWorthService } from './networth.service.js';
import type { DebtService } from './debt.service.js';
import type { AccountService } from './account.service.js';
import type { SinkingFundService } from './sinking-fund.service.js';
import type { GoalService } from './goal.service.js';
import type { RecurringService } from './recurring.service.js';
import { exceptionsOf, specOf } from './recurring.service.js';
import { listBuckets } from '../repositories/buckets.js';
import { listCategories } from '../repositories/categories.js';
import { listAccounts } from '../repositories/accounts.js';
import { getHousehold } from '../repositories/households.js';
import { listRecurring, postedOccurrences } from '../repositories/recurring.js';
import { earliestTransactionDate, historyTransactions, monthlySpendingRows, type ReportFilters } from '../repositories/reporting.js';
import { scheduleExplains } from '../import/match.js';
import { validationError } from '../lib/errors.js';
import { cents, dateIn, dateOut } from '../lib/serialize.js';
import { calculateCategorySpending, calculateIncomeTotal } from '../finance/spending.js';
import { calculateSavingsRate } from '../finance/budget.js';
import { averageCents, forecastCategory, projectBalances, type ForecastMethod } from '../finance/forecast.js';
import { balanceEffect } from '../finance/balance.js';
import { generateOccurrences } from '../finance/recurrence.js';
import { simulateDebtPayoff } from '../finance/debt.js';
import { dateInTimeZone, daysInMonth, diffDays, formatDateOnly, parseDateOnly } from '../finance/dates.js';
import { SYSTEM_CATEGORY } from '../seed/defaults.js';

const TOP_CATEGORIES = 15;

/** 'YYYY-MM' for every month from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let { year: y, month: m } = parseDateOnly(from);
  const end = to.slice(0, 7);
  for (let i = 0; i < 600; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > end) break;
    out.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const monthStart = (key: string) => `${key}-01`;
const monthEnd = (key: string) => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return formatDateOnly(y, m, daysInMonth(y, m));
};
const addMonthsKey = (key: string, n: number) => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

export function createReportService(
  deps: Deps,
  services: { budgets: BudgetService; netWorth: NetWorthService; debts: DebtService; accounts: AccountService; sinkingFunds: SinkingFundService; goals: GoalService; recurring: RecurringService },
) {
  const { db } = deps;

  async function context(householdId: string) {
    const h = await getHousehold(db, householdId);
    const [buckets, categories] = await Promise.all([listBuckets(db, householdId), listCategories(db, householdId, { includeInactive: true })]);
    const bucketOf = new Map(categories.map((c) => [c.id, c.bucketId]));
    const fire = buckets.find((b) => b.key === 'FIRE_EXTINGUISHER')!;
    return { household: h, today: dateInTimeZone(deps.now(), h.timezone), buckets, categories, bucketOf, fireId: fire.id };
  }

  function checkRange(from: string, to: string) {
    if (from > to) throw validationError('"from" must be on or before "to"', { field: 'from' });
    if (diffDays(to, from) > 366 * 10) throw validationError('Choose a range of at most 10 years', { field: 'to' });
  }

  return {
    /**
     * Spending (spec §12) by bucket, by category (top 15 + Other) and by month.
     * Spending is net of refunds and includes bills paid from sinking funds —
     * reports are history, not period variance. Fire Extinguisher money is saving,
     * so it is shown by bucket but kept out of the spending total.
     */
    async spending(householdId: string, q: { from: string; to: string } & ReportFilters) {
      checkRange(q.from, q.to);
      const ctx = await context(householdId);
      const rows = await monthlySpendingRows(db, householdId, dateIn(q.from), dateIn(q.to), q);
      const byCategory = calculateCategorySpending(rows, { includeSinkingFundPayments: true });

      const byBucket = ctx.buckets.map((b) => ({
        bucketId: b.id,
        key: b.key,
        name: b.name,
        colour: b.colour,
        isSaving: b.id === ctx.fireId,
        amountCents: [...byCategory].filter(([c]) => ctx.bucketOf.get(c) === b.id).reduce((s, [, v]) => s + v, 0),
      }));
      const spendingTotal = byBucket.filter((b) => !b.isSaving).reduce((s, b) => s + b.amountCents, 0);

      const ranked = [...byCategory]
        .filter(([c, v]) => v !== 0 && ctx.bucketOf.get(c) && ctx.bucketOf.get(c) !== ctx.fireId)
        .sort((a, b) => b[1] - a[1]);
      const top = ranked.slice(0, TOP_CATEGORIES).map(([id, v]) => {
        const c = ctx.categories.find((x) => x.id === id)!;
        return { categoryId: id as string | null, name: c.name, bucketKey: ctx.buckets.find((b) => b.id === c.bucketId)?.key ?? null, amountCents: v };
      });
      const rest = ranked.slice(TOP_CATEGORIES).reduce((s, [, v]) => s + v, 0);
      if (rest !== 0) top.push({ categoryId: null, name: 'Other', bucketKey: null, amountCents: rest });

      const months = monthsBetween(q.from, q.to).map((month) => {
        const m = calculateCategorySpending(rows.filter((r) => r.month === month), { includeSinkingFundPayments: true });
        const perBucket = Object.fromEntries(ctx.buckets.map((b) => [b.key, [...m].filter(([c]) => ctx.bucketOf.get(c) === b.id).reduce((s, [, v]) => s + v, 0)]));
        const total = ctx.buckets.filter((b) => b.id !== ctx.fireId).reduce((s, b) => s + (perBucket[b.key] ?? 0), 0);
        return { month, totalCents: total, byBucket: perBucket };
      });

      return { from: q.from, to: q.to, totalCents: spendingTotal, byBucket, byCategory: top, monthly: months };
    },

    /** Income vs spending each month, with the savings rate = (income − spending) ÷ income (spec §12). */
    async incomeVsExpenses(householdId: string, q: { from: string; to: string } & ReportFilters) {
      checkRange(q.from, q.to);
      const ctx = await context(householdId);
      const rows = await monthlySpendingRows(db, householdId, dateIn(q.from), dateIn(q.to), { accountId: q.accountId });
      const monthly = monthsBetween(q.from, q.to).map((month) => {
        const mr = rows.filter((r) => r.month === month);
        const spend = calculateCategorySpending(mr, { includeSinkingFundPayments: true });
        let spending = 0;
        let saved = 0;
        for (const [c, v] of spend) {
          if (ctx.bucketOf.get(c) === ctx.fireId) saved += v;
          else if (ctx.bucketOf.get(c)) spending += v;
        }
        const income = calculateIncomeTotal(mr);
        return { month, incomeCents: income, spendingCents: spending, savedCents: saved, netCents: income - spending, savingsRate: calculateSavingsRate(income, spending) };
      });
      const income = monthly.reduce((s, m) => s + m.incomeCents, 0);
      const spending = monthly.reduce((s, m) => s + m.spendingCents, 0);
      const saved = monthly.reduce((s, m) => s + m.savedCents, 0);
      return { from: q.from, to: q.to, monthly, totals: { incomeCents: income, spendingCents: spending, savedCents: saved, netCents: income - spending, savingsRate: calculateSavingsRate(income, spending) } };
    },

    /** Budget vs actual for one period, by category or by bucket (spec §12). */
    async budgetVsActual(householdId: string, q: { period?: string; groupBy: 'category' | 'bucket'; budgetId?: string }) {
      const budget = await services.budgets.ensureActive(householdId);
      const s = q.budgetId ? await services.budgets.summary(householdId, q.budgetId, { date: q.period }) : await services.budgets.summary(householdId, budget.id, { date: q.period });
      const rows =
        q.groupBy === 'bucket'
          ? s.buckets.map((b) => ({ id: b.bucketId, name: b.name, bucketKey: b.key, budgetCents: b.budgetCents, actualCents: b.actualCents, remainingCents: b.remainingCents, percentUsed: b.percentUsed, status: b.status }))
          : s.buckets.flatMap((b) =>
              b.groups.flatMap((g) =>
                g.lines.map((l) => ({ id: l.sinkingFundId ?? l.categoryId, name: l.name, bucketKey: b.key, budgetCents: l.budgetCents, actualCents: l.actualCents, remainingCents: l.remainingCents, percentUsed: l.percentUsed, status: l.status })),
              ),
            );
      return { period: s.period, groupBy: q.groupBy, rows, total: s.total };
    },

    /** Assets, liabilities and net worth at each month end, plus today's breakdown (spec §12). */
    async netWorth(householdId: string, q: { from: string; to: string }) {
      checkRange(q.from, q.to);
      const today = await services.netWorth.today(householdId);
      const [series, breakdown, snapshots] = await Promise.all([
        services.netWorth.series(householdId, q.from, q.to),
        services.netWorth.at(householdId, q.to < today ? q.to : today),
        services.netWorth.snapshots(householdId),
      ]);
      return { from: q.from, to: q.to, series, breakdown, snapshots };
    },

    /** Each debt's actual balance at month ends, then its projected payoff (spec §12). */
    async debtReduction(householdId: string, q: { months: number }) {
      const ctx = await context(householdId);
      const debts = await services.debts.list(householdId);
      const accounts = await listAccounts(db, householdId, { includeClosed: true });
      const historyMonths = monthsBetween(formatDateOnly(parseDateOnly(ctx.today).year - Math.ceil(q.months / 12), parseDateOnly(ctx.today).month, 1), ctx.today).slice(-q.months);
      return Promise.all(
        debts.map(async (d) => {
          const account = accounts.find((a) => a.id === d.accountId)!;
          const history = await Promise.all(
            historyMonths.map(async (m) => {
              const date = monthEnd(m) < ctx.today ? monthEnd(m) : ctx.today;
              const b = await services.accounts.balancesFor(householdId, [account], dateIn(date));
              return { date, balanceCents: Math.max(0, b.get(account.id) ?? 0) };
            }),
          );
          const payoff = await services.debts.payoff(householdId, d.id);
          // One point per month from the projection: the last closing balance in each month.
          const byMonth = new Map<string, { date: string; balanceCents: number }>();
          for (const p of payoff.withExtra.schedule) byMonth.set(p.date.slice(0, 7), { date: p.date, balanceCents: p.closingCents });
          return {
            debtId: d.id,
            name: d.accountName,
            history,
            projection: [{ date: ctx.today, balanceCents: d.currentBalanceCents }, ...byMonth.values()],
            payoffDate: payoff.withExtra.payoffDate,
            warning: payoff.withExtra.warning,
          };
        }),
      );
    },

    /**
     * Forecast for the next 1–12 months (spec §12). Per category: scheduled
     * occurrences + the average of its non-scheduled spending over completed
     * months only. Also projected income and each account's month-end balance.
     * All figures are estimates.
     */
    async forecast(householdId: string, q: { months: number; method?: ForecastMethod }) {
      const ctx = await context(householdId);
      const method = q.method ?? ctx.household.forecastMethod;
      const thisMonth = ctx.today.slice(0, 7);
      const lastCompleted = addMonthsKey(thisMonth, -1);
      const earliest = await earliestTransactionDate(db, householdId);
      const firstMonth = earliest ? dateOut(earliest).slice(0, 7) : thisMonth;
      const historyStart = [addMonthsKey(thisMonth, -12), firstMonth].sort().at(-1)!;
      const history = historyStart <= lastCompleted ? monthsBetween(monthStart(historyStart), monthEnd(lastCompleted)) : [];
      const future = Array.from({ length: q.months }, (_, i) => addMonthsKey(thisMonth, i + 1));

      // Past transactions a schedule accounts for — linked to it, or looking just like it (history from
      // before the schedule existed) — are left out of the averages, so recurring items are never counted twice.
      const schedulesForMatch = (await listRecurring(db, householdId)).map((r) => ({
        type: r.type,
        accountId: r.accountId,
        toAccountId: r.toAccountId,
        categoryId: r.categoryId,
        amountCents: cents(r.amountCents),
        amountKind: r.amountKind,
      }));
      const past = history.length ? await historyTransactions(db, householdId, dateIn(monthStart(history[0]!)), dateIn(monthEnd(history.at(-1)!))) : [];
      const unscheduledTx = past.filter(
        (t) => !t.linked && !schedulesForMatch.some((sch) => scheduleExplains(sch, { ...t, categoryIds: t.splits.map((x) => x.categoryId) })),
      );
      const splitRowsOf = (m: string) =>
        unscheduledTx
          .filter((t) => t.month === m && t.inBudget)
          .flatMap((t) => t.splits.map((x) => ({ categoryId: x.categoryId, amountCents: x.amountCents, transactionType: t.type, isSinkingFundPayment: x.isSinkingFundPayment })));
      const spendByMonth = history.map((m) => calculateCategorySpending(splitRowsOf(m), { includeSinkingFundPayments: true }));
      const incomeByMonth = history.map((m) => calculateIncomeTotal(splitRowsOf(m)));

      // Scheduled occurrences per category and month (unposted and posted alike: the plan for those months).
      const schedules = await listRecurring(db, householdId);
      const systemCat = (key: string) => ctx.categories.find((c) => c.systemKey === key)?.id ?? null;
      const debts = await db.debt.findMany({ where: { householdId }, include: { account: { select: { type: true } } } });
      const scheduledCategory = (r: (typeof schedules)[number]) => {
        if (r.categoryId) return r.categoryId;
        if (r.type === 'SAVINGS_CONTRIBUTION') return systemCat(SYSTEM_CATEGORY.savingsContributions);
        if (r.type === 'DEBT_REPAYMENT') {
          const d = debts.find((x) => x.accountId === r.toAccountId);
          if (d?.categoryId) return d.categoryId;
          const t = r.toAccount?.class === 'LIABILITY' ? accounts.find((a) => a.id === r.toAccountId)?.type : null;
          return systemCat(t === 'MORTGAGE' ? SYSTEM_CATEGORY.mortgage : t === 'CREDIT_CARD' ? SYSTEM_CATEGORY.creditCardRepayments : SYSTEM_CATEGORY.loanRepayments);
        }
        return null;
      };
      const accounts = await listAccounts(db, householdId);
      const rangeFrom = monthStart(future[0]!);
      const rangeTo = monthEnd(future.at(-1)!);
      const scheduled = new Map<string, number[]>(); // categoryId → per future month
      const scheduledIncome = future.map(() => 0);
      const accountScheduled = new Map<string, number[]>();
      const posted = await postedOccurrences(db, householdId, schedules.map((s) => s.id));
      for (const r of schedules) {
        const repaymentTreatment = r.toAccount?.repaymentTreatment;
        // Account projections include what is still to come this month, including anything due today and not yet recorded.
        for (const o of generateOccurrences(specOf(r), ctx.today, rangeTo, exceptionsOf(r))) {
          if (o.skipped || posted.has(`${r.id}|${o.occurrenceDate}`)) continue;
          const idx = Math.max(0, future.indexOf(o.date.slice(0, 7)));
          const from = accounts.find((a) => a.id === r.accountId);
          const to = r.toAccountId ? accounts.find((a) => a.id === r.toAccountId) : undefined;
          if (from) {
            const list = accountScheduled.get(from.id) ?? future.map(() => 0);
            list[idx]! += balanceEffect({ type: r.type, amountCents: o.amountCents, role: 'from' }, from.class);
            accountScheduled.set(from.id, list);
          }
          if (to) {
            const list = accountScheduled.get(to.id) ?? future.map(() => 0);
            list[idx]! += balanceEffect({ type: r.type, amountCents: o.amountCents, role: 'to' }, to.class);
            accountScheduled.set(to.id, list);
          }
          if (o.date < rangeFrom) continue;
          if (r.type === 'INCOME') {
            scheduledIncome[idx]! += o.amountCents;
            continue;
          }
          if (r.type === 'DEBT_REPAYMENT' && repaymentTreatment !== 'DEBT_REPAYMENT') continue; // card repayments are transfers
          const cat = scheduledCategory(r);
          if (!cat) continue;
          const list = scheduled.get(cat) ?? future.map(() => 0);
          list[idx]! += o.amountCents;
          scheduled.set(cat, list);
        }
      }

      const leaves = ctx.categories.filter((c) => !c.isGroup && c.kind === 'EXPENSE' && c.bucketId);
      let limitedHistory = history.length < (method === 'AVG6' ? 6 : method === 'AVG12' ? 12 : method === 'AVG3' ? 3 : 0);
      const categories = leaves
        .map((c) => {
          const m = c.forecastMethod ?? method;
          const f = forecastCategory({
            completedMonths: spendByMonth.map((s) => s.get(c.id) ?? 0),
            method: m,
            manualCents: c.forecastManualCents === null ? null : cents(c.forecastManualCents),
            scheduledByMonth: scheduled.get(c.id) ?? future.map(() => 0),
          });
          if (f.limitedHistory && f.months.some((v) => v !== 0)) limitedHistory = true;
          return { categoryId: c.id, name: c.name, bucketId: c.bucketId!, method: m, ...f };
        })
        .filter((c) => c.months.some((v) => v !== 0));

      const buckets = ctx.buckets.map((b) => ({
        bucketId: b.id,
        key: b.key,
        name: b.name,
        colour: b.colour,
        months: future.map((_, i) => categories.filter((c) => c.bucketId === b.id).reduce((s, c) => s + c.months[i]!, 0)),
      }));
      const spending = future.map((_, i) => buckets.filter((b) => b.bucketId !== ctx.fireId).reduce((s, b) => s + b.months[i]!, 0));
      const saving = future.map((_, i) => buckets.find((b) => b.bucketId === ctx.fireId)!.months[i]!);
      const incomeWindow = method === 'MANUAL' ? 3 : method === 'AVG6' ? 6 : method === 'AVG12' ? 12 : 3;
      const unscheduledIncome = averageCents(incomeByMonth.slice(-incomeWindow));
      const income = scheduledIncome.map((s) => s + unscheduledIncome);

      // Accounts: today's balance + scheduled movements + each account's average unscheduled monthly change.
      const moves = unscheduledTx.flatMap((t) => [
        { month: t.month, accountId: t.accountId, movement: { type: t.type, direction: t.direction, amountCents: t.amountCents, role: 'from' as const } },
        ...(t.toAccountId ? [{ month: t.month, accountId: t.toAccountId, movement: { type: t.type, direction: null, amountCents: t.amountCents, role: 'to' as const } }] : []),
      ]);
      const balances = await services.accounts.balancesFor(householdId, accounts);
      const accountsOut = accounts
        .filter((a) => a.includeInBudget || a.includeInNetWorth)
        .map((a) => {
          const perMonth = history.map((m) => moves.filter((x) => x.accountId === a.id && x.month === m).reduce((s, x) => s + balanceEffect(x.movement, a.class), 0));
          const avg = averageCents(perMonth.slice(-incomeWindow));
          const sched = accountScheduled.get(a.id) ?? future.map(() => 0);
          return {
            accountId: a.id,
            name: a.name,
            class: a.class,
            currentCents: balances.get(a.id) ?? 0,
            monthEndCents: projectBalances(balances.get(a.id) ?? 0, future.map((_, i) => sched[i]! + avg)),
          };
        });

      return {
        method,
        months: future,
        historyMonths: history.length,
        limitedHistory,
        categories: categories.map(({ categoryId, name, bucketId, method: m, months, baseCents, limitedHistory: l }) => ({ categoryId, name, bucketId, method: m, baseCents, months, limitedHistory: l })),
        buckets,
        totals: future.map((month, i) => ({ month, incomeCents: income[i]!, spendingCents: spending[i]!, savingCents: saving[i]!, netCents: income[i]! - spending[i]! - saving[i]! })),
        accounts: accountsOut,
      };
    },

    /**
     * Calendar items (spec §12): every schedule's occurrences (posted ones link
     * to their transaction), sinking fund due dates and goal target dates.
     */
    async calendar(householdId: string, q: { from: string; to: string }) {
      if (q.from > q.to) throw validationError('"from" must be on or before "to"', { field: 'from' });
      if (diffDays(q.to, q.from) > 100) throw validationError('Choose a range of at most 100 days', { field: 'to' });
      const ctx = await context(householdId);
      const [occurrences, funds, goals] = await Promise.all([
        services.recurring.occurrences(householdId, q),
        services.sinkingFunds.list(householdId),
        services.goals.list(householdId),
      ]);
      const colourOf = (key: string | null) => ctx.buckets.find((b) => b.key === key)?.colour ?? null;
      return [
        ...occurrences.map((o) => ({ kind: 'occurrence' as const, id: `${o.recurringId}|${o.occurrenceDate}`, date: o.date, title: o.name, amountCents: o.amountCents, type: o.type, bucketKey: o.bucketKey, colour: colourOf(o.bucketKey), status: o.status, occurrence: o })),
        ...funds
          .filter((f) => f.dueDate >= q.from && f.dueDate <= q.to)
          .map((f) => ({ kind: 'sinking_fund' as const, id: f.id, date: f.dueDate, title: `${f.name} due`, amountCents: f.targetCents, type: null, bucketKey: f.bucketKey, colour: colourOf(f.bucketKey), status: f.status, occurrence: null })),
        ...goals
          .filter((g) => g.targetDate && g.targetDate >= q.from && g.targetDate <= q.to)
          .map((g) => ({ kind: 'goal' as const, id: g.id, date: g.targetDate!, title: `${g.name} target`, amountCents: g.targetCents, type: null, bucketKey: 'FIRE_EXTINGUISHER', colour: colourOf('FIRE_EXTINGUISHER'), status: g.reached ? 'reached' : g.onTrack === false ? 'behind' : 'on_track', occurrence: null })),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
