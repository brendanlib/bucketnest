/**
 * Adds the demo household to a running installation:
 *   docker compose exec backend npm run seed:demo
 * Prints the demo login. Does nothing if the demo user already exists.
 */
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db.js';
import { DEMO_EMAIL, demoExists, seedDemo } from '../seed/demo.js';

async function main() {
  const config = { ...loadConfig(), logLevel: 'warn' };
  const db = createDb(config.databaseUrl);
  const app = await buildApp({ config, db });
  try {
    if (await demoExists(app)) {
      console.log(`The demo user ${DEMO_EMAIL} already exists. Delete its household in Settings → Data to start again.`);
      return;
    }
    console.log('Creating the demo household (a year of data takes a minute)…');
    const demo = await seedDemo(app, { password: process.env.DEMO_PASSWORD || undefined });
    console.log(`Done: ${demo.transactions} transactions.`);
    console.log(`Log in as ${demo.email}${process.env.DEMO_PASSWORD ? ' with DEMO_PASSWORD' : ` with password: ${demo.password}`}`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await app.close();
    await db.$disconnect();
  }
}

void main();
