import { DATE_FORMATS, parseBankAmount, parseBankDate, type DateFormat } from './parse.js';

export type SignConvention = 'NEGATIVE_IS_DEBIT' | 'POSITIVE_IS_DEBIT' | 'DEBIT_CREDIT_COLUMNS';

export interface ColumnMapping {
  delimiter: string;
  hasHeader: boolean;
  dateFormat: DateFormat;
  signConvention: SignConvention;
  dateColumn: number;
  descriptionColumn: number;
  amountColumn?: number | null;
  debitColumn?: number | null;
  creditColumn?: number | null;
  balanceColumn?: number | null;
  payeeColumn?: number | null;
}

const HEADER_HINTS: Record<'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'payee', RegExp> = {
  date: /^(transaction |posted |value |effective )?date$|^date/i,
  description: /description|narrative|details|transaction details|particulars|memo|reference/i,
  amount: /^amount|^value$|^aud$|amount \(aud\)/i,
  debit: /debit|withdrawal|money out|paid out/i,
  credit: /credit|deposit|money in|paid in/i,
  balance: /balance/i,
  payee: /payee|merchant|counterparty/i,
};

const share = (values: string[], test: (v: string) => boolean) =>
  values.length === 0 ? 0 : values.filter((v) => v.trim() !== '' && test(v)).length / values.filter((v) => v.trim() !== '').length || 0;

/** The date format that parses the most values in a column (ties: the default DD/MM/YYYY first). */
export function guessDateFormat(values: string[]): DateFormat {
  let best: DateFormat = 'DD/MM/YYYY';
  let bestShare = -1;
  for (const f of DATE_FORMATS) {
    const s = share(values, (v) => parseBankDate(v, f) !== null);
    if (s > bestShare) {
      best = f;
      bestShare = s;
    }
  }
  return best;
}

/** A header row has no cell that looks like a date or an amount, while the next row does. */
export function detectHeader(rows: string[][]): boolean {
  const [first, second] = rows;
  if (!first) return false;
  const looksData = (r: string[]) => r.some((c) => DATE_FORMATS.some((f) => parseBankDate(c, f) !== null)) || r.some((c) => /\d/.test(c) && parseBankAmount(c) !== null);
  if (looksData(first)) return false;
  return second ? looksData(second) : true;
}

/** Best-guess column mapping from header names, or from the data when there is no header. */
export function guessMapping(rows: string[][], delimiter: string): ColumnMapping {
  const hasHeader = detectHeader(rows);
  const header = hasHeader ? rows[0]! : [];
  const data = rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 50);
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const col = (i: number) => data.map((r) => r[i] ?? '');
  const byHeader = (key: keyof typeof HEADER_HINTS, exclude: number[] = []) =>
    header.findIndex((h, i) => !exclude.includes(i) && HEADER_HINTS[key].test(h));

  const dateShare = (i: number) => Math.max(...DATE_FORMATS.map((f) => share(col(i), (v) => parseBankDate(v, f) !== null)));
  const amountShare = (i: number) => share(col(i), (v) => /\d/.test(v) && parseBankAmount(v) !== null);

  let dateColumn = byHeader('date');
  if (dateColumn < 0 || dateShare(dateColumn) < 0.8) {
    dateColumn = [...Array(width).keys()].sort((a, b) => dateShare(b) - dateShare(a))[0] ?? 0;
  }
  let debitColumn = byHeader('debit', [dateColumn]);
  let creditColumn = byHeader('credit', [dateColumn, debitColumn]);
  let amountColumn = byHeader('amount', [dateColumn, debitColumn, creditColumn]);
  const balanceColumn = byHeader('balance', [dateColumn, amountColumn, debitColumn, creditColumn]);
  const payeeColumn = byHeader('payee', [dateColumn, amountColumn, debitColumn, creditColumn, balanceColumn]);
  let descriptionColumn = byHeader('description', [dateColumn, amountColumn, debitColumn, creditColumn, balanceColumn, payeeColumn]);

  const used = new Set([dateColumn, balanceColumn, payeeColumn].filter((i) => i >= 0));
  if (amountColumn < 0 && (debitColumn < 0 || creditColumn < 0)) {
    debitColumn = -1;
    creditColumn = -1;
    // The first mostly-numeric column that is not the date or balance.
    amountColumn = [...Array(width).keys()].find((i) => !used.has(i) && dateShare(i) < 0.5 && amountShare(i) >= 0.8) ?? -1;
  }
  if (descriptionColumn < 0) {
    const taken = new Set([dateColumn, amountColumn, debitColumn, creditColumn, balanceColumn, payeeColumn]);
    const avgLen = (i: number) => col(i).reduce((s, v) => s + (/[A-Za-z]/.test(v) ? v.length : 0), 0);
    descriptionColumn = [...Array(width).keys()].filter((i) => !taken.has(i)).sort((a, b) => avgLen(b) - avgLen(a))[0] ?? 0;
  }

  const useColumns = amountColumn < 0 && debitColumn >= 0 && creditColumn >= 0;
  return {
    delimiter,
    hasHeader,
    dateFormat: guessDateFormat(col(dateColumn)),
    signConvention: useColumns ? 'DEBIT_CREDIT_COLUMNS' : 'NEGATIVE_IS_DEBIT',
    dateColumn,
    descriptionColumn,
    amountColumn: useColumns ? null : amountColumn >= 0 ? amountColumn : null,
    debitColumn: useColumns ? debitColumn : null,
    creditColumn: useColumns ? creditColumn : null,
    balanceColumn: balanceColumn >= 0 ? balanceColumn : null,
    payeeColumn: payeeColumn >= 0 ? payeeColumn : null,
  };
}

