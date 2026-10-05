import type { Frequency, RecurringType } from '@prisma/client';
import type { Deps } from './context.js';
import * as repo from '../repositories/recurring.js';
import { findAccountsByIds } from '../repositories/accounts.js';
import { findCategoriesByIds } from '../repositories/categories.js';
import { listBuckets } from '../repositories/buckets.js';
import { getHousehold } from '../repositories/households.js';
import { AppError, conflict, notFound, validationError } from '../lib/errors.js';
import { cents, centsOrNull, dateIn, dateOut, dateOutOrNull } from '../lib/serialize.js';
import {
  countOccurrencesBefore,
  generateOccurrences,
  isOccurrenceDate,
  nextOccurrence,
  RecurrenceError,
  validateSchedule,
  type ScheduleException,
  type ScheduleSpec,
} from '../finance/recurrence.js';
import { addDays, dateInTimeZone, diffDays, hourInTimeZone, maxDate, type DateOnly } from '../finance/dates.js';
import { normalise } from '../finance/frequency.js';
import type { TransactionInput, TransactionService } from './transaction.service.js';

export interface RecurringInput {
  name: string;
  type: RecurringType;
  amountCents: number;
  amountKind: 'FIXED' | 'ESTIMATE';
  frequency: Frequency;
  interval?: number | null;
  startDate: string;
  endDate?: string | null;
  occurrenceCount?: number | null;
  weekendRule: 'NONE' | 'PREVIOUS_BUSINESS_DAY' | 'NEXT_BUSINESS_DAY';
  autoPost: boolean;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  payee?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export type OccurrenceStatus = 'posted' | 'skipped' | 'overdue' | 'due' | 'upcoming';

const MAX_RANGE_DAYS = 800;

export function specOf(r: repo.RecurringWithRelations | (Omit<RecurringInput, 'startDate'> & { startDate: string })): ScheduleSpec {
  if ('householdId' in r) {
    return {
      frequency: r.frequency,
      interval: r.interval,
      startDate: dateOut(r.startDate),
      endDate: dateOutOrNull(r.endDate),
      occurrenceCount: r.occurrenceCount,
      weekendRule: r.weekendRule,
      amountCents: cents(r.amountCents),
    };
  }
  return {
    frequency: r.frequency,
    interval: r.interval ?? null,
    startDate: r.startDate,
    endDate: r.endDate ?? null,
    occurrenceCount: r.occurrenceCount ?? null,
    weekendRule: r.weekendRule,
    amountCents: r.amountCents,
  };
}

export const exceptionsOf = (r: repo.RecurringWithRelations): ScheduleException[] =>
  r.exceptions.map((e) => ({
    occurrenceDate: dateOut(e.occurrenceDate),
    action: e.action,
    overrideAmountCents: centsOrNull(e.overrideAmountCents),
    overrideDate: dateOutOrNull(e.overrideDate),
  }));

export function createRecurringService(deps: Deps, transactions: TransactionService) {
  const { db } = deps;

  async function today(householdId: string) {
    const h = await getHousehold(db, householdId);
    return dateInTimeZone(deps.now(), h.timezone);
  }

  async function loadOrThrow(householdId: string, id: string) {
    const r = await repo.findRecurring(db, householdId, id);
    if (!r) throw notFound('Recurring schedule');
    return r;
  }

  async function validate(householdId: string, input: RecurringInput) {
    try {
      validateSchedule(specOf(input));
    } catch (err) {
      if (err instanceof RecurrenceError) throw validationError(err.message, { field: 'frequency' });
      throw err;
    }
    if (input.endDate && input.occurrenceCount) {
      throw validationError('Choose an end date or a number of occurrences, not both', { field: 'endDate' });
    }
    const ids = [input.accountId, ...(input.toAccountId ? [input.toAccountId] : [])];
    const accounts = new Map((await findAccountsByIds(db, householdId, ids)).map((a) => [a.id, a]));
    const account = accounts.get(input.accountId);
    if (!account) throw validationError('Unknown account', { field: 'accountId' });
    const toAccount = input.toAccountId ? accounts.get(input.toAccountId) : undefined;
    if (input.toAccountId && !toAccount) throw validationError('Unknown account', { field: 'toAccountId' });
    if (toAccount && toAccount.id === account.id) throw validationError('Choose two different accounts', { field: 'toAccountId' });

    const needsTo = input.type === 'TRANSFER' || input.type === 'DEBT_REPAYMENT' || input.type === 'SAVINGS_CONTRIBUTION';
    if (needsTo && !toAccount) throw validationError('Choose the account the money goes to', { field: 'toAccountId' });
    if (!needsTo && toAccount) throw validationError('This type of schedule uses one account', { field: 'toAccountId' });
    if (input.type === 'DEBT_REPAYMENT' && (account.class !== 'ASSET' || toAccount!.class !== 'LIABILITY')) {
      throw validationError('A debt repayment goes from an asset account to a liability', { field: 'toAccountId' });
    }

    const buckets = await listBuckets(db, householdId);
    const fire = buckets.find((b) => b.key === 'FIRE_EXTINGUISHER')!;
    if (input.type === 'SAVINGS_CONTRIBUTION' && (account.class !== 'ASSET' || toAccount!.class !== 'ASSET' || toAccount!.bucketTagId !== fire.id)) {
      throw validationError('A savings contribution goes into an account tagged Fire Extinguisher', { field: 'toAccountId' });
    }

    const needsCategory = input.type === 'INCOME' || input.type === 'EXPENSE';
    if (needsCategory && !input.categoryId) throw validationError('Choose a category', { field: 'categoryId' });
    if ((input.type === 'TRANSFER' || input.type === 'DEBT_REPAYMENT') && input.categoryId) {
      throw validationError('Transfers and debt repayments do not take a category', { field: 'categoryId' });
    }
    if (input.categoryId) {
      const [c] = await findCategoriesByIds(db, householdId, [input.categoryId]);
      if (!c || c.isGroup) throw validationError('Unknown category', { field: 'categoryId' });
      if (!c.isActive) throw validationError(`${c.name} is disabled`, { field: 'categoryId' });
      if (input.type === 'INCOME' && c.kind !== 'INCOME') throw validationError(`${c.name} is not an income category`, { field: 'categoryId' });
      if (input.type !== 'INCOME' && c.kind !== 'EXPENSE') throw validationError(`${c.name} is an income category`, { field: 'categoryId' });
      if (input.type === 'SAVINGS_CONTRIBUTION' && c.bucketId !== fire.id) throw validationError('Choose a Fire Extinguisher category', { field: 'categoryId' });
    }
  }

  const toData = (input: RecurringInput) => ({
    name: input.name,
    type: input.type,
    amountCents: BigInt(input.amountCents),
    amountKind: input.amountKind,
    frequency: input.frequency,
    interval: input.frequency.startsWith('EVERY_N_') ? (input.interval ?? null) : null,
    startDate: dateIn(input.startDate),
    endDate: input.endDate ? dateIn(input.endDate) : null,
    occurrenceCount: input.occurrenceCount ?? null,
    weekendRule: input.weekendRule,
    autoPost: input.autoPost,
    accountId: input.accountId,
    toAccountId: input.toAccountId ?? null,
    categoryId: input.categoryId ?? null,
    payee: input.payee ?? null,
    notes: input.notes ?? null,
    isActive: input.isActive ?? true,
  });

  async function serialize(householdId: string, r: repo.RecurringWithRelations, todayDate: DateOnly, posted?: Map<string, string>) {
    const postedMap = posted ?? (await repo.postedOccurrences(db, householdId, [r.id]));
    const spec = specOf(r);
    const next = r.isActive ? nextOccurrence(spec, addDays(todayDate, -60), exceptionsOf(r), (d) => postedMap.has(`${r.id}|${d}`)) : null;
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      amountCents: cents(r.amountCents),
      amountKind: r.amountKind,
      frequency: r.frequency,
      interval: r.interval,
      startDate: dateOut(r.startDate),
      endDate: dateOutOrNull(r.endDate),
      occurrenceCount: r.occurrenceCount,
      weekendRule: r.weekendRule,
      autoPost: r.autoPost,
      accountId: r.accountId,
      accountName: r.account.name,
      toAccountId: r.toAccountId,
      toAccountName: r.toAccount?.name ?? null,
      categoryId: r.categoryId,
      categoryName: r.category?.name ?? null,
      bucketKey: r.type === 'DEBT_REPAYMENT' ? 'BILLS' : (r.category?.bucket?.key ?? null),
      payee: r.payee,
      notes: r.notes,
      isActive: r.isActive,
      normalised: normalise(cents(r.amountCents), { frequency: r.frequency, interval: r.interval }),
      nextOccurrence: next ? { occurrenceDate: next.occurrenceDate, date: next.date, amountCents: next.amountCents, overdue: next.date < todayDate } : null,
    };
  }

