import { randomBytes } from 'node:crypto';
import type { Deps } from './context.js';
import { listBuckets, updateBucket } from '../repositories/buckets.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { decimalOut } from '../lib/serialize.js';
import { AllocationError, validateBucketPercentages } from '../finance/allocation.js';
import { Dec } from '../finance/money.js';
import { BILLS_KEY, EXTRA_BUCKET_COLOURS, MAX_BUCKETS, MIN_BUCKETS, SAVING_KEY } from '../seed/defaults.js';

export interface BucketUpdate {
  id: string;
  name?: string;
  colour?: string;
  percentage: string | number;
}

/** What a bucket does in the budgeting rules. */
export type BucketRole = 'BILLS' | 'SAVING' | 'SPENDING';
export const roleOf = (key: string): BucketRole => (key === BILLS_KEY ? 'BILLS' : key === SAVING_KEY ? 'SAVING' : 'SPENDING');

const serialize = (b: Awaited<ReturnType<typeof listBuckets>>[number]) => ({
  id: b.id,
  key: b.key,
  role: roleOf(b.key),
  name: b.name,
  percentage: decimalOut(b.percentage),
  sortOrder: b.sortOrder,
  colour: b.colour,
  deletable: roleOf(b.key) === 'SPENDING',
});

export function createBucketService(deps: Deps) {
  const { db, log } = deps;

  async function loadOrThrow(householdId: string, id: string) {
    const b = await db.bucket.findFirst({ where: { householdId, id } });
    if (!b) throw notFound('Bucket');
    return b;
  }

  return {
    async list(householdId: string) {
      return (await listBuckets(db, householdId)).map(serialize);
    },

    /**
     * Names, colours and percentages of every bucket together (percentages must
     * total exactly 100.00%). The order of the list is the new display order.
     */
    async update(householdId: string, updates: BucketUpdate[]) {
      const existing = await listBuckets(db, householdId);
      const ids = new Set(existing.map((b) => b.id));
      const given = new Set(updates.map((u) => u.id));
      if (given.size !== updates.length || given.size !== ids.size || [...given].some((id) => !ids.has(id))) {
        throw validationError('Send every bucket exactly once', { field: 'buckets' });
      }
      const names = updates.map((u) => (u.name ?? existing.find((b) => b.id === u.id)!.name).trim().toLowerCase());
      if (new Set(names).size !== names.length) throw validationError('Each bucket needs a different name', { field: 'name' });
      try {
        validateBucketPercentages(updates.map((u) => u.percentage));
      } catch (err) {
        if (err instanceof AllocationError) throw validationError(err.message, { field: 'percentage' });
        throw err;
      }
      await db.$transaction(async (tx) => {
        for (const [i, u] of updates.entries()) {
          await updateBucket(tx, householdId, u.id, {
            percentage: new Dec(u.percentage).toFixed(2),
            sortOrder: i + 1,
            ...(u.name !== undefined ? { name: u.name.trim() } : {}),
            ...(u.colour !== undefined ? { colour: u.colour.toUpperCase() } : {}),
          });
        }
      });
      return this.list(householdId);
    },

    /** A new spending bucket at 0%, straight after Bills, in the next unused colour (see EXTRA_BUCKET_COLOURS). */
    async create(householdId: string, input: { name: string }) {
      const existing = await listBuckets(db, householdId);
      if (existing.length >= MAX_BUCKETS) throw validationError(`A household can have at most ${MAX_BUCKETS} buckets`);
      const name = input.name.trim();
      if (existing.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw conflict('NAME_TAKEN', 'There is already a bucket with that name');
      const at = existing.findIndex((b) => b.key === BILLS_KEY) + 1;
      const used = new Set(existing.map((b) => b.colour.toUpperCase()));
      const colour = EXTRA_BUCKET_COLOURS.find((c) => !used.has(c)) ?? EXTRA_BUCKET_COLOURS[0]!;
      const created = await db.$transaction(async (tx) => {
        // Make room, then insert; sort orders stay 1..n.
        for (const [i, b] of existing.entries()) {
          const order = i < at ? i + 1 : i + 2;
          if (b.sortOrder !== order) await tx.bucket.update({ where: { id: b.id }, data: { sortOrder: order } });
        }
        const row = await tx.bucket.create({
          data: { householdId, key: `CUSTOM_${randomBytes(5).toString('hex').toUpperCase()}`, name, percentage: '0.00', sortOrder: at + 1, colour },
        });
        return row;
      });
      log.info({ householdId, bucketId: created.id }, 'bucket added');
      return (await this.list(householdId)).find((b) => b.id === created.id)!;
    },

    /**
     * Removes a spending bucket. Its categories, account tags and percentage
     * move to another bucket, so history and the 100% total stay intact.
     */
    async remove(householdId: string, id: string, moveTo: string) {
      const bucket = await loadOrThrow(householdId, id);
      if (roleOf(bucket.key) !== 'SPENDING') {
        throw validationError(`${bucket.name} carries the budgeting rules (${roleOf(bucket.key) === 'BILLS' ? 'bills and minimum repayments' : 'saving and extra repayments'}), so it can be renamed but not removed`);
      }
      if (moveTo === id) throw validationError('Choose a different bucket to move things into', { field: 'moveTo' });
      const target = await loadOrThrow(householdId, moveTo);
      const count = await db.bucket.count({ where: { householdId } });
      if (count <= MIN_BUCKETS) throw validationError(`A household needs at least ${MIN_BUCKETS} buckets`);
      const moved = await db.$transaction(async (tx) => {
        const categories = await tx.category.updateMany({ where: { householdId, bucketId: id }, data: { bucketId: target.id } });
        await tx.account.updateMany({ where: { householdId, bucketTagId: id }, data: { bucketTagId: target.id } });
        await tx.bucket.update({ where: { id: target.id }, data: { percentage: new Dec(target.percentage.toString()).plus(bucket.percentage.toString()).toFixed(2) } });
        await tx.bucket.delete({ where: { id } });
        const rest = await listBuckets(tx, householdId);
        for (const [i, b] of rest.entries()) if (b.sortOrder !== i + 1) await tx.bucket.update({ where: { id: b.id }, data: { sortOrder: i + 1 } });
        return categories.count;
      });
      log.info({ householdId, bucketId: id, into: target.id, categories: moved }, 'bucket removed');
      return { movedCategories: moved, items: await this.list(householdId) };
    },
  };
}