export interface ParsedRow {
  index: number;
  raw: string[];
  date: string | null;
  description: string;
  payee: string | null;
  /** Positive amount. */
  amountCents: number | null;
  /** Money out of the account (debit) or into it (credit). */
  direction: 'debit' | 'credit' | null;
  balanceCents: number | null;
  errors: string[];
}

/** Applies a mapping to the data rows. Row index is the position among data rows (header excluded). */
export function applyMapping(rows: string[][], m: ColumnMapping): ParsedRow[] {
  const data = m.hasHeader ? rows.slice(1) : rows;
  return data.map((raw, index) => {
    const errors: string[] = [];
    const cell = (i: number | null | undefined) => (i === null || i === undefined || i < 0 ? '' : (raw[i] ?? ''));
    const dateText = cell(m.dateColumn);
    const date = parseBankDate(dateText, m.dateFormat);
    if (!date) errors.push(dateText ? `“${dateText}” is not a ${m.dateFormat} date` : 'Missing date');
    else if (date < '1900-01-01' || date > '2100-12-31') errors.push('Date out of range');

    let signed: number | null = null;
    if (m.signConvention === 'DEBIT_CREDIT_COLUMNS') {
      const debit = cell(m.debitColumn) ? parseBankAmount(cell(m.debitColumn)) : 0;
      const credit = cell(m.creditColumn) ? parseBankAmount(cell(m.creditColumn)) : 0;
      if (debit === null || credit === null) errors.push('Amount is not a number');
      else signed = Math.abs(credit) - Math.abs(debit);
    } else {
      const text = cell(m.amountColumn);
      const parsed = text ? parseBankAmount(text) : null;
      if (parsed === null) errors.push(text ? `“${text}” is not an amount` : 'Missing amount');
      else signed = m.signConvention === 'POSITIVE_IS_DEBIT' ? -parsed : parsed;
    }
    if (signed === 0) errors.push('Amount is zero');

    const description = cell(m.descriptionColumn).replace(/\s+/g, ' ').trim();
    if (!description) errors.push('Missing description');
    const balanceText = cell(m.balanceColumn);
    const balanceCents = balanceText ? parseBankAmount(balanceText) : null;

    return {
      index,
      raw,
      date,
      description: description.slice(0, 300),
      payee: cell(m.payeeColumn) ? cell(m.payeeColumn).slice(0, 200) : null,
      amountCents: signed === null || signed === 0 ? null : Math.abs(signed),
      direction: signed === null || signed === 0 ? null : signed < 0 ? 'debit' : 'credit',
      balanceCents,
      errors,
    };
  });
}
