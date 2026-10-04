import { describe, expect, it } from 'vitest';
import { lastMonthEnds, nextPeriod, periodContaining, periodLengthDays, previousPeriod } from './periods.js';

describe('budget periods', () => {
  it('monthly periods start on the anchor day', () => {
    expect(periodContaining('MONTHLY', '2026-01-01', '2026-10-04')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(periodContaining('MONTHLY', '2026-01-15', '2026-10-04')).toEqual({ start: '2026-09-15', end: '2026-10-14' });
    expect(periodContaining('MONTHLY', '2026-01-15', '2026-01-03')).toEqual({ start: '2025-12-15', end: '2026-01-14' });
  });

  it('clamps monthly anchors at month end', () => {
    expect(periodContaining('MONTHLY', '2026-01-31', '2026-02-28')).toEqual({ start: '2026-02-28', end: '2026-03-30' });
    expect(periodContaining('MONTHLY', '2026-01-31', '2026-02-27')).toEqual({ start: '2026-01-31', end: '2026-02-27' });
  });

  it('fortnightly periods are anchored to a payday', () => {
    expect(periodContaining('FORTNIGHTLY', '2026-09-24', '2026-10-04')).toEqual({ start: '2026-09-24', end: '2026-10-07' });
    expect(periodContaining('FORTNIGHTLY', '2026-09-24', '2026-10-08')).toEqual({ start: '2026-10-08', end: '2026-10-21' });
    expect(periodContaining('FORTNIGHTLY', '2026-09-24', '2026-09-23')).toEqual({ start: '2026-09-10', end: '2026-09-23' });
  });

  it('weekly and annual periods', () => {
    expect(periodContaining('WEEKLY', '2026-10-05', '2026-10-04')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(periodContaining('ANNUAL', '2025-07-01', '2026-10-04')).toEqual({ start: '2026-07-01', end: '2027-06-30' });
    expect(periodContaining('ANNUAL', '2025-07-01', '2026-03-01')).toEqual({ start: '2025-07-01', end: '2026-06-30' });
  });

  it('steps backward and forward', () => {
    const p = periodContaining('MONTHLY', '2026-01-01', '2026-10-04');
    expect(previousPeriod('MONTHLY', '2026-01-01', p)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(nextPeriod('MONTHLY', '2026-01-01', p)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(periodLengthDays(p)).toBe(31);
  });

  it('lists month ends for sparklines', () => {
    expect(lastMonthEnds('2026-10-04', 3)).toEqual(['2026-08-31', '2026-09-30', '2026-10-04']);
    expect(lastMonthEnds('2026-02-10', 3)).toEqual(['2025-12-31', '2026-01-31', '2026-02-10']);
  });
});
