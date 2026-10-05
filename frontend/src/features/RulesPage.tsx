import { useState } from 'react';
import { api } from '../api/client';
import { MONEY_QUERIES, useApiMutation, useRules } from '../api/hooks';
import type { Rule } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog } from '../components/Modal';
import { EmptyState, ErrorState, Loading, errorMessage } from '../components/States';
import { Money } from '../components/Money';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { RuleForm } from './RuleForm';

function describe(r: Rule) {
  const field = r.matchField === 'PAYEE' ? 'Payee' : 'Description';
  const how = r.matchType === 'EQUALS' ? 'is' : r.matchType === 'STARTS_WITH' ? 'starts with' : 'contains';
  return `${field} ${how} “${r.matchValue}”`;
}

export function RulesPage() {
  const rules = useRules();
  const toast = useToast();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const reorder = useApiMutation((ids: string[]) => api.post('/rules/reorder', { ids }), [['rules']]);
  const toggle = useApiMutation((r: Rule) => api.put(`/rules/${r.id}`, { ...r, isActive: !r.isActive, id: undefined, priority: undefined, accountName: undefined, setCategoryName: undefined, setToAccountName: undefined }), [['rules']]);
  const apply = useApiMutation((id: string) => api.post<{ updated: number; skipped: number }>('/rules/apply', { id }), MONEY_QUERIES);
  const remove = useApiMutation((id: string) => api.delete(`/rules/${id}`), [['rules']]);

  if (rules.isPending) return <Loading />;
  if (rules.isError) return <ErrorState error={rules.error} onRetry={() => rules.refetch()} />;
  const list = rules.data;

  const move = (i: number, delta: number) => {
    const ids = list.map((r) => r.id);
    const [moved] = ids.splice(i, 1);
    ids.splice(i + delta, 0, moved!);
    reorder.mutate(ids);
  };

  return (
    <>
      <PageHeader
        title="Rules"
        subtitle="Rules categorise imported transactions automatically. They run top to bottom; the first match wins."
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> New rule
          </button>
        }
      />
      <PageTip id="rules" title="Let rules do the categorising">
        Rules categorise imported transactions by their description, for example WOOLWORTHS → Groceries. When you categorise an imported transaction, you’ll be offered a rule for it.
      </PageTip>
      <div className="card">
        {list.length === 0 ? (
          <EmptyState
            title="No rules yet"
            action={
              <button type="button" className="btn primary" onClick={() => setEditing('new')}>
                Create a rule
              </button>
            }
          >
            For example: description contains WOOLWORTHS → Groceries. You can also create a rule when you recategorise a transaction.
          </EmptyState>
        ) : (
          list.map((r, i) => (
            <div key={r.id} className="list-item" style={{ flexWrap: 'wrap' }}>
              <span className="badge num" aria-label={`Runs ${i + 1}`}>
                {i + 1}
              </span>
              <div className="grow">
                <div className={r.isActive ? undefined : 'muted'}>
                  <strong>{r.name ?? describe(r)}</strong> {!r.isActive ? <span className="badge">Off</span> : null}
                </div>
                <div className="muted small">
                  {r.name ? `${describe(r)} · ` : ''}
                  {r.accountName ? `${r.accountName} · ` : ''}
                  {r.direction === 'DEBIT' ? 'money out · ' : r.direction === 'CREDIT' ? 'money in · ' : ''}
                  {r.minAmountCents !== null ? (
                    <>
                      from <Money cents={r.minAmountCents} />{' '}
                    </>
                  ) : null}
                  {r.maxAmountCents !== null ? (
                    <>
                      up to <Money cents={r.maxAmountCents} />{' '}
                    </>
                  ) : null}
                  → {r.setType === 'TRANSFER' ? `transfer with ${r.setToAccountName}` : (r.setCategoryName ?? 'no category')}
                  {r.setPayee ? ` · payee “${r.setPayee}”` : ''}
                </div>
              </div>
              <button type="button" className="btn ghost icon small" aria-label={`Move rule ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="btn ghost icon small" aria-label={`Move rule ${i + 1} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="btn small"
                disabled={!r.isActive || apply.isPending}
                onClick={async () => {
                  try {
                    const res = await apply.mutateAsync(r.id);
                    toast(res.updated ? `Categorised ${res.updated} transaction${res.updated === 1 ? '' : 's'}` : 'No uncategorised transactions match');
                  } catch (err) {
                    toast(errorMessage(err), 'error');
                  }
                }}
              >
                Apply to uncategorised
              </button>
              <button type="button" className="btn ghost small" onClick={() => toggle.mutate(r)}>
                {r.isActive ? 'Turn off' : 'Turn on'}
              </button>
              <button type="button" className="btn ghost small" onClick={() => setEditing(r)}>
                Edit
              </button>
              <button type="button" className="btn ghost icon" aria-label={`Delete rule ${i + 1}`} onClick={() => setDeleting(r)}>
                <Icon name="trash" />
              </button>
            </div>
          ))
        )}
      </div>
      {editing ? <RuleForm rule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete rule?"
          message="Transactions it already categorised keep their categories."
          busy={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast('Rule deleted');
            setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}
