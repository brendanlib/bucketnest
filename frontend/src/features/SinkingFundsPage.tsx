import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useBuckets, useCategories, useRecurring, useSinkingFunds } from '../api/hooks';
import type { Frequency, SinkingFund } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState, ErrorState, FormError, Loading } from '../components/States';
import { Field } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { Money } from '../components/Money';
import { AccountSelect, CategorySelect } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { formatDate, relativeDays, todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';
import { strings } from '../locales/en-AU';
import { describeFrequency } from './RecurringPage';

const FREQUENCIES: Frequency[] = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'EVERY_N_WEEKS', 'EVERY_N_MONTHS'];

export function FundStatus({ f }: { f: Pick<SinkingFund, 'status' | 'shortfallCents'> }) {
  switch (f.status) {
    case 'funded':
      return <span className="badge ok">✓ Funded</span>;
    case 'due_short':
      return (
        <span className="badge danger">
          ! Due — short by <Money cents={f.shortfallCents} />
        </span>
      );
    case 'due_soon':
      return <span className="badge warn">● Due soon</span>;
    default:
      return <span className="badge">On track</span>;
  }
}

/** Progress toward a target, using the percentage the API calculated. */
export function SavedBar({ percent, label = 'Saved' }: { percent: number | null; label?: string }) {
  const width = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className="progress status-ok" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(width)} aria-valuetext={`${(percent ?? 0).toFixed(2)}% of the target`}>
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export function SinkingFundsPage() {
  const funds = useSinkingFunds();
  const { locale, timezone } = useHousehold();
  const today = todayIn(timezone);
  const [editing, setEditing] = useState<SinkingFund | 'new' | null>(null);
  const [contributing, setContributing] = useState<SinkingFund | null>(null);
  const [deleting, setDeleting] = useState<SinkingFund | null>(null);
  const toast = useToast();
  const remove = useApiMutation((id: string) => api.delete(`/sinking-funds/${id}`), MONEY_QUERIES);

  if (funds.isPending) return <Loading />;
  if (funds.isError) return <ErrorState error={funds.error} onRetry={() => funds.refetch()} />;

  return (
    <>
      <PageHeader
        title="Sinking funds"
        subtitle="Save a little each pay for big irregular bills, so they don’t blow out the month they land in."
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> New fund
          </button>
        }
      />
      <PageTip id="sinking-funds" title="Smooth out the big bills">
        A sinking fund saves a little each pay for an irregular bill, so the month it lands isn’t a shock. Its contribution is the budget line; the bill itself, paid from the fund, doesn’t count as overspending.
      </PageTip>
      {funds.data.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No sinking funds yet"
            action={
              <button type="button" className="btn primary" onClick={() => setEditing('new')}>
                Start a fund
              </button>
            }
          >
            Good candidates: car rego, insurance, school fees, Christmas. Link a recurring bill and the target and due date fill themselves in.
          </EmptyState>
        </div>
      ) : (
        <div className="cards">
          {funds.data.map((f) => (
            <article key={f.id} className="card stack-sm" aria-labelledby={`fund-${f.id}`}>
              <div className="row">
                <h2 id={`fund-${f.id}`} className="truncate">
                  {f.name}
                </h2>
                <span className="spacer" />
                <FundStatus f={f} />
              </div>
              <div className="muted small">
                Due {formatDate(f.dueDate, locale)} ({relativeDays(f.dueDate, today)})
                {f.recurringName ? ` · follows ${f.recurringName}` : ''}
              </div>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <span className="stat-value">
                  <Money cents={f.currentCents} />
                </span>
                <span className="muted small">
                  of <Money cents={f.targetCents} />
                </span>
              </div>
              <SavedBar percent={f.progressPercent} label={`${f.name} saved`} />
              {f.status !== 'funded' ? (
                <p className="small">
                  Put aside <strong><Money cents={f.recommendedContributionCents} /></strong> {describeFrequency({ frequency: f.contributionFrequency, interval: f.contributionInterval }).toLowerCase()}
                  {f.datesLeft > 0 ? ` (${f.datesLeft} more time${f.datesLeft === 1 ? '' : 's'})` : ' — now'}
                </p>
              ) : null}
              <div className="muted small">
                {f.categoryName ? `${f.categoryName}` : 'No category'}
                {f.accountName ? ` · held in ${f.accountName}` : ''}
              </div>
              <div className="row wrap" style={{ marginTop: 'auto' }}>
                <button type="button" className="btn small primary" onClick={() => setContributing(f)}>
                  Add money
                </button>
                <button type="button" className="btn small" onClick={() => setEditing(f)}>
                  Edit
                </button>
                <button type="button" className="btn small ghost" aria-label={`Delete ${f.name}`} onClick={() => setDeleting(f)}>
                  <Icon name="trash" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="muted small" style={{ marginTop: '1rem' }}>
        When you pay the bill, choose “Paid from sinking fund” on the transaction. It shows in the category’s history but not as overspending.
      </p>
      {editing ? <FundForm fund={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {contributing ? <ContributeDialog fund={contributing} onClose={() => setContributing(null)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="Its contributions are removed. Payments made from it keep their history."
          busy={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast('Fund deleted');
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}

function FundForm({ fund, onClose }: { fund?: SinkingFund; onClose: () => void }) {
  const { timezone } = useHousehold();
  const accounts = useAccounts();
  const categories = useCategories();
  const buckets = useBuckets();
  const schedules = useRecurring();
  const toast = useToast();
  const [form, setForm] = useState({
    name: fund?.name ?? '',
    mode: fund?.recurringId ? 'bill' : 'manual',
    recurringId: fund?.recurringId ?? '',
    targetCents: fund?.ownTargetCents ?? (null as number | null),
    dueDate: fund?.ownDueDate ?? '',
    contributionFrequency: fund?.contributionFrequency ?? ('MONTHLY' as Frequency),
    contributionInterval: fund?.contributionInterval ?? 2,
    contributionAnchorDate: fund?.contributionAnchorDate ?? todayIn(timezone),
    accountId: fund?.accountId ?? '',
    categoryId: fund?.categoryId ?? '',
    repeats: fund?.repeats ?? true,
    manualCurrentCents: fund?.manualCurrentCents ?? (null as number | null),
    notes: fund?.notes ?? '',
  });
  const save = useApiMutation((b: unknown) => (fund ? api.put(`/sinking-funds/${fund.id}`, b) : api.post('/sinking-funds', b)), MONEY_QUERIES);
  const bills = (schedules.data ?? []).filter((r) => r.isActive && (r.type === 'EXPENSE' || r.type === 'DEBT_REPAYMENT'));
  const err = (f: string) => (save.error instanceof ApiError && save.error.field === f ? save.error.message : null);
  const custom = form.contributionFrequency.startsWith('EVERY_N_');

  return (
    <Modal
      title={fund ? 'Edit sinking fund' : 'New sinking fund'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={save.isPending || !form.name.trim()}
            onClick={async () => {
              const bill = form.mode === 'bill';
              try {
                await save.mutateAsync({
                  name: form.name,
                  recurringId: bill ? form.recurringId || null : null,
                  targetCents: bill ? null : form.targetCents,
                  dueDate: bill ? null : form.dueDate || null,
                  contributionFrequency: form.contributionFrequency,
                  contributionInterval: custom ? form.contributionInterval : null,
                  contributionAnchorDate: form.contributionAnchorDate,
                  accountId: form.accountId || null,
                  categoryId: form.categoryId || null,
                  repeats: form.repeats,
                  manualCurrentCents: form.accountId ? null : form.manualCurrentCents,
                  notes: form.notes || null,
                });
                toast(fund ? 'Fund saved' : 'Fund created');
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
        <FormError error={save.error && !(save.error instanceof ApiError && save.error.field) ? save.error : null} />
        <Field label="Name" error={err('name')}>
          {(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Car rego" />}
        </Field>
        <div className="segmented" role="group" aria-label="Target">
          <button type="button" aria-pressed={form.mode === 'bill'} onClick={() => setForm({ ...form, mode: 'bill' })}>
            Save for a recurring bill
          </button>
          <button type="button" aria-pressed={form.mode === 'manual'} onClick={() => setForm({ ...form, mode: 'manual' })}>
            Set my own target
          </button>
        </div>
        {form.mode === 'bill' ? (
          <Field label="Bill" hint="The target and due date follow the bill’s next occurrence, and roll forward after each one is paid." error={err('recurringId')}>
            {(p) => (
              <select {...p} className="input" value={form.recurringId} onChange={(e) => {
                const r = bills.find((b) => b.id === e.target.value);
                setForm({ ...form, recurringId: e.target.value, name: form.name || r?.name || '', categoryId: form.categoryId || r?.categoryId || '' });
              }}>
                <option value="">Choose a bill</option>
                {bills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {describeFrequency(b).toLowerCase()}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <div className="grid-2">
            <Field label="Amount needed" error={err('targetCents')}>
              {(p) => <MoneyInput {...p} value={form.targetCents} onChange={(c) => setForm({ ...form, targetCents: c })} />}
            </Field>
            <Field label="Due" error={err('dueDate')}>
              {(p) => <DateInput {...p} value={form.dueDate} onChange={(d) => setForm({ ...form, dueDate: d })} />}
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.repeats} onChange={(e) => setForm({ ...form, repeats: e.target.checked })} />
              Repeats every year
            </label>
          </div>
        )}
        <div className="grid-2">
          <Field label="Contribute" error={err('contributionInterval')}>
            {(p) => (
              <select {...p} className="input" value={form.contributionFrequency} onChange={(e) => setForm({ ...form, contributionFrequency: e.target.value as Frequency })}>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {strings.frequencies[f]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {custom ? (
            <Field label="Every how many">
              {(p) => <input {...p} className="input right" type="number" min={1} value={form.contributionInterval} onChange={(e) => setForm({ ...form, contributionInterval: Number(e.target.value) })} />}
            </Field>
          ) : null}
          <Field label="Starting on" hint="Usually a payday.">
            {(p) => <DateInput {...p} value={form.contributionAnchorDate} onChange={(d) => setForm({ ...form, contributionAnchorDate: d })} />}
          </Field>
          <Field label="Budget category" hint="The fund’s contribution becomes a line in this category’s bucket." error={err('categoryId')}>
            {(p) => <CategorySelect {...p} categories={categories.data ?? []} buckets={buckets.data ?? []} kind="EXPENSE" placeholder="None" value={form.categoryId} onChange={(id) => setForm({ ...form, categoryId: id })} />}
          </Field>
          <Field label="Held in account (optional)" hint="If linked, the fund’s balance is the account’s balance." error={err('accountId')}>
            {(p) => <AccountSelect {...p} accounts={accounts.data ?? []} filter={(a) => a.class === 'ASSET'} placeholder="No separate account" value={form.accountId} onChange={(id) => setForm({ ...form, accountId: id })} />}
          </Field>
          {!form.accountId ? (
            <Field label="Already saved">{(p) => <MoneyInput {...p} value={form.manualCurrentCents} onChange={(c) => setForm({ ...form, manualCurrentCents: c })} />}</Field>
          ) : null}
        </div>
        <Field label="Notes">{(p) => <textarea {...p} className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

function ContributeDialog({ fund, onClose }: { fund: SinkingFund; onClose: () => void }) {
  const { timezone } = useHousehold();
  const accounts = useAccounts();
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(fund.recommendedContributionCents || null);
  const [date, setDate] = useState(todayIn(timezone));
  const [fromAccountId, setFrom] = useState('');
  const save = useApiMutation((b: unknown) => api.post(`/sinking-funds/${fund.id}/contributions`, b), MONEY_QUERIES);
  return (
    <Modal
      title={`Add money to ${fund.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!amount || save.isPending || (Boolean(fund.accountId) && !fromAccountId)}
            onClick={async () => {
              try {
                await save.mutateAsync({ amountCents: amount, date, fromAccountId: fund.accountId ? fromAccountId : null });
                toast('Contribution added');
                onClose();
              } catch {
                /* shown */
              }
            }}
          >
            Add
          </button>
        </>
      }
    >
      <div className="stack">
        <FormError error={save.error} />
        <div className="grid-2">
          <Field label="Amount">{(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}</Field>
          <Field label="Date">{(p) => <DateInput {...p} value={date} onChange={setDate} />}</Field>
        </div>
        {fund.accountId ? (
          <Field label={`Move from`} hint={`A transfer into ${fund.accountName} is recorded.`}>
            {(p) => <AccountSelect {...p} accounts={accounts.data ?? []} filter={(a) => a.id !== fund.accountId && a.class === 'ASSET'} value={fromAccountId} onChange={setFrom} />}
          </Field>
        ) : (
          <p className="muted small">This fund isn’t held in its own account, so this just sets the money aside.</p>
        )}
      </div>
    </Modal>
  );
}
