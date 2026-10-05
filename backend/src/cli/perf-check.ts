/**
 * Performance check (spec Phase 6): one household with 50,000 transactions,
 * then the time each main page's API call takes.
 *
 *   DATABASE_URL=postgresql://…/budget_perf npm run perf-check
 *
 * Use a throwaway database: it adds the demo household and 50,000 transactions.
 * Exits non-zero if any call's median is over its budget.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db.js';
import { cookieNames } from '../plugins/auth.js';
import { addDays, dateInTimeZone, dateOnlyToDb } from '../finance/dates.js';
import { DEMO_EMAIL, demoExists, seedDemo } from '../seed/demo.js';

const TARGET = 50_000;
const PASSWORD = 'perf check demo passphrase';
const BUDGET_MS = 300; // every page's call, median
const SLOW_BUDGET_MS = 2_000; // whole-history exports and five-year reports

async function bulkLoad(app: FastifyInstance, householdId: string) {
  const db = app.deps.db;
  const existing = await db.transaction.count({ where: { householdId } });
  if (existing >= TARGET) return existing;
  const accounts = await db.account.findMany({ where: { householdId, name: { in: ['Everyday', 'Visa', 'Splurge'] } } });
  const cats = await db.category.findMany({ where: { householdId, name: { in: ['Groceries', 'Fuel', 'Coffee', 'Dining out', 'Takeaway', 'Household supplies', 'Pharmacy', 'Clothing', 'Entertainment'] } } });
  const oldest = await db.transaction.findFirstOrThrow({ where: { householdId }, orderBy: { date: 'asc' } });
  const firstDay = oldest.date.toISOString().slice(0, 10);
  const words = ['WOOLWORTHS', 'COLES', 'ALDI', 'AMPOL', 'BP CONNECT', 'LOCAL CAFE', 'THAI ORCHID', 'UBER *EATS', 'BUNNINGS', 'CHEMIST WAREHOUSE', 'UNIQLO', 'HOYTS'];
  let rng = 12345;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  let made = existing;
  const days = 5 * 365; // five more years of history before the demo's year
  while (made < TARGET) {
    const tx: Prisma.TransactionCreateManyInput[] = [];
    const splits: Prisma.TransactionSplitCreateManyInput[] = [];
    for (let i = 0; i < 2_000 && made < TARGET; i++, made++) {
      const id = randomUUID();
      const amount = BigInt(200 + Math.floor(rand() * 20_000));
      const account = accounts[Math.floor(rand() * accounts.length)]!;
      tx.push({
        id,
        householdId,
        date: dateOnlyToDb(addDays(firstDay, -1 - Math.floor(rand() * days))),
        description: `${words[Math.floor(rand() * words.length)]} ${1000 + Math.floor(rand() * 9000)}`,
        amountCents: amount,
        type: 'EXPENSE',
        accountId: account.id,
        cleared: true,
      });
      splits.push({ householdId, transactionId: id, categoryId: cats[Math.floor(rand() * cats.length)]!.id, amountCents: amount });
    }
    // Splits are checked against their transaction at commit, so both go in one transaction.
    await db.$transaction([db.transaction.createMany({ data: tx }), db.transactionSplit.createMany({ data: splits })]);
    process.stdout.write(`\r  ${made.toLocaleString()} transactions`);
  }
  process.stdout.write('\n');
  // Opening balances moved back so the older history doesn't push accounts negative before they "opened".
  await db.account.updateMany({ where: { householdId }, data: { openingDate: dateOnlyToDb(addDays(firstDay, -days - 1)) } });
  await db.$executeRaw`ANALYZE`;
  return made;
}

async function main() {
  const config = { ...loadConfig(), logLevel: 'warn', jobsEnabled: false };
  const db = createDb(config.databaseUrl);
  const app = await buildApp({ config, db });
  try {
    if (!(await demoExists(app))) {
      console.log('Creating the demo household…');
      await seedDemo(app, { password: PASSWORD });
    }
    const user = await db.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL }, include: { memberships: true } });
    const householdId = user.memberships[0]!.householdId;
    console.log('Loading transactions…');
    const total = await bulkLoad(app, householdId);

    // Log in as the demo user, like a browser.
    const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
    const csrf = csrfRes.cookies.find((c) => c.name === cookieNames(config).csrf)!;
    const token = (JSON.parse(csrfRes.body) as { csrfToken: string }).csrfToken;
    const base = { cookie: `${csrf.name}=${csrf.value}`, 'x-csrf-token': token, origin: config.publicOrigin, 'x-internal-key': app.internalRequestKey };
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...base, 'content-type': 'application/json' }, payload: JSON.stringify({ email: DEMO_EMAIL, password: PASSWORD }) });
    if (login.statusCode !== 200) throw new Error(`login failed (${login.statusCode}); the perf check needs a database where it created the demo user`);
    const session = login.cookies.find((c) => c.name === cookieNames(config).session)!;
    const headers = { ...base, cookie: `${base.cookie}; ${session.name}=${session.value}` };

    const settings = await db.household.findUniqueOrThrow({ where: { id: householdId } });
    const today = dateInTimeZone(new Date(), settings.timezone);
    const yearAgo = addDays(today, -365);
    const fiveYears = addDays(today, -6 * 365);
    const budget = await db.budget.findFirstOrThrow({ where: { householdId, isActive: true } });
    const everyday = await db.account.findFirstOrThrow({ where: { householdId, name: 'Everyday' } });

    const checks: [string, string, number][] = [
      ['Dashboard', '/dashboard', BUDGET_MS],
      ['Transactions, page 1', '/transactions', BUDGET_MS],
      ['Transactions, page 500', '/transactions?page=500', BUDGET_MS],
      ['Transactions, search', '/transactions?search=woolworths', BUDGET_MS],
      ['Transactions, by amount', '/transactions?sort=amount', BUDGET_MS],
      ['Accounts (balances)', '/accounts', BUDGET_MS],
      ['Account balance history', `/accounts/${everyday.id}/balance-history?from=${yearAgo}&to=${today}`, BUDGET_MS],
      ['Budget summary', `/budgets/${budget.id}/summary`, BUDGET_MS],
      ['Bills / occurrences', `/recurring-transactions/occurrences?from=${today}&to=${addDays(today, 60)}`, BUDGET_MS],
      ['Calendar', `/calendar?from=${today.slice(0, 8)}01&to=${addDays(today, 35)}`, BUDGET_MS],
      ['Sinking funds', '/sinking-funds', BUDGET_MS],
      ['Goals', '/goals', BUDGET_MS],
      ['Debts', '/debts', BUDGET_MS],
      ['Notifications', '/notifications', BUDGET_MS],
      ['Spending report, 12 months', `/reports/spending?from=${yearAgo}&to=${today}`, BUDGET_MS],
      ['Income vs expenses, 12 months', `/reports/income-vs-expenses?from=${yearAgo}&to=${today}`, BUDGET_MS],
      ['Budget vs actual', '/reports/budget-vs-actual', BUDGET_MS],
      ['Forecast, 6 months', '/reports/forecast?months=6', BUDGET_MS],
      ['Net worth, 12 months', `/reports/net-worth?from=${yearAgo}&to=${today}`, BUDGET_MS],
      ['Spending report, 6 years', `/reports/spending?from=${fiveYears}&to=${today}`, SLOW_BUDGET_MS],
      ['Net worth, 6 years', `/reports/net-worth?from=${fiveYears}&to=${today}`, SLOW_BUDGET_MS],
      ['Export transactions (CSV)', '/export?format=csv&entity=transactions', SLOW_BUDGET_MS * 3],
      ['Export everything (JSON)', '/export?format=json', SLOW_BUDGET_MS * 3],
    ];

    console.log(`\n${total.toLocaleString()} transactions in one household. Median of 5 runs after a warm-up:\n`);
    let failed = 0;
    for (const [label, url, budgetMs] of checks) {
      const times: number[] = [];
      let bytes = 0;
      for (let i = 0; i < 6; i++) {
        const t0 = performance.now();
        const res = await app.inject({ method: 'GET', url: `/api${url}`, headers });
        const ms = performance.now() - t0;
        if (res.statusCode !== 200) throw new Error(`${url} → ${res.statusCode}: ${res.body.slice(0, 300)}`);
        bytes = res.rawPayload.length;
        if (i > 0) times.push(ms);
      }
      times.sort((a, b) => a - b);
      const median = times[2]!;
      const ok = median <= budgetMs;
      if (!ok) failed++;
      console.log(`${ok ? '  ok ' : ' SLOW'}  ${label.padEnd(32)} ${median.toFixed(0).padStart(6)} ms  (max ${times[4]!.toFixed(0)} ms, budget ${budgetMs} ms, ${(bytes / 1024).toFixed(0)} KB)`);
    }
    if (failed) {
      console.log(`\n${failed} call(s) over budget.`);
      process.exitCode = 1;
    } else console.log('\nEverything within budget.');
  } finally {
    await app.close();
    await db.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
