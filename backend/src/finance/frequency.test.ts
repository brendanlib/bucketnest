import { describe, expect, it } from 'vitest';
import {
  calculateAnnualIncome,
  calculateIncomeAt,
  calculateMonthlyIncome,
  convertFrequency,
  fromAnnual,
  normalise,
  periodTypeToFrequency,
  timesPerYear,
  toAnnual,
} from './frequency.js';
import { MoneyError } from './money.js';

describe('frequency normalisation', () => {
  it('uses the annualisation factors from spec §3.2', () => {
    expect(timesPerYear({ frequency: 'WEEKLY' }).toNumber()).toBe(52);
    expect(timesPerYear({ frequency: 'FORTNIGHTLY' }).toNumber()).toBe(26);
    expect(timesPerYear({ frequency: 'MONTHLY' }).toNumber()).toBe(12);
    expect(timesPerYear({ frequency: 'QUARTERLY' }).toNumber()).toBe(4);
    expect(timesPerYear({ frequency: 'SIX_MONTHLY' }).toNumber()).toBe(2);
    expect(timesPerYear({ frequency: 'ANNUALLY' }).toNumber()).toBe(1);
    expect(timesPerYear({ frequency: 'EVERY_N_DAYS', interval: 5 }).toNumber()).toBe(73);
    expect(timesPerYear({ frequency: 'EVERY_N_WEEKS', interval: 4 }).toNumber()).toBe(13);
    expect(timesPerYear({ frequency: 'EVERY_N_MONTHS', interval: 3 }).toNumber()).toBe(4);
  });

  it('requires a valid interval for custom frequencies', () => {
    expect(() => timesPerYear({ frequency: 'EVERY_N_DAYS' })).toThrow(MoneyError);
    expect(() => timesPerYear({ frequency: 'EVERY_N_WEEKS', interval: 0 })).toThrow(MoneyError);
    expect(() => timesPerYear({ frequency: 'EVERY_N_MONTHS', interval: 1.5 })).toThrow(MoneyError);
    expect(() => timesPerYear({ frequency: 'BOGUS' as never })).toThrow(MoneyError);
  });

  it('normalises $3,500 fortnightly (spec §18)', () => {
    const fortnightly = { frequency: 'FORTNIGHTLY' as const };
    expect(toAnnual(350000, fortnightly)).toBe(9100000);
    expect(convertFrequency(350000, fortnightly, { frequency: 'MONTHLY' })).toBe(758333);
    expect(convertFrequency(350000, fortnightly, { frequency: 'WEEKLY' })).toBe(175000);
    expect(normalise(350000, fortnightly)).toEqual({
      weekly: 175000,
      fortnightly: 350000,
      monthly: 758333,
      annual: 9100000,
    });
  });

  it('never multiplies fortnightly by 2 to get monthly', () => {
    expect(convertFrequency(100000, { frequency: 'FORTNIGHTLY' }, { frequency: 'MONTHLY' })).toBe(216667);
    expect(convertFrequency(100000, { frequency: 'WEEKLY' }, { frequency: 'MONTHLY' })).toBe(433333);
  });

  it('converts annual amounts down', () => {
    expect(fromAnnual(90000, { frequency: 'MONTHLY' })).toBe(7500);
    expect(fromAnnual(9100000, { frequency: 'WEEKLY' })).toBe(175000);
    expect(fromAnnual(100, { frequency: 'MONTHLY' })).toBe(8);
  });

  it('converts custom frequencies exactly', () => {
    expect(toAnnual(1000, { frequency: 'EVERY_N_DAYS', interval: 7 })).toBe(52143);
    expect(convertFrequency(45000, { frequency: 'QUARTERLY' }, { frequency: 'MONTHLY' })).toBe(15000);
  });

  it('maps budget periods to frequencies', () => {
    expect(periodTypeToFrequency('ANNUAL')).toEqual({ frequency: 'ANNUALLY' });
    expect(periodTypeToFrequency('FORTNIGHTLY')).toEqual({ frequency: 'FORTNIGHTLY' });
  });

  it('totals several income sources with one rounding', () => {
    const sources = [
      { amountCents: 350000, frequency: 'FORTNIGHTLY' as const },
      { amountCents: 10000, frequency: 'WEEKLY' as const },
    ];
    expect(calculateAnnualIncome(sources)).toBe(9620000);
    expect(calculateMonthlyIncome(sources)).toBe(801667);
    expect(calculateIncomeAt(sources, { frequency: 'FORTNIGHTLY' })).toBe(370000);
    expect(calculateAnnualIncome([])).toBe(0);
  });
});
