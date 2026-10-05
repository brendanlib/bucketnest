import type { Account, Category, Debt, Prisma, TransactionType } from '@prisma/client';
import type { Deps } from './context.js';
import type { DbTx } from '../db.js';
import * as repo from '../repositories/transactions.js';
import { balanceMovements, findAccountsByIds } from '../repositories/accounts.js';
import { calculateAccountBalance } from '../finance/balance.js';
import { findCategoriesByIds, findCategoryBySystemKey } from '../repositories/categories.js';
import { listBuckets } from '../repositories/buckets.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { cents, centsOrNull, dateIn, dateOut, dateOutOrNull } from '../lib/serialize.js';
import { splitDebtRepayment } from '../finance/repayment.js';
import { SYSTEM_CATEGORY } from '../seed/defaults.js';
import type { TransactionSort } from '../repositories/transactions.js';

export interface SplitRequest {
  categoryId: string;
  amountCents: number;
  isSinkingFundPayment?: boolean;
}

export interface TransactionInput {
  date: string;
  description: string;
  payee?: string | null;
  amountCents: number;
  type: TransactionType;
  accountId: string;
  toAccountId?: string | null;
  direction?: 'INCREASE' | 'DECREASE' | null;
  splits?: SplitRequest[];
  notes?: string | null;
  cleared?: boolean;
  goalId?: string | null;
  gstCents?: number | null;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  accountId?: string;
  bucketId?: string;
  categoryId?: string;
  type?: TransactionType[];
  minCents?: number;
  maxCents?: number;
  search?: string;
  uncategorised?: boolean;
  importBatchId?: string;
  sort: TransactionSort;
  order: 'asc' | 'desc';
}

type AccountWithDebt = Account & { debt: Debt | null };

export function serializeTransaction(t: repo.TransactionWithRelations) {
  const buckets = new Map<string, { id: string; key: string; name: string; colour: string }>();
  for (const s of t.splits) if (s.category.bucket) buckets.set(s.category.bucket.id, s.category.bucket);
  return {
    id: t.id,
    date: dateOut(t.date),
    description: t.description,
    payee: t.payee,
    amountCents: cents(t.amountCents),
    type: t.type,
    direction: t.direction,
    accountId: t.accountId,
    accountName: t.account.name,
    toAccountId: t.toAccountId,
    toAccountName: t.toAccount?.name ?? null,
    splits: t.splits.map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      categoryName: s.category.name,
      bucketId: s.category.bucket?.id ?? null,
      amountCents: cents(s.amountCents),
      isExtraRepayment: s.isExtraRepayment,
      isSinkingFundPayment: s.isSinkingFundPayment,
    })),
    buckets: [...buckets.values()],
    uncategorised: repo.CATEGORISED_TYPES.includes(t.type) && t.splits.length === 0,
    notes: t.notes,
    cleared: t.cleared,
    recurringId: t.recurringId,
    occurrenceDate: dateOutOrNull(t.occurrenceDate),
    importBatchId: t.importBatchId,
    goalId: t.goalId,
    gstCents: centsOrNull(t.gstCents),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export type SerializedTransaction = ReturnType<typeof serializeTransaction>;

/** Default Bills category for the minimum part of a repayment, by liability type. */
function defaultRepaymentCategoryKey(account: Account): string {
  switch (account.type) {
    case 'MORTGAGE':
      return SYSTEM_CATEGORY.mortgage;
    case 'CREDIT_CARD':
      return SYSTEM_CATEGORY.creditCardRepayments;
    case 'HECS_HELP':
      return SYSTEM_CATEGORY.otherMandatoryRepayments;
    default:
      return SYSTEM_CATEGORY.loanRepayments;
  }
}

/** Caches lookups while validating many transactions at once (imports). */
export type PrepareMemo = Map<string, Promise<unknown>>;

