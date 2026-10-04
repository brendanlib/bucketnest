import { describe, expect, it } from 'vitest';
import { calculateBucketActuals, calculateCategorySpending, calculateIncomeTotal } from './spending.js';
import { splitDebtRepayment } from './repayment.js';
import { calculateAccountBalance } from './balance.js';

describe('category spending (spec §3.4)', () => {
  it('nets refunds against expenses (spec §18)', () => {
    const spending = calculateCategorySpending([
      { categoryId: 'clothing', amountCents: 5000, transactionType: 'EXPENSE' },
      { categoryId: 'clothing', amountCents: 2000, transactionType: 'REFUND' },
    ]);
    expect(spending.get('clothing')).toBe(3000);
  });

  it('does not count transfers or income as spending (spec §18)', () => {
    const before = calculateCategorySpending([{ categoryId: 'groceries', amountCents: 15000, transactionType: 'EXPENSE' }]);
    const after = calculateCategorySpending([
      { categoryId: 'groceries', amountCents: 15000, transactionType: 'EXPENSE' },
      // A transfer never carries splits, but even a stray one must not count.
      { categoryId: 'groceries', amountCents: 50000, transactionType: 'TRANSFER' },
      { categoryId: 'salary', amountCents: 350000, transactionType: 'INCOME' },
      { categoryId: 'groceries', amountCents: 999, transactionType: 'BALANCE_ADJUSTMENT' },
    ]);
    expect(after).toEqual(before);
  });

  it('counts a credit card purchase once when the card is paid (spec §18)', () => {
    // $100 purchase on the card is the expense; the $100 repayment is a transfer with no splits.
    const splits = [{ categoryId: 'electronics', amountCents: 10000, transactionType: 'EXPENSE' as const }];
    const total = [...calculateCategorySpending(splits).values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(10000);
    // Balances: bank down $100, card back to $0.
    expect(calculateAccountBalance(0, 'LIABILITY', [
      { type: 'EXPENSE', amountCents: 10000, role: 'from' },
      { type: 'TRANSFER', amountCents: 10000, role: 'to' },
    ])).toBe(0);
  });

  it('splits a loan repayment into Bills and Fire Extinguisher (spec §18)', () => {
    expect(splitDebtRepayment(300000, 250000)).toEqual({ minimumCents: 250000, extraCents: 50000 });
    expect(splitDebtRepayment(200000, 250000)).toEqual({ minimumCents: 200000, extraCents: 0 });
    expect(splitDebtRepayment(300000, null)).toEqual({ minimumCents: 300000, extraCents: 0 });
    expect(splitDebtRepayment(300000, -5)).toEqual({ minimumCents: 0, extraCents: 300000 });
    expect(() => splitDebtRepayment(0, 100)).toThrow(RangeError);

    const spending = calculateCategorySpending([
      { categoryId: 'mortgage', amountCents: 250000, transactionType: 'DEBT_REPAYMENT' },
      { categoryId: 'extra-debt', amountCents: 50000, transactionType: 'DEBT_REPAYMENT' },
    ]);
    const buckets = calculateBucketActuals(spending, (id) => (id === 'mortgage' ? 'BILLS' : 'FIRE_EXTINGUISHER'));
    expect(buckets.get('BILLS')).toBe(250000);
    expect(buckets.get('FIRE_EXTINGUISHER')).toBe(50000);
  });

  it('excludes sinking-fund payments unless asked', () => {
    const splits = [
      { categoryId: 'rego', amountCents: 90000, transactionType: 'EXPENSE' as const, isSinkingFundPayment: true },
      { categoryId: 'rego', amountCents: 1000, transactionType: 'EXPENSE' as const },
    ];
    expect(calculateCategorySpending(splits).get('rego')).toBe(1000);
    expect(calculateCategorySpending(splits, { includeSinkingFundPayments: true }).get('rego')).toBe(91000);
  });

  it('counts savings contributions in their Fire Extinguisher category', () => {
    const spending = calculateCategorySpending([
      { categoryId: 'emergency', amountCents: 20000, transactionType: 'SAVINGS_CONTRIBUTION' },
    ]);
    expect(spending.get('emergency')).toBe(20000);
  });

  it('totals income from income transactions only', () => {
    expect(
      calculateIncomeTotal([
        { categoryId: 'salary', amountCents: 350000, transactionType: 'INCOME' },
        { categoryId: 'x', amountCents: 1000, transactionType: 'TRANSFER' },
        { categoryId: 'x', amountCents: 1000, transactionType: 'REFUND' },
      ]),
    ).toBe(350000);
  });

  it('skips categories without a bucket when rolling up', () => {
    const buckets = calculateBucketActuals(new Map([['a', 100], ['b', 50]]), (id) => (id === 'a' ? 'SMILE' : null));
    expect([...buckets]).toEqual([['SMILE', 100]]);
  });
});
