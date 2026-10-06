import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useBuckets, useCategories, useDebts, usePayoff, usePayoffPlan, useSettings } from '../api/hooks';
import type { Debt, DebtWarning, Frequency } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState, ErrorState, FormError, Loading } from '../components/States';
import { Field } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { Money } from '../components/Money';
import { CategorySelect } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { TableWrap } from '../components/TableWrap';
import { useToast } from '../components/Toast';
import { formatDate, formatMoney } from '../lib/format';
import { useHousehold } from '../lib/household';
import { strings } from '../locales/en-AU';
import { SavedBar } from './SinkingFundsPage';
import { describeFrequency } from './RecurringPage';
import { useBucketNames, withBucketNames } from '../lib/bucketNames';

const FREQUENCIES: Frequency[] = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'];
const ESTIMATE_NOTE = 'Estimates only — lenders calculate interest in slightly different ways.';

function WarningNote({ warning }: { warning: DebtWarning }) {
  if (!warning) return null;
  return (
    <p className="small neg" role="alert">
      {warning === 'REPAYMENT_TOO_LOW' ? '! Not paid off at this repayment: it doesn’t cover the interest.' : '! Still owing after 600 repayments at this amount.'}
    </p>
  );
}

export function DebtsPage() {
  const names = useBucketNames();
  const debts = useDebts();
  const accounts = useAccounts();
  const { locale } = useHousehold();
  const [editing, setEditing] = useState<Debt | { accountId: string } | null>(null);

  if (debts.isPending || accounts.isPending) return <Loading />;
  if (debts.isError) return <ErrorState error={debts.error} onRetry={() => debts.refetch()} />;
  const withProfile = new Set(debts.data.map((d) => d.accountId));
  const missing = (accounts.data ?? []).filter((a) => a.class === 'LIABILITY' && !withProfile.has(a.id) && !a.isClosed);

  return (
    <>
      <PageHeader title="Debts" subtitle={ESTIMATE_NOTE} />
      <PageTip id="debts" title="Paying debt down faster">
        {withBucketNames('Repayments up to the minimum count as Bills; anything extra counts as Fire Extinguisher.', names)} Try an extra amount on a debt’s payoff plan to see the time and interest it saves. These are estimates — lenders calculate slightly differently.
      </PageTip>
      {debts.data.length === 0 && missing.length === 0 ? (
        <div className="card">
          <EmptyState title="No debts" action={<Link to="/accounts" className="btn primary">Add a loan or card account</Link>}>
            Debts live on card and loan accounts. Add the account first, then set up its rate and repayments here.
          </EmptyState>
        </div>
      ) : null}
      <div className="stack">
        {debts.data.map((d) => (
          <article key={d.id} className="card stack-sm" aria-labelledby={`debt-${d.id}`}>
            <div className="row wrap">
              <h2 id={`debt-${d.id}`}>{d.accountName}</h2>
              <span className="muted small">
                {strings.accountTypes[d.accountType]} · {d.indexationOnly ? `indexed ${Number(d.annualRate)}% a year` : `${Number(d.annualRate)}% a year`}
              </span>
              <span className="spacer" />
              <Link to={`/debts/${d.id}`} className="btn small primary">
                Payoff plan
              </Link>
              <button type="button" className="btn small" onClick={() => setEditing(d)}>
                Edit
              </button>
            </div>
            <div className="row wrap" style={{ gap: '2rem', alignItems: 'flex-start' }}>
              <div>
                <div className="stat-label">Owing</div>
                <div className="stat-value">
                  <Money cents={d.currentBalanceCents} />
                </div>
              </div>
              <div>
                <div className="stat-label">Repaying</div>
                <div style={{ fontWeight: 650 }}>
                  <Money cents={d.minRepaymentCents + d.extraRepaymentCents} /> {describeFrequency({ frequency: d.repaymentFrequency, interval: d.repaymentInterval }).toLowerCase()}
                </div>
                {d.extraRepaymentCents ? (
                  <div className="muted small">
                    incl. <Money cents={d.extraRepaymentCents} /> extra
                  </div>
                ) : null}
              </div>
              <div>
                <div className="stat-label">Paid off</div>
                <div style={{ fontWeight: 650 }}>{d.payoffDate ? formatDate(d.payoffDate, locale) : '—'}</div>
                {d.payoffDate && d.minimumOnlyPayoffDate && d.minimumOnlyPayoffDate !== d.payoffDate ? (
                  <div className="muted small">minimum only: {formatDate(d.minimumOnlyPayoffDate, locale)}</div>
                ) : null}
              </div>
              <div>
                <div className="stat-label">Interest to go</div>
                <div style={{ fontWeight: 650 }}>
                  <Money cents={d.totalInterestCents} />
                </div>
                <div className="muted small">
                  next: <Money cents={d.nextInterestCents} />
                </div>
              </div>
              <div>
                <div className="stat-label">Principal this period</div>
                <div style={{ fontWeight: 650 }}>
                  <Money cents={d.principalReducedThisPeriodCents} />
                </div>
              </div>
            </div>
            <SavedBar percent={d.percentRepaid} label={`${d.accountName} repaid`} />
            <p className="muted small">
              {d.percentRepaid !== null ? `${d.percentRepaid.toFixed(2)}% of ` : ''}
              <Money cents={d.originalBalanceCents} /> repaid
              {d.offsetCents ? (
                <>
                  {' '}
                  · offset <Money cents={d.offsetCents} /> ({d.offsetAccounts.map((o) => o.name).join(', ')})
                </>
              ) : null}
              {!d.includeInPayoff ? ' · not in the payoff plan' : ''}
            </p>
            <WarningNote warning={d.warning} />
          </article>
        ))}
        {missing.length ? (
          <section className="card" aria-labelledby="missing-h">
            <h2 id="missing-h">Cards and loans without a debt profile</h2>
            {missing.map((a) => (
              <div key={a.id} className="list-item">
                <div className="grow">
                  <strong>{a.name}</strong>
                  <div className="muted small">
                    {strings.accountTypes[a.type]} · owing <Money cents={a.balanceCents} />
                  </div>
                </div>
                <button type="button" className="btn small primary" onClick={() => setEditing({ accountId: a.id })}>
                  Set up
                </button>
              </div>
            ))}
          </section>
        ) : null}
        {debts.data.some((d) => d.includeInPayoff && !d.indexationOnly && d.currentBalanceCents > 0) ? <PlanCard /> : null}
      </div>
      {editing ? <DebtForm debt={'id' in editing ? editing : undefined} accountId={'id' in editing ? editing.accountId : editing.accountId} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function PlanCard() {
  const settings = useSettings();
  const { locale } = useHousehold();
  const ctx = useHousehold();
  const [strategy, setStrategy] = useState<'SNOWBALL' | 'AVALANCHE' | undefined>();
  const [extra, setExtra] = useState<number | null>(null);
  const plan = usePayoffPlan(strategy ?? settings.data?.debtPayoffStrategy, extra ?? undefined);
  const chosen = strategy ?? settings.data?.debtPayoffStrategy ?? 'SNOWBALL';

  return (
    <section className="card stack" aria-labelledby="plan-h">
      <div className="row wrap">
        <h2 id="plan-h">Payoff order</h2>
        <span className="spacer" />
        <div className="segmented" role="group" aria-label="Strategy">
          <button type="button" aria-pressed={chosen === 'SNOWBALL'} onClick={() => setStrategy('SNOWBALL')}>
            Snowball (smallest first)
          </button>
          <button type="button" aria-pressed={chosen === 'AVALANCHE'} onClick={() => setStrategy('AVALANCHE')}>
            Avalanche (highest rate first)
          </button>
        </div>
      </div>
      <p className="muted small">Every debt gets its minimum; the extra goes to the first debt in line. When it’s cleared, its repayment rolls into the next — the Barefoot “domino”.</p>
      <div style={{ maxWidth: 260 }}>
        <Field label="Extra each month" hint="Defaults to the extras set on your debts.">
          {(p) => <MoneyInput {...p} value={extra ?? plan.data?.extraMonthlyCents ?? null} onChange={setExtra} />}
        </Field>
      </div>
      {plan.isPending ? (
        <Loading />
      ) : plan.isError ? (
        <ErrorState error={plan.error} />
      ) : (
        <>
          <TableWrap label="Payoff order">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Debt</th>
                  <th className="right">Owing</th>
                  <th className="right">Rate</th>
                  <th>Cleared</th>
                  <th className="right">Interest</th>
                </tr>
              </thead>
              <tbody>
                {plan.data.order.map((id, i) => {
                  const d = plan.data.debts.find((x) => x.id === id)!;
                  return (
                    <tr key={id}>
                      <td>{i + 1}</td>
                      <td>{d.name}</td>
                      <td className="right num">
                        <Money cents={d.balanceCents} />
                      </td>
                      <td className="right num">{Number(d.annualRate)}%</td>
                      <td className="num">{d.payoffDate ? formatDate(d.payoffDate, locale) : 'Not within 50 years'}</td>
                      <td className="right num">
                        <Money cents={d.interestCents} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <p>
            Debt-free <strong>{plan.data.debtFreeDate ? formatDate(plan.data.debtFreeDate, locale, 'long') : 'not within 50 years'}</strong> with{' '}
            <Money cents={plan.data.totalInterestCents} /> interest.{' '}
            <span className="muted small">
              {plan.data.alternative.strategy === 'AVALANCHE' ? 'Avalanche' : 'Snowball'}:{' '}
              {plan.data.alternative.debtFreeDate ? formatDate(plan.data.alternative.debtFreeDate, locale) : '—'}, <Money cents={plan.data.alternative.totalInterestCents} /> interest.
            </span>
          </p>
          <div style={{ height: 220 }} aria-label="Total owed over time" role="img">
            <ResponsiveContainer>
              <LineChart data={plan.data.timeline} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 4)} stroke="var(--text-3)" fontSize={12} minTickGap={40} />
                <YAxis tickFormatter={(c: number) => formatMoney(c, ctx, { compact: true })} stroke="var(--text-3)" fontSize={12} width={70} />
                <Tooltip formatter={(c) => [formatMoney(Number(c), ctx), 'Total owed']} labelFormatter={(d) => formatDate(String(d), locale)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                <Line type="monotone" dataKey="balanceCents" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}

export function DebtDetailPage() {
  const { id = '' } = useParams();
  const debts = useDebts();
  const [extra, setExtra] = useState<number | null>(null);
  const debt = debts.data?.find((d) => d.id === id);
  const payoff = usePayoff(id, extra ?? debt?.extraRepaymentCents);
  const ctx = useHousehold();
  const { locale } = ctx;
  const [showAll, setShowAll] = useState(false);

  // Merge the two balance schedules by date for the chart. Display only: no amounts are calculated here.
  const series = useMemo(() => {
    if (!payoff.data) return [];
    const byDate = new Map<string, { date: string; minimum?: number; withExtra?: number }>();
    for (const p of payoff.data.minimum.schedule) byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date }), minimum: p.closingCents });
    for (const p of payoff.data.withExtra.schedule) byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date }), withExtra: p.closingCents });
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [payoff.data]);

  if (debts.isPending) return <Loading />;
  if (!debt) return <ErrorState error={new ApiError(404, 'NOT_FOUND', 'Debt not found')} />;

  const p = payoff.data;
  const rows = p ? (showAll ? p.withExtra.schedule : p.withExtra.schedule.slice(0, 24)) : [];
  return (
    <>
      <p className="small" style={{ marginBottom: '0.5rem' }}>
        <Link to="/debts">← Debts</Link>
      </p>
      <PageHeader title={`${debt.accountName} payoff`} subtitle={ESTIMATE_NOTE} />
      <div className="card stack">
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ maxWidth: 260 }}>
            <Field label={`Extra per repayment (${describeFrequency({ frequency: debt.repaymentFrequency, interval: debt.repaymentInterval }).toLowerCase()})`}>
              {(fp) => <MoneyInput {...fp} value={extra ?? debt.extraRepaymentCents} onChange={setExtra} />}
            </Field>
          </div>
          <div className="spacer" />
          {p ? (
            <div className="row wrap" style={{ gap: '2rem' }}>
              <div>
                <div className="stat-label">Time saved</div>
                <div className="stat-value">{p.monthsSaved !== null ? `${Math.floor(p.monthsSaved / 12)}y ${p.monthsSaved % 12}m` : '—'}</div>
              </div>
              <div>
                <div className="stat-label">Interest saved</div>
                <div className="stat-value">{p.interestSavedCents !== null ? <Money cents={p.interestSavedCents} /> : '—'}</div>
              </div>
              <div>
                <div className="stat-label">New payoff date</div>
                <div className="stat-value">{p.withExtra.payoffDate ? formatDate(p.withExtra.payoffDate, locale) : '—'}</div>
              </div>
            </div>
          ) : null}
        </div>
        {p ? (
          <>
            <WarningNote warning={p.minimum.warning} />
            <div style={{ height: 300 }} role="img" aria-label="Balance over time: minimum repayments against minimum plus extra">
              <ResponsiveContainer>
                <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 4)} stroke="var(--text-3)" fontSize={12} minTickGap={40} />
                  <YAxis tickFormatter={(c: number) => formatMoney(c, ctx, { compact: true })} stroke="var(--text-3)" fontSize={12} width={70} />
                  <Tooltip formatter={(c, n) => [formatMoney(Number(c), ctx), n === 'minimum' ? 'Minimum only' : 'With extra']} labelFormatter={(d) => formatDate(String(d), locale)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Legend formatter={(v) => (v === 'minimum' ? 'Minimum only' : 'With extra')} />
                  <Line type="monotone" dataKey="minimum" stroke="var(--text-3)" strokeDasharray="5 4" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="withExtra" stroke="var(--primary)" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <dl className="kv small" style={{ maxWidth: 520 }}>
              <dt>Owing now</dt>
              <dd>
                <Money cents={p.balanceCents} />
              </dd>
              {p.offsetCents ? (
                <>
                  <dt>Offset balance</dt>
                  <dd>
                    <Money cents={p.offsetCents} />
                  </dd>
                </>
              ) : null}
              <dt>Minimum only: paid off</dt>
              <dd>{p.minimum.payoffDate ? formatDate(p.minimum.payoffDate, locale) : '—'}</dd>
              <dt>Minimum only: interest</dt>
              <dd>
                <Money cents={p.minimum.totalInterestCents} />
              </dd>
              <dt>With extra: repayments</dt>
              <dd>{p.withExtra.repayments}</dd>
              <dt>With extra: interest</dt>
              <dd>
                <Money cents={p.withExtra.totalInterestCents} />
              </dd>
            </dl>
          </>
        ) : (
          <Loading />
        )}
      </div>
      {p ? (
        <section className="card" style={{ marginTop: '1rem', padding: 0 }} aria-labelledby="sched-h">
          <div className="card-header" style={{ padding: '1rem 1.25rem 0' }}>
            <h2 id="sched-h">Repayment schedule (with extra)</h2>
          </div>
          <TableWrap label="Repayment schedule">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="right">Payment</th>
                  <th className="right">Interest</th>
                  <th className="right">Principal</th>
                  <th className="right">Owing after</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date}>
                    <td className="num">{formatDate(r.date, locale, 'short')}</td>
                    <td className="right num"><Money cents={r.paymentCents} /></td>
                    <td className="right num"><Money cents={r.interestCents} /></td>
                    <td className="right num"><Money cents={r.principalCents} /></td>
                    <td className="right num"><Money cents={r.closingCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {p.withExtra.schedule.length > 24 ? (
            <div style={{ padding: '0.75rem 1.25rem' }}>
              <button type="button" className="btn small" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show the first 24' : `Show all ${p.withExtra.schedule.length} repayments`}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function DebtForm({ debt, accountId, onClose }: { debt?: Debt; accountId: string; onClose: () => void }) {
  const names = useBucketNames();
  const accounts = useAccounts();
  const categories = useCategories();
  const buckets = useBuckets();
  const toast = useToast();
  const account = accounts.data?.find((a) => a.id === accountId);
  const hecs = account?.type === 'HECS_HELP';
  const [form, setForm] = useState({
    annualRate: debt?.annualRate ? String(Number(debt.annualRate)) : '',
    minRepaymentCents: debt?.minRepaymentCents ?? (null as number | null),
    repaymentFrequency: debt?.repaymentFrequency ?? ('MONTHLY' as Frequency),
    extraRepaymentCents: debt?.extraRepaymentCents ?? 0,
    dueDay: debt?.dueDay ?? (null as number | null),
    startDate: debt?.startDate ?? '',
    originalBalanceCents: debt?.originalBalanceCents ?? account?.openingBalanceCents ?? null,
    categoryId: debt?.categoryId ?? '',
    includeInPayoff: debt?.includeInPayoff ?? !hecs,
  });
  const [deleting, setDeleting] = useState(false);
  const save = useApiMutation((b: unknown) => (debt ? api.put(`/debts/${debt.id}`, b) : api.post('/debts', b)), MONEY_QUERIES);
  const remove = useApiMutation(() => api.delete(`/debts/${debt!.id}`), MONEY_QUERIES);
  const monthly = ['MONTHLY', 'QUARTERLY', 'ANNUALLY'].includes(form.repaymentFrequency);
  const err = (f: string) => (save.error instanceof ApiError && save.error.field === f ? save.error.message : null);
  return (
    <Modal
      title={`${debt ? 'Edit' : 'Set up'} ${account?.name ?? 'debt'}`}
      onClose={onClose}
      wide
      footer={
        <>
          {debt ? (
            <button type="button" className="btn danger" onClick={() => setDeleting(true)}>
              Remove profile
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={save.isPending || form.annualRate === '' || form.minRepaymentCents === null}
            onClick={async () => {
              try {
                await save.mutateAsync({
                  accountId,
                  annualRate: form.annualRate.trim(),
                  minRepaymentCents: form.minRepaymentCents,
                  repaymentFrequency: form.repaymentFrequency,
                  extraRepaymentCents: form.extraRepaymentCents,
                  dueDay: monthly ? form.dueDay : null,
                  startDate: monthly ? null : form.startDate || null,
                  originalBalanceCents: form.originalBalanceCents,
                  categoryId: form.categoryId || null,
                  includeInPayoff: form.includeInPayoff,
                });
                toast('Debt saved');
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
        {hecs ? <p className="muted small">HECS/HELP is indexed once a year (1 June) instead of charging interest, and is repaid through the tax system, so it’s left out of the payoff plan by default.</p> : null}
        <div className="grid-2">
          <Field label={hecs ? 'Indexation rate (% a year)' : 'Interest rate (% a year)'} error={err('annualRate')}>
            {(p) => <input {...p} className="input right" inputMode="decimal" value={form.annualRate} onChange={(e) => setForm({ ...form, annualRate: e.target.value })} placeholder="6.25" />}
          </Field>
          <Field label="Original amount borrowed">{(p) => <MoneyInput {...p} value={form.originalBalanceCents} onChange={(c) => setForm({ ...form, originalBalanceCents: c })} />}</Field>
          <Field label="Minimum repayment" error={err('minRepaymentCents')} hint={`Up to this counts in ${names.bills}; anything more counts in ${names.saving}.`}>
            {(p) => <MoneyInput {...p} value={form.minRepaymentCents} onChange={(c) => setForm({ ...form, minRepaymentCents: c })} />}
          </Field>
          <Field label="How often">
            {(p) => (
              <select {...p} className="input" value={form.repaymentFrequency} onChange={(e) => setForm({ ...form, repaymentFrequency: e.target.value as Frequency })}>
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {strings.frequencies[f]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Extra you pay each time">{(p) => <MoneyInput {...p} value={form.extraRepaymentCents} onChange={(c) => setForm({ ...form, extraRepaymentCents: c ?? 0 })} />}</Field>
          {monthly ? (
            <Field label="Due day of the month" error={err('dueDay')}>
              {(p) => <input {...p} className="input right" type="number" min={1} max={31} value={form.dueDay ?? ''} onChange={(e) => setForm({ ...form, dueDay: e.target.value ? Number(e.target.value) : null })} />}
            </Field>
          ) : (
            <Field label="A repayment date" hint="Any date a repayment is due, to set the pattern.">
              {(p) => <DateInput {...p} value={form.startDate} onChange={(d) => setForm({ ...form, startDate: d })} />}
            </Field>
          )}
          <Field label={`${names.bills} category for the minimum`} hint="Defaults to Mortgage, Loan repayments or Credit card repayments." error={err('categoryId')}>
            {(p) => <CategorySelect {...p} categories={categories.data ?? []} buckets={buckets.data ?? []} kind="EXPENSE" bucketKeys={['BILLS']} placeholder="Default" value={form.categoryId} onChange={(id) => setForm({ ...form, categoryId: id })} />}
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.includeInPayoff} onChange={(e) => setForm({ ...form, includeInPayoff: e.target.checked })} />
          Include in the payoff plan
        </label>
      </div>
      {deleting ? (
        <ConfirmDialog
          title="Remove debt profile?"
          message="The account and its transactions stay. Repayments will no longer be split into minimum and extra."
          busy={remove.isPending}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await remove.mutateAsync(undefined);
            toast('Profile removed');
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}