export function createTransactionService(deps: Deps) {
  const { db } = deps;

  function memo<T>(m: PrepareMemo | undefined, key: string, load: () => Promise<T>): Promise<T> {
    if (!m) return load();
    if (!m.has(key)) m.set(key, load());
    return m.get(key) as Promise<T>;
  }

  async function systemCategory(householdId: string, key: string, m?: PrepareMemo): Promise<Category> {
    const c = await memo(m, `sys:${key}`, () => findCategoryBySystemKey(db, householdId, key));
    if (!c) throw new Error(`System category ${key} is missing for household ${householdId}`);
    return c;
  }

  /**
   * Validates input and works out what to store. Some types are normalised so
   * the money is counted the way spec §3.4–3.5 says, whichever way it was entered:
   * - a transfer into a liability with Debt repayment treatment becomes a debt repayment;
   * - a transfer from a non-Fire Extinguisher account into a Fire Extinguisher account becomes a savings contribution;
   * - an interest charge on a Transfer-treatment liability (a credit card) becomes an expense in Interest and fees.
   */
  async function prepare(
    householdId: string,
    input: TransactionInput,
    opts: { allowUncategorised?: boolean; existing?: repo.TransactionWithRelations | null; memo?: PrepareMemo } = {},
  ) {
    const m = opts.memo;
    const ids = [input.accountId, ...(input.toAccountId ? [input.toAccountId] : [])];
    const accountRows = await Promise.all(ids.map((id) => memo(m, `acct:${id}`, async () => (await findAccountsByIds(db, householdId, [id]))[0])));
    const accounts = new Map(accountRows.filter((a): a is NonNullable<typeof a> => Boolean(a)).map((a) => [a.id, a as AccountWithDebt]));
    const account = accounts.get(input.accountId);
    if (!account) throw validationError('Unknown account', { field: 'accountId' });
    const toAccount = input.toAccountId ? accounts.get(input.toAccountId) : undefined;
    if (input.toAccountId && !toAccount) throw validationError('Unknown account', { field: 'toAccountId' });
    if (toAccount && toAccount.id === account.id) throw validationError('Choose two different accounts', { field: 'toAccountId' });

    const unchangedAccount = (id: string) => opts.existing && (opts.existing.accountId === id || opts.existing.toAccountId === id);
    for (const [field, a] of [['accountId', account], ['toAccountId', toAccount]] as const) {
      if (a?.isClosed && !unchangedAccount(a.id)) throw validationError(`${a.name} is closed`, { field });
    }

    if (input.gstCents !== undefined && input.gstCents !== null && (input.gstCents < 0 || input.gstCents > input.amountCents)) {
      throw validationError('GST must be between 0 and the amount', { field: 'gstCents' });
    }

    if (input.goalId) {
      const goal = await db.financialGoal.findFirst({ where: { householdId, id: input.goalId } });
      if (!goal) throw validationError('Unknown goal', { field: 'goalId' });
    }

    const buckets = await memo(m, 'buckets', () => listBuckets(db, householdId));
    const fireBucketId = buckets.find((b) => b.key === 'FIRE_EXTINGUISHER')!.id;
    const isFire = (a: Account) => a.class === 'ASSET' && a.bucketTagId === fireBucketId;

    let type = input.type;
    let requestedSplits = input.splits ?? [];

    if (type === 'TRANSFER' && toAccount) {
      if (account.class === 'ASSET' && toAccount.class === 'LIABILITY' && toAccount.repaymentTreatment === 'DEBT_REPAYMENT') {
        type = 'DEBT_REPAYMENT';
      } else if (isFire(toAccount) && !isFire(account) && account.class === 'ASSET') {
        type = 'SAVINGS_CONTRIBUTION';
      }
    }
    if (type === 'INTEREST_CHARGE' && account.class === 'LIABILITY' && account.repaymentTreatment !== 'DEBT_REPAYMENT') {
      type = 'EXPENSE';
      const fees = await systemCategory(householdId, SYSTEM_CATEGORY.interestAndFees, m);
      requestedSplits = [{ categoryId: fees.id, amountCents: input.amountCents }];
    }

    const needsTo = type === 'TRANSFER' || type === 'DEBT_REPAYMENT' || type === 'SAVINGS_CONTRIBUTION';
    if (needsTo && !toAccount) throw validationError('Choose the account the money goes to', { field: 'toAccountId' });
    if (!needsTo && toAccount) throw validationError('This type of transaction uses one account', { field: 'toAccountId' });
    if (type === 'BALANCE_ADJUSTMENT' && !input.direction) {
      throw validationError('Say whether the adjustment increases or decreases the balance', { field: 'direction' });
    }

    let splits: repo.SplitInput[] = [];
    switch (type) {
      case 'INCOME':
      case 'EXPENSE':
      case 'REFUND': {
        const kind = type === 'INCOME' ? 'INCOME' : 'EXPENSE';
        if (requestedSplits.length === 0 && !opts.allowUncategorised) {
          throw validationError(type === 'INCOME' ? 'Choose an income category' : 'Choose a category', { field: 'splits' });
        }
        splits = await validateSplits(householdId, requestedSplits, input.amountCents, kind, opts.existing, m);
        break;
      }
      case 'DEBT_REPAYMENT': {
        if (account.class !== 'ASSET' || toAccount!.class !== 'LIABILITY') {
          throw validationError('A debt repayment goes from an asset account to a liability', { field: 'toAccountId' });
        }
        if (toAccount!.repaymentTreatment === 'DEBT_REPAYMENT') {
          const debt = toAccount!.debt;
          const parts = splitDebtRepayment(input.amountCents, debt ? cents(debt.minRepaymentCents) : null);
          const minCategory = debt?.categoryId
            ? { id: debt.categoryId }
            : await systemCategory(householdId, defaultRepaymentCategoryKey(toAccount!), m);
          if (parts.minimumCents > 0) splits.push({ categoryId: minCategory.id, amountCents: parts.minimumCents });
          if (parts.extraCents > 0) {
            const extra = await systemCategory(householdId, SYSTEM_CATEGORY.extraDebtRepayments, m);
            splits.push({ categoryId: extra.id, amountCents: parts.extraCents, isExtraRepayment: true });
          }
        }
        break;
      }
      case 'SAVINGS_CONTRIBUTION': {
        if (account.class !== 'ASSET' || !isFire(toAccount!)) {
          throw validationError('A savings contribution goes into an account tagged Fire Extinguisher', { field: 'toAccountId' });
        }
        if (requestedSplits.length > 1) throw validationError('A savings contribution has one category', { field: 'splits' });
        const categoryId = requestedSplits[0]?.categoryId ?? (await systemCategory(householdId, SYSTEM_CATEGORY.savingsContributions, m)).id;
        splits = await validateSplits(householdId, [{ categoryId, amountCents: input.amountCents }], input.amountCents, 'EXPENSE', opts.existing, m);
        if ((await memo(m, `cat:${categoryId}`, async () => (await findCategoriesByIds(db, householdId, [categoryId]))[0]))?.bucketId !== fireBucketId) {
          throw validationError('Choose a Fire Extinguisher category', { field: 'splits' });
        }
        break;
      }
      case 'TRANSFER':
      case 'BALANCE_ADJUSTMENT':
        break;
      case 'INTEREST_CHARGE':
        if (account.class !== 'LIABILITY') throw validationError('Interest charges apply to liability accounts', { field: 'accountId' });
        break;
    }

    const data = {
      date: dateIn(input.date),
      description: input.description,
      payee: input.payee ?? null,
      amountCents: BigInt(input.amountCents),
      type,
      direction: type === 'BALANCE_ADJUSTMENT' ? input.direction! : null,
      accountId: account.id,
      toAccountId: needsTo ? toAccount!.id : null,
      notes: input.notes ?? null,
      cleared: input.cleared ?? false,
      goalId: input.goalId ?? null,
      gstCents: input.gstCents === undefined || input.gstCents === null ? null : BigInt(input.gstCents),
    } satisfies Omit<Prisma.TransactionUncheckedCreateInput, 'householdId'>;
    return { data, splits };
  }

  async function validateSplits(
    householdId: string,
    requested: SplitRequest[],
    amountCents: number,
    kind: 'INCOME' | 'EXPENSE',
    existing?: repo.TransactionWithRelations | null,
    m?: PrepareMemo,
  ): Promise<repo.SplitInput[]> {
    if (requested.length === 0) return [];
    const ids = requested.map((s) => s.categoryId);
    if (new Set(ids).size !== ids.length) throw validationError('Each category can appear only once in the splits', { field: 'splits' });
    const found = await Promise.all(ids.map((id) => memo(m, `cat:${id}`, async () => (await findCategoriesByIds(db, householdId, [id]))[0])));
    const categories = new Map(found.filter((c): c is Category => Boolean(c)).map((c) => [c.id, c]));
    const alreadyUsed = new Set(existing?.splits.map((s) => s.categoryId) ?? []);
    let total = 0;
    for (const [i, s] of requested.entries()) {
      const c = categories.get(s.categoryId);
      const field = `splits.${i}.categoryId`;
      if (!c) throw validationError('Unknown category', { field });
      if (c.isGroup) throw validationError(`${c.name} is a group; choose a category inside it`, { field });
      if (!c.isActive && !alreadyUsed.has(c.id)) throw validationError(`${c.name} is disabled`, { field });
      if (c.kind !== kind) {
        throw validationError(kind === 'INCOME' ? `${c.name} is not an income category` : `${c.name} is an income category`, { field });
      }
      if (s.amountCents <= 0) throw validationError('Split amounts must be greater than 0', { field: `splits.${i}.amountCents` });
      total += s.amountCents;
    }
    if (total !== amountCents) {
      throw validationError(`Splits total ${total} cents but the transaction is ${amountCents} cents`, {
        field: 'splits',
        splitTotalCents: total,
        amountCents,
      });
    }
    return requested.map((s) => ({ categoryId: s.categoryId, amountCents: s.amountCents, isSinkingFundPayment: s.isSinkingFundPayment }));
  }

  /**
   * Deleting a transaction that an auto-post schedule created records a skip,
   * so the daily job does not post the occurrence again.
   */
  async function skipAutoPosted(tx: DbTx, householdId: string, list: { recurringId: string | null; occurrenceDate: Date | null }[]) {
    const linked = list.filter((t) => t.recurringId && t.occurrenceDate);
    if (!linked.length) return;
    const autoPost = new Set(
      (await tx.recurringTransaction.findMany({ where: { householdId, id: { in: linked.map((t) => t.recurringId!) }, autoPost: true }, select: { id: true } })).map((r) => r.id),
    );
    for (const t of linked) {
      if (!autoPost.has(t.recurringId!)) continue;
      await tx.recurringException.upsert({
        where: { recurringId_occurrenceDate: { recurringId: t.recurringId!, occurrenceDate: t.occurrenceDate! } },
        create: { householdId, recurringId: t.recurringId!, occurrenceDate: t.occurrenceDate!, action: 'SKIP' },
        update: { action: 'SKIP', overrideAmountCents: null, overrideDate: null },
      });
    }
  }

  async function loadOrThrow(householdId: string, id: string) {
    const t = await repo.findTransaction(db, householdId, id);
    if (!t) throw notFound('Transaction');
    return t;
  }

  return {
    prepare,

    async list(householdId: string, q: ListQuery) {
      const { items, total } = await repo.listTransactions(
        db,
        householdId,
        {
          from: q.from ? dateIn(q.from) : undefined,
          to: q.to ? dateIn(q.to) : undefined,
          accountId: q.accountId,
          bucketId: q.bucketId,
          categoryId: q.categoryId,
          types: q.type,
          minCents: q.minCents,
          maxCents: q.maxCents,
          search: q.search,
          uncategorised: q.uncategorised,
          importBatchId: q.importBatchId,
        },
        { skip: (q.page - 1) * q.pageSize, take: q.pageSize, sort: q.sort, order: q.order },
      );
      return { items: items.map(serializeTransaction), total, page: q.page, pageSize: q.pageSize };
    },

    async get(householdId: string, id: string) {
      return serializeTransaction(await loadOrThrow(householdId, id));
    },

    /** Creates a transaction; `link` ties it to a recurring occurrence (posting is idempotent). */
    async create(householdId: string, userId: string | null, input: TransactionInput, link?: { recurringId: string; occurrenceDate: string }) {
      const { data, splits } = await prepare(householdId, input);
      try {
        const created = await db.$transaction((tx) =>
          repo.createTransaction(
            tx,
            householdId,
            { ...data, createdById: userId, ...(link ? { recurringId: link.recurringId, occurrenceDate: dateIn(link.occurrenceDate) } : {}) },
            splits,
          ),
        );
        return this.get(householdId, created.id);
      } catch (err) {
        if (link && err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
          throw conflict('ALREADY_POSTED', 'This occurrence is already recorded');
        }
        throw err;
      }
    },

    async update(householdId: string, id: string, input: TransactionInput, opts: { allowUncategorised?: boolean } = {}) {
      const existing = await loadOrThrow(householdId, id);
      const { data, splits } = await prepare(householdId, input, { existing, allowUncategorised: opts.allowUncategorised });
      await db.$transaction((tx) => repo.updateTransaction(tx, householdId, id, data, splits));
      return this.get(householdId, id);
    },

    async remove(householdId: string, id: string) {
      const t = await loadOrThrow(householdId, id);
      await db.$transaction(async (tx) => {
        await skipAutoPosted(tx, householdId, [t]);
        await repo.deleteTransactions(tx, householdId, [id]);
      });
    },

    async bulk(householdId: string, input: { action: 'delete' | 'recategorise'; ids: string[]; categoryId?: string }) {
      const ids = [...new Set(input.ids)];
      const found = await repo.findTransactionsByIds(db, householdId, ids);
      if (found.length !== ids.length) throw notFound('Transaction');

      if (input.action === 'delete') {
        const result = await db.$transaction(async (tx) => {
          await skipAutoPosted(tx, householdId, found);
          return repo.deleteTransactions(tx, householdId, ids);
        });
        return { deleted: result.count, updated: 0, skipped: 0 };
      }

      if (!input.categoryId) throw validationError('Choose a category', { field: 'categoryId' });
      const [category] = await findCategoriesByIds(db, householdId, [input.categoryId]);
      if (!category || category.isGroup) throw validationError('Unknown category', { field: 'categoryId' });
      if (!category.isActive) throw validationError(`${category.name} is disabled`, { field: 'categoryId' });

      const eligible = found.filter((t) =>
        category.kind === 'INCOME' ? t.type === 'INCOME' : t.type === 'EXPENSE' || t.type === 'REFUND',
      );
      await db.$transaction(async (tx) => {
        for (const t of eligible) {
          await repo.replaceSplits(tx, householdId, t.id, [{ categoryId: category.id, amountCents: cents(t.amountCents) }]);
        }
      });
      return { deleted: 0, updated: eligible.length, skipped: found.length - eligible.length };
    },

    countUncategorised: (householdId: string) => repo.countUncategorised(db, householdId),

    /** An account's balance at the end of a date. */
    async balanceOf(householdId: string, accountId: string, date: string) {
      const account = (await findAccountsByIds(db, householdId, [accountId]))[0];
      if (!account) return null;
      const movements = await balanceMovements(db, householdId, { accountIds: [accountId], asOf: dateIn(date) });
      const opening = dateIn(date) < account.openingDate ? 0 : cents(account.openingBalanceCents);
      return calculateAccountBalance(opening, account.class, movements.get(accountId) ?? []);
    },
  };
}

export type TransactionService = ReturnType<typeof createTransactionService>;
