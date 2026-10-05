import type { Category } from '@prisma/client';
import type { Deps } from './context.js';
import * as repo from '../repositories/categories.js';
import { listBuckets } from '../repositories/buckets.js';
import { conflict, notFound, validationError } from '../lib/errors.js';

export interface CategoryCreateInput {
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  bucketId?: string | null;
  parentId?: string | null;
  isGroup?: boolean;
  sortOrder?: number;
}

export interface CategoryUpdateInput {
  name?: string;
  bucketId?: string | null;
  parentId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  /** Required when the bucket changes, because historical bucket totals change too. */
  confirmBucketChange?: boolean;
  /** Overrides the household forecast method; null returns to the household default. */
  forecastMethod?: 'AVG3' | 'AVG6' | 'AVG12' | 'MANUAL' | null;
  forecastManualCents?: number | null;
}

export function serializeCategory(c: Category, splitCount?: number) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    bucketId: c.bucketId,
    parentId: c.parentId,
    isGroup: c.isGroup,
    isActive: c.isActive,
    isSystem: c.systemKey !== null,
    systemKey: c.systemKey,
    sortOrder: c.sortOrder,
    forecastMethod: c.forecastMethod,
    forecastManualCents: c.forecastManualCents === null ? null : Number(c.forecastManualCents),
    ...(splitCount !== undefined ? { transactionCount: splitCount } : {}),
  };
}

