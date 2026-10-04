import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useBuckets, useCategories } from '../api/hooks';
import type { Account, Frequency, Recurring, RecurringType } from '../api/types';
import { Modal } from '../components/Modal';
import { Field } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { AccountSelect, CategorySelect } from '../components/Pickers';
import { FormError, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { strings } from '../locales/en-AU';
import { todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';

const TYPES: RecurringType[] = ['EXPENSE', 'INCOME', 'DEBT_REPAYMENT', 'TRANSFER', 'SAVINGS_CONTRIBUTION'];
const FREQUENCIES: Frequency[] = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'SIX_MONTHLY', 'ANNUALLY', 'EVERY_N_DAYS', 'EVERY_N_WEEKS', 'EVERY_N_MONTHS'];

export function RecurringForm({ schedule, defaultType, onClose }: { schedule?: Recurring; defaultType?: RecurringType; onClose: () => void }) {
  const { timezone } = useHousehold();
  const accounts = useAccounts(true);
  const categories = useCategories(true);
  const buckets = useBuckets();
  const toast = useToast();
  const [form, setForm] = useState({
    name: schedule?.name ?? '',
    type: schedule?.type ?? defaultType ?? ('EXPENSE' as RecurringType),
    amountCents: schedule?.amountCents ?? (null as number | null),
    amountKind: schedule?.amountKind ?? ('FIXED' as 'FIXED' | 'ESTIMATE'),
    frequency: schedule?.frequency ?? ('MONTHLY' as Frequency),
    interval: schedule?.interval ?? 2,
    startDate: schedule?.startDate ?? todayIn(timezone),
    endMode: schedule?.endDate ? 'date' : schedule?.occurrenceCount ? 'count' : 'never',
    endDate: schedule?.endDate ?? '',
    occurrenceCount: schedule?.occurrenceCount ?? 12,
    weekendRule: schedule?.weekendRule ?? ('NONE' as Recurring['weekendRule']),
    autoPost: schedule?.autoPost ?? false,
    accountId: schedule?.accountId ?? '',
    toAccountId: schedule?.toAccountId ?? '',
    categoryId: schedule?.categoryId ?? '',
    payee: schedule?.payee ?? '',
    notes: schedule?.notes ?? '',
    isActive: schedule?.isActive ?? true,
  });
  const [applyFrom, setApplyFrom] = useState<'all' | 'from'>('all');
  const [fromDate, setFromDate] = useState(schedule?.nextOccurrence?.occurrenceDate ?? todayIn(timezone));

  const save = useApiMutation(
    (body: unknown) =>
      schedule
        ? api.put<Recurring>(`/recurring-transactions/${schedule.id}${applyFrom === 'from' ? `?fromDate=${fromDate}` : ''}`, body)
        : api.post<Recurring>('/recurring-transactions', body),
    MONEY_QUERIES,
  );

  if (accounts.isPending || categories.isPending || buckets.isPending) {
    return (
      <Modal title={schedule ? 'Edit schedule' : 'New schedule'} onClose={onClose}>
        <Loading />
      </Modal>
    );
  }

  const fire = buckets.data?.find((b) => b.key === 'FIRE_EXTINGUISHER');
  const twoAccounts = form.type === 'TRANSFER' || form.type === 'DEBT_REPAYMENT' || form.type === 'SAVINGS_CONTRIBUTION';
  const custom = form.frequency.startsWith('EVERY_N_');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      type: form.type,
      amountCents: form.amountCents ?? 0,
      amountKind: form.amountKind,
      frequency: form.frequency,
      interval: custom ? form.interval : null,
      startDate: applyFrom === 'from' && schedule ? fromDate : form.startDate,
      endDate: form.endMode === 'date' ? form.endDate || null : null,
      occurrenceCount: form.endMode === 'count' ? form.occurrenceCount : null,
      weekendRule: form.weekendRule,
      autoPost: form.autoPost,
      accountId: form.accountId,
      toAccountId: twoAccounts ? form.toAccountId || null : null,
      categoryId: form.type === 'TRANSFER' || form.type === 'DEBT_REPAYMENT' ? null : form.categoryId || null,
      payee: form.payee || null,
      notes: form.notes || null,
      isActive: form.isActive,
    };
    try {
      await save.mutateAsync(body);
      toast(schedule ? 'Schedule saved' : 'Schedule added');
      onClose();
    } catch {
      /* shown */
    }
  }

  const err = (field: string) => (save.error instanceof ApiError && save.error.field === field ? save.error.message : null);
  const toFilter = (a: Account) =>
    a.id !== form.accountId && (form.type === 'DEBT_REPAYMENT' ? a.class === 'LIABILITY' : form.type === 'SAVINGS_CONTRIBUTION' ? a.class === 'ASSET' && a.bucketTagId === fire?.id : true);

  return (
    <Modal
      title={schedule ? 'Edit schedule' : 'New schedule'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="recurring-form" className="btn primary" disabled={save.isPending}>
            Save
          </button>
        </>
      }
    >
      <form id="recurring-form" className="stack" onSubmit={submit} noValidate>
        <p className="muted small">A schedule never creates future transactions. Each occurrence is recorded when you mark it paid, or automatically on the day if auto-post is on.</p>
        <FormError error={save.error && !(save.error instanceof ApiError && save.error.field) ? save.error : null} />
        {schedule ? (
          <fieldset className="card stack-sm" style={{ padding: '0.75rem 1rem' }}>
            <legend className="field-label">Apply changes to</legend>
            <label className="checkbox">
              <input type="radio" name="apply" checked={applyFrom === 'all'} onChange={() => setApplyFrom('all')} />
              Every occurrence
            </label>
            <label className="checkbox">
              <input type="radio" name="apply" checked={applyFrom === 'from'} onChange={() => setApplyFrom('from')} />
              Occurrences from a date onward
            </label>
            {applyFrom === 'from' ? <DateInput aria-label="Apply from" value={fromDate} onChange={setFromDate} /> : null}
          </fieldset>
        ) : null}
        <div className="grid-2">
          <Field label="Name" error={err('name')}>
            {(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Netflix" />}
          </Field>
          <Field label="Type">
            {(p) => (
              <select {...p} className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as RecurringType, categoryId: '', toAccountId: '' })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {strings.recurringTypes[t]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Amount" error={err('amountCents')}>
            {(p) => <MoneyInput {...p} value={form.amountCents} onChange={(c) => setForm({ ...form, amountCents: c })} />}
          </Field>
          <Field label="Amount is" hint="Estimates match imports within ±20%.">
            {(p) => (
              <select {...p} className="input" value={form.amountKind} onChange={(e) => setForm({ ...form, amountKind: e.target.value as 'FIXED' | 'ESTIMATE' })}>
                <option value="FIXED">Fixed</option>
                <option value="ESTIMATE">An estimate</option>
              </select>
            )}
          </Field>
          <Field label="How often" error={err('frequency')}>
            {(p) => (
              <select {...p} className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {strings.frequencies[f]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {custom ? (
            <Field label={`Every how many ${form.frequency === 'EVERY_N_DAYS' ? 'days' : form.frequency === 'EVERY_N_WEEKS' ? 'weeks' : 'months'}`}>
              {(p) => <input {...p} className="input right" type="number" min={1} max={366} value={form.interval} onChange={(e) => setForm({ ...form, interval: Number(e.target.value) })} />}
            </Field>
          ) : null}
          {applyFrom === 'all' || !schedule ? (
            <Field label="First date" hint={form.frequency === 'MONTHLY' ? 'Monthly dates keep this day, moving to the last day in shorter months.' : undefined} error={err('startDate')}>
              {(p) => <DateInput {...p} value={form.startDate} onChange={(d) => setForm({ ...form, startDate: d })} />}
            </Field>
          ) : null}
          <Field label="Ends">
            {(p) => (
              <select {...p} className="input" value={form.endMode} onChange={(e) => setForm({ ...form, endMode: e.target.value })}>
                <option value="never">Never</option>
                <option value="date">On a date</option>
                <option value="count">After a number of times</option>
              </select>
            )}
          </Field>
          {form.endMode === 'date' ? (
            <Field label="End date" error={err('endDate')}>
              {(p) => <DateInput {...p} value={form.endDate} onChange={(d) => setForm({ ...form, endDate: d })} />}
            </Field>
          ) : null}
          {form.endMode === 'count' ? (
            <Field label="Number of times">
              {(p) => <input {...p} className="input right" type="number" min={1} value={form.occurrenceCount} onChange={(e) => setForm({ ...form, occurrenceCount: Number(e.target.value) })} />}
            </Field>
          ) : null}
          <Field label="On a weekend">
            {(p) => (
              <select {...p} className="input" value={form.weekendRule} onChange={(e) => setForm({ ...form, weekendRule: e.target.value as Recurring['weekendRule'] })}>
                {Object.entries(strings.weekendRules).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={twoAccounts ? 'From account' : form.type === 'INCOME' ? 'Paid into' : 'Paid from'} error={err('accountId')}>
            {(p) => (
              <AccountSelect
                {...p}
                accounts={accounts.data ?? []}
                value={form.accountId}
                filter={form.type === 'DEBT_REPAYMENT' || form.type === 'SAVINGS_CONTRIBUTION' ? (a) => a.class === 'ASSET' : undefined}
                onChange={(id) => setForm({ ...form, accountId: id })}
              />
            )}
          </Field>
          {twoAccounts ? (
            <Field label="To account" error={err('toAccountId')}>
              {(p) => <AccountSelect {...p} accounts={accounts.data ?? []} value={form.toAccountId} filter={toFilter} onChange={(id) => setForm({ ...form, toAccountId: id })} />}
            </Field>
          ) : null}
          {form.type === 'INCOME' || form.type === 'EXPENSE' || form.type === 'SAVINGS_CONTRIBUTION' ? (
            <Field label="Category" error={err('categoryId')}>
              {(p) => (
                <CategorySelect
                  {...p}
                  categories={categories.data ?? []}
                  buckets={buckets.data ?? []}
                  kind={form.type === 'INCOME' ? 'INCOME' : 'EXPENSE'}
                  bucketKeys={form.type === 'SAVINGS_CONTRIBUTION' ? ['FIRE_EXTINGUISHER'] : undefined}
                  placeholder={form.type === 'SAVINGS_CONTRIBUTION' ? 'Savings contributions' : 'Choose a category'}
                  value={form.categoryId}
                  onChange={(id) => setForm({ ...form, categoryId: id })}
                />
              )}
            </Field>
          ) : null}
          <Field label="Payee (optional)">{(p) => <input {...p} className="input" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} />}</Field>
        </div>
        <div className="row wrap" style={{ gap: '1.5rem' }}>
          <label className="checkbox">
            <input type="checkbox" checked={form.autoPost} onChange={(e) => setForm({ ...form, autoPost: e.target.checked })} />
            Auto-post on the day (from 2am)
          </label>
          {schedule ? (
            <label className="checkbox">
              <input type="checkbox" checked={!form.isActive} onChange={(e) => setForm({ ...form, isActive: !e.target.checked })} />
              Paused
            </label>
          ) : null}
        </div>
        <Field label="Notes">{(p) => <textarea {...p} className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </form>
    </Modal>
  );
}
