import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bucketIds, categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, testDb } from '../../test/helpers.js';
import { calculateBucketActuals, calculateCategorySpending } from '../../finance/spending.js';

let app: FastifyInstance;
let client: Client;
let main: { id: string };

beforeEach(async () => {
  await resetDatabase();
  app = await createTestApp();
  ({ client } = await registerUser(app));
  main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 1000000 });
});
afterEach(async () => {
  await app.close();
});

const expense = (accountId: string, amountCents: number, splits: { categoryId: string; amountCents: number }[], extra: Record<string, unknown> = {}) =>
  client.post('/api/transactions', { date: '2026-10-01', description: 'Purchase', amountCents, type: 'EXPENSE', accountId, splits, ...extra });

const balance = async (id: string) => (await client.get(`/api/accounts/${id}`)).body.balanceCents as number;

/** Bucket actuals computed from what is stored, as the budget will. */
async function bucketActuals() {
  const splits = await testDb().transactionSplit.findMany({ include: { transaction: true, category: { include: { bucket: true } } } });
  const spending = calculateCategorySpending(
    splits.map((s) => ({ categoryId: s.categoryId, amountCents: Number(s.amountCents), transactionType: s.transaction.type, isSinkingFundPayment: s.isSinkingFundPayment })),
  );
  const bucketOf = new Map(splits.map((s) => [s.categoryId, s.category.bucket?.key]));
  return Object.fromEntries(calculateBucketActuals(spending, (id) => bucketOf.get(id)));
}