  /** Default transaction for an occurrence: what "mark paid" pre-fills. */
  function occurrenceTransaction(r: repo.RecurringWithRelations, occurrenceDate: DateOnly): TransactionInput {
    const occ = generateOccurrences(specOf(r), addDays(occurrenceDate, -400), addDays(occurrenceDate, 400), exceptionsOf(r)).find(
      (o) => o.occurrenceDate === occurrenceDate,
    );
    const amountCents = occ?.amountCents ?? cents(r.amountCents);
    const splits =
      (r.type === 'INCOME' || r.type === 'EXPENSE' || r.type === 'SAVINGS_CONTRIBUTION') && r.categoryId
        ? [{ categoryId: r.categoryId, amountCents }]
        : undefined;
    return {
      date: occ?.date ?? occurrenceDate,
      description: r.name,
      payee: r.payee,
      amountCents,
      type: r.type,
      accountId: r.accountId,
      toAccountId: r.toAccountId,
      splits,
      notes: r.notes,
    };
  }

  async function post(householdId: string, userId: string | null, r: repo.RecurringWithRelations, occurrenceDate: DateOnly, override?: TransactionInput) {
    if (!isOccurrenceDate(specOf(r), occurrenceDate)) throw validationError('That date is not an occurrence of this schedule', { field: 'occurrenceDate' });
    if (exceptionsOf(r).some((e) => e.occurrenceDate === occurrenceDate && e.action === 'SKIP')) {
      throw conflict('OCCURRENCE_SKIPPED', 'This occurrence was skipped. Un-skip it first.');
    }
    const input = override ?? occurrenceTransaction(r, occurrenceDate);
    return transactions.create(householdId, userId, input, { recurringId: r.id, occurrenceDate });
  }

