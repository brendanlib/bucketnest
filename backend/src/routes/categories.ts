import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { BooleanQuery, Id, IdParams, Name } from '../lib/schemas.js';

export const CategoryResponse = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['INCOME', 'EXPENSE']),
  bucketId: z.string().nullable(),
  parentId: z.string().nullable(),
  isGroup: z.boolean(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
  systemKey: z.string().nullable(),
  sortOrder: z.number().int(),
  transactionCount: z.number().int().optional(),
});

export const categoryRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/categories',
      {
        schema: {
          tags: ['categories'],
          querystring: z.strictObject({ includeInactive: BooleanQuery }),
          response: { 200: z.object({ items: z.array(CategoryResponse) }) },
        },
      },
      async (request) => ({
        items: await services.categories.list(authOf(request).householdId, { includeInactive: request.query.includeInactive }),
      }),
    );

    app.post(
      '/categories',
      {
        schema: {
          tags: ['categories'],
          body: z.strictObject({
            name: Name,
            kind: z.enum(['INCOME', 'EXPENSE']),
            bucketId: Id.nullish(),
            parentId: Id.nullish(),
            isGroup: z.boolean().optional(),
            sortOrder: z.number().int().min(0).max(1_000_000).optional(),
          }),
          response: { 201: CategoryResponse },
        },
      },
      async (request, reply) => {
        reply.status(201);
        return services.categories.create(authOf(request).householdId, request.body);
      },
    );

    app.put(
      '/categories/:id',
      {
        schema: {
          tags: ['categories'],
          params: IdParams,
          body: z.strictObject({
            name: Name.optional(),
            bucketId: Id.nullish(),
            parentId: Id.nullish(),
            isActive: z.boolean().optional(),
            sortOrder: z.number().int().min(0).max(1_000_000).optional(),
            confirmBucketChange: z.boolean().optional(),
          }),
          response: { 200: CategoryResponse },
        },
      },
      async (request) => services.categories.update(authOf(request).householdId, request.params.id, request.body),
    );

    app.delete(
      '/categories/:id',
      {
        schema: {
          tags: ['categories'],
          params: IdParams,
          querystring: z.strictObject({ reassignTo: Id.optional() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await services.categories.remove(authOf(request).householdId, request.params.id, request.query.reassignTo);
        return reply.status(204).send(null);
      },
    );
  };
