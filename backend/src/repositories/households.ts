import type { Prisma } from '@prisma/client';
import type { DbTx } from '../db.js';
import { DEFAULT_BUCKETS, DEFAULT_CATEGORIES, DEFAULT_NOTIFICATION_SETTINGS } from '../seed/defaults.js';

/** Creates a household owned by the user and seeds its buckets, categories and notification settings. */
export async function createHouseholdWithDefaults(
  db: DbTx,
  input: { name: string; ownerUserId: string; timezone: string; budgetAnchorDate: Date },
) {
  const household = await db.household.create({
    data: {
      name: input.name,
      timezone: input.timezone,
      budgetAnchorDate: input.budgetAnchorDate,
      members: { create: { userId: input.ownerUserId, role: 'OWNER' } },
    },
  });
  const householdId = household.id;

  const bucketIds = new Map<string, string>();
  for (const b of DEFAULT_BUCKETS) {
    const row = await db.bucket.create({ data: { householdId, ...b } });
    bucketIds.set(b.key, row.id);
  }

  let groupOrder = 0;
  for (const g of DEFAULT_CATEGORIES) {
    const bucketId = g.bucket ? bucketIds.get(g.bucket)! : null;
    const kind = g.bucket ? 'EXPENSE' : 'INCOME';
    const group = await db.category.create({
      data: { householdId, bucketId, kind, name: g.group, isGroup: true, sortOrder: (groupOrder += 10) },
    });
    const rows: Prisma.CategoryCreateManyInput[] = g.categories.map((c, i) => ({
      householdId,
      bucketId,
      kind,
      parentId: group.id,
      name: typeof c === 'string' ? c : c.name,
      systemKey: typeof c === 'string' ? null : c.systemKey,
      sortOrder: (i + 1) * 10,
    }));
    await db.category.createMany({ data: rows });
  }

  await db.notificationSetting.createMany({
    data: DEFAULT_NOTIFICATION_SETTINGS.map((s) => ({ householdId, ...s })),
  });

  return household;
}

export const getHousehold = (db: DbTx, householdId: string) => db.household.findUniqueOrThrow({ where: { id: householdId } });

export const updateHousehold = (db: DbTx, householdId: string, data: Prisma.HouseholdUpdateInput) =>
  db.household.update({ where: { id: householdId }, data });
