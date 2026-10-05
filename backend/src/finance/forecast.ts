import { Dec, roundToCents, type Cents } from './money.js';

export type ForecastMethod = 'AVG3' | 'AVG6' | 'AVG12' | 'MANUAL';

export const windowOf = (method: Exclude<ForecastMethod, 'MANUAL'>): number => (method === 'AVG3' ? 3 : method === 'AVG6' ? 6 : 12);

/** Average of whole-cent values, rounded half away from zero. 0 for no values. */
export function averageCents(values: Cents[]): Cents {
  if (values.length === 0) return 0;
  return roundToCents(values.reduce((acc, v) => acc.plus(v), new Dec(0)).dividedBy(values.length));
}

export interface CategoryForecastInput {
  /**
   * Totals for completed months only (never the current partial month), oldest
   * first, excluding transactions that came from schedules.
   */
  completedMonths: Cents[];
  method: ForecastMethod;
  manualCents?: Cents | null;
  /** Scheduled occurrences falling in each forecast month. */
  scheduledByMonth: Cents[];
}

export interface CategoryForecast {
  /** The unscheduled part of each month: an average of history, or the manual amount. */
  baseCents: Cents;
  months: Cents[];
  monthsUsed: number;
  /** Fewer completed months than the window: the average covers what there is. */
  limitedHistory: boolean;
}

/**
 * Forecast for one category (spec §12): scheduled occurrences + the average of
 * its non-scheduled transactions, so recurring items are never counted twice.
 */
export function forecastCategory(input: CategoryForecastInput): CategoryForecast {
  if (input.method === 'MANUAL') {
    const base = input.manualCents ?? 0;
    return { baseCents: base, months: input.scheduledByMonth.map((s) => base + s), monthsUsed: 0, limitedHistory: false };
  }
  const window = windowOf(input.method);
  const used = input.completedMonths.slice(-window);
  const base = averageCents(used);
  return { baseCents: base, months: input.scheduledByMonth.map((s) => base + s), monthsUsed: used.length, limitedHistory: used.length < window };
}

/** Projected month-end balances from a starting balance and each month's net change. */
export function projectBalances(startCents: Cents, monthlyChangeCents: Cents[]): Cents[] {
  const out: Cents[] = [];
  let b = startCents;
  for (const c of monthlyChangeCents) {
    b += c;
    out.push(b);
  }
  return out;
}
