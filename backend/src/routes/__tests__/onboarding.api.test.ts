import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bucketIds, categoryId, createAccount, createTestApp, registerUser, resetDatabase } from '../../test/helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  await resetDatabase();
  app = await createTestApp();
});
afterEach(async () => {
  await app.close();
});

describe('getting started', () => {
  it('shows the welcome and ticks steps off from real data', async () => {
    const { client } = await registerUser(app);
    const first = (await client.get('/api/onboarding')).body;
    expect(first).toMatchObject({ dismissed: false, showWelcome: true, completed: 0, total: 6 });

    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION' });
    const salary = await categoryId(client, 'Salary and wages');
    await client.post('/api/recurring-transactions', { name: 'Pay', type: 'INCOME', amountCents: 100000, frequency: 'FORTNIGHTLY', startDate: '2026-10-01', accountId: main.id, categoryId: salary });
    await client.post('/api/recurring-transactions', { name: 'Rent', type: 'EXPENSE', amountCents: 200000, frequency: 'MONTHLY', startDate: '2026-10-01', accountId: main.id, categoryId: await categoryId(client, 'Rent') });
    const budget = (await client.get('/api/budgets')).body.items[0];
    await client.put(`/api/budgets/${budget.id}/items/${await categoryId(client, 'Groceries')}`, { amountCents: 80000, enteredFrequency: 'MONTHLY' });
    await client.post('/api/transactions', { date: '2026-10-01', description: 'x', amountCents: 100, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Coffee'), amountCents: 100 }] });
    const ids = await bucketIds(client);
    expect(ids.BILLS).toBeTruthy();
    await client.post('/api/goals', { name: 'Emergency', type: 'EMERGENCY_FUND', targetCents: 100000 });

    const done = (await client.get('/api/onboarding')).body;
    expect(done.steps.every((s: { done: boolean }) => s.done)).toBe(true);
    expect(done).toMatchObject({ completed: 6, showWelcome: false });
  });

  it('remembers dismissed tips per user, and can reset them', async () => {
    const { client } = await registerUser(app);
    expect((await client.post('/api/me/tips/welcome/dismiss')).body.dismissedTips).toEqual(['welcome']);
    await client.post('/api/me/tips/getting-started/dismiss');
    await client.post('/api/me/tips/getting-started/dismiss');
    expect((await client.get('/api/auth/me')).body.user.dismissedTips).toEqual(['welcome', 'getting-started']);
    expect((await client.get('/api/onboarding')).body).toMatchObject({ dismissed: true, showWelcome: false });
    expect((await client.post('/api/me/tips/Not_Valid!/dismiss')).status).toBe(400);
    expect((await client.post('/api/me/tips/reset')).body.dismissedTips).toEqual([]);
    expect((await client.get('/api/onboarding')).body.dismissed).toBe(false);

    // Another user in the same server is unaffected.
    const other = (await registerUser(app)).client;
    expect((await other.get('/api/auth/me')).body.user.dismissedTips).toEqual([]);
  });
});
