import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { requireAuth } from './auth.js';

/** OpenAPI generated from the route schemas, at /api/docs for logged-in users. */
export async function registerDocs(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Home Budget API',
        description:
          'Money is integer cents (`amountCents`). Dates are `YYYY-MM-DD`. Every non-GET request needs the `X-CSRF-Token` header from `GET /api/auth/csrf` and an `Origin` matching PUBLIC_URL.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'hb_session' } },
      },
      security: [{ session: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    staticCSP: true,
    uiHooks: { onRequest: requireAuth },
  });
}
