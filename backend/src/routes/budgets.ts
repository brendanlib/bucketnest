import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { BooleanQuery, DateOnly, Frequency, Id, IdParams, Name, NonNegativeCents, OptionalText } from '../lib/schemas.js';

const PeriodType = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUAL']);

const Item = z.object({
  categoryId: z.string(),
  amountCents: z.number().int(),
  enteredFrequency: z.string(),
  frequencyInterval: z.number().int().nullable(),
  notes: z.string().nullable(),
  periodAmountCents: z.number().int(),
});

export const BudgetResponse = z.object({
  id: z.string(),
  name: z.string(),
  periodType: PeriodType,
  anchorDate: z.string(),
  isActive: z.boolean(),
  items: z.array(Item),
});

const Variance = {
  budgetCents: z.number().int(),
  actualCents: z.number().int(),
  remainingCents: z.number().int(),
  percentUsed: z.number().nullable(),
  status: z.enum(['none', 'ok', 'amber', 'red', 'unbudgeted']),
};

export const PeriodResponse = z.object({
  start: z.string(),
  end: z.string(),
  previousStart: z.string(),
  nextStart: z.string(),
  isCurrent: z.boolean(),
  today: z.string(),
});

const Normalised = z.object({ weekly: z.number().int(), fortnightly: z.number().int(), monthly: z.number().int(), annual: z.number().int() });

const SummaryResponse = z.object({
  budget: BudgetResponse,
  period: PeriodResponse,
  income: z.object({
    plannedCents: z.number().int(),
    plannedSource: z.enum(['schedules', 'budget', 'none']),
    actualCents: z.number().int(),
    scheduledActualCents: z.number().int(),
    expected: Normalised,
    allocationBasis: z.enum(['PLANNED', 'ACTUAL']),
    allocationIncomeCents: z.number().int(),
    variance: z.object(Variance),
  }),
  buckets: z.array(
    z.object({
      ...Variance,
      bucketId: z.string(),
      key: z.string(),
      name: z.string(),
      colour: z.string(),
      percentage: z.string(),
      allocatedCents: z.number().int(),
      overAllocatedCents: z.number().int(),
      allocation: z.object(Variance),
      groups: z.array(
        z.object({
          ...Variance,
          groupId: z.string().nullable(),
          name: z.string(),
          lines: z.array(z.object({ ...Variance, categoryId: z.string(), name: z.string(), hasItem: z.boolean(), isActive: z.boolean(), sinkingFundId: z.string().optional() })),
        }),
      ),
    }),
  ),
  total: z.object(Variance),
  incomeLines: z.array(z.object({ categoryId: z.string(), name: z.string(), budgetCents: z.number().int(), actualCents: z.number().int() })),
  thresholds: z.object({ amber: z.number(), red: z.number() }),
});

const BudgetBody = z.strictObject({ name: Name, periodType: PeriodType, anchorDate: DateOnly, isActive: z.boolean().optional() });
const ItemBody = z.strictObject({
  amountCents: NonNegativeCents,
  enteredFrequency: Frequency,
  frequencyInterval: z.number().int().min(1).max(366).nullish(),
  notes: OptionalText(500),
});

export const budgetRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/budgets', { schema: { tags: ['budgets'], response: { 200: z.object({ items: z.array(BudgetResponse) }) } } }, async (request) => ({
      items: await services.budgets.list(authOf(request).householdId),
    }));

    app.post('/budgets', { schema: { tags: ['budgets'], body: BudgetBody, response: { 201: BudgetResponse } } }, async (request, reply) => {
      reply.status(201);
      return services.budgets.create(authOf(request).householdId, request.body);
    });

    app.get('/budgets/:id', { schema: { tags: ['budgets'], params: IdParams, response: { 200: BudgetResponse } } }, async (request) =>
      services.budgets.get(authOf(request).householdId, request.params.id),
    );

    app.put(
      '/budgets/:id',
      { schema: { tags: ['budgets'], params: IdParams, body: BudgetBody.partial(), response: { 200: BudgetResponse } } },
      async (request) => services.budgets.update(authOf(request).householdId, request.params.id, request.body),
    );

    app.delete('/budgets/:id', { schema: { tags: ['budgets'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.budgets.remove(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });

    app.post(
      '/budgets/:id/copy',
      { schema: { tags: ['budgets'], params: IdParams, body: z.strictObject({ name: Name.optional() }), response: { 201: BudgetResponse } } },
      async (request, reply) => {
        reply.status(201);
        return services.budgets.copy(authOf(request).householdId, request.params.id, request.body.name);
      },
    );

    app.put(
      '/budgets/:id/items/:categoryId',
      {
        schema: {
          tags: ['budgets'],
          description: 'Sets the planned amount for a category, in the frequency it was entered (e.g. $900 annually). It is converted to the budget period.',
          params: z.strictObject({ id: Id, categoryId: Id }),
          body: ItemBody,
          response: { 200: BudgetResponse },
        },
      },
      async (request) => services.budgets.setItem(authOf(request).householdId, request.params.id, request.params.categoryId, request.body),
    );

    app.delete(
      '/budgets/:id/items/:categoryId',
      { schema: { tags: ['budgets'], params: z.strictObject({ id: Id, categoryId: Id }), response: { 200: BudgetResponse } } },
      async (request) => services.budgets.deleteItem(authOf(request).householdId, request.params.id, request.params.categoryId),
    );

    app.get(
      '/budgets/:id/summary',
      {
        schema: {
          tags: ['budgets'],
          description: '`period` is any date inside the period wanted (default: today in the household time zone).',
          params: IdParams,
          querystring: z.strictObject({ period: DateOnly.optional(), basis: z.enum(['PLANNED', 'ACTUAL']).optional(), includeEmpty: BooleanQuery }),
          response: { 200: SummaryResponse },
        },
      },
      async (request) =>
        services.budgets.summary(authOf(request).householdId, request.params.id, {
          date: request.query.period,
          basis: request.query.basis,
          includeEmpty: request.query.includeEmpty,
        }),
    );
  };
