import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useBuckets } from '../api/hooks';
import type { Account, AccountType } from '../api/types';
import { Field } from '../components/Field';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { FormError } from '../components/States';
import { useToast } from '../components/Toast';
import { ASSET_TYPES, LIABILITY_TYPES, strings } from '../locales/en-AU';
import { todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';
import { useBucketNames, withBucketNames } from '../lib/bucketNames';

const isLiability = (t: AccountType) => LIABILITY_TYPES.includes(t);

export function AccountForm({ account, onClose, onSaved }: { account?: Account; onClose: () => void; onSaved?: (a: Account) => void }) {
  const names = useBucketNames();
  const { timezone } = useHousehold();
  const buckets = useBuckets();
  const accounts = useAccounts(true);
  const toast = useToast();
  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? ('TRANSACTION' as AccountType),
    institution: account?.institution ?? '',
    openingBalanceCents: account?.openingBalanceCents ?? 0,
    openingDate: account?.openingDate ?? todayIn(timezone),
    last4: account?.last4 ?? '',
    bucketTagId: account?.bucketTagId ?? '',
    includeInBudget: account?.includeInBudget,
    includeInNetWorth: account?.includeInNetWorth ?? true,
    repaymentTreatment: account?.repaymentTreatment ?? null,
    offsetForAccountId: account?.offsetForAccountId ?? '',
    notes: account?.notes ?? '',
    isClosed: account?.isClosed ?? false,
  });
  const liability = isLiability(form.type);

  const save = useApiMutation(
    (body: unknown) => (account ? api.put<Account>(`/accounts/${account.id}`, body) : api.post<Account>('/accounts', body)),
    MONEY_QUERIES,
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...form,
      institution: form.institution || null,
      last4: form.last4 || null,
      bucketTagId: liability ? null : form.bucketTagId || null,
      repaymentTreatment: liability ? form.repaymentTreatment : null,
      offsetForAccountId: form.type === 'OFFSET' ? form.offsetForAccountId || null : null,
      notes: form.notes || null,
    };
    try {
      const saved = await save.mutateAsync(body);
      toast(account ? 'Account saved' : 'Account added');
      onSaved?.(saved);
      onClose();
    } catch {
      /* shown below */
    }
  }

  const err = (field: string) => (save.error instanceof ApiError && save.error.field === field ? save.error.message : null);
  const mortgages = (accounts.data ?? []).filter((a) => a.type === 'MORTGAGE' && a.id !== account?.id);

  return (
    <Modal
      title={account ? 'Edit account' : 'Add account'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="account-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="account-form" className="stack" onSubmit={submit} noValidate>
        <FormError error={save.error && !(save.error instanceof ApiError && save.error.field) ? save.error : null} />
        <div className="grid-2">
          <Field label="Name" error={err('name')}>
            {(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main bank" />}
          </Field>
          <Field label="Type" error={err('type')}>
            {(p) => (
              <select {...p} className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AccountType, repaymentTreatment: null, includeInBudget: undefined })}>
                <optgroup label="Accounts you own">
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {strings.accountTypes[t]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Cards and loans">
                  {LIABILITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {strings.accountTypes[t]}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
          </Field>
          <Field label={liability ? 'Amount owed at opening' : 'Opening balance'} hint="The balance is then worked out from transactions." error={err('openingBalanceCents')}>
            {(p) => <MoneyInput {...p} value={form.openingBalanceCents} allowNegative={!liability} onChange={(c) => setForm({ ...form, openingBalanceCents: c ?? 0 })} />}
          </Field>
          <Field label="Opening date" error={err('openingDate')}>
            {(p) => <DateInput {...p} value={form.openingDate} onChange={(d) => setForm({ ...form, openingDate: d })} />}
          </Field>
          <Field label="Institution">
            {(p) => <input {...p} className="input" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} placeholder="e.g. ING" />}
          </Field>
          <Field label="Last 4 digits" hint="Only the last 4 digits are ever stored." error={err('last4')}>
            {(p) => (
              <input {...p} className="input" inputMode="numeric" maxLength={4} value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            )}
          </Field>
          {!liability ? (
            <Field label="Bucket tag" hint={`Money moved into a ${names.saving} account counts as a savings contribution.`}>
              {(p) => (
                <select {...p} className="input" value={form.bucketTagId} onChange={(e) => setForm({ ...form, bucketTagId: e.target.value })}>
                  <option value="">None</option>
                  {(buckets.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <Field label="Repayment treatment" hint="Decides how repayments count in the budget.">
              {(p) => (
                <select
                  {...p}
                  className="input"
                  value={form.repaymentTreatment ?? (form.type === 'CREDIT_CARD' || form.type === 'HECS_HELP' ? 'TRANSFER' : 'DEBT_REPAYMENT')}
                  onChange={(e) => setForm({ ...form, repaymentTreatment: e.target.value as 'TRANSFER' | 'DEBT_REPAYMENT' })}
                >
                  <option value="TRANSFER">{strings.repaymentTreatments.TRANSFER}</option>
                  <option value="DEBT_REPAYMENT">{strings.repaymentTreatments.DEBT_REPAYMENT}</option>
                </select>
              )}
            </Field>
          )}
          {form.type === 'OFFSET' ? (
            <Field label="Offsets mortgage" error={err('offsetForAccountId')}>
              {(p) => (
                <select {...p} className="input" value={form.offsetForAccountId} onChange={(e) => setForm({ ...form, offsetForAccountId: e.target.value })}>
                  <option value="">Not linked</option>
                  {mortgages.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </div>
        <div className="row wrap" style={{ gap: '1.5rem' }}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.includeInBudget ?? !['SUPERANNUATION', 'INVESTMENT', 'OTHER_ASSET', 'HECS_HELP'].includes(form.type)}
              onChange={(e) => setForm({ ...form, includeInBudget: e.target.checked })}
            />
            Include in budget
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={form.includeInNetWorth} onChange={(e) => setForm({ ...form, includeInNetWorth: e.target.checked })} />
            Include in net worth
          </label>
          {account ? (
            <label className="checkbox">
              <input type="checkbox" checked={form.isClosed} onChange={(e) => setForm({ ...form, isClosed: e.target.checked })} />
              Closed (hidden, history kept)
            </label>
          ) : null}
        </div>
        <Field label="Notes">{(p) => <textarea {...p} className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}
