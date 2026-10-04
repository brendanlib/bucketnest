import { Dec, roundToCents, type Cents, MoneyError } from './money.js';
import type { Decimal } from 'decimal.js';

export type Frequency =
  | 'WEEKLY'
  | 'FORTNIGHTLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SIX_MONTHLY'
  | 'ANNUALLY'
  | 'EVERY_N_DAYS'
  | 'EVERY_N_WEEKS'
  | 'EVERY_N_MONTHS';

export type BudgetPeriodType = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'ANNUAL';

export interface FrequencySpec {
  frequency: Frequency;
  /** N for the EVERY_N_* frequencies. */
  interval?: number | null;
}

const FIXED_TIMES: Partial<Record<Frequency, number>> = {
  WEEKLY: 52,
  FORTNIGHTLY: 26,
  MONTHLY: 12,
  QUARTERLY: 4,
  SIX_MONTHLY: 2,
  ANNUALLY: 1,
};

/** Every N days / weeks / months: 365 ÷ N, 52 ÷ N, 12 ÷ N. */
const CUSTOM_BASE: Record<string, number> = { EVERY_N_DAYS: 365, EVERY_N_WEEKS: 52, EVERY_N_MONTHS: 12 };

/** Times per year (spec §3.2). Custom frequencies are exact fractions, e.g. 365 ÷ N. */
export function timesPerYear(spec: FrequencySpec): Decimal {
  const fixed = FIXED_TIMES[spec.frequency];
  if (fixed !== undefined) return new Dec(fixed);
  const base = CUSTOM_BASE[spec.frequency];
  if (base === undefined) throw new MoneyError(`Unknown frequency ${spec.frequency as string}`);
  const n = spec.interval;
  if (n === undefined || n === null || !Number.isInteger(n) || n < 1) {
    throw new MoneyError(`${spec.frequency} needs a whole-number interval of at least 1`);
  }
  return new Dec(base).dividedBy(n);
}

export function periodTypeToFrequency(period: BudgetPeriodType): FrequencySpec {
  return { frequency: period === 'ANNUAL' ? 'ANNUALLY' : period };
}

/** Converts an amount at one frequency to the annual figure, rounded to the cent. */
export function toAnnual(amount: Cents, from: FrequencySpec): Cents {
  return roundToCents(new Dec(amount).times(timesPerYear(from)));
}

/** Converts an annual amount to a per-occurrence amount at the target frequency. */
export function fromAnnual(annual: Cents, to: FrequencySpec): Cents {
  return roundToCents(new Dec(annual).dividedBy(timesPerYear(to)));
}

/**
 * Converts between any two frequencies through the annual figure, rounding once
 * at the end so no precision is lost on the way. $3,500 fortnightly → $7,583.33 monthly.
 */
export function convertFrequency(amount: Cents, from: FrequencySpec, to: FrequencySpec): Cents {
  return roundToCents(new Dec(amount).times(timesPerYear(from)).dividedBy(timesPerYear(to)));
}

export interface NormalisedAmounts {
  weekly: Cents;
  fortnightly: Cents;
  monthly: Cents;
  annual: Cents;
}

export function normalise(amount: Cents, from: FrequencySpec): NormalisedAmounts {
  return {
    weekly: convertFrequency(amount, from, { frequency: 'WEEKLY' }),
    fortnightly: convertFrequency(amount, from, { frequency: 'FORTNIGHTLY' }),
    monthly: convertFrequency(amount, from, { frequency: 'MONTHLY' }),
    annual: convertFrequency(amount, from, { frequency: 'ANNUALLY' }),
  };
}

export interface IncomeSource extends FrequencySpec {
  amountCents: Cents;
}

/** Total of several income sources, each converted exactly before a single rounding. */
function totalAt(sources: IncomeSource[], to: FrequencySpec): Cents {
  const target = timesPerYear(to);
  const total = sources.reduce(
    (acc, s) => acc.plus(new Dec(s.amountCents).times(timesPerYear(s)).dividedBy(target)),
    new Dec(0),
  );
  return roundToCents(total);
}

export function calculateAnnualIncome(sources: IncomeSource[]): Cents {
  return totalAt(sources, { frequency: 'ANNUALLY' });
}

export function calculateMonthlyIncome(sources: IncomeSource[]): Cents {
  return totalAt(sources, { frequency: 'MONTHLY' });
}

export function calculateIncomeAt(sources: IncomeSource[], to: FrequencySpec): Cents {
  return totalAt(sources, to);
}
