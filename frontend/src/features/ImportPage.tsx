import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useBuckets, useCategories, useImportBatches } from '../api/hooks';
import type { Account, ColumnMapping, DateFormat, ImportAction, ImportBatch, ImportDecision, ImportRow, ParseResult, SignConvention } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog } from '../components/Modal';
import { ErrorState, FormError, Loading, errorMessage } from '../components/States';
import { AccountSelect, CategorySelect } from '../components/Pickers';
import { Money } from '../components/Money';
import { Field } from '../components/Field';
import { useToast } from '../components/Toast';
import { formatDate, formatDateTime } from '../lib/format';
import { useHousehold } from '../lib/household';
import { TableWrap } from '../components/TableWrap';

const MAX_BYTES = 5 * 1024 * 1024;
const PAGE = 50;
const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'D/M/YY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD MMM YYYY'];
const SIGNS: { value: SignConvention; label: string }[] = [
  { value: 'NEGATIVE_IS_DEBIT', label: 'One amount column: negative is money out' },
  { value: 'POSITIVE_IS_DEBIT', label: 'One amount column: positive is money out (some card exports)' },
  { value: 'DEBIT_CREDIT_COLUMNS', label: 'Separate debit and credit columns' },
];
const DELIMITERS = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe' },
];

type Step = 'upload' | 'map' | 'review' | 'done';
type FileState = { name: string; text: string; size: number };

