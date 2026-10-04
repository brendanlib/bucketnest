/**
 * Formatting only: the API sends integer cents and YYYY-MM-DD dates, and the
 * UI turns them into text. No financial calculations happen here.
 */
export interface FormatContext {
  currency: string;
  locale: string;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number, ctx: FormatContext, opts: { signDisplay?: 'auto' | 'always' | 'exceptZero'; compact?: boolean } = {}): string {
  const key = `${ctx.locale}|${ctx.currency}|${opts.signDisplay ?? 'auto'}|${opts.compact ? 'c' : ''}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(ctx.locale, {
      style: 'currency',
      currency: ctx.currency,
      signDisplay: opts.signDisplay ?? 'auto',
      ...(opts.compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}),
    });
    moneyFormatters.set(key, f);
  }
  // Cents → major units for display only. Division by 100 is exact enough for formatting.
  return f.format(cents / 100);
}

/** Formats cents as a plain editable number, e.g. 123450 → "1,234.50". */
export function formatMoneyInput(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

/**
 * Parses what people type in a money field: "1,234.50", "$1234.5", "-12".
 * Returns integer cents, or null if it is not a money amount. String maths,
 * not floats, so "0.29" is exactly 29 cents.
 */
export function parseMoneyInput(input: string): number | null {
  let s = input.trim().replace(/^[A-Z]{3}\s*/i, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/^[$€£¥]/, '').replace(/[\s,]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  const whole = Number(m[1] || '0');
  const frac = Number(((m[2] ?? '') + '00').slice(0, 2));
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** The household's date order, e.g. en-AU → ["day","month","year"]. */
export function dateOrder(locale: string): ('day' | 'month' | 'year')[] {
  const parts = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).formatToParts(
    new Date(Date.UTC(2006, 0, 2)),
  );
  return parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.type as 'day' | 'month' | 'year');
}

export function datePlaceholder(locale: string): string {
  return dateOrder(locale)
    .map((p) => (p === 'day' ? 'DD' : p === 'month' ? 'MM' : 'YYYY'))
    .join('/');
}

/** "2026-10-04" → "04/10/2026" in en-AU. */
export function formatDateInput(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return dateOrder(locale)
    .map((p) => (p === 'day' ? d : p === 'month' ? m : y))
    .join('/');
}

/** Parses a date typed in the household's format into YYYY-MM-DD. Accepts 2-digit years and ISO. */
export function parseDateInput(input: string, locale: string): string | null {
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return validIso(s);
  const bits = s.split(/[/.\-\s]+/).filter(Boolean);
  if (bits.length !== 3 || bits.some((b) => !/^\d+$/.test(b))) return null;
  const order = dateOrder(locale);
  const get = (k: 'day' | 'month' | 'year') => Number(bits[order.indexOf(k)]);
  let year = get('year');
  if (year < 100) year += 2000;
  const iso = `${String(year).padStart(4, '0')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`;
  return validIso(iso);
}

function validIso(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Display a date-only value. Formatted in UTC so it never shifts a day. */
export function formatDate(iso: string, locale: string, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : style === 'medium'
        ? { day: 'numeric', month: 'short', year: 'numeric' }
        : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(d);
}

export function formatDateTime(isoInstant: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(isoInstant));
}

/** Today's date in the household time zone. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Percentage strings like "60.00" → hundredths (6000), so totals are exact integers. */
export function percentToHundredths(value: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{0,2}))?\s*$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
}

export function formatHundredths(h: number): string {
  return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
}
