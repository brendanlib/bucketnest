import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { createHash } from 'node:crypto';
import { randomToken, safeEqual } from '../lib/crypto.js';
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { cookieNames } from './auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Random per process and never sent anywhere: lets in-process calls (the demo seed) skip the API rate limit. */
    internalRequestKey: string;
  }
}

export async function registerSecurity(app: FastifyInstance, config: AppConfig) {
  app.decorate('internalRequestKey', randomToken(32));

  await app.register(helmet, {
    // The API returns JSON only; the SPA's own CSP is set by nginx.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    hsts: config.cookieSecure ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  const sessionCookie = cookieNames(config).session;
  await app.register(rateLimit, {
    global: true,
    // After the session hook, so limits apply per session (or per IP when logged out).
    hook: 'preHandler',
    max: config.rateLimits.api,
    allowList: (request) => {
      const key = request.headers['x-internal-key'];
      return typeof key === 'string' && safeEqual(key, app.internalRequestKey);
    },
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const token = request.cookies[sessionCookie];
      if (request.auth && token) return `s:${createHash('sha256').update(token).digest('base64url')}`;
      return `ip:${request.ip}`;
    },
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.', {
        retryAfterSeconds: Math.ceil(context.ttl / 1000),
      }),
  });
}
