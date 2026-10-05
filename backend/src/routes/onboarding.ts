import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';

const TipKey = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Unknown tip');
const Tips = z.object({ dismissedTips: z.array(z.string()) });

export const onboardingRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/onboarding',
      {
        schema: {
          tags: ['onboarding'],
          description: 'The getting-started checklist. Steps complete themselves from the household’s data.',
          response: {
            200: z.object({
              dismissed: z.boolean(),
              showWelcome: z.boolean(),
              steps: z.array(z.object({ key: z.enum(['accounts', 'income', 'bills', 'budget', 'transactions', 'savings']), done: z.boolean() })),
              completed: z.number().int(),
              total: z.number().int(),
            }),
          },
        },
      },
      async (request) => {
        const a = authOf(request);
        return services.onboarding.status(a.householdId, a.userId);
      },
    );

    app.post(
      '/me/tips/:key/dismiss',
      { schema: { tags: ['onboarding'], params: z.strictObject({ key: TipKey }), response: { 200: Tips } } },
      async (request) => ({ dismissedTips: await services.onboarding.dismiss(authOf(request).userId, request.params.key) }),
    );

    app.post('/me/tips/reset', { schema: { tags: ['onboarding'], description: 'Shows every tip and the checklist again.', response: { 200: Tips } } }, async (request) => ({
      dismissedTips: await services.onboarding.reset(authOf(request).userId),
    }));
  };
