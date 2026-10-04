import { Decimal } from 'decimal.js';

/**
 * Money is always an integer number of cents. JavaScript numbers hold integers
 * exactly up to 2^53, which is about $90 trillion in cents — far beyond any
 * household figure — so cents travel as `number` and are checked at the edges.
 * Interest and percentage maths use decimal.js and round to cents only at the end.
 */
export type Cents = number;

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export { D as Dec };
export type DecimalValue = Decimal.Value;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertCents(value: unknown, label = 'amount'): asserts value is Cents {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a whole number of cents`);
  }
}

/** Converts a BIGINT column value to cents, refusing values that lose precision. */
export function centsFromBigInt(value: bigint): Cents {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new MoneyError('amount out of range');
  return n;
}

/** decimal.js ROUND_HALF_UP rounds ties away from zero, which is the rule in spec §3.1. */
export function roundToCents(value: Decimal.Value): Cents {
  const n = new D(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  assertCents(n);
  return n;
}

/** Rounds up (towards +∞) to the cent — used where a target must be reached. */
export function ceilToCents(value: Decimal.Value): Cents {
  const n = new D(value).toDecimalPlaces(0, Decimal.ROUND_CEIL).toNumber();
  assertCents(n);
  return n;
}

/** Percentage of `part` in `whole`, rounded half away from zero to 2 dp. Null when whole is 0. */
export function percentage(part: Cents, whole: Cents, dp = 2): number | null {
  if (whole === 0) return null;
  return new D(part).times(100).dividedBy(whole).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toNumber();
}

/** `amount × pct / 100`, rounded to the cent. */
export function percentOf(amount: Cents, pct: Decimal.Value): Cents {
  return roundToCents(new D(amount).times(pct).dividedBy(100));
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  assertCents(total, 'total');
  return total;
}

/**
 * Parses user-entered money such as "1,234.50", "$1234.5", "-12" or "(12.00)".
 * Returns signed cents, or null when the text is not a money amount.
 */
export function parseMoney(input: string): Cents | null {
  let s = input.trim();
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^[A-Z]{3}\s*/i, '').replace(/^[$€£¥]/, '').replace(/\s/g, '');
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d{0,2})?$/.test(s) || s === '' || s === '.') return null;
  const cents = roundToCents(new D(s.replace(/,/g, '')).times(100));
  return negative ? -cents : cents;
}
