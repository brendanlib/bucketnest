import { PrismaClient, Prisma } from '@prisma/client';

export type Db = PrismaClient;
/** A Prisma client or an interactive transaction client. */
export type DbTx = PrismaClient | Prisma.TransactionClient;

export function createDb(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl, log: ['warn', 'error'] });
}
