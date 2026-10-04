import { Icon } from './Icon';
import { formatPeriod } from '../lib/format';
import { useHousehold } from '../lib/household';
import type { PeriodInfo } from '../api/types';

/** Steps through budget periods. `onChange(undefined)` returns to the current period. */
export function PeriodSelector({ period, onChange }: { period: PeriodInfo; onChange: (date: string | undefined) => void }) {
  const { locale } = useHousehold();
  return (
    <div className="row" style={{ gap: '0.4rem' }}>
      <button type="button" className="btn icon" aria-label="Previous period" onClick={() => onChange(period.previousStart)}>
        <Icon name="chevronLeft" />
      </button>
      <strong className="num" aria-live="polite" style={{ minWidth: 150, textAlign: 'center' }}>
        {formatPeriod(period.start, period.end, locale)}
      </strong>
      <button type="button" className="btn icon" aria-label="Next period" onClick={() => onChange(period.nextStart)}>
        <Icon name="chevronRight" />
      </button>
      {!period.isCurrent ? (
        <button type="button" className="btn small" onClick={() => onChange(undefined)}>
          This period
        </button>
      ) : null}
    </div>
  );
}