export function ImportPage() {
  const [params] = useSearchParams();
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState(params.get('accountId') ?? '');
  const [file, setFile] = useState<FileState | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [mapping, setMapping] = useState<Partial<ColumnMapping> | undefined>();
  const [result, setResult] = useState<ParseResult | null>(null);
  const [decisions, setDecisions] = useState<Map<number, ImportDecision>>(new Map());
  const [done, setDone] = useState<ImportBatch | null>(null);
  const [parseError, setParseError] = useState<unknown>(null);
  const [parsing, setParsing] = useState(false);
  const qc = useQueryClient();

  async function runParse(next?: Partial<ColumnMapping>) {
    if (!file || !accountId) return;
    setParsing(true);
    setParseError(null);
    try {
      const res = await api.post<ParseResult>('/import/parse', { accountId, fileName: file.name, csv: file.text, mapping: next });
      setResult(res);
      setMapping(res.mapping);
      setDecisions(new Map());
      if (step === 'upload') setStep('map');
    } catch (err) {
      setParseError(err);
    } finally {
      setParsing(false);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setMapping(undefined);
    setDecisions(new Map());
    setDone(null);
    setStep('upload');
  }

  if (accounts.isPending) return <Loading />;
  if (accounts.isError) return <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />;
  const account = accounts.data.find((a) => a.id === accountId);

  return (
    <>
      <PageHeader title="Import transactions" subtitle="Upload a CSV export from your bank. Nothing is saved until you confirm, and every import can be undone." />
      <p className="small" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
        Bank with Up? It can sync automatically. Any other bank’s files can import themselves from a folder. Both are in <Link to="/settings?section=Bank feeds">Settings → Bank feeds</Link>.
      </p>
      <PageTip id="import" title="Importing from your bank">
        Download a CSV for one account from your internet banking, then upload it here. Rows you already have are skipped, scheduled bills are matched, and you review everything before it’s saved. Every import can be undone.
      </PageTip>
      <ol className="steps" aria-label="Import steps">
        {(['upload', 'map', 'review', 'done'] as Step[]).map((s, i) => (
          <li key={s} aria-current={step === s ? 'step' : undefined} className={step === s ? 'current' : undefined}>
            {i + 1}. {s === 'upload' ? 'Choose file' : s === 'map' ? 'Match columns' : s === 'review' ? 'Review' : 'Done'}
          </li>
        ))}
      </ol>

      {step === 'upload' ? (
        <UploadStep
          accounts={accounts.data}
          accountId={accountId}
          setAccountId={setAccountId}
          file={file}
          setFile={setFile}
          busy={parsing}
          error={parseError}
          onNext={() => runParse()}
        />
      ) : null}

      {step === 'map' && result && mapping ? (
        <MapStep
          result={result}
          mapping={mapping}
          busy={parsing}
          error={parseError}
          onChange={(m) => runParse(m)}
          onBack={reset}
          onNext={() => setStep('review')}
        />
      ) : null}

      {step === 'review' && result && file && account ? (
        <ReviewStep
          account={account}
          accounts={accounts.data}
          file={file}
          result={result}
          decisions={decisions}
          setDecisions={setDecisions}
          onBack={() => setStep('map')}
          onDone={async (batch) => {
            setDone(batch);
            setStep('done');
            await Promise.all(MONEY_QUERIES.map((k) => qc.invalidateQueries({ queryKey: k })));
          }}
          onStale={() => runParse(mapping)}
        />
      ) : null}

      {step === 'done' && done ? (
        <div className="card stack" role="status">
          <h2>Imported {done.importedCount + done.mergedCount} of {done.rowCount} rows into {done.accountName}</h2>
          <dl className="kv" style={{ maxWidth: 360 }}>
            <dt>New transactions</dt>
            <dd>{done.importedCount - done.matchedCount}</dd>
            <dt>Matched to scheduled payments</dt>
            <dd>{done.matchedCount}</dd>
            <dt>Merged with existing entries</dt>
            <dd>{done.mergedCount}</dd>
            <dt>Skipped</dt>
            <dd>{done.skippedCount}</dd>
          </dl>
          <div className="row wrap">
            <Link className="btn primary" to={`/transactions?importBatchId=${done.id}`}>
              View imported transactions
            </Link>
            <Link className="btn" to="/transactions?uncategorised=true">
              Categorise the rest
            </Link>
            <button type="button" className="btn ghost" onClick={reset}>
              Import another file
            </button>
          </div>
        </div>
      ) : null}

      <ImportHistory />
    </>
  );
}

function UploadStep({
  accounts,
  accountId,
  setAccountId,
  file,
  setFile,
  busy,
  error,
  onNext,
}: {
  accounts: Account[];
  accountId: string;
  setAccountId: (id: string) => void;
  file: FileState | null;
  setFile: (f: FileState | null) => void;
  busy: boolean;
  error: unknown;
  onNext: () => void;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function take(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setFileError('That file is larger than 5 MB. Export a shorter date range.');
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text, size: f.size });
  }

  return (
    <div className="card stack">
      <FormError error={error} />
      <Field label="Import into account" hint="Each account remembers how its bank's file is laid out.">
        {(p) => <AccountSelect {...p} accounts={accounts} value={accountId} onChange={setAccountId} />}
      </Field>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files[0]);
        }}
      >
        {file ? (
          <p>
            <strong>{file.name}</strong> <span className="muted">({(file.size / 1024).toFixed(0)} KB)</span>
          </p>
        ) : (
          <p className="muted">Drop a .csv file here, or</p>
        )}
        <button type="button" className="btn" onClick={() => input.current?.click()}>
          {file ? 'Choose a different file' : 'Choose file'}
        </button>
        <input ref={input} type="file" accept=".csv,text/csv,text/plain" className="sr-only" aria-label="CSV file" onChange={(e) => void take(e.target.files?.[0])} />
        {fileError ? (
          <p className="error small" role="alert">
            {fileError}
          </p>
        ) : null}
      </div>
      <div className="form-actions">
        <button type="button" className="btn primary" disabled={!file || !accountId || busy} onClick={onNext}>
          {busy ? 'Reading…' : 'Next'}
        </button>
      </div>
    </div>
  );
}

