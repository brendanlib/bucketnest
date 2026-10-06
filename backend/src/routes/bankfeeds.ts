import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { DateOnly, Id, IdParams } from '../lib/schemas.js';

const Connection = z.object({
  id: z.string(),
  provider: z.enum(['UP']),
  label: z.string(),
  status: z.enum(['ACTIVE', 'ERROR']),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      bankBalanceCents: z.number().int(),
      accountId: z.string().nullable(),
      accountName: z.string().nullable(),
      appBalanceCents: z.number().int().nullable(),
      syncFrom: z.string().nullable(),
      lastSyncAt: z.string().nullable(),
    }),
  ),
});

const Inbox = z.object({
  enabled: z.boolean(),
  accounts: z.array(z.object({ accountId: z.string(), accountName: z.string(), folder: z.string().nullable(), hasLayout: z.boolean(), imported: z.array(z.string()), failed: z.array(z.string()) })),
});

/** Direct bank connections (Up) and folder import. */
export const bankFeedRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/bank-connections', { schema: { tags: ['bank feeds'], response: { 200: z.object({ items: z.array(Connection) }) } } }, async (request) => ({
      items: await services.bankFeeds.list(authOf(request).householdId),
    }));

    app.post(
      '/bank-connections/up',
      {
        // A token check calls Up: keep it to the login rate.
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          tags: ['bank feeds'],
          description: 'Connects Up Bank with a personal access token (Up app → Data sharing → Personal Access Token). The token is checked, stored encrypted and never returned.',
          body: z.strictObject({ token: z.string().min(1).max(300) }),
          response: { 201: Connection },
        },
      },
      async (request, reply) => {
        const a = authOf(request);
        reply.status(201);
        return services.bankFeeds.connectUp(a.householdId, a.userId, request.body.token);
      },
    );

    app.put(
      '/bank-connections/accounts/:id',
      {
        schema: {
          tags: ['bank feeds'],
          description: 'Where a bank account’s transactions go: an existing account, a new account (createAccount), or nowhere (accountId null).',
          params: IdParams,
          body: z.strictObject({ accountId: Id.nullish(), createAccount: z.boolean().optional(), syncFrom: DateOnly.nullish() }),
          response: { 200: Connection },
        },
      },
      async (request) => services.bankFeeds.link(authOf(request).householdId, request.params.id, request.body),
    );

    app.post(
      '/bank-connections/:id/sync',
      {
        config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
        schema: {
          tags: ['bank feeds'],
          params: IdParams,
          response: { 200: z.object({ summary: z.object({ accounts: z.number().int(), imported: z.number().int(), merged: z.number().int(), matched: z.number().int(), skipped: z.number().int() }), connection: Connection }) },
        },
      },
      async (request) => services.bankFeeds.sync(authOf(request).householdId, request.params.id),
    );

    app.delete('/bank-connections/:id', { schema: { tags: ['bank feeds'], description: 'Forgets the token. Imported transactions stay.', params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.bankFeeds.disconnect(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });

    app.get('/import-inbox', { schema: { tags: ['bank feeds'], response: { 200: Inbox } } }, async (request) => services.inbox.list(authOf(request).householdId));
    app.post('/import-inbox/:id', { schema: { tags: ['bank feeds'], description: 'Watch a folder for this account.', params: IdParams, response: { 200: Inbox } } }, async (request) =>
      services.inbox.enable(authOf(request).householdId, request.params.id),
    );
    app.delete('/import-inbox/:id', { schema: { tags: ['bank feeds'], params: IdParams, response: { 200: Inbox } } }, async (request) =>
      services.inbox.disable(authOf(request).householdId, request.params.id),
    );
  };
