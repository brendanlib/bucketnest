import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAccounts, useApiMutation, useBuckets, useCategories } from '../api/hooks';
import type { Rule } from '../api/types';
import { Modal } from '../components/Modal';
import { Field } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { AccountSelect, CategorySelect } from '../components/Pickers';
import { FormError } from '../components/States';
import { Money } from '../components/Money';
import { useToast } from '../components/Toast';
import { formatDate } from '../lib/format';
import { useHousehold } from '../lib/household';

export type RuleDraft = Partial<Omit<Rule, 'id' | 'priority'>>;

interface TestResult {
  scanned: number;
  matchCount: number;
  uncategorisedCount: number;
  items: { id: string; date: string; description: string; payee: string | null; amountCents: number; type: string; uncategorised: boolean }[];
}

export function RuleForm({ rule, draft, onClose, onSaved }: { rule?: Rule; draft?: RuleDraft; onClose: () => void; onSaved?: (r: Rule) => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const buckets = useBuckets();
  const { locale } = useHousehold();
  const toast = useToast();
  const start = { ...draft, ...rule };
  const [form, setForm] = useState({
    name: start.name ?? '',
    matchField: start.matchField ?? 'DESCRIPTION',
    matchType: start.matchType ?? 'CONTAINS',
    matchValue: start.matchValue ?? '',
    minAmountCents: start.minAmountCents ?? null,
    maxAmountCents: start.maxAmountCents ?? null,
    direction: start.direction ?? 'ANY',
    accountId: start.accountId ?? '',
    action: (start.setType === 'TRANSFER' ? 'TRANSFER' : 'CATEGORY') as 'CATEGORY' | 'TRANSFER',
    categoryKind: (categories.data?.find((c) => c.id === start.setCategoryId)?.kind ?? 'EXPENSE') as 'EXPENSE' | 'INCOME',
    setCategoryId: start.setCategoryId ?? '',
    setToAccountId: start.setToAccountId ?? '',
    setPayee: start.setPayee ?? '',
    addNote: start.addNote ?? '',
    isActive: start.isActive ?? true,
  });
  const [test, setTest] = useState<TestResult | null>(null);

  const body = () => ({
    name: form.name || null,
    matchField: form.matchField,
    matchType: form.matchType,
    matchValue: form.matchValue,
    minAmountCents: form.minAmountCents,
    maxAmountCents: form.maxAmountCents,
    direction: form.direction,
    accountId: form.accountId || null,
    setCategoryId: form.action === 'CATEGORY' ? form.setCategoryId || null : null,
    setType: form.action === 'TRANSFER' ? 'TRANSFER' : null,
    setToAccountId: form.action === 'TRANSFER' ? form.setToAccountId || null : null,
    setPayee: form.setPayee || null,
    addNote: form.addNote || null,
    isActive: form.isActive,
  });

  const save = useApiMutation((b: unknown) => (rule ? api.put<Rule>(`/rules/${rule.id}`, b) : api.post<Rule>('/rules', b)), [['rules']]);
  const runTest = useApiMutation((b: unknown) => api.post<TestResult>('/rules/test', b), []);

  return (
    <Modal
      title={rule ? 'Edit rule' : 'New rule'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" disabled={!form.matchValue.trim() || runTest.isPending} onClick={async () => setTest(await runTest.mutateAsync(body()).catch(() => null))}>
            Test on recent transactions
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={save.isPending}
            onClick={async () => {
              try {
                const saved = await save.mutateAsync(body());
                toast(rule ? 'Rule saved' : 'Rule added');
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
        <FormError error={save.error instanceof ApiError ? save.error : null} />
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">When</legend>
          <div className="row wrap">
            <select className="input" style={{ width: 'auto' }} aria-label="Field" value={form.matchField} onChange={(e) => setForm({ ...form, matchField: e.target.value as 'DESCRIPTION' | 'PAYEE' })}>
              <option value="DESCRIPTION">Description</option>
              <option value="PAYEE">Payee</option>
            </select>
            <select className="input" style={{ width: 'auto' }} aria-label="Match type" value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value as Rule['matchType'] })}>
              <option value="CONTAINS">contains</option>
              <option value="STARTS_WITH">starts with</option>
              <option value="EQUALS">is exactly</option>
            </select>
            <input className="input" style={{ flex: 1, minWidth: 180 }} aria-label="Text to match" placeholder="e.g. WOOLWORTHS" value={form.matchValue} onChange={(e) => setForm({ ...form, matchValue: e.target.value })} />
          </div>
          <p className="muted small">Plain text, ignoring upper and lower case.</p>
        </fieldset>
        <details>
          <summary className="small">More conditions (amount, account, money in or out)</summary>
          <div className="grid-2" style={{ marginTop: '0.75rem' }}>
            <Field label="Minimum amount">{(p) => <MoneyInput {...p} value={form.minAmountCents} onChange={(c) => setForm({ ...form, minAmountCents: c })} />}</Field>
            <Field label="Maximum amount">{(p) => <MoneyInput {...p} value={form.maxAmountCents} onChange={(c) => setForm({ ...form, maxAmountCents: c })} />}</Field>
            <Field label="Account">
              {(p) => <AccountSelect {...p} accounts={accounts.data ?? []} value={form.accountId} placeholder="Any account" onChange={(id) => setForm({ ...form, accountId: id })} />}
            </Field>
            <Field label="Money">
              {(p) => (
                <select {...p} className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Rule['direction'] })}>
                  <option value="ANY">In or out</option>
                  <option value="DEBIT">Out only</option>
                  <option value="CREDIT">In only</option>
                </select>
              )}
            </Field>
          </div>
        </details>
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">Then</legend>
          <div className="segmented" role="group" aria-label="Rule action">
            <button type="button" aria-pressed={form.action === 'CATEGORY'} onClick={() => setForm({ ...form, action: 'CATEGORY' })}>
              Set a category
            </button>
            <button type="button" aria-pressed={form.action === 'TRANSFER'} onClick={() => setForm({ ...form, action: 'TRANSFER' })}>
              Treat as a transfer
            </button>
          </div>
          {form.action === 'CATEGORY' ? (
            <div className="row wrap">
              <select className="input" style={{ width: 'auto' }} aria-label="Category kind" value={form.categoryKind} onChange={(e) => setForm({ ...form, categoryKind: e.target.value as 'EXPENSE' | 'INCOME', setCategoryId: '' })}>
                <option value="EXPENSE">Spending</option>
                <option value="INCOME">Income</option>
              </select>
              <div style={{ flex: 1, minWidth: 200 }}>
                <CategorySelect aria-label="Category" categories={categories.data ?? []} buckets={buckets.data ?? []} kind={form.categoryKind} value={form.setCategoryId} onChange={(id) => setForm({ ...form, setCategoryId: id })} />
              </div>
            </div>
          ) : (
            <AccountSelect aria-label="Other account" accounts={accounts.data ?? []} value={form.setToAccountId} placeholder="The other account" onChange={(id) => setForm({ ...form, setToAccountId: id })} />
          )}
          <div className="grid-2">
            <Field label="Set payee (optional)">{(p) => <input {...p} className="input" value={form.setPayee} onChange={(e) => setForm({ ...form, setPayee: e.target.value })} />}</Field>
            <Field label="Add a note (optional)">{(p) => <input {...p} className="input" value={form.addNote} onChange={(e) => setForm({ ...form, addNote: e.target.value })} />}</Field>
          </div>
        </fieldset>
        <div className="row wrap">
          <Field label="Rule name (optional)">{(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <label className="checkbox" style={{ alignSelf: 'flex-end', paddingBottom: '0.6rem' }}>
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
        </div>

        {test ? (
          <section className="card stack-sm" aria-live="polite">
            <strong>
              Matches {test.matchCount} of the last {test.scanned} transactions
              {test.uncategorisedCount ? ` (${test.uncategorisedCount} uncategorised)` : ''}
            </strong>
            {test.items.slice(0, 10).map((t) => (
              <div key={t.id} className="row small">
                <span className="num muted">{formatDate(t.date, locale, 'short')}</span>
                <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{t.description}</span>
                {t.uncategorised ? <span className="badge warn">Uncategorised</span> : null}
                <Money cents={t.amountCents} />
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
