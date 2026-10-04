import type { Prisma } from '@prisma/client';
import type { DbTx } from '../db.js';
import type { BalanceMovement } from '../finance/balance.js';
import { cents } from '../lib/serialize.js';

export const listAccounts = (db: DbTx, householdId: string, opts: { includeClosed?: boolean } = {}) =>
  db.account.findMany({
    where: { householdId, ...(opts.includeClosed ? {} : { isClosed: false }) },
    orderBy: [{ isClosed: 'asc' }, { class: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: { debt: { select: { id: true } } },
  });

export const findAccount = (db: DbTx, householdId: string, id: string) =>
  db.account.findFirst({ where: { householdId, id }, include: { debt: true } });

export const findAccountsByIds = (db: DbTx, householdId: string, ids: string[]) =>
  db.account.findMany({ where: { householdId, id: { in: ids } }, include: { debt: true } });

export const createAccount = (db: DbTx, householdId: string, data: Omit<Prisma.AccountUncheckedCreateInput, 'householdId'>) =>
  db.account.create({ data: { ...data, householdId } });

export async function updateAccount(
  db: DbTx,
  householdId: string,
  id: string,
  data: Omit<Prisma.AccountUncheckedUpdateManyInput, 'householdId' | 'id'>,
) {
  await db.account.updateMany({ where: { householdId, id }, data });
}

export const deleteAccount = (db: DbTx, householdId: string, id: string) =>
  db.account.deleteMany({ where: { householdId, id } });

export const countAccountTransactions = (db: DbTx, householdId: string, id: string) =>
  db.transaction.count({ where: { householdId, OR: [{ accountId: id }, { toAccountId: id }] } });

export const countAccountReferences = async (db: DbTx, householdId: string, id: string) => {
  const [recurring, offsets] = await Promise.all([
    db.recurringTransaction.count({ where: { householdId, OR: [{ accountId: id }, { toAccountId: id }] } }),
    db.account.count({ where: { householdId, offsetForAccountId: id } }),
  ]);
  return { recurring, offsets };
};

/**
 * Sums of transaction amounts per account, grouped so the finance module can
 * apply the sign rules. Only sums leave the database, so this stays fast with
 * tens of thousands of transactions.
 */
export async function balanceMovements(
  db: DbTx,
  householdId: string,
  opts: { accountIds?: string[]; asOf?: Date } = {},
): Promise<Map<string, BalanceMovement[]>> {
  const date = opts.asOf ? { lte: opts.asOf } : undefined;
  const [fromRows, toRows] = await Promise.all([
    db.transaction.groupBy({
      by: ['accountId', 'type', 'direction'],
      where: { householdId, ...(opts.accountIds ? { accountId: { in: opts.accountIds } } : {}), ...(date ? { date } : {}) },
      _sum: { amountCents: true },
    }),
    db.transaction.groupBy({
      by: ['toAccountId', 'type'],
      where: {
        householdId,
        toAccountId: opts.accountIds ? { in: opts.accountIds } : { not: null },
        ...(date ? { date } : {}),
      },
      _sum: { amountCents: true },
    }),
  ]);
  const result = new Map<string, BalanceMovement[]>();
  const push = (id: string, m: BalanceMovement) => {
    const list = result.get(id) ?? [];
    list.push(m);
    result.set(id, list);
  };
  for (const r of fromRows) {
    push(r.accountId, { type: r.type, direction: r.direction, amountCents: cents(r._sum.amountCents ?? 0n), role: 'from' });
  }
  for (const r of toRows) {
    if (r.toAccountId) push(r.toAccountId, { type: r.type, amountCents: cents(r._sum.amountCents ?? 0n), role: 'to' });
  }
  return result;
}

/** Per-day movement sums for one account between two dates (inclusive). */
export async function dailyMovements(db: DbTx, householdId: string, accountId: string, from: Date, to: Date) {
  const [fromRows, toRows] = await Promise.all([
    db.transaction.groupBy({
      by: ['date', 'type', 'direction'],
      where: { householdId, accountId, date: { gte: from, lte: to } },
      _sum: { amountCents: true },
    }),
    db.transaction.groupBy({
      by: ['date', 'type'],
      where: { householdId, toAccountId: accountId, date: { gte: from, lte: to } },
      _sum: { amountCents: true },
    }),
  ]);
  const rows: { date: Date; movement: BalanceMovement }[] = [];
  for (const r of fromRows) {
    rows.push({ date: r.date, movement: { type: r.type, direction: r.direction, amountCents: cents(r._sum.amountCents ?? 0n), role: 'from' } });
  }
  for (const r of toRows) {
    rows.push({ date: r.date, movement: { type: r.type, amountCents: cents(r._sum.amountCents ?? 0n), role: 'to' } });
  }
  return rows;
}
