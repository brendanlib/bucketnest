import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bucketIds, categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';

let app: FastifyInstance;
let client: Client;
let main: { id: string };
const clock = new TestClock();

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-15T01:00:00Z'); // 15 Oct 12:00 Melbourne (UTC+11)
  app = await createTestApp({ clock });
  ({ client } = await registerUser(app));
  main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 1000000 });
});
afterEach(async () => {
  await app.close();
});

async function netflix(extra: Record<string, unknown> = {}) {
  const res = await client.post('/api/recurring-transactions', {
    name: 'Netflix', type: 'EXPENSE', amountCents: 2500, frequency: 'MONTHLY', startDate: '2026-08-20',
    accountId: main.id, categoryId: await categoryId(client, 'Streaming services'), ...extra,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}

describe('recurring schedules', () => {
  it('creates schedules without creating any transactions', async () => {
    const r = await netflix();
    expect(r).toMatchObject({ name: 'Netflix', bucketKey: 'BILLS', normalised: { monthly: 2500, annual: 30000 } });
    expect(r.nextOccurrence).toMatchObject({ date: '2026-08-20', overdue: true });
    expect(await testDb().transaction.count()).toBe(0);
  });

  it('validates schedules', async () => {
    const groceries = await categoryId(client, 'Groceries');
    const base = { name: 'X', type: 'EXPENSE', amountCents: 100, frequency: 'MONTHLY', startDate: '2026-01-01', accountId: main.id, categoryId: groceries };
    expect((await client.post('/api/recurring-transactions', { ...base, frequency: 'EVERY_N_DAYS' })).status).toBe(400);
    expect((await client.post('/api/recurring-transactions', { ...base, endDate: '2025-01-01' })).status).toBe(400);
    expect((await client.post('/api/recurring-transactions', { ...base, endDate: '2027-01-01', occurrenceCount: 3 })).status).toBe(400);
    expect((await client.post('/api/recurring-transactions', { ...base, categoryId: null })).status).toBe(400);
    expect((await client.post('/api/recurring-transactions', { ...base, type: 'INCOME' })).body.error.message).toMatch(/not an income/);
    expect((await client.post('/api/recurring-transactions', { ...base, type: 'TRANSFER', categoryId: null })).body.error.message).toMatch(/goes to/);
  });

  it('projects occurrences with status, then posts, skips and edits them', async () => {
    const r = await netflix();
    const list = async () => (await client.get('/api/recurring-transactions/occurrences?from=2026-08-01&to=2026-12-31')).body.items;
    expect((await list()).map((o: { date: string; status: string }) => [o.date, o.status])).toEqual([
      ['2026-08-20', 'overdue'],
      ['2026-09-20', 'overdue'],
      ['2026-10-20', 'upcoming'],
      ['2026-11-20', 'upcoming'],
      ['2026-12-20', 'upcoming'],
    ]);

    const posted = await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-09-20/post`);
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({ date: '2026-09-20', amountCents: 2500, recurringId: r.id, occurrenceDate: '2026-09-20', description: 'Netflix' });
    expect(posted.body.splits[0].categoryName).toBe('Streaming services');
    const again = await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-09-20/post`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_POSTED');

    expect((await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-08-20/skip`)).status).toBe(204);
    expect((await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-08-20/post`)).body.error.code).toBe('OCCURRENCE_SKIPPED');
    expect((await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-09-20/skip`)).body.error.code).toBe('ALREADY_POSTED');
    expect((await client.put(`/api/recurring-transactions/${r.id}/occurrences/2026-11-20`, { amountCents: 2999, date: '2026-11-22' })).status).toBe(204);
    expect((await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-11-21/post`)).status).toBe(400);

    expect((await list()).map((o: { date: string; status: string; amountCents: number }) => [o.date, o.status, o.amountCents])).toEqual([
      ['2026-08-20', 'skipped', 2500],
      ['2026-09-20', 'posted', 2500],
      ['2026-10-20', 'upcoming', 2500],
      ['2026-11-22', 'upcoming', 2999],
      ['2026-12-20', 'upcoming', 2500],
    ]);

    await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-08-20/unskip`);
    await client.put(`/api/recurring-transactions/${r.id}/occurrences/2026-11-20`, { amountCents: null, date: null });
    const items = await list();
    expect(items[0].status).toBe('overdue');
    expect(items[3]).toMatchObject({ date: '2026-11-20', amountCents: 2500, edited: false });
    expect((await client.get(`/api/recurring-transactions/${r.id}`)).body.nextOccurrence.date).toBe('2026-08-20');
  });

  it('reschedules one occurrence, or moves it to the next budget period', async () => {
    const r = await netflix();
    const base = `/api/recurring-transactions/${r.id}/occurrences`;
    const occ = async (from: string, to: string) =>
      ((await client.get(`/api/recurring-transactions/occurrences?from=${from}&to=${to}`)).body.items as { recurringId: string; occurrenceDate: string; date: string; amountCents: number; status: string; edited: boolean; nextPeriodStart: string }[]).filter((o) => o.recurringId === r.id);
    expect((await occ('2026-10-01', '2026-10-31'))[0]).toMatchObject({ occurrenceDate: '2026-10-20', nextPeriodStart: '2026-11-01' });

    // Change the amount, then the date: the amount edit is kept.
    await client.put(`${base}/2026-10-20`, { amountCents: 2999 });
    expect((await client.put(`${base}/2026-10-20`, { date: '2026-10-24' })).status).toBe(204);
    expect((await occ('2026-10-01', '2026-10-31'))[0]).toMatchObject({ date: '2026-10-24', amountCents: 2999, edited: true });

    // Defer it: October no longer has it; November has it as well as its own.
    expect((await client.post(`${base}/2026-10-20/move-to-next-period`)).body).toEqual({ date: '2026-11-01' });
    expect(await occ('2026-10-01', '2026-10-31')).toEqual([]);
    expect((await occ('2026-11-01', '2026-11-30')).map((o) => [o.occurrenceDate, o.date, o.amountCents, o.status])).toEqual([
      ['2026-10-20', '2026-11-01', 2999, 'upcoming'],
      ['2026-11-20', '2026-11-20', 2500, 'upcoming'],
    ]);

    // A skipped occurrence can be moved instead (the move replaces the skip).
    await client.post(`${base}/2026-11-20/skip`);
    expect((await client.post(`${base}/2026-11-20/move-to-next-period`)).body).toEqual({ date: '2026-12-01' });
    expect((await occ('2026-12-01', '2026-12-31')).map((o) => [o.occurrenceDate, o.status])).toEqual([
      ['2026-11-20', 'upcoming'],
      ['2026-12-20', 'upcoming'],
    ]);

    // Recorded ones stay put.
    await client.post(`${base}/2026-09-20/post`);
    expect((await client.post(`${base}/2026-09-20/move-to-next-period`)).status).toBe(409);
  });

  it('lets "mark paid" record what actually happened', async () => {
    const r = await netflix({ amountKind: 'ESTIMATE' });
    const draft = await client.get(`/api/recurring-transactions/${r.id}/occurrences/2026-10-20/draft`);
    expect(draft.body).toMatchObject({ date: '2026-10-20', amountCents: 2500, type: 'EXPENSE', description: 'Netflix' });
    const body = { ...draft.body, amountCents: 2799, date: '2026-10-21', splits: [{ categoryId: draft.body.splits[0].categoryId, amountCents: 2799 }] };
    const posted = await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-10-20/post`, body);
    expect(posted.body).toMatchObject({ amountCents: 2799, date: '2026-10-21', occurrenceDate: '2026-10-20' });
  });

  it('posts debt repayments and savings contributions with the usual splits', async () => {
    const mortgage = await createAccount(client, { name: 'Home loan', type: 'MORTGAGE', openingBalanceCents: 40000000 });
    const ids = await bucketIds(client);
    const emergency = await createAccount(client, { name: 'Emergency', type: 'SAVINGS', bucketTagId: ids.FIRE_EXTINGUISHER });
    const m = (await client.post('/api/recurring-transactions', { name: 'Mortgage', type: 'DEBT_REPAYMENT', amountCents: 250000, frequency: 'MONTHLY', startDate: '2026-10-01', accountId: main.id, toAccountId: mortgage.id })).body;
    expect(m.bucketKey).toBe('BILLS');
    const s = (await client.post('/api/recurring-transactions', { name: 'Save', type: 'SAVINGS_CONTRIBUTION', amountCents: 20000, frequency: 'FORTNIGHTLY', startDate: '2026-10-01', accountId: main.id, toAccountId: emergency.id, categoryId: await categoryId(client, 'Emergency fund') })).body;
    const mp = await client.post(`/api/recurring-transactions/${m.id}/occurrences/2026-10-01/post`);
    expect(mp.body.splits).toMatchObject([{ categoryName: 'Mortgage', amountCents: 250000 }]);
    const sp = await client.post(`/api/recurring-transactions/${s.id}/occurrences/2026-10-01/post`);
    expect(sp.body).toMatchObject({ type: 'SAVINGS_CONTRIBUTION', splits: [{ categoryName: 'Emergency fund' }] });
  });

  it('edits the series from a date onward', async () => {
    const r = await netflix();
    await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-09-20/post`);
    await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-11-20/post`);
    const body = { name: 'Netflix', type: 'EXPENSE', amountCents: 2899, frequency: 'MONTHLY', startDate: '2026-11-20', accountId: main.id, categoryId: r.categoryId };
    const res = await client.put(`/api/recurring-transactions/${r.id}?fromDate=2026-11-20`, body);
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe(r.id);
    const old = (await client.get(`/api/recurring-transactions/${r.id}`)).body;
    expect(old.endDate).toBe('2026-11-19');
    const occ = (await client.get('/api/recurring-transactions/occurrences?from=2026-09-01&to=2026-12-31')).body.items;
    expect(occ.map((o: { date: string; amountCents: number; status: string; recurringId: string }) => [o.date, o.amountCents, o.status, o.recurringId === r.id])).toEqual([
      ['2026-09-20', 2500, 'posted', true],
      ['2026-10-20', 2500, 'upcoming', true],
      ['2026-11-20', 2899, 'posted', false], // the posted occurrence moved to the new schedule
      ['2026-12-20', 2899, 'upcoming', false],
    ]);
  });

  it('keeps a counted schedule\'s total when split', async () => {
    const r = await netflix({ startDate: '2026-01-10', occurrenceCount: 6 });
    const body = { name: 'Netflix', type: 'EXPENSE', amountCents: 3000, frequency: 'MONTHLY', startDate: '2026-04-10', accountId: main.id, categoryId: r.categoryId };
    await client.put(`/api/recurring-transactions/${r.id}?fromDate=2026-04-10`, body);
    const occ = (await client.get('/api/recurring-transactions/occurrences?from=2026-01-01&to=2027-12-31')).body.items;
    expect(occ.map((o: { amountCents: number }) => o.amountCents)).toEqual([2500, 2500, 2500, 3000, 3000, 3000]);
  });

  it('deletes a schedule but keeps its posted transactions', async () => {
    const r = await netflix();
    const t = (await client.post(`/api/recurring-transactions/${r.id}/occurrences/2026-09-20/post`)).body;
    expect((await client.delete(`/api/recurring-transactions/${r.id}`)).status).toBe(204);
    expect((await client.get(`/api/transactions/${t.id}`)).body.recurringId).toBeNull();
  });

  it('limits the occurrence range', async () => {
    expect((await client.get('/api/recurring-transactions/occurrences?from=2026-01-01&to=2030-01-01')).status).toBe(400);
    expect((await client.get('/api/recurring-transactions/occurrences?from=2026-02-01&to=2026-01-01')).status).toBe(400);
  });
});

