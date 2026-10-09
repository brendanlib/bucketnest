import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Services } from '../services/index.js';
import { authOf, clearSessionCookie, issueCsrf, requireAuth, setSessionCookie } from '../plugins/auth.js';
import { AttemptThrottle } from '../lib/throttle.js';
import { tooManyRequests } from '../lib/errors.js';
import { MAX_PASSWORD_LENGTH } from '../lib/password.js';
import { Id } from '../lib/schemas.js';
import type { Db } from '../db.js';
import { isDemoEmail } from '../services/demo.service.js';

const Email = z.email('Enter a valid email address').max(254).transform((v) => v.trim().toLowerCase());
const Password = z.string().min(1, 'Enter a password').max(MAX_PASSWORD_LENGTH);

export const MeResponse = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string(), dismissedTips: z.array(z.string()), isDemo: z.boolean() }),
  /** Every household this user belongs to, for the switcher. */
  households: z.array(z.object({ id: z.string(), name: z.string(), role: z.enum(['OWNER', 'MEMBER']) })),
  household: z.object({
    id: z.string(),
    name: z.string(),
    role: z.enum(['OWNER', 'MEMBER']),
    currency: z.string(),
    locale: z.string(),
    timezone: z.string(),
  }),
});

/** The /auth/me body: the user, their current household and every household they can switch to. */
export async function buildMe(db: Db, services: Services, userId: string, householdId: string, role: 'OWNER' | 'MEMBER') {
  const [settings, user, households] = await Promise.all([
    services.settings.get(householdId),
    db.user.findUniqueOrThrow({ where: { id: userId } }),
    services.auth.households(userId),
  ]);
  return {
    user: { id: user.id, email: user.email, name: user.name, dismissedTips: user.dismissedTips, isDemo: isDemoEmail(user.email) },
    households,
    household: {
      id: settings.id,
      name: settings.name,
      role,
      currency: settings.currency,
      locale: settings.locale,
      timezone: settings.timezone,
    },
  };
}

