import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, TestClock } from '../../test/helpers.js';

let app: FastifyInstance;
let client: Client;
let main: { id: string };
const clock = new TestClock(new Date('2026-10-15T01:00:00Z')); // 15 Oct, 12:00 in Melbourne

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-15T01:00:00Z');
  app = await createTestApp({ clock });
  ({ client } = await registerUser(app));
  main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 1000000 });
});
afterEach(async () => {
  await app.close();
});

const activeBudget = async () => (await client.get('/api/budgets')).body.items.find((b: { isActive: boolean }) => b.isActive);
const spend = async (date: string, categoryName: string, amountCents: number, type = 'EXPENSE') =>
  client.post('/api/transactions', { date, description: categoryName, amountCents, type, accountId: main.id, splits: [{ categoryId: await categoryId(client, categoryName), amountCents }] });

describe('budgets', () => {
  it('creates one active monthly budget per household on first use', async () => {
    const [a, b] = await Promise.all([client.get('/api/budgets'), client.get('/api/dashboard')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const list = (await client.get('/api/budgets')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Household budget', periodType: 'MONTHLY', isActive: true, anchorDate: '2026-10-01' });
  });

  it('converts items from the entered frequency to the period', async () => {
    const budget = await activeBudget();
    const rego = await categoryId(client, 'Car registration (rego)');
    const groceries = await categoryId(client, 'Groceries');
    await client.put(`/api/budgets/${budget.id}/items/${rego}`, { amountCents: 90000, enteredFrequency: 'ANNUALLY' });
    const res = await client.put(`/api/budgets/${budget.id}/items/${groceries}`, { amountCents: 20000, enteredFrequency: 'WEEKLY', notes: 'big family' });
    expect(res.status).toBe(200);
    const items = Object.fromEntries(res.body.items.map((i: { categoryId: string; periodAmountCents: number }) => [i.categoryId, i.periodAmountCents]));
    expect(items[rego]).toBe(7500); // $900 a year = $75 a month
    expect(items[groceries]).toBe(86667); // $200 × 52 ÷ 12
    expect((await client.put(`/api/budgets/${budget.id}/items/${groceries}`, { amountCents: 100, enteredFrequency: 'EVERY_N_WEEKS' })).status).toBe(400);
    expect((await client.delete(`/api/budgets/${budget.id}/items/${rego}`)).body.items).toHaveLength(1);
  });

  it('summarises budget vs actual for the period (spec §9 example)', async () => {
    const budget = await activeBudget();
    const groceries = await categoryId(client, 'Groceries');
    await client.put(`/api/budgets/${budget.id}/items/${groceries}`, { amountCents: 80000, enteredFrequency: 'MONTHLY', notes: 'weekly shop' });
    await spend('2026-10-03', 'Groceries', 50000);
    await spend('2026-10-10', 'Groceries', 24200);
    await spend('2026-09-30', 'Groceries', 99999); // previous period
    await spend('2026-10-05', 'Coffee', 4500); // unbudgeted
    await client.post('/api/transactions', { date: '2026-10-06', description: 'Return', amountCents: 2000, type: 'REFUND', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Coffee'), amountCents: 2000 }] });

    const res = await client.get(`/api/budgets/${budget.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.period).toMatchObject({ start: '2026-10-01', end: '2026-10-31', previousStart: '2026-09-01', nextStart: '2026-11-01', isCurrent: true });
    const bills = res.body.buckets.find((b: { key: string }) => b.key === 'BILLS');
    const line = bills.groups.flatMap((g: { lines: unknown[] }) => g.lines).find((l: { categoryId: string }) => l.categoryId === groceries);
    expect(line).toMatchObject({ budgetCents: 80000, actualCents: 74200, remainingCents: 5800, percentUsed: 92.75, status: 'amber', hasItem: true });
    const splurge = res.body.buckets.find((b: { key: string }) => b.key === 'SPLURGE');
    expect(splurge.groups[0].lines[0]).toMatchObject({ name: 'Coffee', actualCents: 2500, status: 'unbudgeted', percentUsed: null });
    expect(res.body.total).toMatchObject({ budgetCents: 80000, actualCents: 76700 });

    const prev = await client.get(`/api/budgets/${budget.id}/summary?period=2026-09-15`);
    expect(prev.body.period.start).toBe('2026-09-01');
    expect(prev.body.total.actualCents).toBe(99999);
  });

  it('excludes accounts that are not in the budget', async () => {
    const budget = await activeBudget();
    const sup = await createAccount(client, { name: 'Super', type: 'SUPERANNUATION' });
    await client.post('/api/transactions', { date: '2026-10-03', description: 'Fee', amountCents: 5000, type: 'EXPENSE', accountId: sup.id, splits: [{ categoryId: await categoryId(client, 'Bank fees'), amountCents: 5000 }] });
    expect((await client.get(`/api/budgets/${budget.id}/summary`)).body.total.actualCents).toBe(0);
  });

  it('allocates planned income from schedules with largest remainder and flags over-allocation', async () => {
    const budget = await activeBudget();
    await client.post('/api/recurring-transactions', {
      name: 'Salary', type: 'INCOME', amountCents: 350000, frequency: 'FORTNIGHTLY', startDate: '2026-09-24',
      accountId: main.id, categoryId: await categoryId(client, 'Salary and wages'),
    });
    const rent = await categoryId(client, 'Rent');
    await client.put(`/api/budgets/${budget.id}/items/${rent}`, { amountCents: 500000, enteredFrequency: 'MONTHLY' });

    const res = await client.get(`/api/budgets/${budget.id}/summary`);
    expect(res.body.income).toMatchObject({ plannedCents: 758333, plannedSource: 'schedules', allocationBasis: 'PLANNED', allocationIncomeCents: 758333 });
    expect(res.body.income.expected).toEqual({ weekly: 175000, fortnightly: 350000, monthly: 758333, annual: 9100000 });
    const alloc = res.body.buckets.map((b: { allocatedCents: number }) => b.allocatedCents);
    expect(alloc.reduce((a: number, b: number) => a + b, 0)).toBe(758333);
    expect(alloc).toEqual([455000, 75833, 75833, 151667]);
    const bills = res.body.buckets[0];
    expect(bills.overAllocatedCents).toBe(500000 - 455000);

    // Actual basis uses income received: none yet.
    const actual = await client.get(`/api/budgets/${budget.id}/summary?basis=ACTUAL`);
    expect(actual.body.income.allocationIncomeCents).toBe(0);
  });

  it('uses budgeted income lines when there are no income schedules', async () => {
    const budget = await activeBudget();
    const salary = await categoryId(client, 'Salary and wages');
    await client.put(`/api/budgets/${budget.id}/items/${salary}`, { amountCents: 500000, enteredFrequency: 'MONTHLY' });
    const res = await client.get(`/api/budgets/${budget.id}/summary`);
    expect(res.body.income).toMatchObject({ plannedCents: 500000, plannedSource: 'budget' });
    expect(res.body.buckets.map((b: { allocatedCents: number }) => b.allocatedCents)).toEqual([300000, 50000, 50000, 100000]);
    expect(res.body.incomeLines).toEqual([{ categoryId: salary, name: 'Salary and wages', budgetCents: 500000, actualCents: 0 }]);
  });

  it('includes every category on request, for planning', async () => {
    const budget = await activeBudget();
    const res = await client.get(`/api/budgets/${budget.id}/summary?includeEmpty=true`);
    const lines = res.body.buckets.flatMap((b: { groups: { lines: unknown[] }[] }) => b.groups.flatMap((g) => g.lines));
    expect(lines.length).toBeGreaterThan(80);
  });

  it('copies, activates and deletes budgets; settings follow the active budget', async () => {
    const budget = await activeBudget();
    const rent = await categoryId(client, 'Rent');
    await client.put(`/api/budgets/${budget.id}/items/${rent}`, { amountCents: 200000, enteredFrequency: 'MONTHLY' });
    const copy = await client.post(`/api/budgets/${budget.id}/copy`, { name: 'Lean times' });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ name: 'Lean times', isActive: false });
    expect(copy.body.items).toHaveLength(1);

    const activated = await client.put(`/api/budgets/${copy.body.id}`, { isActive: true, periodType: 'FORTNIGHTLY', anchorDate: '2026-09-24' });
    expect(activated.body.isActive).toBe(true);
    const settings = (await client.get('/api/settings')).body;
    expect(settings).toMatchObject({ budgetPeriodType: 'FORTNIGHTLY', budgetAnchorDate: '2026-09-24' });
    expect((await client.delete(`/api/budgets/${copy.body.id}`)).body.error.code).toBe('ACTIVE_BUDGET');
    expect((await client.delete(`/api/budgets/${budget.id}`)).status).toBe(204);

    // Settings change the active budget's period too.
    await client.put('/api/settings', { budgetPeriodType: 'WEEKLY', budgetAnchorDate: '2026-10-12' });
    const active = await activeBudget();
    expect(active).toMatchObject({ periodType: 'WEEKLY', anchorDate: '2026-10-12' });
    const summary = await client.get(`/api/budgets/${active.id}/summary`);
    expect(summary.body.period).toMatchObject({ start: '2026-10-12', end: '2026-10-18' });
  });
});
