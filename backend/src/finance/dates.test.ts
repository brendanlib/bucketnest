import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  compareDates,
  dateInTimeZone,
  dateOnlyFromDb,
  dateOnlyToDb,
  daysInMonth,
  diffDays,
  fromDayNumber,
  hourInTimeZone,
  isLeapYear,
  isoWeekday,
  isValidDateOnly,
  isValidTimeZone,
  maxDate,
  minDate,
  parseDateOnly,
  toDayNumber,
} from './dates.js';

describe('date-only helpers', () => {
  it('validates dates', () => {
    expect(isValidDateOnly('2028-02-29')).toBe(true);
    expect(isValidDateOnly('2027-02-29')).toBe(false);
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('2026-1-01')).toBe(false);
    expect(() => parseDateOnly('nope')).toThrow(RangeError);
  });

  it('knows leap years and month lengths', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2028)).toBe(true);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(diffDays('2027-01-01', '2026-01-01')).toBe(365);
    expect(fromDayNumber(toDayNumber('2026-10-04'))).toBe('2026-10-04');
  });

  it('adds months clamped to month end without drifting', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonthsClamped('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonthsClamped('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonthsClamped('2028-02-29', 12)).toBe('2029-02-28');
  });

  it('gives ISO weekdays', () => {
    expect(isoWeekday('2026-10-05')).toBe(1); // Monday
    expect(isoWeekday('2026-10-04')).toBe(7); // Sunday
  });

  it('compares dates', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
    expect(minDate('2026-01-01', '2025-01-01')).toBe('2025-01-01');
    expect(maxDate('2026-01-01', '2025-01-01')).toBe('2026-01-01');
  });

  it('finds the calendar date in a time zone regardless of server TZ', () => {
    const instant = new Date('2026-10-04T14:30:00Z');
    expect(dateInTimeZone(instant, 'Australia/Melbourne')).toBe('2026-10-05');
    expect(dateInTimeZone(instant, 'UTC')).toBe('2026-10-04');
    expect(dateInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-10-04');
    expect(hourInTimeZone(instant, 'Australia/Melbourne')).toBe(1);
    expect(hourInTimeZone(new Date('2026-10-04T00:00:00Z'), 'UTC')).toBe(0);
  });

  it('validates time zones', () => {
    expect(isValidTimeZone('Australia/Sydney')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('round-trips Prisma @db.Date values', () => {
    expect(dateOnlyFromDb(dateOnlyToDb('2026-02-28'))).toBe('2026-02-28');
    expect(dateOnlyToDb('2026-02-28').toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});