export function createCategoryService(deps: Deps) {
  const { db } = deps;

  async function loadOrThrow(householdId: string, id: string) {
    const c = await repo.findCategory(db, householdId, id);
    if (!c) throw notFound('Category');
    return c;
  }

  async function requireBucket(householdId: string, bucketId: string) {
    const buckets = await listBuckets(db, householdId);
    if (!buckets.some((b) => b.id === bucketId)) throw validationError('Unknown bucket', { field: 'bucketId' });
  }

  /** Resolves and validates the group a category sits in. */
  async function resolveParent(householdId: string, parentId: string | null | undefined, kind: Category['kind']) {
    if (!parentId) return null;
    const parent = await repo.findCategory(db, householdId, parentId);
    if (!parent) throw validationError('Unknown group', { field: 'parentId' });
    if (!parent.isGroup) throw validationError('The parent must be a group', { field: 'parentId' });
    if (parent.kind !== kind) throw validationError('The group is for a different kind of category', { field: 'parentId' });
    return parent;
  }

  return {
    async list(householdId: string, opts: { includeInactive?: boolean } = {}) {
      const [rows, counts] = await Promise.all([
        repo.listCategories(db, householdId, opts),
        repo.splitCountsByCategory(db, householdId),
      ]);
      return rows.map((c) => serializeCategory(c, counts.get(c.id) ?? 0));
    },

    async create(householdId: string, input: CategoryCreateInput) {
      const isGroup = input.isGroup ?? false;
      if (isGroup && input.parentId) throw validationError('Groups cannot sit inside another group', { field: 'parentId' });
      const parent = await resolveParent(householdId, input.parentId, input.kind);
      let bucketId: string | null;
      if (input.kind === 'INCOME') {
        if (input.bucketId) throw validationError('Income categories do not belong to a bucket', { field: 'bucketId' });
        bucketId = null;
      } else {
        bucketId = input.bucketId ?? parent?.bucketId ?? null;
        if (!bucketId) throw validationError('Choose a bucket', { field: 'bucketId' });
        await requireBucket(householdId, bucketId);
        if (parent && parent.bucketId !== bucketId) {
          throw validationError('The category must be in the same bucket as its group', { field: 'bucketId' });
        }
      }
      const sortOrder = input.sortOrder ?? (await repo.maxSortOrder(db, householdId, parent?.id ?? null)) + 10;
      try {
        const created = await repo.createCategory(db, householdId, {
          name: input.name,
          kind: input.kind,
          bucketId,
          parentId: parent?.id ?? null,
          isGroup,
          sortOrder,
        });
        return serializeCategory(created, 0);
      } catch (err) {
        throw mapUniqueName(err);
      }
    },

    async update(householdId: string, id: string, input: CategoryUpdateInput) {
      const current = await loadOrThrow(householdId, id);
      const data: Parameters<typeof repo.updateCategory>[3] = {};

      if (input.name !== undefined) data.name = input.name;
      if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
      if (input.forecastMethod !== undefined) {
        if (input.forecastMethod === 'MANUAL' && (input.forecastManualCents == null || input.forecastManualCents < 0)) {
          throw validationError('Enter the monthly amount to forecast', { field: 'forecastManualCents' });
        }
        data.forecastMethod = input.forecastMethod;
        data.forecastManualCents = input.forecastMethod === 'MANUAL' ? BigInt(input.forecastManualCents!) : null;
      }
      if (input.isActive !== undefined) {
        if (!input.isActive && current.systemKey) {
          throw conflict('SYSTEM_CATEGORY', 'This category is used by the budgeting rules and cannot be disabled');
        }
        data.isActive = input.isActive;
      }

      let parent: Category | null | undefined;
      if (input.parentId !== undefined) {
        if (current.isGroup && input.parentId) throw validationError('Groups cannot sit inside another group', { field: 'parentId' });
        if (input.parentId === id) throw validationError('A category cannot be its own group', { field: 'parentId' });
        parent = await resolveParent(householdId, input.parentId, current.kind);
        data.parentId = parent?.id ?? null;
      }

      let bucketId = current.bucketId;
      if (input.bucketId !== undefined && input.bucketId !== current.bucketId) {
        if (current.kind === 'INCOME') throw validationError('Income categories do not belong to a bucket', { field: 'bucketId' });
        if (!input.bucketId) throw validationError('Choose a bucket', { field: 'bucketId' });
        await requireBucket(householdId, input.bucketId);
        if (!input.confirmBucketChange) {
          throw conflict(
            'BUCKET_CHANGE_CONFIRMATION_REQUIRED',
            'Moving this category to another bucket changes historical bucket totals. Confirm to continue.',
          );
        }
        bucketId = input.bucketId;
        data.bucketId = bucketId;
      }

      // A category must share its group's bucket. Moving bucket without a new group leaves the old group.
      const effectiveParent = parent !== undefined ? parent : current.parentId ? await repo.findCategory(db, householdId, current.parentId) : null;
      if (effectiveParent && effectiveParent.bucketId !== bucketId) {
        if (parent !== undefined) {
          throw validationError('The category must be in the same bucket as its group', { field: 'parentId' });
        }
        data.parentId = null;
      }

      try {
        await db.$transaction(async (tx) => {
          await repo.updateCategory(tx, householdId, id, data);
          if (current.isGroup && data.bucketId !== undefined) {
            await repo.moveGroupChildrenToBucket(tx, householdId, id, bucketId);
          }
        });
      } catch (err) {
        throw mapUniqueName(err);
      }
      return serializeCategory(await loadOrThrow(householdId, id));
    },

    /**
     * Deletes an unused category. A used one needs `reassignTo` (its history
     * moves there) or should be disabled instead.
     */
    async remove(householdId: string, id: string, reassignTo?: string) {
      const current = await loadOrThrow(householdId, id);
      if (current.systemKey) throw conflict('SYSTEM_CATEGORY', 'This category is used by the budgeting rules and cannot be deleted');
      if (current.isGroup) {
        if ((await repo.countChildren(db, householdId, id)) > 0) {
          throw conflict('GROUP_NOT_EMPTY', 'Move or delete the categories in this group first');
        }
        await repo.deleteCategory(db, householdId, id);
        return;
      }

      const usage = await repo.categoryUsage(db, householdId, id);
      const inUse = Object.values(usage).some((n) => n > 0);
      if (inUse && !reassignTo) {
        throw conflict('CATEGORY_IN_USE', 'This category has history. Reassign it to another category or disable it instead.', usage);
      }
      if (reassignTo) {
        if (reassignTo === id) throw validationError('Choose a different category', { field: 'reassignTo' });
        const target = await repo.findCategory(db, householdId, reassignTo);
        if (!target || target.isGroup) throw validationError('Unknown category to reassign to', { field: 'reassignTo' });
        if (!target.isActive) throw validationError('The category to reassign to is disabled', { field: 'reassignTo' });
        if (target.kind !== current.kind) throw validationError('Reassign to a category of the same kind', { field: 'reassignTo' });
      }
      await db.$transaction(async (tx) => {
        if (reassignTo) await repo.reassignCategory(tx, householdId, id, reassignTo);
        await repo.deleteCategory(tx, householdId, id);
      });
    },
  };
}

function mapUniqueName(err: unknown): unknown {
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
    return conflict('DUPLICATE_NAME', 'A category with this name already exists in this group');
  }
  return err;
}
