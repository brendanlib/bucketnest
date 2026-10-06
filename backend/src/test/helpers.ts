import { inject } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config.js';
import type { Mailer } from '../lib/mailer.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct horse battery staple';

let sharedDb: PrismaClient | null = null;
export function testDb(): PrismaClient {
  sharedDb ??= new PrismaClient({ datasourceUrl: inject('databaseUrl') });
  return sharedDb;
}

export async function resetDatabase(db = testDb()) {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

export class TestClock {
  constructor(public current = new Date('2026-10-04T00:00:00Z')) {}
  now = () => this.current;
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FakeMailer implements Mailer {
  enabled = true;
  sent: { to: string; subject: string; text: string }[] = [];
  async send(message: { to: string; subject: string; text: string }) {
    this.sent.push(message);
  }
}

export interface TestAppOptions {
  env?: Record<string, string>;
  mailer?: Mailer;
  clock?: TestClock;
  rateLimits?: Partial<AppConfig['rateLimits']>;
  beforeReady?: (app: FastifyInstance) => void;
  /** Stands in for outbound HTTP (bank APIs). */
  fetch?: typeof fetch;
}

export async function createTestApp(opts: TestAppOptions = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    PUBLIC_URL: ORIGIN,
    SESSION_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    LOG_LEVEL: 'silent',
    ALLOW_REGISTRATION: 'true',
    ...opts.env,
  });
  config.rateLimits = { auth: 1000, api: 10_000, ...opts.rateLimits };
  const app = await buildApp({ config, db: testDb(), mailer: opts.mailer, now: opts.clock?.now, fetch: opts.fetch ?? (async () => { throw new Error('Unexpected outbound request in a test'); }) });
  opts.beforeReady?.(app);
  await app.ready();
  return app;
}

type Body = Record<string, unknown> | unknown[] | undefined;

export interface Res<T = any> {
  status: number;
  body: T;
  headers: LightMyRequestResponse['headers'];
  cookies: { name: string; value: string }[];
}

/** A browser-like client: keeps cookies, fetches a CSRF token and sends Origin. */
export class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  origin: string | null = ORIGIN;
  sendCsrf = true;

  constructor(public app: FastifyInstance) {}

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: Body): Promise<Res<T>> {
    if (method !== 'GET' && this.sendCsrf && !this.csrf) {
      const r = await this.request<{ csrfToken: string }>('GET', '/api/auth/csrf');
      this.csrf = r.body.csrfToken;
    }
    const headers: Record<string, string> = {};
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    if (method !== 'GET') {
      if (this.origin) headers.origin = this.origin;
      if (this.sendCsrf && this.csrf) headers['x-csrf-token'] = this.csrf;
    }
    const res = await this.app.inject({
      method,
      url,
      headers,
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0) || (c.expires && c.expires.getTime() < Date.now())) {
        this.cookies.delete(c.name);
      } else this.cookies.set(c.name, c.value);
    }
    let parsed: unknown = undefined;
    if (res.body) {
      try {
        parsed = JSON.parse(res.body);
      } catch {
        parsed = res.body;
      }
    }
    return { status: res.statusCode, body: parsed as T, headers: res.headers, cookies: res.cookies };
  }

  get = <T = any>(url: string) => this.request<T>('GET', url);
  post = <T = any>(url: string, body?: Body) => this.request<T>('POST', url, body ?? {});
  put = <T = any>(url: string, body?: Body) => this.request<T>('PUT', url, body ?? {});
  delete = <T = any>(url: string) => this.request<T>('DELETE', url);
}

let counter = 0;
export async function registerUser(app: FastifyInstance, overrides: { email?: string; name?: string; password?: string } = {}) {
  const client = new Client(app);
  const email = overrides.email ?? `user${++counter}-${Date.now()}@example.com`;
  const res = await client.post('/api/auth/register', {
    email,
    name: overrides.name ?? 'Test User',
    password: overrides.password ?? PASSWORD,
    timezone: 'Australia/Melbourne',
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, email, me: res.body };
}

/** Looks up a category id by name in the caller's household. */
export async function categoryId(client: Client, name: string): Promise<string> {
  const res = await client.get<{ items: { id: string; name: string; isGroup: boolean }[] }>('/api/categories');
  const c = res.body.items.find((x) => x.name === name && !x.isGroup);
  if (!c) throw new Error(`category ${name} not found`);
  return c.id;
}

export async function bucketIds(client: Client) {
  const res = await client.get<{ items: { id: string; key: string }[] }>('/api/buckets');
  return Object.fromEntries(res.body.items.map((b) => [b.key, b.id])) as Record<'BILLS' | 'SMILE' | 'SPLURGE' | 'FIRE_EXTINGUISHER', string>;
}

export async function createAccount(client: Client, body: Record<string, unknown>) {
  const res = await client.post('/api/accounts', { openingBalanceCents: 0, openingDate: '2026-01-01', ...body });
  if (res.status !== 201) throw new Error(`create account failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; balanceCents: number; [k: string]: unknown };
}
