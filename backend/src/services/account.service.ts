import type { Account, AccountType, Prisma, RepaymentTreatment } from '@prisma/client';
import type { Deps } from './context.js';
import * as repo from '../repositories/accounts.js';
import { listBuckets } from '../repositories/buckets.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { cents, dateIn, dateOut } from '../lib/serialize.js';
import { balanceEffect, calculateAccountBalance, reconciliationAdjustment } from '../finance/balance.js';
import { addDays, dateInTimeZone, diffDays } from '../finance/dates.js';
import { getHousehold } from '../repositories/households.js';

export const LIABILITY_TYPES: readonly AccountType[] = [
  'CREDIT_CARD',
  'MORTGAGE',
  'PERSONAL_LOAN',
  'CAR_LOAN',
  'HECS_HELP',
  'OTHER_LIABILITY',
];

export const accountClassOf = (type: AccountType) => (LIABILITY_TYPES.includes(type) ? 'LIABILITY' : 'ASSET');

/** Spec §7: on for everyday and card accounts, off for super and other long-term holdings. */
function defaultIncludeInBudget(type: AccountType): boolean {
  return !['SUPERANNUATION', 'INVESTMENT', 'OTHER_ASSET', 'HECS_HELP'].includes(type);
}

/** Spec §3.5: cards are transfers; loans split into minimum and extra. */
export function defaultRepaymentTreatment(type: AccountType): RepaymentTreatment | null {
  if (accountClassOf(type) === 'ASSET') return null;
  return type === 'CREDIT_CARD' || type === 'HECS_HELP' ? 'TRANSFER' : 'DEBT_REPAYMENT';
}

export interface AccountInput {
  name: string;
  type: AccountType;
  institution?: string | null;
  openingBalanceCents: number;
  openingDate: string;
  last4?: string | null;
  bucketTagId?: string | null;
  includeInBudget?: boolean;
  includeInNetWorth?: boolean;
  repaymentTreatment?: RepaymentTreatment | null;
  offsetForAccountId?: string | null;
  notes?: string | null;
  isClosed?: boolean;
  sortOrder?: number;
}

type AccountRow = Account & { debt?: { id: string } | null };

export function serializeAccount(a: AccountRow, balanceCents: number) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    class: a.class,
    institution: a.institution,
    openingBalanceCents: cents(a.openingBalanceCents),
    openingDate: dateOut(a.openingDate),
    balanceCents,
    last4: a.last4,
    bucketTagId: a.bucketTagId,
    includeInBudget: a.includeInBudget,
    includeInNetWorth: a.includeInNetWorth,
    repaymentTreatment: a.repaymentTreatment,
    offsetForAccountId: a.offsetForAccountId,
    hasDebtProfile: Boolean(a.debt),
    notes: a.notes,
    isClosed: a.isClosed,
    sortOrder: a.sortOrder,
  };
}

