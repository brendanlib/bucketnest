import { describe, expect, it } from 'vitest';
import { centsToDecimal, toCsv } from './csv.js';

describe('csv export', () => {
  it('quotes, escapes and neutralises formulas', () => {
    const csv = toCsv(
      [
        { name: 'Groceries, food', amount: 123456, note: 'He said "hi"' },
        { name: '=HYPERLINK("x")', amount: -5, note: null },
      ],
      [
        { label: 'Name', value: (r) => r.name },
        { label: 'Amount', value: (r) => centsToDecimal(r.amount) },
        { label: 'Note', value: (r) => r.note },
      ],
    );
    expect(csv).toBe('Name,Amount,Note\r\n"Groceries, food",1234.56,"He said ""hi"""\r\n"\'=HYPERLINK(""x"")",-0.05,\r\n');
  });

  it('formats cents as decimals', () => {
    expect(centsToDecimal(0)).toBe('0.00');
    expect(centsToDecimal(7)).toBe('0.07');
    expect(centsToDecimal(-123456)).toBe('-1234.56');
  });
});
