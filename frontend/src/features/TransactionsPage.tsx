import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useBuckets, useCategories, useTransactions, type TransactionQuery } from '../api/hooks';
import type { Transaction, TransactionType } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Money } from '../components/Money';
import { MoneyInput } from '../components/MoneyInput';
import { DateInput } from '../components/DateInput';
import { ConfirmDialog, Modal } from '../components/Modal';
import { AccountSelect, CategorySelect } from '../components/Pickers';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { formatDate } from '../lib/format';
import { useHousehold } from '../lib/household';
import { strings } from '../locales/en-AU';
import { TransactionForm } from './TransactionForm';

/** Which way money moved, from one account's point of view. Display only. */
function direction(t: Transaction, accountId?: string): 'in' | 'out' | 'neutral' {
  switch (t.type) {
    case 'INCOME':
    case 'REFUND':
      return 'in';
    case 'EXPENSE':
    case 'INTEREST_CHARGE':
      return 'out';
    case 'BALANCE_ADJUSTMENT':
      return t.direction === 'INCREASE' ? 'in' : 'out';
    default:
      if (accountId) return t.toAccountId === accountId ? 'in' : 'out';
      return 'neutral';
  }
}

function AmountCell({ t, accountId }: { t: Transaction; accountId?: string }) {
  const d = direction(t, accountId);
  return (
    <span className={d === 'in' ? 'pos' : undefined}>
      {d === 'in' ? '+' : d === 'out' ? '−' : ''}
      <Money cents={t.amountCents} />
    </span>
  );
}

function CategoryCell({ t }: { t: Transaction }) {
  if (t.uncategorised) return <span className="badge warn">Uncategorised</span>;
  if (t.splits.length === 0) return <span className="muted">{t.type === 'TRANSFER' ? `→ ${t.toAccountName}` : '—'}</span>;
  return (
    <span className="row wrap" style={{ gap: '0.35rem' }}>
      {t.splits.length > 1 ? <span className="badge">Split · {t.splits.length}</span> : null}
      <span className="truncate">{t.splits.map((s) => s.categoryName).join(', ')}</span>
    </span>
  );
}

function categorySummary(t: Transaction): string {
  if (t.uncategorised) return 'Uncategorised';
  if (t.splits.length === 0) return t.toAccountName ? `→ ${t.toAccountName}` : strings.transactionTypes[t.type];
  return t.splits.map((s) => s.categoryName).join(', ');
}

function BucketDots({ t }: { t: Transaction }) {
  return (
    <span className="row bucket-dots" style={{ gap: '0.25rem' }}>
      {t.buckets.map((b) => (
        <span key={b.id} className="dot" style={{ background: b.colour }} title={b.name} aria-label={b.name} role="img" />
      ))}
    </span>
  );
}

