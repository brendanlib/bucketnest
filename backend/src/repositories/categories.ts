import type { Prisma } from '@prisma/client';
import type { DbTx } from '../db.js';

export const listCategories = (db: DbTx, householdId: string, opts: { includeInactive?: boolean } = {}) =>
  db.category.findMany({
    where: { householdId, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

export const findCategory = (db: DbTx, householdId: string, id: string) =>
  db.category.findFirst({ where: { householdId, id } });

export const findCategoriesByIds = (db: DbTx, householdId: string, ids: string[]) =>
  db.category.findMany({ where: { householdId, id: { in: ids } } });

export const findCategoryBySystemKey = (db: DbTx, householdId: string, systemKey: string) =>
  db.category.findFirst({ where: { householdId, systemKey } });

export const createCategory = (db: DbTx, householdId: string, data: Omit<Prisma.CategoryUncheckedCreateInput, 'householdId'>) =>
  db.category.create({ data: { ...data, householdId } });

export async function updateCategory(
  db: DbTx,
  householdId: string,
  id: string,
  data: Omit<Prisma.CategoryUncheckedUpdateManyInput, 'householdId' | 'id'>,
) {
  await db.category.updateMany({ where: { householdId, id }, data });
}

export async function moveGroupChildrenToBucket(db: DbTx, householdId: string, groupId: string, bucketId: string | null) {
  await db.category.updateMany({ where: { householdId, parentId: groupId }, data: { bucketId } });
}

export const countChildren = (db: DbTx, householdId: string, id: string) =>
  db.category.count({ where: { householdId, parentId: id } });

/** Where a category is used. Anything above zero blocks a plain delete. */
export async function categoryUsage(db: DbTx, householdId: string, id: string) {
  const where = { householdId, categoryId: id };
  const [splits, budgetItems, recurring, sinkingFunds, debts, rules] = await Promise.all([
    db.transactionSplit.count({ where }),
    db.budgetItem.count({ where }),
    db.recurringTransaction.count({ where }),
    db.sinkingFund.count({ where }),
    db.debt.count({ where }),
    db.categorisationRule.count({ where: { householdId, setCategoryId: id } }),
  ]);
  return { splits, budgetItems, recurring, sinkingFunds, debts, rules };
}

export async function splitCountsByCategory(db: DbTx, householdId: string) {
  const rows = await db.transactionSplit.groupBy({ by: ['categoryId'], where: { householdId }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.categoryId, r._count._all]));
}

/** Moves every use of `fromId` to `toId`. Budget items merge into an existing item for the target. */
export async function reassignCategory(db: DbTx, householdId: string, fromId: string, toId: string) {
  await db.transactionSplit.updateMany({ where: { householdId, categoryId: fromId }, data: { categoryId: toId } });
  await db.recurringTransaction.updateMany({ where: { householdId, categoryId: fromId }, data: { categoryId: toId } });
  await db.sinkingFund.updateMany({ where: { householdId, categoryId: fromId }, data: { categoryId: toId } });
  await db.debt.updateMany({ where: { householdId, categoryId: fromId }, data: { categoryId: toId } });
  await db.categorisationRule.updateMany({ where: { householdId, setCategoryId: fromId }, data: { setCategoryId: toId } });

  const items = await db.budgetItem.findMany({ where: { householdId, categoryId: fromId } });
  for (const item of items) {
    const existing = await db.budgetItem.findFirst({ where: { householdId, budgetId: item.budgetId, categoryId: toId } });
    if (existing) {
      // Keep the target's plan; the merged category's plan is dropped with it.
      await db.budgetItem.delete({ where: { id: item.id } });
    } else {
      await db.budgetItem.update({ where: { id: item.id }, data: { categoryId: toId } });
    }
  }
}

export const deleteCategory = (db: DbTx, householdId: string, id: string) =>
  db.category.deleteMany({ where: { householdId, id } });

export const maxSortOrder = async (db: DbTx, householdId: string, parentId: string | null) => {
  const r = await db.category.aggregate({ where: { householdId, parentId }, _max: { sortOrder: true } });
  return r._max.sortOrder ?? 0;
};
