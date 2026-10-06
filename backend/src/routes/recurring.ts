import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { BooleanQuery, DateOnly, Frequency, Id, IdParams, Name, OptionalText, PositiveCents } from '../lib/schemas.js';
import { TransactionBody, TransactionResponse } from './transactions.js';
import type { TransactionInput } from '../services/transaction.service.js';

const RecurringType = z.enum(['INCOME', 'EXPENSE', 'TRANSFER', 'DEBT_REPAYMENT', 'SAVINGS_CONTRIBUTION']);

const RecurringBody = z.strictObject({
  name: Name,
  type: RecurringType,
  amountCents: PositiveCents,
  amountKind: z.enum(['FIXED', 'ESTIMATE']).default('FIXED'),
  frequency: Frequency,
  interval: z.number().int().min(1).max(366).nullish(),
  startDate: DateOnly,
  endDate: DateOnly.nullish(),
  occurrenceCount: z.number().int().min(1).max(10_000).nullish(),
  weekendRule: z.enum(['NONE', 'PREVIOUS_BUSINESS_DAY', 'NEXT_BUSINESS_DAY']).default('NONE'),
  autoPost: z.boolean().default(false),
  accountId: Id,
  toAccountId: Id.nullish(),
  categoryId: Id.nullish(),
  payee: OptionalText(200),
  notes: OptionalText(2000),
  isActive: z.boolean().optional(),
});

const Normalised = z.object({ weekly: z.number().int(), fortnightly: z.number().int(), monthly: z.number().int(), annual: z.number().int() });

export const RecurringResponse = z.object({
  id: z.string(),
  name: z.string(),
  type: RecurringType,
  amountCents: z.number().int(),
  amountKind: z.enum(['FIXED', 'ESTIMATE']),
  frequency: Frequency,
  interval: z.number().int().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  occurrenceCount: z.number().int().nullable(),
  weekendRule: z.enum(['NONE', 'PREVIOUS_BUSINESS_DAY', 'NEXT_BUSINESS_DAY']),
  autoPost: z.boolean(),
  accountId: z.string(),
  accountName: z.string(),
  toAccountId: z.string().nullable(),
  toAccountName: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  bucketKey: z.string().nullable(),
  payee: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  normalised: Normalised,
  nextOccurrence: z.object({ occurrenceDate: z.string(), date: z.string(), amountCents: z.number().int(), overdue: z.boolean() }).nullable(),
});

export const OccurrenceResponse = z.object({
  recurringId: z.string(),
  name: z.string(),
  type: RecurringType,
  amountKind: z.enum(['FIXED', 'ESTIMATE']),
  accountName: z.string(),
  toAccountName: z.string().nullable(),
  categoryName: z.string().nullable(),
  bucketKey: z.string().nullable(),
  autoPost: z.boolean(),
  occurrenceDate: z.string(),
  date: z.string(),
  amountCents: z.number().int(),
  skipped: z.boolean(),
  edited: z.boolean(),
  status: z.enum(['posted', 'skipped', 'overdue', 'due', 'upcoming']),
  transactionId: z.string().nullable(),
  nextPeriodStart: z.string().describe('Where "move to next period" would put this occurrence'),
});

const OccurrenceParams = z.strictObject({ id: Id, date: DateOnly });

export const recurringRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    const base = '/recurring-transactions';

    app.get(
      base,
      { schema: { tags: ['recurring'], querystring: z.strictObject({ includeInactive: BooleanQuery }), response: { 200: z.object({ items: z.array(RecurringResponse) }) } } },
      async (request) => ({ items: await services.recurring.list(authOf(request).householdId, request.query) }),
    );

    app.get(
      `${base}/occurrences`,
      {
        schema: {
          tags: ['recurring'],
          description: 'Projected occurrences of every active schedule. Nothing is stored until an occurrence is posted.',
          querystring: z.strictObject({ from: DateOnly, to: DateOnly }),
          response: { 200: z.object({ items: z.array(OccurrenceResponse) }) },
        },
      },
      async (request) => ({ items: await services.recurring.occurrences(authOf(request).householdId, request.query) }),
    );

    app.post(base, { schema: { tags: ['recurring'], body: RecurringBody, response: { 201: RecurringResponse } } }, async (request, reply) => {
      reply.status(201);
      return services.recurring.create(authOf(request).householdId, request.body);
    });

    app.get(`${base}/:id`, { schema: { tags: ['recurring'], params: IdParams, response: { 200: RecurringResponse } } }, async (request) =>
      services.recurring.get(authOf(request).householdId, request.params.id),
    );

    app.put(
      `${base}/:id`,
      {
        schema: {
          tags: ['recurring'],
          description: 'With `fromDate`, only occurrences from that date change: the schedule is split into two.',
          params: IdParams,
          querystring: z.strictObject({ fromDate: DateOnly.optional() }),
          body: RecurringBody,
          response: { 200: RecurringResponse },
        },
      },
      async (request) => services.recurring.update(authOf(request).householdId, request.params.id, request.body, { fromDate: request.query.fromDate }),
    );

    app.delete(`${base}/:id`, { schema: { tags: ['recurring'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.recurring.remove(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });

    app.get(
      `${base}/:id/occurrences/:date/draft`,
      { schema: { tags: ['recurring'], description: 'The pre-filled transaction for "mark paid".', params: OccurrenceParams, response: { 200: TransactionBody } } },
      async (request) => services.recurring.draft(authOf(request).householdId, request.params.id, request.params.date) as never,
    );

    app.post(
      `${base}/:id/occurrences/:date/post`,
      {
        schema: {
          tags: ['recurring'],
          description: 'Marks an occurrence paid or received. Send a transaction body to change what is recorded; send nothing to use the schedule.',
          params: OccurrenceParams,
          body: z.union([TransactionBody, z.strictObject({})]).optional(),
          response: { 201: TransactionResponse },
        },
      },
      async (request, reply) => {
        const a = authOf(request);
        const body = request.body && 'date' in request.body ? (request.body as TransactionInput) : undefined;
        reply.status(201);
        return services.recurring.postOccurrence(a.householdId, a.userId, request.params.id, request.params.date, body);
      },
    );

    app.post(`${base}/:id/occurrences/:date/skip`, { schema: { tags: ['recurring'], params: OccurrenceParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.recurring.skipOccurrence(authOf(request).householdId, request.params.id, request.params.date);
      return reply.status(204).send(null);
    });

    app.post(
      `${base}/:id/occurrences/:date/move-to-next-period`,
      {
        schema: {
          tags: ['recurring'],
          description: 'Defers this occurrence to the first day of the next budget period. The schedule is unchanged.',
          params: OccurrenceParams,
          response: { 200: z.object({ date: z.string() }) },
        },
      },
      async (request) => services.recurring.moveToNextPeriod(authOf(request).householdId, request.params.id, request.params.date),
    );
    app.post(`${base}/:id/occurrences/:date/unskip`, { schema: { tags: ['recurring'], params: OccurrenceParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.recurring.unskipOccurrence(authOf(request).householdId, request.params.id, request.params.date);
      return reply.status(204).send(null);
    });

    app.put(
      `${base}/:id/occurrences/:date`,
      {
        schema: {
          tags: ['recurring'],
          description: 'Edits this occurrence only. Send nulls for both to clear the edit.',
          params: OccurrenceParams,
          body: z.strictObject({ amountCents: PositiveCents.nullish(), date: DateOnly.nullish() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await services.recurring.editOccurrence(authOf(request).householdId, request.params.id, request.params.date, request.body);
        return reply.status(204).send(null);
      },
    );
  };
