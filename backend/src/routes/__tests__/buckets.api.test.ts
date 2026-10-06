import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, TestClock } from '../../test/helpers.js';

let app: FastifyInstance;
let client: Client;
const clock = new TestClock();

type B = { id: string; key: string; role: string; name: string; percentage: string; sortOrder: number; colour: string; deletable: boolean };
const list = async (): Promise<B[]> => (await client.get('/api/buckets')).body.items;
const byName = async (name: string) => (await list()).find((b) => b.name === name)!;
/** Saves names/order/percentages: [name, percentage] in the order given. */
async function save(rows: [string, number | string, string?][]) {
  const current = await list();
  return client.put('/api/buckets', {
    buckets: rows.map(([name, percentage, rename]) => ({ id: current.find((b) => b.name === name)!.id, percentage, ...(rename ? { name: rename } : {}) })),
  });
}

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-06T01:00:00Z');
  app = await createTestApp({ clock });
  ({ client } = await registerUser(app));
});
afterEach(async () => {
  await app.close();
});

describe('custom buckets', () => {
  it('starts with the four buckets, two of which carry the rules', async () => {
    expect((await list()).map((b) => [b.name, b.role, b.deletable, b.colour])).toEqual([
      ['Bills', 'BILLS', false, '#2A78D6'],
      ['Smile', 'SPENDING', true, '#4A3AA7'],
      ['Splurge', 'SPENDING', true, '#1BAF7A'],
      ['Fire Extinguisher', 'SAVING', false, '#EB6834'],
    ]);
  });

  it('adds a spending bucket at 0%, after Bills, without changing anyone else’s colour', async () => {
    const res = await client.post('/api/buckets', { name: 'Kids' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Kids', role: 'SPENDING', percentage: '0.00', deletable: true });
    expect(res.body.key).toMatch(/^CUSTOM_[0-9A-F]{10}$/);
    const all = await list();
    expect(all.map((b) => b.name)).toEqual(['Bills', 'Kids', 'Smile', 'Splurge', 'Fire Extinguisher']);
    expect(all.map((b) => b.colour)).toEqual(['#2A78D6', '#EDA100', '#4A3AA7', '#1BAF7A', '#EB6834']);
    expect(all.map((b) => b.sortOrder)).toEqual([1, 2, 3, 4, 5]);

    expect((await client.post('/api/buckets', { name: 'kids' })).body.error.code).toBe('NAME_TAKEN');
  });

  it('allows at most eight buckets', async () => {
    for (const name of ['A', 'B', 'C', 'D']) expect((await client.post('/api/buckets', { name })).status).toBe(201);
    // The validated eight-bucket arrangement: each new one went in after Bills.
    expect((await list()).map((b) => [b.name, b.colour])).toEqual([
      ['Bills', '#2A78D6'],
      ['D', '#E34948'],
      ['C', '#008300'],
      ['B', '#E87BA4'],
      ['A', '#EDA100'],
      ['Smile', '#4A3AA7'],
      ['Splurge', '#1BAF7A'],
      ['Fire Extinguisher', '#EB6834'],
    ]);
    expect((await client.post('/api/buckets', { name: 'E' })).status).toBe(400);
  });

  it('renames and reorders every bucket; colours stay with their bucket', async () => {
    await client.post('/api/buckets', { name: 'Giving' });
    const current = await list();
    // A custom colour on Smile.
    await client.put('/api/buckets', { buckets: current.map((b) => ({ id: b.id, percentage: b.percentage, ...(b.name === 'Smile' ? { colour: '#123456' } : {}) })) });
    const res = await save([
      ['Bills', 50, 'Essentials'],
      ['Giving', 10],
      ['Smile', 10, 'Fun'],
      ['Splurge', 10],
      ['Fire Extinguisher', 20, 'Savings'],
    ]);
    expect(res.status).toBe(200);
    expect(res.body.items.map((b: B) => [b.name, b.role, b.percentage, b.colour])).toEqual([
      ['Essentials', 'BILLS', '50.00', '#2A78D6'],
      ['Giving', 'SPENDING', '10.00', '#EDA100'],
      ['Fun', 'SPENDING', '10.00', '#123456'],
      ['Splurge', 'SPENDING', '10.00', '#1BAF7A'],
      ['Savings', 'SAVING', '20.00', '#EB6834'],
    ]);
    // Renaming a rules bucket keeps its rules: savings still don't count as spending.
    expect((await client.get('/api/reports/spending?from=2026-10-01&to=2026-10-31')).body.byBucket.find((b: { name: string }) => b.name === 'Savings').isSaving).toBe(true);

    expect((await save([['Essentials', 50], ['Giving', 10], ['Fun', 10], ['Splurge', 10, 'fun'], ['Savings', 20]])).body.error.message).toMatch(/different name/);
  });

  it('removes a spending bucket, moving its categories, accounts and percentage', async () => {
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 100000, openingDate: '2026-09-01' });
    const splurge = await byName('Splurge');
    const smile = await byName('Smile');
    const fun = await createAccount(client, { name: 'Fun money', type: 'SAVINGS', openingBalanceCents: 0, openingDate: '2026-09-01', bucketTagId: splurge.id });
    await client.post('/api/transactions', { type: 'EXPENSE', date: '2026-10-02', amountCents: 4500, description: 'Coffee beans', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Coffee'), amountCents: 4500 }] });

    const res = await client.request('DELETE', `/api/buckets/${splurge.id}`, { moveTo: smile.id });
    expect(res.status).toBe(200);
    expect(res.body.movedCategories).toBeGreaterThan(5);
    expect(res.body.items.map((b: B) => [b.name, b.percentage, b.colour])).toEqual([
      ['Bills', '60.00', '#2A78D6'],
      ['Smile', '20.00', '#4A3AA7'],
      ['Fire Extinguisher', '20.00', '#EB6834'],
    ]);
    // The coffee spending now shows under Smile, and the account tag followed.
    const spending = (await client.get('/api/reports/spending?from=2026-10-01&to=2026-10-31')).body;
    expect(spending.byBucket.find((b: { name: string }) => b.name === 'Smile').amountCents).toBe(4500);
    expect((await client.get(`/api/accounts/${fun.id}`)).body.bucketTagId).toBe(smile.id);
    // Budget and dashboard work with three buckets, and allocations still add up.
    const dash = (await client.get('/api/dashboard')).body;
    expect(dash.buckets).toHaveLength(3);
  });

  it('never removes the Bills or saving bucket, whatever they are called', async () => {
    const all = await list();
    const bills = all.find((b) => b.role === 'BILLS')!;
    const saving = all.find((b) => b.role === 'SAVING')!;
    const smile = all.find((b) => b.name === 'Smile')!;
    expect((await client.request('DELETE', `/api/buckets/${bills.id}`, { moveTo: smile.id })).body.error.message).toMatch(/can be renamed but not removed/);
    expect((await client.request('DELETE', `/api/buckets/${saving.id}`, { moveTo: smile.id })).status).toBe(400);
    expect((await client.request('DELETE', `/api/buckets/${smile.id}`, { moveTo: smile.id })).status).toBe(400);
    // Down to the two required buckets is fine.
    await client.request('DELETE', `/api/buckets/${smile.id}`, { moveTo: bills.id });
    await client.request('DELETE', `/api/buckets/${(await byName('Splurge')).id}`, { moveTo: bills.id });
    expect((await list()).map((b) => [b.name, b.percentage, b.colour])).toEqual([
      ['Bills', '80.00', '#2A78D6'],
      ['Fire Extinguisher', '20.00', '#EB6834'],
    ]);
  });

  it('splits income exactly across any number of buckets', async () => {
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 0, openingDate: '2026-09-01' });
    for (const name of ['Kids', 'Giving', 'Travel']) await client.post('/api/buckets', { name });
    await save([['Bills', '45.55'], ['Smile', '9.15'], ['Kids', '10.10'], ['Giving', '5.05'], ['Travel', '5.05'], ['Splurge', '5.10'], ['Fire Extinguisher', '20.00']]);
    await client.post('/api/transactions', { type: 'INCOME', date: '2026-10-02', amountCents: 333333, description: 'Pay', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Salary and wages'), amountCents: 333333 }] });
    const dash = (await client.get('/api/dashboard?basis=ACTUAL')).body;
    expect(dash.buckets).toHaveLength(7);
    expect(dash.buckets.reduce((s: number, b: { allocatedCents: number }) => s + b.allocatedCents, 0)).toBe(333333);
  });

  it('keeps buckets to their household', async () => {
    const other = (await registerUser(app)).client;
    const theirs = (await other.get('/api/buckets')).body.items.find((b: B) => b.name === 'Smile');
    const mine = await byName('Bills');
    expect((await client.request('DELETE', `/api/buckets/${theirs.id}`, { moveTo: mine.id })).status).toBe(404);
    const smile = await byName('Smile');
    expect((await client.request('DELETE', `/api/buckets/${smile.id}`, { moveTo: theirs.id })).status).toBe(404);
  });
});
