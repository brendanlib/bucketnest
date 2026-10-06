import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { AuthContext } from '../services/context.js';
import type { AuthService, IssuedSession } from '../services/auth.service.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { hmac, randomToken, safeEqual } from '../lib/crypto.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function cookieNames(config: AppConfig) {
  // The __Host- prefix pins the cookie to this exact host over HTTPS.
  const prefix = config.cookieSecure ? '__Host-' : '';
  return { session: `${prefix}hb_session`, csrf: `${prefix}hb_csrf` };
}

export function setSessionCookie(reply: FastifyReply, config: AppConfig, session: IssuedSession) {
  reply.setCookie(cookieNames(config).session, session.token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    // The cookie outlives idle expiry; the server enforces the real timeouts.
    maxAge: Math.floor(config.sessionAbsoluteMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(cookieNames(config).session, { path: '/', secure: config.cookieSecure, httpOnly: true, sameSite: 'lax' });
}

export const csrfTokenFor = (config: AppConfig, cookieValue: string) => hmac(config.sessionSecret, 'csrf', cookieValue);

/** Issues (or reuses) the CSRF cookie and returns the matching header token. */
export function issueCsrf(request: FastifyRequest, reply: FastifyReply, config: AppConfig): string {
  const name = cookieNames(config).csrf;
  let value = request.cookies[name];
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    value = randomToken(32);
    reply.setCookie(name, value, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
  }
  return csrfTokenFor(config, value);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  if (origin && origin !== 'null') return origin;
  const referer = request.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Loads the session for every request, and for state-changing requests checks
 * the Origin against PUBLIC_URL and the double-submit CSRF token.
 */
export function registerAuth(app: FastifyInstance, config: AppConfig, auth: AuthService) {
  const names = cookieNames(config);
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = requestOrigin(request);
    if (origin !== config.publicOrigin) {
      // Nearly always PUBLIC_URL not matching the address in the browser.
      request.log.warn({ origin, expected: config.publicOrigin, url: request.url }, 'request refused: origin does not match PUBLIC_URL');
      throw forbidden('BAD_ORIGIN', 'This request did not come from the app');
    }
    const cookie = request.cookies[names.csrf];
    const header = request.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || !safeEqual(header, csrfTokenFor(config, cookie))) {
      throw forbidden('CSRF_INVALID', 'Your security token is missing or out of date. Refresh and try again.');
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[names.session];
    if (!token) return;
    const resolved = await auth.resolveSession(token);
    if (!resolved) {
      clearSessionCookie(reply, config);
      return;
    }
    request.auth = {
      userId: resolved.user.id,
      sessionId: resolved.session.id,
      householdId: resolved.membership.householdId,
      role: resolved.membership.role,
    };
  });
}

/** onRequest hook for routes that need a logged-in user. */
export async function requireAuth(request: FastifyRequest) {
  if (!request.auth) throw unauthorized();
}

/** The caller's auth context; only valid behind requireAuth. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
