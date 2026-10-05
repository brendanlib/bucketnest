import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { DateOnly } from '../lib/schemas.js';
import { PeriodResponse } from './budgets.js';
import { OccurrenceResponse } from './recurring.js';

const Status = z.enum(['none', 'ok', 'amber', 'red', 'unbudgeted']);

const DashboardResponse = z.object({
  budget: z.object({ id: z.string(), name: z.string(), periodType: z.string() }),
  period: PeriodResponse,
  income: z.object({
    expected: z.object({ weekly: z.number().int(), fortnightly: z.number().int(), monthly: z.number().int(), annual: z.number().int() }),
    plannedCents: z.number().int(),
    plannedSource: z.enum(['schedules', 'budget', 'none']),
    actualCents: z.number().int(),
    scheduledCents: z.number().int(),
    otherCents: z.number().int(),
    allocationBasis: z.enum(['PLANNED', 'ACTUAL']),
    allocationIncomeCents: z.number().int(),
  }),
  buckets: z.array(
    z.object({
      bucketId: z.string(),
      key: z.string(),
      name: z.string(),
      colour: z.string(),
      percentage: z.string(),
      allocatedCents: z.number().int(),
      actualCents: z.number().int(),
      remainingCents: z.number().int(),
      percentUsed: z.number().nullable(),
      percentOfIncome: z.number().nullable(),
      status: Status,
      plannedCents: z.number().int(),
      overAllocatedCents: z.number().int(),
      fire: z
        .object({
          savingsCents: z.number().int(),
          investmentCents: z.number().int(),
          extraRepaymentsCents: z.number().int(),
          principalReducedCents: z.number().int(),
          goals: z.array(
            z.object({ id: z.string(), name: z.string(), type: z.string(), targetCents: z.number().int(), currentCents: z.number().int(), progressPercent: z.number().nullable(), onTrack: z.boolean().nullable() }),
          ),
        })
        .optional(),
    }),
  ),
  billsDue: z.array(OccurrenceResponse),
  alerts: z.array(
    z.object({
      categoryId: z.string(),
      name: z.string(),
      bucketKey: z.string(),
      bucketName: z.string(),
      colour: z.string(),
      budgetCents: z.number().int(),
      actualCents: z.number().int(),
      remainingCents: z.number().int(),
      percentUsed: z.number().nullable(),
      status: z.enum(['amber', 'red']),
    }),
  ),
  watch: z.array(
    z.object({
      kind: z.enum(['sinking_fund', 'goal']),
      id: z.string(),
      name: z.string(),
      date: z.string().nullable(),
      targetCents: z.number().int(),
      currentCents: z.number().int(),
      shortfallCents: z.number().int(),
      status: z.enum(['due_soon', 'due_short', 'behind']),
    }),
  ),
  netWorth: z.object({
    assetsCents: z.number().int(),
    liabilitiesCents: z.number().int(),
    netWorthCents: z.number().int(),
    date: z.string(),
    history: z.array(z.object({ date: z.string(), netWorthCents: z.number().int() })),
  }),
  uncategorisedCount: z.number().int(),
});

export const dashboardRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/dashboard',
      {
        schema: {
          tags: ['dashboard'],
          description: '`period` is any date inside the budget period wanted (default: today). `basis` overrides the allocation basis.',
          querystring: z.strictObject({ period: DateOnly.optional(), basis: z.enum(['PLANNED', 'ACTUAL']).optional() }),
          response: { 200: DashboardResponse },
        },
      },
      async (request) => services.dashboard.get(authOf(request).householdId, { date: request.query.period, basis: request.query.basis }),
    );
  };
