import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import type { AppConfig } from '../config.js';
import { authOf, clearSessionCookie } from '../plugins/auth.js';
import { BooleanQuery, IdParams } from '../lib/schemas.js';
import { EXPORT_ENTITIES } from '../services/data.service.js';

const Type = z.enum(['UPCOMING_BILL', 'OVERSPENDING', 'SINKING_FUND_DEADLINE', 'BUDGET_REVIEW', 'GOAL_MILESTONE']);
const Notification = z.object({ id: z.string(), type: Type, title: z.string(), body: z.string(), link: z.string().nullable(), read: z.boolean(), createdAt: z.string() });
const Setting = z.object({ type: Type, enabled: z.boolean(), daysBefore: z.number().int().nullable(), emailEnabled: z.boolean() });

export const notificationRoutes =
  (services: Services, config: AppConfig): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/notifications',
      {
        schema: {
          tags: ['notifications'],
          querystring: z.strictObject({ unreadOnly: BooleanQuery, limit: z.coerce.number().int().min(1).max(200).optional() }),
          response: { 200: z.object({ items: z.array(Notification), unreadCount: z.number().int() }) },
        },
      },
      async (request) => {
        const { householdId } = authOf(request);
        await services.notifications.refresh(householdId);
        return services.notifications.list(householdId, request.query);
      },
    );
    app.post('/notifications/:id/read', { schema: { tags: ['notifications'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.notifications.markRead(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });
    app.post('/notifications/read-all', { schema: { tags: ['notifications'], response: { 200: z.object({ updated: z.number().int() }) } } }, async (request) =>
      services.notifications.markAllRead(authOf(request).householdId),
    );
    app.get(
      '/notifications/settings',
      { schema: { tags: ['notifications'], response: { 200: z.object({ emailAvailable: z.boolean(), items: z.array(Setting) }) } } },
      async (request) => services.notifications.getSettings(authOf(request).householdId),
    );
    app.put(
      '/notifications/settings',
      {
        schema: {
          tags: ['notifications'],
          body: z.strictObject({ items: z.array(z.strictObject({ type: Type, enabled: z.boolean(), daysBefore: z.number().int().min(0).max(60).nullish(), emailEnabled: z.boolean() })).max(10) }),
          response: { 200: z.object({ emailAvailable: z.boolean(), items: z.array(Setting) }) },
        },
      },
      async (request) => services.notifications.updateSettings(authOf(request).householdId, request.body.items),
    );

    // ─── Data ────────────────────────────────────────────────────────────────
    app.get(
      '/export',
      {
        schema: {
          tags: ['data'],
          description: 'All household data. JSON (everything, money in cents) or one CSV per kind of record. Complements, but does not replace, database backups.',
          querystring: z.strictObject({ format: z.enum(['json', 'csv']).default('json'), entity: z.enum(EXPORT_ENTITIES).default('transactions') }),
          response: { 200: z.union([z.record(z.string(), z.unknown()), z.string()]) },
        },
      },
      async (request, reply) => {
        const { householdId } = authOf(request);
        const stamp = new Date().toISOString().slice(0, 10);
        if (request.query.format === 'csv') {
          const body = await services.data.exportCsv(householdId, request.query.entity);
          return reply
            .type('text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="home-budget-${request.query.entity}-${stamp}.csv"`)
            .serializer((x: unknown) => x as string)
            .send(body);
        }
        const data = await services.data.exportJson(householdId);
        return reply
          .header('content-disposition', `attachment; filename="home-budget-export-${stamp}.json"`)
          .serializer((x: unknown) => JSON.stringify(x, null, 2))
          .send(data);
      },
    );

    app.delete(
      '/household',
      {
        schema: {
          tags: ['data'],
          description: 'Permanently deletes the household and all its data. Owner only; type the household name and your password.',
          body: z.strictObject({ confirmName: z.string().min(1).max(200), password: z.string().min(1).max(256) }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const a = authOf(request);
        await services.data.deleteHousehold(a.householdId, a.userId, a.role, request.body);
        clearSessionCookie(reply, config);
        return reply.status(204).send(null);
      },
    );
  };
