import type { DbTx } from '../db.js';

export const listBuckets = (db: DbTx, householdId: string) =>
  db.bucket.findMany({ where: { householdId }, orderBy: { sortOrder: 'asc' } });

export const updateBucket = (
  db: DbTx,
  householdId: string,
  id: string,
  data: { name?: string; colour?: string; percentage?: string },
) => db.bucket.updateMany({ where: { householdId, id }, data });