function ColumnSelect({ label, value, columns, optional, onChange }: { label: string; value: number | null | undefined; columns: string[]; optional?: boolean; onChange: (v: number | null) => void }) {
  return (
    <Field label={label}>
      {(p) => (
        <select {...p} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
          {optional ? <option value="">Not in this file</option> : <option value="">Choose a column</option>}
          {columns.map((c, i) => (
            <option key={i} value={i}>
              {c}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function MapStep({
  result,
  mapping,
  busy,
  error,
  onChange,
  onBack,
  onNext,
}: {
  result: ParseResult;
  mapping: Partial<ColumnMapping>;
  busy: boolean;
  error: unknown;
  onChange: (m: Partial<ColumnMapping>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { locale } = useHousehold();
  const set = (patch: Partial<ColumnMapping>) => onChange({ ...mapping, ...patch });
  const columns = result.columns;
  const preview = result.rows.slice(0, 20);
  const columnsMode = mapping.signConvention === 'DEBIT_CREDIT_COLUMNS';

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row wrap">
          <h2>Match the columns</h2>
          <span className="spacer" />
          {result.profileUsed ? <span className="badge ok">Using this account’s saved layout</span> : <span className="badge">Detected automatically</span>}
          {busy ? <span className="spinner" aria-label="Updating" /> : null}
        </div>
        <FormError error={error} />
        <div className="grid-2">
          <ColumnSelect label="Date" value={mapping.dateColumn} columns={columns} onChange={(v) => set({ dateColumn: v ?? 0 })} />
          <Field label="Date format">
            {(p) => (
              <select {...p} className="input" value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
                {DATE_FORMATS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            )}
          </Field>
          <ColumnSelect label="Description" value={mapping.descriptionColumn} columns={columns} onChange={(v) => set({ descriptionColumn: v ?? 0 })} />
          <Field label="Amounts">
            {(p) => (
              <select
                {...p}
                className="input"
                value={mapping.signConvention}
                onChange={(e) => {
                  const sc = e.target.value as SignConvention;
                  set(sc === 'DEBIT_CREDIT_COLUMNS' ? { signConvention: sc, amountColumn: null } : { signConvention: sc, amountColumn: mapping.amountColumn ?? mapping.debitColumn ?? null, debitColumn: null, creditColumn: null });
                }}
              >
                {SIGNS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {columnsMode ? (
            <>
              <ColumnSelect label="Debit (money out)" value={mapping.debitColumn} columns={columns} onChange={(v) => set({ debitColumn: v })} />
              <ColumnSelect label="Credit (money in)" value={mapping.creditColumn} columns={columns} onChange={(v) => set({ creditColumn: v })} />
            </>
          ) : (
            <ColumnSelect label="Amount" value={mapping.amountColumn} columns={columns} onChange={(v) => set({ amountColumn: v })} />
          )}
          <ColumnSelect label="Balance (optional)" value={mapping.balanceColumn} columns={columns} optional onChange={(v) => set({ balanceColumn: v })} />
          <ColumnSelect label="Payee (optional)" value={mapping.payeeColumn} columns={columns} optional onChange={(v) => set({ payeeColumn: v })} />
          <Field label="Separator">
            {(p) => (
              <select {...p} className="input" value={mapping.delimiter} onChange={(e) => onChange({ delimiter: e.target.value })}>
                {DELIMITERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={Boolean(mapping.hasHeader)} onChange={(e) => set({ hasHeader: e.target.checked })} />
          The first row is a header
        </label>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="card-header" style={{ padding: '1rem 1.25rem 0' }}>
          <h2>Preview</h2>
          <span className="muted small">first {preview.length} of {result.summary.total} rows</span>
        </div>
        <TableWrap label="Import preview">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="right">Amount</th>
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.index}>
                  <td className="num small">{r.date ? formatDate(r.date, locale, 'short') : '—'}</td>
                  <td className="small">{r.description || <span className="muted">—</span>}</td>
                  <td className="right num small">{r.amountCents !== null ? <DirectionAmount row={r} /> : '—'}</td>
                  <td className="small">{r.errors.length ? <span className="neg">{r.errors.join('; ')}</span> : <span className="muted">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn primary" disabled={busy || result.summary.new + result.summary.duplicates === 0} onClick={onNext}>
          Review {result.summary.total} rows
        </button>
      </div>
    </div>
  );
}

function DirectionAmount({ row }: { row: Pick<ImportRow, 'amountCents' | 'direction'> }) {
  if (row.amountCents === null) return <>—</>;
  return (
    <span className={row.direction === 'credit' ? 'pos' : undefined}>
      {row.direction === 'credit' ? '+' : '−'}
      <Money cents={row.amountCents} />
    </span>
  );
}

type Filter = 'all' | 'new' | 'match' | 'merge' | 'duplicate' | 'error' | 'uncategorised';

function ReviewStep({
  account,
  accounts,
  file,
  result,
  decisions,
  setDecisions,
  onBack,
  onDone,
  onStale,
}: {
  account: Account;
  accounts: Account[];
  file: FileState;
  result: ParseResult;
  decisions: Map<number, ImportDecision>;
  setDecisions: (d: Map<number, ImportDecision>) => void;
  onBack: () => void;
  onDone: (b: ImportBatch) => void;
  onStale: () => void;
}) {
  const { locale } = useHousehold();
  const categories = useCategories();
  const buckets = useBuckets();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setPage(0), [filter]);

  const effective = (r: ImportRow) => {
    const d = decisions.get(r.index);
    return {
      action: d?.action ?? r.defaultAction,
      type: d?.type ?? (r.suggestion?.type as ImportDecision['type']) ?? 'EXPENSE',
      categoryId: d && d.categoryId !== undefined ? d.categoryId : (r.suggestion?.categoryId ?? null),
      otherAccountId: d?.otherAccountId ?? r.suggestion?.toAccountId ?? r.suggestion?.fromAccountId ?? null,
    };
  };
  const update = (r: ImportRow, patch: Partial<ImportDecision>) => {
    const e = effective(r);
    const next = new Map(decisions);
    next.set(r.index, { index: r.index, action: e.action, type: e.type, categoryId: e.categoryId, otherAccountId: e.otherAccountId, ...patch });
    setDecisions(next);
  };

  const filtered = useMemo(
    () =>
      result.rows.filter((r) => {
        const e = effective(r);
        switch (filter) {
          case 'new':
            return r.status === 'new' && e.action === 'import';
          case 'match':
            return e.action === 'match';
          case 'merge':
            return e.action === 'merge';
          case 'duplicate':
            return r.status === 'duplicate';
          case 'error':
            return r.status === 'error';
          case 'uncategorised':
            return e.action === 'import' && e.type !== 'TRANSFER' && !e.categoryId;
          default:
            return true;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, decisions, filter],
  );
  const counts = useMemo(() => {
    const c = { import: 0, match: 0, merge: 0, skip: 0 };
    for (const r of result.rows) c[effective(r).action]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, decisions]);
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  async function commit() {
    setCommitting(true);
    setError(null);
    try {
      const batch = await api.post<ImportBatch>('/import/commit', {
        accountId: account.id,
        fileName: file.name,
        csv: file.text,
        mapping: result.mapping,
        decisions: [...decisions.values()],
      });
      toast(`Imported ${batch.importedCount + batch.mergedCount} transactions`);
      onDone(batch);
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.code === 'IMPORT_CHANGED') onStale();
    } finally {
      setCommitting(false);
    }
  }

  const rowProblems = error instanceof ApiError ? ((error.details as { rows?: { index: number; message: string }[] } | undefined)?.rows ?? []) : [];
  const problemFor = new Map(rowProblems.map((p) => [p.index, p.message]));
  const s = result.summary;
  const chips: { key: Filter; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: s.total },
    { key: 'new', label: 'New', n: result.rows.filter((r) => r.status === 'new' && effective(r).action === 'import').length },
    { key: 'uncategorised', label: 'No category', n: result.rows.filter((r) => { const e = effective(r); return e.action === 'import' && e.type !== 'TRANSFER' && !e.categoryId; }).length },
    { key: 'match', label: 'Scheduled', n: counts.match },
    { key: 'merge', label: 'Already entered', n: counts.merge },
    { key: 'duplicate', label: 'Duplicates', n: s.duplicates },
    { key: 'error', label: 'Problems', n: s.errors },
  ];

  return (
    <div className="stack">
      {result.balanceCheck ? (
        <div className={`card small ${result.balanceCheck.differenceCents === 0 ? '' : 'warn-border'}`} role="status">
          {result.balanceCheck.differenceCents === 0 ? (
            <>
              ✓ After this import, {account.name} will match the statement balance of <Money cents={result.balanceCheck.statementBalanceCents} /> on{' '}
              {formatDate(result.balanceCheck.date, locale)}.
            </>
          ) : (
            <>
              The statement shows <Money cents={result.balanceCheck.statementBalanceCents} /> on {formatDate(result.balanceCheck.date, locale)}; after this import the app will
              show <Money cents={result.balanceCheck.appBalanceAfterCents} /> (a difference of <Money cents={result.balanceCheck.differenceCents} signed />). Check for missing rows,
              or reconcile the account afterwards.
            </>
          )}
        </div>
      ) : null}

      <div className="segmented" role="group" aria-label="Show rows">
        {chips.map((c) => (
          <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}>
            {c.label} <span className="muted">{c.n}</span>
          </button>
        ))}
      </div>

      <FormError error={error} />

      <div className="card" style={{ padding: 0 }}>
        <TableWrap label="Rows to import">
          <table className="table import-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="right">Amount</th>
                <th>Action</th>
                <th>Treat as</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small">
                    No rows here.
                  </td>
                </tr>
              ) : null}
              {pageRows.map((r) => {
                const e = effective(r);
                const actions: { value: ImportAction; label: string }[] =
                  r.status !== 'new'
                    ? [{ value: 'skip', label: r.status === 'duplicate' ? 'Skip (already imported)' : 'Skip (can’t import)' }]
                    : [
                        ...(r.match ? [{ value: 'match' as const, label: `Record as ${r.match.name}` }] : []),
                        ...(r.merge ? [{ value: 'merge' as const, label: 'Link to existing entry' }] : []),
                        { value: 'import' as const, label: 'Import as new' },
                        { value: 'skip' as const, label: 'Skip' },
                      ];
                return (
                  <tr key={r.index} className={problemFor.has(r.index) ? 'row-problem' : undefined}>
                    <td className="num small">{r.date ? formatDate(r.date, locale, 'short') : '—'}</td>
                    <td className="small" style={{ maxWidth: 280 }}>
                      <div className="truncate">{r.description || '—'}</div>
                      {r.errors.length ? <div className="neg">{r.errors.join('; ')}</div> : null}
                      {problemFor.has(r.index) ? <div className="neg">{problemFor.get(r.index)}</div> : null}
                      {e.action === 'merge' && r.merge ? (
                        <div className="muted">
                          Matches “{r.merge.description}” on {formatDate(r.merge.date, locale, 'short')}
                        </div>
                      ) : null}
                      {e.action === 'match' && r.match ? (
                        <div className="muted">
                          Scheduled {formatDate(r.match.date, locale, 'short')} · <Money cents={r.match.amountCents} />
                        </div>
                      ) : null}
                      {r.suggestion?.ruleName && e.action === 'import' ? <div className="muted">Rule: {r.suggestion.ruleName}</div> : null}
                    </td>
                    <td className="right num small">
                      <DirectionAmount row={r} />
                    </td>
                    <td>
                      <select className="input" aria-label={`Action for ${r.description}`} value={e.action} disabled={r.status !== 'new'} onChange={(ev) => update(r, { action: ev.target.value as ImportAction })}>
                        {actions.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ minWidth: 260 }}>
                      {e.action === 'import' ? (
                        <div className="stack-sm" style={{ gap: '0.3rem' }}>
                          <select
                            className="input"
                            aria-label={`Type for ${r.description}`}
                            value={e.type}
                            onChange={(ev) => update(r, { type: ev.target.value as ImportDecision['type'], categoryId: null })}
                          >
                            {r.direction === 'debit' ? <option value="EXPENSE">Expense</option> : null}
                            {r.direction === 'credit' ? <option value="INCOME">Income</option> : null}
                            {r.direction === 'credit' ? <option value="REFUND">Refund</option> : null}
                            <option value="TRANSFER">{r.direction === 'debit' ? 'Transfer to…' : 'Transfer from…'}</option>
                          </select>
                          {e.type === 'TRANSFER' ? (
                            <AccountSelect
                              aria-label={`Other account for ${r.description}`}
                              accounts={accounts}
                              value={e.otherAccountId ?? ''}
                              filter={(a) => a.id !== account.id}
                              onChange={(id) => update(r, { otherAccountId: id || null })}
                            />
                          ) : (
                            <CategorySelect
                              aria-label={`Category for ${r.description}`}
                              categories={categories.data ?? []}
                              buckets={buckets.data ?? []}
                              kind={e.type === 'INCOME' ? 'INCOME' : 'EXPENSE'}
                              placeholder="Leave uncategorised"
                              value={e.categoryId ?? ''}
                              onChange={(id) => update(r, { categoryId: id || null })}
                            />
                          )}
                        </div>
                      ) : e.action === 'match' ? (
                        <span className="small muted">As scheduled</span>
                      ) : e.action === 'merge' ? (
                        <span className="small muted">Keeps the existing entry</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </div>
      {pages > 1 ? (
        <nav className="row" style={{ justifyContent: 'center' }} aria-label="Pages">
          <button type="button" className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="small muted">
            Page {page + 1} of {pages}
          </span>
          <button type="button" className="btn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      ) : null}

      <div className="card row wrap">
        <span className="small">
          <strong>{counts.import + counts.match}</strong> new · <strong>{counts.merge}</strong> linked to existing · <strong>{counts.skip}</strong> skipped
        </span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn primary" disabled={committing || counts.import + counts.match + counts.merge === 0} onClick={commit}>
          {committing ? 'Importing…' : `Import ${counts.import + counts.match + counts.merge} transactions`}
        </button>
      </div>
    </div>
  );
}

function ImportHistory() {
  const batches = useImportBatches();
  const { locale, timezone } = useHousehold();
  const toast = useToast();
  const [undoing, setUndoing] = useState<ImportBatch | null>(null);
  const undo = useApiMutation((id: string) => api.delete<{ removed: number; unmerged: number }>(`/import/batches/${id}`), MONEY_QUERIES);
  if (!batches.data?.length) return null;
  return (
    <section className="card" style={{ marginTop: '1.5rem' }} aria-labelledby="hist-h">
      <div className="card-header">
        <h2 id="hist-h">Recent imports</h2>
      </div>
      {batches.data.map((b) => (
        <div key={b.id} className="list-item">
          <div className="grow">
            <div className="truncate">
              <strong>{b.fileName}</strong> → {b.accountName}
            </div>
            <div className="muted small">
              {formatDateTime(b.createdAt, locale, timezone)} · {b.importedCount} added
              {b.mergedCount ? `, ${b.mergedCount} linked` : ''}
              {b.skippedCount ? `, ${b.skippedCount} skipped` : ''}
            </div>
          </div>
          {b.status === 'UNDONE' ? (
            <span className="badge">Undone</span>
          ) : (
            <>
              <Link className="btn small ghost" to={`/transactions?importBatchId=${b.id}`}>
                View
              </Link>
              <button type="button" className="btn small" onClick={() => setUndoing(b)}>
                Undo
              </button>
            </>
          )}
        </div>
      ))}
      {undoing ? (
        <ConfirmDialog
          title={`Undo import of ${undoing.fileName}?`}
          message={`This removes the ${undoing.importedCount} transactions it added (including any you've edited since) and unlinks ${undoing.mergedCount} merged entries. Your own entries are kept.`}
          confirmLabel="Undo import"
          busy={undo.isPending}
          onCancel={() => setUndoing(null)}
          onConfirm={async () => {
            try {
              const r = await undo.mutateAsync(undoing.id);
              toast(`Removed ${r.removed} transactions`);
            } catch (err) {
              toast(errorMessage(err), 'error');
            }
            setUndoing(null);
          }}
        />
      ) : null}
    </section>
  );
}
