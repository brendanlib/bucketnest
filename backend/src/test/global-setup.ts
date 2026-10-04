import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Starts PostgreSQL 16 with Testcontainers, or uses TEST_DATABASE_URL when set
 * (e.g. a CI service container). The database is wiped and migrated from scratch.
 */
export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<unknown>) | undefined;

  if (!url) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    url = container.getConnectionUri();
    stop = () => container.stop();
  } else {
    const db = new PrismaClient({ datasourceUrl: url });
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
    await db.$disconnect();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  project.provide('databaseUrl', url);
  return async () => {
    await stop?.();
  };
}
