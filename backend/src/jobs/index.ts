import type { FastifyInstance } from 'fastify';
import type { Job } from './scheduler.js';

export function buildJobs(app: FastifyInstance): Job[] {
  return [
    {
      // Checks hourly; each notification is stored once per (type, subject, period), so reruns add nothing.
      name: 'notifications',
      everyMs: 60 * 60_000,
      run: () => app.services.notifications.generateAll(),
    },
    {
      // Stores the snapshot for the 1st of the month once per household; history is recomputable anyway.
      name: 'net-worth-snapshot',
      everyMs: 60 * 60_000,
      run: () => app.services.netWorth.snapshotAll(),
    },
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
