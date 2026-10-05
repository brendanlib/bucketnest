import { Dec, roundToCents, percentage, type Cents, assertCents } from './money.js';
import { diffDays, parseDateOnly, addMonthsClamped, formatDateOnly, type DateOnly } from './dates.js';
import { nominalSequence, stepBack, type ScheduleSpec } from './recurrence.js';
import type { Frequency } from './frequency.js';
import type { Decimal } from 'decimal.js';

export const MAX_PERIODS = 600;

export interface DebtPeriod {
  date: DateOnly;
  openingCents: Cents;
  interestCents: Cents;
  paymentCents: Cents;
  principalCents: Cents;
  closingCents: Cents;
}

export interface PayoffResult {
  paidOff: boolean;
  /** 'REPAYMENT_TOO_LOW': never paid off at this repayment. 'NOT_WITHIN_LIMIT': still owing after 600 periods. */
  warning: 'REPAYMENT_TOO_LOW' | 'NOT_WITHIN_LIMIT' | null;
  payoffDate: DateOnly | null;
  totalInterestCents: Cents;
  repayments: number;
  nextInterestCents: Cents;
  schedule: DebtPeriod[];
}

export interface DebtInput {
  balanceCents: Cents;
  /** Annual percentage, e.g. "6.25". For HECS/HELP the indexation rate. */
  annualRate: Decimal.Value;
  repaymentCents: Cents;
  frequency: Frequency;
  interval?: number | null;
  /** A date in the repayment pattern (e.g. the due day this month). */
  anchorDate: DateOnly;
  /** Projections start here. */
  today: DateOnly;
  /** Linked offset balances, held constant. Interest is charged on balance − offset, floored at 0. */
  offsetCents?: Cents;
  /** HECS/HELP: no interest; the balance is indexed once a year on 1 June. */
  indexationOnly?: boolean;
  maxPeriods?: number;
}

const containsJune1 = (start: DateOnly, end: DateOnly) => {
  // (start, end]: does 1 June fall in this period?
  const s = parseDateOnly(start);
  for (let y = s.year; y <= parseDateOnly(end).year; y++) {
    const d = formatDateOnly(y, 6, 1);
    if (d > start && d <= end) return true;
  }
  return false;
};

/**
 * Simulates repayments period by period (spec §10). Interest for a period =
 * (balance − offsets, floored at 0) × annual rate × days in period ÷ 365,
 * rounded to the cent each period, as a lender charges it. Results are estimates.
 */
export function simulateDebtPayoff(input: DebtInput): PayoffResult {
  assertCents(input.balanceCents, 'balance');
  assertCents(input.repaymentCents, 'repayment');
  const max = input.maxPeriods ?? MAX_PERIODS;
  const rate = new Dec(input.annualRate).dividedBy(100);
  const offset = input.offsetCents ?? 0;
  const spec: ScheduleSpec = { frequency: input.frequency, interval: input.interval, startDate: input.anchorDate, amountCents: 0 };
  // A future anchor is simply the first repayment; its period starts one step earlier.
  const seq = nominalSequence(spec, input.today, max);
  let previous = seq.previous ?? stepBack(spec, seq.dates[0] ?? input.today);

  const schedule: DebtPeriod[] = [];
  let balance = input.balanceCents;
  let totalInterest = 0;
  if (balance <= 0) return { paidOff: true, warning: null, payoffDate: input.today, totalInterestCents: 0, repayments: 0, nextInterestCents: 0, schedule };

  for (const date of seq.dates) {
    const days = diffDays(date, previous);
    const interest = input.indexationOnly
      ? containsJune1(previous, date)
        ? roundToCents(new Dec(balance).times(rate))
        : 0
      : roundToCents(new Dec(Math.max(0, balance - offset)).times(rate).times(days).dividedBy(365));
    if (!input.indexationOnly && schedule.length === 0 && input.repaymentCents <= interest) {
      return {
        paidOff: false,
        warning: 'REPAYMENT_TOO_LOW',
        payoffDate: null,
        totalInterestCents: 0,
        repayments: 0,
        nextInterestCents: interest,
        schedule: [{ date, openingCents: balance, interestCents: interest, paymentCents: input.repaymentCents, principalCents: input.repaymentCents - interest, closingCents: balance + interest - input.repaymentCents }],
      };
    }
    const payment = Math.min(input.repaymentCents, balance + interest);
    const closing = balance + interest - payment;
    schedule.push({ date, openingCents: balance, interestCents: interest, paymentCents: payment, principalCents: payment - interest, closingCents: closing });
    totalInterest += interest;
    balance = closing;
    previous = date;
    if (balance === 0) break;
  }

  const paidOff = balance === 0;
  // Indexed debts can grow faster than they are repaid.
  const growing = input.indexationOnly && !paidOff && schedule.length >= 2 && schedule[schedule.length - 1]!.closingCents >= input.balanceCents;
  return {
    paidOff,
    warning: paidOff ? null : growing ? 'REPAYMENT_TOO_LOW' : 'NOT_WITHIN_LIMIT',
    payoffDate: paidOff ? schedule[schedule.length - 1]!.date : null,
    totalInterestCents: totalInterest,
    repayments: schedule.length,
    nextInterestCents: schedule[0]?.interestCents ?? 0,
    schedule,
  };
}

