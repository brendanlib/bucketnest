import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { BooleanQuery, Cents, DateOnly, Id, IdParams, Name, OptionalText } from '../lib/schemas.js';

const AccountType = z.enum([
  'TRANSACTION',
  'SAVINGS',
  'OFFSET',
  'CASH',
  'INVESTMENT',
  'SUPERANNUATION',
  'OTHER_ASSET',
  'CREDIT_CARD',
  'MORTGAGE',
  'PERSONAL_LOAN',
  'CAR_LOAN',
  'HECS_HELP',
  'OTHER_LIABILITY',
]);

export const AccountResponse = z.object({
  id: z.string(),
  name: z.string(),
  type: AccountType,
  class: z.enum(['ASSET', 'LIABILITY']),
  institution: z.string().nullable(),
  openingBalanceCents: z.number().int(),
  openingDate: z.string(),
  balanceCents: z.number().int().describe('Derived: opening balance + transactions. For liabilities, the amount owed.'),
  last4: z.string().nullable(),
  bucketTagId: z.string().nullable(),
  includeInBudget: z.boolean(),
  includeInNetWorth: z.boolean(),
  repaymentTreatment: z.enum(['TRANSFER', 'DEBT_REPAYMENT']).nullable(),
  offsetForAccountId: z.string().nullable(),
  hasDebtProfile: z.boolean(),
  notes: z.string().nullable(),
  isClosed: z.boolean(),
  sortOrder: z.number().int(),
});

const AccountBody = z.strictObject({
  name: Name,
  type: AccountType,
  institution: OptionalText(120),
  openingBalanceCents: Cents,
  openingDate: DateOnly,
  last4: z.string().regex(/^\d{4}$/, 'Enter only the last 4 digits').nullish(),
  bucketTagId: Id.nullish(),
  includeInBudget: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
  repaymentTreatment: z.enum(['TRANSFER', 'DEBT_REPAYMENT']).nullish(),
  offsetForAccountId: Id.nullish(),
  notes: OptionalText(2000),
  isClosed: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export const accountRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/accounts',
      {
        schema: {
          tags: ['accounts'],
          querystring: z.strictObject({ includeClosed: BooleanQuery }),
          response: { 200: z.object({ items: z.array(AccountResponse) }) },
        },
      },
      async (request) => ({ items: await services.accounts.list(authOf(request).householdId, request.query) }),
    );

    app.get('/accounts/:id', { schema: { tags: ['accounts'], params: IdParams, response: { 200: AccountResponse } } }, async (request) =>
      services.accounts.get(authOf(request).householdId, request.params.id),
    );

    app.post('/accounts', { schema: { tags: ['accounts'], body: AccountBody, response: { 201: AccountResponse } } }, async (request, reply) => {
      reply.status(201);
      return services.accounts.create(authOf(request).householdId, request.body);
    });

    app.put(
      '/accounts/:id',
      { schema: { tags: ['accounts'], params: IdParams, body: AccountBody, response: { 200: AccountResponse } } },
      async (request) => services.accounts.update(authOf(request).householdId, request.params.id, request.body),
    );

    app.delete('/accounts/:id', { schema: { tags: ['accounts'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.accounts.remove(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });

    app.get(
      '/accounts/:id/balance-history',
      {
        schema: {
          tags: ['accounts'],
          params: IdParams,
          querystring: z.strictObject({ from: DateOnly.optional(), to: DateOnly.optional() }),
          response: {
            200: z.object({
              accountId: z.string(),
              from: z.string(),
              to: z.string(),
              openingBalanceCents: z.number().int(),
              points: z.array(z.object({ date: z.string(), balanceCents: z.number().int() })),
            }),
          },
        },
      },
      async (request) => services.accounts.balanceHistory(authOf(request).householdId, request.params.id, request.query),
    );

    app.post(
      '/accounts/:id/reconcile',
      {
        schema: {
          tags: ['accounts'],
          description: 'Creates a balance adjustment so the balance on `date` matches the statement.',
          params: IdParams,
          body: z.strictObject({ statementBalanceCents: Cents, date: DateOnly }),
          response: {
            200: z.object({
              balanceBeforeCents: z.number().int(),
              statementBalanceCents: z.number().int(),
              adjustment: z
                .object({ direction: z.enum(['INCREASE', 'DECREASE']), amountCents: z.number().int(), transactionId: z.string().nullable() })
                .nullable(),
              account: AccountResponse,
            }),
          },
        },
      },
      async (request) => {
        const a = authOf(request);
        return services.accounts.reconcile(a.householdId, request.params.id, { ...request.body, userId: a.userId });
      },
    );
  };
