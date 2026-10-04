import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb } from './db.js';
import { buildJobs } from './jobs/index.js';
import { startScheduler } from './jobs/scheduler.js';

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

  if (config.seedDemo) app.log.warn('SEED_DEMO is set, but demo data is not available in this build yet; starting with an empty database');
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
