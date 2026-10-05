import { useState, type ReactNode } from 'react';
import { formatMoney } from '../lib/format';
import { useHousehold } from '../lib/household';
import { useCssColours } from '../lib/chartTheme';
import { Icon } from './Icon';

export const CHART_VARS = ['series-1', 'series-2', 'series-3', 'series-4', 'series-muted', 'ink', 'grid', 'text-3', 'surface', 'border', 'bucket-1', 'bucket-2', 'bucket-3', 'bucket-4'] as const;
export const useChartColours = () => useCssColours(CHART_VARS);

/** Shared axis, grid and tooltip styling: hairline recessive chrome, money ticks. */
export function useChartKit() {
  const ctx = useHousehold();
  const c = useChartColours();
  return {
    c,
    money: (v: number) => formatMoney(v, ctx),
    compact: (v: number) => formatMoney(v, ctx, { compact: true }),
    axis: { stroke: c['text-3'], fontSize: 12, tickLine: false, axisLine: { stroke: c.grid } },
    grid: { stroke: c.grid, vertical: false },
    tooltip: {
      contentStyle: { background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 13 },
      cursor: { fill: c.grid, fillOpacity: 0.4, stroke: c.grid },
    },
  };
}

/** A chart card with a title, a chart/table toggle and an optional CSV download. */
export function ChartCard({ title, subtitle, csvUrl, table, children }: { title: string; subtitle?: ReactNode; csvUrl?: string; table: ReactNode; children: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card stack-sm" aria-label={title}>
      <div className="row wrap">
        <div>
          <h2>{title}</h2>
          {subtitle ? <div className="muted small">{subtitle}</div> : null}
        </div>
        <span className="spacer" />
        <div className="segmented" role="group" aria-label={`${title} view`}>
          <button type="button" aria-pressed={!showTable} onClick={() => setShowTable(false)}>
            Chart
          </button>
          <button type="button" aria-pressed={showTable} onClick={() => setShowTable(true)}>
            Table
          </button>
        </div>
        {csvUrl ? (
          <a className="btn small" href={csvUrl} download>
            <Icon name="download" /> CSV
          </a>
        ) : null}
      </div>
      {showTable ? <div className="table-wrap">{table}</div> : children}
    </section>
  );
}

/** A legend that names every series next to its swatch (identity never by colour alone). */
export function Legend({ items }: { items: { label: string; colour: string; dashed?: boolean }[] }) {
  return (
    <ul className="chart-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`swatch${i.dashed ? ' dashed' : ''}`} style={{ background: i.dashed ? 'transparent' : i.colour, borderColor: i.colour }} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
