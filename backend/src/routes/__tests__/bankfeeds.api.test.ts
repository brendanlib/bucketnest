import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { categoryId, Client, createAccount, createTestApp, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';
import { open } from '../../lib/crypto.js';

const TOKEN = 'up:yeah:abc123DEF456';

/** A tiny stand-in for api.up.com.au: two accounts and their transactions. */
class FakeUp {
  accounts = [
    { id: 'up-spend', name: 'Spending', type: 'TRANSACTIONAL', balance: 300000 },
    { id: 'up-save', name: 'Rainy day', type: 'SAVER', balance: 50000 },
  ];
  txns: Record<string, { id: string; status: 'HELD' | 'SETTLED'; description: string; amount: number; createdAt: string; transferAccount?: string }[]> = {
    'up-spend': [
      { id: 't1', status: 'SETTLED', description: 'Dukes Coffee', amount: -450, createdAt: '2026-10-02T08:15:00+10:00' },
      { id: 't2', status: 'SETTLED', description: 'Acme Pty Ltd', amount: 200000, createdAt: '2026-10-03T09:00:00+10:00' },
      { id: 't3', status: 'SETTLED', description: 'Transfer to Rainy day', amount: -10000, createdAt: '2026-10-04T12:00:00+10:00', transferAccount: 'up-save' },
      { id: 't4', status: 'HELD', description: 'Woolworths', amount: -2000, createdAt: '2026-10-05T18:00:00+10:00' },
      { id: 't0', status: 'SETTLED', description: 'Before sync start', amount: -999, createdAt: '2026-09-20T10:00:00+10:00' },
    ],
    'up-save': [{ id: 's1', status: 'SETTLED', description: 'Transfer from Spending', amount: 10000, createdAt: '2026-10-04T12:00:00+10:00', transferAccount: 'up-spend' }],
  };
  requests: string[] = [];
  status = 200;

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    this.requests.push(url.pathname + url.search);
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    if (auth !== `Bearer ${TOKEN}` || this.status === 401) return new Response('{}', { status: 401 });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/v1/util/ping') return json({ meta: { id: 'x', statusEmoji: '⚡️' } });
    if (url.pathname === '/api/v1/accounts')
      return json({ data: this.accounts.map((a) => ({ id: a.id, attributes: { displayName: a.name, accountType: a.type, balance: { valueInBaseUnits: a.balance } } })), links: { next: null } });
    const m = /^\/api\/v1\/accounts\/([^/]+)\/transactions$/.exec(url.pathname);
    if (m) {
      const since = url.searchParams.get('filter[since]')!;
      const status = url.searchParams.get('filter[status]');
      const rows = (this.txns[m[1]!] ?? []).filter((t) => new Date(t.createdAt) >= new Date(since) && (!status || t.status === status));
      // Two pages, to exercise links.next.
      const page = Number(url.searchParams.get('page[after]') ?? 0);
      const slice = rows.slice(page * 2, page * 2 + 2);
      const next = rows.length > page * 2 + 2 ? `https://api.up.com.au${url.pathname}?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), 'page[after]': String(page + 1) })}` : null;
      return json({
        data: slice.map((t) => ({
          id: t.id,
          attributes: { status: t.status, description: t.description, rawText: null, message: null, amount: { valueInBaseUnits: t.amount }, createdAt: t.createdAt, settledAt: t.status === 'SETTLED' ? t.createdAt : null },
          relationships: { transferAccount: { data: t.transferAccount ? { type: 'accounts', id: t.transferAccount } : null } },
        })),
        links: { next },
      });
    }
    return new Response('{}', { status: 404 });
  };
}

let app: FastifyInstance;
let client: Client;
let up: FakeUp;
const clock = new TestClock();

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-06T01:00:00Z');
  up = new FakeUp();
  // Through a wrapper, so a test can swap the fake's behaviour.
  app = await createTestApp({ clock, fetch: (i, n) => up.fetch(i, n) });
  ({ client } = await registerUser(app));
});
afterEach(async () => {
  await app.close();
});

