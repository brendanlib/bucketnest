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

describe('accounts', () => {
  it('derives class and defaults from the type', async () => {
    const { client } = await registerUser(app);
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD', last4: '4242' });
    expect(card).toMatchObject({ class: 'LIABILITY', repaymentTreatment: 'TRANSFER', includeInBudget: true, last4: '4242' });
    const mortgage = await createAccount(client, { name: 'Home loan', type: 'MORTGAGE', openingBalanceCents: 50000000 });
    expect(mortgage).toMatchObject({ class: 'LIABILITY', repaymentTreatment: 'DEBT_REPAYMENT', balanceCents: 50000000 });
    const sup = await createAccount(client, { name: 'Super', type: 'SUPERANNUATION' });
    expect(sup).toMatchObject({ class: 'ASSET', includeInBudget: false, repaymentTreatment: null });
  });

  it('rejects full account numbers, tags on liabilities and bad offsets', async () => {
    const { client } = await registerUser(app);
    const ids = await bucketIds(client);
    expect((await client.post('/api/accounts', { name: 'A', type: 'TRANSACTION', openingBalanceCents: 0, openingDate: '2026-01-01', last4: '12345678' })).status).toBe(400);
    expect((await client.post('/api/accounts', { name: 'A', type: 'CREDIT_CARD', openingBalanceCents: 0, openingDate: '2026-01-01', bucketTagId: ids.SMILE })).status).toBe(400);
    const savings = await createAccount(client, { name: 'Savings', type: 'SAVINGS' });
    expect((await client.post('/api/accounts', { name: 'Offset', type: 'OFFSET', openingBalanceCents: 0, openingDate: '2026-01-01', offsetForAccountId: savings.id })).status).toBe(400);
    const loan = await createAccount(client, { name: 'Loan', type: 'MORTGAGE' });
    expect((await client.post('/api/accounts', { name: 'Offset', type: 'OFFSET', openingBalanceCents: 0, openingDate: '2026-01-01', offsetForAccountId: loan.id })).status).toBe(201);
  });

  it('computes the balance from transactions and never accepts it as input', async () => {
    const { client } = await registerUser(app);
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 100000 });
    const groceries = await categoryId(client, 'Groceries');
    const salary = await categoryId(client, 'Salary and wages');
    await client.post('/api/transactions', { date: '2026-10-01', description: 'Pay', amountCents: 350000, type: 'INCOME', accountId: main.id, splits: [{ categoryId: salary, amountCents: 350000 }] });
    await client.post('/api/transactions', { date: '2026-10-02', description: 'Shop', amountCents: 18000, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: groceries, amountCents: 18000 }] });
    expect((await client.get(`/api/accounts/${main.id}`)).body.balanceCents).toBe(100000 + 350000 - 18000);

    const sneaky = await client.put(`/api/accounts/${main.id}`, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 100000, openingDate: '2026-01-01', balanceCents: 1 });
    expect(sneaky.status).toBe(400);
  });

  it('reconciles to a statement with a balance adjustment', async () => {
    const { client } = await registerUser(app);
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 100000 });
    const res = await client.post(`/api/accounts/${main.id}/reconcile`, { statementBalanceCents: 98765, date: '2026-10-03' });
    expect(res.status).toBe(200);
    expect(res.body.adjustment).toMatchObject({ direction: 'DECREASE', amountCents: 1235 });
    expect(res.body.account.balanceCents).toBe(98765);
    const same = await client.post(`/api/accounts/${main.id}/reconcile`, { statementBalanceCents: 98765, date: '2026-10-03' });
    expect(same.body.adjustment).toBeNull();

    // Adjustments are neither income nor spending: they carry no categories.
    const tx = await client.get(`/api/transactions/${res.body.adjustment.transactionId}`);
    expect(tx.body).toMatchObject({ type: 'BALANCE_ADJUSTMENT', splits: [], uncategorised: false });
  });

  it('reconciles a credit card, where the balance is the amount owed', async () => {
    const { client } = await registerUser(app);
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD', openingBalanceCents: 20000 });
    const res = await client.post(`/api/accounts/${card.id}/reconcile`, { statementBalanceCents: 25000, date: '2026-10-03' });
    expect(res.body.adjustment).toMatchObject({ direction: 'INCREASE', amountCents: 5000 });
    expect(res.body.account.balanceCents).toBe(25000);
  });

  it('returns balance history between dates', async () => {
    const { client } = await registerUser(app);
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 10000 });
    const groceries = await categoryId(client, 'Groceries');
    for (const [date, amount] of [['2026-09-10', 1000], ['2026-09-20', 2000], ['2026-10-02', 500]] as const) {
      await client.post('/api/transactions', { date, description: 'Shop', amountCents: amount, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: groceries, amountCents: amount }] });
    }
    const res = await client.get(`/api/accounts/${main.id}/balance-history?from=2026-09-15&to=2026-10-05`);
    expect(res.status).toBe(200);
    expect(res.body.openingBalanceCents).toBe(9000);
    expect(res.body.points).toEqual([
      { date: '2026-09-15', balanceCents: 9000 },
      { date: '2026-09-20', balanceCents: 7000 },
      { date: '2026-10-02', balanceCents: 6500 },
      { date: '2026-10-05', balanceCents: 6500 },
    ]);
  });

  it('closes accounts with history instead of deleting them', async () => {
    const { client } = await registerUser(app);
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION' });
    const spare = await createAccount(client, { name: 'Spare', type: 'SAVINGS' });
    await client.post(`/api/accounts/${main.id}/reconcile`, { statementBalanceCents: 500, date: '2026-10-01' });
    expect((await client.delete(`/api/accounts/${main.id}`)).body.error.code).toBe('ACCOUNT_IN_USE');
    expect((await client.delete(`/api/accounts/${spare.id}`)).status).toBe(204);

    await client.put(`/api/accounts/${main.id}`, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 0, openingDate: '2026-01-01', isClosed: true });
    expect((await client.get('/api/accounts')).body.items).toHaveLength(0);
    expect((await client.get('/api/accounts?includeClosed=true')).body.items[0].balanceCents).toBe(500);
  });

  it('will not switch an account with transactions between asset and liability', async () => {
    const { client } = await registerUser(app);
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION' });
    await client.post(`/api/accounts/${main.id}/reconcile`, { statementBalanceCents: 500, date: '2026-10-01' });
    const res = await client.put(`/api/accounts/${main.id}`, { name: 'Main', type: 'CREDIT_CARD', openingBalanceCents: 0, openingDate: '2026-01-01' });
    expect(res.status).toBe(400);
  });
});

describe('balances before the opening date', () => {
  it('do not include the opening balance yet', async () => {
    const { client } = await registerUser(app);
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 50000, openingDate: '2026-09-15' });
    const res = await client.get(`/api/accounts/${main.id}/balance-history?from=2026-09-01&to=2026-09-30`);
    expect(res.body.points[0]).toEqual({ date: '2026-09-01', balanceCents: 0 });
    expect(res.body.points.at(-1)).toEqual({ date: '2026-09-30', balanceCents: 50000 });
  });
});
