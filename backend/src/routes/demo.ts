import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppConfig } from '../config.js';
import type { DemoService } from '../services/demo.service.js';
import type { Services } from '../services/index.js';
import { setSessionCookie } from '../plugins/auth.js';
import { buildMe, MeResponse } from './auth.js';

/** POST /api/demo/start: a fresh sample household for this visitor (demo servers only). */
export const demoRoutes =
  (services: Services, demo: DemoService, config: AppConfig): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/demo/start',
      {
        // Each sandbox is a year of data: a few per visitor per hour is plenty.
        config: { rateLimit: { max: 5, timeWindow: '1 hour', keyGenerator: (r: { ip: string }) => `demo-ip:${r.ip}` } },
        schema: { tags: ['demo'], description: 'Demo servers only (DEMO_MODE=true). Creates a sample household and signs this browser in to it.', response: { 201: MeResponse } },
      },
      async (request, reply) => {
        if (request.auth) await services.auth.logout(request.auth.sessionId);
        const { userId, householdId, session } = await demo.start(request.headers['user-agent'] ?? null);
        setSessionCookie(reply, config, session);
        reply.status(201);
        return buildMe(app.deps.db, services, userId, householdId, 'OWNER');
      },
    );
  };
