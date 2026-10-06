import { useState } from 'react';
import { addDaysIso, formatDate } from '../lib/format';
import { useHousehold } from '../lib/household';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useApiMutation } from '../api/hooks';
import type { Occurrence, Transaction, TransactionDraft } from '../api/types';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Field';
import { FormError, errorMessage } from '../components/States';
import { useToast } from '../components/Toast';
import { TransactionForm } from './TransactionForm';

const base = (o: Pick<Occurrence, 'recurringId' | 'occurrenceDate'>) => `/recurring-transactions/${o.recurringId}/occurrences/${o.occurrenceDate}`;

/** Mark paid / received, skip (or move to the next period), reschedule, and edit one occurrence. */
export function OccurrenceActions({ occurrence, compact }: { occurrence: Occurrence; compact?: boolean }) {
  const toast = useToast();
  const [draft, setDraft] = useState<TransactionDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [viewing, setViewing] = useState<Transaction | null>(null);
  const unskip = useApiMutation(() => api.post(`${base(occurrence)}/unskip`), MONEY_QUERIES);
  const small = compact ? 'btn small' : 'btn small';
  const received = occurrence.type === 'INCOME';

  async function openMarkPaid() {
    try {
      setDraft(await api.get<TransactionDraft>(`${base(occurrence)}/draft`));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  if (occurrence.status === 'posted') {
    return (
      <>
        <button
          type="button"
          className="btn small ghost"
          onClick={async () => occurrence.transactionId && setViewing(await api.get<Transaction>(`/transactions/${occurrence.transactionId}`))}
        >
          View
        </button>
        {viewing ? <TransactionForm transaction={viewing} onClose={() => setViewing(null)} /> : null}
      </>
    );
  }
  if (occurrence.status === 'skipped') {
    return (
      <button
        type="button"
        className={`${small} ghost`}
        onClick={async () => {
          await unskip.mutateAsync(undefined);
          toast('Restored');
        }}
      >
        Un-skip
      </button>
    );
  }

  return (
    <span className="occurrence-actions">
      <button type="button" className={`${small} primary`} onClick={openMarkPaid}>
        {received ? 'Mark received' : 'Mark paid'}
      </button>
      <button type="button" className={small} onClick={() => setSkipping(true)}>
        Skip…
      </button>
      <button type="button" className={small} onClick={() => setRescheduling(true)} aria-label={`Reschedule this ${occurrence.name}`}>
        Reschedule
      </button>
      <button type="button" className={`${small} ghost`} onClick={() => setEditing(true)} aria-label={`Edit this ${occurrence.name} occurrence`}>
        Edit
      </button>
      {draft ? (
        <TransactionForm
          draft={draft}
          title={`${received ? 'Record' : 'Pay'} ${occurrence.name}`}
          submit={(body) => api.post<Transaction>(`${base(occurrence)}/post`, body)}
          onClose={() => setDraft(null)}
        />
      ) : null}
      {editing ? <EditOccurrenceDialog occurrence={occurrence} onClose={() => setEditing(false)} /> : null}
      {skipping ? <SkipDialog occurrence={occurrence} onClose={() => setSkipping(false)} /> : null}
      {rescheduling ? <RescheduleDialog occurrence={occurrence} onClose={() => setRescheduling(false)} /> : null}
    </span>
  );
}

/** Skip outright, or keep it but move it into the next budget period. */
function SkipDialog({ occurrence, onClose }: { occurrence: Occurrence; onClose: () => void }) {
  const toast = useToast();
  const { locale } = useHousehold();
  const skip = useApiMutation(() => api.post(`${base(occurrence)}/skip`), MONEY_QUERIES);
  const move = useApiMutation(() => api.post<{ date: string }>(`${base(occurrence)}/move-to-next-period`), MONEY_QUERIES);
  const next = occurrence.nextPeriodStart ? formatDate(occurrence.nextPeriodStart, locale, 'long') : null;
  const busy = skip.isPending || move.isPending;
  const run = async (fn: () => Promise<string>) => {
    try {
      toast(await fn());
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  return (
    <Modal
      title={`Skip ${occurrence.name} on ${formatDate(occurrence.date, locale)}?`}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <div className="stack">
        <p className="muted small">Only this one changes; the rest of the schedule carries on.</p>
        <button
          type="button"
          className="choice"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await move.mutateAsync(undefined);
              return `${occurrence.name} moved to ${formatDate(r.date, locale)}`;
            })
          }
        >
          <strong>Move to the next period{next ? ` (${next})` : ''}</strong>
          <span className="muted small">It still needs paying, just later. It leaves this period’s bills and budget and counts in the next one.</span>
        </button>
        <button
          type="button"
          className="choice"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await skip.mutateAsync(undefined);
              return `Skipped ${occurrence.name}`;
            })
          }
        >
          <strong>Skip it</strong>
          <span className="muted small">It isn’t happening this time (a free month, a cancelled class). You can un-skip it later.</span>
        </button>
      </div>
    </Modal>
  );
}

