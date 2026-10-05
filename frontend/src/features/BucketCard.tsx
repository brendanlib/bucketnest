import { Link } from 'react-router';
import type { DashboardBucket } from '../api/types';
import { Money } from '../components/Money';
import { ProgressBar } from '../components/Progress';

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div style={{ fontWeight: 650 }}>{children}</div>
    </div>
  );
}

/** One bucket on the dashboard (spec §11): allocated, actual, remaining and progress. */
export function BucketCard({ bucket }: { bucket: DashboardBucket }) {
  const fire = bucket.key === 'FIRE_EXTINGUISHER';
  const over = bucket.remainingCents < 0;
  return (
    <article className="card bucket-card stack-sm" style={{ borderTop: `4px solid ${bucket.colour}` }} aria-labelledby={`bucket-${bucket.key}`}>
      <div className="row">
        <h2 id={`bucket-${bucket.key}`}>{bucket.name}</h2>
        <span className="spacer" />
        <span className="badge">{bucket.percentage.replace(/\.00$/, '')}%</span>
      </div>
      <div className="row wrap" style={{ gap: '1.25rem', alignItems: 'flex-start' }}>
        <Stat label="Allocated">
          <Money cents={bucket.allocatedCents} />
        </Stat>
        <Stat label={fire ? 'Contributions' : 'Spent'}>
          <Money cents={bucket.actualCents} />
        </Stat>
        <Stat label={over ? 'Over by' : fire ? 'To go' : 'Remaining'}>
          <span className={over ? 'neg' : undefined}>
            <Money cents={Math.abs(bucket.remainingCents)} />
          </span>
        </Stat>
      </div>
      <ProgressBar percent={bucket.percentUsed} status={bucket.status} label={`${bucket.name} used`} />
      {bucket.key === 'BILLS' && bucket.percentOfIncome !== null ? (
        <p className="muted small">{bucket.percentOfIncome.toFixed(2)}% of income so far</p>
      ) : null}
      {fire && bucket.fire ? (
        <dl className="mini-stats small">
          <div>
            <dt>Debt principal reduced</dt>
            <dd><Money cents={bucket.fire.principalReducedCents} /></dd>
          </div>
          <div>
            <dt>Savings</dt>
            <dd><Money cents={bucket.fire.savingsCents} /></dd>
          </div>
          <div>
            <dt>Investments</dt>
            <dd><Money cents={bucket.fire.investmentCents} /></dd>
          </div>
          <div>
            <dt>Extra repayments</dt>
            <dd><Money cents={bucket.fire.extraRepaymentsCents} /></dd>
          </div>
        </dl>
      ) : null}
      {fire && bucket.fire?.goals.length ? (
        <div className="stack-sm small" style={{ gap: '0.3rem' }}>
          {bucket.fire.goals.map((g) => (
            <div key={g.id} className="row" style={{ gap: '0.5rem' }}>
              <span className="truncate" style={{ flex: 1 }}>
                {g.name}
              </span>
              <span className="num muted">{g.progressPercent !== null ? `${Math.min(g.progressPercent, 999).toFixed(0)}%` : '—'}</span>
              {g.onTrack === false ? <span className="badge warn">Behind</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {bucket.overAllocatedCents > 0 ? (
        <p className="small warn-text">
          Planned <Money cents={bucket.plannedCents} /> — over-allocated by <Money cents={bucket.overAllocatedCents} />
        </p>
      ) : null}
      <Link to={`/budget?bucket=${bucket.key}`} className="small">
        View {bucket.name} budget
      </Link>
    </article>
  );
}
