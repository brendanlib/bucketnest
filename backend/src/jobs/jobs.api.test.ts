import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, registerUser, resetDatabase, TestClock, testDb } from '../test/helpers.js';
import { runExclusive } from './scheduler.js';
import { buildJobs } from './index.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

describe('scheduled jobs', () => {
  it('runs a job only once at a time across processes', async () => {
    await resetDatabase();
    app = await createTestApp();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const job = { name: 'test-lock', everyMs: 1000, run: async () => { runs++; await gate; } };
    const first = runExclusive(testDb(), app.log, job);
    await new Promise((r) => setTimeout(r, 100));
    const second = await runExclusive(testDb(), app.log, job);
    release();
    expect(await first).toBe(true);
    expect(second).toBe(false);
    expect(runs).toBe(1);
  });

  it('logs and survives a failing job', async () => {
    app = await createTestApp();
    const ran = await runExclusive(testDb(), app.log, { name: 'boom', everyMs: 1000, run: async () => { throw new Error('boom'); } });
    expect(ran).toBe(true);
  });

  it('session cleanup removes expired sessions', async () => {
    await resetDatabase();
    const clock = new TestClock();
    app = await createTestApp({ clock });
    await registerUser(app);
    clock.advance(40 * 86_400_000);
    const cleanup = buildJobs(app).find((j) => j.name === 'session-cleanup')!;
    expect(await cleanup.run()).toEqual({ sessions: 1, tokens: 0 });
    expect(await testDb().session.count()).toBe(0);
  });
});
