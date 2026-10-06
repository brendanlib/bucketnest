import { useState } from 'react';
import { bucketColour } from '../lib/colours';
import type { Bucket } from '../api/types';
import { formatHundredths, percentToHundredths } from '../lib/format';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';

export const MAX_BUCKETS = 8;

export interface BucketSave {
  id: string;
  name: string;
  percentage: string;
}

const ROLE_NOTE: Record<Bucket['role'], string | null> = {
  BILLS: 'Holds bills and minimum debt repayments. Can be renamed, not removed.',
  SAVING: 'Counts as saving, not spending, and takes extra debt repayments. Can be renamed, not removed.',
  SPENDING: null,
};

/**
 * Names, order and percentages of a household's buckets, with a live total.
 * Percentages are counted in hundredths so the total is exact; the API checks
 * the same rule. Adding or removing a bucket happens straight away, so it's
 * only offered when there are no unsaved edits.
 */
export function BucketEditor({
  buckets,
  saving,
  onSave,
  onAdd,
  onRemove,
}: {
  buckets: Bucket[];
  saving?: boolean;
  onSave: (rows: BucketSave[]) => void;
  onAdd: (name: string) => Promise<void>;
  onRemove: (id: string, moveTo: string) => Promise<void>;
}) {
  const initial = () => buckets.map((b) => ({ ...b }));
  const [rows, setRows] = useState(initial);
  const [newName, setNewName] = useState('');
  const [removing, setRemoving] = useState<Bucket | null>(null);

  const parsed = rows.map((r) => percentToHundredths(r.percentage));
  const valid = parsed.every((p) => p !== null && p <= 10000);
  const total = parsed.reduce<number>((s, p) => s + (p ?? 0), 0);
  const names = rows.map((r) => r.name.trim().toLowerCase());
  const namesOk = names.every(Boolean) && new Set(names).size === names.length;
  const ok = valid && total === 10000 && namesOk;
  const dirty = JSON.stringify(rows.map((r) => [r.id, r.name, r.percentage])) !== JSON.stringify(buckets.map((b) => [b.id, b.name, b.percentage]));

  const set = (i: number, patch: Partial<Bucket>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    setRows(next);
  };

  return (
    <>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(rows.map((r) => ({ id: r.id, name: r.name.trim(), percentage: r.percentage.trim() })));
        }}
      >
        <ol className="bucket-edit-rows">
          {rows.map((r, i) => (
            <li key={r.id} className="bucket-edit-row">
              <span className="dot" style={{ background: bucketColour(r.colour) }} aria-hidden="true" />
              <div className="bucket-edit-name stack-xs">
                <input className="input" aria-label={`Name of bucket ${i + 1}`} value={r.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} />
                {ROLE_NOTE[r.role] ? <span className="muted small">{ROLE_NOTE[r.role]}</span> : null}
              </div>
              <div className="input-group bucket-edit-pct">
                <input
                  className="input right"
                  inputMode="decimal"
                  aria-label={`${r.name || `Bucket ${i + 1}`} percentage`}
                  value={r.percentage}
                  aria-invalid={percentToHundredths(r.percentage) === null ? true : undefined}
                  onChange={(e) => set(i, { percentage: e.target.value })}
                />
                <span className="btn" aria-hidden="true" style={{ cursor: 'default' }}>
                  %
                </span>
              </div>
              <div className="row bucket-actions" style={{ gap: '0.25rem' }}>
                <button type="button" className="btn ghost icon" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="chevron-up" />
                </button>
                <button type="button" className="btn ghost icon" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="chevron-down" />
                </button>
                {r.deletable ? (
                  <button type="button" className="btn ghost icon" aria-label={`Remove ${r.name}`} disabled={dirty} title={dirty ? 'Save or undo your changes first' : undefined} onClick={() => setRemoving(buckets.find((b) => b.id === r.id)!)}>
                    <Icon name="trash" />
                  </button>
                ) : (
                  <span style={{ width: 36 }} aria-hidden="true" />
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="row" aria-live="polite">
          <strong style={{ flex: 1 }}>Total</strong>
          <span className={`num ${valid && total === 10000 ? 'pos' : 'neg'}`} data-testid="percentage-total">
            {valid ? `${formatHundredths(total)}%` : '—'}
          </span>
        </div>
        {!valid || total !== 10000 ? (
          <p className="error small" role="alert">
            {valid ? `Percentages must add up to exactly 100% (${total > 10000 ? 'over' : 'under'} by ${formatHundredths(Math.abs(10000 - total))}%).` : 'Enter numbers like 60 or 12.5.'}
          </p>
        ) : !namesOk ? (
          <p className="error small" role="alert">
            Every bucket needs a name, and no two can share one.
          </p>
        ) : null}
        <div className="form-actions">
          {dirty ? (
            <button type="button" className="btn" onClick={() => setRows(initial())}>
              Undo changes
            </button>
          ) : null}
          <button type="submit" className="btn primary" disabled={!ok || !dirty || saving}>
            {saving ? 'Saving…' : 'Save buckets'}
          </button>
        </div>
      </form>

      {buckets.length < MAX_BUCKETS ? (
        <form
          className="row wrap"
          style={{ alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            await onAdd(newName.trim());
            setNewName('');
          }}
        >
          <div className="field grow">
            <label htmlFor="new-bucket">Add a bucket</label>
            <input id="new-bucket" className="input" placeholder="e.g. Kids, Giving, Travel" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <span className="hint">It goes in after Bills at 0%: give it a share above, then move categories into it on the Categories page.</span>
          </div>
          <button type="submit" className="btn" disabled={dirty || !newName.trim()} title={dirty ? 'Save or undo your changes first' : undefined}>
            <Icon name="plus" /> Add bucket
          </button>
        </form>
      ) : (
        <p className="muted small">That’s the most buckets a household can have ({MAX_BUCKETS}).</p>
      )}

      {removing ? <RemoveDialog bucket={removing} others={buckets.filter((b) => b.id !== removing.id)} onCancel={() => setRemoving(null)} onRemove={async (moveTo) => {
        await onRemove(removing.id, moveTo);
        setRemoving(null);
      }} /> : null}
    </>
  );
}

function RemoveDialog({ bucket, others, onCancel, onRemove }: { bucket: Bucket; others: Bucket[]; onCancel: () => void; onRemove: (moveTo: string) => Promise<void> }) {
  const [moveTo, setMoveTo] = useState(others.find((b) => b.role === 'SPENDING')?.id ?? others[0]!.id);
  const [busy, setBusy] = useState(false);
  const target = others.find((b) => b.id === moveTo)!;
  return (
    <Modal
      title={`Remove ${bucket.name}?`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn danger solid"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRemove(moveTo);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Removing…' : `Remove and move to ${target.name}`}
          </button>
        </>
      }
    >
      <div className="stack">
        <p>
          Its categories (and their history), any accounts tagged {bucket.name}, and its {Number(bucket.percentage)}% share move to the bucket you choose. Past spending then shows under that bucket in
          reports.
        </p>
        <div className="field">
          <label htmlFor="move-to">Move everything to</label>
          <select id="move-to" className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            {others.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}
