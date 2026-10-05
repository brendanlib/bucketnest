import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { Id, IdParams, NonNegativeCents } from '../lib/schemas.js';

export const RuleBody = z.strictObject({
  name: z.string().trim().max(120).nullish(),
  matchField: z.enum(['DESCRIPTION', 'PAYEE']).default('DESCRIPTION'),
  matchType: z.enum(['CONTAINS', 'STARTS_WITH', 'EQUALS']).default('CONTAINS'),
  matchValue: z.string().trim().min(1, 'Enter the text to match').max(200),
  minAmountCents: NonNegativeCents.nullish(),
  maxAmountCents: NonNegativeCents.nullish(),
  direction: z.enum(['ANY', 'DEBIT', 'CREDIT']).default('ANY'),
  accountId: Id.nullish(),
  setCategoryId: Id.nullish(),
  setType: z.enum(['EXPENSE', 'INCOME', 'REFUND', 'TRANSFER']).nullish(),
  setToAccountId: Id.nullish(),
  setPayee: z.string().trim().max(200).nullish(),
  addNote: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
});

const RuleResponse = z.object({
  id: z.string(),
  name: z.string().nullable(),
  priority: z.number().int(),
  matchField: z.enum(['DESCRIPTION', 'PAYEE']),
  matchType: z.enum(['CONTAINS', 'STARTS_WITH', 'EQUALS']),
  matchValue: z.string(),
  minAmountCents: z.number().int().nullable(),
  maxAmountCents: z.number().int().nullable(),
  direction: z.enum(['ANY', 'DEBIT', 'CREDIT']),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  setCategoryId: z.string().nullable(),
  setCategoryName: z.string().nullable(),
  setType: z.string().nullable(),
  setToAccountId: z.string().nullable(),
  setToAccountName: z.string().nullable(),
  setPayee: z.string().nullable(),
  addNote: z.string().nullable(),
  isActive: z.boolean(),
});

export const ruleRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    const list = z.object({ items: z.array(RuleResponse) });
    app.get('/rules', { schema: { tags: ['rules'], response: { 200: list } } }, async (request) => ({ items: await services.rules.list(authOf(request).householdId) }));

    app.post('/rules', { schema: { tags: ['rules'], body: RuleBody, response: { 201: RuleResponse } } }, async (request, reply) => {
      reply.status(201);
      return services.rules.create(authOf(request).householdId, request.body);
    });

    app.put('/rules/:id', { schema: { tags: ['rules'], params: IdParams, body: RuleBody, response: { 200: RuleResponse } } }, async (request) =>
      services.rules.update(authOf(request).householdId, request.params.id, request.body),
    );

    app.delete('/rules/:id', { schema: { tags: ['rules'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.rules.remove(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });

    app.post(
      '/rules/reorder',
      { schema: { tags: ['rules'], description: 'Rules run in this order; the first match wins.', body: z.strictObject({ ids: z.array(Id).max(1000) }), response: { 200: list } } },
      async (request) => ({ items: await services.rules.reorder(authOf(request).householdId, request.body.ids) }),
    );

    app.post(
      '/rules/test',
      {
        schema: {
          tags: ['rules'],
          description: 'Previews a draft or saved rule against the most recent 1,000 transactions.',
          body: RuleBody,
          response: {
            200: z.object({
              scanned: z.number().int(),
              matchCount: z.number().int(),
              uncategorisedCount: z.number().int(),
              items: z.array(z.object({ id: z.string(), date: z.string(), description: z.string(), payee: z.string().nullable(), amountCents: z.number().int(), type: z.string(), uncategorised: z.boolean() })),
            }),
          },
        },
      },
      async (request) => services.rules.test(authOf(request).householdId, request.body),
    );

    app.post(
      '/rules/apply',
      {
        schema: {
          tags: ['rules'],
          description: 'Runs one rule on existing uncategorised transactions.',
          body: z.strictObject({ id: Id }),
          response: { 200: z.object({ updated: z.number().int(), skipped: z.number().int() }) },
        },
      },
      async (request) => services.rules.apply(authOf(request).householdId, request.body.id),
    );
  };
