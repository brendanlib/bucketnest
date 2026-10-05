import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError } from '../api/client';
import { useApiMutation, useBudgets, useBudgetSummary } from '../api/hooks';
import type { Budget, BudgetItem, BudgetLine, Frequency } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ErrorState, FormError, Loading, errorMessage } from '../components/States';
import { Field } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { Money } from '../components/Money';
import { PeriodSelector } from '../components/PeriodSelector';
import { useToast } from '../components/Toast';
import { strings } from '../locales/en-AU';
import { todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';
import { BudgetTable } from './BudgetTable';

const BUDGET_QUERIES = [['budgets'], ['dashboard']];
const ITEM_FREQUENCIES: Frequency[] = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'SIX_MONTHLY', 'ANNUALLY', 'EVERY_N_WEEKS', 'EVERY_N_MONTHS'];

export function BudgetPage() {
  const [params, setParams] = useSearchParams();
  const budgets = useBudgets();
  const selectedId = params.get('budget') ?? budgets.data?.find((b) => b.isActive)?.id;
  const period = params.get('period') ?? undefined;
  const bucketKey = params.get('bucket') ?? undefined;
  const [showAll, setShowAll] = useState(params.get('all') === '1');
  const summary = useBudgetSummary(selectedId, period, showAll);
  const [editing, setEditing] = useState<{ line: BudgetLine; item?: BudgetItem } | null>(null);
  const [managing, setManaging] = useState<'new' | 'edit' | 'copy' | 'delete' | null>(null);

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  if (budgets.isPending) return <Loading />;
  if (budgets.isError) return <ErrorState error={budgets.error} onRetry={() => budgets.refetch()} />;
  const budget = budgets.data.find((b) => b.id === selectedId);

  return (
    <>
      <PageHeader
        title="Budget"
        subtitle="Plan each category in whatever frequency suits it; it’s converted to your budget period."
        actions={
          <>
            {budgets.data.length > 1 ? (
              <select aria-label="Budget" className="input" style={{ width: 'auto' }} value={selectedId} onChange={(e) => set({ budget: e.target.value })}>
                {budgets.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.isActive ? ' (active)' : ''}
                  </option>
                ))}
              </select>
            ) : null}
            <button type="button" className="btn" onClick={() => setManaging('edit')}>
              Budget settings
            </button>
            <button type="button" className="btn" onClick={() => setManaging('copy')}>
              Copy
            </button>
            <button type="button" className="btn" onClick={() => setManaging('new')}>
              New budget
            </button>
          </>
        }
      />
      <PageTip id="budget" title="How the budget works">
        Plan each category in the frequency that suits it — $200 a week for groceries, $900 a year for rego — and it’s converted to your budget period. The plan carries into every period until you change it. Tick “Show every category” to plan the rest.
      </PageTip>

      {summary.isPending ? (
        <Loading />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <>
          <div className="row wrap" style={{ marginBottom: '1rem' }}>
            <PeriodSelector period={summary.data.period} onChange={(d) => set({ period: d })} />
            <span className="spacer" />
            <div className="segmented" role="group" aria-label="Bucket">
              <button type="button" aria-pressed={!bucketKey} onClick={() => set({ bucket: undefined })}>
                All
              </button>
              {summary.data.buckets.map((b) => (
                <button key={b.key} type="button" aria-pressed={bucketKey === b.key} onClick={() => set({ bucket: b.key })}>
                  {b.name}
                </button>
              ))}
            </div>
            <label className="checkbox small">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show every category
            </label>
          </div>

          <div className="cards" style={{ marginBottom: '1rem' }}>
            <div className="card">
              <div className="stat-label">{summary.data.income.allocationBasis === 'ACTUAL' ? 'Income received' : 'Planned income'}</div>
              <div className="stat-value">
                <Money cents={summary.data.income.allocationIncomeCents} />
              </div>
              <div className="muted small">
                {summary.data.income.plannedSource === 'none' && summary.data.income.allocationBasis === 'PLANNED'
                  ? 'Add your pay as a recurring income to plan allocations.'
                  : summary.data.income.plannedSource === 'budget'
                    ? 'From the income lines in this budget.'
                    : 'From your income schedules.'}{' '}
                Received so far: <Money cents={summary.data.income.actualCents} />
              </div>
            </div>
            <div className="card">
              <div className="stat-label">Planned spending</div>
              <div className="stat-value">
                <Money cents={summary.data.total.budgetCents} />
              </div>
              <div className="muted small">
                Spent <Money cents={summary.data.total.actualCents} /> ·{' '}
                <span className={summary.data.total.remainingCents < 0 ? 'neg' : undefined}>
                  <Money cents={Math.abs(summary.data.total.remainingCents)} /> {summary.data.total.remainingCents < 0 ? 'over' : 'left'}
                </span>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <BudgetTable summary={summary.data} bucketKey={bucketKey} onEditLine={(line, item) => setEditing({ line, item })} />
          </div>
          {!showAll ? (
            <p className="muted small" style={{ marginTop: '0.75rem' }}>
              Showing categories with a plan or spending. Tick “Show every category” to plan the rest.
            </p>
          ) : null}
        </>
      )}

      {editing && budget ? <ItemDialog budget={budget} line={editing.line} item={editing.item} onClose={() => setEditing(null)} /> : null}
      {managing === 'new' ? <BudgetDialog onClose={() => setManaging(null)} onSaved={(b) => set({ budget: b.id })} /> : null}
      {managing === 'edit' && budget ? <BudgetDialog budget={budget} onClose={() => setManaging(null)} onDelete={() => setManaging('delete')} /> : null}
      {managing === 'copy' && budget ? <CopyDialog budget={budget} onClose={() => setManaging(null)} onSaved={(b) => set({ budget: b.id })} /> : null}
      {managing === 'delete' && budget ? <DeleteBudgetDialog budget={budget} onClose={() => setManaging(null)} onDeleted={() => set({ budget: undefined })} /> : null}
    </>
  );
}

