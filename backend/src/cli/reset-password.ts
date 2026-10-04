/**
 * Resets a user's password without email:
 *   docker compose exec backend npm run reset-password -- user@example.com
 * Prints a new random password and ends all of the user's sessions.
 */
import { loadConfig } from '../config.js';
import { createDb } from '../db.js';
import { generatePassword } from '../lib/password.js';
import { createAuthService } from '../services/auth.service.js';
import { createMailer } from '../lib/mailer.js';

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run reset-password -- user@example.com');
    process.exit(2);
  }
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const silent = { info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, child() { return silent; }, level: 'silent', silent() {} };
  const auth = createAuthService({ db, config, mailer: createMailer(config), log: silent as never, now: () => new Date() });
  try {
    const password = generatePassword();
    const user = await auth.setPasswordByEmail(email, password);
    console.log(`Password reset for ${user.email}.`);
    console.log(`Temporary password: ${password}`);
    console.log('All sessions have been signed out. Log in and change this password in Settings → Security.');
  } catch (err) {
    console.error(err instanceof Error && 'statusCode' in err ? `No user with email ${email}` : err);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
