import { z } from 'zod';
import { isValidTimeZone } from './finance/dates.js';

const EXAMPLE_SECRETS = new Set(['change-me', 'changeme', 'replace-me', 'secret']);

/** Optional boolean: blank means "not set" (undefined). */
const boolFromEnv = () =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .default('')
    .transform((v) => (v === '' ? undefined : v === 'true' || v === '1'));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PUBLIC_URL: z.url('PUBLIC_URL must be a full URL such as https://budget.example.com'),
  SESSION_SECRET: z.string(),
  TRUST_PROXY: z.string().default(''),
  /** Proxies inside the deployment itself (the bundled nginx). Set by docker-compose, not by users. */
  INTERNAL_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  ALLOW_REGISTRATION: boolFromEnv(),
  COOKIE_SECURE: boolFromEnv(),
  DEFAULT_TIMEZONE: z.string().default('Australia/Sydney'),
  SESSION_IDLE_DAYS: z.coerce.number().positive().default(7),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().positive().default(30),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),
  SEED_DEMO: boolFromEnv(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JOBS_ENABLED: boolFromEnv(),
  /** Login, sign-up and invite attempts per minute per IP. Raise only for automated tests. */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(5),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  publicUrl: string;
  publicOrigin: string;
  sessionSecret: string;
  trustProxy: boolean | string[] | ((address: string, hop: number) => boolean);
  /** undefined = open only until the first user exists. */
  allowRegistration: boolean | undefined;
  cookieSecure: boolean;
  defaultTimezone: string;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  smtp: { host: string; port: number; user: string; pass: string; from: string } | null;
  seedDemo: boolean;
  logLevel: string;
  jobsEnabled: boolean;
  rateLimits: { auth: number; api: number };
}

export class ConfigError extends Error {}

/**
 * TRUST_PROXY describes the user's reverse proxies in front of the app. The
 * bundled nginx is always one more hop, so it is added on top. With TRUST_PROXY
 * unset, only the bundled nginx is trusted and every request appears to come
 * from the user's proxy, as documented.
 */
function parseTrustProxy(value: string, internalHops: number): AppConfig['trustProxy'] {
  const v = value.trim();
  const hopsFn = (hops: number) => (hops === 0 ? false : (_address: string, hop: number) => hop < hops);
  if (v === '' || v === 'false' || v === '0') return hopsFn(internalHops);
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) {
    // Trust exactly N proxy hops, so X-Forwarded-For can't be spoofed past them.
    return hopsFn(Number(v) + internalHops);
  }
  const list = v.split(',').map((s) => s.trim()).filter(Boolean);
  // The bundled nginx lives on a private Docker network.
  return internalHops > 0 ? [...list, 'uniquelocal', 'loopback'] : list;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;

  const secret = e.SESSION_SECRET.trim();
  if (secret.length < 32 || EXAMPLE_SECRETS.has(secret.toLowerCase())) {
    throw new ConfigError(
      'SESSION_SECRET must be at least 32 characters and not the example value. Generate one with: openssl rand -hex 32',
    );
  }
  if (!isValidTimeZone(e.DEFAULT_TIMEZONE)) throw new ConfigError(`DEFAULT_TIMEZONE "${e.DEFAULT_TIMEZONE}" is not a valid time zone`);

  const publicUrl = new URL(e.PUBLIC_URL);
  const smtp = e.SMTP_HOST
    ? { host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.SMTP_FROM || `Home Budget <no-reply@${publicUrl.hostname}>` }
    : null;

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    publicUrl: publicUrl.toString().replace(/\/$/, ''),
    publicOrigin: publicUrl.origin,
    sessionSecret: secret,
    trustProxy: parseTrustProxy(e.TRUST_PROXY, e.INTERNAL_PROXY_HOPS),
    allowRegistration: e.ALLOW_REGISTRATION,
    cookieSecure: e.COOKIE_SECURE ?? publicUrl.protocol === 'https:',
    defaultTimezone: e.DEFAULT_TIMEZONE,
    sessionIdleMs: e.SESSION_IDLE_DAYS * 86_400_000,
    sessionAbsoluteMs: e.SESSION_ABSOLUTE_DAYS * 86_400_000,
    smtp,
    seedDemo: e.SEED_DEMO ?? false,
    logLevel: e.LOG_LEVEL,
    jobsEnabled: e.JOBS_ENABLED ?? e.NODE_ENV !== 'test',
    rateLimits: { auth: e.AUTH_RATE_LIMIT_PER_MINUTE, api: 300 },
  };
}
