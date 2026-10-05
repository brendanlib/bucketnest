import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { BooleanQuery, DateOnly, Frequency, Id, IdParams, Name, NonNegativeCents, OptionalText, PositiveCents } from '../lib/schemas.js';

// ─── Sinking funds ───────────────────────────────────────────────────────────

const FundBody = z.strictObject({
  name: Name,
  targetCents: PositiveCents.nullish(),
  dueDate: DateOnly.nullish(),
  contributionFrequency: Frequency,
  contributionInterval: z.number().int().min(1).max(366).nullish(),
  contributionAnchorDate: DateOnly.nullish(),
  accountId: Id.nullish(),
  categoryId: Id.nullish(),
  recurringId: Id.nullish(),
  repeats: z.boolean().optional(),
  manualCurrentCents: NonNegativeCents.nullish(),
  isActive: z.boolean().optional(),
  notes: OptionalText(2000),
});

const Fund = z.object({
  id: z.string(),
  name: z.string(),
  targetCents: z.number().int(),
  dueDate: z.string(),
  targetSource: z.enum(['schedule', 'fund']),
  ownTargetCents: z.number().int(),
  ownDueDate: z.string(),
  contributionFrequency: Frequency,
  contributionInterval: z.number().int().nullable(),
  contributionAnchorDate: z.string(),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  bucketKey: z.string().nullable(),
  recurringId: z.string().nullable(),
  recurringName: z.string().nullable(),
  repeats: z.boolean(),
  manualCurrentCents: z.number().int().nullable(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  currentCents: z.number().int(),
  currentSource: z.enum(['account', 'contributions']),
  contributionsCents: z.number().int(),
  paymentsCents: z.number().int(),
  remainingCents: z.number().int(),
  progressPercent: z.number().nullable(),
  datesLeft: z.number().int(),
  recommendedContributionCents: z.number().int(),
  status: z.enum(['funded', 'on_track', 'due_soon', 'due_short']),
  shortfallCents: z.number().int(),
});
const FundDetail = Fund.extend({
  contributions: z.array(z.object({ id: z.string(), date: z.string(), amountCents: z.number().int(), transactionId: z.string().nullable(), notes: z.string().nullable() })),
});

// ─── Goals ───────────────────────────────────────────────────────────────────

const GoalType = z.enum(['EMERGENCY_FUND', 'SAVINGS', 'INVESTMENT']);
const GoalBody = z.strictObject({
  name: Name,
  type: GoalType,
  targetCents: PositiveCents,
  targetDate: DateOnly.nullish(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  accountId: Id.nullish(),
  manualCurrentCents: NonNegativeCents.nullish(),
  contributionCents: PositiveCents.nullish(),
  contributionFrequency: Frequency.nullish(),
  contributionInterval: z.number().int().min(1).max(366).nullish(),
  isActive: z.boolean().optional(),
  notes: OptionalText(2000),
});
const Goal = z.object({
  id: z.string(),
  name: z.string(),
  type: GoalType,
  targetCents: z.number().int(),
  targetDate: z.string().nullable(),
  priority: z.number().int(),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  manualCurrentCents: z.number().int().nullable(),
  contributionCents: z.number().int().nullable(),
  contributionFrequency: Frequency.nullable(),
  contributionInterval: z.number().int().nullable(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  currentCents: z.number().int(),
  currentSource: z.enum(['account', 'manual']),
  contributedCents: z.number().int(),
  progressPercent: z.number().nullable(),
  remainingCents: z.number().int(),
  reached: z.boolean(),
  requiredContributionCents: z.number().int().nullable(),
  projectedDate: z.string().nullable(),
  onTrack: z.boolean().nullable(),
});

// ─── Debts ───────────────────────────────────────────────────────────────────

const DebtBody = z.strictObject({
  accountId: Id,
  originalBalanceCents: NonNegativeCents.nullish(),
  annualRate: z.union([z.number().min(0).max(100), z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'Use a percentage like 6.25')]),
  minRepaymentCents: NonNegativeCents,
  repaymentFrequency: Frequency,
  repaymentInterval: z.number().int().min(1).max(366).nullish(),
  extraRepaymentCents: NonNegativeCents.optional(),
  dueDay: z.number().int().min(1).max(31).nullish(),
  startDate: DateOnly.nullish(),
  categoryId: Id.nullish(),
  indexationOnly: z.boolean().optional(),
  includeInPayoff: z.boolean().optional(),
});
const Warning = z.enum(['REPAYMENT_TOO_LOW', 'NOT_WITHIN_LIMIT']).nullable();
const Debt = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  accountType: z.string(),
  originalBalanceCents: z.number().int(),
  currentBalanceCents: z.number().int(),
  annualRate: z.string(),
  minRepaymentCents: z.number().int(),
  repaymentFrequency: Frequency,
  repaymentInterval: z.number().int().nullable(),
  extraRepaymentCents: z.number().int(),
  dueDay: z.number().int().nullable(),
  startDate: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  indexationOnly: z.boolean(),
  includeInPayoff: z.boolean(),
  offsetAccounts: z.array(z.object({ id: z.string(), name: z.string() })),
  offsetCents: z.number().int(),
  repaidCents: z.number().int(),
  percentRepaid: z.number().nullable(),
  principalReducedThisPeriodCents: z.number().int(),
  nextInterestCents: z.number().int(),
  payoffDate: z.string().nullable(),
  totalInterestCents: z.number().int(),
  repayments: z.number().int(),
  warning: Warning,
  minimumOnlyPayoffDate: z.string().nullable(),
  minimumOnlyInterestCents: z.number().int(),
});
const Period = z.object({ date: z.string(), openingCents: z.number().int(), interestCents: z.number().int(), paymentCents: z.number().int(), principalCents: z.number().int(), closingCents: z.number().int() });
const Payoff = z.object({ paidOff: z.boolean(), warning: Warning, payoffDate: z.string().nullable(), totalInterestCents: z.number().int(), repayments: z.number().int(), nextInterestCents: z.number().int(), schedule: z.array(Period) });

