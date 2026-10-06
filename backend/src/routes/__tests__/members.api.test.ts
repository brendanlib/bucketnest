import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createAccount, createTestApp, FakeMailer, PASSWORD, registerUser, resetDatabase, TestClock, testDb } from '../../test/helpers.js';

let app: FastifyInstance;
let owner: Client;
let ownerEmail: string;
const clock = new TestClock();
const mailer = new FakeMailer();

const tokenOf = (link: string) => link.split('#')[1]!;

beforeEach(async () => {
  await resetDatabase();
  clock.current = new Date('2026-10-06T01:00:00Z');
  mailer.sent = [];
  // Registration closed, as on a real server after the first user.
  app = await createTestApp({ clock, mailer, env: { ALLOW_REGISTRATION: '' } });
  ({ client: owner, email: ownerEmail } = await registerUser(app, { name: 'Alex' }));
  await createAccount(owner, { name: 'Joint account', type: 'TRANSACTION', openingBalanceCents: 500000, openingDate: '2026-09-01' });
});
afterEach(async () => {
  await app.close();
});

async function invite(body: Record<string, unknown> = {}) {
  const res = await owner.post('/api/household/invites', body);
  expect(res.status).toBe(201);
  return res.body as { id: string; link: string; emailed: boolean };
}

async function joinAsNew(token: string, email = 'sam@example.com') {
  const c = new Client(app);
  const res = await c.post('/api/invites/register', { token, name: 'Sam', email, password: 'a long shared budget passphrase' });
  return { c, res };
}

