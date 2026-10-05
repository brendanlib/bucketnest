import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { qs } from '../api/client';
import { useAccounts, useBudgetActualReport, useBuckets, useCategories, useDebtReduction, useForecast, useIncomeReport, useSettings, useSpendingReport } from '../api/hooks';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ErrorState, Loading } from '../components/States';
import { Money } from '../components/Money';
import { DateInput } from '../components/DateInput';
import { AccountSelect } from '../components/Pickers';
import { ChartCard, Legend, useChartKit } from '../components/Charts';
import { formatDate, formatPeriod, todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';
import { bucketColour } from '../lib/colours';
import { resolveColour } from '../lib/chartTheme';
import { monthLabel, presetRange, PRESET_LABELS, trimLeading, type Preset } from '../lib/presets';

const TABS = [
  { key: 'spending', label: 'Spending' },
  { key: 'income', label: 'Income vs expenses' },
  { key: 'budget', label: 'Budget vs actual' },
  { key: 'debt', label: 'Debt reduction' },
  { key: 'forecast', label: 'Forecast' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'spending';
  const settings = useSettings();
  const { timezone } = useHousehold();
  const today = todayIn(timezone);
  const [preset, setPreset] = useState<Preset>('last-12');
  const [custom, setCustom] = useState(() => presetRange('last-12', today, 7));
  const range = preset === 'custom' ? custom : presetRange(preset, today, settings.data?.fyStartMonth ?? 7);

  return (
    <>
      <PageHeader title="Reports" subtitle="Where the money went, and where it’s heading." />
      <PageTip id="reports" title="Reading the reports">
        Spending is net of refunds and includes bills paid from sinking funds. Money moved into the Fire Extinguisher bucket is shown as saving, not spending. Every chart has a table view and a CSV download.
      </PageTip>
      <div className="segmented" role="tablist" aria-label="Report" style={{ marginBottom: '1rem' }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => setParams({ tab: t.key }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'spending' || tab === 'income' ? (
        <div className="report-filters">
          <div className="field">
            <label htmlFor="preset" className="field-label">
              Dates
            </label>
            <select id="preset" className="input" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          {preset === 'custom' ? (
            <>
              <div className="field">
                <span className="field-label">From</span>
                <DateInput aria-label="From" value={custom.from} onChange={(d) => setCustom({ ...custom, from: d })} />
              </div>
              <div className="field">
                <span className="field-label">To</span>
                <DateInput aria-label="To" value={custom.to} onChange={(d) => setCustom({ ...custom, to: d })} />
              </div>
            </>
          ) : (
            <p className="muted small" style={{ paddingBottom: '0.6rem' }}>
              {formatPeriod(range.from, range.to, 'en-AU')}
            </p>
          )}
        </div>
      ) : null}
      {tab === 'spending' ? <SpendingReport range={range} /> : null}
      {tab === 'income' ? <IncomeReport range={range} /> : null}
      {tab === 'budget' ? <BudgetReport /> : null}
      {tab === 'debt' ? <DebtReport /> : null}
      {tab === 'forecast' ? <ForecastReportView /> : null}
    </>
  );
}

function SpendingReport({ range }: { range: { from: string; to: string } }) {
  const buckets = useBuckets();
  const categories = useCategories(true);
  const accounts = useAccounts(true);
  const [filters, setFilters] = useState({ bucketId: '', categoryId: '', accountId: '' });
  const [perBucket, setPerBucket] = useState(false);
  const query = { from: range.from, to: range.to, bucketId: filters.bucketId || undefined, categoryId: filters.categoryId || undefined, accountId: filters.accountId || undefined };
  const report = useSpendingReport(query);
  const kit = useChartKit();
  const { locale } = useHousehold();
  const colourOf = (hex: string) => resolveColour(bucketColour(hex), kit.c as Record<string, string>);
  const csv = (view: string) => `/api/reports/spending${qs({ ...query, format: 'csv', view })}`;

  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const r = report.data;
  const bucketColourByKey = new Map(r.byBucket.map((b) => [b.key, colourOf(b.colour)]));
  const donut = r.byBucket.filter((b) => b.amountCents > 0);
  const monthly = trimLeading(r.monthly, (m) => Object.values(m.byBucket).every((v) => v === 0)).map((m) => ({ ...m, label: monthLabel(m.month, locale), ...Object.fromEntries(Object.entries(m.byBucket).map(([k, v]) => [`b_${k}`, v])) }));

  return (
    <div className="stack">
      <div className="report-filters">
        <div className="field">
          <label htmlFor="f-bucket" className="field-label">Bucket</label>
          <select id="f-bucket" className="input" value={filters.bucketId} onChange={(e) => setFilters({ ...filters, bucketId: e.target.value })}>
            <option value="">All buckets</option>
            {(buckets.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-cat" className="field-label">Category</label>
          <select id="f-cat" className="input" value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
            <option value="">All categories</option>
            {(categories.data ?? []).filter((c) => !c.isGroup && c.kind === 'EXPENSE').map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-acct" className="field-label">Account</label>
          <AccountSelect id="f-acct" accounts={accounts.data ?? []} value={filters.accountId} placeholder="All accounts" onChange={(id) => setFilters({ ...filters, accountId: id })} />
        </div>
        <div style={{ paddingBottom: '0.4rem' }}>
          <div className="stat-label">Total spending</div>
          <div className="stat-value"><Money cents={r.totalCents} /></div>
        </div>
      </div>

      <div className="grid-2">
        <ChartCard
          title="Spending by bucket"
          subtitle="Net of refunds. Fire Extinguisher is money saved."
          csvUrl={csv('bucket')}
          table={
            <table className="table">
              <thead><tr><th>Bucket</th><th className="right">Amount</th></tr></thead>
              <tbody>{r.byBucket.map((b) => <tr key={b.key}><td>{b.name}</td><td className="right num"><Money cents={b.amountCents} /></td></tr>)}</tbody>
            </table>
          }
        >
          {donut.length === 0 ? (
            <p className="muted small">Nothing in this range.</p>
          ) : (
            <>
              <div style={{ height: 240 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={donut} dataKey="amountCents" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={1} stroke={kit.c.surface} strokeWidth={2} isAnimationActive={false}>
                      {donut.map((b) => <Cell key={b.key} fill={colourOf(b.colour)} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [kit.money(Number(v)), String(n)]} {...kit.tooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <Legend items={donut.map((b) => ({ label: `${b.name} · ${kit.money(b.amountCents)}`, colour: colourOf(b.colour) }))} />
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Spending by category"
          subtitle="Top 15, then everything else"
          csvUrl={csv('category')}
          table={
            <table className="table">
              <thead><tr><th>Category</th><th className="right">Amount</th></tr></thead>
              <tbody>{r.byCategory.map((c) => <tr key={c.categoryId ?? 'other'}><td>{c.name}</td><td className="right num"><Money cents={c.amountCents} /></td></tr>)}</tbody>
            </table>
          }
        >
          {r.byCategory.length === 0 ? (
            <p className="muted small">Nothing in this range.</p>
          ) : (
            <div style={{ height: Math.max(160, r.byCategory.length * 26 + 30) }}>
              <ResponsiveContainer>
                <BarChart data={r.byCategory} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }} barCategoryGap={4}>
                  <CartesianGrid {...kit.grid} horizontal={false} vertical />
                  <XAxis type="number" tickFormatter={kit.compact} {...kit.axis} />
                  <YAxis type="category" dataKey="name" width={130} {...kit.axis} interval={0} />
                  <Tooltip formatter={(v) => [kit.money(Number(v)), 'Spent']} {...kit.tooltip} />
                  <Bar dataKey="amountCents" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {r.byCategory.map((c) => <Cell key={c.categoryId ?? 'other'} fill={c.bucketKey ? (bucketColourByKey.get(c.bucketKey) ?? kit.c['series-muted']) : kit.c['series-muted']} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {r.byCategory.length ? <Legend items={r.byBucket.filter((b) => !b.isSaving).map((b) => ({ label: b.name, colour: colourOf(b.colour) }))} /> : null}
        </ChartCard>
      </div>

      <ChartCard
        title="Monthly spending"
        csvUrl={csv('month')}
        table={
          <table className="table">
            <thead><tr><th>Month</th>{r.byBucket.map((b) => <th key={b.key} className="right">{b.name}</th>)}<th className="right">Spending</th></tr></thead>
            <tbody>{r.monthly.map((m) => <tr key={m.month}><td>{monthLabel(m.month, locale)}</td>{r.byBucket.map((b) => <td key={b.key} className="right num"><Money cents={m.byBucket[b.key] ?? 0} /></td>)}<td className="right num"><Money cents={m.totalCents} /></td></tr>)}</tbody>
          </table>
        }
      >
        <label className="checkbox small">
          <input type="checkbox" checked={perBucket} onChange={(e) => setPerBucket(e.target.checked)} />
          One line per bucket
        </label>
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={monthly} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid {...kit.grid} />
              <XAxis dataKey="label" {...kit.axis} />
              <YAxis tickFormatter={kit.compact} width={70} {...kit.axis} />
              <Tooltip formatter={(v, n) => [kit.money(Number(v)), String(n)]} {...kit.tooltip} />
              {perBucket ? (
                r.byBucket.map((b) => <Line key={b.key} type="linear" dataKey={`b_${b.key}`} name={b.name} stroke={colourOf(b.colour)} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />)
              ) : (
                <Line type="linear" dataKey="totalCents" name="Spending" stroke={kit.c['series-1']} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {perBucket ? <Legend items={r.byBucket.map((b) => ({ label: b.name, colour: colourOf(b.colour) }))} /> : null}
      </ChartCard>
    </div>
  );
}

function IncomeReport({ range }: { range: { from: string; to: string } }) {
  const report = useIncomeReport(range);
  const kit = useChartKit();
  const { locale } = useHousehold();
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const r = report.data;
  const data = trimLeading(r.monthly, (m) => m.incomeCents === 0 && m.spendingCents === 0 && m.savedCents === 0).map((m) => ({ ...m, label: monthLabel(m.month, locale) }));
  return (
    <div className="stack">
      <div className="cards">
        <div className="card"><div className="stat-label">Income</div><div className="stat-value"><Money cents={r.totals.incomeCents} /></div></div>
        <div className="card"><div className="stat-label">Spending</div><div className="stat-value"><Money cents={r.totals.spendingCents} /></div></div>
        <div className="card">
          <div className="stat-label">Savings rate</div>
          <div className="stat-value">{r.totals.savingsRate === null ? '—' : `${r.totals.savingsRate.toFixed(2)}%`}</div>
          <div className="muted small">(income − spending) ÷ income · <Money cents={r.totals.savedCents} /> into Fire Extinguisher</div>
        </div>
      </div>
      <ChartCard
        title="Income vs expenses"
        subtitle="Bars are income and spending; the line is what’s left"
        csvUrl={`/api/reports/income-vs-expenses${qs({ ...range, format: 'csv' })}`}
        table={
          <table className="table">
            <thead><tr><th>Month</th><th className="right">Income</th><th className="right">Spending</th><th className="right">Net</th><th className="right">Savings rate</th></tr></thead>
            <tbody>{r.monthly.map((m) => <tr key={m.month}><td>{monthLabel(m.month, locale)}</td><td className="right num"><Money cents={m.incomeCents} /></td><td className="right num"><Money cents={m.spendingCents} /></td><td className="right num"><Money cents={m.netCents} /></td><td className="right num">{m.savingsRate === null ? '—' : `${m.savingsRate.toFixed(2)}%`}</td></tr>)}</tbody>
          </table>
        }
      >
        <div style={{ height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} barGap={2} barCategoryGap="25%">
              <CartesianGrid {...kit.grid} />
              <XAxis dataKey="label" {...kit.axis} />
              <YAxis tickFormatter={kit.compact} width={70} {...kit.axis} />
              <Tooltip formatter={(v, n) => [kit.money(Number(v)), String(n)]} {...kit.tooltip} />
              <Bar dataKey="incomeCents" name="Income" fill={kit.c['series-1']} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="spendingCents" name="Spending" fill={kit.c['series-2']} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line type="linear" dataKey="netCents" name="Net" stroke={kit.c.ink} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Legend items={[{ label: 'Income', colour: kit.c['series-1'] }, { label: 'Spending', colour: kit.c['series-2'] }, { label: 'Net (income − spending)', colour: kit.c.ink }]} />
      </ChartCard>
    </div>
  );
}

function BudgetReport() {
  const [groupBy, setGroupBy] = useState<'category' | 'bucket'>('category');
  const [period, setPeriod] = useState<string | undefined>();
  const report = useBudgetActualReport({ groupBy, period });
  const kit = useChartKit();
  const { locale } = useHousehold();
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const r = report.data;
  const rows = r.rows.filter((x) => x.budgetCents || x.actualCents);
  return (
    <ChartCard
      title="Budget vs actual"
      subtitle={formatPeriod(r.period.start, r.period.end, locale)}
      csvUrl={`/api/reports/budget-vs-actual${qs({ groupBy, period, format: 'csv' })}`}
      table={
        <table className="table">
          <thead><tr><th>{groupBy === 'bucket' ? 'Bucket' : 'Category'}</th><th className="right">Budget</th><th className="right">Actual</th><th className="right">Remaining</th><th className="right">% used</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.id}><td>{x.name}</td><td className="right num"><Money cents={x.budgetCents} /></td><td className="right num"><Money cents={x.actualCents} /></td><td className="right num"><Money cents={x.remainingCents} /></td><td className="right num">{x.percentUsed === null ? '—' : `${x.percentUsed.toFixed(2)}%`}</td></tr>)}</tbody>
        </table>
      }
    >
      <div className="row wrap">
        <div className="segmented" role="group" aria-label="Group by">
          <button type="button" aria-pressed={groupBy === 'category'} onClick={() => setGroupBy('category')}>By category</button>
          <button type="button" aria-pressed={groupBy === 'bucket'} onClick={() => setGroupBy('bucket')}>By bucket</button>
        </div>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={() => setPeriod(r.period.previousStart)}>← Previous</button>
        <button type="button" className="btn small" onClick={() => setPeriod(r.period.nextStart)}>Next →</button>
      </div>
      {rows.length === 0 ? (
        <p className="muted small">Nothing planned or spent in this period.</p>
      ) : (
        <>
          <div style={{ height: Math.max(180, rows.length * 34 + 30) }}>
            <ResponsiveContainer>
              <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }} barGap={2} barCategoryGap={6}>
                <CartesianGrid {...kit.grid} horizontal={false} vertical />
                <XAxis type="number" tickFormatter={kit.compact} {...kit.axis} />
                <YAxis type="category" dataKey="name" width={140} interval={0} {...kit.axis} />
                <Tooltip formatter={(v, n) => [kit.money(Number(v)), String(n)]} {...kit.tooltip} />
                <Bar dataKey="budgetCents" name="Budget" fill={kit.c['series-muted']} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                <Bar dataKey="actualCents" name="Actual" fill={kit.c['series-1']} radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Budget', colour: kit.c['series-muted'] }, { label: 'Actual', colour: kit.c['series-1'] }]} />
        </>
      )}
    </ChartCard>
  );
}

function DebtReport() {
  const report = useDebtReduction(12);
  const kit = useChartKit();
  const { locale } = useHousehold();
  const series = [kit.c['series-1'], kit.c['series-2'], kit.c['series-3'], kit.c['series-4']];
  const data = useMemo(() => {
    if (!report.data) return [];
    const byDate = new Map<string, Record<string, number | string>>();
    report.data.forEach((d, i) => {
      for (const p of d.history) byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date }), [`a${i}`]: p.balanceCents });
      for (const p of d.projection) byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date }), [`p${i}`]: p.balanceCents });
    });
    return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1)).map((x) => ({ ...x, t: Date.parse(`${x.date}T00:00:00Z`) }));
  }, [report.data]);
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const debts = report.data.slice(0, 4);
  if (!debts.length) return <div className="card"><p className="muted">Set up a debt profile on a loan or card to see its reduction here.</p></div>;
  return (
    <ChartCard
      title="Debt reduction"
      subtitle="Solid: actual balance. Dashed: projected payoff at your current repayments (an estimate)."
      csvUrl="/api/reports/debt-reduction?format=csv"
      table={
        <table className="table">
          <thead><tr><th>Debt</th><th className="right">Owing now</th><th>Paid off (estimate)</th></tr></thead>
          <tbody>{debts.map((d) => <tr key={d.debtId}><td>{d.name}</td><td className="right num"><Money cents={d.projection[0]?.balanceCents ?? 0} /></td><td>{d.payoffDate ? formatDate(d.payoffDate, locale) : 'Not at this repayment'}</td></tr>)}</tbody>
        </table>
      }
    >
      <div style={{ height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid {...kit.grid} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => new Date(t).getUTCFullYear().toString()} minTickGap={40} {...kit.axis} />
            <YAxis tickFormatter={kit.compact} width={70} {...kit.axis} />
            <Tooltip labelFormatter={(t) => formatDate(new Date(Number(t)).toISOString().slice(0, 10), locale)} formatter={(v, n) => [kit.money(Number(v)), String(n)]} {...kit.tooltip} />
            {debts.flatMap((d, i) => [
              <Line key={`a${i}`} dataKey={`a${i}`} name={`${d.name} (actual)`} stroke={series[i]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />,
              <Line key={`p${i}`} dataKey={`p${i}`} name={`${d.name} (projected)`} stroke={series[i]} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />,
            ])}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend items={debts.flatMap((d, i) => [{ label: `${d.name}`, colour: series[i]! }])} />
      {report.data.length > 4 ? <p className="muted small">Showing the first four debts; the table and CSV include them all.</p> : null}
    </ChartCard>
  );
}

function ForecastReportView() {
  const [months, setMonths] = useState(6);
  const settings = useSettings();
  const [method, setMethod] = useState<string | undefined>();
  const report = useForecast(months, method);
  const kit = useChartKit();
  const { locale } = useHousehold();
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const r = report.data;
  const colourOf = (hex: string) => resolveColour(bucketColour(hex), kit.c as Record<string, string>);
  const data = r.months.map((m, i) => ({ label: monthLabel(m, locale), incomeCents: r.totals[i]!.incomeCents, ...Object.fromEntries(r.buckets.map((b) => [b.key, b.months[i]!])) }));
  return (
    <div className="stack">
      <div className="report-filters">
        <div className="field">
          <label className="field-label" htmlFor="fc-months">Months ahead</label>
          <select id="fc-months" className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[1, 3, 6, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="fc-method">Based on</label>
          <select id="fc-method" className="input" value={method ?? settings.data?.forecastMethod ?? 'AVG3'} onChange={(e) => setMethod(e.target.value)}>
            <option value="AVG3">3-month average</option>
            <option value="AVG6">6-month average</option>
            <option value="AVG12">12-month average</option>
          </select>
        </div>
        <p className="muted small" style={{ paddingBottom: '0.6rem' }}>
          Scheduled bills and pay + the average of everything else, from completed months only.
          {r.limitedHistory ? ` Limited history: ${r.historyMonths} completed month${r.historyMonths === 1 ? '' : 's'} so far.` : ''}
        </p>
      </div>
      <ChartCard
        title="Projected spending by bucket"
        subtitle="Stacked by bucket; the line is projected income. Estimates."
        csvUrl={`/api/reports/forecast${qs({ months, method, format: 'csv' })}`}
        table={
          <table className="table">
            <thead><tr><th>Month</th><th className="right">Income</th><th className="right">Spending</th><th className="right">Saving</th><th className="right">Left over</th></tr></thead>
            <tbody>{r.totals.map((t) => <tr key={t.month}><td>{monthLabel(t.month, locale)}</td><td className="right num"><Money cents={t.incomeCents} /></td><td className="right num"><Money cents={t.spendingCents} /></td><td className="right num"><Money cents={t.savingCents} /></td><td className="right num"><Money cents={t.netCents} /></td></tr>)}</tbody>
          </table>
        }
      >
        <div style={{ height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} barCategoryGap="30%">
              <CartesianGrid {...kit.grid} />
              <XAxis dataKey="label" {...kit.axis} />
              <YAxis tickFormatter={kit.compact} width={70} {...kit.axis} />
              <Tooltip formatter={(v, n) => [kit.money(Number(v)), String(n)]} {...kit.tooltip} />
              {r.buckets.map((b, i) => (
                <Bar key={b.key} dataKey={b.key} name={b.name} stackId="b" fill={colourOf(b.colour)} stroke={kit.c.surface} strokeWidth={2} radius={i === r.buckets.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
              ))}
              <Line type="linear" dataKey="incomeCents" name="Income" stroke={kit.c.ink} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Legend items={[...r.buckets.map((b) => ({ label: b.name, colour: colourOf(b.colour) })), { label: 'Income', colour: kit.c.ink }]} />
      </ChartCard>

      <section className="card" style={{ padding: 0 }} aria-labelledby="fc-cat">
        <div className="card-header" style={{ padding: '1rem 1.25rem 0' }}><h2 id="fc-cat">By category</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Category</th>{r.months.map((m) => <th key={m} className="right">{monthLabel(m, locale)}</th>)}</tr></thead>
            <tbody>
              {r.categories.map((c) => (
                <tr key={c.categoryId}>
                  <td>{c.name} {c.method === 'MANUAL' ? <span className="badge">Manual</span> : c.limitedHistory ? <span className="badge" title="Fewer completed months than the averaging window">Limited history</span> : null}</td>
                  {c.months.map((v, i) => <td key={i} className="right num"><Money cents={v} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ padding: 0 }} aria-labelledby="fc-acct">
        <div className="card-header" style={{ padding: '1rem 1.25rem 0' }}><h2 id="fc-acct">Projected month-end balances</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Account</th><th className="right">Now</th>{r.months.map((m) => <th key={m} className="right">{monthLabel(m, locale)}</th>)}</tr></thead>
            <tbody>
              {r.accounts.map((a) => (
                <tr key={a.accountId}>
                  <td>{a.name}{a.class === 'LIABILITY' ? <span className="muted small"> (owed)</span> : null}</td>
                  <td className="right num"><Money cents={a.currentCents} /></td>
                  {a.monthEndCents.map((v, i) => <td key={i} className={`right num${a.class === 'ASSET' && v < 0 ? ' neg' : ''}`}><Money cents={v} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
