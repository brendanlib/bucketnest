/**
 * Date-only helpers. Dates are 'YYYY-MM-DD' strings and all arithmetic runs on
 * UTC calendar days, so results never depend on the server's time zone.
 */
export type DateOnly = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isValidDateOnly(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseDateOnly(value: DateOnly): { year: number; month: number; day: number } {
  if (!isValidDateOnly(value)) throw new RangeError(`Invalid date: ${value}`);
  const m = DATE_RE.exec(value)!;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function formatDateOnly(year: number, month: number, day: number): DateOnly {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** Days since 1970-01-01 for a date-only value. */
export function toDayNumber(value: DateOnly): number {
  const { year, month, day } = parseDateOnly(value);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function fromDayNumber(dayNumber: number): DateOnly {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(value: DateOnly, days: number): DateOnly {
  return fromDayNumber(toDayNumber(value) + days);
}

export function diffDays(later: DateOnly, earlier: DateOnly): number {
  return toDayNumber(later) - toDayNumber(earlier);
}

/**
 * Adds months keeping the anchor day and clamping at month end:
 * anchor day 31 → 28/29 Feb → 31 Mar. Never drifts.
 */
export function addMonthsClamped(value: DateOnly, months: number, anchorDay?: number): DateOnly {
  const { year, month, day } = parseDateOnly(value);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return formatDateOnly(y, m, Math.min(anchorDay ?? day, daysInMonth(y, m)));
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(value: DateOnly): number {
  const dow = new Date(toDayNumber(value) * MS_PER_DAY).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function compareDates(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: DateOnly, b: DateOnly): DateOnly {
  return a <= b ? a : b;
}

export function maxDate(a: DateOnly, b: DateOnly): DateOnly {
  return a >= b ? a : b;
}

/** The calendar date at `instant` in an IANA time zone. */
export function dateInTimeZone(instant: Date, timeZone: string): DateOnly {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Hour (0–23) at `instant` in a time zone. */
export function hourInTimeZone(instant: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(instant);
  return Number(h);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Converts a Prisma @db.Date value (UTC midnight) to a date-only string. */
export function dateOnlyFromDb(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

/** Converts a date-only string to the UTC-midnight Date Prisma expects for @db.Date. */
export function dateOnlyToDb(value: DateOnly): Date {
  parseDateOnly(value);
  return new Date(`${value}T00:00:00.000Z`);
}
