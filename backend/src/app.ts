import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppConfig } from './config.js';
import type { Db } from './db.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { AttemptThrottle } from './lib/throttle.js';
import { createServices, type Services } from './services/index.js';
import type { Deps } from './services/context.js';
import { registerErrorHandling } from './plugins/errors.js';
import { registerAuth, requireAuth } from './plugins/auth.js';
import { registerSecurity } from './plugins/security.js';
import { registerDocs } from './plugins/docs.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { settingsRoutes } from './routes/settings.js';
import { bucketRoutes } from './routes/buckets.js';
import { categoryRoutes } from './routes/categories.js';
import { accountRoutes } from './routes/accounts.js';
import { transactionRoutes } from './routes/transactions.js';
import { budgetRoutes } from './routes/budgets.js';
import { recurringRoutes } from './routes/recurring.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { ruleRoutes } from './routes/rules.js';
import { importRoutes } from './routes/imports.js';
import { fireRoutes } from './routes/fire.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { reportRoutes } from './routes/reports.js';
import { notificationRoutes } from './routes/notifications.js';
import { memberRoutes } from './routes/members.js';
import { bankFeedRoutes } from './routes/bankfeeds.js';

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
    services: Services;
    authThrottle: AttemptThrottle;
  }
}

export interface BuildOptions {
  config: AppConfig;
  db: Db;
  mailer?: Mailer;
  now?: () => Date;
  fetch?: typeof fetch;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config, db } = opts;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'req.headers["x-internal-key"]', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  const deps: Deps = {
    db,
    config,
    mailer: opts.mailer ?? createMailer(config),
    log: app.log,
    now: opts.now ?? (() => new Date()),
    fetch: opts.fetch ?? globalThis.fetch,
  };
  const services = createServices(deps);
  const throttle = new AttemptThrottle(config.rateLimits.auth);
  app.decorate('deps', deps);
  app.decorate('services', services);
  app.decorate('authThrottle', throttle);

  await app.register(cookie);
  registerAuth(app, config, services.auth);
  await registerSecurity(app, config);
  await registerDocs(app);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes(services, config, throttle));
      // Invite lookup and sign-up work before login; the rest of this plugin requires it.
      await api.register(memberRoutes(services, config));
      await api.register(async (protectedApi) => {
        protectedApi.addHook('onRequest', requireAuth);
        await protectedApi.register(settingsRoutes(services));
        await protectedApi.register(bucketRoutes(services));
        await protectedApi.register(categoryRoutes(services));
        await protectedApi.register(accountRoutes(services));
        await protectedApi.register(transactionRoutes(services));
        await protectedApi.register(budgetRoutes(services));
        await protectedApi.register(recurringRoutes(services));
        await protectedApi.register(dashboardRoutes(services));
        await protectedApi.register(ruleRoutes(services));
        await protectedApi.register(importRoutes(services));
        await protectedApi.register(fireRoutes(services));
        await protectedApi.register(onboardingRoutes(services));
        await protectedApi.register(reportRoutes(services));
        await protectedApi.register(notificationRoutes(services, config));
        await protectedApi.register(bankFeedRoutes(services));
      });
    },
    { prefix: '/api' },
  );

  return app;
}