describe('transactions', () => {
  it('creates a split expense and derives its buckets', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const alcohol = await categoryId(client, 'Alcohol');
    const res = await expense(main.id, 18000, [
      { categoryId: groceries, amountCents: 15000 },
      { categoryId: alcohol, amountCents: 3000 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.splits.map((s: { amountCents: number }) => s.amountCents)).toEqual([15000, 3000]);
    expect(res.body.buckets.map((b: { key: string }) => b.key).sort()).toEqual(['BILLS', 'SPLURGE']);
    expect(await bucketActuals()).toEqual({ BILLS: 15000, SPLURGE: 3000 });
  });

  it('rejects splits that do not sum to the amount', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const res = await expense(main.id, 18000, [{ categoryId: groceries, amountCents: 17999 }]);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toMatchObject({ splitTotalCents: 17999, amountCents: 18000 });
  });

  it('enforces the split total in the database too', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const res = await expense(main.id, 1000, [{ categoryId: groceries, amountCents: 1000 }]);
    await expect(
      testDb().transactionSplit.updateMany({ where: { transactionId: res.body.id }, data: { amountCents: 999n } }),
    ).rejects.toThrow(/transaction_splits_sum|Splits for transaction/);
  });

  it('validates amount, date, accounts and categories', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const salary = await categoryId(client, 'Salary and wages');
    const base = { description: 'x', type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: groceries, amountCents: 100 }] };
    expect((await client.post('/api/transactions', { ...base, date: '2026-10-01', amountCents: 0 })).status).toBe(400);
    expect((await client.post('/api/transactions', { ...base, date: '1899-12-31', amountCents: 100 })).status).toBe(400);
    expect((await client.post('/api/transactions', { ...base, date: '2026-10-01', amountCents: 100, splits: [{ categoryId: salary, amountCents: 100 }] })).body.error.message).toMatch(/income category/);
    expect((await client.post('/api/transactions', { ...base, date: '2026-10-01', amountCents: 100, splits: [] })).body.error.message).toMatch(/Choose a category/);
    expect((await client.post('/api/transactions', { ...base, date: '2026-10-01', amountCents: 100, type: 'TRANSFER', toAccountId: main.id, splits: [] })).status).toBe(400);
    const cats = (await client.get('/api/categories')).body.items;
    const group = cats.find((c: { isGroup: boolean }) => c.isGroup);
    expect((await client.post('/api/transactions', { ...base, date: '2026-10-01', amountCents: 100, splits: [{ categoryId: group.id, amountCents: 100 }] })).status).toBe(400);

    const golf = await categoryId(client, 'Golf');
    await client.put(`/api/categories/${golf}`, { isActive: false });
    expect((await client.post('/api/transactions', { ...base, date: '2026-10-01', amountCents: 100, splits: [{ categoryId: golf, amountCents: 100 }] })).body.error.message).toMatch(/disabled/);
  });

  it('income needs an income category and counts as income only', async () => {
    const salary = await categoryId(client, 'Salary and wages');
    const res = await client.post('/api/transactions', { date: '2026-10-01', description: 'Pay', amountCents: 350000, type: 'INCOME', accountId: main.id, splits: [{ categoryId: salary, amountCents: 350000 }] });
    expect(res.status).toBe(201);
    expect(await bucketActuals()).toEqual({});
    expect(await balance(main.id)).toBe(1350000);
  });

  it('a transfer to the Smile account changes balances but not spending (spec §18)', async () => {
    const ids = await bucketIds(client);
    const smile = await createAccount(client, { name: 'Smile', type: 'SAVINGS', bucketTagId: ids.SMILE });
    const res = await client.post('/api/transactions', { date: '2026-10-01', description: 'To Smile', amountCents: 50000, type: 'TRANSFER', accountId: main.id, toAccountId: smile.id });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('TRANSFER');
    expect(res.body.splits).toEqual([]);
    expect(await bucketActuals()).toEqual({});
    expect(await balance(main.id)).toBe(950000);
    expect(await balance(smile.id)).toBe(50000);
  });

  it('counts a credit card purchase once when the card is paid (spec §18)', async () => {
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD' });
    const electronics = await categoryId(client, 'Electronics');
    await expense(card.id, 10000, [{ categoryId: electronics, amountCents: 10000 }]);
    expect(await balance(card.id)).toBe(10000);
    const pay = await client.post('/api/transactions', { date: '2026-10-05', description: 'Pay card', amountCents: 10000, type: 'TRANSFER', accountId: main.id, toAccountId: card.id });
    expect(pay.body.type).toBe('TRANSFER');
    expect(pay.body.splits).toEqual([]);
    expect(await bucketActuals()).toEqual({ SPLURGE: 10000 });
    expect(await balance(card.id)).toBe(0);
    expect(await balance(main.id)).toBe(990000);
  });

  it('a Debt repayment on a card (Transfer treatment) has no splits', async () => {
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD', openingBalanceCents: 30000 });
    const pay = await client.post('/api/transactions', { date: '2026-10-05', description: 'Pay card', amountCents: 30000, type: 'DEBT_REPAYMENT', accountId: main.id, toAccountId: card.id });
    expect(pay.status).toBe(201);
    expect(pay.body.splits).toEqual([]);
    expect(await balance(card.id)).toBe(0);
  });

  it('splits a loan repayment into Bills minimum and Fire Extinguisher extra (spec §18)', async () => {
    const mortgage = await createAccount(client, { name: 'Home loan', type: 'MORTGAGE', openingBalanceCents: 50000000 });
    const householdId = (await client.get('/api/settings')).body.id;
    await testDb().debt.create({
      data: { householdId, accountId: mortgage.id, originalBalanceCents: 50000000n, annualRate: '6.0000', minRepaymentCents: 250000n, repaymentFrequency: 'MONTHLY' },
    });
    const res = await client.post('/api/transactions', { date: '2026-10-01', description: 'Mortgage', amountCents: 300000, type: 'TRANSFER', accountId: main.id, toAccountId: mortgage.id });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('DEBT_REPAYMENT');
    expect(res.body.splits.map((s: { categoryName: string; amountCents: number; isExtraRepayment: boolean }) => [s.categoryName, s.amountCents, s.isExtraRepayment])).toEqual([
      ['Mortgage', 250000, false],
      ['Extra debt repayments', 50000, true],
    ]);
    expect(await bucketActuals()).toEqual({ BILLS: 250000, FIRE_EXTINGUISHER: 50000 });
    expect(await balance(mortgage.id)).toBe(50000000 - 300000);

    // Re-split on edit.
    const edited = await client.put(`/api/transactions/${res.body.id}`, { date: '2026-10-01', description: 'Mortgage', amountCents: 200000, type: 'DEBT_REPAYMENT', accountId: main.id, toAccountId: mortgage.id });
    expect(edited.body.splits.map((s: { amountCents: number }) => s.amountCents)).toEqual([200000]);
  });

  it('without a debt profile the whole repayment is the Bills minimum', async () => {
    const loan = await createAccount(client, { name: 'Car loan', type: 'CAR_LOAN', openingBalanceCents: 2000000 });
    const res = await client.post('/api/transactions', { date: '2026-10-01', description: 'Car', amountCents: 60000, type: 'DEBT_REPAYMENT', accountId: main.id, toAccountId: loan.id });
    expect(res.body.splits).toMatchObject([{ categoryName: 'Loan repayments', amountCents: 60000 }]);
  });

  it('turns a transfer into a Fire Extinguisher account into a savings contribution', async () => {
    const ids = await bucketIds(client);
    const emergency = await createAccount(client, { name: 'Emergency', type: 'SAVINGS', bucketTagId: ids.FIRE_EXTINGUISHER });
    const res = await client.post('/api/transactions', { date: '2026-10-01', description: 'Save', amountCents: 20000, type: 'TRANSFER', accountId: main.id, toAccountId: emergency.id });
    expect(res.body.type).toBe('SAVINGS_CONTRIBUTION');
    expect(res.body.splits).toMatchObject([{ categoryName: 'Savings contributions', amountCents: 20000 }]);
    expect(await bucketActuals()).toEqual({ FIRE_EXTINGUISHER: 20000 });

    const emergencyCat = await categoryId(client, 'Emergency fund');
    const chosen = await client.post('/api/transactions', { date: '2026-10-02', description: 'Save', amountCents: 5000, type: 'SAVINGS_CONTRIBUTION', accountId: main.id, toAccountId: emergency.id, splits: [{ categoryId: emergencyCat, amountCents: 5000 }] });
    expect(chosen.body.splits[0].categoryName).toBe('Emergency fund');

    const groceries = await categoryId(client, 'Groceries');
    const wrong = await client.post('/api/transactions', { date: '2026-10-02', description: 'Save', amountCents: 5000, type: 'SAVINGS_CONTRIBUTION', accountId: main.id, toAccountId: emergency.id, splits: [{ categoryId: groceries, amountCents: 5000 }] });
    expect(wrong.status).toBe(400);

    const notFire = await createAccount(client, { name: 'Plain', type: 'SAVINGS' });
    expect((await client.post('/api/transactions', { date: '2026-10-02', description: 'Save', amountCents: 5000, type: 'SAVINGS_CONTRIBUTION', accountId: main.id, toAccountId: notFire.id })).status).toBe(400);
  });

  it('nets a refund against its category (spec §18)', async () => {
    const clothing = await categoryId(client, 'Clothing');
    await expense(main.id, 5000, [{ categoryId: clothing, amountCents: 5000 }]);
    const refund = await client.post('/api/transactions', { date: '2026-10-03', description: 'Return', amountCents: 2000, type: 'REFUND', accountId: main.id, splits: [{ categoryId: clothing, amountCents: 2000 }] });
    expect(refund.status).toBe(201);
    expect(await bucketActuals()).toEqual({ SPLURGE: 3000 });
    expect(await balance(main.id)).toBe(1000000 - 3000);
  });

  it('records card interest as an Interest and fees expense, loan interest as balance only', async () => {
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD' });
    const cardInterest = await client.post('/api/transactions', { date: '2026-10-01', description: 'Interest', amountCents: 1234, type: 'INTEREST_CHARGE', accountId: card.id });
    expect(cardInterest.body.type).toBe('EXPENSE');
    expect(cardInterest.body.splits).toMatchObject([{ categoryName: 'Interest and fees', amountCents: 1234 }]);

    const mortgage = await createAccount(client, { name: 'Home loan', type: 'MORTGAGE', openingBalanceCents: 100000 });
    const loanInterest = await client.post('/api/transactions', { date: '2026-10-01', description: 'Interest', amountCents: 500, type: 'INTEREST_CHARGE', accountId: mortgage.id });
    expect(loanInterest.body.type).toBe('INTEREST_CHARGE');
    expect(loanInterest.body.splits).toEqual([]);
    expect(await balance(mortgage.id)).toBe(100500);
    expect(await bucketActuals()).toEqual({ BILLS: 1234 });

    expect((await client.post('/api/transactions', { date: '2026-10-01', description: 'Interest', amountCents: 500, type: 'INTEREST_CHARGE', accountId: main.id })).status).toBe(400);
  });

  it('balance adjustments need a direction', async () => {
    const res = await client.post('/api/transactions', { date: '2026-10-01', description: 'Fix', amountCents: 500, type: 'BALANCE_ADJUSTMENT', accountId: main.id });
    expect(res.status).toBe(400);
    const ok = await client.post('/api/transactions', { date: '2026-10-01', description: 'Fix', amountCents: 500, type: 'BALANCE_ADJUSTMENT', direction: 'DECREASE', accountId: main.id });
    expect(ok.status).toBe(201);
    expect(await balance(main.id)).toBe(999500);
  });

  it('does not allow new transactions on closed accounts', async () => {
    const old = await createAccount(client, { name: 'Old', type: 'TRANSACTION', isClosed: true });
    const res = await client.post('/api/transactions', { date: '2026-10-01', description: 'Fix', amountCents: 500, type: 'BALANCE_ADJUSTMENT', direction: 'DECREASE', accountId: old.id });
    expect(res.body.error.message).toMatch(/closed/);
  });

  it('updates and deletes', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const created = await expense(main.id, 1000, [{ categoryId: groceries, amountCents: 1000 }]);
    const updated = await client.put(`/api/transactions/${created.body.id}`, {
      date: '2026-10-02', description: 'Bigger shop', payee: 'Woolworths', amountCents: 2500, type: 'EXPENSE', accountId: main.id,
      splits: [{ categoryId: groceries, amountCents: 2500 }], notes: 'weekly', cleared: true,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ date: '2026-10-02', description: 'Bigger shop', payee: 'Woolworths', amountCents: 2500, notes: 'weekly', cleared: true });
    expect((await client.delete(`/api/transactions/${created.body.id}`)).status).toBe(204);
    expect((await client.get(`/api/transactions/${created.body.id}`)).status).toBe(404);
    expect(await balance(main.id)).toBe(1000000);
  });

  it('lists with filters, search, sorting and pagination', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const coffee = await categoryId(client, 'Coffee');
    const ids = await bucketIds(client);
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD' });
    for (let i = 1; i <= 12; i++) {
      await expense(i % 2 ? main.id : card.id, i * 100, [{ categoryId: i % 3 ? groceries : coffee, amountCents: i * 100 }], {
        date: `2026-09-${String(i).padStart(2, '0')}`,
        description: i === 7 ? 'WOOLWORTHS 1234 SYDNEY' : `Shop ${i}`,
      });
    }
    const page1 = await client.get('/api/transactions?pageSize=5&page=1');
    expect(page1.body.total).toBe(12);
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.items[0].date).toBe('2026-09-12');
    const page3 = await client.get('/api/transactions?pageSize=5&page=3');
    expect(page3.body.items).toHaveLength(2);

    expect((await client.get(`/api/transactions?accountId=${card.id}`)).body.total).toBe(6);
    expect((await client.get(`/api/transactions?categoryId=${coffee}`)).body.total).toBe(4);
    expect((await client.get(`/api/transactions?bucketId=${ids.SPLURGE}`)).body.total).toBe(4);
    expect((await client.get('/api/transactions?search=woolworths')).body.items[0].description).toContain('WOOLWORTHS');
    expect((await client.get('/api/transactions?from=2026-09-03&to=2026-09-05')).body.total).toBe(3);
    expect((await client.get('/api/transactions?minCents=500&maxCents=800')).body.total).toBe(4);
    const byAmount = await client.get('/api/transactions?sort=amount&order=asc&pageSize=3');
    expect(byAmount.body.items.map((t: { amountCents: number }) => t.amountCents)).toEqual([100, 200, 300]);
    expect((await client.get('/api/transactions?type=INCOME,TRANSFER')).body.total).toBe(0);
    expect((await client.get('/api/transactions?type=BOGUS')).status).toBe(400);
  });

  it('bulk recategorises and deletes', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const coffee = await categoryId(client, 'Coffee');
    const a = await expense(main.id, 100, [{ categoryId: groceries, amountCents: 100 }]);
    const b = await expense(main.id, 200, [{ categoryId: groceries, amountCents: 200 }]);
    const t = await client.post('/api/transactions', { date: '2026-10-01', description: 'Fix', amountCents: 5, type: 'BALANCE_ADJUSTMENT', direction: 'DECREASE', accountId: main.id });
    const res = await client.post('/api/transactions/bulk', { action: 'recategorise', ids: [a.body.id, b.body.id, t.body.id], categoryId: coffee });
    expect(res.body).toEqual({ deleted: 0, updated: 2, skipped: 1 });
    expect((await client.get(`/api/transactions?categoryId=${coffee}`)).body.total).toBe(2);
    const del = await client.post('/api/transactions/bulk', { action: 'delete', ids: [a.body.id, b.body.id] });
    expect(del.body.deleted).toBe(2);
  });

  it('flags and counts uncategorised expenses', async () => {
    const householdId = (await client.get('/api/settings')).body.id;
    // Imports may create uncategorised expenses; the API requires categories for manual entry.
    await testDb().transaction.create({ data: { householdId, accountId: main.id, date: new Date('2026-10-01'), description: 'Unknown', amountCents: 999n, type: 'EXPENSE' } });
    const res = await client.get('/api/transactions?uncategorised=true');
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].uncategorised).toBe(true);
  });
});