export const fireRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    // Sinking funds
    app.get(
      '/sinking-funds',
      { schema: { tags: ['sinking funds'], querystring: z.strictObject({ includeInactive: BooleanQuery }), response: { 200: z.object({ items: z.array(Fund) }) } } },
      async (request) => ({ items: await services.sinkingFunds.list(authOf(request).householdId, request.query) }),
    );
    app.get('/sinking-funds/:id', { schema: { tags: ['sinking funds'], params: IdParams, response: { 200: FundDetail } } }, async (request) =>
      services.sinkingFunds.get(authOf(request).householdId, request.params.id),
    );
    app.post(
      '/sinking-funds',
      { schema: { tags: ['sinking funds'], description: 'Link a recurring bill to fill the target and due date automatically.', body: FundBody, response: { 201: FundDetail } } },
      async (request, reply) => {
        reply.status(201);
        return services.sinkingFunds.create(authOf(request).householdId, request.body);
      },
    );
    app.put('/sinking-funds/:id', { schema: { tags: ['sinking funds'], params: IdParams, body: FundBody, response: { 200: FundDetail } } }, async (request) =>
      services.sinkingFunds.update(authOf(request).householdId, request.params.id, request.body),
    );
    app.delete('/sinking-funds/:id', { schema: { tags: ['sinking funds'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.sinkingFunds.remove(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });
    app.post(
      '/sinking-funds/:id/contributions',
      {
        schema: {
          tags: ['sinking funds'],
          description: 'With a linked account, send fromAccountId to move the money (a transfer), or transactionId to link a transfer already recorded. Without an account, the money is set aside.',
          params: IdParams,
          body: z.strictObject({ amountCents: PositiveCents.optional(), date: DateOnly, fromAccountId: Id.nullish(), transactionId: Id.nullish(), notes: OptionalText(500) }),
          response: { 201: FundDetail },
        },
      },
      async (request, reply) => {
        const a = authOf(request);
        reply.status(201);
        return services.sinkingFunds.contribute(a.householdId, a.userId, request.params.id, request.body);
      },
    );
    app.delete(
      '/sinking-funds/:id/contributions/:contributionId',
      { schema: { tags: ['sinking funds'], params: z.strictObject({ id: Id, contributionId: Id }), response: { 200: FundDetail } } },
      async (request) => services.sinkingFunds.deleteContribution(authOf(request).householdId, request.params.id, request.params.contributionId),
    );

    // Goals
    app.get(
      '/goals',
      { schema: { tags: ['goals'], querystring: z.strictObject({ includeInactive: BooleanQuery }), response: { 200: z.object({ items: z.array(Goal) }) } } },
      async (request) => ({ items: await services.goals.list(authOf(request).householdId, request.query) }),
    );
    app.get('/goals/:id', { schema: { tags: ['goals'], params: IdParams, response: { 200: Goal } } }, async (request) => services.goals.get(authOf(request).householdId, request.params.id));
    app.post('/goals', { schema: { tags: ['goals'], body: GoalBody, response: { 201: Goal } } }, async (request, reply) => {
      reply.status(201);
      return services.goals.create(authOf(request).householdId, request.body);
    });
    app.put('/goals/:id', { schema: { tags: ['goals'], params: IdParams, body: GoalBody, response: { 200: Goal } } }, async (request) =>
      services.goals.update(authOf(request).householdId, request.params.id, request.body),
    );
    app.delete('/goals/:id', { schema: { tags: ['goals'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.goals.remove(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });

    // Debts
    app.get('/debts', { schema: { tags: ['debts'], response: { 200: z.object({ items: z.array(Debt) }) } } }, async (request) => ({ items: await services.debts.list(authOf(request).householdId) }));
    app.get(
      '/debts/plan',
      {
        schema: {
          tags: ['debts'],
          description: 'Payoff order across all included debts. Defaults: the household strategy and the debts’ own extra repayments, per month.',
          querystring: z.strictObject({ strategy: z.enum(['SNOWBALL', 'AVALANCHE']).optional(), extraMonthlyCents: z.coerce.number().int().min(0).optional() }),
          response: {
            200: z.object({
              strategy: z.enum(['SNOWBALL', 'AVALANCHE']),
              order: z.array(z.string()),
              debtFreeDate: z.string().nullable(),
              totalInterestCents: z.number().int(),
              months: z.number().int(),
              extraMonthlyCents: z.number().int(),
              debts: z.array(z.object({ id: z.string(), name: z.string(), balanceCents: z.number().int(), annualRate: z.string(), payoffDate: z.string().nullable(), interestCents: z.number().int() })),
              timeline: z.array(z.object({ date: z.string(), balanceCents: z.number().int() })),
              alternative: z.object({ strategy: z.string(), debtFreeDate: z.string().nullable(), totalInterestCents: z.number().int() }),
            }),
          },
        },
      },
      async (request) => services.debts.plan(authOf(request).householdId, request.query),
    );
    app.get('/debts/:id', { schema: { tags: ['debts'], params: IdParams, response: { 200: Debt } } }, async (request) => services.debts.get(authOf(request).householdId, request.params.id));
    app.post('/debts', { schema: { tags: ['debts'], body: DebtBody, response: { 201: Debt } } }, async (request, reply) => {
      reply.status(201);
      return services.debts.create(authOf(request).householdId, request.body);
    });
    app.put('/debts/:id', { schema: { tags: ['debts'], params: IdParams, body: DebtBody, response: { 200: Debt } } }, async (request) =>
      services.debts.update(authOf(request).householdId, request.params.id, request.body),
    );
    app.delete('/debts/:id', { schema: { tags: ['debts'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.debts.remove(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });
    app.get(
      '/debts/:id/payoff',
      {
        schema: {
          tags: ['debts'],
          description: 'Minimum-only against minimum + extra. Estimates: lenders’ calculations differ.',
          params: IdParams,
          querystring: z.strictObject({ extraCents: z.coerce.number().int().min(0).optional() }),
          response: {
            200: z.object({
              debtId: z.string(),
              accountName: z.string(),
              balanceCents: z.number().int(),
              offsetCents: z.number().int(),
              extraCents: z.number().int(),
              monthsSaved: z.number().int().nullable(),
              interestSavedCents: z.number().int().nullable(),
              minimum: Payoff,
              withExtra: Payoff,
            }),
          },
        },
      },
      async (request) => services.debts.payoff(authOf(request).householdId, request.params.id, request.query.extraCents),
    );
  };
