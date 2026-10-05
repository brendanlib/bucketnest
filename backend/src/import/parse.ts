import { Dec, type Cents } from '../finance/money.js';
import { formatDateOnly, isValidDateOnly, type DateOnly } from '../finance/dates.js';

export type DateFormat = 'DD/MM/YYYY' | 'D/M/YY' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD MMM YYYY';
export const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'D/M/YY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD MMM YYYY'];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function year(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

/** Parses a bank date in the given format. Separators /, -, . and spaces are all accepted. */
export function parseBankDate(value: string, format: DateFormat): DateOnly | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  if (format === 'DD MMM YYYY') {
    const match = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3})[A-Za-z]*[\s\-/.,]+(\d{2,4})$/.exec(v);
    if (!match) return null;
    m = MONTHS.indexOf(match[2]!.toLowerCase()) + 1;
    if (m === 0) return null;
    d = Number(match[1]);
    y = year(match[3]!);
  } else if (format === 'YYYY-MM-DD') {
    const match = /^(\d{4})[\-/.](\d{1,2})[\-/.](\d{1,2})(?:[T\s].*)?$/.exec(v);
    if (!match) return null;
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    const match = /^(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})(?:\s.*)?$/.exec(v);
    if (!match) return null;
    const [a, b] = [Number(match[1]), Number(match[2])];
    [d, m] = format === 'MM/DD/YYYY' ? [b, a] : [a, b];
    y = year(match[3]!);
  }
  const iso = formatDateOnly(y, m, d);
  return isValidDateOnly(iso) ? iso : null;
}

/** Signed cents from a bank amount cell: "$1,234.50", "-12.00", "(12.00)", "12.00 CR", "12.00 DR". */
export function parseBankAmount(value: string): Cents | null {
  let s = value.trim().replace(/\s+/g, ' ');
  if (s === '') return null;
  let sign = 1;
  const suffix = /\s?(CR|DR)$/i.exec(s);
  if (suffix) {
    if (suffix[1]!.toUpperCase() === 'DR') sign = -1;
    s = s.slice(0, suffix.index).trim();
  }
  if (/^\(.*\)$/.test(s)) {
    sign = -sign;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1).trim();
  } else if (s.endsWith('-')) {
    sign = -sign;
    s = s.slice(0, -1).trim();
  } else if (s.startsWith('+')) s = s.slice(1).trim();
  s = s.replace(/^[A-Z]{3}\s?/i, '').replace(/^[$€£]/, '').replace(/,/g, '').replace(/\s/g, '');
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const cents = new Dec(s).times(100);
  if (!cents.isInteger()) return null;
  const n = cents.toNumber();
  if (!Number.isSafeInteger(n)) return null;
  return sign * n;
}

/** Upper-case, single-spaced description used for fingerprints and rule matching. */
export function normaliseDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}
