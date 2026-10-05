import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';

let app: FastifyInstance;
let client: Client;
let main: { id: string };
const clock = new TestClock();

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-15T01:00:00Z');
  app = await createTestApp({ clock });
  ({ client } = await registerUser(app));
  main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 100000, openingDate: '2026-09-01' });
});
afterEach(async () => {
  await app.close();
});

// CommBank-style: no header, date, signed amount, description, balance.
const BANK = [
  '01/10/2026,"-82.40","WOOLWORTHS 1234 SYDNEY","+917.60"',
  '02/10/2026,"-4.50","CAFE NERO","+913.10"',
  '02/10/2026,"-4.50","CAFE NERO","+908.60"',
  '03/10/2026,"+3500.00","SALARY ACME PTY LTD","+4408.60"',
  '05/10/2026,"-25.00","NETFLIX.COM","+4383.60"',
].join('\n');

const parse = (csv: string, extra: Record<string, unknown> = {}) => client.post('/api/import/parse', { accountId: main.id, fileName: 'bank.csv', csv, ...extra });
const commit = (csv: string, extra: Record<string, unknown> = {}) => client.post('/api/import/commit', { accountId: main.id, fileName: 'bank.csv', csv, ...extra });
const balance = async (id = main.id) => (await client.get(`/api/accounts/${id}`)).body.balanceCents as number;

