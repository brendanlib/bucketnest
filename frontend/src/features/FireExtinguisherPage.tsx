import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useGoals } from '../api/hooks';
import type { Frequency, Goal } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState, ErrorState, FormError, Loading } from '../components/States';
import { Field } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { Money } from '../components/Money';
import { AccountSelect } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { formatDate } from '../lib/format';
import { useHousehold } from '../lib/household';
import { strings } from '../locales/en-AU';
import { SavedBar } from './SinkingFundsPage';
import { describeFrequency } from './RecurringPage';

const GOAL_TYPES: { value: Goal['type']; label: string }[] = [
  { value: 'EMERGENCY_FUND', label: 'Emergency fund' },
  { value: 'SAVINGS', label: 'Savings goal' },
  { value: 'INVESTMENT', label: 'Investment' },
];
const FREQUENCIES: Frequency[] = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'];

export function FireExtinguisherPage() {
  const goals = useGoals();
  const accounts = useAccounts();
  const { locale } = useHousehold();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const toast = useToast();
  const remove = useApiMutation((id: string) => api.delete(`/goals/${id}`), MONEY_QUERIES);
  const reorder = useApiMutation((g: { goal: Goal; priority: number }) => api.put(`/goals/${g.goal.id}`, goalBody(g.goal, { priority: g.priority })), [['goals'], ['dashboard']]);

  if (goals.isPending) return <Loading />;
  if (goals.isError) return <ErrorState error={goals.error} onRetry={() => goals.refetch()} />;
  const investments = (accounts.data ?? []).filter((a) => a.type === 'INVESTMENT' || a.type === 'SUPERANNUATION');

  return (
    <>
      <PageHeader
        title="Fire Extinguisher"
        subtitle="Your emergency fund, savings goals and investments. The top goal gets spare Fire Extinguisher money first."
        actions={
          <>
            <Link to="/debts" className="btn">
              Debts
            </Link>
            <button type="button" className="btn primary" onClick={() => setEditing('new')}>
              <Icon name="plus" /> New goal
            </button>
          </>
        }
      />
      <PageTip id="fire-extinguisher" title="The Fire Extinguisher bucket">
        Barefoot’s order: build an emergency fund first, then pay down debt, then invest. Put your goals in that order — the top one gets spare Fire Extinguisher money first.
      </PageTip>
      <section className="stack" aria-labelledby="goals-h">
        <h2 id="goals-h">Goals</h2>
        {goals.data.length === 0 ? (
          <div className="card">
            <EmptyState
              title="No goals yet"
              action={
                <button type="button" className="btn primary" onClick={() => setEditing('new')}>
                  Start with an emergency fund
                </button>
              }
            >
              The Barefoot approach: a Fire Extinguisher fund of a few months’ expenses, then attack debt, then invest.
            </EmptyState>
          </div>
        ) : (
          goals.data.map((g, i) => (
            <article key={g.id} className="card stack-sm" aria-labelledby={`goal-${g.id}`}>
              <div className="row wrap">
                <span className="badge num" aria-label={`Priority ${i + 1}`}>
                  {i + 1}
                </span>
                <h3 id={`goal-${g.id}`}>{g.name}</h3>
                <span className="muted small">{GOAL_TYPES.find((t) => t.value === g.type)?.label}</span>
                <span className="spacer" />
                {g.reached ? <span className="badge ok">✓ Reached</span> : g.onTrack === false ? <span className="badge warn">● Behind</span> : g.onTrack ? <span className="badge ok">On track</span> : null}
              </div>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <span className="stat-value">
                  <Money cents={g.currentCents} />
                </span>
                <span className="muted small">
                  of <Money cents={g.targetCents} /> {g.progressPercent !== null ? `· ${g.progressPercent.toFixed(2)}%` : ''}
                </span>
              </div>
              <SavedBar percent={g.progressPercent} label={`${g.name} progress`} />
              <dl className="kv small" style={{ maxWidth: 520 }}>
                {g.contributionCents && g.contributionFrequency ? (
                  <>
                    <dt>Contributing</dt>
                    <dd>
                      <Money cents={g.contributionCents} /> {describeFrequency({ frequency: g.contributionFrequency, interval: g.contributionInterval }).toLowerCase()}
                    </dd>
                  </>
                ) : null}
                {g.targetDate ? (
                  <>
                    <dt>Target date</dt>
                    <dd>{formatDate(g.targetDate, locale)}</dd>
                  </>
                ) : null}
                {g.requiredContributionCents !== null && !g.reached ? (
                  <>
                    <dt>Needed to make it</dt>
                    <dd>
                      <Money cents={g.requiredContributionCents} /> each time
                    </dd>
                  </>
                ) : null}
                {g.projectedDate && !g.reached ? (
                  <>
                    <dt>At this rate</dt>
                    <dd>{formatDate(g.projectedDate, locale)}</dd>
                  </>
                ) : null}
                <dt>Balance from</dt>
                <dd>{g.accountName ?? 'Entered by hand'}</dd>
              </dl>
              <div className="row wrap">
                <button type="button" className="btn small ghost" aria-label={`Move ${g.name} up`} disabled={i === 0} onClick={() => reorder.mutate({ goal: g, priority: goals.data[i - 1]!.priority - 1 })}>
                  ↑
                </button>
                <button type="button" className="btn small ghost" aria-label={`Move ${g.name} down`} disabled={i === goals.data.length - 1} onClick={() => reorder.mutate({ goal: g, priority: goals.data[i + 1]!.priority + 1 })}>
                  ↓
                </button>
                <button type="button" className="btn small" onClick={() => setEditing(g)}>
                  Edit
                </button>
                <button type="button" className="btn small ghost" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}>
                  <Icon name="trash" />
                </button>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="card" style={{ marginTop: '1.5rem' }} aria-labelledby="inv-h">
        <div className="card-header">
          <h2 id="inv-h">Investments and super</h2>
          <span className="spacer" />
          <Link to="/accounts" className="small">
            Manage accounts
          </Link>
        </div>
        {investments.length === 0 ? (
          <p className="muted small">Add an investment or superannuation account to track it here.</p>
        ) : (
          investments.map((a) => (
            <Link key={a.id} to={`/accounts/${a.id}`} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="grow">
                <strong>{a.name}</strong>
                <div className="muted small">
                  {strings.accountTypes[a.type]}
                  {a.includeInNetWorth ? '' : ' · not in net worth'}
                </div>
              </div>
              <Money cents={a.balanceCents} />
            </Link>
          ))
        )}
      </section>
      {editing ? <GoalForm goal={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          message="Transactions linked to it are kept."
          busy={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast('Goal deleted');
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}

function goalBody(g: Goal, patch: Partial<Goal> = {}) {
  const v = { ...g, ...patch };
  return {
    name: v.name,
    type: v.type,
    targetCents: v.targetCents,
    targetDate: v.targetDate,
    priority: v.priority,
    accountId: v.accountId,
    manualCurrentCents: v.accountId ? null : v.manualCurrentCents,
    contributionCents: v.contributionCents,
    contributionFrequency: v.contributionCents ? v.contributionFrequency : null,
    contributionInterval: v.contributionInterval,
    isActive: v.isActive,
    notes: v.notes,
  };
}

function GoalForm({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const accounts = useAccounts();
  const toast = useToast();
  const [form, setForm] = useState({
    name: goal?.name ?? '',
    type: goal?.type ?? ('EMERGENCY_FUND' as Goal['type']),
    targetCents: goal?.targetCents ?? (null as number | null),
    targetDate: goal?.targetDate ?? '',
    accountId: goal?.accountId ?? '',
    manualCurrentCents: goal?.manualCurrentCents ?? (null as number | null),
    contributionCents: goal?.contributionCents ?? (null as number | null),
    contributionFrequency: goal?.contributionFrequency ?? ('FORTNIGHTLY' as Frequency),
    notes: goal?.notes ?? '',
  });
  const save = useApiMutation((b: unknown) => (goal ? api.put(`/goals/${goal.id}`, b) : api.post('/goals', b)), MONEY_QUERIES);
  const err = (f: string) => (save.error instanceof ApiError && save.error.field === f ? save.error.message : null);
  return (
    <Modal
      title={goal ? 'Edit goal' : 'New goal'}
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
            disabled={save.isPending || !form.name.trim() || !form.targetCents}
            onClick={async () => {
              try {
                await save.mutateAsync({
                  name: form.name,
                  type: form.type,
                  targetCents: form.targetCents,
                  targetDate: form.targetDate || null,
                  ...(goal ? { priority: goal.priority } : {}),
                  accountId: form.accountId || null,
                  manualCurrentCents: form.accountId ? null : form.manualCurrentCents,
                  contributionCents: form.contributionCents,
                  contributionFrequency: form.contributionCents ? form.contributionFrequency : null,
                  notes: form.notes || null,
                });
                toast(goal ? 'Goal saved' : 'Goal added');
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
        <div className="grid-2">
          <Field label="Name">{(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Three months of expenses" />}</Field>
          <Field label="Type">
            {(p) => (
              <select {...p} className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Goal['type'] })}>
                {GOAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Target" error={err('targetCents')}>{(p) => <MoneyInput {...p} value={form.targetCents} onChange={(c) => setForm({ ...form, targetCents: c })} />}</Field>
          <Field label="Target date (optional)">{(p) => <DateInput {...p} value={form.targetDate} onChange={(d) => setForm({ ...form, targetDate: d })} />}</Field>
          <Field label="Balance from account" hint="Or leave blank and enter the amount yourself." error={err('accountId')}>
            {(p) => <AccountSelect {...p} accounts={accounts.data ?? []} filter={(a) => a.class === 'ASSET'} placeholder="I’ll enter it" value={form.accountId} onChange={(id) => setForm({ ...form, accountId: id })} />}
          </Field>
          {!form.accountId ? <Field label="Saved so far">{(p) => <MoneyInput {...p} value={form.manualCurrentCents} onChange={(c) => setForm({ ...form, manualCurrentCents: c })} />}</Field> : null}
          <Field label="I contribute (optional)" error={err('contributionFrequency')}>
            {(p) => <MoneyInput {...p} value={form.contributionCents} onChange={(c) => setForm({ ...form, contributionCents: c })} />}
          </Field>
          <Field label="How often">
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
        </div>
        <Field label="Notes">{(p) => <textarea {...p} className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}