export function TransactionRowCompact({ t, perspectiveAccountId, onClick }: { t: Transaction; perspectiveAccountId?: string; onClick?: () => void }) {
  const { locale } = useHousehold();
  return (
    <div className={`list-item${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(e) => onClick && e.key === 'Enter' && onClick()}>
      <BucketDots t={t} />
      <div className="grow">
        <div className="truncate" style={{ fontWeight: 550 }}>
          {t.payee || t.description}
        </div>
        <div className={`small truncate ${t.uncategorised ? '' : 'muted'}`}>
          {formatDate(t.date, locale)} · {t.uncategorised ? <span className="badge warn">Uncategorised</span> : categorySummary(t)}
        </div>
      </div>
      <AmountCell t={t} accountId={perspectiveAccountId} />
    </div>
  );
}

const SORTABLE: { key: string; label: string; right?: boolean }[] = [
  { key: 'date', label: 'Date' },
  { key: 'description', label: 'Description' },
  { key: 'type', label: 'Type' },
  { key: 'account', label: 'Account' },
];

const ALL_TYPES = Object.keys(strings.transactionTypes) as TransactionType[];

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const { locale } = useHousehold();
  const accounts = useAccounts(true);
  const categories = useCategories(true);
  const buckets = useBuckets();
  const toast = useToast();

  const query: TransactionQuery = {
    page: Number(params.get('page') ?? 1),
    pageSize: 50,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    accountId: params.get('accountId') ?? undefined,
    bucketId: params.get('bucketId') ?? undefined,
    categoryId: params.get('categoryId') ?? undefined,
    type: params.get('type')?.split(',').filter(Boolean),
    minCents: params.get('minCents') ? Number(params.get('minCents')) : undefined,
    maxCents: params.get('maxCents') ? Number(params.get('maxCents')) : undefined,
    search: params.get('search') ?? undefined,
    uncategorised: params.get('uncategorised') === 'true' || undefined,
    sort: params.get('sort') ?? 'date',
    order: (params.get('order') as 'asc' | 'desc') ?? 'desc',
  };
  const list = useTransactions(query);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkCategory, setBulkCategory] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [searchText, setSearchText] = useState(query.search ?? '');

  const bulk = useApiMutation((body: { action: string; ids: string[]; categoryId?: string }) => api.post<{ deleted: number; updated: number; skipped: number }>('/transactions/bulk', body), MONEY_QUERIES);
  const remove = useApiMutation((id: string) => api.delete(`/transactions/${id}`), MONEY_QUERIES);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
    setSelected(new Set());
  };

  const activeFilters = ['from', 'to', 'accountId', 'bucketId', 'categoryId', 'type', 'minCents', 'maxCents', 'uncategorised'].filter((k) => params.get(k)).length;
  const items = list.data?.items ?? [];
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id));

  const toggleSort = (key: string) => update({ sort: key, order: query.sort === key && query.order === 'desc' ? 'asc' : 'desc' });
  const sortIndicator = (key: string) => (query.sort === key ? (query.order === 'asc' ? ' ▲' : ' ▼') : '');
  const ariaSort = (key: string) => (query.sort === key ? (query.order === 'asc' ? 'ascending' : 'descending') : undefined);

  const filterPanel = useMemo(
    () => (
      <div className="card stack" style={{ marginBottom: '1rem' }}>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">From</span>
            <DateInput aria-label="From date" value={query.from ?? ''} onChange={(d) => update({ from: d })} />
          </div>
          <div className="field">
            <span className="field-label">To</span>
            <DateInput aria-label="To date" value={query.to ?? ''} onChange={(d) => update({ to: d })} />
          </div>
          <div className="field">
            <span className="field-label">Account</span>
            <AccountSelect aria-label="Account" accounts={accounts.data ?? []} value={query.accountId ?? ''} placeholder="All accounts" onChange={(id) => update({ accountId: id })} />
          </div>
          <div className="field">
            <span className="field-label">Bucket</span>
            <select aria-label="Bucket" className="input" value={query.bucketId ?? ''} onChange={(e) => update({ bucketId: e.target.value })}>
              <option value="">All buckets</option>
              {(buckets.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Category</span>
            <select aria-label="Category" className="input" value={query.categoryId ?? ''} onChange={(e) => update({ categoryId: e.target.value })}>
              <option value="">All categories</option>
              {(categories.data ?? [])
                .filter((c) => !c.isGroup)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Type</span>
            <select aria-label="Type" className="input" value={query.type?.[0] ?? ''} onChange={(e) => update({ type: e.target.value })}>
              <option value="">All types</option>
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {strings.transactionTypes[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Minimum amount</span>
            <MoneyInput aria-label="Minimum amount" value={query.minCents ?? null} onChange={(c) => update({ minCents: c === null ? undefined : String(c) })} />
          </div>
          <div className="field">
            <span className="field-label">Maximum amount</span>
            <MoneyInput aria-label="Maximum amount" value={query.maxCents ?? null} onChange={(c) => update({ maxCents: c === null ? undefined : String(c) })} />
          </div>
        </div>
        <div className="row wrap">
          <label className="checkbox">
            <input type="checkbox" checked={Boolean(query.uncategorised)} onChange={(e) => update({ uncategorised: e.target.checked ? 'true' : undefined })} />
            Uncategorised only
          </label>
          <span className="spacer" />
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setParams(new URLSearchParams(), { replace: true });
              setSearchText('');
            }}
          >
            Clear filters
          </button>
        </div>
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, accounts.data, buckets.data, categories.data],
  );

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={list.data ? `${list.data.total.toLocaleString(locale)} transaction${list.data.total === 1 ? '' : 's'}` : undefined}
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing('new')} disabled={!accounts.data?.length}>
            <Icon name="plus" /> Add transaction
          </button>
        }
      />

      <form
        className="row"
        style={{ marginBottom: '1rem' }}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ search: searchText.trim() || undefined });
        }}
      >
        <div className="input-group" style={{ flex: 1 }}>
          <input className="input" type="search" placeholder="Search description, payee or notes" aria-label="Search transactions" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          <button type="submit" className="btn icon" aria-label="Search">
            <Icon name="search" />
          </button>
        </div>
        <button type="button" className="btn" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          <Icon name="filter" /> Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </form>
      {showFilters ? filterPanel : null}

      {selected.size > 0 ? (
        <div className="card row wrap" style={{ marginBottom: '1rem', padding: '0.6rem 1rem' }}>
          <strong>{selected.size} selected</strong>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={() => setBulkCategory(true)}>
            Recategorise
          </button>
          <button type="button" className="btn small danger" onClick={() => setBulkDelete(true)}>
            Delete
          </button>
          <button type="button" className="btn small ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      <div className="card" style={{ padding: 0 }}>
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={activeFilters || query.search ? 'No matching transactions' : 'No transactions yet'}
            action={
              accounts.data?.length ? (
                <button type="button" className="btn primary" onClick={() => setEditing('new')}>
                  Add a transaction
                </button>
              ) : (
                <a className="btn primary" href="/accounts">
                  Add an account first
                </a>
              )
            }
          >
            {activeFilters || query.search ? 'Try clearing some filters.' : 'Record income, spending and transfers here.'}
          </EmptyState>
        ) : (
          <div className="responsive-table">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allSelected}
                        onChange={(e) => setSelected(e.target.checked ? new Set(items.map((t) => t.id)) : new Set())}
                      />
                    </th>
                    {SORTABLE.map((c) => (
                      <th key={c.key} aria-sort={ariaSort(c.key)}>
                        <button type="button" onClick={() => toggleSort(c.key)}>
                          {c.label}
                          {sortIndicator(c.key)}
                        </button>
                      </th>
                    ))}
                    <th>Category</th>
                    <th className="right" aria-sort={ariaSort('amount')}>
                      <button type="button" onClick={() => toggleSort('amount')}>
                        Amount{sortIndicator('amount')}
                      </button>
                    </th>
                    <th style={{ width: 96 }}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id} className={selected.has(t.id) ? 'selected' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${t.description}`}
                          checked={selected.has(t.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(t.id);
                            else next.delete(t.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="num">{formatDate(t.date, locale, 'short')}</td>
                      <td style={{ maxWidth: 280 }}>
                        <div className="truncate" style={{ fontWeight: 550 }}>
                          {t.description}
                        </div>
                        {t.payee ? <div className="muted small truncate">{t.payee}</div> : null}
                      </td>
                      <td className="small">{strings.transactionTypes[t.type]}</td>
                      <td className="small">
                        {t.accountName}
                        {t.toAccountName ? ` → ${t.toAccountName}` : ''}
                      </td>
                      <td className="small" style={{ maxWidth: 240 }}>
                        <span className="row" style={{ gap: '0.4rem' }}>
                          <BucketDots t={t} />
                          <CategoryCell t={t} />
                        </span>
                      </td>
                      <td className="right num">
                        <AmountCell t={t} accountId={query.accountId} />
                      </td>
                      <td className="right" style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn ghost icon" aria-label={`Edit ${t.description}`} onClick={() => setEditing(t)}>
                          <Icon name="edit" />
                        </button>
                        <button type="button" className="btn ghost icon" aria-label={`Delete ${t.description}`} onClick={() => setDeleting(t)}>
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-list" style={{ padding: '0 1rem' }}>
              {items.map((t) => (
                <TransactionRowCompact key={t.id} t={t} perspectiveAccountId={query.accountId} onClick={() => setEditing(t)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {list.data && list.data.total > list.data.pageSize ? (
        <nav className="row" style={{ justifyContent: 'center', marginTop: '1rem' }} aria-label="Pagination">
          <button type="button" className="btn small" disabled={query.page <= 1} onClick={() => update({ page: String(query.page - 1) })}>
            <Icon name="chevronLeft" /> Previous
          </button>
          <span className="small muted">
            Page {query.page} of {totalPages}
          </span>
          <button type="button" className="btn small" disabled={query.page >= totalPages} onClick={() => update({ page: String(query.page + 1) })}>
            Next <Icon name="chevronRight" />
          </button>
        </nav>
      ) : null}

      {editing ? <TransactionForm transaction={editing === 'new' ? undefined : editing} defaultAccountId={query.accountId} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete transaction?"
          message={`“${deleting.description}” will be removed and balances updated.`}
          busy={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast('Transaction deleted');
            setDeleting(null);
          }}
        />
      ) : null}
      {bulkDelete ? (
        <ConfirmDialog
          title={`Delete ${selected.size} transactions?`}
          message="Balances will be updated. This can’t be undone."
          busy={bulk.isPending}
          onCancel={() => setBulkDelete(false)}
          onConfirm={async () => {
            const res = await bulk.mutateAsync({ action: 'delete', ids: [...selected] });
            toast(`${res.deleted} deleted`);
            setSelected(new Set());
            setBulkDelete(false);
          }}
        />
      ) : null}
      {bulkCategory ? (
        <BulkCategoryDialog
          count={selected.size}
          onClose={() => setBulkCategory(false)}
          onApply={async (categoryId) => {
            const res = await bulk.mutateAsync({ action: 'recategorise', ids: [...selected], categoryId });
            toast(`${res.updated} updated${res.skipped ? `, ${res.skipped} skipped (transfers and other types keep their categories)` : ''}`);
            setSelected(new Set());
            setBulkCategory(false);
          }}
        />
      ) : null}
    </>
  );
}

function BulkCategoryDialog({ count, onClose, onApply }: { count: number; onClose: () => void; onApply: (categoryId: string) => Promise<void> }) {
  const categories = useCategories();
  const buckets = useBuckets();
  const [kind, setKind] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Recategorise ${count} transactions`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!categoryId || busy}
            onClick={async () => {
              setBusy(true);
              await onApply(categoryId).finally(() => setBusy(false));
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">Each selected expense, refund or income gets this one category for its full amount. Other types are skipped.</p>
        <div className="segmented" role="group" aria-label="Category kind">
          <button type="button" aria-pressed={kind === 'EXPENSE'} onClick={() => setKind('EXPENSE')}>
            Spending
          </button>
          <button type="button" aria-pressed={kind === 'INCOME'} onClick={() => setKind('INCOME')}>
            Income
          </button>
        </div>
        <CategorySelect aria-label="New category" categories={categories.data ?? []} buckets={buckets.data ?? []} kind={kind} value={categoryId} onChange={setCategoryId} />
      </div>
    </Modal>
  );
}
