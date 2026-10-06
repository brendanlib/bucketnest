/**
 * Removes two-step sign-in from an account, for someone who has lost both
 * their phone and their recovery codes:
 *   docker compose exec backend npm run disable-mfa -- user@example.com
 * Signs them out everywhere; they sign in with just their password and can set it up again.
 */
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db.js';

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run disable-mfa -- user@example.com');
    process.exit(2);
  }
  const config = { ...loadConfig(), logLevel: 'warn', jobsEnabled: false };
  const db = createDb(config.databaseUrl);
  const app = await buildApp({ config, db });
  try {
    const user = await app.services.mfa.adminDisable(email);
    console.log(`Two-step sign-in removed for ${user.email}. They're signed out everywhere and can sign in with their password.`);
  } catch (err) {
    console.error(err instanceof Error && 'statusCode' in err ? `No user with email ${email}` : err);
    process.exitCode = 1;
  } finally {
    await app.close();
    await db.$disconnect();
  }
}

void main();
