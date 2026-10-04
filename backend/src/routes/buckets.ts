import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { Id, Name } from '../lib/schemas.js';

export const BucketResponse = z.object({
  id: z.string(),
  key: z.enum(['BILLS', 'SMILE', 'SPLURGE', 'FIRE_EXTINGUISHER']),
  name: z.string(),
  percentage: z.string().describe('Decimal string with 2 places, e.g. "60.00"'),
  sortOrder: z.number().int(),
  colour: z.string(),
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
          description: 'Updates all four buckets together. Percentages must total exactly 100.00.',
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
              .max(10),
          }),
          response: { 200: z.object({ items: z.array(BucketResponse) }) },
        },
      },
      async (request) => ({ items: await services.buckets.update(authOf(request).householdId, request.body.buckets) }),
    );
  };
