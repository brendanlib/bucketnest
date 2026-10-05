import { useState } from 'react';
import { bucketColour } from '../lib/colours';
import type { Bucket } from '../api/types';
import { formatHundredths, percentToHundredths } from '../lib/format';

/**
 * Bucket percentages with a live total. The total is counted in hundredths of a
 * percent so it is exact; the API validates the same rule when saving.
 */
export function PercentageEditor({ buckets, saving, onSave }: { buckets: Bucket[]; saving?: boolean; onSave: (values: { id: string; percentage: string }[]) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(buckets.map((b) => [b.id, b.percentage])));
  const parsed = buckets.map((b) => percentToHundredths(values[b.id] ?? ''));
  const valid = parsed.every((p) => p !== null && p <= 10000);
  const total = parsed.reduce<number>((s, p) => s + (p ?? 0), 0);
  const ok = valid && total === 10000;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(buckets.map((b) => ({ id: b.id, percentage: values[b.id]!.trim() })));
      }}
    >
      {buckets.map((b) => (
        <div key={b.id} className="row">
          <span className="dot" style={{ background: bucketColour(b.colour) }} aria-hidden="true" />
          <label htmlFor={`pct-${b.id}`} style={{ flex: 1, fontWeight: 550 }}>
            {b.name}
          </label>
          <div className="input-group" style={{ width: 130 }}>
            <input
              id={`pct-${b.id}`}
              className="input right"
              inputMode="decimal"
              value={values[b.id] ?? ''}
              aria-invalid={percentToHundredths(values[b.id] ?? '') === null ? true : undefined}
              onChange={(e) => setValues({ ...values, [b.id]: e.target.value })}
            />
            <span className="btn" aria-hidden="true" style={{ cursor: 'default' }}>
              %
            </span>
          </div>
        </div>
      ))}
      <div className="row" aria-live="polite">
        <strong style={{ flex: 1 }}>Total</strong>
        <span className={`num ${ok ? 'pos' : 'neg'}`} data-testid="percentage-total">
          {valid ? `${formatHundredths(total)}%` : '—'}
        </span>
      </div>
      {!ok ? (
        <p className="error small" role="alert">
          {valid ? `Percentages must add up to exactly 100% (${total > 10000 ? 'over' : 'under'} by ${formatHundredths(Math.abs(10000 - total))}%).` : 'Enter numbers like 60 or 12.5.'}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={!ok || saving}>
          {saving ? 'Saving…' : 'Save percentages'}
        </button>
      </div>
    </form>
  );
}
