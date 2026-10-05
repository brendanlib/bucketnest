import { describe, expect, it } from 'vitest';
import { calculateGoalProgress, calculateSinkingFundContribution, countContributionDates } from './goals.js';

describe('sinking funds (spec §9, §18)', () => {
  it('target $900, current $300, 12 dates left → $50.00', () => {
    expect(calculateSinkingFundContribution({ targetCents: 90000, currentCents: 30000, datesLeft: 12 })).toEqual({ remainingCents: 60000, contributionCents: 5000, funded: false });
  });

  it('$100 shortfall over 3 dates rounds up to $33.34', () => {
    expect(calculateSinkingFundContribution({ targetCents: 10000, currentCents: 0, datesLeft: 3 }).contributionCents).toBe(3334);
  });

  it('funded and overdue cases', () => {
    expect(calculateSinkingFundContribution({ targetCents: 10000, currentCents: 12000, datesLeft: 3 })).toEqual({ remainingCents: 0, contributionCents: 0, funded: true });
    expect(calculateSinkingFundContribution({ targetCents: 10000, currentCents: 4000, datesLeft: 0 })).toEqual({ remainingCents: 6000, contributionCents: 6000, funded: false });
  });

  it('counts actual contribution dates in a range', () => {
    const plan = { frequency: 'MONTHLY' as const, anchorDate: '2026-01-15' };
    expect(countContributionDates(plan, '2026-10-05', '2027-10-04')).toBe(12);
    expect(countContributionDates(plan, '2026-10-16', '2026-11-14')).toBe(0);
    expect(countContributionDates({ frequency: 'FORTNIGHTLY', anchorDate: '2026-09-24' }, '2026-10-05', '2026-12-31')).toBe(7); // 8 Oct … 31 Dec
    expect(countContributionDates(plan, '2026-12-01', '2026-11-01')).toBe(0);
  });
});

describe('goals (spec §10)', () => {
  const plan = { frequency: 'MONTHLY' as const, anchorDate: '2026-11-01' };

  it('reports progress, required contribution and projected completion', () => {
    const g = calculateGoalProgress({ targetCents: 1000000, currentCents: 250000, today: '2026-10-05', targetDate: '2027-09-30', contributionCents: 50000, plan });
    expect(g).toEqual({
      progressPercent: 25,
      remainingCents: 750000,
      reached: false,
      requiredContributionCents: 68182, // 11 dates from 1 Nov 2026 to 1 Sep 2027 → $681.82, rounded up
      projectedDate: '2028-01-01', // 15 contributions of $500
      onTrack: false,
    });
  });

  it('is on track when the projection beats the target date', () => {
    const g = calculateGoalProgress({ targetCents: 120000, currentCents: 0, today: '2026-10-05', targetDate: '2027-12-31', contributionCents: 10000, plan });
    expect(g).toMatchObject({ projectedDate: '2027-10-01', onTrack: true, requiredContributionCents: 8572 });
  });

  it('handles reached goals, missing plans and no target dates', () => {
    expect(calculateGoalProgress({ targetCents: 100, currentCents: 150, today: '2026-10-05' })).toMatchObject({ reached: true, progressPercent: 150, projectedDate: '2026-10-05', remainingCents: 0, onTrack: null });
    expect(calculateGoalProgress({ targetCents: 100, currentCents: 0, today: '2026-10-05', plan, targetDate: '2026-10-20' })).toMatchObject({ requiredContributionCents: 100, projectedDate: null, onTrack: false });
    expect(calculateGoalProgress({ targetCents: 100, currentCents: -50, today: '2026-10-05' }).progressPercent).toBe(0);
    expect(calculateGoalProgress({ targetCents: 100000000, currentCents: 0, today: '2026-10-05', plan, contributionCents: 1 }).projectedDate).toBeNull();
  });
});
