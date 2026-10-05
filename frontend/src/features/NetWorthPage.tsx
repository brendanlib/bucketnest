import { useState } from 'react';
import { Link } from 'react-router';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { MONEY_QUERIES, useApiMutation, useAssets, useNetWorthReport } from '../api/hooks';
import type { Asset } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ErrorState, FormError, Loading } from '../components/States';
import { Field } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { Money } from '../components/Money';
import { Icon } from '../components/Icon';
import { ChartCard, Legend, useChartKit } from '../components/Charts';
import { useToast } from '../components/Toast';
import { formatDate, todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';
import { presetRange, trimLeading } from '../lib/presets';

const RANGES = [
  { key: 12, label: '12 months' },
  { key: 36, label: '3 years' },
  { key: 120, label: '10 years' },
];
const ASSET_TYPES: { value: Asset['type']; label: string }[] = [
  { value: 'PROPERTY', label: 'Property' },
  { value: 'VEHICLE', label: 'Vehicle' },
  { value: 'OTHER', label: 'Other' },
];

export function NetWorthPage() {
  const { timezone, locale } = useHousehold();
  const today = todayIn(timezone);
  const [months, setMonths] = useState(12);
  const from = months === 12 ? presetRange('last-12', today, 7).from : `${Number(today.slice(0, 4)) - Math.round(months / 12)}${today.slice(4, 8)}01`;
  const report = useNetWorthReport({ from, to: today });
  const assets = useAssets();
  const kit = useChartKit();
  const [editing, setEditing] = useState<Asset | 'new' | null>(null);
  const [valuing, setValuing] = useState<Asset | null>(null);

  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const r = report.data;
  const b = r.breakdown;
  const data = trimLeading(r.series, (p) => p.assetsCents === 0 && p.liabilitiesCents === 0).map((p) => ({ ...p, t: Date.parse(`${p.date}T00:00:00Z`) }));
  const sides = [
    { side: 'ASSET', title: 'Assets', total: b.assetsCents },
    { side: 'LIABILITY', title: 'Liabilities', total: b.liabilitiesCents },
  ] as const;

  return (
    <>
      <PageHeader
        title="Net worth"
        subtitle={`What you own minus what you owe, as at ${formatDate(b.date, locale)}.`}
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Add property or vehicle
          </button>
        }
      />
      <PageTip id="net-worth" title="Where the numbers come from">
        Account balances come from your transactions. Property, vehicles and other things you own are entered as dated valuations — update them now and then. Superannuation counts only if its account is set to “Include in net worth”.
      </PageTip>
      <div className="cards" style={{ marginBottom: '1rem' }}>
        <div className="card"><div className="stat-label">Net worth</div><div className="stat-value"><Money cents={b.netWorthCents} /></div></div>
        <div className="card"><div className="stat-label">Assets</div><div className="stat-value"><Money cents={b.assetsCents} /></div></div>
        <div className="card"><div className="stat-label">Liabilities</div><div className="stat-value"><Money cents={b.liabilitiesCents} /></div></div>
      </div>
      <div className="stack">
        <ChartCard
          title="Net worth over time"
          subtitle="Month-end values, recalculated from transactions and valuations"
          csvUrl={`/api/reports/net-worth?from=${from}&to=${today}&format=csv`}
          table={
            <table className="table">
              <thead><tr><th>Date</th><th className="right">Assets</th><th className="right">Liabilities</th><th className="right">Net worth</th></tr></thead>
              <tbody>{r.series.map((p) => <tr key={p.date}><td>{formatDate(p.date, locale)}</td><td className="right num"><Money cents={p.assetsCents} /></td><td className="right num"><Money cents={p.liabilitiesCents} /></td><td className="right num"><Money cents={p.netWorthCents} /></td></tr>)}</tbody>
            </table>
          }
        >
          <div className="segmented" role="group" aria-label="Range">
            {RANGES.map((x) => (
              <button key={x.key} type="button" aria-pressed={months === x.key} onClick={() => setMonths(x.key)}>
                {x.label}
              </button>
            ))}
          </div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid {...kit.grid} />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(t))} minTickGap={40} {...kit.axis} />
                <YAxis tickFormatter={kit.compact} width={70} {...kit.axis} />
                <Tooltip labelFormatter={(t) => formatDate(new Date(Number(t)).toISOString().slice(0, 10), locale)} formatter={(v, n) => [kit.money(Number(v)), String(n)]} {...kit.tooltip} />
                <Line type="linear" dataKey="assetsCents" name="Assets" stroke={kit.c['series-1']} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="linear" dataKey="liabilitiesCents" name="Liabilities" stroke={kit.c['series-2']} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="linear" dataKey="netWorthCents" name="Net worth" stroke={kit.c.ink} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Assets', colour: kit.c['series-1'] }, { label: 'Liabilities', colour: kit.c['series-2'] }, { label: 'Net worth', colour: kit.c.ink }]} />
        </ChartCard>

        <div className="grid-2">
          {sides.map((s) => (
            <section key={s.side} className="card" aria-labelledby={`nw-${s.side}`}>
              <div className="card-header">
                <h2 id={`nw-${s.side}`}>{s.title}</h2>
                <span className="spacer" />
                <strong className="num"><Money cents={s.total} /></strong>
              </div>
              {b.groups.filter((g) => g.side === s.side).length === 0 ? <p className="muted small">None.</p> : null}
              {b.groups
                .filter((g) => g.side === s.side)
                .map((g) => (
                  <div key={g.group} style={{ marginBottom: '0.75rem' }}>
                    <div className="row" style={{ borderBottom: '1px solid var(--border)', padding: '0.3rem 0' }}>
                      <h3>{g.label}</h3>
                      <span className="spacer" />
                      <span className="num"><Money cents={g.totalCents} /></span>
                    </div>
                    {g.items.map((it) => (
                      <div key={it.id} className="list-item" style={{ padding: '0.45rem 0 0.45rem 0.75rem' }}>
                        <div className="grow">
                          {it.kind === 'account' ? <Link to={`/accounts/${it.id}`}>{it.name}</Link> : it.name}
                          {it.valuedOn ? <div className="muted small">valued {formatDate(it.valuedOn, locale)}</div> : null}
                        </div>
                        <span className="num small"><Money cents={it.cents} /></span>
                        {it.kind === 'asset' ? (
                          <button type="button" className="btn ghost small" onClick={() => setValuing(assets.data?.find((a) => a.id === it.id) ?? null)}>
                            Update value
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
            </section>
          ))}
        </div>

        {assets.data?.length ? (
          <section className="card" aria-labelledby="assets-h">
            <div className="card-header"><h2 id="assets-h">Property, vehicles and other assets</h2></div>
            {assets.data.map((a) => (
              <div key={a.id} className="list-item">
                <div className="grow">
                  <strong className={a.isActive ? undefined : 'muted'}>{a.name}</strong>
                  <div className="muted small">
                    {ASSET_TYPES.find((t) => t.value === a.type)?.label}
                    {a.valuedOn ? ` · last valued ${formatDate(a.valuedOn, locale)}` : ' · no value yet'}
                    {a.includeInNetWorth ? '' : ' · not in net worth'}
                  </div>
                </div>
                <Money cents={a.valueCents} />
                <button type="button" className="btn small" onClick={() => setValuing(a)}>Update value</button>
                <button type="button" className="btn small ghost" onClick={() => setEditing(a)}>Edit</button>
              </div>
            ))}
          </section>
        ) : null}
      </div>
      {editing ? <AssetForm asset={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {valuing ? <ValuationDialog asset={valuing} onClose={() => setValuing(null)} /> : null}
    </>
  );
}

function AssetForm({ asset, onClose }: { asset?: Asset; onClose: () => void }) {
  const { timezone } = useHousehold();
  const toast = useToast();
  const [form, setForm] = useState({ name: asset?.name ?? '', type: asset?.type ?? ('PROPERTY' as Asset['type']), includeInNetWorth: asset?.includeInNetWorth ?? true, isActive: asset?.isActive ?? true, notes: asset?.notes ?? '' });
  const [value, setValue] = useState<number | null>(null);
  const [valuedOn, setValuedOn] = useState(todayIn(timezone));
  const [deleting, setDeleting] = useState(false);
  const save = useApiMutation((b: unknown) => (asset ? api.put(`/assets/${asset.id}`, b) : api.post('/assets', b)), MONEY_QUERIES);
  const remove = useApiMutation(() => api.delete(`/assets/${asset!.id}`), MONEY_QUERIES);
  return (
    <Modal
      title={asset ? `Edit ${asset.name}` : 'Add property, vehicle or other asset'}
      onClose={onClose}
      footer={
        <>
          {asset ? <button type="button" className="btn danger" onClick={() => setDeleting(true)}>Delete</button> : null}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn primary"
            disabled={!form.name.trim() || save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync({ ...form, notes: form.notes || null, ...(asset || value === null ? {} : { valueCents: value, valuedOn }) });
                toast(asset ? 'Saved' : 'Added');
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
        <div className="grid-2">
          <Field label="Name">{(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Home" />}</Field>
          <Field label="Type">
            {(p) => (
              <select {...p} className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Asset['type'] })}>
                {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
          </Field>
          {!asset ? (
            <>
              <Field label="Current value">{(p) => <MoneyInput {...p} value={value} onChange={setValue} />}</Field>
              <Field label="Valued on">{(p) => <DateInput {...p} value={valuedOn} onChange={setValuedOn} />}</Field>
            </>
          ) : null}
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.includeInNetWorth} onChange={(e) => setForm({ ...form, includeInNetWorth: e.target.checked })} />
          Include in net worth
        </label>
        <Field label="Notes">{(p) => <textarea {...p} className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
      </div>
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${asset!.name}?`}
          message="Its valuation history goes too. If you sold it, add a valuation of $0 on the sale date instead to keep the history."
          busy={remove.isPending}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await remove.mutateAsync(undefined);
            toast('Deleted');
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function ValuationDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { timezone, locale } = useHousehold();
  const toast = useToast();
  const [value, setValue] = useState<number | null>(asset.valueCents || null);
  const [date, setDate] = useState(todayIn(timezone));
  const save = useApiMutation((b: unknown) => api.post(`/assets/${asset.id}/valuations`, b), MONEY_QUERIES);
  const remove = useApiMutation((id: string) => api.delete(`/assets/${asset.id}/valuations/${id}`), MONEY_QUERIES);
  return (
    <Modal
      title={`Value of ${asset.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button
            type="button"
            className="btn primary"
            disabled={value === null || save.isPending}
            onClick={async () => {
              await save.mutateAsync({ date, valueCents: value });
              toast('Valuation saved');
              onClose();
            }}
          >
            Save valuation
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid-2">
          <Field label="Value">{(p) => <MoneyInput {...p} value={value} onChange={setValue} />}</Field>
          <Field label="As at">{(p) => <DateInput {...p} value={date} onChange={setDate} />}</Field>
        </div>
        {asset.valuations.length ? (
          <div>
            <h3 className="small">History</h3>
            {asset.valuations.map((v) => (
              <div key={v.id} className="list-item small">
                <span className="grow">{formatDate(v.date, locale)}</span>
                <Money cents={v.valueCents} />
                <button type="button" className="btn ghost icon" aria-label={`Delete valuation on ${formatDate(v.date, locale)}`} onClick={() => remove.mutate(v.id)}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
