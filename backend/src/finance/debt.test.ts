import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { calculateDebtProgress, compareExtraRepayment, monthsBetween, simulateDebtPayoff, simulatePayoffPlan, type DebtInput } from './debt.js';

const base: DebtInput = {
  balanceCents: 10000000,
  annualRate: '5',
  repaymentCents: 50000,
  frequency: 'FORTNIGHTLY',
  anchorDate: '2026-10-08',
  today: '2026-10-05',
};

describe('simulateDebtPayoff', () => {
  it('matches the annuity formula for a constant-length period (spec §18: within $1)', () => {
    // Fortnightly periods are always 14 days, so the per-period rate is constant: i = 5% × 14 / 365.
    const i = new Decimal(0.05).times(14).dividedBy(365);
    const P = new Decimal(100000);
    const A = new Decimal(500);
    // Periods until paid off: n = −ln(1 − iP/A) / ln(1 + i)
    const n = Decimal.ln(new Decimal(1).minus(i.times(P).dividedBy(A))).negated().dividedBy(Decimal.ln(i.plus(1)));
    const full = n.floor().toNumber();
    // Balance after `full` payments, then the final smaller payment with its interest.
    const growth = i.plus(1).pow(full);
    const remaining = P.times(growth).minus(A.times(growth.minus(1)).dividedBy(i));
    const expectedInterest = A.times(full).plus(remaining.times(i.plus(1))).minus(P);

    const r = simulateDebtPayoff(base);
    expect(r.paidOff).toBe(true);
    expect(r.repayments).toBe(full + 1);
    expect(Math.abs(r.totalInterestCents / 100 - expectedInterest.toNumber())).toBeLessThan(1);
    expect(r.schedule[0]).toMatchObject({ date: '2026-10-08', openingCents: 10000000, interestCents: 19178, principalCents: 30822 });
    expect(r.schedule.at(-1)!.closingCents).toBe(0);
    expect(r.payoffDate).toBe(r.schedule.at(-1)!.date);
  });

  it('pays off a typical 30-year mortgage in about 30 years', () => {
    const r = simulateDebtPayoff({ balanceCents: 30000000, annualRate: '6', repaymentCents: 179865, frequency: 'MONTHLY', anchorDate: '2026-10-15', today: '2026-10-05' });
    expect(r.paidOff).toBe(true);
    expect(r.repayments).toBeGreaterThanOrEqual(355);
    expect(r.repayments).toBeLessThanOrEqual(362);
    expect(r.nextInterestCents).toBe(147945); // 300,000 × 6% × 30 ÷ 365 (period 15 Sep – 15 Oct)
  });

  it('warns and stops when the repayment does not cover the interest (spec §18)', () => {
    const r = simulateDebtPayoff({ ...base, repaymentCents: 19178 });
    expect(r).toMatchObject({ paidOff: false, warning: 'REPAYMENT_TOO_LOW', payoffDate: null, repayments: 0 });
    expect(r.schedule).toHaveLength(1);
  });

  it('stops at 600 periods', () => {
    const r = simulateDebtPayoff({ ...base, repaymentCents: 19200, frequency: 'WEEKLY', anchorDate: '2026-10-08' });
    expect(r.paidOff).toBe(false);
    expect(r.warning).toBe('NOT_WITHIN_LIMIT');
    expect(r.repayments).toBe(600);
  });

  it('charges no interest when the offset covers the loan (spec §18)', () => {
    const r = simulateDebtPayoff({ ...base, offsetCents: 12000000 });
    expect(r.totalInterestCents).toBe(0);
    expect(r.repayments).toBe(200);
  });

  it('reduces interest by the offset balance', () => {
    const plain = simulateDebtPayoff(base);
    const offset = simulateDebtPayoff({ ...base, offsetCents: 2000000 });
    expect(offset.schedule[0]!.interestCents).toBe(15342); // (100,000 − 20,000) × 5% × 14 ÷ 365
    expect(offset.totalInterestCents).toBeLessThan(plain.totalInterestCents);
  });

  it('indexes HECS/HELP once a year on 1 June instead of charging interest', () => {
    const r = simulateDebtPayoff({ balanceCents: 2000000, annualRate: '3.2', repaymentCents: 100000, frequency: 'MONTHLY', anchorDate: '2026-10-15', today: '2026-10-05', indexationOnly: true });
    const indexed = r.schedule.filter((p) => p.interestCents > 0);
    expect(indexed[0]).toMatchObject({ date: '2027-06-15' });
    expect(indexed[0]!.interestCents).toBe(Math.round((2000000 - 8 * 100000) * 0.032));
    expect(r.paidOff).toBe(true);
    const growing = simulateDebtPayoff({ balanceCents: 2000000, annualRate: '10', repaymentCents: 1000, frequency: 'MONTHLY', anchorDate: '2026-10-15', today: '2026-10-05', indexationOnly: true, maxPeriods: 30 });
    expect(growing.warning).toBe('REPAYMENT_TOO_LOW');
  });

  it('handles a debt that is already repaid', () => {
    expect(simulateDebtPayoff({ ...base, balanceCents: 0 })).toMatchObject({ paidOff: true, repayments: 0, payoffDate: '2026-10-05' });
  });

  it('starts from today when the anchor is in the past', () => {
    const r = simulateDebtPayoff({ ...base, anchorDate: '2020-01-02' });
    expect(r.schedule[0]!.date >= '2026-10-05').toBe(true);
  });
});

