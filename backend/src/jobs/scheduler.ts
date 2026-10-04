import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db.js';

export interface Job {
  name: string;
  /** How often the scheduler checks whether the job is due. */
  everyMs: number;
  run: () => Promise<unknown>;
}

/** Stable 32-bit key for a job name, for pg advisory locks. */
function lockKey(name: string): number {
  let h = 0;
  for (const ch of `home-budget:job:${name}`) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return h;
}

/**
 * Runs a job only if this process wins the PostgreSQL advisory lock for it,
 * so restarts or extra replicas never run a job twice at the same time.
 * Jobs themselves are idempotent (unique keys), so a rerun is harmless.
 */
export async function runExclusive(db: Db, log: FastifyBaseLogger, job: Job): Promise<boolean> {
  const key = lockKey(job.name);
  return db.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${key}::integer) AS locked`;
      if (!row?.locked) {
        log.debug({ job: job.name }, 'job already running elsewhere');
        return false;
      }
      const started = Date.now();
      try {
        const result = await job.run();
        log.info({ job: job.name, ms: Date.now() - started, result }, 'job finished');
      } catch (err) {
        log.error({ job: job.name, err }, 'job failed');
      }
      return true;
    },
    { timeout: 10 * 60_000, maxWait: 10_000 },
  );
}

export function startScheduler(db: Db, log: FastifyBaseLogger, jobs: Job[]): () => void {
  const timers = jobs.map((job) => {
    const tick = () => void runExclusive(db, log, job).catch((err) => log.error({ job: job.name, err }, 'job scheduling failed'));
    const initial = setTimeout(tick, 5_000);
    const interval = setInterval(tick, job.everyMs);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  });
  return () => timers.forEach((stop) => stop());
}
