import { Fragment } from 'react';
import { bucketColour } from '../lib/colours';
import { Link } from 'react-router';
import type { BudgetItem, BudgetLine, BudgetSummary, Variance } from '../api/types';
import { Money } from '../components/Money';
import { ProgressBar } from '../components/Progress';
import { TableWrap } from '../components/TableWrap';

function Cells({ v, label }: { v: Variance; label: string }) {
  return (
    <>
      <td className="right num">
        <Money cents={v.budgetCents} />
      </td>
      <td className="right num">
        <Money cents={v.actualCents} />
      </td>
      <td className="right num num-remaining">
        <span className={v.remainingCents < 0 ? 'neg' : undefined}>
          <Money cents={v.remainingCents} />
        </span>
      </td>
      <td className="progress-cell">
        <ProgressBar percent={v.percentUsed} status={v.status} label={label} />
      </td>
    </>
  );
}

/**
 * Budget vs actual by bucket → group → category (spec §9). Every number comes
 * from the summary API; this component only lays them out.
 */
export function BudgetTable({
  summary,
  bucketKey,
  onEditLine,
}: {
  summary: BudgetSummary;
  bucketKey?: string;
  onEditLine?: (line: BudgetLine, item: BudgetItem | undefined) => void;
}) {
  const items = new Map(summary.budget.items.map((i) => [i.categoryId, i]));
  // Notes are optional; the column only takes room when there's something in it.
  const hasNotes = summary.budget.items.some((i) => i.notes);
  const cols = hasNotes ? 6 : 5;
  const buckets = summary.buckets.filter((b) => !bucketKey || b.key === bucketKey);

  return (
    <>
      <TableWrap label="Budget">
        <table className="table budget-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="right">Budget</th>
              <th className="right">Actual</th>
              <th className="right">Remaining</th>
              <th>Used</th>
              {hasNotes ? <th>Notes</th> : null}
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <Fragment key={b.bucketId}>
                <tr className="bucket-row">
                  <td>
                    <span className="row" style={{ gap: '0.5rem' }}>
                      <span className="dot" style={{ background: bucketColour(b.colour) }} aria-hidden="true" />
                      {b.name}
                    </span>
                    <div className="small muted" style={{ fontWeight: 400 }}>
                      Allocation <Money cents={b.allocatedCents} /> ({b.percentage.replace(/\.00$/, '')}%)
                      {b.overAllocatedCents > 0 ? (
                        <span className="warn-text">
                          {' '}
                          · over-allocated by <Money cents={b.overAllocatedCents} />
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <Cells v={b} label={`${b.name} total used`} />
                  {hasNotes ? <td /> : null}
                </tr>
                {b.groups.length === 0 ? (
                  <tr>
                    <td colSpan={cols} className="muted small" style={{ paddingLeft: '1.5rem' }}>
                      Nothing planned or spent yet.
                    </td>
                  </tr>
                ) : null}
                {b.groups.map((g) => (
                  <Fragment key={`${b.bucketId}-${g.groupId ?? 'other'}`}>
                    {b.groups.length > 1 || g.name !== b.name ? (
                      <tr className="group-row">
                        <td>{g.name}</td>
                        <Cells v={g} label={`${g.name} used`} />
                        {hasNotes ? <td /> : null}
                      </tr>
                    ) : null}
                    {g.lines.map((l) => {
                      const item = l.sinkingFundId ? undefined : items.get(l.categoryId);
                      return (
                        <tr key={l.sinkingFundId ?? l.categoryId} className={`line-row status-${l.status}`}>
                          <td>
                            {l.sinkingFundId ? (
                              <>
                                <Link to="/sinking-funds">{l.name}</Link> <span className="badge">Sinking fund</span>
                              </>
                            ) : onEditLine ? (
                              <button type="button" className="link-btn" onClick={() => onEditLine(l, item)} aria-label={`Edit budget for ${l.name}`}>
                                {l.name}
                              </button>
                            ) : (
                              l.name
                            )}
                          </td>
                          <Cells v={l} label={`${l.name} used`} />
                          {hasNotes ? (
                            <td className="small muted" style={{ maxWidth: 220 }}>
                              <span className="truncate" style={{ display: 'block' }}>
                                {item?.notes ?? ''}
                              </span>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            {!bucketKey ? (
              <tr className="total-row">
                <td>Total</td>
                <Cells v={summary.total} label="Total used" />
                {hasNotes ? <td /> : null}
              </tr>
            ) : null}
          </tbody>
        </table>
      </TableWrap>

      <div className="budget-lines-mobile">
        {buckets.map((b) => (
          <section key={b.bucketId} className="stack-sm" style={{ marginBottom: '1rem' }}>
            <div className="row">
              <span className="dot" style={{ background: bucketColour(b.colour) }} aria-hidden="true" />
              <h3>{b.name}</h3>
              <span className="spacer" />
              <span className="small">
                <Money cents={b.actualCents} /> of <Money cents={b.budgetCents} />
              </span>
            </div>
            {b.overAllocatedCents > 0 ? (
              <p className="small warn-text">
                Over-allocated by <Money cents={b.overAllocatedCents} />
              </p>
            ) : null}
            {b.groups.flatMap((g) => g.lines).map((l) => (
              <button
                key={l.sinkingFundId ?? l.categoryId}
                type="button"
                className="card stack-sm"
                style={{ textAlign: 'left', padding: '0.75rem', cursor: onEditLine && !l.sinkingFundId ? 'pointer' : undefined }}
                onClick={() => !l.sinkingFundId && onEditLine?.(l, items.get(l.categoryId))}
              >
                <div className="row">
                  <strong>{l.name}</strong>
                  {l.sinkingFundId ? <span className="badge">Sinking fund</span> : null}
                  <span className="spacer" />
                  <span className={`small ${l.remainingCents < 0 ? 'neg' : 'muted'}`}>
                    <Money cents={Math.abs(l.remainingCents)} /> {l.remainingCents < 0 ? 'over' : 'left'}
                  </span>
                </div>
                <div className="small muted">
                  <Money cents={l.actualCents} /> of <Money cents={l.budgetCents} />
                </div>
                <ProgressBar percent={l.percentUsed} status={l.status} label={`${l.name} used`} />
              </button>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
