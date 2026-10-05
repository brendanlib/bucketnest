import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { categoryId, Client, createAccount, createTestApp, FakeMailer, PASSWORD, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';

let app: FastifyInstance;
let client: Client;
let main: { id: string };
let householdId: string;
const clock = new TestClock();
const mailer = new FakeMailer();

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-15T01:00:00Z');
  mailer.sent = [];
  app = await createTestApp({ clock, mailer });
  ({ client } = await registerUser(app));
  main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 1000000, openingDate: '2026-09-01' });
  householdId = (await client.get('/api/settings')).body.id;
});
afterEach(async () => {
  await app.close();
});

const generate = () => app.services.notifications.generate(householdId);
const list = async () => (await client.get('/api/notifications')).body;

describe('notifications (spec §14)', () => {
  beforeEach(async () => {
    // Some September spending, so October has a last period to review.
    await client.post('/api/transactions', { type: 'EXPENSE', date: '2026-09-20', amountCents: 4200, description: 'Shop', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Groceries'), amountCents: 4200 }] });
  });

  it('alerts for a bill due within N days, once', async () => {
    await client.post('/api/recurring-transactions', { name: 'Netflix', type: 'EXPENSE', amountCents: 2500, frequency: 'MONTHLY', startDate: '2026-10-17', accountId: main.id, categoryId: await categoryId(client, 'Streaming services') });
    await client.post('/api/recurring-transactions', { name: 'Later', type: 'EXPENSE', amountCents: 2500, frequency: 'MONTHLY', startDate: '2026-10-25', accountId: main.id, categoryId: await categoryId(client, 'Music') });
    await client.post('/api/recurring-transactions', { name: 'Auto', type: 'EXPENSE', autoPost: true, amountCents: 100, frequency: 'MONTHLY', startDate: '2026-10-16', accountId: main.id, categoryId: await categoryId(client, 'Software') });
    expect((await generate()).created).toBeGreaterThanOrEqual(1);
    const bills = (await list()).items.filter((n: { type: string }) => n.type === 'UPCOMING_BILL');
    expect(bills).toEqual([expect.objectContaining({ title: 'Netflix is due in 2 days', body: '$25.00 on 17 Oct from Main.', link: '/bills', read: false })]);
    expect((await generate()).created).toBe(0); // unique (type, subject, period)
  });

  it('alerts when a category reaches amber, then again at red', async () => {
    const budget = (await client.get('/api/budgets')).body.items[0];
    const groceries = await categoryId(client, 'Groceries');
    await client.put(`/api/budgets/${budget.id}/items/${groceries}`, { amountCents: 10000, enteredFrequency: 'MONTHLY' });
    await client.post('/api/transactions', { date: '2026-10-02', description: 'Shop', amountCents: 9200, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: groceries, amountCents: 9200 }] });
    await generate();
    await client.post('/api/transactions', { date: '2026-10-03', description: 'Shop', amountCents: 1000, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: groceries, amountCents: 1000 }] });
    await generate();
    await generate();
    const over = (await list()).items.filter((n: { type: string }) => n.type === 'OVERSPENDING').map((n: { title: string }) => n.title);
    expect(over.sort()).toEqual(['Groceries is at 92% of its budget', 'Groceries is over budget']); // same test clock, so compare as a set
  });

  it('starts each budget period with a review, once there is a last period to review', async () => {
    const fresh = await registerUser(app);
    const freshId = (await fresh.client.get('/api/settings')).body.id;
    await createAccount(fresh.client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 1000000, openingDate: '2026-09-01' });
    await app.services.notifications.generate(freshId);
    expect(await testDb().notification.count({ where: { householdId: freshId, type: 'BUDGET_REVIEW' } })).toBe(0); // nothing planned, spent or earned before

    const reviews = () => testDb().notification.findMany({ where: { householdId, type: 'BUDGET_REVIEW' }, orderBy: { createdAt: 'asc' } });
    await generate();
    expect(await reviews()).toEqual([expect.objectContaining({ title: 'A new budget period has started', body: expect.stringContaining('Last period you spent $42.00'), periodKey: '2026-10-01' })]);
    clock.current = new Date('2026-10-20T01:00:00Z');
    await generate();
    expect(await reviews()).toHaveLength(1);
    clock.current = new Date('2026-11-01T01:00:00Z');
    await generate();
    expect((await reviews()).map((r) => r.periodKey)).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('alerts for sinking funds due within N days and goal milestones (when on)', async () => {
    await client.post('/api/sinking-funds', { name: 'Rego', targetCents: 90000, dueDate: '2026-10-25', contributionFrequency: 'WEEKLY', manualCurrentCents: 30000 });
    await client.post('/api/sinking-funds', { name: 'Far off', targetCents: 90000, dueDate: '2027-10-25', contributionFrequency: 'WEEKLY' });
    await client.post('/api/goals', { name: 'Holiday', type: 'SAVINGS', targetCents: 100000, manualCurrentCents: 60000 });
    await generate();
    let items = (await list()).items;
    expect(items.filter((n: { type: string }) => n.type === 'SINKING_FUND_DEADLINE').map((n: { title: string }) => n.title)).toEqual(['Rego is due 25 Oct']);
    expect(items.some((n: { type: string }) => n.type === 'GOAL_MILESTONE')).toBe(false); // off by default

    const settings = (await client.get('/api/notifications/settings')).body;
    expect(settings).toMatchObject({ emailAvailable: true });
    const next = settings.items.map((s: { type: string }) => (s.type === 'GOAL_MILESTONE' ? { ...s, enabled: true } : s));
    await client.put('/api/notifications/settings', { items: next });
    await generate();
    items = (await list()).items;
    expect(items.find((n: { type: string }) => n.type === 'GOAL_MILESTONE').title).toBe('Holiday is 50% of the way there');
  });

  it('respects settings: off, days before, and email', async () => {
    await client.post('/api/recurring-transactions', { name: 'Netflix', type: 'EXPENSE', amountCents: 2500, frequency: 'MONTHLY', startDate: '2026-10-22', accountId: main.id, categoryId: await categoryId(client, 'Streaming services') });
    await generate();
    expect((await list()).items.some((n: { type: string }) => n.type === 'UPCOMING_BILL')).toBe(false); // 7 days out, default is 3

    const items = (await client.get('/api/notifications/settings')).body.items.map((s: { type: string }) =>
      s.type === 'UPCOMING_BILL' ? { ...s, daysBefore: 7, emailEnabled: true } : { ...s, enabled: false },
    );
    expect((await client.put('/api/notifications/settings', { items: [{ ...items[0], daysBefore: 99 }] })).status).toBe(400);
    await client.put('/api/notifications/settings', { items });
    const second = await generate();
    expect(second.created).toBe(1); // only the bill: every other type is now off
    const all = (await list()).items;
    expect(all.map((n: { type: string }) => n.type).sort()).toEqual(['BUDGET_REVIEW', 'UPCOMING_BILL']); // the review came from the first run
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ subject: 'Netflix is due in 7 days' });
    expect(mailer.sent[0]!.text).toContain('http://localhost:5173/bills');
    expect((await testDb().notification.findFirstOrThrow({ where: { type: 'UPCOMING_BILL' } })).emailedAt).not.toBeNull();
    expect((await testDb().notification.findFirstOrThrow({ where: { type: 'BUDGET_REVIEW' } })).emailedAt).toBeNull();
  });

  it('marks notifications read', async () => {
    await generate();
    const before = await list();
    expect(before.unreadCount).toBeGreaterThan(0);
    expect((await client.post(`/api/notifications/${before.items[0].id}/read`)).status).toBe(204);
    expect((await list()).unreadCount).toBe(before.unreadCount - 1);
    await client.post('/api/notifications/read-all');
    expect((await list()).unreadCount).toBe(0);
    expect((await client.get('/api/notifications?unreadOnly=true')).body.items).toEqual([]);

    const other = (await registerUser(app)).client;
    expect((await other.post(`/api/notifications/${before.items[0].id}/read`)).status).toBe(404);
    const theirs = (await other.get('/api/notifications')).body.items.map((n: { id: string }) => n.id);
    expect(theirs).not.toContain(before.items[0].id);
  });

  it('refreshes alerts whenever the list is opened', async () => {
    const bills = async () => (await list()).items.filter((n: { type: string }) => n.type === 'UPCOMING_BILL');
    expect(await bills()).toEqual([]);
    await client.post('/api/recurring-transactions', { name: 'Netflix', type: 'EXPENSE', amountCents: 2500, frequency: 'MONTHLY', startDate: '2026-10-17', accountId: main.id, categoryId: await categoryId(client, 'Streaming services') });
    const [a, b] = await Promise.all([bills(), bills()]); // concurrent looks share one run: no duplicates
    expect(a).toEqual([expect.objectContaining({ title: 'Netflix is due in 2 days' })]);
    expect(b).toHaveLength(1);
  });

  it('runs as a scheduled job for every household', async () => {
    const { buildJobs } = await import('../../jobs/index.js');
    const job = buildJobs(app).find((j) => j.name === 'notifications')!;
    expect(await job.run()).toMatchObject({ created: expect.any(Number) });
  });
});

