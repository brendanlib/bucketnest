import { useState } from 'react';
import { useDashboard, useOccurrences, useRecurring } from '../api/hooks';
import type { Occurrence, Recurring } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Money } from '../components/Money';
import { Icon } from '../components/Icon';
import { formatDate, formatPeriod, relativeDays } from '../lib/format';
import { useHousehold } from '../lib/household';
import { RecurringForm } from './RecurringForm';
import { OccurrenceActions, OccurrenceStatusBadge } from './OccurrenceActions';
import { describeFrequency } from './RecurringPage';

/** Bills-bucket schedules: next due, amount, and what's paid this budget period (spec §9). */
export function BillsPage() {
  const { locale } = useHousehold();
  const dashboard = useDashboard();
  const schedules = useRecurring();
  const period = dashboard.data?.period;
  const occurrences = useOccurrences(period?.start ?? '1900-01-01', period?.end ?? '1900-01-01');
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);

  if (schedules.isPending || dashboard.isPending) return <Loading />;
  if (schedules.isError) return <ErrorState error={schedules.error} onRetry={() => schedules.refetch()} />;
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />;

  const today = dashboard.data.period.today;
  const bills = schedules.data.filter((r) => r.bucketKey === 'BILLS' && (r.type === 'EXPENSE' || r.type === 'DEBT_REPAYMENT'));
  const thisPeriod = (id: string) => (occurrences.data ?? []).filter((o) => o.recurringId === id);
  const nextUnpaid = (r: Recurring): Occurrence | null =>
    r.nextOccurrence
      ? {
          recurringId: r.id,
          name: r.name,
          type: r.type,
          amountKind: r.amountKind,
          accountName: r.accountName,
          toAccountName: r.toAccountName,
          categoryName: r.categoryName,
          bucketKey: r.bucketKey,
          autoPost: r.autoPost,
          occurrenceDate: r.nextOccurrence.occurrenceDate,
          date: r.nextOccurrence.date,
          amountCents: r.nextOccurrence.amountCents,
          skipped: false,
          edited: false,
          status: r.nextOccurrence.overdue ? 'overdue' : r.nextOccurrence.date === today ? 'due' : 'upcoming',
          transactionId: null,
        }
      : null;

  return (
    <>
      <PageHeader
        title="Bills"
        subtitle={`Regular Bills-bucket costs. This period: ${formatPeriod(dashboard.data.period.start, dashboard.data.period.end, locale)}.`}
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Add bill
          </button>
        }
      />
      <div className="card" style={{ padding: bills.length ? 0 : undefined }}>
        {bills.length === 0 ? (
          <EmptyState
            title="No bills yet"
            action={
              <button type="button" className="btn primary" onClick={() => setEditing('new')}>
                Add a bill
              </button>
            }
          >
            Add rent or mortgage, utilities, insurance and subscriptions so they show up before they’re due.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Next due</th>
                  <th className="right">Amount</th>
                  <th>This period</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bills.map((r) => {
                  const next = nextUnpaid(r);
                  const inPeriod = thisPeriod(r.id);
                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.name}</div>
                        <div className="muted small">
                          {describeFrequency(r)} · {r.categoryName ?? 'Debt repayment'}
                          {r.autoPost ? ' · auto-post' : ''}
                        </div>
                      </td>
                      <td className="small">
                        {next ? (
                          <>
                            <div className={next.status === 'overdue' ? 'neg' : undefined}>{formatDate(next.date, locale)}</div>
                            <div className="muted">{relativeDays(next.date, today)}</div>
                          </>
                        ) : (
                          <span className="muted">{r.isActive ? 'Finished' : 'Paused'}</span>
                        )}
                      </td>
                      <td className="right">
                        <Money cents={next?.amountCents ?? r.amountCents} />
                        <div className="small muted">{r.amountKind === 'ESTIMATE' ? 'estimate' : 'fixed'}</div>
                      </td>
                      <td>
                        {inPeriod.length === 0 ? (
                          <span className="muted small">Not due</span>
                        ) : (
                          <div className="stack-sm" style={{ gap: '0.25rem' }}>
                            {inPeriod.map((o) => (
                              <span key={o.occurrenceDate} className="row small" style={{ gap: '0.35rem' }}>
                                <OccurrenceStatusBadge status={o.status} />
                                <span className="muted">{formatDate(o.date, locale, 'short').slice(0, 5)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        {next ? <OccurrenceActions occurrence={next} compact /> : null}
                        <button type="button" className="btn ghost small" onClick={() => setEditing(r)}>
                          Schedule
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing ? <RecurringForm schedule={editing === 'new' ? undefined : editing} defaultType="EXPENSE" onClose={() => setEditing(null)} /> : null}
    </>
  );
}