describe('CSV import', () => {
  it('guesses the mapping and classifies every row', async () => {
    const res = await parse(BANK);
    expect(res.status).toBe(200);
    expect(res.body.mapping).toMatchObject({ delimiter: ',', hasHeader: false, dateFormat: 'DD/MM/YYYY', dateColumn: 0, amountColumn: 1, descriptionColumn: 2, balanceColumn: null });
    expect(res.body.summary).toMatchObject({ total: 5, new: 5, duplicates: 0, errors: 0 });
    expect(res.body.rows[0]).toMatchObject({ date: '2026-10-01', description: 'WOOLWORTHS 1234 SYDNEY', amountCents: 8240, direction: 'debit', defaultAction: 'import', suggestion: { type: 'EXPENSE', categoryId: null } });
    expect(res.body.rows[3].suggestion.type).toBe('INCOME');
    expect(res.body.sample).toHaveLength(5);
  });

  it('imports one batch, then adds 0 rows when the same file is imported again (spec §18)', async () => {
    const first = await commit(BANK);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ rowCount: 5, importedCount: 5, skippedCount: 0, status: 'COMMITTED' });
    expect(await balance()).toBe(100000 - 8240 - 450 - 450 + 350000 - 2500);
    const listed = await client.get(`/api/transactions?importBatchId=${first.body.id}`);
    expect(listed.body.total).toBe(5);
    expect(listed.body.items.every((t: { cleared: boolean }) => t.cleared)).toBe(true);
    expect(listed.body.items.filter((t: { uncategorised: boolean }) => t.uncategorised)).toHaveLength(5);

    const again = await parse(BANK);
    expect(again.body.summary).toMatchObject({ new: 0, duplicates: 5 });
    const second = await commit(BANK);
    expect(second.body).toMatchObject({ importedCount: 0, skippedCount: 5 });
    expect(await testDb().transaction.count()).toBe(5);

    // Two identical coffees on one day are both kept, and a file with only one of them adds nothing new.
    const partial = await parse('02/10/2026,"-4.50","CAFE NERO","+913.10"');
    expect(partial.body.summary.duplicates).toBe(1);
  });

  it('undo removes exactly the batch (spec §18)', async () => {
    await client.post('/api/transactions', { date: '2026-10-01', description: 'Manual', amountCents: 999, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: await categoryId(client, 'Bank fees'), amountCents: 999 }] });
    const batch = (await commit(BANK)).body;
    expect(await testDb().transaction.count()).toBe(6);
    const undo = await client.delete(`/api/import/batches/${batch.id}`);
    expect(undo.body).toEqual({ removed: 5, unmerged: 0 });
    expect(await testDb().transaction.count()).toBe(1);
    expect((await client.delete(`/api/import/batches/${batch.id}`)).body.error.code).toBe('ALREADY_UNDONE');
    const batches = await client.get('/api/import/batches');
    expect(batches.body.items[0]).toMatchObject({ status: 'UNDONE', accountName: 'Main' });
    // After undo the same file imports again.
    expect((await parse(BANK)).body.summary.new).toBe(5);
  });

  it('saves the mapping as a profile for the account and reuses it', async () => {
    const csv = 'Date;Details;Debit;Credit;Balance\n2026-10-01;Coffee;4.50;;95.50\n2026-10-02;Refund;;10.00;105.50';
    const p = await parse(csv);
    expect(p.body.mapping).toMatchObject({ delimiter: ';', hasHeader: true, signConvention: 'DEBIT_CREDIT_COLUMNS', debitColumn: 2, creditColumn: 3, balanceColumn: 4, dateFormat: 'YYYY-MM-DD' });
    expect(p.body.profileUsed).toBe(false);
    expect(p.body.columns).toEqual(['Date', 'Details', 'Debit', 'Credit', 'Balance']);
    await commit(csv);
    const profiles = await client.get('/api/import/profiles');
    expect(profiles.body.items[0]).toMatchObject({ accountId: main.id, delimiter: ';', debitColumn: 2 });
    const next = await parse('Date;Details;Debit;Credit;Balance\n2026-10-03;Tea;3.00;;102.50');
    expect(next.body.profileUsed).toBe(true);
    expect((await client.delete(`/api/import/profiles/${profiles.body.items[0].id}`)).status).toBe(204);
  });

  it('lets the mapping be overridden', async () => {
    const res = await parse('Date,Description,Amount\n01/10/2026,JB HI FI,199.00', { mapping: { signConvention: 'POSITIVE_IS_DEBIT' } });
    expect(res.body.rows[0]).toMatchObject({ direction: 'debit', amountCents: 19900 });
    expect((await parse('a,b\n1,2', { mapping: { dateColumn: 9 } })).status).toBe(400);
  });

  it('reports per-row errors and never imports them', async () => {
    const csv = 'Date,Description,Amount\n31/02/2026,Bad,1.00\n01/10/2026,Good,-1.00';
    const p = await parse(csv);
    expect(p.body.summary).toMatchObject({ errors: 1, new: 1 });
    expect(p.body.rows[0]).toMatchObject({ status: 'error', defaultAction: 'skip' });
    expect((await commit(csv, { decisions: [{ index: 0, action: 'import' }] })).body.error.details.rows[0]).toMatchObject({ index: 0 });
    expect((await commit(csv)).body.importedCount).toBe(1);
  });

  it('applies categorisation rules, and the user can override per row', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const coffee = await categoryId(client, 'Coffee');
    const salary = await categoryId(client, 'Salary and wages');
    await client.post('/api/rules', { matchValue: 'woolworths', setCategoryId: groceries, setPayee: 'Woolworths' });
    await client.post('/api/rules', { matchValue: 'SALARY', matchType: 'STARTS_WITH', setCategoryId: salary });
    const p = await parse(BANK);
    expect(p.body.rows[0].suggestion).toMatchObject({ type: 'EXPENSE', categoryId: groceries, payee: 'Woolworths', ruleName: 'woolworths' });
    expect(p.body.rows[3].suggestion).toMatchObject({ type: 'INCOME', categoryId: salary });
    expect(p.body.summary.categorised).toBe(2);

    const batch = await commit(BANK, { decisions: [{ index: 1, action: 'import', categoryId: coffee }, { index: 2, action: 'skip' }] });
    expect(batch.body).toMatchObject({ importedCount: 4, skippedCount: 1 });
    const txs = (await client.get(`/api/transactions?importBatchId=${batch.body.id}&sort=date&order=asc`)).body.items;
    expect(txs.map((t: { description: string; splits: { categoryName: string }[]; payee: string | null }) => [t.description, t.splits[0]?.categoryName ?? null, t.payee])).toEqual([
      ['WOOLWORTHS 1234 SYDNEY', 'Groceries', 'Woolworths'],
      ['CAFE NERO', 'Coffee', null],
      ['SALARY ACME PTY LTD', 'Salary and wages', null],
      ['NETFLIX.COM', null, null],
    ]);
  });

  it('turns money in with an expense category into a refund, and supports transfer rules', async () => {
    const card = await createAccount(client, { name: 'Visa', type: 'CREDIT_CARD', openingBalanceCents: 50000 });
    const groceries = await categoryId(client, 'Groceries');
    await client.post('/api/rules', { matchValue: 'woolworths', setCategoryId: groceries });
    await client.post('/api/rules', { matchValue: 'VISA PAYMENT', setType: 'TRANSFER', setToAccountId: card.id });
    const csv = 'Date,Description,Amount\n01/10/2026,WOOLWORTHS REFUND,12.00\n02/10/2026,VISA PAYMENT,-500.00';
    const p = await parse(csv);
    expect(p.body.rows[0].suggestion).toMatchObject({ type: 'REFUND', categoryId: groceries });
    expect(p.body.rows[1].suggestion).toMatchObject({ type: 'TRANSFER', toAccountId: card.id });
    await commit(csv);
    expect(await balance(card.id)).toBe(0);
    expect(await balance()).toBe(100000 + 1200 - 50000);

    // Importing the card side: the payment credit matches the transfer already recorded, so it merges.
    const cardCsv = 'Date,Description,Amount\n03/10/2026,PAYMENT THANK YOU,500.00\n04/10/2026,JB HI FI,-199.00';
    const cp = await client.post('/api/import/parse', { accountId: card.id, fileName: 'card.csv', csv: cardCsv });
    expect(cp.body.rows[0]).toMatchObject({ direction: 'credit', defaultAction: 'merge', merge: { type: 'TRANSFER' } });
    expect(cp.body.rows[1].suggestion.type).toBe('EXPENSE');
    const cb = await client.post('/api/import/commit', { accountId: card.id, fileName: 'card.csv', csv: cardCsv });
    expect(cb.body).toMatchObject({ importedCount: 1, mergedCount: 1 });
    expect(await balance(card.id)).toBe(19900); // the payment was counted once
  });

  it('records a transfer the user marks by hand, in either direction', async () => {
    const savings = await createAccount(client, { name: 'Savings', type: 'SAVINGS' });
    const csv = 'Date,Description,Amount\n01/10/2026,TO SAVINGS,-100.00\n02/10/2026,FROM SAVINGS,40.00';
    const res = await commit(csv, {
      decisions: [
        { index: 0, action: 'import', type: 'TRANSFER', otherAccountId: savings.id },
        { index: 1, action: 'import', type: 'TRANSFER', otherAccountId: savings.id },
      ],
    });
    expect(res.status).toBe(201);
    expect(await balance(savings.id)).toBe(6000);
    expect(await balance()).toBe(100000 - 6000);
  });

  it('matches scheduled payments: fixed exactly, estimates within 20% (spec §8)', async () => {
    const streaming = await categoryId(client, 'Streaming services');
    const netflix = (await client.post('/api/recurring-transactions', { name: 'Netflix', type: 'EXPENSE', amountCents: 2500, frequency: 'MONTHLY', startDate: '2026-10-04', accountId: main.id, categoryId: streaming })).body;
    const power = (await client.post('/api/recurring-transactions', { name: 'Power', type: 'EXPENSE', amountKind: 'ESTIMATE', amountCents: 45000, frequency: 'QUARTERLY', startDate: '2026-10-12', accountId: main.id, categoryId: await categoryId(client, 'Electricity') })).body;
    const csv = 'Date,Description,Amount\n05/10/2026,NETFLIX.COM,-25.00\n10/10/2026,AGL ENERGY,-512.30\n20/10/2026,NETFLIX.COM,-25.01';
    const p = await parse(csv);
    expect(p.body.rows[0]).toMatchObject({ defaultAction: 'match', match: { recurringId: netflix.id, occurrenceDate: '2026-10-04' } });
    expect(p.body.rows[0].suggestion).toMatchObject({ type: 'EXPENSE', categoryId: streaming });
    expect(p.body.rows[1]).toMatchObject({ defaultAction: 'match', match: { recurringId: power.id, occurrenceDate: '2026-10-12' } });
    expect(p.body.rows[2].defaultAction).toBe('import'); // wrong amount and date for a fixed schedule

    const b = await commit(csv);
    expect(b.body).toMatchObject({ importedCount: 3, matchedCount: 2 });
    const occ = (await client.get('/api/recurring-transactions/occurrences?from=2026-10-01&to=2026-10-31')).body.items;
    expect(occ.map((o: { name: string; status: string }) => [o.name, o.status])).toEqual([
      ['Netflix', 'posted'],
      ['Power', 'posted'],
    ]);
    const powerTx = await testDb().transaction.findFirstOrThrow({ where: { recurringId: power.id } });
    expect(Number(powerTx.amountCents)).toBe(51230); // the bank's amount, not the estimate
    expect(powerTx.date.toISOString().slice(0, 10)).toBe('2026-10-10');

    // Undo un-posts them again.
    await client.delete(`/api/import/batches/${b.body.id}`);
    const after = (await client.get('/api/recurring-transactions/occurrences?from=2026-10-01&to=2026-10-31')).body.items;
    expect(after.every((o: { status: string }) => o.status !== 'posted')).toBe(true);
  });

  it('offers merges with manual entries (same amount, ±3 days), and undo unlinks them', async () => {
    const coffee = await categoryId(client, 'Coffee');
    const manual = (await client.post('/api/transactions', { date: '2026-10-01', description: 'Coffee with Sam', amountCents: 450, type: 'EXPENSE', accountId: main.id, splits: [{ categoryId: coffee, amountCents: 450 }] })).body;
    const p = await parse(BANK);
    const merges = p.body.rows.filter((r: { defaultAction: string }) => r.defaultAction === 'merge');
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({ description: 'CAFE NERO', merge: { transactionId: manual.id } });

    const b = await commit(BANK);
    expect(b.body).toMatchObject({ importedCount: 4, mergedCount: 1 });
    const merged = await testDb().transaction.findUniqueOrThrow({ where: { id: manual.id }, include: { bankRows: true } });
    expect(merged.bankRows).toHaveLength(1);
    expect(merged.description).toBe('Coffee with Sam'); // merge never overwrites what the user entered
    expect((await parse(BANK)).body.summary.duplicates).toBe(5);

    expect((await client.delete(`/api/import/batches/${b.body.id}`)).body).toEqual({ removed: 4, unmerged: 1 });
    const back = await testDb().transaction.findUniqueOrThrow({ where: { id: manual.id }, include: { bankRows: true } });
    expect(back.bankRows).toEqual([]);
  });

  it('merges a bank row into an auto-posted occurrence (spec §8)', async () => {
    clock.current = new Date('2026-10-02T13:00:00Z');
    const salary = (await client.post('/api/recurring-transactions', { name: 'Salary', type: 'INCOME', amountCents: 350000, frequency: 'FORTNIGHTLY', startDate: '2026-10-03', autoPost: true, accountId: main.id, categoryId: await categoryId(client, 'Salary and wages') })).body;
    clock.current = new Date('2026-10-03T00:00:00Z');
    await app.services.recurring.autoPostDue();
    const p = await parse(BANK);
    expect(p.body.rows[3]).toMatchObject({ defaultAction: 'merge' });
    await commit(BANK);
    expect(await testDb().transaction.count({ where: { recurringId: salary.id } })).toBe(1);
    expect(await testDb().transaction.count({ where: { type: 'INCOME' } })).toBe(1);
  });

  it('checks the statement balance when a balance column is mapped', async () => {
    const p = await parse(BANK, { mapping: { balanceColumn: 3 } });
    expect(p.body.balanceCheck).toEqual({
      date: '2026-10-05',
      statementBalanceCents: 438360,
      appBalanceBeforeCents: 100000,
      appBalanceAfterCents: 438360,
      differenceCents: 0,
    });
  });

  it('rejects oversized files and unknown accounts', async () => {
    const big = `01/10/2026,-1,${'x'.repeat(5 * 1024 * 1024)}`;
    const res = await client.post('/api/import/parse', { accountId: main.id, fileName: 'big.csv', csv: big });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/5 MB/);
    expect((await client.post('/api/import/parse', { accountId: '00000000-0000-4000-8000-000000000000', fileName: 'x.csv', csv: BANK })).status).toBe(400);
    expect((await parse('')).status).toBe(400);
  });

  it('keeps households apart', async () => {
    const batch = (await commit(BANK)).body;
    const other = (await registerUser(app)).client;
    expect((await other.post('/api/import/parse', { accountId: main.id, fileName: 'x.csv', csv: BANK })).status).toBe(400);
    expect((await other.delete(`/api/import/batches/${batch.id}`)).status).toBe(404);
    expect((await other.get('/api/import/batches')).body.items).toEqual([]);
    expect((await other.get('/api/import/profiles')).body.items).toEqual([]);
    expect((await other.get(`/api/transactions?importBatchId=${batch.id}`)).body.total).toBe(0);
  });
});

