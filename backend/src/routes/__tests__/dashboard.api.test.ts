import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bucketIds, categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';

let app: FastifyInstance;
let client: Client;
const clock = new TestClock();

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-15T01:00:00Z');
  app = await createTestApp({ clock });
  ({ client } = await registerUser(app));
});
afterEach(async () => {
  await app.close();
});

describe('dashboard', () => {
  it('works for a brand-new household', async () => {
    const res = await client.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.income).toMatchObject({ plannedCents: 0, plannedSource: 'none', actualCents: 0 });
    expect(res.body.buckets).toHaveLength(4);
    expect(res.body.netWorth.history).toHaveLength(12);
  });

  it('shows the period position in one call', async () => {
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 500000 });
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD', openingBalanceCents: 100000 });
    const mortgage = await createAccount(client, { name: 'Home loan', type: 'MORTGAGE', openingBalanceCents: 40000000 });
    const ids = await bucketIds(client);
    const emergency = await createAccount(client, { name: 'Emergency', type: 'SAVINGS', bucketTagId: ids.FIRE_EXTINGUISHER });
    const householdId = (await client.get('/api/settings')).body.id;
    await testDb().debt.create({ data: { householdId, accountId: mortgage.id, originalBalanceCents: 40000000n, annualRate: '6', minRepaymentCents: 250000n, repaymentFrequency: 'MONTHLY' } });

    const salaryCat = await categoryId(client, 'Salary and wages');
    const salary = (await client.post('/api/recurring-transactions', { name: 'Salary', type: 'INCOME', amountCents: 350000, frequency: 'FORTNIGHTLY', startDate: '2026-10-08', accountId: main.id, categoryId: salaryCat })).body;
    await client.post(`/api/recurring-transactions/${salary.id}/occurrences/2026-10-08/post`);
    await client.post('/api/transactions', { date: '2026-10-09', description: 'Side gig', amountCents: 20000, type: 'INCOME', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Side income'), amountCents: 20000 }] });
    await client.post('/api/transactions', { date: '2026-10-02', description: 'Mortgage', amountCents: 300000, type: 'DEBT_REPAYMENT', accountId: main.id, toAccountId: mortgage.id });
    await client.post('/api/transactions', { date: '2026-10-03', description: 'Interest', amountCents: 180000, type: 'INTEREST_CHARGE', accountId: mortgage.id });
    await client.post('/api/transactions', { date: '2026-10-04', description: 'Save', amountCents: 25000, type: 'TRANSFER', accountId: main.id, toAccountId: emergency.id });
    const groceries = await categoryId(client, 'Groceries');
    await client.post('/api/transactions', { date: '2026-10-05', description: 'Shop', amountCents: 30000, type: 'EXPENSE', accountId: card.id, splits: [{ categoryId: groceries, amountCents: 30000 }] });
    await client.post('/api/transactions', { date: '2026-10-06', description: 'Pay card', amountCents: 30000, type: 'TRANSFER', accountId: main.id, toAccountId: card.id });

    const budget = (await client.get('/api/budgets')).body.items[0];
    await client.put(`/api/budgets/${budget.id}/items/${groceries}`, { amountCents: 32000, enteredFrequency: 'MONTHLY' });
    await client.post('/api/recurring-transactions', { name: 'Electricity', type: 'EXPENSE', amountKind: 'ESTIMATE', amountCents: 45000, frequency: 'QUARTERLY', startDate: '2026-10-20', accountId: main.id, categoryId: await categoryId(client, 'Electricity') });
    await client.post('/api/recurring-transactions', { name: 'Holiday fund', type: 'EXPENSE', amountCents: 1000, frequency: 'MONTHLY', startDate: '2026-10-21', accountId: main.id, categoryId: await categoryId(client, 'Holidays') });
    await testDb().transaction.create({ data: { householdId, accountId: main.id, date: new Date('2026-10-07'), description: '???', amountCents: 100n, type: 'EXPENSE' } });

    const res = await client.get('/api/dashboard');
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.period).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
    expect(d.income).toMatchObject({ plannedCents: 758333, actualCents: 370000, scheduledCents: 350000, otherCents: 20000, allocationIncomeCents: 758333 });
    expect(d.income.expected).toEqual({ weekly: 175000, fortnightly: 350000, monthly: 758333, annual: 9100000 });

    const bucket = (key: string) => d.buckets.find((b: { key: string }) => b.key === key);
    // Bills: mortgage minimum $2,500 + groceries $300 + uncategorised excluded. Card payment not counted again.
    expect(bucket('BILLS')).toMatchObject({ allocatedCents: 455000, actualCents: 280000, remainingCents: 175000 });
    expect(bucket('BILLS').percentOfIncome).toBe(36.92);
    // Fire Extinguisher: $500 extra repayment + $250 savings.
    expect(bucket('FIRE_EXTINGUISHER')).toMatchObject({ actualCents: 75000 });
    expect(bucket('FIRE_EXTINGUISHER').fire).toMatchObject({ savingsCents: 25000, extraRepaymentsCents: 50000, investmentCents: 0, principalReducedCents: 120000 });

    expect(d.billsDue.map((b: { name: string; date: string }) => [b.name, b.date])).toEqual([['Electricity', '2026-10-20']]);
    expect(d.alerts).toMatchObject([{ name: 'Groceries', status: 'amber', percentUsed: 93.75 }]);
    expect(d.uncategorisedCount).toBe(1);
    // Net worth: main 500000 + 350000 + 20000 − 300000 − 25000 − 30000 − 100 = 514900; emergency 25000;
    // card 100000 + 30000 − 30000 = 100000; mortgage 40000000 − 300000 + 180000 = 39880000.
    expect(d.netWorth).toMatchObject({ assetsCents: 539900, liabilitiesCents: 39980000, netWorthCents: 539900 - 39980000 });

    const prev = await client.get('/api/dashboard?period=2026-09-10');
    expect(prev.body.period.start).toBe('2026-09-01');
    expect(prev.body.income.actualCents).toBe(0);
    const actualBasis = await client.get('/api/dashboard?basis=ACTUAL');
    expect(actualBasis.body.income.allocationIncomeCents).toBe(370000);
  });
});
