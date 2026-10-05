import type { Prisma, TransactionType } from '@prisma/client';
import type { DbTx } from '../db.js';

export const transactionInclude = {
  account: { select: { id: true, name: true, class: true } },
  toAccount: { select: { id: true, name: true, class: true } },
  splits: {
    orderBy: { createdAt: 'asc' },
    include: {
      category: {
        select: { id: true, name: true, bucket: { select: { id: true, key: true, name: true, colour: true } } },
      },
    },
  },
} satisfies Prisma.TransactionInclude;

export type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

export interface TransactionFilters {
  from?: Date;
  to?: Date;
  accountId?: string;
  bucketId?: string;
  categoryId?: string;
  types?: TransactionType[];
  minCents?: number;
  maxCents?: number;
  search?: string;
  uncategorised?: boolean;
  importBatchId?: string;
}

/** Expenses, refunds and income need categories; one with no splits is uncategorised. */
export const CATEGORISED_TYPES: TransactionType[] = ['EXPENSE', 'REFUND', 'INCOME'];

export function buildTransactionWhere(householdId: string, f: TransactionFilters): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [{ householdId }];
  if (f.from || f.to) and.push({ date: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
  if (f.accountId) and.push({ OR: [{ accountId: f.accountId }, { toAccountId: f.accountId }] });
  if (f.categoryId) and.push({ splits: { some: { categoryId: f.categoryId } } });
  if (f.bucketId) and.push({ splits: { some: { category: { bucketId: f.bucketId } } } });
  if (f.types?.length) and.push({ type: { in: f.types } });
  if (f.minCents !== undefined) and.push({ amountCents: { gte: BigInt(f.minCents) } });
  if (f.maxCents !== undefined) and.push({ amountCents: { lte: BigInt(f.maxCents) } });
  if (f.search) {
    const contains = f.search;
    and.push({
      OR: [
        { description: { contains, mode: 'insensitive' } },
        { payee: { contains, mode: 'insensitive' } },
        { notes: { contains, mode: 'insensitive' } },
      ],
    });
  }
  if (f.importBatchId) and.push({ OR: [{ importBatchId: f.importBatchId }, { bankRows: { some: { importBatchId: f.importBatchId } } }] });
  if (f.uncategorised) and.push({ type: { in: CATEGORISED_TYPES }, splits: { none: {} } });
  return { AND: and };
}

export type TransactionSort = 'date' | 'amount' | 'description' | 'payee' | 'type' | 'account' | 'createdAt';

export function buildTransactionOrder(sort: TransactionSort, order: 'asc' | 'desc'): Prisma.TransactionOrderByWithRelationInput[] {
  const primary: Prisma.TransactionOrderByWithRelationInput =
    sort === 'amount'
      ? { amountCents: order }
      : sort === 'account'
        ? { account: { name: order } }
        : sort === 'payee'
          ? { payee: { sort: order, nulls: 'last' } }
          : { [sort]: order };
  // Stable tiebreakers so pagination never repeats or skips rows.
  return [primary, { date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }];
}

export async function listTransactions(
  db: DbTx,
  householdId: string,
  filters: TransactionFilters,
  page: { skip: number; take: number; sort: TransactionSort; order: 'asc' | 'desc' },
) {
  const where = buildTransactionWhere(householdId, filters);
  const [items, total] = await Promise.all([
    db.transaction.findMany({
      where,
      include: transactionInclude,
      orderBy: buildTransactionOrder(page.sort, page.order),
      skip: page.skip,
      take: page.take,
    }),
    db.transaction.count({ where }),
  ]);
  return { items, total };
}

export const findTransaction = (db: DbTx, householdId: string, id: string) =>
  db.transaction.findFirst({ where: { householdId, id }, include: transactionInclude });

export const findTransactionsByIds = (db: DbTx, householdId: string, ids: string[]) =>
  db.transaction.findMany({ where: { householdId, id: { in: ids } }, include: transactionInclude });

export interface SplitInput {
  categoryId: string;
  amountCents: number;
  isExtraRepayment?: boolean;
  isSinkingFundPayment?: boolean;
  sinkingFundId?: string | null;
}

export async function createTransaction(
  db: DbTx,
  householdId: string,
  data: Omit<Prisma.TransactionUncheckedCreateInput, 'householdId' | 'splits'>,
  splits: SplitInput[],
) {
  const tx = await db.transaction.create({ data: { ...data, householdId } });
  await replaceSplits(db, householdId, tx.id, splits);
  return tx;
}

export async function updateTransaction(
  db: DbTx,
  householdId: string,
  id: string,
  data: Omit<Prisma.TransactionUncheckedUpdateManyInput, 'householdId' | 'id'>,
  splits?: SplitInput[],
) {
  await db.transaction.updateMany({ where: { householdId, id }, data });
  if (splits) await replaceSplits(db, householdId, id, splits);
}

export async function replaceSplits(db: DbTx, householdId: string, transactionId: string, splits: SplitInput[]) {
  await db.transactionSplit.deleteMany({ where: { householdId, transactionId } });
  if (splits.length) {
    await db.transactionSplit.createMany({
      data: splits.map((s) => ({
        householdId,
        transactionId,
        categoryId: s.categoryId,
        amountCents: BigInt(s.amountCents),
        isExtraRepayment: s.isExtraRepayment ?? false,
        isSinkingFundPayment: s.isSinkingFundPayment ?? false,
        sinkingFundId: s.sinkingFundId ?? null,
      })),
    });
  }
}

export const deleteTransactions = (db: DbTx, householdId: string, ids: string[]) =>
  db.transaction.deleteMany({ where: { householdId, id: { in: ids } } });

export const countUncategorised = (db: DbTx, householdId: string) =>
  db.transaction.count({ where: { householdId, type: { in: CATEGORISED_TYPES }, splits: { none: {} } } });
