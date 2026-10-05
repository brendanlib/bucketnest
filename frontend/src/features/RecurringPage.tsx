import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api/client';
import { MONEY_QUERIES, useApiMutation, useOccurrences, useRecurring } from '../api/hooks';
import type { Recurring, RecurringType } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog } from '../components/Modal';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Money } from '../components/Money';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { addDaysIso, formatDate, relativeDays, todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';
import { strings } from '../locales/en-AU';
import { RecurringForm } from './RecurringForm';
import { OccurrenceActions, OccurrenceStatusBadge } from './OccurrenceActions';

const SECTIONS: { title: string; types: RecurringType[] }[] = [
  { title: 'Income', types: ['INCOME'] },
  { title: 'Bills and expenses', types: ['EXPENSE'] },
  { title: 'Debt repayments', types: ['DEBT_REPAYMENT'] },
  { title: 'Transfers and savings', types: ['TRANSFER', 'SAVINGS_CONTRIBUTION'] },
];

export function describeFrequency(r: Pick<Recurring, 'frequency' | 'interval'>): string {
  if (r.frequency === 'EVERY_N_DAYS') return `Every ${r.interval} days`;
  if (r.frequency === 'EVERY_N_WEEKS') return `Every ${r.interval} weeks`;
  if (r.frequency === 'EVERY_N_MONTHS') return `Every ${r.interval} months`;
  return strings.frequencies[r.frequency] ?? r.frequency;
}

export function ScheduleRow({ r, onEdit, onDelete }: { r: Recurring; onEdit: () => void; onDelete?: () => void }) {
  const { locale, timezone } = useHousehold();
  const today = todayIn(timezone);
  return (
    <div className="list-item">
      <div className="grow">
        <div className="row wrap" style={{ gap: '0.4rem' }}>
          <strong className={r.isActive ? undefined : 'muted'}>{r.name}</strong>
          {r.amountKind === 'ESTIMATE' ? <span className="badge">Estimate</span> : null}
          {r.autoPost ? <span className="badge ok">Auto-post</span> : null}
          {!r.isActive ? <span className="badge">Paused</span> : null}
        </div>
        <div className="muted small truncate">
          {describeFrequency(r)} · {r.accountName}
          {r.toAccountName ? ` → ${r.toAccountName}` : ''}
          {r.categoryName ? ` · ${r.categoryName}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <Money cents={r.amountCents} />
        <div className="small muted">
          {r.nextOccurrence ? (
            <span className={r.nextOccurrence.overdue ? 'neg' : undefined}>
              Next {formatDate(r.nextOccurrence.date, locale)} ({relativeDays(r.nextOccurrence.date, today)})
            </span>
          ) : r.isActive ? (
            'Finished'
          ) : (
            '—'
          )}
        </div>
      </div>
      <button type="button" className="btn ghost small" onClick={onEdit}>
        Edit
      </button>
      {onDelete ? (
        <button type="button" className="btn ghost icon" aria-label={`Delete ${r.name}`} onClick={onDelete}>
          <Icon name="trash" />
        </button>
      ) : null}
    </div>
  );
}

export function RecurringPage() {
  const { locale, timezone } = useHousehold();
  const today = todayIn(timezone);
  const schedules = useRecurring();
  const upcoming = useOccurrences(addDaysIso(today, -31), addDaysIso(today, 30));
  const [params, setParams] = useSearchParams();
  const addType = params.get('add') as RecurringType | null;
  const [editing, setEditing] = useState<Recurring | { type: RecurringType } | null>(addType ? { type: addType } : null);
  const [deleting, setDeleting] = useState<Recurring | null>(null);
  const toast = useToast();
  const remove = useApiMutation((id: string) => api.delete(`/recurring-transactions/${id}`), MONEY_QUERIES);

  if (schedules.isPending) return <Loading />;
  if (schedules.isError) return <ErrorState error={schedules.error} onRetry={() => schedules.refetch()} />;

  const pending = (upcoming.data ?? []).filter((o) => o.status !== 'posted' && o.status !== 'skipped');

  return (
    <>
      <PageHeader
        title="Recurring"
        subtitle="Pay, bills, repayments and transfers that repeat. They show up on the dashboard and are recorded when they happen."
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing({ type: 'EXPENSE' })}>
            <Icon name="plus" /> New schedule
          </button>
        }
      />
      <PageTip id="recurring" title="Schedules plan, transactions record">
        A schedule shows what’s coming but never creates future transactions. Your income schedules set how much each bucket is allocated, so start with your pay.
      </PageTip>
      <div className="dash-grid">
        <div className="stack">
          {schedules.data.length === 0 ? (
            <div className="card">
              <EmptyState
                title="No schedules yet"
                action={
                  <button type="button" className="btn primary" onClick={() => setEditing({ type: 'INCOME' })}>
                    Add your pay
                  </button>
                }
              >
                Start with your pay. Your expected income drives the bucket allocations.
              </EmptyState>
            </div>
          ) : (
            SECTIONS.map((s) => {
              const list = schedules.data.filter((r) => s.types.includes(r.type));
              return (
                <section key={s.title} className="card" aria-labelledby={`rs-${s.title}`}>
                  <div className="card-header">
                    <h2 id={`rs-${s.title}`}>{s.title}</h2>
                    <span className="spacer" />
                    <button type="button" className="btn small" onClick={() => setEditing({ type: s.types[0]! })}>
                      Add
                    </button>
                  </div>
                  {list.length ? list.map((r) => <ScheduleRow key={r.id} r={r} onEdit={() => setEditing(r)} onDelete={() => setDeleting(r)} />) : <p className="muted small">None</p>}
                </section>
              );
            })
          )}
        </div>
        <section className="card" aria-labelledby="upcoming-h">
          <div className="card-header">
            <h2 id="upcoming-h">To record</h2>
          </div>
          {upcoming.isPending ? (
            <Loading />
          ) : pending.length === 0 ? (
            <p className="muted small">Nothing due in the next 30 days.</p>
          ) : (
            pending.map((o) => (
              <div key={`${o.recurringId}-${o.occurrenceDate}`} className="stack-sm" style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
                <div className="row">
                  <div className="grow">
                    <strong>{o.name}</strong>
                    <div className="muted small">
                      {formatDate(o.date, locale)} · {relativeDays(o.date, today)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Money cents={o.amountCents} />
                    <div>
                      <OccurrenceStatusBadge status={o.status} />
                    </div>
                  </div>
                </div>
                <OccurrenceActions occurrence={o} compact />
              </div>
            ))
          )}
        </section>
      </div>
      {editing ? (
        <RecurringForm
          schedule={'id' in editing ? editing : undefined}
          defaultType={'id' in editing ? undefined : editing.type}
          onClose={() => {
            setEditing(null);
            if (params.has('add')) setParams({}, { replace: true });
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="Future occurrences disappear. Transactions already recorded are kept."
          busy={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast('Schedule deleted');
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}
