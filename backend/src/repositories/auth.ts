import type { DbTx } from '../db.js';

/** Users, sessions and reset tokens. These are identity records, not household data. */

export const findUserByEmail = (db: DbTx, email: string) => db.user.findUnique({ where: { email: email.toLowerCase() } });

export const findUserById = (db: DbTx, id: string) => db.user.findUnique({ where: { id } });

export const countUsers = (db: DbTx) => db.user.count();

export const createUser = (db: DbTx, data: { email: string; name: string; passwordHash: string }) =>
  db.user.create({ data: { ...data, email: data.email.toLowerCase() } });

export const updatePasswordHash = (db: DbTx, userId: string, passwordHash: string) =>
  db.user.update({ where: { id: userId }, data: { passwordHash } });

export const createSession = (
  db: DbTx,
  data: { tokenHash: string; userId: string; expiresAt: Date; userAgent: string | null; createdAt: Date; lastSeenAt: Date },
) =>
  db.session.create({ data });

export const findSessionByTokenHash = (db: DbTx, tokenHash: string) =>
  db.session.findUnique({ where: { tokenHash }, include: { user: true } });

export const touchSession = (db: DbTx, id: string, lastSeenAt: Date, expiresAt: Date) =>
  db.session.update({ where: { id }, data: { lastSeenAt, expiresAt } });

export const deleteSession = (db: DbTx, id: string) => db.session.deleteMany({ where: { id } });

export const deleteSessionForUser = (db: DbTx, userId: string, id: string) =>
  db.session.deleteMany({ where: { id, userId } });

export const deleteUserSessions = (db: DbTx, userId: string, exceptId?: string) =>
  db.session.deleteMany({ where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) } });

export const listUserSessions = (db: DbTx, userId: string, now: Date) =>
  db.session.findMany({ where: { userId, expiresAt: { gt: now } }, orderBy: { lastSeenAt: 'desc' } });

export const deleteExpiredSessions = (db: DbTx, now: Date) => db.session.deleteMany({ where: { expiresAt: { lte: now } } });

export const createResetToken = (db: DbTx, data: { tokenHash: string; userId: string; expiresAt: Date }) =>
  db.passwordResetToken.create({ data });

export const findResetToken = (db: DbTx, tokenHash: string) => db.passwordResetToken.findUnique({ where: { tokenHash } });

/** Marks a token used only if it is still unused, so a token works exactly once. */
export const consumeResetToken = (db: DbTx, id: string, now: Date) =>
  db.passwordResetToken.updateMany({ where: { id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });

export const deleteExpiredResetTokens = (db: DbTx, now: Date) =>
  db.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }] } });

export const findMembershipForUser = (db: DbTx, userId: string) =>
  db.householdMember.findFirst({
    where: { userId },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    include: { household: true },
  });
