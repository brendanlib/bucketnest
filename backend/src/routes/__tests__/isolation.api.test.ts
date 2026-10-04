import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase } from '../../test/helpers.js';

/** User B must get 404 for every one of user A's records, for reads, updates and deletes (spec §18). */
let app: FastifyInstance;
let a: Client;
let b: Client;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
  a = (await registerUser(app)).client;
  b = (await registerUser(app)).client;
  const account = await createAccount(a, { name: 'A main', type: 'TRANSACTION' });
  ids.account = account.id;
  ids.category = await categoryId(a, 'Groceries');
  const tx = await a.post('/api/transactions', {
    date: '2026-10-01', description: 'A shop', amountCents: 100, type: 'EXPENSE', accountId: account.id,
    splits: [{ categoryId: ids.category, amountCents: 100 }],
  });
  ids.transaction = tx.body.id;
  ids.session = (await a.get('/api/auth/sessions')).body.items[0].id;
  ids.budget = (await a.get('/api/budgets')).body.items[0].id;
  ids.recurring = (await a.post('/api/recurring-transactions', {
    name: 'A rent', type: 'EXPENSE', amountCents: 100, frequency: 'MONTHLY', startDate: '2026-10-01', accountId: account.id, categoryId: ids.category,
  })).body.id;
});
afterAll(async () => {
  await app.close();
});

describe('household isolation', () => {
  it('accounts', async () => {
    const body = { name: 'Hijack', type: 'TRANSACTION', openingBalanceCents: 0, openingDate: '2026-01-01' };
    expect((await b.get(`/api/accounts/${ids.account}`)).status).toBe(404);
    expect((await b.put(`/api/accounts/${ids.account}`, body)).status).toBe(404);
    expect((await b.delete(`/api/accounts/${ids.account}`)).status).toBe(404);
    expect((await b.get(`/api/accounts/${ids.account}/balance-history`)).status).toBe(404);
    expect((await b.post(`/api/accounts/${ids.account}/reconcile`, { statementBalanceCents: 0, date: '2026-10-01' })).status).toBe(404);
    expect((await b.get('/api/accounts')).body.items).toEqual([]);
  });

  it('categories', async () => {
    expect((await b.put(`/api/categories/${ids.category}`, { name: 'Hijack' })).status).toBe(404);
    expect((await b.delete(`/api/categories/${ids.category}`)).status).toBe(404);
    const bCats = (await b.get('/api/categories')).body.items;
    expect(bCats.some((c: { id: string }) => c.id === ids.category)).toBe(false);
  });

  it('transactions', async () => {
    expect((await b.get(`/api/transactions/${ids.transaction}`)).status).toBe(404);
    expect((await b.put(`/api/transactions/${ids.transaction}`, { date: '2026-10-01', description: 'x', amountCents: 1, type: 'BALANCE_ADJUSTMENT', direction: 'INCREASE', accountId: ids.account })).status).toBe(404);
    expect((await b.delete(`/api/transactions/${ids.transaction}`)).status).toBe(404);
    expect((await b.post('/api/transactions/bulk', { action: 'delete', ids: [ids.transaction] })).status).toBe(404);
    expect((await b.get('/api/transactions')).body.total).toBe(0);
    expect((await b.get(`/api/transactions?accountId=${ids.account}`)).body.total).toBe(0);
  });

  it('cannot use another household\'s account or category in its own records', async () => {
    const own = await createAccount(b, { name: 'B main', type: 'TRANSACTION' });
    const ownCat = await categoryId(b, 'Groceries');
    const intoA = await b.post('/api/transactions', { date: '2026-10-01', description: 'x', amountCents: 100, type: 'TRANSFER', accountId: own.id, toAccountId: ids.account });
    expect(intoA.status).toBe(400);
    const withACat = await b.post('/api/transactions', { date: '2026-10-01', description: 'x', amountCents: 100, type: 'EXPENSE', accountId: own.id, splits: [{ categoryId: ids.category, amountCents: 100 }] });
    expect(withACat.status).toBe(400);
    const reassign = await b.delete(`/api/categories/${await categoryId(b, 'Golf')}?reassignTo=${ids.category}`);
    expect(reassign.status).toBe(400); // the reassign target is always validated, even for an unused category
    const used = await b.post('/api/transactions', { date: '2026-10-01', description: 'x', amountCents: 100, type: 'EXPENSE', accountId: own.id, splits: [{ categoryId: ownCat, amountCents: 100 }] });
    expect(used.status).toBe(201);
    expect((await b.delete(`/api/categories/${ownCat}?reassignTo=${ids.category}`)).status).toBe(400);
  });

  it('budgets', async () => {
    expect((await b.get(`/api/budgets/${ids.budget}`)).status).toBe(404);
    expect((await b.put(`/api/budgets/${ids.budget}`, { name: 'Hijack' })).status).toBe(404);
    expect((await b.delete(`/api/budgets/${ids.budget}`)).status).toBe(404);
    expect((await b.get(`/api/budgets/${ids.budget}/summary`)).status).toBe(404);
    expect((await b.post(`/api/budgets/${ids.budget}/copy`, {})).status).toBe(404);
    expect((await b.put(`/api/budgets/${ids.budget}/items/${ids.category}`, { amountCents: 1, enteredFrequency: 'MONTHLY' })).status).toBe(404);
    const own = (await b.get('/api/budgets')).body.items[0].id;
    expect((await b.put(`/api/budgets/${own}/items/${ids.category}`, { amountCents: 1, enteredFrequency: 'MONTHLY' })).status).toBe(400);
  });

  it('recurring schedules and occurrences', async () => {
    const base = `/api/recurring-transactions/${ids.recurring}`;
    expect((await b.get(base)).status).toBe(404);
    expect((await b.put(base, { name: 'x', type: 'EXPENSE', amountCents: 1, frequency: 'MONTHLY', startDate: '2026-10-01', accountId: ids.account, categoryId: ids.category })).status).toBe(404);
    expect((await b.delete(base)).status).toBe(404);
    expect((await b.post(`${base}/occurrences/2026-10-01/post`)).status).toBe(404);
    expect((await b.post(`${base}/occurrences/2026-10-01/skip`)).status).toBe(404);
    expect((await b.put(`${base}/occurrences/2026-10-01`, { amountCents: 5 })).status).toBe(404);
    expect((await b.get(`${base}/occurrences/2026-10-01/draft`)).status).toBe(404);
    expect((await b.get('/api/recurring-transactions')).body.items).toEqual([]);
    expect((await b.get('/api/recurring-transactions/occurrences?from=2026-10-01&to=2026-10-31')).body.items).toEqual([]);
    expect((await b.get('/api/dashboard')).body.billsDue).toEqual([]);
  });

  it('sessions', async () => {
    expect((await b.delete(`/api/auth/sessions/${ids.session}`)).status).toBe(404);
    expect((await a.get('/api/auth/me')).status).toBe(200);
  });

  it('A still sees everything intact', async () => {
    expect((await a.get(`/api/transactions/${ids.transaction}`)).body.description).toBe('A shop');
    expect((await a.get(`/api/accounts/${ids.account}`)).body.name).toBe('A main');
  });
});
