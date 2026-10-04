import type { Frequency } from './frequency.js';
import { addDays, addMonthsClamped, diffDays, isoWeekday, parseDateOnly, type DateOnly } from './dates.js';
import { type Cents } from './money.js';

export type WeekendRule = 'NONE' | 'PREVIOUS_BUSINESS_DAY' | 'NEXT_BUSINESS_DAY';

export interface ScheduleSpec {
  frequency: Frequency;
  interval?: number | null;
  startDate: DateOnly;
  endDate?: DateOnly | null;
  occurrenceCount?: number | null;
  weekendRule?: WeekendRule;
  amountCents: Cents;
}

export interface ScheduleException {
  occurrenceDate: DateOnly;
  action: 'SKIP' | 'EDIT';
  overrideAmountCents?: Cents | null;
  overrideDate?: DateOnly | null;
}

export interface Occurrence {
  /** The nominal date from the pattern; the identity used for posting and exceptions. */
  occurrenceDate: DateOnly;
  /** The date it actually falls on, after the weekend rule and any edit. */
  date: DateOnly;
  amountCents: Cents;
  skipped: boolean;
  edited: boolean;
}

export class RecurrenceError extends Error {}

type Step = { unit: 'day'; n: number } | { unit: 'month'; n: number };

function stepOf(spec: Pick<ScheduleSpec, 'frequency' | 'interval'>): Step {
  const n = spec.interval ?? 0;
  const needN = () => {
    if (!Number.isInteger(n) || n < 1) throw new RecurrenceError(`${spec.frequency} needs a whole-number interval of at least 1`);
    return n;
  };
  switch (spec.frequency) {
    case 'WEEKLY':
      return { unit: 'day', n: 7 };
    case 'FORTNIGHTLY':
      return { unit: 'day', n: 14 };
    case 'EVERY_N_DAYS':
      return { unit: 'day', n: needN() };
    case 'EVERY_N_WEEKS':
      return { unit: 'day', n: needN() * 7 };
    case 'MONTHLY':
      return { unit: 'month', n: 1 };
    case 'QUARTERLY':
      return { unit: 'month', n: 3 };
    case 'SIX_MONTHLY':
      return { unit: 'month', n: 6 };
    case 'ANNUALLY':
      return { unit: 'month', n: 12 };
    case 'EVERY_N_MONTHS':
      return { unit: 'month', n: needN() };
  }
}

/**
 * The k-th nominal date (k = 0 is the start). Monthly patterns keep the start
 * day and clamp at month end, so 31 Jan → 28/29 Feb → 31 Mar and never drift.
 */
function nth(spec: ScheduleSpec, step: Step, k: number): DateOnly {
  if (step.unit === 'day') return addDays(spec.startDate, k * step.n);
  return addMonthsClamped(spec.startDate, k * step.n, parseDateOnly(spec.startDate).day);
}

/** Smallest index whose nominal date is on or after `date`. */
function indexAtOrAfter(spec: ScheduleSpec, step: Step, date: DateOnly): number {
  if (date <= spec.startDate) return 0;
  if (step.unit === 'day') return Math.ceil(diffDays(date, spec.startDate) / step.n);
  const s = parseDateOnly(spec.startDate);
  const d = parseDateOnly(date);
  let k = Math.max(0, Math.floor((d.year * 12 + d.month - (s.year * 12 + s.month)) / step.n));
  while (nth(spec, step, k) < date) k++;
  while (k > 0 && nth(spec, step, k - 1) >= date) k--;
  return k;
}

/** Last valid index, or Infinity for open-ended schedules. */
function lastIndex(spec: ScheduleSpec, step: Step): number {
  let last = Number.POSITIVE_INFINITY;
  if (spec.occurrenceCount !== null && spec.occurrenceCount !== undefined) last = spec.occurrenceCount - 1;
  if (spec.endDate) {
    if (spec.endDate < spec.startDate) return -1;
    const k = indexAtOrAfter(spec, step, spec.endDate);
    last = Math.min(last, nth(spec, step, k) === spec.endDate ? k : k - 1);
  }
  return last;
}

