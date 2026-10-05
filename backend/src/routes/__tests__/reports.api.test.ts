import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bucketIds, categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';

let app: FastifyInstance;
let client: Client;
let main: { id: string };
const clock = new TestClock();

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-04-15T01:00:00Z'); // 15 Apr 2026, Melbourne
  app = await createTestApp({ clock });
  ({ client } = await registerUser(app));
  main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 1000000, openingDate: '2025-12-01' });
});
afterEach(async () => {
  await app.close();
});

const spend = async (date: string, category: string, amountCents: number, type = 'EXPENSE', accountId = main.id) =>
  client.post('/api/transactions', { date, description: category, amountCents, type, accountId, splits: [{ categoryId: await categoryId(client, category), amountCents }] });

describe('forecast (spec §12)', () => {
  it('averages completed months: Groceries $780, $820, $760 → $786.67 (spec §18)', async () => {
    await spend('2026-01-10', 'Groceries', 78000);
    await spend('2026-02-10', 'Groceries', 82000);
    await spend('2026-03-10', 'Groceries', 76000);
    await spend('2026-04-02', 'Groceries', 99999); // current month: never used
    const f = (await client.get('/api/reports/forecast?months=2')).body;
    expect(f).toMatchObject({ method: 'AVG3', months: ['2026-05', '2026-06'], historyMonths: 3, limitedHistory: false }); // history starts at the first transaction (Jan)
    expect(f.categories.find((c: { name: string }) => c.name === 'Groceries')).toMatchObject({ baseCents: 78667, months: [78667, 78667], limitedHistory: false });
    const bills = f.buckets.find((b: { key: string }) => b.key === 'BILLS');
    expect(bills.months).toEqual([78667, 78667]);
  });

  it('adds scheduled bills to the unscheduled average without counting them twice', async () => {
    const power = await categoryId(client, 'Electricity');
    const sched = (await client.post('/api/recurring-transactions', { name: 'Power', type: 'EXPENSE', amountCents: 45000, frequency: 'QUARTERLY', startDate: '2026-02-20', accountId: main.id, categoryId: power })).body;
    await client.post(`/api/recurring-transactions/${sched.id}/occurrences/2026-02-20/post`); // scheduled: excluded from the average
    await spend('2026-01-05', 'Electricity', 3000); // unscheduled top-ups
    await spend('2026-03-05', 'Electricity', 6000);
    const f = (await client.get('/api/reports/forecast?months=3')).body;
    const line = f.categories.find((c: { name: string }) => c.name === 'Electricity');
    // Average of unscheduled Jan–Mar = (3000 + 0 + 6000) / 3 = 3000; the quarterly bill lands in May.
    expect(line.baseCents).toBe(3000);
    expect(line.months).toEqual([48000, 3000, 3000]);
  });

  it('does not double-count history entered before its schedule existed', async () => {
    const loan = await createAccount(client, { name: 'Home loan', type: 'MORTGAGE', openingBalanceCents: 40000000, openingDate: '2025-12-01' });
    const salary = await categoryId(client, 'Salary and wages');
    for (const m of ['01', '02', '03']) {
      await client.post('/api/transactions', { date: `2026-${m}-15`, description: 'Mortgage', amountCents: 250000, type: 'DEBT_REPAYMENT', accountId: main.id, toAccountId: loan.id });
      await client.post('/api/transactions', { date: `2026-${m}-02`, description: 'Pay', amountCents: 500000, type: 'INCOME', accountId: main.id, splits: [{ categoryId: salary, amountCents: 500000 }] });
      await spend(`2026-${m}-10`, 'Groceries', 60000);
    }
    // The schedules are only set up now.
    await client.post('/api/recurring-transactions', { name: 'Mortgage', type: 'DEBT_REPAYMENT', amountCents: 250000, frequency: 'MONTHLY', startDate: '2026-04-15', accountId: main.id, toAccountId: loan.id });
    await client.post('/api/recurring-transactions', { name: 'Pay', type: 'INCOME', amountCents: 500000, frequency: 'MONTHLY', startDate: '2026-05-02', accountId: main.id, categoryId: salary });
    const f = (await client.get('/api/reports/forecast?months=1')).body;
    expect(f.categories.find((c: { name: string }) => c.name === 'Mortgage').months).toEqual([250000]);
    expect(f.categories.find((c: { name: string }) => c.name === 'Groceries').months).toEqual([60000]);
    expect(f.totals[0].incomeCents).toBe(500000);
    // Main: 1,000,000 − 3×(250,000 + 60,000) + 3×500,000 = 1,570,000 today; May adds pay − mortgage − groceries average.
    const acct = f.accounts.find((a: { name: string }) => a.name === 'Main');
    expect(acct.currentCents).toBe(1570000);
    expect(acct.monthEndCents).toEqual([1570000 + 500000 - 250000 - 250000 - 60000]); // includes 15 Apr mortgage still to come
  });

  it('flags limited history and supports per-category manual amounts', async () => {
    await spend('2026-03-10', 'Coffee', 9000);
    const coffee = await categoryId(client, 'Coffee');
    const f = (await client.get('/api/reports/forecast?months=1&method=AVG6')).body;
    expect(f.limitedHistory).toBe(true);
    expect(f.categories.find((c: { name: string }) => c.name === 'Coffee')).toMatchObject({ baseCents: 9000, limitedHistory: true }); // one completed month of history: March

    await client.put(`/api/categories/${coffee}`, { forecastMethod: 'MANUAL', forecastManualCents: 5000 });
    const manual = (await client.get('/api/reports/forecast?months=1')).body.categories.find((c: { name: string }) => c.name === 'Coffee');
    expect(manual).toMatchObject({ method: 'MANUAL', baseCents: 5000, limitedHistory: false });
    expect((await client.put(`/api/categories/${coffee}`, { forecastMethod: 'MANUAL' })).status).toBe(400);
  });

  it('projects income and account month-end balances', async () => {
    const salary = await categoryId(client, 'Salary and wages');
    await client.post('/api/recurring-transactions', { name: 'Pay', type: 'INCOME', amountCents: 300000, frequency: 'MONTHLY', startDate: '2026-01-28', accountId: main.id, categoryId: salary });
    await spend('2026-03-10', 'Groceries', 60000);
    const f = (await client.get('/api/reports/forecast?months=2')).body;
    expect(f.totals[0]).toMatchObject({ month: '2026-05', incomeCents: 300000 });
    const acct = f.accounts.find((a: { name: string }) => a.name === 'Main');
    // Today 940,000; May's end adds the pays on 28 Apr and 28 May, less the average unscheduled change (−60,000 in March, the only completed month).
    expect(acct.currentCents).toBe(940000);
    expect(acct.monthEndCents).toEqual([940000 + 600000 - 60000, 940000 + 900000 - 120000]);
  });
});

