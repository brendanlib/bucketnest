import { describe, expect, it } from 'vitest';
import { dateOrder, formatDate, formatDateInput, formatHundredths, formatMoney, parseDateInput, parseMoneyInput, percentToHundredths } from './format';

describe('money formatting', () => {
  it('formats cents in the household currency and locale', () => {
    expect(formatMoney(123457, { currency: 'AUD', locale: 'en-AU' })).toBe('$1,234.57');
    expect(formatMoney(-500, { currency: 'AUD', locale: 'en-AU' })).toBe('-$5.00');
    expect(formatMoney(100, { currency: 'NZD', locale: 'en-AU' })).toMatch(/^NZ.*1\.00$/);
  });

  it.each([
    ['1,234.50', 123450],
    ['$1234.5', 123450],
    ['0.29', 29],
    ['12', 1200],
    ['-$3', -300],
    ['.5', 50],
  ])('parses %s as %d cents', (input, cents) => {
    expect(parseMoneyInput(input)).toBe(cents);
  });

  it.each(['', 'abc', '1.234', '$', '1e3'])('rejects %j', (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });
});

describe('dates', () => {
  it('uses the household date order', () => {
    expect(dateOrder('en-AU')).toEqual(['day', 'month', 'year']);
    expect(dateOrder('en-US')).toEqual(['month', 'day', 'year']);
    expect(formatDateInput('2026-10-04', 'en-AU')).toBe('04/10/2026');
    expect(formatDateInput('2026-10-04', 'en-US')).toBe('10/04/2026');
  });

  it('parses typed dates in the household format', () => {
    expect(parseDateInput('4/10/2026', 'en-AU')).toBe('2026-10-04');
    expect(parseDateInput('04/10/26', 'en-AU')).toBe('2026-10-04');
    expect(parseDateInput('2026-10-04', 'en-AU')).toBe('2026-10-04');
    expect(parseDateInput('31/02/2026', 'en-AU')).toBeNull();
    expect(parseDateInput('10/04/2026', 'en-US')).toBe('2026-10-04');
  });

  it('never shifts a date-only value across time zones', () => {
    expect(formatDate('2026-01-01', 'en-AU', 'short')).toBe('01/01/2026');
  });
});

describe('percentages', () => {
  it('counts in exact hundredths', () => {
    expect(percentToHundredths('60')).toBe(6000);
    expect(percentToHundredths('12.5')).toBe(1250);
    expect(percentToHundredths('33.33')).toBe(3333);
    expect(percentToHundredths('1.234')).toBeNull();
    expect(formatHundredths(10000)).toBe('100.00');
    expect(formatHundredths(1250)).toBe('12.50');
  });
});
