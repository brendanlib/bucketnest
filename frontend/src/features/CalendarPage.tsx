import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useCalendar } from '../api/hooks';
import type { CalendarItem } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { Modal } from '../components/Modal';
import { ErrorState, Loading } from '../components/States';
import { Money } from '../components/Money';
import { Icon } from '../components/Icon';
import { formatDate, todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';
import { bucketColour } from '../lib/colours';
import { OccurrenceActions, OccurrenceStatusBadge } from './OccurrenceActions';

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The month grid: weeks start on the household's week start day (Monday by default). */
function monthGrid(year: number, month: number, weekStart: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dow = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
  const lead = (dow - weekStart + 7) % 7;
  const start = new Date(first.getTime() - lead * 86_400_000);
  const days: string[] = [];
  for (let i = 0; i < 42; i++) days.push(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  // Drop a trailing week that is entirely next month.
  return days.slice(0, days[35]!.slice(5, 7) === pad(month) ? 42 : 35);
}

function ItemLabel({ item }: { item: CalendarItem }) {
  const posted = item.status === 'posted';
  return (
    <span className={`cal-item ${item.kind}${posted ? ' posted' : ''}${item.status === 'skipped' ? ' skipped' : ''}`}>
      <span className="dot" style={{ background: item.colour ? bucketColour(item.colour) : 'var(--series-muted)' }} aria-hidden="true" />
      <span className="truncate">{item.title}</span>
    </span>
  );
}

export function CalendarPage() {
  const { timezone, locale, me } = useHousehold();
  const today = todayIn(timezone);
  const [cursor, setCursor] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [y, m] = cursor.split('-').map(Number) as [number, number];
  const weekStart = 1;
  const days = useMemo(() => monthGrid(y, m, weekStart), [y, m]);
  const cal = useCalendar(days[0]!, days.at(-1)!);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const i of cal.data ?? []) map.set(i.date, [...(map.get(i.date) ?? []), i]);
    return map;
  }, [cal.data]);
  const move = (n: number) => {
    const total = y * 12 + (m - 1) + n;
    setCursor(`${Math.floor(total / 12)}-${pad((total % 12) + 1)}`);
  };
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  const inMonth = (cal.data ?? []).filter((i) => i.date.slice(0, 7) === cursor);
  void me;

  return (
    <>
      <PageHeader
        title="Calendar"
        actions={
          <div className="row">
            <button type="button" className="btn icon" aria-label="Previous month" onClick={() => move(-1)}><Icon name="chevronLeft" /></button>
            <strong style={{ minWidth: 150, textAlign: 'center' }} aria-live="polite">{monthName}</strong>
            <button type="button" className="btn icon" aria-label="Next month" onClick={() => move(1)}><Icon name="chevronRight" /></button>
            {cursor !== today.slice(0, 7) ? <button type="button" className="btn small" onClick={() => setCursor(today.slice(0, 7))}>Today</button> : null}
          </div>
        }
      />
      <PageTip id="calendar" title="What’s on the calendar">
        Pay, bills, repayments and transfers from your schedules, plus sinking fund due dates and goal targets. Solid items have been recorded; outlined ones are still to come. Tap a day to mark things paid or skip them.
      </PageTip>
      {cal.isPending ? (
        <Loading />
      ) : cal.isError ? (
        <ErrorState error={cal.error} onRetry={() => cal.refetch()} />
      ) : (
        <>
          <div className="card cal-card" style={{ padding: 0 }}>
            <div className="cal-grid" role="grid" aria-label={monthName}>
              {WEEKDAYS.map((d) => <div key={d} className="cal-head" role="columnheader">{d}</div>)}
              {days.map((d) => {
                const items = byDay.get(d) ?? [];
                const other = d.slice(0, 7) !== cursor;
                return (
                  <button
                    key={d}
                    type="button"
                    role="gridcell"
                    className={`cal-day${other ? ' other' : ''}${d === today ? ' today' : ''}`}
                    aria-label={`${formatDate(d, locale, 'long')}${items.length ? `, ${items.length} item${items.length === 1 ? '' : 's'}` : ''}`}
                    onClick={() => setDay(d)}
                  >
                    <span className="cal-num">{Number(d.slice(8))}</span>
                    {items.slice(0, 3).map((i) => <ItemLabel key={i.id} item={i} />)}
                    {items.length > 3 ? <span className="muted small">+{items.length - 3} more</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="row wrap small muted" style={{ padding: '0.6rem 1rem', gap: '1rem' }}>
              <span className="cal-item posted"><span className="dot" style={{ background: 'var(--series-muted)' }} /> Recorded</span>
              <span className="cal-item"><span className="dot" style={{ background: 'var(--series-muted)' }} /> Coming up</span>
              <span>Colour = bucket</span>
            </div>
          </div>

          {/* Agenda list: the mobile view (and a readable list on desktop). */}
          <section className="card cal-agenda" aria-label={`${monthName} agenda`}>
            {inMonth.length === 0 ? <p className="muted small">Nothing scheduled this month.</p> : null}
            {inMonth.map((i) => (
              <button key={`${i.kind}-${i.id}`} type="button" className="list-item" style={{ width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--border)', textAlign: 'left' }} onClick={() => setDay(i.date)}>
                <span className="num small" style={{ width: 56 }}>{formatDate(i.date, locale, 'medium').replace(/ \d{4}$/, '')}</span>
                <ItemLabel item={i} />
                <span className="spacer" />
                <Money cents={i.amountCents} />
              </button>
            ))}
          </section>
        </>
      )}
      {day ? <DayPanel date={day} items={byDay.get(day) ?? []} onClose={() => setDay(null)} /> : null}
    </>
  );
}

function DayPanel({ date, items, onClose }: { date: string; items: CalendarItem[]; onClose: () => void }) {
  const { locale } = useHousehold();
  return (
    <Modal title={formatDate(date, locale, 'long')} onClose={onClose}>
      {items.length === 0 ? (
        <p className="muted">Nothing on this day.</p>
      ) : (
        <div className="stack-sm">
          {items.map((i) => (
            <div key={`${i.kind}-${i.id}`} className="stack-sm" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem' }}>
              <div className="row">
                <ItemLabel item={i} />
                <span className="spacer" />
                <Money cents={i.amountCents} />
              </div>
              {i.occurrence ? (
                <div className="row wrap">
                  <OccurrenceStatusBadge status={i.occurrence.status} />
                  <span className="spacer" />
                  <OccurrenceActions occurrence={i.occurrence} compact />
                </div>
              ) : (
                <div className="row small">
                  <span className="muted">{i.kind === 'sinking_fund' ? 'Sinking fund due date' : 'Goal target date'}</span>
                  <span className="spacer" />
                  <Link to={i.kind === 'sinking_fund' ? '/sinking-funds' : '/fire-extinguisher'} onClick={onClose}>Open</Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
