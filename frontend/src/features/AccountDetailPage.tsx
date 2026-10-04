import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useAccount, useApiMutation, useBalanceHistory, useTransactions } from '../api/hooks';
import { PageHeader } from '../components/PageHeader';
import { ConfirmDialog, Modal } from '../components/Modal';
import { EmptyState, ErrorState, FormError, Loading, errorMessage } from '../components/States';
import { Money } from '../components/Money';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Field';
import { useToast } from '../components/Toast';
import { formatDate, formatMoney, todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';
import { strings } from '../locales/en-AU';
import { AccountForm } from './AccountForm';
import { TransactionRowCompact } from './TransactionsPage';

/** Chart points on a time axis, with one extra day so the final balance is visible as a step. Display only. */
function chartPoints(points: { date: string; balanceCents: number }[]) {
  const out = points.map((p) => ({ t: Date.parse(`${p.date}T00:00:00Z`), balanceCents: p.balanceCents }));
  const last = out[out.length - 1];
  if (last) out.push({ t: last.t + 86_400_000, balanceCents: last.balanceCents });
  return out;
}

export function AccountDetailPage() {
  const { id = '' } = useParams();
  const account = useAccount(id);
  const history = useBalanceHistory(id);
  const recent = useTransactions({ page: 1, pageSize: 10, accountId: id, sort: 'date', order: 'desc' });
  const ctx = useHousehold();
  const [editing, setEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const remove = useApiMutation(() => api.delete(`/accounts/${id}`), MONEY_QUERIES);

  if (account.isPending) return <Loading />;
  if (account.isError) return <ErrorState error={account.error} onRetry={() => account.refetch()} />;
  const a = account.data;

  return (
    <>
      <p className="small" style={{ marginBottom: '0.5rem' }}>
        <Link to="/accounts">← Accounts</Link>
      </p>
      <PageHeader
        title={a.name}
        subtitle={`${strings.accountTypes[a.type]}${a.institution ? ` · ${a.institution}` : ''}${a.last4 ? ` · ••${a.last4}` : ''}`}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setReconciling(true)}>
              Reconcile to statement
            </button>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="btn danger" onClick={() => setDeleting(true)}>
              Delete
            </button>
          </>
        }
      />
      <div className="cards" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <div className="stat-label">{a.class === 'LIABILITY' ? 'Amount owed' : 'Current balance'}</div>
          <div className="stat-value">
            <Money cents={a.balanceCents} />
          </div>
          <div className="muted small">
            Opening <Money cents={a.openingBalanceCents} /> on {formatDate(a.openingDate, ctx.locale)}
          </div>
        </div>
      </div>
      <section className="card" style={{ marginBottom: '1rem' }} aria-labelledby="bh">
        <div className="card-header">
          <h2 id="bh">Balance history</h2>
        </div>
        {history.isPending ? (
          <Loading />
        ) : history.isError ? (
          <ErrorState error={history.error} />
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={chartPoints(history.data.points)} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(t: number) => formatDate(new Date(t).toISOString().slice(0, 10), ctx.locale, 'medium').replace(/ \d{4}$/, '')}
                  stroke="var(--text-3)"
                  fontSize={12}
                  minTickGap={32}
                />
                <YAxis tickFormatter={(c: number) => formatMoney(c, ctx, { compact: true })} stroke="var(--text-3)" fontSize={12} width={70} />
                <Tooltip
                  formatter={(c) => [formatMoney(Number(c), ctx), 'Balance']}
                  labelFormatter={(t) => formatDate(new Date(Number(t)).toISOString().slice(0, 10), ctx.locale)}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                />
                <Area type="stepAfter" dataKey="balanceCents" stroke="var(--primary)" fill="var(--primary-soft)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="rt">
        <div className="card-header">
          <h2 id="rt">Recent transactions</h2>
          <span className="spacer" />
          <Link to={`/transactions?accountId=${a.id}`} className="small">
            View all
          </Link>
        </div>
        {recent.isPending ? (
          <Loading />
        ) : recent.data?.items.length ? (
          recent.data.items.map((t) => <TransactionRowCompact key={t.id} t={t} perspectiveAccountId={a.id} />)
        ) : (
          <EmptyState title="No transactions yet" />
        )}
      </section>

      {editing ? <AccountForm account={a} onClose={() => setEditing(false)} /> : null}
      {reconciling ? <ReconcileDialog accountId={a.id} liability={a.class === 'LIABILITY'} onClose={() => setReconciling(false)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete account?"
          message={remove.error ? errorMessage(remove.error) : 'This can’t be undone. Accounts with transactions can be closed instead, which keeps their history.'}
          busy={remove.isPending}
          onCancel={() => {
            remove.reset();
            setDeleting(false);
          }}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(undefined);
              toast('Account deleted');
              navigate('/accounts');
            } catch {
              /* message shown */
            }
          }}
        />
      ) : null}
    </>
  );
}

function ReconcileDialog({ accountId, liability, onClose }: { accountId: string; liability: boolean; onClose: () => void }) {
  const { timezone } = useHousehold();
  const ctx = useHousehold();
  const [date, setDate] = useState(todayIn(timezone));
  const [statement, setStatement] = useState<number | null>(null);
  const toast = useToast();
  const reconcile = useApiMutation(
    (body: { statementBalanceCents: number; date: string }) =>
      api.post<{ adjustment: { direction: string; amountCents: number } | null }>(`/accounts/${accountId}/reconcile`, body),
    MONEY_QUERIES,
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (statement === null) return;
    try {
      const res = await reconcile.mutateAsync({ statementBalanceCents: statement, date });
      toast(
        res.adjustment
          ? `Adjusted by ${formatMoney(res.adjustment.amountCents, ctx)} (${res.adjustment.direction === 'INCREASE' ? 'up' : 'down'})`
          : 'Already matches the statement',
      );
      onClose();
    } catch {
      /* shown */
    }
  }

  return (
    <Modal
      title="Reconcile to statement"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="reconcile-form" className="btn primary" disabled={statement === null || reconcile.isPending}>
            Reconcile
          </button>
        </>
      }
    >
      <form id="reconcile-form" className="stack" onSubmit={submit} noValidate>
        <p className="muted">
          Enter the closing balance from your statement. If it differs from the app, a balance adjustment is added. Adjustments are neither income nor spending.
        </p>
        <FormError error={reconcile.error instanceof ApiError ? reconcile.error : null} />
        <Field label="Statement date">{(p) => <DateInput {...p} value={date} onChange={setDate} />}</Field>
        <Field label={liability ? 'Statement amount owed' : 'Statement balance'}>
          {(p) => <MoneyInput {...p} value={statement} allowNegative onChange={setStatement} />}
        </Field>
      </form>
    </Modal>
  );
}
