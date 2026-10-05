import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createTestApp, resetDatabase, TestClock } from '../../test/helpers.js';
import { seedDemo, type DemoResult } from '../demo.js';

let app: FastifyInstance;
let demo: DemoResult;
let client: Client;
const clock = new TestClock();

beforeAll(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-05T01:00:00Z');
  // Production limits: the seed must not trip the API rate limit.
  app = await createTestApp({ clock, env: { ALLOW_REGISTRATION: 'false' }, rateLimits: { api: 300, auth: 5 } });
  demo = await seedDemo(app);
  client = new Client(app);
  expect((await client.post('/api/auth/login', { email: demo.email, password: demo.password })).status).toBe(200);
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('demo household', () => {
  it('has a year of transactions and nothing left overdue', async () => {
    expect(demo.transactions).toBeGreaterThan(500);
    const occ = (await client.get('/api/recurring-transactions/occurrences?from=2025-10-01&to=2026-10-04')).body.items;
    expect(occ.filter((o: { status: string }) => o.status === 'overdue')).toEqual([]);
    const tx = (await client.get('/api/transactions?from=2025-10-01&to=2025-10-31&pageSize=5')).body;
    expect(tx.items.length).toBeGreaterThan(0);
  });

  it('fills every page with data', async () => {
    const dash = (await client.get('/api/dashboard')).body;
    expect(dash.income.plannedCents).toBeGreaterThan(1_000_000);
    const accounts = (await client.get('/api/accounts')).body.items;
    expect(accounts.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining(['Everyday', 'Visa', 'Home loan', 'Offset', 'Super']));
    expect(accounts.find((a: { name: string }) => a.name === 'Everyday').balanceCents).toBeGreaterThan(0);
    expect((await client.get('/api/sinking-funds')).body.items).toHaveLength(3);
    expect((await client.get('/api/goals')).body.items).toHaveLength(2);
    const debts = (await client.get('/api/debts')).body.items;
    expect(debts).toHaveLength(4);
    expect(debts.map((d: { accountName: string; warning: string | null }) => [d.accountName, d.warning])).toEqual(debts.map((d: { accountName: string }) => [d.accountName, null]));
    const nw = (await client.get('/api/reports/net-worth?from=2025-10-01&to=2026-10-05')).body;
    expect(nw.series.at(-1).netWorthCents).toBeGreaterThan(0);
    const visa = debts.find((d: { accountName: string }) => d.accountName === 'Visa');
    expect(visa.currentBalanceCents).toBeLessThan(500_000); // paid off monthly
    const spending = (await client.get('/api/reports/spending?from=2025-10-01&to=2026-09-30')).body;
    expect(spending.byBucket.length).toBeGreaterThan(2);
    expect((await client.get('/api/reports/forecast?months=3')).status).toBe(200);
    const budget = (await client.get('/api/budgets')).body.items[0];
    const summary = (await client.get(`/api/budgets/${budget.id}/summary`)).body;
    expect(summary.total.budgetCents).toBeGreaterThan(0);
    expect((await client.get('/api/onboarding')).body.steps.every((s: { done: boolean }) => s.done)).toBe(true);
  });

  it('is the same every time (deterministic)', async () => {
    const total = (await client.get('/api/reports/spending?from=2025-10-01&to=2026-09-30')).body.totalCents;
    expect(typeof total).toBe('number');
    expect(total).toMatchSnapshot();
  });
});