describe('auto-post', () => {
  it('posts due occurrences after 02:00 household time, from the day the schedule was created', async () => {
    clock.current = new Date('2026-10-07T13:00:00Z'); // 8 Oct 00:00 Melbourne
    const salary = (await client.post('/api/recurring-transactions', {
      name: 'Salary', type: 'INCOME', amountCents: 350000, frequency: 'FORTNIGHTLY', startDate: '2026-09-24', autoPost: true,
      accountId: main.id, categoryId: await categoryId(client, 'Salary and wages'),
    })).body;
    // 24 Sep is before the schedule existed, so it is not back-posted. 8 Oct waits for 02:00.
    expect(await app.services.recurring.autoPostDue()).toEqual({ posted: 0 });
    clock.current = new Date('2026-10-07T15:30:00Z'); // 8 Oct 02:30 Melbourne
    expect(await app.services.recurring.autoPostDue()).toEqual({ posted: 1 });

    // Running twice for the same day creates one transaction (spec §18).
    expect(await app.services.recurring.autoPostDue()).toEqual({ posted: 0 });
    await Promise.all([app.services.recurring.autoPostDue(), app.services.recurring.autoPostDue()]);
    const txs = await testDb().transaction.findMany({ where: { recurringId: salary.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.occurrenceDate!.toISOString().slice(0, 10)).toBe('2026-10-08');
    expect(txs[0]!.createdById).toBeNull();

    // Catches up after downtime.
    clock.current = new Date('2026-11-06T00:00:00Z');
    expect(await app.services.recurring.autoPostDue()).toEqual({ posted: 2 }); // 22 Oct and 5 Nov
  });

  it('does not re-post an auto-posted transaction the user deleted', async () => {
    clock.current = new Date('2026-10-07T13:00:00Z');
    const r = (await client.post('/api/recurring-transactions', {
      name: 'Salary', type: 'INCOME', amountCents: 350000, frequency: 'FORTNIGHTLY', startDate: '2026-10-08', autoPost: true,
      accountId: main.id, categoryId: await categoryId(client, 'Salary and wages'),
    })).body;
    clock.current = new Date('2026-10-08T00:00:00Z');
    await app.services.recurring.autoPostDue();
    const t = await testDb().transaction.findFirstOrThrow({ where: { recurringId: r.id } });
    expect((await client.delete(`/api/transactions/${t.id}`)).status).toBe(204);
    expect(await app.services.recurring.autoPostDue()).toEqual({ posted: 0 });
    const occ = (await client.get('/api/recurring-transactions/occurrences?from=2026-10-01&to=2026-10-10')).body.items;
    expect(occ[0].status).toBe('skipped');
  });

  it('runs as a scheduled job', async () => {
    const { buildJobs } = await import('../../jobs/index.js');
    expect(buildJobs(app).map((j) => j.name)).toContain('recurring-auto-post');
  });
});
