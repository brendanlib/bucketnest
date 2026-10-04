import type { Prisma } from '@prisma/client';
import type { DbTx } from '../db.js';

export const recurringInclude = {
  exceptions: true,
  account: { select: { id: true, name: true } },
  toAccount: { select: { id: true, name: true, class: true, repaymentTreatment: true } },
  category: { select: { id: true, name: true, bucketId: true, bucket: { select: { key: true } } } },
} satisfies Prisma.RecurringTransactionInclude;

export type RecurringWithRelations = Prisma.RecurringTransactionGetPayload<{ include: typeof recurringInclude }>;

export const listRecurring = (db: DbTx, householdId: string, opts: { includeInactive?: boolean } = {}) =>
  db.recurringTransaction.findMany({
    where: { householdId, ...(opts.includeInactive ? {} : { isActive: true }) },
    include: recurringInclude,
    orderBy: [{ name: 'asc' }],
  });

export const findRecurring = (db: DbTx, householdId: string, id: string) =>
  db.recurringTransaction.findFirst({ where: { householdId, id }, include: recurringInclude });

export const createRecurring = (db: DbTx, householdId: string, data: Omit<Prisma.RecurringTransactionUncheckedCreateInput, 'householdId'>) =>
  db.recurringTransaction.create({ data: { ...data, householdId } });

export async function updateRecurring(
  db: DbTx,
  householdId: string,
  id: string,
  data: Omit<Prisma.RecurringTransactionUncheckedUpdateManyInput, 'householdId' | 'id'>,
) {
  await db.recurringTransaction.updateMany({ where: { householdId, id }, data });
}

export const deleteRecurring = (db: DbTx, householdId: string, id: string) =>
  db.recurringTransaction.deleteMany({ where: { householdId, id } });

export async function upsertException(
  db: DbTx,
  householdId: string,
  recurringId: string,
  occurrenceDate: Date,
  data: { action: 'SKIP' | 'EDIT'; overrideAmountCents?: bigint | null; overrideDate?: Date | null },
) {
  await db.recurringException.upsert({
    where: { recurringId_occurrenceDate: { recurringId, occurrenceDate } },
    create: { householdId, recurringId, occurrenceDate, ...data },
    update: { overrideAmountCents: null, overrideDate: null, ...data },
  });
}

export const deleteException = (db: DbTx, householdId: string, recurringId: string, occurrenceDate: Date) =>
  db.recurringException.deleteMany({ where: { householdId, recurringId, occurrenceDate } });

/** Posted occurrences per schedule: (recurringId, occurrenceDate) → transaction id. */
export async function postedOccurrences(db: DbTx, householdId: string, recurringIds: string[], from?: Date, to?: Date) {
  if (recurringIds.length === 0) return new Map<string, string>();
  const rows = await db.transaction.findMany({
    where: {
      householdId,
      recurringId: { in: recurringIds },
      ...(from || to ? { occurrenceDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    select: { id: true, recurringId: true, occurrenceDate: true },
  });
  return new Map(rows.map((r) => [`${r.recurringId}|${r.occurrenceDate!.toISOString().slice(0, 10)}`, r.id]));
}

/** Schedules with auto-post on, across every household (for the daily job). */
export const listAutoPostSchedules = (db: DbTx) =>
  db.recurringTransaction.findMany({ where: { isActive: true, autoPost: true }, include: { ...recurringInclude, household: { select: { timezone: true } } } });