describe('categorisation rules', () => {
  it('creates, validates, reorders, tests and applies rules', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const salary = await categoryId(client, 'Salary and wages');
    expect((await client.post('/api/rules', { matchValue: 'x' })).status).toBe(400); // no action
    expect((await client.post('/api/rules', { matchValue: 'x', setType: 'INCOME', setCategoryId: groceries })).status).toBe(400);
    expect((await client.post('/api/rules', { matchValue: 'x', setType: 'TRANSFER' })).status).toBe(400);
    expect((await client.post('/api/rules', { matchValue: 'x', setCategoryId: groceries, minAmountCents: 500, maxAmountCents: 100 })).status).toBe(400);

    await commit(BANK); // imported before the rules exist, so everything is uncategorised
    const a = (await client.post('/api/rules', { matchValue: 'woolworths', setCategoryId: groceries })).body;
    const b = (await client.post('/api/rules', { matchValue: 'salary', setCategoryId: salary, name: 'Pay' })).body;
    expect(a.priority).toBeLessThan(b.priority);
    const reordered = await client.post('/api/rules/reorder', { ids: [b.id, a.id] });
    expect(reordered.body.items.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);
    expect((await client.post('/api/rules/reorder', { ids: [a.id] })).status).toBe(400);

    const test = await client.post('/api/rules/test', { matchValue: 'woolworths', setCategoryId: groceries });
    expect(test.body).toMatchObject({ matchCount: 1, uncategorisedCount: 1 });
    expect(test.body.items[0].description).toBe('WOOLWORTHS 1234 SYDNEY');

    const applied = await client.post('/api/rules/apply', { id: a.id });
    expect(applied.body).toEqual({ updated: 1, skipped: 0 });
    expect((await client.get(`/api/transactions?categoryId=${groceries}`)).body.total).toBe(1);
    expect((await client.post('/api/rules/apply', { id: a.id })).body.updated).toBe(0); // already categorised

    const upd = await client.put(`/api/rules/${a.id}`, { matchValue: 'woolies', setCategoryId: groceries, isActive: false });
    expect(upd.body).toMatchObject({ matchValue: 'woolies', isActive: false });
    expect((await client.post('/api/rules/apply', { id: a.id })).body.error.code).toBe('RULE_DISABLED');
    expect((await client.delete(`/api/rules/${a.id}`)).status).toBe(204);

    const other = (await registerUser(app)).client;
    expect((await other.put(`/api/rules/${b.id}`, { matchValue: 'x', setCategoryId: groceries })).status).toBe(404);
    expect((await other.delete(`/api/rules/${b.id}`)).status).toBe(404);
    expect((await other.post('/api/rules/apply', { id: b.id })).status).toBe(404);
  });
});