function ItemDialog({ budget, line, item, onClose }: { budget: Budget; line: BudgetLine; item?: BudgetItem; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(item?.amountCents ?? null);
  const [frequency, setFrequency] = useState<Frequency>(item?.enteredFrequency ?? (budget.periodType === 'ANNUAL' ? 'ANNUALLY' : budget.periodType));
  const [interval, setInterval] = useState(item?.frequencyInterval ?? 2);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const save = useApiMutation(
    (body: unknown) => api.put<Budget>(`/budgets/${budget.id}/items/${line.categoryId}`, body),
    BUDGET_QUERIES,
  );
  const remove = useApiMutation(() => api.delete<Budget>(`/budgets/${budget.id}/items/${line.categoryId}`), BUDGET_QUERIES);

  return (
    <Modal
      title={`Budget for ${line.name}`}
      onClose={onClose}
      footer={
        <>
          {item ? (
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                await remove.mutateAsync(undefined);
                toast('Removed from the budget');
                onClose();
              }}
            >
              Remove
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={amount === null || save.isPending}
            onClick={async () => {
              try {
                const res = await save.mutateAsync({ amountCents: amount, enteredFrequency: frequency, frequencyInterval: frequency.startsWith('EVERY_N_') ? interval : null, notes: notes || null });
                const saved = res.items.find((i) => i.categoryId === line.categoryId);
                toast(saved ? `Saved` : 'Saved');
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
        <FormError error={save.error instanceof ApiError ? save.error : null} />
        <div className="grid-2">
          <Field label="Amount">{(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}</Field>
          <Field label="Per">
            {(p) => (
              <select {...p} className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                {ITEM_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {strings.frequencies[f]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {frequency.startsWith('EVERY_N_') ? (
            <Field label={frequency === 'EVERY_N_WEEKS' ? 'Number of weeks' : 'Number of months'}>
              {(p) => <input {...p} className="input right" type="number" min={1} value={interval} onChange={(e) => setInterval(Number(e.target.value))} />}
            </Field>
          ) : null}
        </div>
        {item ? (
          <p className="muted small">
            Currently <Money cents={item.periodAmountCents} /> per {strings.frequencies[budget.periodType]?.toLowerCase() ?? 'period'} period.
          </p>
        ) : (
          <p className="muted small">It’s converted to your {strings.frequencies[budget.periodType]?.toLowerCase()} budget period when saved.</p>
        )}
        <Field label="Notes">{(p) => <textarea {...p} className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function BudgetDialog({ budget, onClose, onSaved, onDelete }: { budget?: Budget; onClose: () => void; onSaved?: (b: Budget) => void; onDelete?: () => void }) {
  const { timezone } = useHousehold();
  const toast = useToast();
  const [form, setForm] = useState({
    name: budget?.name ?? '',
    periodType: budget?.periodType ?? ('MONTHLY' as Budget['periodType']),
    anchorDate: budget?.anchorDate ?? `${todayIn(timezone).slice(0, 8)}01`,
    isActive: budget?.isActive ?? false,
  });
  const save = useApiMutation((body: unknown) => (budget ? api.put<Budget>(`/budgets/${budget.id}`, body) : api.post<Budget>('/budgets', body)), [...BUDGET_QUERIES, ['settings']]);

  return (
    <Modal
      title={budget ? 'Budget settings' : 'New budget'}
      onClose={onClose}
      footer={
        <>
          {budget && onDelete && !budget.isActive ? (
            <button type="button" className="btn danger" onClick={onDelete}>
              Delete
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!form.name.trim() || save.isPending}
            onClick={async () => {
              try {
                const saved = await save.mutateAsync(budget?.isActive ? { ...form, isActive: undefined } : form);
                toast('Budget saved');
                onSaved?.(saved);
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
        <FormError error={save.error} />
        <Field label="Name">{(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <div className="grid-2">
          <Field label="Period">
            {(p) => (
              <select {...p} className="input" value={form.periodType} onChange={(e) => setForm({ ...form, periodType: e.target.value as Budget['periodType'] })}>
                {(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUAL'] as const).map((t) => (
                  <option key={t} value={t}>
                    {strings.frequencies[t]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Periods start on" hint={form.periodType === 'FORTNIGHTLY' ? 'A payday.' : undefined}>
            {(p) => <DateInput {...p} value={form.anchorDate} onChange={(d) => setForm({ ...form, anchorDate: d })} />}
          </Field>
        </div>
        {budget?.isActive ? (
          <p className="muted small">This is the active budget. The dashboard uses it.</p>
        ) : (
          <label className="checkbox">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Make this the active budget
          </label>
        )}
      </div>
    </Modal>
  );
}

function CopyDialog({ budget, onClose, onSaved }: { budget: Budget; onClose: () => void; onSaved: (b: Budget) => void }) {
  const [name, setName] = useState(`${budget.name} (copy)`);
  const toast = useToast();
  const copy = useApiMutation((n: string) => api.post<Budget>(`/budgets/${budget.id}/copy`, { name: n }), BUDGET_QUERIES);
  return (
    <Modal
      title={`Copy ${budget.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim() || copy.isPending}
            onClick={async () => {
              const b = await copy.mutateAsync(name);
              toast('Budget copied');
              onSaved(b);
              onClose();
            }}
          >
            Copy
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">The copy has the same plan and starts inactive, so you can try changes without touching the live budget.</p>
        <Field label="Name">{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function DeleteBudgetDialog({ budget, onClose, onDeleted }: { budget: Budget; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const remove = useApiMutation(() => api.delete(`/budgets/${budget.id}`), BUDGET_QUERIES);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [budget.id]);
  return (
    <ConfirmDialog
      title={`Delete ${budget.name}?`}
      message={error ?? 'Its plan is deleted. Transactions are not affected.'}
      busy={remove.isPending}
      onCancel={onClose}
      onConfirm={async () => {
        try {
          await remove.mutateAsync(undefined);
          toast('Budget deleted');
          onDeleted();
          onClose();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    />
  );
}