const connect = async () => (await client.post('/api/bank-connections/up', { token: TOKEN })).body;
const feed = (c: { accounts: { id: string; name: string }[] }, name: string) => c.accounts.find((a) => a.name === name)!;
const accounts = async () => (await client.get('/api/accounts')).body.items as { id: string; name: string; balanceCents: number }[];

describe('Up Bank connection', () => {
  it('checks the token with Up and stores it encrypted', async () => {
    expect((await client.post('/api/bank-connections/up', { token: 'not-a-token' })).body.error.message).toMatch(/starts with up:yeah:/);
    expect((await client.post('/api/bank-connections/up', { token: 'up:yeah:wrong' })).body.error.message).toMatch(/didn’t accept the access token/);

    const c = await connect();
    expect(c).toMatchObject({ provider: 'UP', status: 'ACTIVE', lastSyncAt: null });
    expect(c.accounts.map((a: { name: string; bankBalanceCents: number; accountId: null }) => [a.name, a.bankBalanceCents, a.accountId])).toEqual([
      ['Rainy day', 50000, null],
      ['Spending', 300000, null],
    ]);
    const row = await testDb().bankConnection.findFirstOrThrow();
    expect(row.tokenCiphertext).not.toContain('abc123');
    expect(open('test-secret-that-is-at-least-32-characters-long', 'bank-token', row.tokenCiphertext)).toBe(TOKEN);
    expect(JSON.stringify((await client.get('/api/bank-connections')).body)).not.toContain('up:yeah');
    expect(JSON.stringify((await client.get('/api/export?format=json')).body)).not.toContain('up:yeah');
  });

  it('imports settled transactions into new accounts whose balances match Up, transfers once', async () => {
    const schedule = { name: 'Pay', type: 'INCOME', amountCents: 200000, frequency: 'FORTNIGHTLY', startDate: '2026-10-03' };
    let c = await connect();
    c = (await client.put(`/api/bank-connections/accounts/${feed(c, 'Spending').id}`, { createAccount: true, syncFrom: '2026-10-01' })).body;
    c = (await client.put(`/api/bank-connections/accounts/${feed(c, 'Rainy day').id}`, { createAccount: true, syncFrom: '2026-10-01' })).body;
    const spend = (await accounts()).find((a) => a.name === 'Up Spending')!;
    const save = (await accounts()).find((a) => a.name === 'Up Rainy day')!;
    // Opening balances: Up's balance less everything since the start date, pending included.
    expect(spend.balanceCents).toBe(300000 - (-450 + 200000 - 10000 - 2000));
    await client.post('/api/recurring-transactions', { ...schedule, accountId: spend.id, categoryId: await categoryId(client, 'Salary and wages') });
    await client.post('/api/rules', { matchValue: 'DUKES', setCategoryId: await categoryId(client, 'Coffee') });

    const res = await client.post(`/api/bank-connections/${c.id}/sync`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ accounts: 2, imported: 3, merged: 1, matched: 1 });
    const after = await accounts();
    // Spending is $20 ahead of Up until the pending Woolworths settles; the saver matches exactly.
    expect(after.find((a) => a.id === spend.id)!.balanceCents).toBe(302000);
    expect(after.find((a) => a.id === save.id)!.balanceCents).toBe(50000);

    const tx = (await client.get('/api/transactions?pageSize=50')).body.items as { description: string; type: string; splits: { categoryName: string | null }[]; recurringId: string | null }[];
    expect(tx.map((t) => t.description).sort()).toEqual(['Acme Pty Ltd', 'Dukes Coffee', 'Transfer to Rainy day']);
    expect(tx.find((t) => t.description === 'Dukes Coffee')!.splits[0]!.categoryName).toBe('Coffee'); // rule applied
    expect(tx.find((t) => t.description === 'Acme Pty Ltd')!.recurringId).not.toBeNull(); // matched the pay schedule
    expect(tx.find((t) => t.description === 'Transfer to Rainy day')!.type).toBe('TRANSFER');

    // The pending payment settles; the next sync picks up only that.
    up.txns['up-spend']![3]!.status = 'SETTLED';
    clock.advance(2 * 60_000);
    expect((await client.post(`/api/bank-connections/${c.id}/sync`)).body.summary).toMatchObject({ imported: 1, merged: 0 });
    expect((await accounts()).find((a) => a.id === spend.id)!.balanceCents).toBe(300000);
    clock.advance(2 * 60_000);
    expect((await client.post(`/api/bank-connections/${c.id}/sync`)).body.summary).toMatchObject({ imported: 0, merged: 0 });

    // Each sync is an undoable import batch.
    const batches = (await client.get('/api/import/batches')).body.items;
    expect(batches.map((b: { fileName: string }) => b.fileName)).toEqual(expect.arrayContaining(['Up: Spending', 'Up: Rainy day']));
  });

  it('links to an existing account and leaves unlinked accounts alone', async () => {
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION', openingBalanceCents: 100000, openingDate: '2026-09-01' });
    let c = await connect();
    expect((await client.put(`/api/bank-connections/accounts/${feed(c, 'Spending').id}`, { accountId: main.id })).body.error.message).toMatch(/date to import from/);
    c = (await client.put(`/api/bank-connections/accounts/${feed(c, 'Spending').id}`, { accountId: main.id, syncFrom: '2026-10-01' })).body;
    expect(feed(c, 'Spending')).toMatchObject({ accountId: main.id, accountName: 'Main', syncFrom: '2026-10-01' });
    expect((await client.put(`/api/bank-connections/accounts/${feed(c, 'Rainy day').id}`, { accountId: main.id, syncFrom: '2026-10-01' })).body.error.code).toBe('ACCOUNT_LINKED');
    const res = await client.post(`/api/bank-connections/${c.id}/sync`);
    expect(res.body.summary).toMatchObject({ accounts: 1, imported: 3 });
    // The saver isn't linked, so the transfer to it stays an uncategorised expense to sort out.
    expect(up.requests.some((r) => r.includes('up-save/transactions'))).toBe(false);
  });

  it('never sends the token anywhere but Up, even if a page link points elsewhere', async () => {
    let c = await connect();
    c = (await client.put(`/api/bank-connections/accounts/${feed(c, 'Spending').id}`, { accountId: (await createAccount(client, { name: 'Main', type: 'TRANSACTION' })).id, syncFrom: '2026-10-01' })).body;
    const real = up.fetch;
    up.fetch = async (input, init) => {
      const res = await real(input, init);
      const body = (await res.json()) as { links?: { next: string | null } };
      if (body.links?.next) body.links.next = 'https://evil.example.com/steal';
      return new Response(JSON.stringify(body), { status: res.status });
    };
    const res = await client.post(`/api/bank-connections/${c.id}/sync`);
    expect(res.body.error.message).toMatch(/another server/);
    expect(up.requests.some((r) => r.includes('steal'))).toBe(false);
  });

  it('marks the connection when Up rejects the token, and the job skips it', async () => {
    const c = await connect();
    up.status = 401;
    const res = await client.post(`/api/bank-connections/${c.id}/sync`);
    expect(res.status).toBe(400);
    const after = (await client.get('/api/bank-connections')).body.items[0];
    expect(after).toMatchObject({ status: 'ERROR', lastError: expect.stringMatching(/revoked/) });
    expect(await app.services.bankFeeds.syncAll()).toEqual({ connections: 0, ok: 0 });
  });

  it('keeps imported transactions when disconnected, and keeps connections to their household', async () => {
    let c = await connect();
    c = (await client.put(`/api/bank-connections/accounts/${feed(c, 'Spending').id}`, { createAccount: true, syncFrom: '2026-10-01' })).body;
    await client.post(`/api/bank-connections/${c.id}/sync`);
    const other = (await registerUser(app)).client;
    expect((await other.post(`/api/bank-connections/${c.id}/sync`)).status).toBe(404);
    expect((await other.put(`/api/bank-connections/accounts/${feed(c, 'Spending').id}`, { accountId: null })).status).toBe(404);
    expect((await other.request('DELETE', `/api/bank-connections/${c.id}`)).status).toBe(404);
    expect((await client.request('DELETE', `/api/bank-connections/${c.id}`)).status).toBe(204);
    expect(await testDb().bankConnection.count()).toBe(0);
    expect((await client.get('/api/transactions')).body.total).toBe(3);
  });
});

