import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createTestApp, FakeMailer, PASSWORD, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';
import { stepAt, totpCode } from '../../lib/totp.js';

let app: FastifyInstance;
let client: Client;
let email: string;
let secret: string;
const clock = new TestClock();
const mailer = new FakeMailer();
const code = (offsetSteps = 0) => totpCode(secret, stepAt(clock.now().getTime()) + offsetSteps);

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-07T01:00:00Z');
  mailer.sent = [];
  app = await createTestApp({ clock, mailer });
  ({ client, email } = await registerUser(app));
});
afterEach(async () => {
  await app.close();
});

/** Turns two-step sign-in on for the test user; returns the recovery codes. */
async function turnOn(): Promise<string[]> {
  const setup = await client.post('/api/auth/mfa/setup', { password: PASSWORD });
  expect(setup.status).toBe(200);
  secret = setup.body.secret;
  const res = await client.post('/api/auth/mfa/enable', { code: code() });
  expect(res.status).toBe(200);
  clock.advance(30_000); // the setup code's step is used
  return res.body.recoveryCodes;
}

async function passwordStep(c = new Client(app)) {
  const res = await c.post('/api/auth/login', { email, password: PASSWORD });
  return { c, res };
}

describe('TOTP two-step sign-in', () => {
  it('is set up with the password, a scanned secret and a first code', async () => {
    expect((await client.get('/api/auth/mfa')).body).toEqual({ enabled: false, enabledAt: null, recoveryCodesLeft: 0 });
    expect((await client.post('/api/auth/mfa/setup', { password: 'wrong password here' })).body.error.code).toBe('INVALID_CREDENTIALS');
    const setup = await client.post('/api/auth/mfa/setup', { password: PASSWORD });
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUri).toContain(`secret=${setup.body.secret}`);
    expect(setup.body.otpauthUri).toContain('issuer=Home+Budget');
    secret = setup.body.secret;
    // Still off until a code confirms it.
    expect((await passwordStep()).res.body.household).toBeDefined();

    const other = (await passwordStep()).c; // another signed-in device
    expect((await client.post('/api/auth/mfa/enable', { code: '000000' })).body.error.code).toBe('INVALID_CODE');
    const on = await client.post('/api/auth/mfa/enable', { code: code() });
    expect(on.body.recoveryCodes).toHaveLength(10);
    expect((await client.get('/api/auth/mfa')).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    expect((await client.get('/api/auth/me')).status).toBe(200); // this device stays signed in
    expect((await other.get('/api/auth/me')).status).toBe(401); // others are signed out
    expect(mailer.sent.at(-1)!.subject).toBe('Two-step sign-in is on');

    // Stored encrypted and hashed, never in the clear.
    const user = await testDb().user.findFirstOrThrow({ where: { email } });
    expect(user.totpSecret).not.toContain(secret);
    const codes = await testDb().recoveryCode.findMany({ where: { userId: user.id } });
    expect(codes.some((c) => on.body.recoveryCodes.includes(c.codeHash))).toBe(false);
    expect(JSON.stringify((await client.get('/api/export?format=json')).body)).not.toContain(user.totpSecret!.slice(10, 30));
  });

  it('needs a code after the password, and never accepts the same code twice', async () => {
    await turnOn();
    const { c, res } = await passwordStep();
    expect(res.body).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    expect(res.cookies.find((k) => k.name === 'hb_session')).toBeUndefined();
    expect((await c.get('/api/auth/me')).status).toBe(401);

    const ok = await c.post('/api/auth/login/mfa', { challenge: res.body.challenge, code: code() });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(email);
    expect((await c.get('/api/auth/me')).status).toBe(200);

    // The same code again (another login within the same 30 seconds) is refused…
    const again = await passwordStep();
    expect((await again.c.post('/api/auth/login/mfa', { challenge: again.res.body.challenge, code: code() })).body.error.code).toBe('INVALID_CODE');
    // …the next one works, and a little clock drift is fine.
    clock.advance(30_000);
    expect((await again.c.post('/api/auth/login/mfa', { challenge: again.res.body.challenge, code: code(1) })).status).toBe(200);
  });

  it('takes each recovery code once', async () => {
    const recovery = await turnOn();
    const first = await passwordStep();
    const ok = await first.c.post('/api/auth/login/mfa', { challenge: first.res.body.challenge, code: recovery[0]!.toUpperCase().replace('-', ' ') });
    expect(ok.status).toBe(200);
    expect(mailer.sent.at(-1)).toMatchObject({ subject: 'A recovery code was used' });
    expect(mailer.sent.at(-1)!.text).toContain('You have 9 left');
    const second = await passwordStep();
    expect((await second.c.post('/api/auth/login/mfa', { challenge: second.res.body.challenge, code: recovery[0] })).body.error.code).toBe('INVALID_CODE');
    expect((await client.get('/api/auth/mfa')).body.recoveryCodesLeft).toBe(9);

    // New codes replace all the old ones.
    const fresh = await client.post('/api/auth/mfa/recovery-codes', { password: PASSWORD, code: code() });
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    const third = await passwordStep();
    expect((await third.c.post('/api/auth/login/mfa', { challenge: third.res.body.challenge, code: recovery[1] })).status).toBe(400);
  });

  it('refuses forged and expired challenges, and backs off after wrong codes', async () => {
    await turnOn();
    const { c, res } = await passwordStep();
    const [id, exp, nonce] = res.body.challenge.split('.');
    expect((await c.post('/api/auth/login/mfa', { challenge: `${id}.${Number(exp) + 999999}.${nonce}.forged`, code: code() })).body.error.code).toBe('MFA_CHALLENGE_EXPIRED');

    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await c.post('/api/auth/login/mfa', { challenge: res.body.challenge, code: '123456' })).status);
    expect(statuses.slice(0, 3)).toEqual([400, 400, 400]);
    expect(statuses.slice(3)).toEqual([429, 429]); // backoff after three failures

    clock.advance(6 * 60_000);
    expect((await c.post('/api/auth/login/mfa', { challenge: res.body.challenge, code: code() })).body.error.code).toBe('MFA_CHALLENGE_EXPIRED');
  });

  it('turns off only with the password and a code', async () => {
    await turnOn();
    expect((await client.post('/api/auth/mfa/disable', { password: PASSWORD, code: '000000' })).body.error.code).toBe('INVALID_CODE');
    expect((await client.post('/api/auth/mfa/disable', { password: 'not my password', code: code() })).body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await client.post('/api/auth/mfa/disable', { password: PASSWORD, code: code() })).status).toBe(204);
    expect((await passwordStep()).res.body.household).toBeDefined();
    expect(await testDb().recoveryCode.count()).toBe(0);
  });

  it('survives a password reset by email (someone with your email still needs your phone)', async () => {
    await turnOn();
    await new Client(app).post('/api/auth/forgot-password', { email });
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mailer.sent.at(-1)!.text)![1]!);
    await new Client(app).post('/api/auth/reset-password', { token, password: 'a brand new passphrase' });
    const res = await new Client(app).post('/api/auth/login', { email, password: 'a brand new passphrase' });
    expect(res.body.mfaRequired).toBe(true);
  });

  it('can be removed by the server admin (CLI) for a locked-out user', async () => {
    await turnOn();
    await app.services.mfa.adminDisable(email);
    expect((await client.get('/api/auth/me')).status).toBe(401); // signed out everywhere
    expect((await passwordStep()).res.body.household).toBeDefined();
  });
});