describe('extra repayments', () => {
  it('shows months and interest saved (spec §10)', () => {
    const c = compareExtraRepayment({ balanceCents: 30000000, annualRate: '6', repaymentCents: 179865, frequency: 'MONTHLY', anchorDate: '2026-10-15', today: '2026-10-05' }, 50000);
    expect(c.withExtra.paidOff).toBe(true);
    expect(c.monthsSaved).toBeGreaterThan(90);
    expect(c.interestSavedCents).toBeGreaterThan(10000000);
    expect(c.withExtra.payoffDate! < c.minimum.payoffDate!).toBe(true);
  });

  it('cannot compare when the minimum never pays off', () => {
    const c = compareExtraRepayment({ ...base, repaymentCents: 1000 }, 100000);
    expect(c.minimum.paidOff).toBe(false);
    expect(c.withExtra.paidOff).toBe(true);
    expect(c.monthsSaved).toBeNull();
    expect(c.interestSavedCents).toBeNull();
  });

  it('measures months between dates', () => {
    expect(monthsBetween('2026-01-01', '2027-01-01')).toBe(12);
  });
});

describe('debt progress', () => {
  it('reports how much is repaid', () => {
    expect(calculateDebtProgress(50000000, 40000000)).toEqual({ repaidCents: 10000000, percentRepaid: 20 });
    expect(calculateDebtProgress(0, 0)).toEqual({ repaidCents: 0, percentRepaid: null });
  });
});

describe('payoff order', () => {
  const debts = [
    { id: 'card', balanceCents: 300000, annualRate: '20', minimumMonthlyCents: 10000 },
    { id: 'car', balanceCents: 1500000, annualRate: '8', minimumMonthlyCents: 40000 },
    { id: 'loan', balanceCents: 500000, annualRate: '12', minimumMonthlyCents: 15000 },
  ];

  it('snowball clears the smallest balance first, avalanche the highest rate', () => {
    expect(simulatePayoffPlan(debts, 'SNOWBALL', 50000, '2026-10-05').order).toEqual(['card', 'loan', 'car']);
    expect(simulatePayoffPlan([...debts, { id: 'store', balanceCents: 100000, annualRate: '25', minimumMonthlyCents: 5000 }], 'AVALANCHE', 50000, '2026-10-05').order).toEqual(['store', 'card', 'loan', 'car']);
  });

  it('rolls a cleared debt’s repayment into the next', () => {
    const plan = simulatePayoffPlan(debts, 'SNOWBALL', 50000, '2026-10-05');
    const date = (id: string) => plan.debts.find((d) => d.id === id)!.payoffDate!;
    expect(date('card') < date('loan')).toBe(true);
    expect(date('loan') < date('car')).toBe(true);
    expect(plan.debtFreeDate).toBe(date('car'));
    expect(plan.timeline.at(-1)!.balanceCents).toBe(0);
    // With no extra and no rollover, the car loan alone at $400 a month would take far longer.
    const noExtra = simulatePayoffPlan(debts, 'SNOWBALL', 0, '2026-10-05');
    expect(noExtra.months).toBeGreaterThan(plan.months);
  });

  it('avalanche pays less interest than snowball here', () => {
    const s = simulatePayoffPlan(debts, 'SNOWBALL', 50000, '2026-10-05');
    const a = simulatePayoffPlan(debts, 'AVALANCHE', 50000, '2026-10-05');
    expect(a.totalInterestCents).toBeLessThanOrEqual(s.totalInterestCents);
  });

  it('reports no debt-free date if minimums never clear the debts, and handles cleared debts', () => {
    const plan = simulatePayoffPlan([{ id: 'x', balanceCents: 10000000, annualRate: '20', minimumMonthlyCents: 1000 }], 'AVALANCHE', 0, '2026-10-05');
    expect(plan.debtFreeDate).toBeNull();
    expect(plan.months).toBe(600);
    expect(simulatePayoffPlan([{ id: 'y', balanceCents: 0, annualRate: '5', minimumMonthlyCents: 100 }], 'SNOWBALL', 0, '2026-10-05')).toMatchObject({ debtFreeDate: '2026-10-05', months: 0 });
  });
});
