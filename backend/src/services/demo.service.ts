import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import { seedDemo } from '../seed/demo.js';

/** Demo visitors' logins live under a reserved domain that can never receive mail (RFC 2606). */
export const DEMO_EMAIL_DOMAIN = 'demo.bucketnest.invalid';
export const isDemoEmail = (email: string) => email.toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);

/**
 * The public demo: each visitor gets their own sample household (a year of
 * realistic data), signed in straight away, and deleted after DEMO_TTL_HOURS.
 * Visitors never see each other's changes.
 */
export function createDemoService(app: FastifyInstance) {
  const { db, config, log } = app.deps;

  async function activeCount() {
    return db.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } });
  }

  return {
    /** Creates a sandbox and returns a session for it. */
    async start(userAgent: string | null) {
      if (!config.demo.enabled) throw new AppError(404, 'NOT_FOUND', 'Route not found');
      if ((await activeCount()) >= config.demo.maxActive) {
        throw new AppError(503, 'DEMO_BUSY', 'The demo is very popular right now. Try again in a few minutes.');
      }
      const email = `visitor-${randomBytes(6).toString('hex')}@${DEMO_EMAIL_DOMAIN}`;
      const started = Date.now();
      const demo = await seedDemo(app, { email, name: 'Demo visitor' });
      const session = await app.services.auth.issueSession(demo.userId, userAgent);
      log.info({ userId: demo.userId, ms: Date.now() - started }, 'demo sandbox created');
      return { userId: demo.userId, householdId: demo.householdId, session };
    },

    /** Deletes sandboxes older than the TTL: their households, then the visitor logins. */
    async cleanup() {
      if (!config.demo.enabled) return { removed: 0 };
      const cutoff = new Date(app.deps.now().getTime() - config.demo.ttlMs);
      const old = await db.user.findMany({
        where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` }, createdAt: { lt: cutoff } },
        select: { id: true, memberships: { select: { householdId: true } } },
      });
      for (const u of old) {
        await db.$transaction([
          db.household.deleteMany({ where: { id: { in: u.memberships.map((m) => m.householdId) } } }),
          db.user.delete({ where: { id: u.id } }),
        ]);
      }
      if (old.length) log.info({ removed: old.length }, 'demo sandboxes removed');
      return { removed: old.length };
    },
  };
}

export type DemoService = ReturnType<typeof createDemoService>;

/**
 * What a public demo doesn't offer: anything that reaches outside the sandbox
 * (bank feeds, invites, email), or that could lock a visitor out of it.
 */
export const DEMO_BLOCKED: [string, RegExp][] = [
  ['POST', /^\/api\/bank-connections\/up$/],
  ['POST', /^\/api\/import-inbox\//],
  ['POST', /^\/api\/household\/invites$/],
  ['POST', /^\/api\/auth\/mfa\/setup$/],
  ['POST', /^\/api\/auth\/change-password$/],
  ['POST', /^\/api\/auth\/forgot-password$/],
];
