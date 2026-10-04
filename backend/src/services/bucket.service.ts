import type { Deps } from './context.js';
import { listBuckets, updateBucket } from '../repositories/buckets.js';
import { validationError } from '../lib/errors.js';
import { decimalOut } from '../lib/serialize.js';
import { AllocationError, validateBucketPercentages } from '../finance/allocation.js';
import { Dec } from '../finance/money.js';

export interface BucketUpdate {
  id: string;
  name?: string;
  colour?: string;
  percentage: string | number;
}

const serialize = (b: Awaited<ReturnType<typeof listBuckets>>[number]) => ({
  id: b.id,
  key: b.key,
  name: b.name,
  percentage: decimalOut(b.percentage),
  sortOrder: b.sortOrder,
  colour: b.colour,
});

export function createBucketService(deps: Deps) {
  const { db } = deps;
  return {
    async list(householdId: string) {
      return (await listBuckets(db, householdId)).map(serialize);
    },

    /** Percentages are validated together: all four buckets, totalling exactly 100.00%. */
    async update(householdId: string, updates: BucketUpdate[]) {
      const existing = await listBuckets(db, householdId);
      const ids = new Set(existing.map((b) => b.id));
      const given = new Set(updates.map((u) => u.id));
      if (given.size !== updates.length || given.size !== ids.size || [...given].some((id) => !ids.has(id))) {
        throw validationError('Send every bucket exactly once', { field: 'buckets' });
      }
      try {
        validateBucketPercentages(updates.map((u) => u.percentage));
      } catch (err) {
        if (err instanceof AllocationError) throw validationError(err.message, { field: 'percentage' });
        throw err;
      }
      await db.$transaction(async (tx) => {
        for (const u of updates) {
          await updateBucket(tx, householdId, u.id, {
            percentage: new Dec(u.percentage).toFixed(2),
            ...(u.name !== undefined ? { name: u.name } : {}),
            ...(u.colour !== undefined ? { colour: u.colour } : {}),
          });
        }
      });
      return this.list(householdId);
    },
  };
}