describe('household invites', () => {
  it('lets a new person join with the link, even when registration is closed', async () => {
    expect((await new Client(app).post('/api/auth/register', { email: 'x@example.com', name: 'X', password: PASSWORD })).status).toBe(403);

    const { link, emailed } = await invite();
    expect(link).toMatch(/^http:\/\/localhost:5173\/invite#[A-Za-z0-9_-]{43}$/);
    expect(emailed).toBe(false);

    const info = await new Client(app).post('/api/invites/lookup', { token: tokenOf(link) });
    expect(info.body).toMatchObject({ householdName: "Alex's household", invitedBy: 'Alex', email: null, hasAccount: null });

    const { c, res } = await joinAsNew(tokenOf(link));
    expect(res.status).toBe(201);
    expect(res.body.household).toMatchObject({ name: "Alex's household", role: 'MEMBER' });
    expect(res.body.households).toEqual([expect.objectContaining({ name: "Alex's household", role: 'MEMBER' })]);
    // Same data as the owner.
    expect((await c.get('/api/accounts')).body.items.map((a: { name: string }) => a.name)).toEqual(['Joint account']);
    // The new person has no household of their own.
    expect(await testDb().household.count()).toBe(1);

    const members = (await owner.get('/api/household/members')).body;
    expect(members.members.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
      ['Alex', 'OWNER'],
      ['Sam', 'MEMBER'],
    ]);
    expect(members.invites).toEqual([]);
  });

  it('works once, expires after 7 days, and stores only a hash', async () => {
    const { link } = await invite();
    const token = tokenOf(link);
    expect((await testDb().householdInvite.findFirstOrThrow()).tokenHash).not.toBe(token);
    expect((await joinAsNew(token)).res.status).toBe(201);
    const again = await joinAsNew(token, 'other@example.com');
    expect(again.res.status).toBe(400);
    expect(again.res.body.error.code).toBe('INVALID_INVITE');

    const old = await invite();
    clock.advance(7 * 86_400_000 + 1000);
    expect((await new Client(app).post('/api/invites/lookup', { token: tokenOf(old.link) })).body.error.code).toBe('INVALID_INVITE');
    expect((await joinAsNew(tokenOf(old.link), 'late@example.com')).res.status).toBe(400);
  });

  it('can be limited to one email, and emails the link when SMTP is set up', async () => {
    const { link, emailed } = await invite({ email: 'Sam@Example.com' });
    expect(emailed).toBe(true);
    expect(mailer.sent).toEqual([expect.objectContaining({ to: 'sam@example.com', subject: "Alex invited you to Alex's household on Home Budget" })]);
    expect(mailer.sent[0]!.text).toContain(link);
    expect((await new Client(app).post('/api/invites/lookup', { token: tokenOf(link) })).body).toMatchObject({ email: 'sam@example.com', hasAccount: false });

    const wrong = await joinAsNew(tokenOf(link), 'someone-else@example.com');
    expect(wrong.res.status).toBe(403);
    expect(wrong.res.body.error.code).toBe('INVITE_EMAIL_MISMATCH');
    expect((await joinAsNew(tokenOf(link), 'sam@example.com')).res.status).toBe(201);
  });

  it('lets an existing user join and switch between households', async () => {
    const { client: jo, email: joEmail } = await registerWithOpenRegistration('Jo');
    await createAccount(jo, { name: 'Jo savings', type: 'SAVINGS', openingBalanceCents: 1000, openingDate: '2026-09-01' });
    const { link } = await invite({ email: joEmail });
    expect((await new Client(app).post('/api/invites/lookup', { token: tokenOf(link) })).body.hasAccount).toBe(true);
    // Signing up again with that email is refused: log in and accept instead.
    expect((await joinAsNew(tokenOf(link), joEmail)).res.body.error.code).toBe('EMAIL_TAKEN');

    const accepted = await jo.post('/api/invites/accept', { token: tokenOf(link) });
    expect(accepted.status).toBe(200);
    expect(accepted.body.household).toMatchObject({ name: "Alex's household", role: 'MEMBER' });
    expect(accepted.body.households.map((h: { name: string }) => h.name).sort()).toEqual(["Alex's household", "Jo's household"]);
    expect((await jo.get('/api/accounts')).body.items.map((a: { name: string }) => a.name)).toEqual(['Joint account']);

    const own = accepted.body.households.find((h: { name: string }) => h.name === "Jo's household");
    const switched = await jo.post('/api/auth/switch-household', { householdId: own.id });
    expect(switched.body.household).toMatchObject({ name: "Jo's household", role: 'OWNER' });
    expect((await jo.get('/api/accounts')).body.items.map((a: { name: string }) => a.name)).toEqual(['Jo savings']);

    // A new login opens the household used last.
    const fresh = new Client(app);
    expect((await fresh.post('/api/auth/login', { email: joEmail, password: PASSWORD })).body.household.name).toBe("Jo's household");

    // Can't switch into a household you don't belong to.
    const stranger = await registerWithOpenRegistration('Stranger');
    expect((await jo.post('/api/auth/switch-household', { householdId: stranger.me.household.id })).status).toBe(404);
  });

  it('is managed by the owner only', async () => {
    const { link } = await invite();
    const { c: sam } = await joinAsNew(tokenOf(link));
    expect((await sam.post('/api/household/invites', {})).status).toBe(403);
    const list = (await sam.get('/api/household/members')).body;
    expect(list.canManage).toBe(false);
    expect(list.invites).toEqual([]);
    const alex = list.members.find((m: { name: string }) => m.name === 'Alex');
    expect((await sam.request('DELETE', `/api/household/members/${alex.userId}`)).status).toBe(403);
    expect((await sam.post(`/api/household/members/${alex.userId}/make-owner`)).status).toBe(403);
    // Ordinary members can still use the budget.
    expect((await sam.get('/api/dashboard')).status).toBe(200);
  });

  it('revokes pending invites', async () => {
    const { id, link } = await invite({ email: 'pat@example.com' });
    expect((await owner.get('/api/household/members')).body.invites).toEqual([expect.objectContaining({ id, email: 'pat@example.com', invitedBy: 'Alex' })]);
    expect((await owner.request('DELETE', `/api/household/invites/${id}`)).status).toBe(204);
    expect((await joinAsNew(tokenOf(link), 'pat@example.com')).res.status).toBe(400);
    // Another household can't revoke ours.
    const again = await invite();
    const other = await registerWithOpenRegistration('Other');
    expect((await other.client.request('DELETE', `/api/household/invites/${again.id}`)).status).toBe(404);
  });

  it('removes members, and a person left with no household loses their login', async () => {
    const { link } = await invite();
    const { c: sam } = await joinAsNew(tokenOf(link));
    const samId = (await sam.get('/api/auth/me')).body.user.id;
    const res = await owner.request('DELETE', `/api/household/members/${samId}`);
    expect(res.body).toEqual({ accountDeleted: true });
    expect((await sam.get('/api/accounts')).status).toBe(401);
    expect(await testDb().user.count({ where: { id: samId } })).toBe(0);

    const self = (await owner.get('/api/auth/me')).body.user.id;
    expect((await owner.request('DELETE', `/api/household/members/${self}`)).status).toBe(400);
  });

  it('a member who leaves goes back to their own household', async () => {
    const jo = await registerWithOpenRegistration('Jo');
    const { link } = await invite();
    await jo.client.post('/api/invites/accept', { token: tokenOf(link) });
    expect((await jo.client.post('/api/household/leave')).body).toEqual({ accountDeleted: false });
    const me = (await jo.client.get('/api/auth/me')).body;
    expect(me.household.name).toBe("Jo's household");
    expect(me.households).toHaveLength(1);
    expect((await owner.post('/api/household/leave')).status).toBe(400); // the owner can't leave
  });

  it('hands over ownership', async () => {
    const { link } = await invite();
    const { c: sam } = await joinAsNew(tokenOf(link));
    const samId = (await sam.get('/api/auth/me')).body.user.id;
    expect((await owner.post(`/api/household/members/${samId}/make-owner`)).status).toBe(204);
    expect((await sam.get('/api/auth/me')).body.household.role).toBe('OWNER');
    expect((await owner.get('/api/auth/me')).body.household.role).toBe('MEMBER');
    expect((await owner.post('/api/household/invites', {})).status).toBe(403);
    expect((await owner.post('/api/household/leave')).body).toEqual({ accountDeleted: true });
    expect((await new Client(app).post('/api/auth/login', { email: ownerEmail, password: PASSWORD })).status).toBe(401);
  });

  it('refuses inviting someone who is already a member, and caps open invites', async () => {
    expect((await owner.post('/api/household/invites', { email: ownerEmail })).body.error.code).toBe('ALREADY_MEMBER');
    for (let i = 0; i < 20; i++) await invite();
    expect((await owner.post('/api/household/invites', {})).status).toBe(400);
  });

  it('rate-limits invite lookups like logins', async () => {
    await app.close();
    app = await createTestApp({ clock, mailer, rateLimits: { auth: 1 } });
    const c = new Client(app);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await c.post('/api/invites/lookup', { token: 'x'.repeat(43) })).status);
    expect(statuses.slice(0, 4)).toEqual([400, 400, 400, 400]);
    expect(statuses[4]).toBe(429);
  });
});

/** Another person with their own household (the test app opens registration just for this). */
async function registerWithOpenRegistration(name: string) {
  const prev = app.deps.config.allowRegistration;
  app.deps.config.allowRegistration = true;
  try {
    return await registerUser(app, { name });
  } finally {
    app.deps.config.allowRegistration = prev;
  }
}
