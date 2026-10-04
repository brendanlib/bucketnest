import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createTestApp, FakeMailer, PASSWORD, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase();
});
afterEach(async () => {
  await app?.close();
});

describe('registration', () => {
  it('registers, logs in automatically and seeds the household', async () => {
    app = await createTestApp();
    const { client, me } = await registerUser(app, { email: 'Alex@Example.com', name: 'Alex' });
    expect(me.user.email).toBe('alex@example.com');
    expect(me.household).toMatchObject({ role: 'OWNER', currency: 'AUD', locale: 'en-AU', timezone: 'Australia/Melbourne' });

    const meAgain = await client.get('/api/auth/me');
    expect(meAgain.status).toBe(200);
    expect(meAgain.body.user.name).toBe('Alex');

    const buckets = await client.get('/api/buckets');
    expect(buckets.body.items.map((b: { name: string; percentage: string }) => [b.name, b.percentage])).toEqual([
      ['Bills', '60.00'],
      ['Smile', '10.00'],
      ['Splurge', '10.00'],
      ['Fire Extinguisher', '20.00'],
    ]);
    const cats = await client.get('/api/categories');
    const names = cats.body.items.filter((c: { isGroup: boolean }) => !c.isGroup).map((c: { name: string }) => c.name);
    expect(names).toContain('Private health insurance');
    expect(names).not.toContain('Health insurance');
    expect(names).toContain('Interest and fees');
    expect(names).toContain('Salary and wages');
  });

  it('uses a session cookie that is HttpOnly and SameSite=Lax', async () => {
    app = await createTestApp();
    const client = new Client(app);
    const res = await client.post('/api/auth/register', { email: 'a@example.com', name: 'A', password: PASSWORD });
    const cookie = res.cookies.find((c) => c.name === 'hb_session') as Record<string, unknown> | undefined;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(String(cookie!.value)).toHaveLength(43);
  });

  it('stores only a hash of the session token', async () => {
    app = await createTestApp();
    const { client } = await registerUser(app);
    const token = client.cookies.get('hb_session')!;
    const sessions = await testDb().session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toContain(token);
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects duplicate emails case-insensitively', async () => {
    app = await createTestApp();
    await registerUser(app, { email: 'dup@example.com' });
    const res = await new Client(app).post('/api/auth/register', { email: 'DUP@example.com', name: 'X', password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects short and common passwords', async () => {
    app = await createTestApp();
    const c = new Client(app);
    const short = await c.post('/api/auth/register', { email: 'a@example.com', name: 'A', password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.message).toMatch(/12 characters/);
    const common = await c.post('/api/auth/register', { email: 'a@example.com', name: 'A', password: 'password1234' });
    expect(common.status).toBe(400);
    expect(common.body.error.message).toMatch(/too common/);
  });

  describe('registration switch', () => {
    it('blank: open only until the first user exists', async () => {
      app = await createTestApp({ env: { ALLOW_REGISTRATION: '' } });
      const status = await new Client(app).get('/api/auth/registration');
      expect(status.body.open).toBe(true);
      await registerUser(app);
      const res = await new Client(app).post('/api/auth/register', { email: 'second@example.com', name: 'B', password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
      expect((await new Client(app).get('/api/auth/registration')).body.open).toBe(false);
    });

    it('false: closed even for the first user', async () => {
      app = await createTestApp({ env: { ALLOW_REGISTRATION: 'false' } });
      const res = await new Client(app).post('/api/auth/register', { email: 'a@example.com', name: 'A', password: PASSWORD });
      expect(res.status).toBe(403);
    });

    it('true: stays open', async () => {
      app = await createTestApp({ env: { ALLOW_REGISTRATION: 'true' } });
      await registerUser(app);
      await registerUser(app);
      expect(await testDb().user.count()).toBe(2);
    });

    it('blank: concurrent first registrations create only one user', async () => {
      app = await createTestApp({ env: { ALLOW_REGISTRATION: '' } });
      const attempts = await Promise.all(
        [1, 2, 3].map((i) => new Client(app).post('/api/auth/register', { email: `race${i}@example.com`, name: 'R', password: PASSWORD })),
      );
      expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await testDb().user.count()).toBe(1);
    });
  });
});

describe('login and sessions', () => {
  it('logs in, logs out and rejects bad credentials with one message', async () => {
    app = await createTestApp();
    const { email } = await registerUser(app);
    const c = new Client(app);
    const wrong = await c.post('/api/auth/login', { email, password: 'wrong password here' });
    const unknown = await c.post('/api/auth/login', { email: 'nobody@example.com', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);

    const ok = await c.post('/api/auth/login', { email: email.toUpperCase(), password: PASSWORD });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(200);

    const out = await c.post('/api/auth/logout');
    expect(out.status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('rotates the session ID on login', async () => {
    app = await createTestApp();
    const { client, email } = await registerUser(app);
    const before = client.cookies.get('hb_session');
    await client.post('/api/auth/login', { email, password: PASSWORD });
    expect(client.cookies.get('hb_session')).not.toBe(before);
    expect(await testDb().session.count()).toBe(1);
  });

  it('expires sessions after the idle timeout and the absolute timeout', async () => {
    const clock = new TestClock();
    app = await createTestApp({ clock });
    const { client } = await registerUser(app);
    clock.advance(6 * 86_400_000);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    clock.advance(6 * 86_400_000); // 6 days idle since last touch: still within 7
    expect((await client.get('/api/auth/me')).status).toBe(200);
    clock.advance(8 * 86_400_000); // idle > 7 days
    expect((await client.get('/api/auth/me')).status).toBe(401);

    // Absolute: keep it busy every day, still ends at 30 days.
    const { client: busy } = await registerUser(app);
    for (let day = 0; day < 29; day++) {
      clock.advance(86_400_000);
      expect((await busy.get('/api/auth/me')).status).toBe(200);
    }
    clock.advance(2 * 86_400_000);
    expect((await busy.get('/api/auth/me')).status).toBe(401);
  });

  it('lists and revokes sessions', async () => {
    app = await createTestApp();
    const { client, email } = await registerUser(app);
    const other = new Client(app);
    await other.post('/api/auth/login', { email, password: PASSWORD });

    const list = await client.get('/api/auth/sessions');
    expect(list.body.items).toHaveLength(2);
    const otherSession = list.body.items.find((s: { current: boolean }) => !s.current);
    expect((await client.delete(`/api/auth/sessions/${otherSession.id}`)).status).toBe(204);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await client.get('/api/auth/me')).status).toBe(200);
  });

  it('cannot revoke another user\'s session', async () => {
    app = await createTestApp();
    const a = await registerUser(app);
    const b = await registerUser(app);
    const bSessions = await b.client.get('/api/auth/sessions');
    const res = await a.client.delete(`/api/auth/sessions/${bSessions.body.items[0].id}`);
    expect(res.status).toBe(404);
  });

  it('changing the password ends all other sessions and rotates the current one', async () => {
    app = await createTestApp();
    const { client, email } = await registerUser(app);
    const other = new Client(app);
    await other.post('/api/auth/login', { email, password: PASSWORD });
    const before = client.cookies.get('hb_session');

    const res = await client.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'a whole new passphrase' });
    expect(res.status).toBe(204);
    expect(client.cookies.get('hb_session')).not.toBe(before);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(app).post('/api/auth/login', { email, password: 'a whole new passphrase' })).status).toBe(200);
  });

  it('requires the correct current password to change it', async () => {
    app = await createTestApp();
    const { client } = await registerUser(app);
    const res = await client.post('/api/auth/change-password', { currentPassword: 'not my password!', newPassword: 'a whole new passphrase' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('password reset', () => {
  it('emails a single-use token valid for 30 minutes', async () => {
    const mailer = new FakeMailer();
    const clock = new TestClock();
    app = await createTestApp({ mailer, clock });
    const { email } = await registerUser(app);
    const c = new Client(app);

    const known = await c.post('/api/auth/forgot-password', { email });
    const unknown = await c.post('/api/auth/forgot-password', { email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(mailer.sent).toHaveLength(1);

    const token = decodeURIComponent(/token=([^\s]+)/.exec(mailer.sent[0]!.text)![1]!);
    const stored = await testDb().passwordResetToken.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(token);

    expect((await c.post('/api/auth/reset-password', { token, password: 'my brand new passphrase' })).status).toBe(204);
    const again = await c.post('/api/auth/reset-password', { token, password: 'another new passphrase' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
    expect((await c.post('/api/auth/login', { email, password: 'my brand new passphrase' })).status).toBe(200);

    await c.post('/api/auth/forgot-password', { email });
    const token2 = decodeURIComponent(/token=([^\s]+)/.exec(mailer.sent[1]!.text)![1]!);
    clock.advance(31 * 60_000);
    expect((await c.post('/api/auth/reset-password', { token: token2, password: 'too late passphrase' })).status).toBe(400);
  });

  it('ends existing sessions on reset', async () => {
    const mailer = new FakeMailer();
    app = await createTestApp({ mailer });
    const { client, email } = await registerUser(app);
    await new Client(app).post('/api/auth/forgot-password', { email });
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mailer.sent[0]!.text)![1]!);
    await new Client(app).post('/api/auth/reset-password', { token, password: 'my brand new passphrase' });
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('sets a password from the CLI service and signs the user out', async () => {
    app = await createTestApp();
    const { client, email } = await registerUser(app);
    await app.services.auth.setPasswordByEmail(email, 'cli generated pass 1');
    expect((await client.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(app).post('/api/auth/login', { email, password: 'cli generated pass 1' })).status).toBe(200);
  });

  it('accepts requests without SMTP but sends nothing', async () => {
    app = await createTestApp();
    const { email } = await registerUser(app);
    expect((await new Client(app).get('/api/auth/registration')).body.passwordReset).toBe('cli');
    expect((await new Client(app).post('/api/auth/forgot-password', { email })).status).toBe(202);
    expect(await testDb().passwordResetToken.count()).toBe(0);
  });
});

describe('request protection', () => {
  it('rejects non-GET requests without a CSRF token', async () => {
    app = await createTestApp();
    const { client } = await registerUser(app);
    client.sendCsrf = false;
    const res = await client.post('/api/categories', { name: 'X', kind: 'INCOME' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a CSRF token that does not match the cookie', async () => {
    app = await createTestApp();
    const { client } = await registerUser(app);
    client.csrf = 'f'.repeat(64);
    expect((await client.post('/api/categories', { name: 'X', kind: 'INCOME' })).status).toBe(403);
  });

  it('rejects requests from another origin, or with no origin', async () => {
    app = await createTestApp();
    const { client } = await registerUser(app);
    client.origin = 'https://evil.example';
    expect((await client.post('/api/categories', { name: 'X', kind: 'INCOME' })).body.error.code).toBe('BAD_ORIGIN');
    client.origin = null;
    expect((await client.post('/api/categories', { name: 'X', kind: 'INCOME' })).status).toBe(403);
  });

  it('rate-limits login per IP', async () => {
    app = await createTestApp({ rateLimits: { auth: 5 } });
    const c = new Client(app);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await c.post('/api/auth/login', { email: `x${i}@example.com`, password: 'wrong password!!' })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('backs off repeated failures for one email across IPs', async () => {
    app = await createTestApp();
    const { email } = await registerUser(app);
    const c = new Client(app);
    for (let i = 0; i < 3; i++) await c.post('/api/auth/login', { email, password: 'wrong password!!' });
    const blocked = await c.post('/api/auth/login', { email, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rate-limits the API per session', async () => {
    app = await createTestApp({ rateLimits: { api: 5 } });
    const { client } = await registerUser(app);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await client.get('/api/buckets')).status);
    expect(statuses).toContain(429);
  });

  it('requires a login for data routes and the API docs', async () => {
    app = await createTestApp();
    const c = new Client(app);
    for (const url of ['/api/accounts', '/api/transactions', '/api/categories', '/api/settings', '/api/docs', '/api/docs/json']) {
      expect((await c.get(url)).status, url).toBe(401);
    }
    const { client } = await registerUser(app);
    const docs = await client.get('/api/docs/json');
    expect(docs.status).toBe(200);
    expect(docs.body.paths['/api/transactions']).toBeDefined();
  });

  it('returns 400 with details for invalid input and rejects unknown fields', async () => {
    app = await createTestApp();
    const { client } = await registerUser(app);
    const res = await client.post('/api/accounts', { name: '', type: 'NOPE', openingBalanceCents: 1.5, openingDate: '2026-02-30', hacker: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });

  it('sends security headers', async () => {
    app = await createTestApp();
    const res = await new Client(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reports health and readiness', async () => {
    app = await createTestApp();
    const c = new Client(app);
    expect((await c.get('/api/health')).body).toEqual({ status: 'ok' });
    expect((await c.get('/api/health/ready')).body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('returns the standard error shape for unknown routes', async () => {
    app = await createTestApp();
    const res = await new Client(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});

describe('client IP behind proxies', () => {
  it('uses X-Forwarded-For only from trusted hops', async () => {
    app = await createTestApp({
      env: { TRUST_PROXY: '1', INTERNAL_PROXY_HOPS: '1' },
      beforeReady: (a) => a.get('/api/__ip', { config: { rateLimit: false } }, async (r) => ({ ip: r.ip })),
    });
    const res = await app.inject({ method: 'GET', url: '/api/__ip', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.0.0.2' } });
    // nginx (socket) and the user's proxy (10.0.0.2) are trusted; the spoofed 6.6.6.6 is not.
    expect(JSON.parse(res.body).ip).toBe('203.0.113.7');
  });

  it('without TRUST_PROXY every request appears to come from the proxy', async () => {
    app = await createTestApp({
      env: { INTERNAL_PROXY_HOPS: '1' },
      beforeReady: (a) => a.get('/api/__ip', { config: { rateLimit: false } }, async (r) => ({ ip: r.ip })),
    });
    const res = await app.inject({ method: 'GET', url: '/api/__ip', headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.2' } });
    expect(JSON.parse(res.body).ip).toBe('10.0.0.2');
  });
});
