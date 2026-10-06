import type { Deps } from './context.js';
import type { AuthService } from './auth.service.js';
import * as repo from '../repositories/auth.js';
import { AppError, conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { hmac, randomToken } from '../lib/crypto.js';
import { hashPassword, passwordProblem } from '../lib/password.js';

export const INVITE_TTL_MS = 7 * 86_400_000;
const MAX_PENDING_INVITES = 20;

type Role = 'OWNER' | 'MEMBER';

/**
 * Household members and invites. The owner invites, removes members and can
 * hand over ownership; any member can leave. An invite is a single-use link
 * whose token travels in the URL fragment, so it never reaches server logs.
 */
export function createMemberService(deps: Deps, auth: AuthService) {
  const { db, config, log } = deps;
  const inviteHash = (token: string) => hmac(config.sessionSecret, 'invite', token);
  const requireOwner = (role: Role) => {
    if (role !== 'OWNER') throw forbidden('NOT_OWNER', 'Only the household owner can do this');
  };
  const invalid = () => new AppError(400, 'INVALID_INVITE', 'This invite link is invalid, has been used, or has expired. Ask for a new one.');

  /** A live invite for this token, or throws. */
  async function liveInvite(token: string) {
    const invite = await db.householdInvite.findUnique({
      where: { tokenHash: inviteHash(token) },
      include: { household: { select: { id: true, name: true } }, invitedBy: { select: { name: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt <= deps.now()) throw invalid();
    return invite;
  }

  function checkEmail(invite: { email: string | null }, email: string) {
    if (invite.email && invite.email !== email.trim().toLowerCase()) {
      throw forbidden('INVITE_EMAIL_MISMATCH', `This invite is for ${invite.email}. Use that email address, or ask for a new invite.`);
    }
  }

  /** Marks the invite used and adds the membership, atomically, so a link works exactly once. */
  async function join(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], inviteId: string, householdId: string, userId: string) {
    const consumed = await tx.householdInvite.updateMany({
      where: { id: inviteId, acceptedAt: null, expiresAt: { gt: deps.now() } },
      data: { acceptedAt: deps.now(), acceptedById: userId },
    });
    if (consumed.count !== 1) throw invalid();
    if (await tx.householdMember.findUnique({ where: { householdId_userId: { householdId, userId } } })) {
      throw conflict('ALREADY_MEMBER', 'You are already a member of this household');
    }
    await tx.householdMember.create({ data: { householdId, userId, role: 'MEMBER' } });
    await tx.user.update({ where: { id: userId }, data: { lastHouseholdId: householdId } });
  }

  /** Removes a membership; a user left with no household at all is deleted (as with deleting a household). */
  async function removeMembership(householdId: string, userId: string) {
    return db.$transaction(async (tx) => {
      await tx.householdMember.delete({ where: { householdId_userId: { householdId, userId } } });
      // Sessions working in this household go back to the user's default one.
      await tx.session.updateMany({ where: { userId, householdId }, data: { householdId: null } });
      const remaining = await tx.householdMember.count({ where: { userId } });
      if (remaining === 0) await tx.user.delete({ where: { id: userId } });
      return { accountDeleted: remaining === 0 };
    });
  }

  return {
    async list(householdId: string, userId: string, role: Role) {
      const [members, invites] = await Promise.all([
        db.householdMember.findMany({
          where: { householdId },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        role === 'OWNER'
          ? db.householdInvite.findMany({
              where: { householdId, acceptedAt: null, expiresAt: { gt: deps.now() } },
              orderBy: { createdAt: 'desc' },
              include: { invitedBy: { select: { name: true } } },
            })
          : Promise.resolve([]),
      ]);
      return {
        members: members.map((m) => ({
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          joinedAt: m.createdAt.toISOString(),
          isYou: m.user.id === userId,
        })),
        invites: invites.map((i) => ({
          id: i.id,
          email: i.email,
          invitedBy: i.invitedBy?.name ?? null,
          createdAt: i.createdAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
        })),
        canManage: role === 'OWNER',
      };
    },

    async createInvite(householdId: string, userId: string, role: Role, input: { email?: string | null }) {
      requireOwner(role);
      const email = input.email?.trim().toLowerCase() || null;
      if (email) {
        const existing = await repo.findUserByEmail(db, email);
        if (existing && (await db.householdMember.findUnique({ where: { householdId_userId: { householdId, userId: existing.id } } }))) {
          throw conflict('ALREADY_MEMBER', `${email} is already a member of this household`);
        }
      }
      const pending = await db.householdInvite.count({ where: { householdId, acceptedAt: null, expiresAt: { gt: deps.now() } } });
      if (pending >= MAX_PENDING_INVITES) throw validationError(`There are already ${MAX_PENDING_INVITES} open invites. Revoke some first.`);

      const token = randomToken(32);
      const invite = await db.householdInvite.create({
        data: { householdId, tokenHash: inviteHash(token), email, invitedById: userId, expiresAt: new Date(deps.now().getTime() + INVITE_TTL_MS) },
        include: { household: { select: { name: true } }, invitedBy: { select: { name: true } } },
      });
      // In the fragment (#), which browsers never send to the server.
      const link = `${config.publicUrl}/invite#${token}`;
      const emailed = Boolean(email && deps.mailer.enabled);
      if (email && deps.mailer.enabled) {
        const inviter = invite.invitedBy?.name ?? 'Someone';
        void deps.mailer
          .send({
            to: email,
            subject: `${inviter} invited you to ${invite.household.name} on Home Budget`,
            text: `${inviter} has invited you to share the household budget "${invite.household.name}".\n\nOpen this link within 7 days to join:\n\n${link}\n\nIf you weren't expecting this, you can ignore this email.`,
          })
          .catch((err: unknown) => log.error({ err: (err as Error).message }, 'invite email failed'));
      }
      log.info({ householdId, inviteId: invite.id, userId }, 'invite created');
      return { id: invite.id, link, emailed, expiresAt: invite.expiresAt.toISOString() };
    },

    async revokeInvite(householdId: string, role: Role, id: string) {
      requireOwner(role);
      const r = await db.householdInvite.deleteMany({ where: { householdId, id, acceptedAt: null } });
      if (r.count === 0) throw notFound('Invite');
    },

    /** What the invite page shows before anyone signs in. */
    async lookup(token: string) {
      const invite = await liveInvite(token);
      const registered = invite.email ? Boolean(await repo.findUserByEmail(db, invite.email)) : null;
      return {
        householdName: invite.household.name,
        invitedBy: invite.invitedBy?.name ?? null,
        email: invite.email,
        expiresAt: invite.expiresAt.toISOString(),
        /** Whether the invited email already has an account here (null when the invite names no email). */
        hasAccount: registered,
      };
    },

    /** A logged-in user joins; their session moves to the new household. */
    async accept(userId: string, sessionId: string, token: string) {
      const invite = await liveInvite(token);
      const user = await repo.findUserById(db, userId);
      if (!user) throw invalid();
      checkEmail(invite, user.email);
      await db.$transaction(async (tx) => {
        await join(tx, invite.id, invite.householdId, userId);
        await tx.session.update({ where: { id: sessionId }, data: { householdId: invite.householdId } });
      });
      log.info({ householdId: invite.householdId, userId, inviteId: invite.id }, 'invite accepted');
      return { householdId: invite.householdId, role: 'MEMBER' as const };
    },

    /** A new person creates an account with the invite. Works when registration is closed: the invite is the permission. */
    async register(input: { token: string; name: string; email: string; password: string; userAgent: string | null }) {
      const invite = await liveInvite(input.token);
      const email = input.email.trim().toLowerCase();
      checkEmail(invite, email);
      const problem = passwordProblem(input.password, { email, name: input.name });
      if (problem) throw validationError(problem, { field: 'password' });
      if (await repo.findUserByEmail(db, email)) {
        throw conflict('EMAIL_TAKEN', 'An account with this email already exists. Log in, then open the invite link again.');
      }
      const passwordHash = await hashPassword(input.password);
      const user = await db.$transaction(async (tx) => {
        const created = await repo.createUser(tx, { email, name: input.name.trim(), passwordHash });
        await join(tx, invite.id, invite.householdId, created.id);
        return created;
      });
      log.info({ householdId: invite.householdId, userId: user.id, inviteId: invite.id }, 'user registered from invite');
      const session = await auth.issueSession(user.id, input.userAgent, invite.householdId);
      return { user, session, householdId: invite.householdId };
    },

    async remove(householdId: string, actorId: string, role: Role, userId: string) {
      requireOwner(role);
      if (userId === actorId) throw validationError('You can’t remove yourself. Hand over ownership first, or delete the household.');
      if (!(await db.householdMember.findUnique({ where: { householdId_userId: { householdId, userId } } }))) throw notFound('Member');
      const result = await removeMembership(householdId, userId);
      log.info({ householdId, userId, by: actorId, ...result }, 'member removed');
      return result;
    },

    async leave(householdId: string, userId: string, role: Role) {
      if (role === 'OWNER') throw validationError('The owner can’t leave. Hand over ownership to another member first, or delete the household.');
      const result = await removeMembership(householdId, userId);
      log.info({ householdId, userId, ...result }, 'member left');
      return result;
    },

    /** Hands ownership to another member; the current owner becomes a member. */
    async transferOwnership(householdId: string, actorId: string, role: Role, userId: string) {
      requireOwner(role);
      if (userId === actorId) throw validationError('You are already the owner');
      const target = await db.householdMember.findUnique({ where: { householdId_userId: { householdId, userId } } });
      if (!target) throw notFound('Member');
      await db.$transaction([
        db.householdMember.update({ where: { householdId_userId: { householdId, userId } }, data: { role: 'OWNER' } }),
        db.householdMember.update({ where: { householdId_userId: { householdId, userId: actorId } }, data: { role: 'MEMBER' } }),
      ]);
      log.info({ householdId, from: actorId, to: userId }, 'ownership transferred');
    },

    async cleanup() {
      const r = await db.householdInvite.deleteMany({ where: { acceptedAt: null, expiresAt: { lte: new Date(deps.now().getTime() - 30 * 86_400_000) } } });
      return { invites: r.count };
    },
  };
}

export type MemberService = ReturnType<typeof createMemberService>;
