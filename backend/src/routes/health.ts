import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  const noLimit = { rateLimit: false as const };

  app.get(
    '/health',
    { config: noLimit, schema: { tags: ['health'], security: [], response: { 200: z.object({ status: z.literal('ok') }) } } },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    {
      config: noLimit,
      schema: {
        tags: ['health'],
        security: [],
        response: { 200: z.object({ status: z.literal('ok'), database: z.literal('ok') }), 503: z.object({ status: z.literal('unavailable'), database: z.literal('down') }) },
      },
    },
    async (_request, reply) => {
      try {
        await app.deps.db.$queryRaw`SELECT 1`;
        return { status: 'ok' as const, database: 'ok' as const };
      } catch {
        return reply.status(503).send({ status: 'unavailable' as const, database: 'down' as const });
      }
    },
  );
};
