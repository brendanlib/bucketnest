import type { FastifyInstance } from 'fastify';
import type { Job } from './scheduler.js';

export function buildJobs(app: FastifyInstance): Job[] {
  return [
    {
      name: 'session-cleanup',
      everyMs: 60 * 60_000,
      run: async () => {
        app.authThrottle.prune();
        return app.services.auth.cleanup();
      },
    },
  ];
}
