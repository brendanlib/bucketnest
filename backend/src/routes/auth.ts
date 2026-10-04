import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Services } from '../services/index.js';
import { authOf, clearSessionCookie, issueCsrf, requireAuth, setSessionCookie } from '../plugins/auth.js';
import { AttemptThrottle } from '../lib/throttle.js';
import { tooManyRequests } from '../lib/errors.js';
import { MAX_PASSWORD_LENGTH } from '../lib/password.js';
import { Id } from '../lib/schemas.js';

const Email = z.email('Enter a valid email address').max(254).transform((v) => v.trim().toLowerCase());
const Password = z.string().min(1, 'Enter a password').max(MAX_PASSWORD_LENGTH);

const MeResponse = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  household: z.object({
    id: z.string(),
    name: z.string(),
    role: z.enum(['OWNER', 'MEMBER']),
    currency: z.string(),
    locale: z.string(),
    timezone: z.string(),
  }),
});

export const authRoutes =
  (services: Services, config: AppConfig, throttle: AttemptThrottle): FastifyPluginAsyncZod =>
  async (app) => {
    const authLimit = { rateLimit: { max: config.rateLimits.auth, timeWindow: '1 minute', keyGenerator: (r: { ip: string }) => `auth-ip:${r.ip}` } };

    /** Per-email limit on top of the per-IP route limit. */
    const checkEmail = (purpose: string, email: string) => {
      const wait = throttle.hit(`${purpose}:${email}`);
      if (wait !== null) throw tooManyRequests(wait);
    };

    async function me(userId: string, householdId: string, role: 'OWNER' | 'MEMBER') {
      const [settings, user] = await Promise.all([
        services.settings.get(householdId),
        app.deps.db.user.findUniqueOrThrow({ where: { id: userId } }),
      ]);
      return {
        user: { id: user.id, email: user.email, name: user.name },
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

    app.get('/auth/csrf', { schema: { tags: ['auth'], response: { 200: z.object({ csrfToken: z.string() }) } } }, async (request, reply) => {
      return { csrfToken: issueCsrf(request, reply, config) };
    });

    app.get(
      '/auth/registration',
      { schema: { tags: ['auth'], response: { 200: z.object({ open: z.boolean(), passwordReset: z.enum(['email', 'cli']) }) } } },
      async () => ({ open: await services.auth.registrationOpen(), passwordReset: app.deps.mailer.enabled ? 'email' as const : 'cli' as const }),
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

    app.post(
      '/auth/login',
      {
        config: authLimit,
        schema: { tags: ['auth'], body: z.strictObject({ email: Email, password: Password }), response: { 200: MeResponse } },
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
          setSessionCookie(reply, config, session);
          const membership = await app.deps.db.householdMember.findFirstOrThrow({ where: { userId: user.id }, orderBy: { role: 'asc' } });
          return me(user.id, membership.householdId, membership.role);
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
