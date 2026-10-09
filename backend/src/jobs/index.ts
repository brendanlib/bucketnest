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
      // Settled transactions from connected banks.
      name: 'bank-sync',
      everyMs: 30 * 60_000,
      run: () => app.services.bankFeeds.syncAll(),
    },
    {
      // Bank files dropped into account folders (only when IMPORT_INBOX_DIR is set).
      name: 'import-inbox',
      everyMs: 5 * 60_000,
      run: () => app.services.inbox.scan(),
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
      // Demo servers: sandboxes older than DEMO_TTL_HOURS.
      name: 'demo-cleanup',
      everyMs: 15 * 60_000,
      run: () => app.demo.cleanup(),
    },
    {
      name: 'session-cleanup',
      everyMs: 60 * 60_000,
      run: async () => {
        app.authThrottle.prune();
        return { ...(await app.services.auth.cleanup()), ...(await app.services.members.cleanup()) };
      },
    },
  ];
}
