/** Date-range presets for reports (spec §12). Calendar arithmetic only. */
export type Preset = 'this-month' | 'last-month' | 'fy-to-date' | 'last-fy' | 'last-12' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function presetRange(preset: Exclude<Preset, 'custom'>, today: string, fyStartMonth: number): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (preset) {
    case 'this-month':
      return { from: iso(y, m, 1), to: today };
    case 'last-month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
    }
    case 'fy-to-date': {
      const fy = m >= fyStartMonth ? y : y - 1;
      return { from: iso(fy, fyStartMonth, 1), to: today };
    }
    case 'last-fy': {
      const fy = (m >= fyStartMonth ? y : y - 1) - 1;
      const endY = fyStartMonth === 1 ? fy : fy + 1;
      const endM = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
      return { from: iso(fy, fyStartMonth, 1), to: iso(endY, endM, lastDay(endY, endM)) };
    }
    case 'last-12': {
      const total = y * 12 + (m - 1) - 11;
      return { from: iso(Math.floor(total / 12), (total % 12) + 1, 1), to: today };
    }
  }
}

export const PRESET_LABELS: Record<Preset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'fy-to-date': 'Financial year to date',
  'last-fy': 'Last financial year',
  'last-12': 'Last 12 months',
  custom: 'Custom',
};

/** "2026-03" → "Mar 26" */
export function monthLabel(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Drops leading points before there was any data, so charts don’t open with a run of misleading zeros. If nothing has data, all rows are kept so the axis still shows the range. */
export function trimLeading<T>(rows: T[], isEmpty: (row: T) => boolean): T[] {
  const first = rows.findIndex((r) => !isEmpty(r));
  return first <= 0 ? rows : rows.slice(first);
}
