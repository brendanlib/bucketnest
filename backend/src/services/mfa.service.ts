import type { Deps } from './context.js';
import type { AuthService } from './auth.service.js';
import * as repo from '../repositories/auth.js';
import { AppError, conflict, notFound, validationError } from '../lib/errors.js';
import { hmac, open, randomToken, safeEqual, seal } from '../lib/crypto.js';
import { verifyPassword } from '../lib/password.js';
import { newRecoveryCodes, newTotpSecret, normaliseRecoveryCode, otpauthUri, verifyTotp } from '../lib/totp.js';
import { APP_NAME } from '../lib/brand.js';

const PURPOSE = 'totp';
/** How long the password step of a login stays good for while the code is entered. */
const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * TOTP two-step sign-in. After the password, a login gets a short-lived signed
 * challenge instead of a session; the session is issued only once a code (or
 * a single-use recovery code) checks out.
 */
export function createMfaService(deps: Deps, auth: AuthService) {
  const { db, config, log } = deps;
  const recoveryHash = (userId: string, code: string) => hmac(config.sessionSecret, 'recovery', `${userId}:${normaliseRecoveryCode(code)}`);
  const sign = (body: string) => hmac(config.sessionSecret, 'mfa-challenge', body);
  const wrongCode = () => new AppError(400, 'INVALID_CODE', 'That code didn’t work. Check the time on your phone is set automatically, and try the newest code.');

  function notify(user: { email: string; name: string }, subject: string, text: string) {
    if (!deps.mailer.enabled) return;
    void deps.mailer
      .send({ to: user.email, subject, text: `Hi ${user.name},\n\n${text}\n\nIf this wasn't you, change your password straight away and contact your household owner.` })
      .catch((err: unknown) => log.error({ err: (err as Error).message }, 'mfa email failed'));
  }

  async function userOrThrow(userId: string) {
    const user = await repo.findUserById(db, userId);
    if (!user) throw notFound('User');
    return user;
  }

  async function checkPassword(user: { passwordHash: string }, password: string) {
    if (!(await verifyPassword(user.passwordHash, password))) throw new AppError(400, 'INVALID_CREDENTIALS', 'Password is incorrect');
  }

  /** A current TOTP code (each 30-second step once only) or an unused recovery code. */
  async function verifyFactor(user: { id: string; totpSecret: string | null; totpLastStep: number | null }, code: string): Promise<'totp' | 'recovery' | null> {
    if (!user.totpSecret) return null;
    const secret = open(config.sessionSecret, PURPOSE, user.totpSecret);
    const step = verifyTotp(secret, code, deps.now().getTime(), user.totpLastStep);
    if (step !== null) {
      // Claim the step atomically, so two requests with the same code can't both pass.
      const claimed = await db.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
      return claimed.count === 1 ? 'totp' : null;
    }
    if (normaliseRecoveryCode(code).length === 8) {
      const used = await db.recoveryCode.updateMany({ where: { userId: user.id, codeHash: recoveryHash(user.id, code), usedAt: null }, data: { usedAt: deps.now() } });
      if (used.count === 1) return 'recovery';
    }
    return null;
  }

  async function storeRecoveryCodes(userId: string) {
    const codes = newRecoveryCodes();
    await db.$transaction([
      db.recoveryCode.deleteMany({ where: { userId } }),
      db.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: recoveryHash(userId, c) })) }),
    ]);
    return codes;
  }

  return {
    async status(userId: string) {
      const user = await userOrThrow(userId);
      const left = user.totpEnabledAt ? await db.recoveryCode.count({ where: { userId, usedAt: null } }) : 0;
      return { enabled: Boolean(user.totpEnabledAt), enabledAt: user.totpEnabledAt?.toISOString() ?? null, recoveryCodesLeft: left };
    },

    /** Step 1: the password again, then a new secret to scan. Nothing changes until a code confirms it. */
    async beginSetup(userId: string, password: string) {
      const user = await userOrThrow(userId);
      await checkPassword(user, password);
      if (user.totpEnabledAt) throw conflict('MFA_ENABLED', 'Two-step sign-in is already on');
      const secret = newTotpSecret();
      await db.user.update({ where: { id: user.id }, data: { totpPending: seal(config.sessionSecret, PURPOSE, secret) } });
      return { secret, otpauthUri: otpauthUri(secret, user.email) };
    },

    /** Step 2: a code from the app turns it on. Returns the recovery codes, once. Other sessions are signed out. */
    async enable(userId: string, sessionId: string, code: string) {
      const user = await userOrThrow(userId);
      if (user.totpEnabledAt) throw conflict('MFA_ENABLED', 'Two-step sign-in is already on');
      if (!user.totpPending) throw validationError('Start the setup again', { field: 'code' });
      const step = verifyTotp(open(config.sessionSecret, PURPOSE, user.totpPending), code, deps.now().getTime(), null);
      if (step === null) throw wrongCode();
      await db.user.update({ where: { id: user.id }, data: { totpSecret: user.totpPending, totpPending: null, totpEnabledAt: deps.now(), totpLastStep: step } });
      const recoveryCodes = await storeRecoveryCodes(user.id);
      await repo.deleteUserSessions(db, user.id, sessionId);
      log.info({ userId }, 'two-step sign-in enabled');
      notify(user, 'Two-step sign-in is on', `Two-step sign-in was turned on for your ${APP_NAME} account. Signing in now needs a code from your authenticator app.`);
      return { recoveryCodes };
    },

    async disable(userId: string, password: string, code: string) {
      const user = await userOrThrow(userId);
      await checkPassword(user, password);
      if (!user.totpEnabledAt) throw conflict('MFA_DISABLED', 'Two-step sign-in is already off');
      if (!(await verifyFactor(user, code))) throw wrongCode();
      await db.$transaction([
        db.user.update({ where: { id: user.id }, data: { totpSecret: null, totpPending: null, totpEnabledAt: null, totpLastStep: null } }),
        db.recoveryCode.deleteMany({ where: { userId } }),
      ]);
      log.info({ userId }, 'two-step sign-in disabled');
      notify(user, 'Two-step sign-in is off', `Two-step sign-in was turned off for your ${APP_NAME} account.`);
    },

    async regenerateRecoveryCodes(userId: string, password: string, code: string) {
      const user = await userOrThrow(userId);
      await checkPassword(user, password);
      if (!user.totpEnabledAt) throw conflict('MFA_DISABLED', 'Two-step sign-in is off');
      if (!(await verifyFactor(user, code))) throw wrongCode();
      log.info({ userId }, 'recovery codes regenerated');
      return { recoveryCodes: await storeRecoveryCodes(user.id) };
    },

    /** Proof the password step passed: user id, expiry and a nonce, signed. */
    challengeFor(userId: string) {
      const body = `${userId}.${deps.now().getTime() + CHALLENGE_TTL_MS}.${randomToken(12)}`;
      return `${body}.${sign(body)}`;
    },

    /** The user a challenge is for; throws when it's forged or expired. */
    userForChallenge(challenge: string): string {
      const parts = challenge.split('.');
      const expired = new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'That took too long. Sign in again.');
      if (parts.length !== 4) throw expired;
      const body = parts.slice(0, 3).join('.');
      if (!safeEqual(parts[3]!, sign(body)) || Number(parts[1]) <= deps.now().getTime()) throw expired;
      return parts[0]!;
    },

    /** The second step of a login. Returns a new session. */
    async completeLogin(userId: string, code: string, userAgent: string | null, ip: string) {
      const user = await userOrThrow(userId);
      if (!user.totpEnabledAt) throw new AppError(401, 'MFA_CHALLENGE_EXPIRED', 'Sign in again.');
      const kind = await verifyFactor(user, code);
      if (!kind) {
        log.warn({ userId, ip }, 'two-step code failed');
        throw wrongCode();
      }
      if (kind === 'recovery') {
        const left = await db.recoveryCode.count({ where: { userId, usedAt: null } });
        log.warn({ userId, ip, left }, 'signed in with a recovery code');
        notify(user, 'A recovery code was used', `Someone signed in to your ${APP_NAME} account with a recovery code. You have ${left} left. If you've lost your phone, set up two-step sign-in again in Settings → Security.`);
      }
      log.info({ userId, ip }, 'login succeeded (two-step)');
      return { user, session: await auth.issueSession(user.id, userAgent), usedRecoveryCode: kind === 'recovery' };
    },

    /** For the CLI, when someone has lost both their phone and their recovery codes. */
    async adminDisable(email: string) {
      const user = await repo.findUserByEmail(db, email.trim().toLowerCase());
      if (!user) throw notFound('User');
      await db.$transaction([
        db.user.update({ where: { id: user.id }, data: { totpSecret: null, totpPending: null, totpEnabledAt: null, totpLastStep: null } }),
        db.recoveryCode.deleteMany({ where: { userId: user.id } }),
      ]);
      await repo.deleteUserSessions(db, user.id);
      log.warn({ userId: user.id }, 'two-step sign-in removed from the CLI');
      notify(user, 'Two-step sign-in was removed', `The person who runs your ${APP_NAME} server removed two-step sign-in from your account.`);
      return user;
    },
  };
}

export type MfaService = ReturnType<typeof createMfaService>;