export const authRoutes =
  (services: Services, config: AppConfig, throttle: AttemptThrottle): FastifyPluginAsyncZod =>
  async (app) => {
    const authLimit = { rateLimit: { max: config.rateLimits.auth, timeWindow: '1 minute', keyGenerator: (r: { ip: string }) => `auth-ip:${r.ip}` } };

    /** Per-email limit on top of the per-IP route limit. */
    const checkEmail = (purpose: string, email: string) => {
      const wait = throttle.hit(`${purpose}:${email}`);
      if (wait !== null) throw tooManyRequests(wait);
    };

    const me = (userId: string, householdId: string, role: 'OWNER' | 'MEMBER') => buildMe(app.deps.db, services, userId, householdId, role);

    app.get('/auth/csrf', { schema: { tags: ['auth'], response: { 200: z.object({ csrfToken: z.string() }) } } }, async (request, reply) => {
      return { csrfToken: issueCsrf(request, reply, config) };
    });

    app.get(
      '/auth/registration',
      {
        schema: {
          tags: ['auth'],
          description: 'What the sign-in pages need to know about this server, before anyone signs in.',
          response: { 200: z.object({ open: z.boolean(), passwordReset: z.enum(['email', 'cli']), demo: z.boolean(), sourceUrl: z.string(), websiteUrl: z.string() }) },
        },
      },
      async () => ({
        open: await services.auth.registrationOpen(),
        passwordReset: app.deps.mailer.enabled ? ('email' as const) : ('cli' as const),
        demo: config.demo.enabled,
        sourceUrl: config.sourceUrl,
        websiteUrl: config.websiteUrl,
      }),
    );

    app.post(
      '/auth/register',
      {
        config: authLimit,
        schema: {
          tags: ['auth'],
          body: z.strictObject({
            email: Email,
            name: z.string().trim().min(1, 'Enter your name').max(120),
            password: Password,
            timezone: z.string().max(64).optional(),
          }),
          response: { 201: MeResponse },
        },
      },
      async (request, reply) => {
        checkEmail('register', request.body.email);
        const { user, session } = await services.auth.register({ ...request.body, userAgent: request.headers['user-agent'] ?? null });
        setSessionCookie(reply, config, session);
        const membership = await app.deps.db.householdMember.findFirstOrThrow({ where: { userId: user.id } });
        reply.status(201);
        return me(user.id, membership.householdId, membership.role);
      },
    );

    const MfaChallenge = z.object({ mfaRequired: z.literal(true), challenge: z.string() });

    app.post(
      '/auth/login',
      {
        config: authLimit,
        schema: {
          tags: ['auth'],
          description: 'With two-step sign-in on, a correct password returns { mfaRequired, challenge } instead of a session; finish with POST /auth/login/mfa.',
          body: z.strictObject({ email: Email, password: Password }),
          response: { 200: z.union([MeResponse, MfaChallenge]) },
        },
      },
      async (request, reply) => {
        const key = `login:${request.body.email}`;
        const wait = throttle.hit(key);
        if (wait !== null) throw tooManyRequests(wait);
        // Rotate: a login always replaces whatever session this browser had.
        if (request.auth) await services.auth.logout(request.auth.sessionId);
        try {
          const { user, session } = await services.auth.login({
            ...request.body,
            userAgent: request.headers['user-agent'] ?? null,
            ip: request.ip,
          });
          throttle.succeed(key);
          if (!session) return { mfaRequired: true as const, challenge: services.mfa.challengeFor(user.id) };
          setSessionCookie(reply, config, session);
          const membership = await services.auth.defaultMembership(user.id);
          return me(user.id, membership.householdId, membership.role);
        } catch (err) {
          throttle.fail(key);
          throw err;
        }
      },
    );

    app.post(
      '/auth/login/mfa',
      {
        config: authLimit,
        schema: {
          tags: ['auth'],
          description: 'The second step of a login: a 6-digit code from the authenticator app, or a recovery code.',
          body: z.strictObject({ challenge: z.string().min(1).max(300), code: z.string().trim().min(6).max(20) }),
          response: { 200: MeResponse },
        },
      },
      async (request, reply) => {
        const userId = services.mfa.userForChallenge(request.body.challenge);
        // Guesses are limited per user (with backoff), on top of the per-IP limit.
        const key = `mfa:${userId}`;
        const wait = throttle.hit(key);
        if (wait !== null) throw tooManyRequests(wait);
        try {
          const { session } = await services.mfa.completeLogin(userId, request.body.code, request.headers['user-agent'] ?? null, request.ip);
          throttle.succeed(key);
          setSessionCookie(reply, config, session);
          const membership = await services.auth.defaultMembership(userId);
          return me(userId, membership.householdId, membership.role);
        } catch (err) {
          throttle.fail(key);
          throw err;
        }
      },
    );

    app.post('/auth/logout', { schema: { tags: ['auth'], response: { 204: z.null() } } }, async (request, reply) => {
      if (request.auth) await services.auth.logout(request.auth.sessionId);
      clearSessionCookie(reply, config);
      return reply.status(204).send(null);
    });

    app.post(
      '/auth/forgot-password',
      {
        config: authLimit,
        schema: { tags: ['auth'], body: z.strictObject({ email: Email }), response: { 202: z.object({ ok: z.literal(true) }) } },
      },
      async (request, reply) => {
        checkEmail('forgot', request.body.email);
        await services.auth.forgotPassword(request.body.email);
        return reply.status(202).send({ ok: true as const });
      },
    );

    app.post(
      '/auth/reset-password',
      {
        config: authLimit,
        schema: {
          tags: ['auth'],
          body: z.strictObject({ token: z.string().min(1).max(200), password: Password }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await services.auth.resetPassword(request.body.token, request.body.password);
        return reply.status(204).send(null);
      },
    );

    app.register(async (protectedApp) => {
      protectedApp.addHook('onRequest', requireAuth);
      const r = protectedApp.withTypeProvider<import('fastify-type-provider-zod').ZodTypeProvider>();

      r.get('/auth/me', { schema: { tags: ['auth'], response: { 200: MeResponse } } }, async (request) => {
        const a = authOf(request);
        return me(a.userId, a.householdId, a.role);
      });

      r.post(
        '/auth/switch-household',
        { schema: { tags: ['auth'], description: 'Work in another household you belong to.', body: z.strictObject({ householdId: Id }), response: { 200: MeResponse } } },
        async (request) => {
          const a = authOf(request);
          const m = await services.auth.switchHousehold(a.userId, a.sessionId, request.body.householdId);
          return me(a.userId, m.householdId, m.role);
        },
      );

      r.post(
        '/auth/change-password',
        {
          config: authLimit,
          schema: {
            tags: ['auth'],
            body: z.strictObject({ currentPassword: Password, newPassword: Password }),
            response: { 204: z.null() },
          },
        },
        async (request, reply) => {
          const a = authOf(request);
          const session = await services.auth.changePassword({
            userId: a.userId,
            ...request.body,
            userAgent: request.headers['user-agent'] ?? null,
          });
          setSessionCookie(reply, config, session);
          return reply.status(204).send(null);
        },
      );

      const Codes = z.object({ recoveryCodes: z.array(z.string()) });
      const PasswordAndCode = z.strictObject({ password: Password, code: z.string().trim().min(6).max(20) });

      r.get('/auth/mfa', { schema: { tags: ['auth'], response: { 200: z.object({ enabled: z.boolean(), enabledAt: z.string().nullable(), recoveryCodesLeft: z.number().int() }) } } }, async (request) =>
        services.mfa.status(authOf(request).userId),
      );
      r.post(
        '/auth/mfa/setup',
        { config: authLimit, schema: { tags: ['auth'], description: 'Confirms the password and returns a new secret to scan. Nothing changes until /auth/mfa/enable.', body: z.strictObject({ password: Password }), response: { 200: z.object({ secret: z.string(), otpauthUri: z.string() }) } } },
        async (request) => services.mfa.beginSetup(authOf(request).userId, request.body.password),
      );
      r.post(
        '/auth/mfa/enable',
        { config: authLimit, schema: { tags: ['auth'], description: 'A code from the app turns two-step sign-in on. Returns 10 recovery codes, once. Other sessions are signed out.', body: z.strictObject({ code: z.string().trim().min(6).max(10) }), response: { 200: Codes } } },
        async (request) => {
          const a = authOf(request);
          return services.mfa.enable(a.userId, a.sessionId, request.body.code);
        },
      );
      r.post(
        '/auth/mfa/disable',
        { config: authLimit, schema: { tags: ['auth'], body: PasswordAndCode, response: { 204: z.null() } } },
        async (request, reply) => {
          await services.mfa.disable(authOf(request).userId, request.body.password, request.body.code);
          return reply.status(204).send(null);
        },
      );
      r.post(
        '/auth/mfa/recovery-codes',
        { config: authLimit, schema: { tags: ['auth'], description: 'Replaces every recovery code with 10 new ones.', body: PasswordAndCode, response: { 200: Codes } } },
        async (request) => services.mfa.regenerateRecoveryCodes(authOf(request).userId, request.body.password, request.body.code),
      );

      r.get(
        '/auth/sessions',
        {
          schema: {
            tags: ['auth'],
            response: {
              200: z.object({
                items: z.array(
                  z.object({
                    id: z.string(),
                    userAgent: z.string().nullable(),
                    createdAt: z.string(),
                    lastSeenAt: z.string(),
                    expiresAt: z.string(),
                    current: z.boolean(),
                  }),
                ),
              }),
            },
          },
        },
        async (request) => {
          const a = authOf(request);
          return { items: await services.auth.listSessions(a.userId, a.sessionId) };
        },
      );

      r.delete(
        '/auth/sessions/:id',
        { schema: { tags: ['auth'], params: z.strictObject({ id: Id }), response: { 204: z.null() } } },
        async (request, reply) => {
          const a = authOf(request);
          await services.auth.revokeSession(a.userId, request.params.id);
          if (request.params.id === a.sessionId) clearSessionCookie(reply, config);
          return reply.status(204).send(null);
        },
      );
    });
  };
