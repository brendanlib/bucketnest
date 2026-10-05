import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { DateOnly, Name } from '../lib/schemas.js';

const PeriodType = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUAL']);
const DisplayFrequency = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUALLY']);
const Threshold = z.number().min(1).max(500).multipleOf(0.01);

export const SettingsResponse = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.string(),
  locale: z.string(),
  timezone: z.string(),
  fyStartMonth: z.number().int(),
  weekStartDay: z.number().int(),
  budgetPeriodType: PeriodType,
  budgetAnchorDate: z.string(),
  displayFrequency: z.string(),
  allocationBasis: z.enum(['PLANNED', 'ACTUAL']),
  amberThreshold: z.number(),
  redThreshold: z.number(),
  debtPayoffStrategy: z.enum(['SNOWBALL', 'AVALANCHE']),
  gstEnabled: z.boolean(),
  forecastMethod: z.enum(['AVG3', 'AVG6', 'AVG12', 'MANUAL']),
});

export const settingsRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/settings', { schema: { tags: ['settings'], response: { 200: SettingsResponse } } }, async (request) =>
      services.settings.get(authOf(request).householdId),
    );

    app.put(
      '/settings',
      {
        schema: {
          tags: ['settings'],
          body: z.strictObject({
            name: Name.optional(),
            currency: z.string().length(3).optional(),
            locale: z.string().min(2).max(35).optional(),
            timezone: z.string().min(1).max(64).optional(),
            fyStartMonth: z.number().int().min(1).max(12).optional(),
            weekStartDay: z.number().int().min(1).max(7).optional(),
            budgetPeriodType: PeriodType.optional(),
            budgetAnchorDate: DateOnly.optional(),
            displayFrequency: DisplayFrequency.optional(),
            allocationBasis: z.enum(['PLANNED', 'ACTUAL']).optional(),
            amberThreshold: Threshold.optional(),
            redThreshold: Threshold.optional(),
            debtPayoffStrategy: z.enum(['SNOWBALL', 'AVALANCHE']).optional(),
            gstEnabled: z.boolean().optional(),
            forecastMethod: z.enum(['AVG3', 'AVG6', 'AVG12']).optional(),
          }),
          response: { 200: SettingsResponse },
        },
      },
      async (request) => services.settings.update(authOf(request).householdId, request.body),
    );
  };
