import { describe, expect, it } from 'vitest';
import { averageCents, forecastCategory, projectBalances, windowOf } from './forecast.js';

describe('forecast (spec §12)', () => {
  it('Groceries $780, $820, $760 → $786.67 (spec §18)', () => {
    const f = forecastCategory({ completedMonths: [78000, 82000, 76000], method: 'AVG3', scheduledByMonth: [0] });
    expect(f).toEqual({ baseCents: 78667, months: [78667], monthsUsed: 3, limitedHistory: false });
  });

  it('uses only the last N completed months', () => {
    const f = forecastCategory({ completedMonths: [100000, 78000, 82000, 76000], method: 'AVG3', scheduledByMonth: [0, 0] });
    expect(f.baseCents).toBe(78667);
  });

  it('averages what there is and flags limited history', () => {
    const f = forecastCategory({ completedMonths: [50000, 70000], method: 'AVG6', scheduledByMonth: [0] });
    expect(f).toMatchObject({ baseCents: 60000, monthsUsed: 2, limitedHistory: true });
    expect(forecastCategory({ completedMonths: [], method: 'AVG12', scheduledByMonth: [0] })).toMatchObject({ baseCents: 0, limitedHistory: true });
  });

  it('adds scheduled occurrences on top of the unscheduled average', () => {
    const f = forecastCategory({ completedMonths: [1000, 2000, 3000], method: 'AVG3', scheduledByMonth: [45000, 0, 0, 45000] });
    expect(f.months).toEqual([47000, 2000, 2000, 47000]);
  });

  it('supports a manual amount', () => {
    expect(forecastCategory({ completedMonths: [1, 2, 3], method: 'MANUAL', manualCents: 50000, scheduledByMonth: [100, 0] })).toEqual({
      baseCents: 50000,
      months: [50100, 50000],
      monthsUsed: 0,
      limitedHistory: false,
    });
    expect(forecastCategory({ completedMonths: [], method: 'MANUAL', scheduledByMonth: [0] }).baseCents).toBe(0);
  });

  it('helpers', () => {
    expect(windowOf('AVG6')).toBe(6);
    expect(windowOf('AVG12')).toBe(12);
    expect(averageCents([])).toBe(0);
    expect(averageCents([1, 2])).toBe(2); // 1.5 rounds away from zero
    expect(averageCents([-1, -2])).toBe(-2);
    expect(projectBalances(1000, [500, -2000, 100])).toEqual([1500, -500, -400]);
  });
});
