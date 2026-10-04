import type { BudgetPeriodType } from './frequency.js';
import { addDays, daysInMonth, formatDateOnly, parseDateOnly, diffDays, type DateOnly } from './dates.js';

export interface Period {
  start: DateOnly;
  end: DateOnly;
}

function clampDay(year: number, month: number, day: number): DateOnly {
  return formatDateOnly(year, month, Math.min(day, daysInMonth(year, month)));
}

/**
 * The budget period containing `date` (spec §3.8). Weekly and fortnightly
 * periods repeat every 7/14 days from the anchor (a payday for fortnightly).
 * Monthly periods start on the anchor's day of the month, clamped at month
 * end; annual periods start on the anchor's day and month each year.
 */
export function periodContaining(type: BudgetPeriodType, anchor: DateOnly, date: DateOnly): Period {
  if (type === 'WEEKLY' || type === 'FORTNIGHTLY') {
    const len = type === 'WEEKLY' ? 7 : 14;
    const k = Math.floor(diffDays(date, anchor) / len);
    const start = addDays(anchor, k * len);
    return { start, end: addDays(start, len - 1) };
  }
  const a = parseDateOnly(anchor);
  const d = parseDateOnly(date);
  if (type === 'MONTHLY') {
    let y = d.year;
    let m = d.month;
    if (clampDay(y, m, a.day) > date) {
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
    }
    const start = clampDay(y, m, a.day);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return { start, end: addDays(clampDay(ny, nm, a.day), -1) };
  }
  let y = d.year;
  if (clampDay(y, a.month, a.day) > date) y -= 1;
  return { start: clampDay(y, a.month, a.day), end: addDays(clampDay(y + 1, a.month, a.day), -1) };
}

export function previousPeriod(type: BudgetPeriodType, anchor: DateOnly, period: Period): Period {
  return periodContaining(type, anchor, addDays(period.start, -1));
}

export function nextPeriod(type: BudgetPeriodType, anchor: DateOnly, period: Period): Period {
  return periodContaining(type, anchor, addDays(period.end, 1));
}

export function periodLengthDays(period: Period): number {
  return diffDays(period.end, period.start) + 1;
}

/** Calendar months [start, end] for the last `count` whole months ending with the month of `date`. */
export function lastMonthEnds(date: DateOnly, count: number): DateOnly[] {
  const d = parseDateOnly(date);
  const out: DateOnly[] = [];
  for (let i = count - 1; i >= 0; i--) {
    let y = d.year;
    let m = d.month - i;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    out.push(i === 0 ? date : formatDateOnly(y, m, daysInMonth(y, m)));
  }
  return out;
}
