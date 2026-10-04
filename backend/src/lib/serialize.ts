import type { Prisma } from '@prisma/client';
import { centsFromBigInt } from '../finance/money.js';
import { dateOnlyFromDb, dateOnlyToDb } from '../finance/dates.js';

export const cents = (v: bigint): number => centsFromBigInt(v);
export const centsOrNull = (v: bigint | null | undefined): number | null => (v === null || v === undefined ? null : centsFromBigInt(v));
export const toBigInt = (v: number): bigint => BigInt(v);
export const dateOut = (v: Date): string => dateOnlyFromDb(v);
export const dateOutOrNull = (v: Date | null | undefined): string | null => (v ? dateOnlyFromDb(v) : null);
export const dateIn = (v: string): Date => dateOnlyToDb(v);
export const decimalOut = (v: Prisma.Decimal, dp = 2): string => v.toFixed(dp);
