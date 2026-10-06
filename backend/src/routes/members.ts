import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Services } from '../services/index.js';
import { authOf, requireAuth, setSessionCookie } from '../plugins/auth.js';
import { Id, IdParams } from '../lib/schemas.js';
import { MAX_PASSWORD_LENGTH } from '../lib/password.js';
import { buildMe, MeResponse } from './auth.js';

const Role = z.enum(['OWNER', 'MEMBER']);
const Token = z.string().min(20).max(200);
const Removed = z.object({ accountDeleted: z.boolean() });

const MembersResponse = z.object({
  members: z.array(z.object({ userId: z.string(), name: z.string(), email: z.string(), role: Role, joinedAt: z.string(), isYou: z.boolean() })),
  invites: z.array(z.object({ id: z.string(), email: z.string().nullable(), invitedBy: z.string().nullable(), createdAt: z.string(), expiresAt: z.string() })),
  canManage: z.boolean(),
});

/** Household members and invites. The invite endpoints under /invites work before login. */
export const memberRoutes =
  (services: Services, config: AppConfig): FastifyPluginAsyncZod =>
  async (app) => {
    // Invite tokens are secrets: the same tight per-IP limit as login.
    const inviteLimit = { rateLimit: { max: config.rateLimits.auth * 4, timeWindow: '1 minute', keyGenerator: (r: { ip: string }) => `invite-ip:${r.ip}` } };

    app.post(
      '/invites/lookup',
      {
        config: inviteLimit,
        schema: {
          tags: ['members'],
          description: 'What an invite link is for. The token comes from the link’s #fragment, so it is sent in the body, never the URL.',
          body: z.strictObject({ token: Token }),
          response: { 200: z.object({ householdName: z.string(), invitedBy: z.string().nullable(), email: z.string().nullable(), expiresAt: z.string(), hasAccount: z.boolean().nullable() }) },
        },
      },
      async (request) => services.members.lookup(request.body.token),
    );

    app.post(
      '/invites/register',
      {
        config: inviteLimit,
        schema: {
          tags: ['members'],
          description: 'Create an account and join the household in one step. Works even when registration is closed.',
          body: z.strictObject({
            token: Token,
            name: z.string().trim().min(1, 'Enter your name').max(120),
            email: z.email('Enter a valid email address').max(254),
            password: z.string().min(1, 'Enter a password').max(MAX_PASSWORD_LENGTH),
          }),
          response: { 201: MeResponse },
        },
      },
      async (request, reply) => {
        const { user, session, householdId } = await services.members.register({ ...request.body, userAgent: request.headers['user-agent'] ?? null });
        setSessionCookie(reply, config, session);
        reply.status(201);
        return buildMe(app.deps.db, services, user.id, householdId, 'MEMBER');
      },
    );

    await app.register(async (protectedApp) => {
      protectedApp.addHook('onRequest', requireAuth);
      const r = protectedApp.withTypeProvider<ZodTypeProvider>();

      r.post(
        '/invites/accept',
        { config: inviteLimit, schema: { tags: ['members'], description: 'Join with the account you are logged in as.', body: z.strictObject({ token: Token }), response: { 200: MeResponse } } },
        async (request) => {
          const a = authOf(request);
          const m = await services.members.accept(a.userId, a.sessionId, request.body.token);
          return buildMe(app.deps.db, services, a.userId, m.householdId, m.role);
        },
      );

      r.get('/household/members', { schema: { tags: ['members'], response: { 200: MembersResponse } } }, async (request) => {
        const a = authOf(request);
        return services.members.list(a.householdId, a.userId, a.role);
      });

      r.post(
        '/household/invites',
        {
          schema: {
            tags: ['members'],
            description: 'Owner only. Returns the link once; it is not stored and can’t be shown again. With an email (and SMTP), the link is also emailed.',
            body: z.strictObject({ email: z.email('Enter a valid email address').max(254).nullish() }),
            response: { 201: z.object({ id: z.string(), link: z.string(), emailed: z.boolean(), expiresAt: z.string() }) },
          },
        },
        async (request, reply) => {
          const a = authOf(request);
          reply.status(201);
          return services.members.createInvite(a.householdId, a.userId, a.role, request.body);
        },
      );

      r.delete('/household/invites/:id', { schema: { tags: ['members'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
        const a = authOf(request);
        await services.members.revokeInvite(a.householdId, a.role, request.params.id);
        return reply.status(204).send(null);
      });

      r.delete(
        '/household/members/:userId',
        { schema: { tags: ['members'], description: 'Owner only. A person left with no household loses their login.', params: z.strictObject({ userId: Id }), response: { 200: Removed } } },
        async (request) => {
          const a = authOf(request);
          return services.members.remove(a.householdId, a.userId, a.role, request.params.userId);
        },
      );

      r.post(
        '/household/members/:userId/make-owner',
        { schema: { tags: ['members'], description: 'Owner only. You become a member.', params: z.strictObject({ userId: Id }), response: { 204: z.null() } } },
        async (request, reply) => {
          const a = authOf(request);
          await services.members.transferOwnership(a.householdId, a.userId, a.role, request.params.userId);
          return reply.status(204).send(null);
        },
      );

      r.post('/household/leave', { schema: { tags: ['members'], description: 'Members only. If it’s your only household, your login is deleted.', response: { 200: Removed } } }, async (request) => {
        const a = authOf(request);
        return services.members.leave(a.householdId, a.userId, a.role);
      });
    });
  };
