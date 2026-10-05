/** CSV for report exports: RFC 4180 quoting, money as plain decimals for spreadsheets. */
export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
}

const escape = (v: string) => (/[",\r\n]/.test(v) || /^[=+\-@\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Builds a CSV. Text that a spreadsheet would treat as a formula (=, +, -, @)
 * is quoted and prefixed with an apostrophe so it stays text.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    if (/^-?\d+(\.\d+)?$/.test(v)) return v; // plain numbers, including negative amounts
    return escape(/^[=+\-@\t]/.test(v) ? `'${v}` : v);
  };
  return [columns.map((c) => escape(c.label)), ...rows.map((r) => columns.map((c) => cell(c.value(r))))].map((r) => r.join(',')).join('\r\n') + '\r\n';
}

/** Cents as a plain decimal: 123456 → "1234.56", -5 → "-0.05". */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
