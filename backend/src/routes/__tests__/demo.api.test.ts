import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createTestApp, PASSWORD, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';

let app: FastifyInstance;
const clock = new TestClock();

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-09T01:00:00Z');
});
afterEach(async () => {
  await app.close();
});

const demoApp = (env: Record<string, string> = {}) => createTestApp({ clock, env: { DEMO_MODE: 'true', SMTP_HOST: 'smtp.example.com', ...env }, rateLimits: { api: 300, auth: 5 } });

describe('public demo', () => {
  it('gives each visitor their own signed-in sample household', async () => {
    app = await demoApp();
    const info = (await new Client(app).get('/api/auth/registration')).body;
    expect(info).toMatchObject({ open: false, passwordReset: 'cli', demo: true, sourceUrl: expect.stringContaining('github.com'), websiteUrl: 'https://bucketnest.org' });

    const a = new Client(app);
    const res = await a.post('/api/demo/start');
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ isDemo: true, email: expect.stringMatching(/^visitor-[0-9a-f]{12}@demo\.bucketnest\.invalid$/) });
    expect((await a.get('/api/transactions')).body.total).toBeGreaterThan(500);

    const b = new Client(app);
    await b.post('/api/demo/start');
    // Separate sandboxes: a change in one isn't in the other.
    const aAccount = (await a.get('/api/accounts')).body.items[0];
    await a.put(`/api/accounts/${aAccount.id}`, { ...pick(aAccount), name: 'Renamed by A' });
    expect((await b.get('/api/accounts')).body.items.map((x: { name: string }) => x.name)).not.toContain('Renamed by A');
    expect(await testDb().household.count()).toBe(2);
  }, 60_000);

  it('switches off what reaches outside the sandbox, and takes no sign-ups', async () => {
    app = await demoApp();
    const c = new Client(app);
    await c.post('/api/demo/start');
    for (const [url, body] of [
      ['/api/bank-connections/up', { token: 'up:yeah:abc' }],
      ['/api/household/invites', {}],
      ['/api/auth/mfa/setup', { password: 'x' }],
      ['/api/auth/change-password', { currentPassword: 'x', newPassword: 'y' }],
    ] as const) {
      const r = await c.post(url, body);
      expect([url, r.status, r.body.error?.code]).toEqual([url, 403, 'DEMO_DISABLED']);
    }
    expect((await new Client(app).post('/api/auth/register', { email: 'x@example.com', name: 'X', password: PASSWORD })).status).toBe(403);
    // Everything inside the sandbox works.
    expect((await c.get('/api/reports/forecast?months=3')).status).toBe(200);
  }, 60_000);

  it('deletes sandboxes after the TTL, and caps how many run at once', async () => {
    app = await demoApp({ DEMO_TTL_HOURS: '1', DEMO_MAX_ACTIVE: '2' });
    const c1 = new Client(app);
    await c1.post('/api/demo/start');
    await new Client(app).post('/api/demo/start');
    const busy = await new Client(app).post('/api/demo/start');
    expect([busy.status, busy.body.error.code]).toEqual([503, 'DEMO_BUSY']);

    expect(await app.demo.cleanup()).toEqual({ removed: 0 });
    clock.advance(61 * 60_000);
    expect(await app.demo.cleanup()).toEqual({ removed: 2 });
    expect(await testDb().household.count()).toBe(0);
    expect(await testDb().user.count()).toBe(0);
    expect((await c1.get('/api/auth/me')).status).toBe(401);
  }, 60_000);

  it('doesn’t exist on ordinary servers, and never touches real accounts', async () => {
    app = await createTestApp({ clock });
    const { client } = await registerUser(app);
    expect((await new Client(app).post('/api/demo/start')).status).toBe(404);
    expect((await client.get('/api/auth/me')).body.user.isDemo).toBe(false);
    expect((await new Client(app).get('/api/auth/registration')).body.demo).toBe(false);
    // Cleanup on a non-demo server removes nothing.
    clock.advance(30 * 86_400_000);
    expect(await app.demo.cleanup()).toEqual({ removed: 0 });
    expect(await testDb().user.count()).toBe(1);
  });
});

function pick(a: Record<string, unknown>) {
  const keys = ['name', 'type', 'institution', 'openingBalanceCents', 'openingDate', 'last4', 'bucketTagId', 'includeInBudget', 'includeInNetWorth', 'repaymentTreatment', 'offsetForAccountId', 'notes'];
  return Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
}