export function validateSchedule(spec: ScheduleSpec): void {
  stepOf(spec);
  parseDateOnly(spec.startDate);
  if (spec.endDate && spec.endDate < spec.startDate) throw new RecurrenceError('The end date is before the start date');
  if (spec.occurrenceCount !== null && spec.occurrenceCount !== undefined && (!Number.isInteger(spec.occurrenceCount) || spec.occurrenceCount < 1)) {
    throw new RecurrenceError('The number of occurrences must be at least 1');
  }
}

/** Nominal dates in [from, to], before weekend rules and exceptions. */
export function nominalDatesBetween(spec: ScheduleSpec, from: DateOnly, to: DateOnly, limit = 10_000): DateOnly[] {
  const step = stepOf(spec);
  const last = lastIndex(spec, step);
  const out: DateOnly[] = [];
  for (let k = indexAtOrAfter(spec, step, from); k <= last; k++) {
    const d = nth(spec, step, k);
    if (d > to) break;
    out.push(d);
    if (out.length >= limit) throw new RecurrenceError('Too many occurrences in this range');
  }
  return out;
}

/** Whether `date` is a nominal occurrence date of the schedule. */
export function isOccurrenceDate(spec: ScheduleSpec, date: DateOnly): boolean {
  const step = stepOf(spec);
  const k = indexAtOrAfter(spec, step, date);
  return k <= lastIndex(spec, step) && nth(spec, step, k) === date;
}

/** Number of nominal occurrences strictly before `date`. */
export function countOccurrencesBefore(spec: ScheduleSpec, date: DateOnly): number {
  const step = stepOf(spec);
  return Math.min(indexAtOrAfter(spec, step, date), lastIndex(spec, step) + 1);
}

/** Moves a Saturday or Sunday to the previous Friday or the next Monday. Public holidays are out of scope. */
export function applyWeekendRule(date: DateOnly, rule: WeekendRule = 'NONE'): DateOnly {
  if (rule === 'NONE') return date;
  const dow = isoWeekday(date);
  if (dow < 6) return date;
  if (rule === 'PREVIOUS_BUSINESS_DAY') return addDays(date, dow === 6 ? -1 : -2);
  return addDays(date, dow === 6 ? 2 : 1);
}

/**
 * Projects a schedule's occurrences that fall in [from, to] (spec §8). Pure and
 * deterministic: nothing is stored. The weekend rule moves a date at most two
 * days, so the pattern is scanned with a margin; exceptions are applied last.
 * Skipped occurrences are returned flagged so callers can show or hide them.
 */
export function generateOccurrences(
  spec: ScheduleSpec,
  from: DateOnly,
  to: DateOnly,
  exceptions: ScheduleException[] = [],
): Occurrence[] {
  validateSchedule(spec);
  if (from > to) return [];
  const byDate = new Map(exceptions.map((e) => [e.occurrenceDate, e]));
  const nominals = new Set(nominalDatesBetween(spec, addDays(from, -3), addDays(to, 3)));
  // An edited occurrence can be moved into the range from anywhere.
  for (const e of exceptions) {
    if (e.action === 'EDIT' && e.overrideDate && e.overrideDate >= from && e.overrideDate <= to && isOccurrenceDate(spec, e.occurrenceDate)) {
      nominals.add(e.occurrenceDate);
    }
  }

  const out: Occurrence[] = [];
  for (const nominal of nominals) {
    const e = byDate.get(nominal);
    const edited = e?.action === 'EDIT';
    const date = edited && e.overrideDate ? e.overrideDate : applyWeekendRule(nominal, spec.weekendRule);
    if (date < from || date > to) continue;
    out.push({
      occurrenceDate: nominal,
      date,
      amountCents: edited && e.overrideAmountCents !== null && e.overrideAmountCents !== undefined ? e.overrideAmountCents : spec.amountCents,
      skipped: e?.action === 'SKIP',
      edited,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? (a.occurrenceDate < b.occurrenceDate ? -1 : 1) : a.date < b.date ? -1 : 1));
}

/** The first occurrence on or after `from` that is not skipped, looking up to `horizonDays` ahead. */
export function nextOccurrence(
  spec: ScheduleSpec,
  from: DateOnly,
  exceptions: ScheduleException[] = [],
  isPosted: (occurrenceDate: DateOnly) => boolean = () => false,
  horizonDays = 800,
): Occurrence | null {
  const list = generateOccurrences(spec, from, addDays(from, horizonDays), exceptions);
  return list.find((o) => !o.skipped && !isPosted(o.occurrenceDate)) ?? null;
}
