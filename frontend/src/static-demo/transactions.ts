import type { Page, Transaction } from '../api/types';

/**
 * GET /transactions for the static demo: the same filters, sort and paging as
 * the server (backend/src/repositories/transactions.ts), over the recorded list.
 */
const CATEGORISED_TYPES = ['EXPENSE', 'REFUND', 'INCOME'];
const SORTS = ['date', 'amount', 'description', 'payee', 'type', 'account', 'createdAt'] as const;
type Sort = (typeof SORTS)[number];

const text = (a: string, b: string) => a.localeCompare(b, 'en-AU', { sensitivity: 'base' });
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

function primary(sort: Sort, a: Transaction, b: Transaction): number {
  switch (sort) {
    case 'amount':
      return a.amountCents - b.amountCents;
    case 'description':
      return text(a.description, b.description);
    case 'account':
      return text(a.accountName, b.accountName);
    case 'type':
      return cmp(a.type, b.type);
    case 'createdAt':
      return cmp(a.createdAt, b.createdAt);
    case 'payee':
      return text(a.payee ?? '', b.payee ?? '');
    default:
      return cmp(a.date, b.date);
  }
}

const int = (v: string | null, fallback: number, min: number, max: number) => {
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function listTransactions(all: Transaction[], q: URLSearchParams): Page<Transaction> {
  const from = q.get('from');
  const to = q.get('to');
  const accountId = q.get('accountId');
  const categoryId = q.get('categoryId');
  const bucketId = q.get('bucketId');
  const importBatchId = q.get('importBatchId');
  const types = (q.get('type') ?? '').split(',').filter(Boolean);
  const min = q.get('minCents');
  const max = q.get('maxCents');
  const search = (q.get('search') ?? '').trim().toLowerCase();
  const uncategorised = q.get('uncategorised') === 'true';

  const items = all.filter(
    (t) =>
      (!from || t.date >= from) &&
      (!to || t.date <= to) &&
      (!accountId || t.accountId === accountId || t.toAccountId === accountId) &&
      (!categoryId || t.splits.some((s) => s.categoryId === categoryId)) &&
      (!bucketId || t.splits.some((s) => s.bucketId === bucketId)) &&
      (!types.length || types.includes(t.type)) &&
      (min === null || t.amountCents >= Number(min)) &&
      (max === null || t.amountCents <= Number(max)) &&
      (!search || [t.description, t.payee, t.notes].some((f) => f?.toLowerCase().includes(search))) &&
      (!importBatchId || t.importBatchId === importBatchId) &&
      (!uncategorised || (CATEGORISED_TYPES.includes(t.type) && t.splits.length === 0)),
  );

  const sort = (SORTS as readonly string[]).includes(q.get('sort') ?? '') ? (q.get('sort') as Sort) : 'date';
  const dir = q.get('order') === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    // Payees sort with blanks last either way, like the server.
    if (sort === 'payee' && !a.payee !== !b.payee) return a.payee ? -1 : 1;
    return dir * primary(sort, a, b) || cmp(b.date, a.date) || cmp(b.createdAt, a.createdAt) || cmp(a.id, b.id);
  });

  const page = int(q.get('page'), 1, 1, 100_000);
  const pageSize = int(q.get('pageSize'), 50, 1, 200);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}
