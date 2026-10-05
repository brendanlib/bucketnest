import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb } from './db.js';
import { buildJobs } from './jobs/index.js';
import { startScheduler } from './jobs/scheduler.js';
import { demoExists, seedDemo } from './seed/demo.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const db = createDb(config.databaseUrl);
  const app = await buildApp({ config, db });
  const stopJobs = config.jobsEnabled ? startScheduler(db, app.log, buildJobs(app)) : () => {};

  // Demo data only on a first start: never added to a database that already has people in it.
  if (config.seedDemo && (await db.user.count()) === 0 && !(await demoExists(app))) {
    try {
      const demo = await seedDemo(app, { password: process.env.DEMO_PASSWORD || undefined });
      app.log.warn(
        { email: demo.email, ...(process.env.DEMO_PASSWORD ? {} : { password: demo.password }) },
        'demo household created: log in with these details, and delete it in Settings → Data before real use',
      );
    } catch (err) {
      // A weak DEMO_PASSWORD is refused like any other password; the app still starts.
      app.log.error({ err: (err as Error).message }, 'demo household could not be created');
    }
  }
  if (!config.smtp) app.log.info('SMTP not configured: password reset is available through the reset-password CLI only');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopJobs();
    await app.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

void main();
