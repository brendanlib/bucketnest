import { useState } from 'react';
import { bucketColour } from '../lib/colours';
import { Link } from 'react-router';
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { useDashboard, useSettings } from '../api/hooks';
import type { Dashboard, Normalised } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ErrorState, Loading } from '../components/States';
import { Money } from '../components/Money';
import { PeriodSelector } from '../components/PeriodSelector';
import { StatusBadge } from '../components/Progress';
import { formatDate, formatMoney, relativeDays } from '../lib/format';
import { useHousehold } from '../lib/household';
import { BucketCard } from './BucketCard';
import { OccurrenceActions, OccurrenceStatusBadge } from './OccurrenceActions';
import { GettingStarted, WelcomeDialog } from './GettingStarted';

const FREQ_LABEL: Record<keyof Normalised, string> = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', annual: 'Annual' };
const DISPLAY_KEY: Record<string, keyof Normalised> = { WEEKLY: 'weekly', FORTNIGHTLY: 'fortnightly', MONTHLY: 'monthly', ANNUALLY: 'annual' };

function IncomePanel({ d, displayFrequency }: { d: Dashboard; displayFrequency: keyof Normalised }) {
  const { income } = d;
  return (
    <section className="card" aria-labelledby="income-h">
      <div className="card-header">
        <h2 id="income-h">Income</h2>
      </div>
      <div className="grid-2">
        <div>
          <div className="stat-label">Expected take-home</div>
          <div className="stat-value">
            <Money cents={income.expected[displayFrequency]} />
            <span className="muted small"> / {FREQ_LABEL[displayFrequency].toLowerCase()}</span>
          </div>
          {income.plannedSource === 'none' ? (
            <p className="small muted">
              <Link to="/recurring">Add your pay</Link> as a recurring income to plan bucket allocations.
            </p>
          ) : (
            <dl className="kv small" style={{ marginTop: '0.5rem' }}>
              {(Object.keys(FREQ_LABEL) as (keyof Normalised)[])
                .filter((k) => k !== displayFrequency)
                .map((k) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{FREQ_LABEL[k]}</dt>
                    <dd>
                      <Money cents={income.expected[k]} />
                    </dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
        <div>
          <div className="stat-label">Received this period</div>
          <div className="stat-value">
            <Money cents={income.actualCents} />
          </div>
          <dl className="kv small" style={{ marginTop: '0.5rem' }}>
            <dt>Planned for the period</dt>
            <dd>
              <Money cents={income.plannedCents} />
            </dd>
            <dt>From schedules</dt>
            <dd>
              <Money cents={income.scheduledCents} />
            </dd>
            <dt>Other income</dt>
            <dd>
              <Money cents={income.otherCents} />
            </dd>
          </dl>
        </div>
      </div>
    </section>
  );
}

function NetWorthCard({ d }: { d: Dashboard }) {
  const ctx = useHousehold();
  const nw = d.netWorth;
  return (
    <section className="card" aria-labelledby="nw-h">
      <div className="card-header">
        <h2 id="nw-h">Net worth</h2>
      </div>
      <div className="stat-value">
        <Money cents={nw.netWorthCents} />
      </div>
      <div className="muted small">
        Assets <Money cents={nw.assetsCents} /> · Liabilities <Money cents={nw.liabilitiesCents} />
      </div>
      <div style={{ height: 70, marginTop: '0.5rem' }} aria-label="Net worth over the last 12 months" role="img">
        <ResponsiveContainer>
          <LineChart data={nw.history}>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Tooltip
              formatter={(c) => [formatMoney(Number(c), ctx), 'Net worth']}
              labelFormatter={(_, p) => (p?.[0] ? formatDate(String(p[0].payload.date), ctx.locale) : '')}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
            />
            <Line type="monotone" dataKey="netWorthCents" stroke="var(--primary)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const [period, setPeriod] = useState<string | undefined>();
  const [basis, setBasis] = useState<'PLANNED' | 'ACTUAL' | undefined>();
  const dashboard = useDashboard(period, basis);
  const settings = useSettings();
  const { locale } = useHousehold();

  if (dashboard.isPending) return <Loading />;
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />;
  const d = dashboard.data;
  const displayFrequency = DISPLAY_KEY[settings.data?.displayFrequency ?? 'MONTHLY'] ?? 'monthly';
  const effectiveBasis = basis ?? d.income.allocationBasis;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={d.budget.name} actions={<PeriodSelector period={d.period} onChange={setPeriod} />} />
      <PageTip id="dashboard" title="Your period at a glance">
        Each bucket card shows what it was allocated from your income, what has gone out, and what is left. Bars turn amber near the limit and red when over. Step back and forward through periods with the arrows.
      </PageTip>

      {d.uncategorisedCount > 0 ? (
        <div className="card row wrap" style={{ marginBottom: '1rem', borderColor: 'var(--warning)' }} role="status">
          <span className="badge warn">
            <span aria-hidden="true">!</span> {d.uncategorisedCount} uncategorised
          </span>
          <span className="small">Transactions without a category aren’t counted in any bucket.</span>
          <span className="spacer" />
          <Link to="/transactions?uncategorised=true" className="btn small">
            Categorise
          </Link>
        </div>
      ) : null}

      <WelcomeDialog />
      <div className="stack">
        <GettingStarted />
        <IncomePanel d={d} displayFrequency={displayFrequency} />

        <section aria-labelledby="buckets-h" className="stack-sm">
          <div className="row wrap">
            <h2 id="buckets-h">Buckets</h2>
            <span className="spacer" />
            <span className="small muted">Allocate from</span>
            <div className="segmented" role="group" aria-label="Allocation basis">
              <button type="button" aria-pressed={effectiveBasis === 'PLANNED'} onClick={() => setBasis('PLANNED')}>
                Planned income
              </button>
              <button type="button" aria-pressed={effectiveBasis === 'ACTUAL'} onClick={() => setBasis('ACTUAL')}>
                Income received
              </button>
            </div>
          </div>
          <p className="muted small">
            Allocations are shared from <Money cents={d.income.allocationIncomeCents} />.
          </p>
          <div className="bucket-cards">
            {d.buckets.map((b) => (
              <BucketCard key={b.bucketId} bucket={b} />
            ))}
          </div>
        </section>

        <div className="dash-grid">
          <section className="card" aria-labelledby="bills-h">
            <div className="card-header">
              <h2 id="bills-h">Bills due</h2>
              <span className="muted small">next 14 days</span>
              <span className="spacer" />
              <Link to="/bills" className="small">
                All bills
              </Link>
            </div>
            {d.billsDue.length === 0 ? (
              <p className="muted small">Nothing due. </p>
            ) : (
              d.billsDue.map((o) => (
                <div key={`${o.recurringId}-${o.occurrenceDate}`} className="list-item bill-row">
                  <div className="grow">
                    <div className="row" style={{ gap: '0.4rem' }}>
                      <strong>{o.name}</strong>
                      {o.amountKind === 'ESTIMATE' ? <span className="badge">Estimate</span> : null}
                    </div>
                    <div className="muted small">
                      {formatDate(o.date, locale)} · {relativeDays(o.date, d.period.today)} <OccurrenceStatusBadge status={o.status} />
                    </div>
                  </div>
                  <Money cents={o.amountCents} />
                  <OccurrenceActions occurrence={o} compact />
                </div>
              ))
            )}
          </section>

          <div className="stack">
            <section className="card" aria-labelledby="watch-h">
              <div className="card-header">
                <h2 id="watch-h">Watch list</h2>
              </div>
              {d.alerts.length === 0 ? (
                <p className="muted small">No categories are near or over budget.</p>
              ) : (
                d.alerts.slice(0, 8).map((a) => (
                  <Link key={a.categoryId} to={`/budget?bucket=${a.bucketKey}`} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span className="dot" style={{ background: bucketColour(a.colour) }} aria-hidden="true" />
                    <div className="grow">
                      <div className="truncate">{a.name}</div>
                      <div className="muted small">
                        <Money cents={a.actualCents} /> of <Money cents={a.budgetCents} />
                      </div>
                    </div>
                    <StatusBadge status={a.status} />
                  </Link>
                ))
              )}
            </section>
            {d.watch.length ? (
              <section className="card" aria-labelledby="due-h">
                <div className="card-header">
                  <h2 id="due-h">Savings to watch</h2>
                </div>
                {d.watch.map((w) => (
                  <Link key={`${w.kind}-${w.id}`} to={w.kind === 'goal' ? '/fire-extinguisher' : '/sinking-funds'} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <div className="grow">
                      <div className="truncate">{w.name}</div>
                      <div className="muted small">
                        <Money cents={w.currentCents} /> of <Money cents={w.targetCents} />
                        {w.date ? ` · ${w.kind === 'goal' ? 'target' : 'due'} ${formatDate(w.date, locale)}` : ''}
                      </div>
                    </div>
                    <span className={`badge ${w.status === 'due_short' ? 'danger' : 'warn'}`}>
                      {w.status === 'due_short' ? (
                        <>
                          ! Short by <Money cents={w.shortfallCents} />
                        </>
                      ) : w.status === 'due_soon' ? (
                        '● Due soon'
                      ) : (
                        '● Behind'
                      )}
                    </span>
                  </Link>
                ))}
              </section>
            ) : null}
            <NetWorthCard d={d} />
          </div>
        </div>
      </div>
    </>
  );
}
