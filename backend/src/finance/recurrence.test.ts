import { describe, expect, it } from 'vitest';
import {
  applyWeekendRule,
  countOccurrencesBefore,
  generateOccurrences,
  isOccurrenceDate,
  nextOccurrence,
  nominalDatesBetween,
  RecurrenceError,
  validateSchedule,
  type ScheduleSpec,
} from './recurrence.js';

const s = (over: Partial<ScheduleSpec>): ScheduleSpec => ({ frequency: 'MONTHLY', startDate: '2026-01-31', amountCents: 1000, ...over });
const dates = (spec: ScheduleSpec, from: string, to: string) => generateOccurrences(spec, from, to).map((o) => o.date);

describe('generateOccurrences', () => {
  it('anchors monthly dates to the start day and clamps at month end (spec §18)', () => {
    expect(dates(s({}), '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    expect(dates(s({ startDate: '2028-01-31' }), '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  });

  it('keeps 29 Feb annual schedules on 28 Feb in non-leap years (spec §18)', () => {
    const spec = s({ frequency: 'ANNUALLY', startDate: '2028-02-29' });
    expect(dates(spec, '2028-01-01', '2033-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29', '2033-02-28']);
  });

  it('handles weekly, fortnightly and custom day/week/month steps', () => {
    expect(dates(s({ frequency: 'WEEKLY', startDate: '2026-10-01' }), '2026-10-01', '2026-10-31')).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
    expect(dates(s({ frequency: 'FORTNIGHTLY', startDate: '2026-09-24' }), '2026-10-01', '2026-10-31')).toEqual(['2026-10-08', '2026-10-22']);
    expect(dates(s({ frequency: 'EVERY_N_DAYS', interval: 10, startDate: '2026-10-01' }), '2026-10-01', '2026-10-31')).toEqual(['2026-10-01', '2026-10-11', '2026-10-21', '2026-10-31']);
    expect(dates(s({ frequency: 'EVERY_N_WEEKS', interval: 3, startDate: '2026-10-01' }), '2026-10-01', '2026-11-30')).toEqual(['2026-10-01', '2026-10-22', '2026-11-12']);
    expect(dates(s({ frequency: 'EVERY_N_MONTHS', interval: 2, startDate: '2026-01-15' }), '2026-01-01', '2026-07-31')).toEqual(['2026-01-15', '2026-03-15', '2026-05-15', '2026-07-15']);
    expect(dates(s({ frequency: 'QUARTERLY', startDate: '2026-01-31' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
    expect(dates(s({ frequency: 'SIX_MONTHLY', startDate: '2026-08-31' }), '2026-01-01', '2027-12-31')).toEqual(['2026-08-31', '2027-02-28', '2027-08-31']);
  });

  it('starts mid-pattern for a range far from the start date', () => {
    expect(dates(s({ frequency: 'FORTNIGHTLY', startDate: '2020-01-02' }), '2026-10-01', '2026-10-28')).toEqual(['2026-10-01', '2026-10-15']); // 2,464 days = 176 fortnights
    expect(dates(s({ startDate: '2020-01-31' }), '2026-10-01', '2026-11-30')).toEqual(['2026-10-31', '2026-11-30']);
  });

  it('honours end dates and occurrence counts', () => {
    expect(dates(s({ startDate: '2026-01-15', endDate: '2026-03-15' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    expect(dates(s({ startDate: '2026-01-15', endDate: '2026-03-14' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15']);
    expect(dates(s({ startDate: '2026-01-15', occurrenceCount: 2 }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15']);
    expect(dates(s({ startDate: '2026-01-15' }), '2025-01-01', '2025-12-31')).toEqual([]);
    expect(generateOccurrences(s({}), '2026-05-01', '2026-04-01')).toEqual([]);
  });

  it('moves weekend dates by the weekend rule but keeps the nominal date as identity', () => {
    // 2026-10-31 is a Saturday, 2026-11-01 a Sunday.
    const prev = generateOccurrences(s({ startDate: '2026-10-31', weekendRule: 'PREVIOUS_BUSINESS_DAY' }), '2026-10-01', '2026-10-31');
    expect(prev).toEqual([{ occurrenceDate: '2026-10-31', date: '2026-10-30', amountCents: 1000, skipped: false, edited: false }]);
    const next = generateOccurrences(s({ startDate: '2026-11-01', weekendRule: 'NEXT_BUSINESS_DAY' }), '2026-11-01', '2026-11-30');
    expect(next[0]).toMatchObject({ occurrenceDate: '2026-11-01', date: '2026-11-02' });
    // A Saturday occurrence moved forward out of the range is excluded; one moved in from just outside is included.
    expect(dates(s({ startDate: '2026-10-31', weekendRule: 'NEXT_BUSINESS_DAY' }), '2026-10-01', '2026-10-31')).toEqual([]);
    expect(dates(s({ startDate: '2026-10-31', weekendRule: 'NEXT_BUSINESS_DAY' }), '2026-11-01', '2026-11-03')).toEqual(['2026-11-02']);
    expect(applyWeekendRule('2026-11-01', 'PREVIOUS_BUSINESS_DAY')).toBe('2026-10-30');
    expect(applyWeekendRule('2026-10-31', 'NEXT_BUSINESS_DAY')).toBe('2026-11-02');
    expect(applyWeekendRule('2026-10-30', 'NEXT_BUSINESS_DAY')).toBe('2026-10-30');
  });

  it('applies skip and edit exceptions after generation', () => {
    const spec = s({ startDate: '2026-01-15' });
    const result = generateOccurrences(spec, '2026-01-01', '2026-04-30', [
      { occurrenceDate: '2026-02-15', action: 'SKIP' },
      { occurrenceDate: '2026-03-15', action: 'EDIT', overrideAmountCents: 1234, overrideDate: '2026-03-20' },
      { occurrenceDate: '2026-04-15', action: 'EDIT', overrideAmountCents: 999 },
    ]);
    expect(result.map((o) => [o.occurrenceDate, o.date, o.amountCents, o.skipped, o.edited])).toEqual([
      ['2026-01-15', '2026-01-15', 1000, false, false],
      ['2026-02-15', '2026-02-15', 1000, true, false],
      ['2026-03-15', '2026-03-20', 1234, false, true],
      ['2026-04-15', '2026-04-15', 999, false, true],
    ]);
  });

  it('brings an occurrence edited into the range from far away, and ignores bogus exceptions', () => {
    const spec = s({ startDate: '2026-01-15' });
    const moved = generateOccurrences(spec, '2026-06-01', '2026-06-30', [
      { occurrenceDate: '2026-01-15', action: 'EDIT', overrideDate: '2026-06-10' },
      { occurrenceDate: '2026-01-16', action: 'EDIT', overrideDate: '2026-06-11' },
    ]);
    expect(moved.map((o) => [o.occurrenceDate, o.date])).toEqual([
      ['2026-01-15', '2026-06-10'],
      ['2026-06-15', '2026-06-15'],
    ]);
  });

  it('is deterministic', () => {
    const spec = s({ frequency: 'FORTNIGHTLY', startDate: '2026-01-01', weekendRule: 'NEXT_BUSINESS_DAY' });
    expect(generateOccurrences(spec, '2026-01-01', '2026-12-31')).toEqual(generateOccurrences(spec, '2026-01-01', '2026-12-31'));
  });

  it('validates schedules', () => {
    expect(() => validateSchedule(s({ frequency: 'EVERY_N_DAYS' }))).toThrow(RecurrenceError);
    expect(() => validateSchedule(s({ frequency: 'EVERY_N_WEEKS', interval: 0 }))).toThrow(RecurrenceError);
    expect(() => validateSchedule(s({ frequency: 'EVERY_N_MONTHS', interval: 1.5 }))).toThrow(RecurrenceError);
    expect(() => validateSchedule(s({ endDate: '2025-01-01' }))).toThrow('before the start');
    expect(() => validateSchedule(s({ occurrenceCount: 0 }))).toThrow('at least 1');
    expect(nominalDatesBetween(s({ endDate: '2025-01-01' }), '2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('guards against runaway ranges', () => {
    expect(() => nominalDatesBetween(s({ frequency: 'EVERY_N_DAYS', interval: 1, startDate: '2000-01-01' }), '2000-01-01', '2100-01-01', 100)).toThrow(RecurrenceError);
  });
});

describe('occurrence helpers', () => {
  it('recognises occurrence dates', () => {
    const spec = s({ startDate: '2026-01-31', occurrenceCount: 3 });
    expect(isOccurrenceDate(spec, '2026-02-28')).toBe(true);
    expect(isOccurrenceDate(spec, '2026-03-31')).toBe(true);
    expect(isOccurrenceDate(spec, '2026-04-30')).toBe(false); // beyond the count
    expect(isOccurrenceDate(spec, '2026-02-27')).toBe(false);
    expect(isOccurrenceDate(spec, '2025-12-31')).toBe(false);
  });

  it('counts occurrences before a date', () => {
    const spec = s({ startDate: '2026-01-15' });
    expect(countOccurrencesBefore(spec, '2026-01-15')).toBe(0);
    expect(countOccurrencesBefore(spec, '2026-04-16')).toBe(4);
    expect(countOccurrencesBefore(s({ startDate: '2026-01-15', occurrenceCount: 2 }), '2026-12-01')).toBe(2);
  });

  it('finds the next unposted, unskipped occurrence', () => {
    const spec = s({ startDate: '2026-01-15' });
    expect(nextOccurrence(spec, '2026-03-01')?.date).toBe('2026-03-15');
    expect(nextOccurrence(spec, '2026-03-01', [{ occurrenceDate: '2026-03-15', action: 'SKIP' }])?.date).toBe('2026-04-15');
    expect(nextOccurrence(spec, '2026-03-01', [], (d) => d === '2026-03-15')?.date).toBe('2026-04-15');
    expect(nextOccurrence(s({ startDate: '2026-01-15', occurrenceCount: 1 }), '2026-03-01')).toBeNull();
  });
});
