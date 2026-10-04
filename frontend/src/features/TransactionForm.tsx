import { useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useBuckets, useCategories } from '../api/hooks';
import type { Account, Transaction, TransactionType } from '../api/types';
import { Field } from '../components/Field';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { AccountSelect, CategorySelect } from '../components/Pickers';
import { FormError, Loading } from '../components/States';
import { Money } from '../components/Money';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { strings } from '../locales/en-AU';
import { todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';

const PRIMARY_TYPES: TransactionType[] = ['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND'];
const OTHER_TYPES: TransactionType[] = ['DEBT_REPAYMENT', 'SAVINGS_CONTRIBUTION', 'BALANCE_ADJUSTMENT', 'INTEREST_CHARGE'];
const TWO_ACCOUNT: TransactionType[] = ['TRANSFER', 'DEBT_REPAYMENT', 'SAVINGS_CONTRIBUTION'];
const CATEGORISED: TransactionType[] = ['EXPENSE', 'INCOME', 'REFUND'];

interface SplitRow {
  key: number;
  categoryId: string;
  amountCents: number | null;
}

let rowKey = 0;

export function TransactionForm({ transaction, defaultAccountId, onClose }: { transaction?: Transaction; defaultAccountId?: string; onClose: () => void }) {
  const { timezone } = useHousehold();
  const accounts = useAccounts(true);
  const categories = useCategories(true);
  const buckets = useBuckets();
  const toast = useToast();

  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'EXPENSE');
  const [form, setForm] = useState({
    date: transaction?.date ?? todayIn(timezone),
    description: transaction?.description ?? '',
    payee: transaction?.payee ?? '',
    amountCents: transaction?.amountCents ?? (null as number | null),
    accountId: transaction?.accountId ?? defaultAccountId ?? '',
    toAccountId: transaction?.toAccountId ?? '',
    direction: transaction?.direction ?? ('INCREASE' as 'INCREASE' | 'DECREASE'),
    notes: transaction?.notes ?? '',
    cleared: transaction?.cleared ?? false,
  });
  const initialSplits: SplitRow[] = transaction?.splits.length
    ? transaction.splits.filter((s) => !s.isExtraRepayment).map((s) => ({ key: ++rowKey, categoryId: s.categoryId, amountCents: s.amountCents }))
    : [{ key: ++rowKey, categoryId: '', amountCents: null }];
  const [splits, setSplits] = useState<SplitRow[]>(initialSplits);
  const [splitMode, setSplitMode] = useState(initialSplits.length > 1);
  const [showOther, setShowOther] = useState(OTHER_TYPES.includes(type));

  const save = useApiMutation(
    (body: unknown) => (transaction ? api.put<Transaction>(`/transactions/${transaction.id}`, body) : api.post<Transaction>('/transactions', body)),
    MONEY_QUERIES,
  );

  const accountList = accounts.data ?? [];
  const from = accountList.find((a) => a.id === form.accountId);
  const fireBucket = buckets.data?.find((b) => b.key === 'FIRE_EXTINGUISHER');
  const isFire = (a: Account) => a.class === 'ASSET' && a.bucketTagId === fireBucket?.id;

  // Live feedback only: the API checks the split total again.
  const splitTotal = useMemo(() => splits.reduce((s, r) => s + (r.amountCents ?? 0), 0), [splits]);
  const remaining = (form.amountCents ?? 0) - splitTotal;

  if (accounts.isPending || categories.isPending || buckets.isPending) {
    return (
      <Modal title={transaction ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
        <Loading />
      </Modal>
    );
  }

  const categoryKind = type === 'INCOME' ? 'INCOME' : 'EXPENSE';

  async function submit(e: FormEvent) {
    e.preventDefault();
    let bodySplits: { categoryId: string; amountCents: number }[] | undefined;
    if (CATEGORISED.includes(type)) {
      bodySplits = splitMode
        ? splits.filter((s) => s.categoryId || s.amountCents).map((s) => ({ categoryId: s.categoryId, amountCents: s.amountCents ?? 0 }))
        : splits[0]?.categoryId
          ? [{ categoryId: splits[0].categoryId, amountCents: form.amountCents ?? 0 }]
          : [];
    } else if (type === 'SAVINGS_CONTRIBUTION' && splits[0]?.categoryId) {
      bodySplits = [{ categoryId: splits[0].categoryId, amountCents: form.amountCents ?? 0 }];
    }
    const body = {
      date: form.date,
      description: form.description,
      payee: form.payee || null,
      amountCents: form.amountCents ?? 0,
      type,
      accountId: form.accountId,
      toAccountId: TWO_ACCOUNT.includes(type) ? form.toAccountId || null : null,
      direction: type === 'BALANCE_ADJUSTMENT' ? form.direction : null,
      splits: bodySplits,
      notes: form.notes || null,
      cleared: form.cleared,
    };
    try {
      const saved = await save.mutateAsync(body);
      toast(saved.type !== type ? `Saved as ${strings.transactionTypes[saved.type].toLowerCase()}` : transaction ? 'Transaction saved' : 'Transaction added');
      onClose();
    } catch {
      /* shown */
    }
  }

  const err = (field: string) => (save.error instanceof ApiError && save.error.field?.startsWith(field) ? save.error.message : null);
  const generalError = save.error && !(save.error instanceof ApiError && save.error.field) ? save.error : null;

  const toFilter = (a: Account) => {
    if (a.id === form.accountId) return false;
    if (type === 'DEBT_REPAYMENT') return a.class === 'LIABILITY';
    if (type === 'SAVINGS_CONTRIBUTION') return isFire(a);
    return true;
  };

  return (
    <Modal
      title={transaction ? 'Edit transaction' : 'Add transaction'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="tx-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="tx-form" className="stack" onSubmit={submit} noValidate>
        <div className="stack-sm">
          <div className="segmented" role="group" aria-label="Transaction type">
            {(showOther ? [...PRIMARY_TYPES, ...OTHER_TYPES] : PRIMARY_TYPES).map((t) => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
                {strings.transactionTypes[t]}
              </button>
            ))}
            {!showOther ? (
              <button type="button" onClick={() => setShowOther(true)}>
                More…
              </button>
            ) : null}
          </div>
          <p className="muted small">{strings.transactionTypeHelp[type]}</p>
        </div>
        <FormError error={generalError} />

        <div className="grid-2">
          <Field label="Date" error={err('date')}>
            {(p) => <DateInput {...p} value={form.date} onChange={(d) => setForm({ ...form, date: d })} />}
          </Field>
          <Field label="Amount" error={err('amountCents')}>
            {(p) => <MoneyInput {...p} value={form.amountCents} onChange={(c) => setForm({ ...form, amountCents: c })} placeholder="0.00" />}
          </Field>
          <Field label="Description" error={err('description')}>
            {(p) => <input {...p} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Weekly shop" />}
          </Field>
          <Field label="Payee (optional)">
            {(p) => <input {...p} className="input" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} />}
          </Field>
          <Field label={TWO_ACCOUNT.includes(type) ? 'From account' : type === 'INCOME' || type === 'REFUND' ? 'Into account' : 'Account'} error={err('accountId')}>
            {(p) => (
              <AccountSelect
                {...p}
                accounts={accountList}
                value={form.accountId}
                filter={type === 'INTEREST_CHARGE' ? (a) => a.class === 'LIABILITY' : TWO_ACCOUNT.includes(type) && type !== 'TRANSFER' ? (a) => a.class === 'ASSET' : undefined}
                onChange={(id) => setForm({ ...form, accountId: id })}
              />
            )}
          </Field>
          {TWO_ACCOUNT.includes(type) ? (
            <Field label="To account" error={err('toAccountId')} hint={type === 'SAVINGS_CONTRIBUTION' ? 'Accounts tagged Fire Extinguisher.' : undefined}>
              {(p) => <AccountSelect {...p} accounts={accountList} value={form.toAccountId} filter={toFilter} onChange={(id) => setForm({ ...form, toAccountId: id })} />}
            </Field>
          ) : null}
          {type === 'BALANCE_ADJUSTMENT' ? (
            <Field label="Direction" error={err('direction')}>
              {(p) => (
                <select {...p} className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'INCREASE' | 'DECREASE' })}>
                  <option value="INCREASE">Increase {from?.class === 'LIABILITY' ? 'amount owed' : 'balance'}</option>
                  <option value="DECREASE">Decrease {from?.class === 'LIABILITY' ? 'amount owed' : 'balance'}</option>
                </select>
              )}
            </Field>
          ) : null}
        </div>

        {CATEGORISED.includes(type) ? (
          <div className="stack-sm">
            <div className="row">
              <span className="field-label">{splitMode ? 'Split between categories' : 'Category'}</span>
              <span className="spacer" />
              {type === 'EXPENSE' ? (
                <button
                  type="button"
                  className="link-btn small"
                  onClick={() => {
                    if (!splitMode) setSplits([{ ...splits[0]!, amountCents: form.amountCents }, { key: ++rowKey, categoryId: '', amountCents: null }]);
                    else setSplits([{ ...splits[0]!, amountCents: null }]);
                    setSplitMode(!splitMode);
                  }}
                >
                  {splitMode ? 'Use one category' : 'Split'}
                </button>
              ) : null}
            </div>
            {splits.slice(0, splitMode ? undefined : 1).map((row, i) => (
              <div key={row.key} className="row">
                <div style={{ flex: 2, minWidth: 0 }}>
                  <CategorySelect
                    aria-label={`Category ${i + 1}`}
                    aria-invalid={err(`splits.${i}`) || (err('splits') && !row.categoryId) ? true : undefined}
                    categories={categories.data ?? []}
                    buckets={buckets.data ?? []}
                    kind={categoryKind}
                    value={row.categoryId}
                    onChange={(id) => setSplits(splits.map((s) => (s.key === row.key ? { ...s, categoryId: id } : s)))}
                  />
                </div>
                {splitMode ? (
                  <>
                    <div style={{ flex: 1 }}>
                      <MoneyInput aria-label={`Amount ${i + 1}`} value={row.amountCents} onChange={(c) => setSplits(splits.map((s) => (s.key === row.key ? { ...s, amountCents: c } : s)))} />
                    </div>
                    <button type="button" className="btn ghost icon" aria-label={`Remove split ${i + 1}`} disabled={splits.length <= 2} onClick={() => setSplits(splits.filter((s) => s.key !== row.key))}>
                      <Icon name="trash" />
                    </button>
                  </>
                ) : null}
              </div>
            ))}
            {splitMode ? (
              <div className="row small">
                <button type="button" className="link-btn" onClick={() => setSplits([...splits, { key: ++rowKey, categoryId: '', amountCents: remaining > 0 ? remaining : null }])}>
                  + Add split
                </button>
                <span className="spacer" />
                <span className={remaining === 0 ? 'muted' : 'neg'} aria-live="polite">
                  {remaining === 0 ? 'Splits match the amount' : <>Left to allocate: <Money cents={remaining} /></>}
                </span>
              </div>
            ) : null}
            {err('splits') ? <span className="error small" role="alert">{err('splits')}</span> : null}
          </div>
        ) : null}

        {type === 'SAVINGS_CONTRIBUTION' ? (
          <Field label="Fire Extinguisher category" hint="Defaults to Savings contributions.">
            {(p) => (
              <CategorySelect
                {...p}
                categories={categories.data ?? []}
                buckets={buckets.data ?? []}
                kind="EXPENSE"
                bucketKeys={['FIRE_EXTINGUISHER']}
                placeholder="Savings contributions"
                value={splits[0]?.categoryId ?? ''}
                onChange={(id) => setSplits([{ key: ++rowKey, categoryId: id, amountCents: null }])}
              />
            )}
          </Field>
        ) : null}
        {type === 'DEBT_REPAYMENT' ? (
          <p className="muted small">
            For loans, the minimum repayment counts in Bills and anything extra counts in Fire Extinguisher. For cards set to Transfer, the repayment counts as nothing because the purchases were already counted.
          </p>
        ) : null}
        {transaction?.splits.some((s) => s.isExtraRepayment) && type === 'DEBT_REPAYMENT' ? (
          <p className="small">
            Current split: {transaction.splits.map((s) => `${s.categoryName} `).join('+ ')}
          </p>
        ) : null}

        <Field label="Notes">{(p) => <textarea {...p} className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
        <label className="checkbox">
          <input type="checkbox" checked={form.cleared} onChange={(e) => setForm({ ...form, cleared: e.target.checked })} />
          Cleared (appears on a bank statement)
        </label>
      </form>
    </Modal>
  );
}
