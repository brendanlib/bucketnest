import type { FastifyInstance } from 'fastify';
import type { Job } from './scheduler.js';

export function buildJobs(app: FastifyInstance): Job[] {
  return [
    {
      // Checks every 15 minutes; posts occurrences once 02:00 household time has passed.
      name: 'recurring-auto-post',
      everyMs: 15 * 60_000,
      run: () => app.services.recurring.autoPostDue(),
    },
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
