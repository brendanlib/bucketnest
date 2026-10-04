import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { BooleanQuery, Cents, DateOnly, Id, IdParams, NonNegativeCents, OptionalText, Pagination, PositiveCents } from '../lib/schemas.js';

export const TransactionType = z.enum([
  'INCOME',
  'EXPENSE',
  'REFUND',
  'TRANSFER',
  'DEBT_REPAYMENT',
  'SAVINGS_CONTRIBUTION',
  'BALANCE_ADJUSTMENT',
  'INTEREST_CHARGE',
]);

export const TransactionResponse = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string(),
  payee: z.string().nullable(),
  amountCents: z.number().int(),
  type: TransactionType,
  direction: z.enum(['INCREASE', 'DECREASE']).nullable(),
  accountId: z.string(),
  accountName: z.string(),
  toAccountId: z.string().nullable(),
  toAccountName: z.string().nullable(),
  splits: z.array(
    z.object({
      id: z.string(),
      categoryId: z.string(),
      categoryName: z.string(),
      bucketId: z.string().nullable(),
      amountCents: z.number().int(),
      isExtraRepayment: z.boolean(),
      isSinkingFundPayment: z.boolean(),
    }),
  ),
  buckets: z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), colour: z.string() })),
  uncategorised: z.boolean(),
  notes: z.string().nullable(),
  cleared: z.boolean(),
  recurringId: z.string().nullable(),
  occurrenceDate: z.string().nullable(),
  importBatchId: z.string().nullable(),
  goalId: z.string().nullable(),
  gstCents: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TransactionBody = z.strictObject({
  date: DateOnly,
  description: z.string().trim().min(1, 'Enter a description').max(300),
  payee: OptionalText(200),
  amountCents: PositiveCents,
  type: TransactionType,
  accountId: Id,
  toAccountId: Id.nullish(),
  direction: z.enum(['INCREASE', 'DECREASE']).nullish(),
  splits: z
    .array(z.strictObject({ categoryId: Id, amountCents: PositiveCents, isSinkingFundPayment: z.boolean().optional() }))
    .max(50)
    .optional(),
  notes: OptionalText(2000),
  cleared: z.boolean().optional(),
  goalId: Id.nullish(),
  gstCents: NonNegativeCents.nullish(),
});

const typeList = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(TransactionType))
  .optional();

export const transactionRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/transactions',
      {
        schema: {
          tags: ['transactions'],
          querystring: z.strictObject({
            ...Pagination,
            from: DateOnly.optional(),
            to: DateOnly.optional(),
            accountId: Id.optional(),
            bucketId: Id.optional(),
            categoryId: Id.optional(),
            type: typeList.describe('Comma-separated types'),
            minCents: z.coerce.number().pipe(Cents).optional(),
            maxCents: z.coerce.number().pipe(Cents).optional(),
            search: z.string().trim().max(100).optional(),
            uncategorised: BooleanQuery,
            sort: z.enum(['date', 'amount', 'description', 'payee', 'type', 'account', 'createdAt']).default('date'),
            order: z.enum(['asc', 'desc']).default('desc'),
          }),
          response: {
            200: z.object({ items: z.array(TransactionResponse), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() }),
          },
        },
      },
      async (request) => services.transactions.list(authOf(request).householdId, { ...request.query, search: request.query.search || undefined }),
    );

    app.get(
      '/transactions/:id',
      { schema: { tags: ['transactions'], params: IdParams, response: { 200: TransactionResponse } } },
      async (request) => services.transactions.get(authOf(request).householdId, request.params.id),
    );

    app.post(
      '/transactions',
      {
        schema: {
          tags: ['transactions'],
          description:
            'Debt repayments are split automatically per the liability\'s repayment treatment. Transfers into a Debt-repayment liability or a Fire Extinguisher account are stored as debt repayments or savings contributions.',
          body: TransactionBody,
          response: { 201: TransactionResponse },
        },
      },
      async (request, reply) => {
        const a = authOf(request);
        reply.status(201);
        return services.transactions.create(a.householdId, a.userId, request.body);
      },
    );

    app.put(
      '/transactions/:id',
      { schema: { tags: ['transactions'], params: IdParams, body: TransactionBody, response: { 200: TransactionResponse } } },
      async (request) => services.transactions.update(authOf(request).householdId, request.params.id, request.body),
    );

    app.delete(
      '/transactions/:id',
      { schema: { tags: ['transactions'], params: IdParams, response: { 204: z.null() } } },
      async (request, reply) => {
        await services.transactions.remove(authOf(request).householdId, request.params.id);
        return reply.status(204).send(null);
      },
    );

    app.post(
      '/transactions/bulk',
      {
        schema: {
          tags: ['transactions'],
          body: z.strictObject({
            action: z.enum(['delete', 'recategorise']),
            ids: z.array(Id).min(1).max(1000),
            categoryId: Id.optional(),
          }),
          response: { 200: z.object({ deleted: z.number().int(), updated: z.number().int(), skipped: z.number().int() }) },
        },
      },
      async (request) => services.transactions.bulk(authOf(request).householdId, request.body),
    );
  };