describe('data export and deletion (spec §14)', () => {
  it('exports everything as JSON, without secrets', async () => {
    await client.post('/api/transactions', { date: '2026-10-02', description: 'Shop', amountCents: 4200, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Groceries'), amountCents: 4200 }] });
    const res = await client.get('/api/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/home-budget-export-.*\.json/);
    const data = res.body;
    expect(data).toMatchObject({ format: 'home-budget-export', version: 1, household: { currency: 'AUD' } });
    expect(data.accounts[0]).toMatchObject({ name: 'Main', balanceCents: 995800 });
    expect(data.transactions[0].splits[0]).toMatchObject({ category: 'Groceries', amountCents: 4200 });
    expect(data.buckets).toHaveLength(4);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/argon2|password|token_hash|tokenHash/i);
  });

  it('exports each kind of record as CSV', async () => {
    await client.post('/api/transactions', { date: '2026-10-02', description: 'Shop, big', amountCents: 4200, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Groceries'), amountCents: 4200 }] });
    const cookie = [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const tx = await app.inject({ method: 'GET', url: '/api/export?format=csv&entity=transactions', headers: { cookie } });
    expect(tx.headers['content-type']).toContain('text/csv');
    expect(tx.body.split('\r\n')[1]).toBe('2026-10-02,"Shop, big",,EXPENSE,Main,,42.00,Groceries,Bills,42.00,no,');
    for (const entity of ['accounts', 'categories', 'budget', 'recurring', 'sinking-funds', 'goals', 'debts', 'assets', 'rules']) {
      const r = await app.inject({ method: 'GET', url: `/api/export?format=csv&entity=${entity}`, headers: { cookie } });
      expect(r.statusCode, entity).toBe(200);
    }
  });

  it('deletes the household for the owner, with confirmation', async () => {
    const name = (await client.get('/api/settings')).body.name;
    expect((await client.request('DELETE', '/api/household', { confirmName: 'nope', password: PASSWORD })).body.error.message).toMatch(/household name/);
    expect((await client.request('DELETE', '/api/household', { confirmName: name, password: 'wrong password here' })).body.error.message).toMatch(/Password/);
    const keep = await registerUser(app);
    const res = await client.request('DELETE', '/api/household', { confirmName: name, password: PASSWORD });
    expect(res.status).toBe(204);
    expect(await testDb().household.count({ where: { id: householdId } })).toBe(0);
    expect(await testDb().account.count({ where: { householdId } })).toBe(0);
    expect((await client.get('/api/auth/me')).status).toBe(401);
    expect(await testDb().user.count()).toBe(1); // the other household's user remains
    expect((await keep.client.get('/api/auth/me')).status).toBe(200);
  });

  it('refuses deletion by a non-owner', async () => {
    const member = await testDb().user.create({ data: { email: 'member@example.com', name: 'M', passwordHash: (await testDb().user.findFirstOrThrow()).passwordHash } });
    await testDb().householdMember.create({ data: { householdId, userId: member.id, role: 'MEMBER' } });
    await testDb().householdMember.deleteMany({ where: { userId: member.id, householdId: { not: householdId } } });
    const c = new Client(app);
    await c.post('/api/auth/login', { email: 'member@example.com', password: PASSWORD });
    const res = await c.request('DELETE', '/api/household', { confirmName: 'x', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_OWNER');
  });
});