  return {
    specOf,

    async list(householdId: string, opts: { includeInactive?: boolean } = {}) {
      const rows = await repo.listRecurring(db, householdId, opts);
      const todayDate = await today(householdId);
      const posted = await repo.postedOccurrences(db, householdId, rows.map((r) => r.id), dateIn(addDays(todayDate, -400)));
      return Promise.all(rows.map((r) => serialize(householdId, r, todayDate, posted)));
    },

    async get(householdId: string, id: string) {
      return serialize(householdId, await loadOrThrow(householdId, id), await today(householdId));
    },

    async create(householdId: string, input: RecurringInput) {
      await validate(householdId, input);
      // createdAt comes from the app clock: auto-post never posts occurrences from before it.
      const created = await repo.createRecurring(db, householdId, { ...toData(input), createdAt: deps.now() });
      return this.get(householdId, created.id);
    },

    /**
     * Updates a schedule. With `fromDate`, only occurrences from that date on
     * change: the existing schedule ends the day before and a new one carries on.
     */
    async update(householdId: string, id: string, input: RecurringInput, opts: { fromDate?: string } = {}) {
      const existing = await loadOrThrow(householdId, id);
      await validate(householdId, input);
      const from = opts.fromDate;
      if (!from || from <= dateOut(existing.startDate)) {
        await repo.updateRecurring(db, householdId, id, toData(input));
        return this.get(householdId, id);
      }
      const spec = specOf(existing);
      const before = countOccurrencesBefore(spec, from);
      const newStart = maxDate(input.startDate, from);
      const remainingCount = existing.occurrenceCount ? Math.max(1, existing.occurrenceCount - before) : null;
      const created = await db.$transaction(async (tx) => {
        await repo.updateRecurring(tx, householdId, id, {
          endDate: dateIn(addDays(from, -1)),
          occurrenceCount: existing.occurrenceCount ? Math.max(1, before) : null,
          autoPost: existing.autoPost,
        });
        const next = await repo.createRecurring(tx, householdId, {
          createdAt: deps.now(),
          ...toData({ ...input, startDate: newStart }),
          occurrenceCount: input.occurrenceCount ?? remainingCount,
        });
        // Already-posted occurrences from the split date move to the new schedule.
        await tx.transaction.updateMany({
          where: { householdId, recurringId: id, occurrenceDate: { gte: dateIn(from) } },
          data: { recurringId: next.id },
        });
        return next;
      });
      return this.get(householdId, created.id);
    },

    async remove(householdId: string, id: string) {
      await loadOrThrow(householdId, id);
      // Posted transactions stay; they just lose the link.
      await repo.deleteRecurring(db, householdId, id);
    },

    /** Projected occurrences of every active schedule in a range, with their status. */
    async occurrences(householdId: string, range: { from: string; to: string }) {
      if (range.from > range.to) throw validationError('"from" must be on or before "to"', { field: 'from' });
      if (diffDays(range.to, range.from) > MAX_RANGE_DAYS) throw validationError(`Choose a range of at most ${MAX_RANGE_DAYS} days`, { field: 'to' });
      const rows = await repo.listRecurring(db, householdId);
      const todayDate = await today(householdId);
      const posted = await repo.postedOccurrences(db, householdId, rows.map((r) => r.id));
      const out = [];
      for (const r of rows) {
        for (const o of generateOccurrences(specOf(r), range.from, range.to, exceptionsOf(r))) {
          const transactionId = posted.get(`${r.id}|${o.occurrenceDate}`) ?? null;
          const status: OccurrenceStatus = transactionId
            ? 'posted'
            : o.skipped
              ? 'skipped'
              : o.date < todayDate
                ? 'overdue'
                : o.date === todayDate
                  ? 'due'
                  : 'upcoming';
          out.push({
            recurringId: r.id,
            name: r.name,
            type: r.type,
            amountKind: r.amountKind,
            accountName: r.account.name,
            toAccountName: r.toAccount?.name ?? null,
            categoryName: r.category?.name ?? null,
            bucketKey: r.type === 'DEBT_REPAYMENT' ? 'BILLS' : (r.category?.bucket?.key ?? null),
            autoPost: r.autoPost,
            ...o,
            status,
            transactionId,
          });
        }
      }
      return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
    },

    async draft(householdId: string, id: string, occurrenceDate: string) {
      const r = await loadOrThrow(householdId, id);
      if (!isOccurrenceDate(specOf(r), occurrenceDate)) throw validationError('That date is not an occurrence of this schedule', { field: 'occurrenceDate' });
      return occurrenceTransaction(r, occurrenceDate);
    },

    async postOccurrence(householdId: string, userId: string, id: string, occurrenceDate: string, override?: TransactionInput) {
      return post(householdId, userId, await loadOrThrow(householdId, id), occurrenceDate, override);
    },

    async skipOccurrence(householdId: string, id: string, occurrenceDate: string) {
      const r = await loadOrThrow(householdId, id);
      if (!isOccurrenceDate(specOf(r), occurrenceDate)) throw validationError('That date is not an occurrence of this schedule', { field: 'occurrenceDate' });
      const posted = await repo.postedOccurrences(db, householdId, [id]);
      if (posted.has(`${id}|${occurrenceDate}`)) throw conflict('ALREADY_POSTED', 'This occurrence is already recorded. Delete the transaction instead.');
      await repo.upsertException(db, householdId, id, dateIn(occurrenceDate), { action: 'SKIP' });
    },

    async unskipOccurrence(householdId: string, id: string, occurrenceDate: string) {
      const r = await loadOrThrow(householdId, id);
      const e = r.exceptions.find((x) => dateOut(x.occurrenceDate) === occurrenceDate);
      if (e?.action === 'SKIP') await repo.deleteException(db, householdId, id, dateIn(occurrenceDate));
    },

    /** Changes the amount and/or date of one occurrence only. Null for both clears the edit. */
    async editOccurrence(householdId: string, id: string, occurrenceDate: string, edit: { amountCents?: number | null; date?: string | null }) {
      const r = await loadOrThrow(householdId, id);
      if (!isOccurrenceDate(specOf(r), occurrenceDate)) throw validationError('That date is not an occurrence of this schedule', { field: 'occurrenceDate' });
      const posted = await repo.postedOccurrences(db, householdId, [id]);
      if (posted.has(`${id}|${occurrenceDate}`)) throw conflict('ALREADY_POSTED', 'This occurrence is already recorded. Edit the transaction instead.');
      if (edit.amountCents === null && edit.date === null) {
        await repo.deleteException(db, householdId, id, dateIn(occurrenceDate));
        return;
      }
      await repo.upsertException(db, householdId, id, dateIn(occurrenceDate), {
        action: 'EDIT',
        overrideAmountCents: edit.amountCents === undefined || edit.amountCents === null ? null : BigInt(edit.amountCents),
        overrideDate: edit.date ? dateIn(edit.date) : null,
      });
    },

    /**
     * Posts occurrences of auto-post schedules whose date has arrived (spec §8):
     * from 02:00 household time each day, from the day the schedule was created.
     * The unique (schedule, occurrence date) key makes reruns harmless.
     */
    async autoPostDue() {
      const schedules = await repo.listAutoPostSchedules(db);
      let posted = 0;
      for (const r of schedules) {
        const now = deps.now();
        const localToday = dateInTimeZone(now, r.household.timezone);
        const through = hourInTimeZone(now, r.household.timezone) >= 2 ? localToday : addDays(localToday, -1);
        const from = maxDate(dateOut(r.startDate), dateInTimeZone(r.createdAt, r.household.timezone));
        if (from > through) continue;
        const done = await repo.postedOccurrences(db, r.householdId, [r.id], dateIn(addDays(from, -400)));
        for (const o of generateOccurrences(specOf(r), from, through, exceptionsOf(r))) {
          if (o.skipped || done.has(`${r.id}|${o.occurrenceDate}`)) continue;
          try {
            await post(r.householdId, null, r, o.occurrenceDate);
            posted++;
          } catch (err) {
            if (err instanceof AppError && err.code === 'ALREADY_POSTED') continue;
            deps.log.error({ recurringId: r.id, occurrenceDate: o.occurrenceDate, err: (err as Error).message }, 'auto-post failed');
          }
        }
      }
      return { posted };
    },
  };
}

export type RecurringService = ReturnType<typeof createRecurringService>;
