import { describe, expect, it } from 'vitest';
import { buildBudgetSummary, calculateBudgetVariance, calculateRemainingBudget, calculateSavingsRate } from './budget.js';

const t = { amber: 90, red: 100 };

describe('budget variance', () => {
  it('Groceries $800 budget, $742 actual (spec §18)', () => {
    expect(calculateBudgetVariance(80000, 74200, t)).toEqual({ budgetCents: 80000, actualCents: 74200, remainingCents: 5800, percentUsed: 92.75, status: 'amber' });
  });

  it('zero budget shows "—" and flags unbudgeted spending (spec §18)', () => {
    expect(calculateBudgetVariance(0, 2000, t)).toMatchObject({ percentUsed: null, status: 'unbudgeted', remainingCents: -2000 });
    expect(calculateBudgetVariance(0, 0, t).status).toBe('none');
  });

  it('applies amber and red thresholds exactly', () => {
    expect(calculateBudgetVariance(10000, 8999, t).status).toBe('ok');
    expect(calculateBudgetVariance(10000, 9000, t).status).toBe('amber');
    expect(calculateBudgetVariance(10000, 10000, t).status).toBe('amber');
    expect(calculateBudgetVariance(10000, 10001, t)).toMatchObject({ status: 'red', remainingCents: -1, percentUsed: 100.01 });
    expect(calculateBudgetVariance(10000, -500, t)).toMatchObject({ status: 'ok', remainingCents: 10500 });
  });

  it('remaining and savings rate', () => {
    expect(calculateRemainingBudget(100, 30)).toBe(70);
    expect(calculateSavingsRate(500000, 400000)).toBe(20);
    expect(calculateSavingsRate(0, 100)).toBeNull();
  });
});

describe('buildBudgetSummary', () => {
  const buckets = [
    { id: 'bills', key: 'BILLS', name: 'Bills', colour: '#00f', sortOrder: 1 },
    { id: 'smile', key: 'SMILE', name: 'Smile', colour: '#f0f', sortOrder: 2 },
  ];
  const categories = [
    { id: 'food', name: 'Food', bucketId: 'bills', parentId: null, isGroup: true, isActive: true, sortOrder: 20, kind: 'EXPENSE' as const },
    { id: 'housing', name: 'Housing', bucketId: 'bills', parentId: null, isGroup: true, isActive: true, sortOrder: 10, kind: 'EXPENSE' as const },
    { id: 'groceries', name: 'Groceries', bucketId: 'bills', parentId: 'food', isGroup: false, isActive: true, sortOrder: 10, kind: 'EXPENSE' as const },
    { id: 'rent', name: 'Rent', bucketId: 'bills', parentId: 'housing', isGroup: false, isActive: true, sortOrder: 10, kind: 'EXPENSE' as const },
    { id: 'pet', name: 'Pet food', bucketId: 'bills', parentId: 'food', isGroup: false, isActive: true, sortOrder: 20, kind: 'EXPENSE' as const },
    { id: 'dining', name: 'Dining out', bucketId: 'smile', parentId: null, isGroup: false, isActive: true, sortOrder: 10, kind: 'EXPENSE' as const },
    { id: 'old', name: 'Old', bucketId: 'smile', parentId: null, isGroup: false, isActive: false, sortOrder: 20, kind: 'EXPENSE' as const },
    { id: 'salary', name: 'Salary', bucketId: null, parentId: null, isGroup: false, isActive: true, sortOrder: 10, kind: 'INCOME' as const },
  ];

  it('rolls lines up by group and bucket, flags unbudgeted and over-allocation', () => {
    const result = buildBudgetSummary({
      categories,
      buckets,
      items: [
        { categoryId: 'groceries', periodAmountCents: 80000 },
        { categoryId: 'rent', periodAmountCents: 232000 },
      ],
      spending: new Map([
        ['groceries', 74200],
        ['dining', 4500],
        ['salary', 999],
      ]),
      allocations: new Map([
        ['bills', 300000],
        ['smile', 50000],
      ]),
      thresholds: t,
    });
    const bills = result.buckets[0]!;
    expect(bills.groups.map((g) => g.name)).toEqual(['Housing', 'Food']);
    expect(bills).toMatchObject({ budgetCents: 312000, actualCents: 74200, allocatedCents: 300000, overAllocatedCents: 12000 });
    expect(bills.allocation).toMatchObject({ budgetCents: 300000, actualCents: 74200, remainingCents: 225800 });
    const smile = result.buckets[1]!;
    expect(smile.groups).toHaveLength(1);
    expect(smile.groups[0]).toMatchObject({ name: 'Other', lines: [expect.objectContaining({ categoryId: 'dining', status: 'unbudgeted', hasItem: false })] });
    expect(smile.overAllocatedCents).toBe(0);
    expect(result.total).toMatchObject({ budgetCents: 312000, actualCents: 78700 });
  });

  it('places sinking fund lines beside their category', () => {
    const result = buildBudgetSummary({
      categories,
      buckets,
      items: [{ categoryId: 'groceries', periodAmountCents: 1000 }],
      spending: new Map(),
      allocations: new Map(),
      thresholds: t,
      fundLines: [
        { sinkingFundId: 'f1', categoryId: 'groceries', name: 'Christmas food', budgetCents: 5000, actualCents: 5000 },
        { sinkingFundId: 'f2', categoryId: 'pet', name: 'Vet fund', budgetCents: 2000, actualCents: 0 },
        { sinkingFundId: 'f3', categoryId: 'salary', name: 'Ignored', budgetCents: 1, actualCents: 1 },
      ],
    });
    const food = result.buckets[0]!.groups.find((g) => g.name === 'Food')!;
    expect(food.lines.map((l) => [l.name, l.sinkingFundId ?? null])).toEqual([
      ['Groceries', null],
      ['Christmas food', 'f1'],
      ['Vet fund', 'f2'],
    ]);
    expect(food).toMatchObject({ budgetCents: 8000, actualCents: 5000 });
    expect(result.total.budgetCents).toBe(8000);
  });

  it('can include every active category with no activity', () => {
    const result = buildBudgetSummary({ categories, buckets, items: [], spending: new Map(), allocations: new Map(), thresholds: t, includeEmpty: true });
    const names = result.buckets.flatMap((b) => b.groups.flatMap((g) => g.lines.map((l) => l.name)));
    expect(names).toEqual(['Rent', 'Groceries', 'Pet food', 'Dining out']);
  });
});
