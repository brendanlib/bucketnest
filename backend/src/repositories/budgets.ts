import type { Prisma } from '@prisma/client';
import type { DbTx } from '../db.js';

export const listBudgets = (db: DbTx, householdId: string) =>
  db.budget.findMany({ where: { householdId }, include: { items: true }, orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] });

export const findBudget = (db: DbTx, householdId: string, id: string) =>
  db.budget.findFirst({ where: { householdId, id }, include: { items: true } });

export const findActiveBudget = (db: DbTx, householdId: string) =>
  db.budget.findFirst({ where: { householdId, isActive: true }, include: { items: true }, orderBy: { createdAt: 'asc' } });

export const createBudget = (db: DbTx, householdId: string, data: Omit<Prisma.BudgetUncheckedCreateInput, 'householdId'>) =>
  db.budget.create({ data: { ...data, householdId }, include: { items: true } });

export async function updateBudget(db: DbTx, householdId: string, id: string, data: Omit<Prisma.BudgetUncheckedUpdateManyInput, 'householdId' | 'id'>) {
  await db.budget.updateMany({ where: { householdId, id }, data });
}

export async function deactivateOtherBudgets(db: DbTx, householdId: string, exceptId: string) {
  await db.budget.updateMany({ where: { householdId, id: { not: exceptId } }, data: { isActive: false } });
}

export const deleteBudget = (db: DbTx, householdId: string, id: string) => db.budget.deleteMany({ where: { householdId, id } });

export async function replaceItems(
  db: DbTx,
  householdId: string,
  budgetId: string,
  items: { categoryId: string; amountCents: number; enteredFrequency: Prisma.BudgetItemCreateManyInput['enteredFrequency']; frequencyInterval?: number | null; notes?: string | null }[],
) {
  await db.budgetItem.deleteMany({ where: { householdId, budgetId } });
  if (items.length) {
    await db.budgetItem.createMany({
      data: items.map((i) => ({
        householdId,
        budgetId,
        categoryId: i.categoryId,
        amountCents: BigInt(i.amountCents),
        enteredFrequency: i.enteredFrequency,
        frequencyInterval: i.frequencyInterval ?? null,
        notes: i.notes ?? null,
      })),
    });
  }
}

export async function upsertItem(
  db: DbTx,
  householdId: string,
  budgetId: string,
  categoryId: string,
  data: { amountCents: number; enteredFrequency: Prisma.BudgetItemCreateManyInput['enteredFrequency']; frequencyInterval?: number | null; notes?: string | null },
) {
  return db.budgetItem.upsert({
    where: { budgetId_categoryId: { budgetId, categoryId } },
    create: { householdId, budgetId, categoryId, amountCents: BigInt(data.amountCents), enteredFrequency: data.enteredFrequency, frequencyInterval: data.frequencyInterval ?? null, notes: data.notes ?? null },
    update: { amountCents: BigInt(data.amountCents), enteredFrequency: data.enteredFrequency, frequencyInterval: data.frequencyInterval ?? null, notes: data.notes ?? null },
  });
}

export const deleteItem = (db: DbTx, householdId: string, budgetId: string, categoryId: string) =>
  db.budgetItem.deleteMany({ where: { householdId, budgetId, categoryId } });
