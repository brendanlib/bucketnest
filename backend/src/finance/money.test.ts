import { describe, expect, it } from 'vitest';
import {
  assertCents,
  ceilToCents,
  centsFromBigInt,
  MoneyError,
  parseMoney,
  percentage,
  percentOf,
  roundToCents,
  sumCents,
} from './money.js';

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(roundToCents('0.5')).toBe(1);
    expect(roundToCents('1.5')).toBe(2);
    expect(roundToCents('2.5')).toBe(3);
    expect(roundToCents('-0.5')).toBe(-1);
    expect(roundToCents('-2.5')).toBe(-3);
    expect(roundToCents('2.4999')).toBe(2);
  });

  it('rounds up to the cent when asked', () => {
    expect(ceilToCents('3333.3333')).toBe(3334);
    expect(ceilToCents('3333')).toBe(3333);
  });

  it('computes percentages to 2 dp and returns null for a zero whole', () => {
    expect(percentage(74200, 80000)).toBe(92.75);
    expect(percentage(1, 3)).toBe(33.33);
    expect(percentage(2, 3)).toBe(66.67);
    expect(percentage(2000, 0)).toBeNull();
  });

  it('takes a percentage of an amount', () => {
    expect(percentOf(500000, '60')).toBe(300000);
    expect(percentOf(123457, '10')).toBe(12346);
  });

  it('rejects non-integer cents', () => {
    expect(() => assertCents(1.5)).toThrow(MoneyError);
    expect(() => assertCents('1')).toThrow(MoneyError);
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => assertCents(100)).not.toThrow();
  });

  it('converts BIGINT values safely', () => {
    expect(centsFromBigInt(123n)).toBe(123);
    expect(() => centsFromBigInt(2n ** 60n)).toThrow(MoneyError);
  });

  it('sums cents', () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sumCents([])).toBe(0);
  });

  describe('parseMoney', () => {
    it.each([
      ['1,234.50', 123450],
      ['$1234.5', 123450],
      ['1234', 123400],
      ['0.07', 7],
      ['.5', 50],
      ['-12.00', -1200],
      ['(12.00)', -1200],
      ['12.00-', -1200],
      ['+5', 500],
      ['AUD 10.10', 1010],
      [' $ 1,000,000.00 ', 100000000],
    ])('parses %s', (input, expected) => {
      expect(parseMoney(input)).toBe(expected);
    });

    it.each(['', 'abc', '1.234', '12,34', '1,2345.00', '.', '$', '1e5'])('rejects %j', (input) => {
      expect(parseMoney(input)).toBeNull();
    });
  });
});