/** Whole months between two dates (rounded to the nearest month). */
export function monthsBetween(earlier: DateOnly, later: DateOnly): number {
  return Math.round(diffDays(later, earlier) / (365 / 12));
}

/** Minimum-only against minimum + extra (spec §10): time and interest saved. */
export function compareExtraRepayment(input: DebtInput, extraCents: Cents): {
  minimum: PayoffResult;
  withExtra: PayoffResult;
  extraCents: Cents;
  monthsSaved: number | null;
  interestSavedCents: Cents | null;
} {
  const minimum = simulateDebtPayoff(input);
  const withExtra = simulateDebtPayoff({ ...input, repaymentCents: input.repaymentCents + extraCents });
  const comparable = minimum.paidOff && withExtra.paidOff;
  return {
    minimum,
    withExtra,
    extraCents,
    monthsSaved: comparable ? monthsBetween(withExtra.payoffDate!, minimum.payoffDate!) : null,
    interestSavedCents: comparable ? minimum.totalInterestCents - withExtra.totalInterestCents : null,
  };
}

/** How much of the original debt has been repaid. */
export function calculateDebtProgress(originalCents: Cents, currentCents: Cents): { repaidCents: Cents; percentRepaid: number | null } {
  const repaid = Math.max(0, originalCents - currentCents);
  return { repaidCents: repaid, percentRepaid: percentage(repaid, originalCents) };
}

export interface PlanDebt {
  id: string;
  balanceCents: Cents;
  annualRate: Decimal.Value;
  /** Minimum repayment normalised to a month. */
  minimumMonthlyCents: Cents;
  offsetCents?: Cents;
}

export interface PlanResult {
  strategy: 'SNOWBALL' | 'AVALANCHE';
  order: string[];
  debtFreeDate: DateOnly | null;
  totalInterestCents: Cents;
  months: number;
  debts: { id: string; payoffDate: DateOnly | null; interestCents: Cents }[];
  /** Total owed at the end of each month, for a chart. */
  timeline: { date: DateOnly; balanceCents: Cents }[];
}

/**
 * Payoff order across debts, simulated monthly (spec §10). Every debt gets its
 * minimum; the extra goes to the target debt — smallest balance first
 * (snowball, the Barefoot "domino") or highest rate first (avalanche). When a
 * debt is cleared, its repayment rolls into the next.
 */
export function simulatePayoffPlan(debts: PlanDebt[], strategy: 'SNOWBALL' | 'AVALANCHE', extraMonthlyCents: Cents, today: DateOnly): PlanResult {
  const order = [...debts]
    .sort((a, b) =>
      strategy === 'SNOWBALL'
        ? a.balanceCents - b.balanceCents || a.id.localeCompare(b.id)
        : new Dec(b.annualRate).comparedTo(a.annualRate) || a.balanceCents - b.balanceCents || a.id.localeCompare(b.id),
    )
    .map((d) => d.id);
  const state = new Map(debts.map((d) => [d.id, { ...d, balance: d.balanceCents, interest: 0, payoff: d.balanceCents <= 0 ? today : (null as DateOnly | null) }]));
  const budget = debts.reduce((s, d) => s + d.minimumMonthlyCents, 0) + extraMonthlyCents;
  const timeline: { date: DateOnly; balanceCents: Cents }[] = [];
  let previous = today;
  let months = 0;
  const t = parseDateOnly(today);

  for (let m = 1; m <= MAX_PERIODS; m++) {
    const live = [...state.values()].filter((d) => d.balance > 0);
    if (live.length === 0) break;
    const date = addMonthsClamped(today, m, t.day);
    const days = diffDays(date, previous);
    for (const d of live) {
      const interest = roundToCents(new Dec(Math.max(0, d.balance - (d.offsetCents ?? 0))).times(d.annualRate).dividedBy(100).times(days).dividedBy(365));
      d.balance += interest;
      d.interest += interest;
    }
    let pool = budget;
    for (const d of live) {
      const pay = Math.min(d.minimumMonthlyCents, d.balance, pool);
      d.balance -= pay;
      pool -= pay;
    }
    for (const id of order) {
      if (pool <= 0) break;
      const d = state.get(id)!;
      if (d.balance <= 0) continue;
      const pay = Math.min(pool, d.balance);
      d.balance -= pay;
      pool -= pay;
    }
    for (const d of live) if (d.balance === 0 && !d.payoff) d.payoff = date;
    months = m;
    previous = date;
    timeline.push({ date, balanceCents: [...state.values()].reduce((s, d) => s + d.balance, 0) });
  }
  const all = [...state.values()];
  const free = all.every((d) => d.balance === 0);
  return {
    strategy,
    order,
    debtFreeDate: free ? all.reduce<DateOnly>((max, d) => (d.payoff! > max ? d.payoff! : max), today) : null,
    totalInterestCents: all.reduce((s, d) => s + d.interest, 0),
    months,
    debts: debts.map((d) => ({ id: d.id, payoffDate: state.get(d.id)!.payoff, interestCents: state.get(d.id)!.interest })),
    timeline,
  };
}