/** Moves just this occurrence to another date. */
function RescheduleDialog({ occurrence, onClose }: { occurrence: Occurrence; onClose: () => void }) {
  const toast = useToast();
  const { locale } = useHousehold();
  const [date, setDate] = useState(occurrence.date);
  const save = useApiMutation((d: string) => api.put(base(occurrence), { date: d }), MONEY_QUERIES);
  const picks: [string, string][] = [
    ['Tomorrow', addDaysIso(occurrence.date, 1)],
    ['A week later', addDaysIso(occurrence.date, 7)],
    ...(occurrence.nextPeriodStart ? ([['Start of next period', occurrence.nextPeriodStart]] as [string, string][]) : []),
  ];
  return (
    <Modal
      title={`Reschedule ${occurrence.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={save.isPending || !date || date === occurrence.date}
            onClick={async () => {
              try {
                await save.mutateAsync(date);
                toast(`${occurrence.name} moved to ${formatDate(date, locale)}`);
                onClose();
              } catch {
                /* shown */
              }
            }}
          >
            Move it
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">
          Due {formatDate(occurrence.date, locale, 'long')}. Only this one moves; the schedule stays as it is.
          {occurrence.edited && occurrence.date !== occurrence.occurrenceDate ? ` (Originally ${formatDate(occurrence.occurrenceDate, locale)}.)` : ''}
        </p>
        <FormError error={save.error instanceof ApiError ? save.error : null} />
        <div className="row wrap" role="group" aria-label="Quick picks">
          {picks.map(([label, d]) => (
            <button key={label} type="button" className="btn small" aria-pressed={date === d} onClick={() => setDate(d)}>
              {label}
            </button>
          ))}
        </div>
        <Field label="New date">{(p) => <DateInput {...p} value={date} onChange={setDate} />}</Field>
      </div>
    </Modal>
  );
}

function EditOccurrenceDialog({ occurrence, onClose }: { occurrence: Occurrence; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(occurrence.amountCents);
  const [date, setDate] = useState(occurrence.date);
  const toast = useToast();
  const save = useApiMutation((body: { amountCents: number | null; date: string | null }) => api.put(base(occurrence), body), MONEY_QUERIES);

  return (
    <Modal
      title={`Edit ${occurrence.name} — this occurrence only`}
      onClose={onClose}
      footer={
        <>
          {occurrence.edited ? (
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                await save.mutateAsync({ amountCents: null, date: null });
                toast('Back to the schedule');
                onClose();
              }}
            >
              Reset to schedule
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={save.isPending || !amount || !date}
            onClick={async () => {
              try {
                await save.mutateAsync({ amountCents: amount, date });
                toast('Occurrence updated');
                onClose();
              } catch {
                /* shown */
              }
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">Changes only this one. To change every future occurrence, edit the schedule.</p>
        <FormError error={save.error instanceof ApiError ? save.error : null} />
        <Field label="Amount">{(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}</Field>
        <Field label="Date">{(p) => <DateInput {...p} value={date} onChange={setDate} />}</Field>
      </div>
    </Modal>
  );
}

export function OccurrenceStatusBadge({ status }: { status: Occurrence['status'] }) {
  const map: Record<Occurrence['status'], { cls: string; icon: string; text: string }> = {
    posted: { cls: 'ok', icon: '✓', text: 'Paid' },
    skipped: { cls: '', icon: '⤼', text: 'Skipped' },
    overdue: { cls: 'danger', icon: '!', text: 'Overdue' },
    due: { cls: 'warn', icon: '●', text: 'Due today' },
    upcoming: { cls: '', icon: '', text: 'Upcoming' },
  };
  const m = map[status];
  return (
    <span className={`badge ${m.cls}`}>
      {m.icon ? <span aria-hidden="true">{m.icon}</span> : null}
      {m.text}
    </span>
  );
}
