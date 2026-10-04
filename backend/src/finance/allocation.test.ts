import { describe, expect, it } from 'vitest';
import { AllocationError, calculateBucketAllocation, validateBucketPercentages } from './allocation.js';

const defaults = [
  { id: 'bills', percentage: '60.00', sortOrder: 1 },
  { id: 'smile', percentage: '10.00', sortOrder: 2 },
  { id: 'splurge', percentage: '10.00', sortOrder: 3 },
  { id: 'fire', percentage: '20.00', sortOrder: 4 },
];

const amounts = (r: { amountCents: number }[]) => r.map((x) => x.amountCents);

describe('bucket allocation', () => {
  it('allocates $5,000.00 at 60/10/10/20 (spec §18)', () => {
    expect(amounts(calculateBucketAllocation(500000, defaults))).toEqual([300000, 50000, 50000, 100000]);
  });

  it('distributes the rounding remainder for $1,234.57 (spec §18)', () => {
    const result = amounts(calculateBucketAllocation(123457, defaults));
    expect(result).toEqual([74074, 12346, 12346, 24691]);
    expect(result.reduce((a, b) => a + b)).toBe(123457);
  });

  it('rejects percentages that do not total 100 (spec §18)', () => {
    const bad = defaults.map((b) => (b.id === 'fire' ? { ...b, percentage: '15.00' } : b));
    expect(() => calculateBucketAllocation(500000, bad)).toThrow(AllocationError);
    expect(() => calculateBucketAllocation(500000, bad)).toThrow('95.00%');
  });

  it('breaks ties by lower sort order', () => {
    const thirds = [
      { id: 'c', percentage: '33.33', sortOrder: 3 },
      { id: 'a', percentage: '33.33', sortOrder: 1 },
      { id: 'b', percentage: '33.34', sortOrder: 2 },
    ];
    // 100 cents: exact shares 33.33, 33.33, 33.34 → floors 33,33,33 → 1 cent left.
    // Remainders .33, .33, .34 → b (largest) gets it.
    expect(calculateBucketAllocation(100, thirds)).toEqual([
      { id: 'c', amountCents: 33 },
      { id: 'a', amountCents: 33 },
      { id: 'b', amountCents: 34 },
    ]);
    const equal = [
      { id: 'y', percentage: '50', sortOrder: 2 },
      { id: 'x', percentage: '50', sortOrder: 1 },
    ];
    expect(calculateBucketAllocation(1, equal)).toEqual([
      { id: 'y', amountCents: 0 },
      { id: 'x', amountCents: 1 },
    ]);
  });

  it('always sums exactly across many incomes', () => {
    const odd = [
      { id: 'a', percentage: '12.34', sortOrder: 1 },
      { id: 'b', percentage: '56.78', sortOrder: 2 },
      { id: 'c', percentage: '30.88', sortOrder: 3 },
    ];
    for (let income = 0; income < 5000; income += 7) {
      const total = amounts(calculateBucketAllocation(income, odd)).reduce((a, b) => a + b, 0);
      expect(total).toBe(income);
    }
  });

  it('handles zero income and rejects negative income', () => {
    expect(amounts(calculateBucketAllocation(0, defaults))).toEqual([0, 0, 0, 0]);
    expect(() => calculateBucketAllocation(-1, defaults)).toThrow(AllocationError);
  });

  it('validates individual percentages', () => {
    expect(() => validateBucketPercentages(['100', '0'])).not.toThrow();
    expect(() => validateBucketPercentages(['101', '-1'])).toThrow(AllocationError);
    expect(() => validateBucketPercentages(['33.333', '66.667'])).toThrow('2 decimal places');
    expect(() => validateBucketPercentages(['NaN'])).toThrow(AllocationError);
  });
});