export function createAccountService(deps: Deps) {
  const { db } = deps;

  /** Balances as of a date. Before an account's opening date its opening balance does not count yet. */
  async function balancesFor(householdId: string, accounts: Account[], asOf?: Date) {
    const movements = await repo.balanceMovements(db, householdId, { accountIds: accounts.map((a) => a.id), asOf });
    return new Map(
      accounts.map((a) => {
        const opening = asOf && asOf < a.openingDate ? 0 : cents(a.openingBalanceCents);
        return [a.id, calculateAccountBalance(opening, a.class, movements.get(a.id) ?? [])];
      }),
    );
  }

  async function loadOrThrow(householdId: string, id: string) {
    const a = await repo.findAccount(db, householdId, id);
    if (!a) throw notFound('Account');
    return a;
  }

  async function validate(householdId: string, input: AccountInput, existing?: Account) {
    const accountClass = accountClassOf(input.type);
    if (existing && existing.class !== accountClass) {
      const used = await repo.countAccountTransactions(db, householdId, existing.id);
      if (used > 0) {
        throw validationError('An account with transactions cannot switch between asset and liability', { field: 'type' });
      }
    }
    if (input.last4 && !/^\d{4}$/.test(input.last4)) {
      throw validationError('Enter only the last 4 digits of the account number', { field: 'last4' });
    }
    if (input.bucketTagId) {
      if (accountClass !== 'ASSET') throw validationError('Only asset accounts can carry a bucket tag', { field: 'bucketTagId' });
      const buckets = await listBuckets(db, householdId);
      if (!buckets.some((b) => b.id === input.bucketTagId)) throw validationError('Unknown bucket', { field: 'bucketTagId' });
    }
    if (input.repaymentTreatment && accountClass !== 'LIABILITY') {
      throw validationError('Repayment treatment applies to liabilities only', { field: 'repaymentTreatment' });
    }
    if (input.offsetForAccountId) {
      if (input.type !== 'OFFSET') throw validationError('Only offset accounts can link to a mortgage', { field: 'offsetForAccountId' });
      const target = await repo.findAccount(db, householdId, input.offsetForAccountId);
      if (!target || target.type !== 'MORTGAGE') {
        throw validationError('An offset account must link to a mortgage', { field: 'offsetForAccountId' });
      }
    }
    if (input.openingBalanceCents < 0 && accountClass === 'LIABILITY') {
      throw validationError('Enter the amount owed as a positive number', { field: 'openingBalanceCents' });
    }
    return accountClass;
  }

  function toData(input: AccountInput, accountClass: 'ASSET' | 'LIABILITY') {
    return {
      name: input.name,
      type: input.type,
      class: accountClass,
      institution: input.institution ?? null,
      openingBalanceCents: BigInt(input.openingBalanceCents),
      openingDate: dateIn(input.openingDate),
      last4: input.last4 ?? null,
      bucketTagId: accountClass === 'ASSET' ? (input.bucketTagId ?? null) : null,
      includeInBudget: input.includeInBudget ?? defaultIncludeInBudget(input.type),
      includeInNetWorth: input.includeInNetWorth ?? true,
      repaymentTreatment:
        accountClass === 'LIABILITY' ? (input.repaymentTreatment ?? defaultRepaymentTreatment(input.type)) : null,
      offsetForAccountId: input.type === 'OFFSET' ? (input.offsetForAccountId ?? null) : null,
      notes: input.notes ?? null,
      isClosed: input.isClosed ?? false,
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    } satisfies Omit<Prisma.AccountUncheckedCreateInput, 'householdId'>;
  }

  return {
    balancesFor,

    async list(householdId: string, opts: { includeClosed?: boolean } = {}) {
      const accounts = await repo.listAccounts(db, householdId, opts);
      const balances = await balancesFor(householdId, accounts);
      return accounts.map((a) => serializeAccount(a, balances.get(a.id) ?? 0));
    },

    async get(householdId: string, id: string) {
      const a = await loadOrThrow(householdId, id);
      const balances = await balancesFor(householdId, [a]);
      return serializeAccount(a, balances.get(a.id) ?? 0);
    },

    async create(householdId: string, input: AccountInput) {
      const accountClass = await validate(householdId, input);
      const created = await repo.createAccount(db, householdId, toData(input, accountClass));
      return this.get(householdId, created.id);
    },

    async update(householdId: string, id: string, input: AccountInput) {
      const existing = await loadOrThrow(householdId, id);
      const accountClass = await validate(householdId, input, existing);
      await repo.updateAccount(db, householdId, id, toData(input, accountClass));
      return this.get(householdId, id);
    },

    async remove(householdId: string, id: string) {
      await loadOrThrow(householdId, id);
      const used = await repo.countAccountTransactions(db, householdId, id);
      const refs = await repo.countAccountReferences(db, householdId, id);
      if (used > 0 || refs.recurring > 0) {
        throw conflict('ACCOUNT_IN_USE', 'This account has transactions or schedules. Close it instead to keep its history.', {
          transactions: used,
          ...refs,
        });
      }
      await repo.deleteAccount(db, householdId, id);
    },

    /** Daily closing balances between two dates, inclusive. */
    async balanceHistory(householdId: string, id: string, range: { from?: string; to?: string }) {
      const account = await loadOrThrow(householdId, id);
      const household = await getHousehold(db, householdId);
      const today = dateInTimeZone(deps.now(), household.timezone);
      const to = range.to ?? today;
      const yearAgo = addDays(to, -365);
      const opened = dateOut(account.openingDate);
      const from = range.from ?? (opened > yearAgo && opened <= to ? opened : yearAgo);
      if (from > to) throw validationError('"from" must be on or before "to"', { field: 'from' });
      if (diffDays(to, from) > 366 * 20) throw validationError('Choose a range of at most 20 years', { field: 'from' });

      const opening = (await balancesFor(householdId, [account], dateIn(addDays(from, -1)))).get(id) ?? 0;
      const rows = await repo.dailyMovements(db, householdId, id, dateIn(from), dateIn(to));
      const byDate = new Map<string, number>();
      for (const r of rows) {
        const d = dateOut(r.date);
        byDate.set(d, (byDate.get(d) ?? 0) + balanceEffect(r.movement, account.class));
      }
      // The opening balance starts counting on the opening date.
      const openedOn = dateOut(account.openingDate);
      if (openedOn >= from && openedOn <= to) byDate.set(openedOn, (byDate.get(openedOn) ?? 0) + cents(account.openingBalanceCents));
      const points: { date: string; balanceCents: number }[] = [{ date: from, balanceCents: opening + (byDate.get(from) ?? 0) }];
      let running = points[0]!.balanceCents;
      for (const d of [...byDate.keys()].filter((d) => d > from).sort()) {
        running += byDate.get(d)!;
        points.push({ date: d, balanceCents: running });
      }
      if (points[points.length - 1]!.date !== to) points.push({ date: to, balanceCents: running });
      return { accountId: id, from, to, openingBalanceCents: opening, points };
    },

    /**
     * Reconciles the account to a statement balance on a date by creating a
     * balance adjustment for the difference (spec §7).
     */
    async reconcile(householdId: string, id: string, input: { statementBalanceCents: number; date: string; userId: string }) {
      const account = await loadOrThrow(householdId, id);
      const before = (await balancesFor(householdId, [account], dateIn(input.date))).get(id) ?? 0;
      const adjustment = reconciliationAdjustment(before, input.statementBalanceCents);
      let transactionId: string | null = null;
      if (adjustment) {
        const tx = await db.transaction.create({
          data: {
            householdId,
            accountId: id,
            type: 'BALANCE_ADJUSTMENT',
            direction: adjustment.direction,
            amountCents: BigInt(adjustment.amountCents),
            date: dateIn(input.date),
            description: 'Reconciled to statement',
            cleared: true,
            createdById: input.userId,
          },
        });
        transactionId = tx.id;
      }
      return {
        balanceBeforeCents: before,
        statementBalanceCents: input.statementBalanceCents,
        adjustment: adjustment ? { ...adjustment, transactionId } : null,
        account: await this.get(householdId, id),
      };
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