describe('spending reports', () => {
  it('reports spending by bucket, category and month, net of refunds', async () => {
    await spend('2026-03-01', 'Groceries', 20000);
    await spend('2026-03-05', 'Clothing', 15000);
    await spend('2026-03-06', 'Clothing', 5000, 'REFUND');
    await spend('2026-02-10', 'Dining out', 8000);
    const ids = await bucketIds(client);
    const em = await createAccount(client, { name: 'Emergency', type: 'SAVINGS', bucketTagId: ids.FIRE_EXTINGUISHER });
    await client.post('/api/transactions', { date: '2026-03-07', description: 'Save', amountCents: 10000, type: 'TRANSFER', accountId: main.id, toAccountId: em.id });

    const r = (await client.get('/api/reports/spending?from=2026-02-01&to=2026-03-31')).body;
    expect(r.totalCents).toBe(20000 + 10000 + 8000); // Fire Extinguisher saving is not spending
    expect(r.byBucket.map((b: { key: string; amountCents: number }) => [b.key, b.amountCents])).toEqual([
      ['BILLS', 20000],
      ['SMILE', 8000],
      ['SPLURGE', 10000],
      ['FIRE_EXTINGUISHER', 10000],
    ]);
    expect(r.byCategory.map((c: { name: string }) => c.name)).toEqual(['Groceries', 'Clothing', 'Dining out']);
    expect(r.monthly).toEqual([
      { month: '2026-02', totalCents: 8000, byBucket: { BILLS: 0, SMILE: 8000, SPLURGE: 0, FIRE_EXTINGUISHER: 0 } },
      { month: '2026-03', totalCents: 30000, byBucket: { BILLS: 20000, SMILE: 0, SPLURGE: 10000, FIRE_EXTINGUISHER: 10000 } },
    ]);

    const filtered = (await client.get(`/api/reports/spending?from=2026-02-01&to=2026-03-31&bucketId=${ids.SPLURGE}`)).body;
    expect(filtered.totalCents).toBe(10000);
    expect((await client.get('/api/reports/spending?from=2026-03-31&to=2026-02-01')).status).toBe(400);
  });

  it('folds the tail into Other after 15 categories', async () => {
    const names = ['Groceries', 'Rent', 'Fuel', 'Coffee', 'Clothing', 'Dining out', 'Takeaway', 'Gifts', 'Movies', 'Golf', 'Gaming', 'Snacks', 'Alcohol', 'Shoes', 'Electronics', 'Gadgets', 'Tolls'];
    for (const [i, n] of names.entries()) await spend('2026-03-02', n, 10000 - i * 100);
    const r = (await client.get('/api/reports/spending?from=2026-03-01&to=2026-03-31')).body;
    expect(r.byCategory).toHaveLength(16);
    expect(r.byCategory.at(-1)).toMatchObject({ categoryId: null, name: 'Other', amountCents: 8500 + 8400 });
  });

  it('reports income vs expenses with a savings rate', async () => {
    await spend('2026-03-01', 'Salary and wages', 500000, 'INCOME');
    await spend('2026-03-02', 'Groceries', 100000);
    const r = (await client.get('/api/reports/income-vs-expenses?from=2026-03-01&to=2026-03-31')).body;
    expect(r.monthly).toEqual([{ month: '2026-03', incomeCents: 500000, spendingCents: 100000, savedCents: 0, netCents: 400000, savingsRate: 80 }]);
    expect(r.totals.savingsRate).toBe(80);
  });

  it('exports every report as CSV', async () => {
    await spend('2026-03-02', 'Groceries', 12345);
    const csv = await app.inject({ method: 'GET', url: '/api/reports/spending?from=2026-03-01&to=2026-03-31&format=csv', headers: { cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('spending-by-category.csv');
    expect(csv.body).toBe('Category,Amount\r\nGroceries,123.45\r\n');
    for (const url of [
      '/api/reports/spending?from=2026-03-01&to=2026-03-31&format=csv&view=month',
      '/api/reports/spending?from=2026-03-01&to=2026-03-31&format=csv&view=bucket',
      '/api/reports/income-vs-expenses?from=2026-03-01&to=2026-03-31&format=csv',
      '/api/reports/budget-vs-actual?format=csv',
      '/api/reports/net-worth?from=2026-01-01&to=2026-03-31&format=csv',
      '/api/reports/debt-reduction?format=csv',
      '/api/reports/forecast?format=csv',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type'], url).toContain('text/csv');
      expect(res.body.split('\r\n')[0]!.length, url).toBeGreaterThan(3);
    }
  });

  it('reports budget vs actual by category and bucket', async () => {
    const budget = (await client.get('/api/budgets')).body.items[0];
    await client.put(`/api/budgets/${budget.id}/items/${await categoryId(client, 'Groceries')}`, { amountCents: 80000, enteredFrequency: 'MONTHLY' });
    await spend('2026-04-03', 'Groceries', 74200);
    const byCat = (await client.get('/api/reports/budget-vs-actual')).body;
    expect(byCat.rows).toEqual([expect.objectContaining({ name: 'Groceries', budgetCents: 80000, actualCents: 74200, percentUsed: 92.75 })]);
    const byBucket = (await client.get('/api/reports/budget-vs-actual?groupBy=bucket')).body;
    expect(byBucket.rows.map((r: { name: string }) => r.name)).toEqual(['Bills', 'Smile', 'Splurge', 'Fire Extinguisher']);
  });
});

describe('net worth (spec §12)', () => {
  it('adds asset valuations as of each date and breaks down by group', async () => {
    const loan = await createAccount(client, { name: 'Home loan', type: 'MORTGAGE', openingBalanceCents: 50000000, openingDate: '2025-12-01' });
    await createAccount(client, { name: 'Super', type: 'SUPERANNUATION', openingBalanceCents: 9000000, openingDate: '2025-12-01', includeInNetWorth: false });
    const house = (await client.post('/api/assets', { name: 'House', type: 'PROPERTY', valueCents: 80000000, valuedOn: '2026-01-15' })).body;
    expect(house).toMatchObject({ valueCents: 80000000, valuedOn: '2026-01-15' });
    await client.post(`/api/assets/${house.id}/valuations`, { date: '2026-03-20', valueCents: 82000000 });
    await client.post('/api/assets', { name: 'Car', type: 'VEHICLE', valueCents: 2500000, valuedOn: '2026-02-01' });

    const r = (await client.get('/api/reports/net-worth?from=2025-12-01&to=2026-04-30')).body;
    expect(r.series.map((p: { date: string; netWorthCents: number }) => [p.date, p.netWorthCents])).toEqual([
      ['2025-12-31', 1000000 - 50000000],
      ['2026-01-31', 1000000 + 80000000 - 50000000],
      ['2026-02-28', 1000000 + 80000000 + 2500000 - 50000000],
      ['2026-03-31', 1000000 + 82000000 + 2500000 - 50000000],
      ['2026-04-15', 1000000 + 82000000 + 2500000 - 50000000],
    ]);
    expect(r.breakdown.groups.map((g: { label: string; totalCents: number }) => [g.label, g.totalCents])).toEqual([
      ['Cash and savings', 1000000],
      ['Property', 82000000],
      ['Vehicles', 2500000],
      ['Mortgages', 50000000],
    ]);
    // The dashboard includes asset valuations too.
    expect((await client.get('/api/dashboard')).body.netWorth.netWorthCents).toBe(35500000);
    expect(loan.id).toBeTruthy();
  });

  it('stores one snapshot per month, idempotently', async () => {
    expect(await app.services.netWorth.snapshotAll()).toEqual({ created: 1 });
    expect(await app.services.netWorth.snapshotAll()).toEqual({ created: 0 });
    const snaps = (await client.get('/api/reports/net-worth?from=2026-01-01&to=2026-04-30')).body.snapshots;
    expect(snaps).toEqual([{ date: '2026-04-01', assetsCents: 1000000, liabilitiesCents: 0, netWorthCents: 1000000 }]);
    const { buildJobs } = await import('../../jobs/index.js');
    expect(buildJobs(app).map((j) => j.name)).toContain('net-worth-snapshot');
  });

  it('manages assets and valuations', async () => {
    const a = (await client.post('/api/assets', { name: 'Boat', type: 'OTHER' })).body;
    expect(a).toMatchObject({ valueCents: 0, valuedOn: null });
    const v = (await client.post(`/api/assets/${a.id}/valuations`, { date: '2026-04-01', valueCents: 1500000 })).body;
    const again = (await client.post(`/api/assets/${a.id}/valuations`, { date: '2026-04-01', valueCents: 1400000 })).body;
    expect(again.valuations).toHaveLength(1); // one per day
    expect(again.valueCents).toBe(1400000);
    expect((await client.delete(`/api/assets/${a.id}/valuations/${v.valuations[0].id}`)).body.valuations).toEqual([]);
    expect((await client.put(`/api/assets/${a.id}`, { name: 'Tinny', type: 'OTHER', isActive: false })).body).toMatchObject({ name: 'Tinny', isActive: false });
    expect((await client.delete(`/api/assets/${a.id}`)).status).toBe(204);
  });
});

describe('debt reduction', () => {
  it('shows actual month-end balances then the projection', async () => {
    const loan = await createAccount(client, { name: 'Car loan', type: 'CAR_LOAN', openingBalanceCents: 1200000, openingDate: '2025-12-01' });
    await client.post('/api/debts', { accountId: loan.id, annualRate: '8', minRepaymentCents: 60000, repaymentFrequency: 'MONTHLY', dueDay: 20 });
    await client.post('/api/transactions', { date: '2026-02-20', description: 'Repay', amountCents: 60000, type: 'DEBT_REPAYMENT', accountId: main.id, toAccountId: loan.id });
    const r = (await client.get('/api/reports/debt-reduction?months=5')).body.items[0];
    expect(r.name).toBe('Car loan');
    expect(r.history.map((h: { date: string; balanceCents: number }) => [h.date, h.balanceCents])).toEqual([
      ['2025-12-31', 1200000],
      ['2026-01-31', 1200000],
      ['2026-02-28', 1140000],
      ['2026-03-31', 1140000],
      ['2026-04-15', 1140000],
    ]);
    expect(r.projection[0]).toEqual({ date: '2026-04-15', balanceCents: 1140000 });
    expect(r.projection.at(-1).balanceCents).toBe(0);
    expect(r.payoffDate).toBeTruthy();
  });
});

describe('calendar (spec §12)', () => {
  it('lists occurrences, sinking fund due dates and goal targets', async () => {
    const netflix = (await client.post('/api/recurring-transactions', { name: 'Netflix', type: 'EXPENSE', amountCents: 2500, frequency: 'MONTHLY', startDate: '2026-04-05', accountId: main.id, categoryId: await categoryId(client, 'Streaming services') })).body;
    await client.post(`/api/recurring-transactions/${netflix.id}/occurrences/2026-04-05/post`);
    await client.post('/api/sinking-funds', { name: 'Rego', targetCents: 90000, dueDate: '2026-05-10', contributionFrequency: 'MONTHLY', categoryId: await categoryId(client, 'Car registration (rego)') });
    await client.post('/api/goals', { name: 'Holiday', type: 'SAVINGS', targetCents: 300000, targetDate: '2026-05-20' });
    const items = (await client.get('/api/calendar?from=2026-04-01&to=2026-05-31')).body.items;
    expect(items.map((i: { date: string; kind: string; title: string; status: string; bucketKey: string | null }) => [i.date, i.kind, i.title, i.status, i.bucketKey])).toEqual([
      ['2026-04-05', 'occurrence', 'Netflix', 'posted', 'BILLS'],
      ['2026-05-05', 'occurrence', 'Netflix', 'upcoming', 'BILLS'],
      ['2026-05-10', 'sinking_fund', 'Rego due', 'due_soon', 'BILLS'], // within 30 days of 15 Apr
      ['2026-05-20', 'goal', 'Holiday target', 'behind', 'FIRE_EXTINGUISHER'], // nothing saved, no contributions
    ]);
    expect(items[0].occurrence.transactionId).toBeTruthy();
    expect((await client.get('/api/calendar?from=2026-01-01&to=2026-12-31')).status).toBe(400);
  });
});

describe('isolation', () => {
  it('keeps assets and reports per household', async () => {
    const house = (await client.post('/api/assets', { name: 'House', type: 'PROPERTY', valueCents: 1 })).body;
    await spend('2026-03-02', 'Groceries', 12345);
    const b = (await registerUser(app)).client;
    expect((await b.put(`/api/assets/${house.id}`, { name: 'x', type: 'OTHER' })).status).toBe(404);
    expect((await b.delete(`/api/assets/${house.id}`)).status).toBe(404);
    expect((await b.post(`/api/assets/${house.id}/valuations`, { date: '2026-04-01', valueCents: 1 })).status).toBe(404);
    expect((await b.get('/api/assets')).body.items).toEqual([]);
    expect((await b.get('/api/reports/spending?from=2026-01-01&to=2026-04-30')).body.totalCents).toBe(0);
    expect((await b.get(`/api/reports/spending?from=2026-01-01&to=2026-04-30&accountId=${main.id}`)).body.totalCents).toBe(0);
    expect((await b.get('/api/reports/net-worth?from=2026-01-01&to=2026-04-30')).body.breakdown.groups).toEqual([]);
    expect(await testDb().asset.count()).toBe(1);
  });
});
