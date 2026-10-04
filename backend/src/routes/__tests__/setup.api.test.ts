import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bucketIds, categoryId, createTestApp, registerUser, resetDatabase } from '../../test/helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  await resetDatabase();
  app = await createTestApp();
});
afterEach(async () => {
  await app.close();
});

describe('buckets', () => {
  it('updates percentages only when they total 100%', async () => {
    const { client } = await registerUser(app);
    const ids = await bucketIds(client);
    const bad = await client.put('/api/buckets', {
      buckets: [
        { id: ids.BILLS, percentage: 60 },
        { id: ids.SMILE, percentage: 10 },
        { id: ids.SPLURGE, percentage: 10 },
        { id: ids.FIRE_EXTINGUISHER, percentage: 15 },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/total 100\.00%.*95\.00%/);

    const ok = await client.put('/api/buckets', {
      buckets: [
        { id: ids.BILLS, percentage: '55.50', name: 'Bills & essentials' },
        { id: ids.SMILE, percentage: 12.5 },
        { id: ids.SPLURGE, percentage: 12 },
        { id: ids.FIRE_EXTINGUISHER, percentage: 20 },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.items.map((b: { percentage: string }) => b.percentage)).toEqual(['55.50', '12.50', '12.00', '20.00']);
    expect(ok.body.items[0].name).toBe('Bills & essentials');
  });

  it('needs every bucket in the update', async () => {
    const { client } = await registerUser(app);
    const ids = await bucketIds(client);
    const res = await client.put('/api/buckets', { buckets: [{ id: ids.BILLS, percentage: 100 }] });
    expect(res.status).toBe(400);
  });
});

describe('categories', () => {
  it('creates categories that inherit their group bucket', async () => {
    const { client } = await registerUser(app);
    const cats = (await client.get('/api/categories')).body.items;
    const food = cats.find((c: { name: string; isGroup: boolean }) => c.name === 'Food' && c.isGroup);
    const res = await client.post('/api/categories', { name: 'Baby formula', kind: 'EXPENSE', parentId: food.id });
    expect(res.status).toBe(201);
    expect(res.body.bucketId).toBe(food.bucketId);

    const dup = await client.post('/api/categories', { name: 'Baby formula', kind: 'EXPENSE', parentId: food.id });
    expect(dup.status).toBe(409);

    const income = await client.post('/api/categories', { name: 'Rental income', kind: 'INCOME', bucketId: food.bucketId });
    expect(income.status).toBe(400);
  });

  it('asks for confirmation before moving a category to another bucket', async () => {
    const { client } = await registerUser(app);
    const ids = await bucketIds(client);
    const coffee = await categoryId(client, 'Coffee');
    const res = await client.put(`/api/categories/${coffee}`, { bucketId: ids.SMILE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUCKET_CHANGE_CONFIRMATION_REQUIRED');

    const ok = await client.put(`/api/categories/${coffee}`, { bucketId: ids.SMILE, confirmBucketChange: true });
    expect(ok.status).toBe(200);
    expect(ok.body.bucketId).toBe(ids.SMILE);
    expect(ok.body.parentId).toBeNull(); // left the Splurge group
  });

  it('moves a group with its children', async () => {
    const { client } = await registerUser(app);
    const ids = await bucketIds(client);
    const cats = (await client.get('/api/categories')).body.items;
    const subs = cats.find((c: { name: string }) => c.name === 'Subscriptions');
    await client.put(`/api/categories/${subs.id}`, { bucketId: ids.SPLURGE, confirmBucketChange: true });
    const after = (await client.get('/api/categories')).body.items;
    for (const c of after.filter((c: { parentId: string }) => c.parentId === subs.id)) expect(c.bucketId).toBe(ids.SPLURGE);
  });

  it('hides disabled categories from the default list but keeps them', async () => {
    const { client } = await registerUser(app);
    const golf = await categoryId(client, 'Golf');
    await client.put(`/api/categories/${golf}`, { isActive: false });
    const active = (await client.get('/api/categories')).body.items;
    expect(active.some((c: { id: string }) => c.id === golf)).toBe(false);
    const all = (await client.get('/api/categories?includeInactive=true')).body.items;
    expect(all.find((c: { id: string }) => c.id === golf).isActive).toBe(false);
  });

  it('deletes unused categories, blocks used ones, and reassigns on request', async () => {
    const { client } = await registerUser(app);
    const acct = (await client.post('/api/accounts', { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 0, openingDate: '2026-01-01' })).body;
    const snacks = await categoryId(client, 'Snacks');
    const groceries = await categoryId(client, 'Groceries');
    const golf = await categoryId(client, 'Golf');
    expect((await client.delete(`/api/categories/${golf}`)).status).toBe(204);

    const tx = await client.post('/api/transactions', {
      date: '2026-10-01', description: 'Chips', amountCents: 450, type: 'EXPENSE', accountId: acct.id,
      splits: [{ categoryId: snacks, amountCents: 450 }],
    });
    expect(tx.status).toBe(201);
    const blocked = await client.delete(`/api/categories/${snacks}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_IN_USE');

    const salary = await categoryId(client, 'Bonus');
    expect((await client.delete(`/api/categories/${snacks}?reassignTo=${salary}`)).status).toBe(400);
    expect((await client.delete(`/api/categories/${snacks}?reassignTo=${groceries}`)).status).toBe(204);
    const moved = await client.get(`/api/transactions/${tx.body.id}`);
    expect(moved.body.splits[0].categoryId).toBe(groceries);
  });

  it('protects the system categories the rules rely on', async () => {
    const { client } = await registerUser(app);
    const fees = await categoryId(client, 'Interest and fees');
    expect((await client.delete(`/api/categories/${fees}`)).body.error.code).toBe('SYSTEM_CATEGORY');
    expect((await client.put(`/api/categories/${fees}`, { isActive: false })).body.error.code).toBe('SYSTEM_CATEGORY');
    expect((await client.put(`/api/categories/${fees}`, { name: 'Card interest and fees' })).status).toBe(200);
  });

  it('will not delete a group that still has categories', async () => {
    const { client } = await registerUser(app);
    const cats = (await client.get('/api/categories')).body.items;
    const health = cats.find((c: { name: string; isGroup: boolean }) => c.name === 'Health' && c.isGroup);
    expect((await client.delete(`/api/categories/${health.id}`)).body.error.code).toBe('GROUP_NOT_EMPTY');
  });
});

describe('settings', () => {
  it('reads and updates household settings with Australian defaults', async () => {
    const { client } = await registerUser(app);
    const s = (await client.get('/api/settings')).body;
    expect(s).toMatchObject({ currency: 'AUD', locale: 'en-AU', fyStartMonth: 7, weekStartDay: 1, budgetPeriodType: 'MONTHLY', amberThreshold: 90, redThreshold: 100 });
    expect(s.budgetAnchorDate).toMatch(/^\d{4}-\d{2}-01$/);

    const updated = await client.put('/api/settings', { currency: 'nzd', locale: 'en-NZ', timezone: 'Pacific/Auckland', amberThreshold: 85.5 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ currency: 'NZD', locale: 'en-NZ', timezone: 'Pacific/Auckland', amberThreshold: 85.5 });

    expect((await client.put('/api/settings', { timezone: 'Mars/Base' })).status).toBe(400);
    expect((await client.put('/api/settings', { currency: 'XXY' })).status).toBe(400);
    expect((await client.put('/api/settings', { amberThreshold: 120 })).status).toBe(400);
  });
});