describe('folder import', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hb-inbox-'));
    await app.close();
    app = await createTestApp({ clock, env: { IMPORT_INBOX_DIR: dir } });
    ({ client } = await registerUser(app));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const CSV = 'Date,Description,Amount\n02/10/2026,WOOLWORTHS 1234,-45.20\n03/10/2026,SALARY,2000.00\n';
  async function drop(folder: string, name: string, body: string) {
    const path = join(dir, folder, name);
    await writeFile(path, body);
    const old = new Date(Date.now() - 120_000);
    await utimes(path, old, old);
    clock.current = new Date();
  }

  it('imports files dropped into an account’s folder once its layout is known', async () => {
    const main = await createAccount(client, { name: 'Credit Union Everyday', type: 'TRANSACTION', openingBalanceCents: 0, openingDate: '2026-09-01' });
    const inbox = (await client.post(`/api/import-inbox/${main.id}`)).body;
    const folder = inbox.accounts.find((a: { accountId: string }) => a.accountId === main.id).folder as string;
    expect(folder).toMatch(/^credit-union-everyday-[0-9a-f]{6}$/);
    expect(await readdir(dir)).toEqual([folder]);

    // No saved layout yet: the file goes to failed/ with the reason beside it.
    await drop(folder, 'oct.csv', CSV);
    await app.services.inbox.scan();
    const failed = await readdir(join(dir, folder, 'failed'));
    expect(failed.find((n) => n.endsWith('.error.txt'))).toBeDefined();
    expect(await readFile(join(dir, folder, 'failed', failed.find((n) => n.endsWith('.error.txt'))!), 'utf8')).toMatch(/Import one file from this bank by hand first/);

    // One import by hand saves the layout; after that, dropped files import themselves.
    await client.post('/api/import/commit', { accountId: main.id, fileName: 'sep.csv', csv: 'Date,Description,Amount\n28/09/2026,COFFEE,-4.50\n' });
    await drop(folder, 'oct.csv', CSV);
    expect(await app.services.inbox.scan()).toEqual({ files: 1 });
    expect((await readdir(join(dir, folder, 'imported')))[0]).toMatch(/-oct\.csv$/);
    expect((await client.get(`/api/accounts/${main.id}`)).body.balanceCents).toBe(-450 - 4520 + 200000);

    // The same file again adds nothing.
    await drop(folder, 'oct-again.csv', CSV);
    await app.services.inbox.scan();
    expect((await client.get(`/api/accounts/${main.id}`)).body.balanceCents).toBe(-450 - 4520 + 200000);

    // A file still being written waits for the next scan.
    await writeFile(join(dir, folder, 'fresh.csv'), CSV);
    clock.current = new Date();
    expect(await app.services.inbox.scan()).toEqual({ files: 0 });

    expect((await client.request('DELETE', `/api/import-inbox/${main.id}`)).body.accounts.find((a: { accountId: string }) => a.accountId === main.id).folder).toBeNull();
  });

  it('is off unless the server sets IMPORT_INBOX_DIR', async () => {
    await app.close();
    app = await createTestApp({ clock });
    ({ client } = await registerUser(app));
    const main = await createAccount(client, { name: 'Main', type: 'TRANSACTION' });
    expect((await client.get('/api/import-inbox')).body.enabled).toBe(false);
    expect((await client.post(`/api/import-inbox/${main.id}`)).body.error.message).toMatch(/IMPORT_INBOX_DIR/);
  });
});
