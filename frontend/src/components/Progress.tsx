import type { BudgetStatus } from '../api/types';
import { strings } from '../locales/en-AU';

/**
 * A progress bar whose colour follows the status, with the percentage and a
 * status word in text so colour is never the only signal (WCAG 1.4.1).
 */
export function ProgressBar({ percent, status, label, showText = true }: { percent: number | null; status: BudgetStatus; label: string; showText?: boolean }) {
  const width = percent === null ? (status === 'unbudgeted' ? 100 : 0) : Math.max(0, Math.min(100, percent));
  const statusText = strings.budgetStatus[status];
  return (
    <div className="stack-sm" style={{ gap: '0.25rem' }}>
      <div
        className={`progress status-${status}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.round(Math.min(percent, 100))}
        aria-valuetext={percent === null ? statusText || 'No budget' : `${percent.toFixed(2)}% used${statusText ? `, ${statusText.toLowerCase()}` : ''}`}
      >
        <span style={{ width: `${width}%` }} />
      </div>
      {showText ? (
        <div className="row small" style={{ gap: '0.4rem' }}>
          <span className="num muted">{percent === null ? '—' : `${percent.toFixed(2)}% used`}</span>
          <span className="spacer" />
          {status === 'amber' || status === 'red' || status === 'unbudgeted' ? <StatusBadge status={status} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: BudgetStatus }) {
  if (status === 'none' || status === 'ok') return null;
  const cls = status === 'red' ? 'danger' : status === 'amber' ? 'warn' : '';
  const icon = status === 'red' ? '▲ ' : status === 'amber' ? '● ' : '';
  return (
    <span className={`badge ${cls}`}>
      <span aria-hidden="true">{icon}</span>
      {strings.budgetStatus[status]}
    </span>
  );
}
