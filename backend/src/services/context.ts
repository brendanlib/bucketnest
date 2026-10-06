import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer } from '../lib/mailer.js';

/** Everything a service needs. Built once per app and shared. */
export interface Deps {
  db: Db;
  config: AppConfig;
  mailer: Mailer;
  log: FastifyBaseLogger;
  /** Injected so tests can control time. */
  now: () => Date;
  /** Outbound HTTP (bank APIs). Injected so tests can stand in for the bank. */
  fetch: typeof fetch;
}

/** The authenticated caller. Every household-scoped service call takes one. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  householdId: string;
  role: 'OWNER' | 'MEMBER';
}
