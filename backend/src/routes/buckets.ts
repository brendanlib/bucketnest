import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { Id, IdParams, Name } from '../lib/schemas.js';

export const BucketResponse = z.object({
  id: z.string(),
  key: z.string(),
  role: z.enum(['BILLS', 'SAVING', 'SPENDING']).describe('BILLS and SAVING carry the budgeting rules and can’t be removed'),
  name: z.string(),
  percentage: z.string().describe('Decimal string with 2 places, e.g. "60.00"'),
  sortOrder: z.number().int(),
  colour: z.string(),
  deletable: z.boolean(),
});

const Percentage = z.union([z.number(), z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Use a number such as 60 or 12.50')]);

export const bucketRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/buckets', { schema: { tags: ['buckets'], response: { 200: z.object({ items: z.array(BucketResponse) }) } } }, async (request) => ({
      items: await services.buckets.list(authOf(request).householdId),
    }));

    app.put(
      '/buckets',
      {
        schema: {
          tags: ['buckets'],
          description: 'Updates every bucket together, in display order. Percentages must total exactly 100.00.',
          body: z.strictObject({
            buckets: z
              .array(
                z.strictObject({
                  id: Id,
                  name: Name.optional(),
                  colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #2563EB').optional(),
                  percentage: Percentage,
                }),
              )
              .min(1)
              .max(8),
          }),
          response: { 200: z.object({ items: z.array(BucketResponse) }) },
        },
      },
      async (request) => ({ items: await services.buckets.update(authOf(request).householdId, request.body.buckets) }),
    );

    app.post(
      '/buckets',
      { schema: { tags: ['buckets'], description: 'Adds a spending bucket at 0%, straight after Bills. At most 8 buckets.', body: z.strictObject({ name: Name }), response: { 201: BucketResponse } } },
      async (request, reply) => {
        reply.status(201);
        return services.buckets.create(authOf(request).householdId, request.body);
      },
    );

    app.delete(
      '/buckets/:id',
      {
        schema: {
          tags: ['buckets'],
          description: 'Removes a spending bucket. Its categories, tagged accounts and percentage move to `moveTo`.',
          params: IdParams,
          body: z.strictObject({ moveTo: Id }),
          response: { 200: z.object({ movedCategories: z.number().int(), items: z.array(BucketResponse) }) },
        },
      },
      async (request) => services.buckets.remove(authOf(request).householdId, request.params.id, request.body.moveTo),
    );
  };
