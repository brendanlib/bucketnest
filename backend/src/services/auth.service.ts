import type { Deps } from './context.js';
import * as repo from '../repositories/auth.js';
import { createHouseholdWithDefaults } from '../repositories/households.js';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized, validationError } from '../lib/errors.js';
import { hmac, randomToken } from '../lib/crypto.js';
import { dummyPasswordHash, hashPassword, passwordProblem, verifyPassword } from '../lib/password.js';
import { dateInTimeZone, dateOnlyToDb, isValidTimeZone } from '../finance/dates.js';

const RESET_TOKEN_TTL_MS = 30 * 60_000;
/** Write last_seen_at at most this often, so every request is not a write. */
const TOUCH_INTERVAL_MS = 60_000;

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export function createAuthService(deps: Deps) {
  const { db, config, log } = deps;
  const tokenHash = (token: string) => hmac(config.sessionSecret, 'session', token);
  const resetHash = (token: string) => hmac(config.sessionSecret, 'reset', token);

  async function issueSession(userId: string, userAgent: string | null): Promise<IssuedSession> {
    const token = randomToken(32);
    const now = deps.now();
    const expiresAt = new Date(now.getTime() + Math.min(config.sessionIdleMs, config.sessionAbsoluteMs));
    const session = await repo.createSession(db, {
      tokenHash: tokenHash(token),
      userId,
      expiresAt,
      userAgent: userAgent?.slice(0, 300) ?? null,
      // Timestamps come from the app clock so timeouts are measured consistently.
      createdAt: now,
      lastSeenAt: now,
    });
    return { token, sessionId: session.id, expiresAt };
  }

  function requireAcceptablePassword(password: string, context: { email?: string; name?: string }) {
    const problem = passwordProblem(password, context);
    if (problem) throw validationError(problem, { field: 'password' });
  }

  async function registrationOpen(): Promise<boolean> {
    if (config.allowRegistration !== undefined) return config.allowRegistration;
    return (await repo.countUsers(db)) === 0;
  }

  return {
    registrationOpen,

    /** `ignoreRegistrationSwitch` is for the demo seed only; the route never passes it. */
    async register(input: { email: string; name: string; password: string; timezone?: string; userAgent: string | null }, opts: { ignoreRegistrationSwitch?: boolean } = {}) {
      const email = input.email.trim().toLowerCase();
      requireAcceptablePassword(input.password, { email, name: input.name });
      const passwordHash = await hashPassword(input.password);
      const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : config.defaultTimezone;

      const user = await db.$transaction(async (tx) => {
        // Serialise registrations so "open until the first user" cannot be raced.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('home-budget:registration'))`;
        const open = opts.ignoreRegistrationSwitch || (config.allowRegistration ?? (await repo.countUsers(tx)) === 0);
        if (!open) throw forbidden('REGISTRATION_CLOSED', 'Registration is closed on this server');
        if (await repo.findUserByEmail(tx, email)) {
          throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
        }
        const created = await repo.createUser(tx, { email, name: input.name.trim(), passwordHash });
        await createHouseholdWithDefaults(tx, {
          name: `${input.name.trim()}'s household`,
          ownerUserId: created.id,
          timezone,
          budgetAnchorDate: dateOnlyToDb(`${dateInTimeZone(deps.now(), timezone).slice(0, 8)}01`),
        });
        return created;
      });
      log.info({ userId: user.id }, 'user registered');
      return { user, session: await issueSession(user.id, input.userAgent) };
    },

    async login(input: { email: string; password: string; userAgent: string | null; ip: string }) {
      const email = input.email.trim().toLowerCase();
      const user = await repo.findUserByEmail(db, email);
      // Verify against a dummy hash for unknown emails so response time does not reveal accounts.
      const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), input.password);
      if (!user || !ok) {
        log.warn({ email, ip: input.ip }, 'login failed');
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      log.info({ userId: user.id, ip: input.ip }, 'login succeeded');
      return { user, session: await issueSession(user.id, input.userAgent) };
    },

    /** Resolves a cookie token to a live session, enforcing idle and absolute timeouts. */
    async resolveSession(token: string) {
      const session = await repo.findSessionByTokenHash(db, tokenHash(token));
      if (!session) return null;
      const now = deps.now();
      const absoluteEnd = session.createdAt.getTime() + config.sessionAbsoluteMs;
      if (session.expiresAt <= now || absoluteEnd <= now.getTime()) {
        await repo.deleteSession(db, session.id);
        return null;
      }
      const membership = await repo.findMembershipForUser(db, session.userId);
      if (!membership) return null;
      if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        const expiresAt = new Date(Math.min(now.getTime() + config.sessionIdleMs, absoluteEnd));
        await repo.touchSession(db, session.id, now, expiresAt);
      }
      return { session, user: session.user, membership };
    },

    async logout(sessionId: string) {
      await repo.deleteSession(db, sessionId);
    },

    async changePassword(input: { userId: string; currentPassword: string; newPassword: string; userAgent: string | null }) {
      const user = await repo.findUserById(db, input.userId);
      if (!user) throw unauthorized();
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      }
      if (input.currentPassword === input.newPassword) throw badRequest('Choose a password you have not used here before');
      requireAcceptablePassword(input.newPassword, { email: user.email, name: user.name });
      await repo.updatePasswordHash(db, user.id, await hashPassword(input.newPassword));
      await repo.deleteUserResetTokens(db, user.id);
      // End every session, then issue a fresh one: rotation plus "log out everywhere else".
      await repo.deleteUserSessions(db, user.id);
      log.info({ userId: user.id }, 'password changed');
      return issueSession(user.id, input.userAgent);
    },

    async listSessions(userId: string, currentSessionId: string) {
      const sessions = await repo.listUserSessions(db, userId, deps.now());
      return sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === currentSessionId,
      }));
    },

    async revokeSession(userId: string, sessionId: string) {
      const result = await repo.deleteSessionForUser(db, userId, sessionId);
      if (result.count === 0) throw notFound('Session');
    },

    /** Always resolves the same way whether or not the email exists. */
    async forgotPassword(emailInput: string) {
      const email = emailInput.trim().toLowerCase();
      if (!deps.mailer.enabled) {
        log.info('password reset requested but SMTP is not configured; use the reset-password CLI');
        return;
      }
      const user = await repo.findUserByEmail(db, email);
      if (!user) return;
      // Sending happens after the response, so its time doesn't reveal which emails have accounts.
      const token = randomToken(32);
      await repo.createResetToken(db, {
        tokenHash: resetHash(token),
        userId: user.id,
        expiresAt: new Date(deps.now().getTime() + RESET_TOKEN_TTL_MS),
      });
      const link = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
      void deps.mailer
        .send({
          to: user.email,
          subject: 'Reset your Home Budget password',
          text: `Hi ${user.name},\n\nUse this link within 30 minutes to choose a new password:\n\n${link}\n\nIf you did not ask for this, ignore this email.`,
        })
        .then(
          () => log.info({ userId: user.id }, 'password reset email sent'),
          (err: unknown) => log.error({ err: (err as Error).message }, 'password reset email failed'),
        );
    },

    async resetPassword(token: string, newPassword: string) {
      const record = await repo.findResetToken(db, resetHash(token));
      const now = deps.now();
      const invalid = new AppError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired');
      if (!record || record.usedAt || record.expiresAt <= now) throw invalid;
      const user = await repo.findUserById(db, record.userId);
      if (!user) throw invalid;
      requireAcceptablePassword(newPassword, { email: user.email, name: user.name });
      const passwordHash = await hashPassword(newPassword);
      await db.$transaction(async (tx) => {
        const consumed = await repo.consumeResetToken(tx, record.id, now);
        if (consumed.count !== 1) throw invalid;
        await repo.deleteUserResetTokens(tx, user.id); // any other links sent earlier stop working
        await repo.updatePasswordHash(tx, user.id, passwordHash);
        await repo.deleteUserSessions(tx, user.id);
      });
      log.info({ userId: user.id }, 'password reset');
    },

    /** Used by the CLI. Sets a password and ends every session. */
    async setPasswordByEmail(emailInput: string, newPassword: string) {
      const user = await repo.findUserByEmail(db, emailInput.trim().toLowerCase());
      if (!user) throw notFound('User');
      await repo.updatePasswordHash(db, user.id, await hashPassword(newPassword));
      await repo.deleteUserSessions(db, user.id);
      await repo.deleteUserResetTokens(db, user.id);
      log.info({ userId: user.id }, 'password reset from CLI');
      return user;
    },

    async cleanup() {
      const now = deps.now();
      const [sessions, tokens] = await Promise.all([repo.deleteExpiredSessions(db, now), repo.deleteExpiredResetTokens(db, now)]);
      return { sessions: sessions.count, tokens: tokens.count };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
