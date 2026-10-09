/**
 * Demo household: a year of realistic activity, entered through the API so it
 * passes exactly the validation real data does.
 *
 *   SEED_DEMO=true on first start, or: docker compose exec backend npm run seed:demo
 */
import type { FastifyInstance } from 'fastify';
import { cookieNames } from '../plugins/auth.js';
import { addDays, addMonthsClamped, compareDates, dateInTimeZone, isoWeekday, parseDateOnly, type DateOnly } from '../finance/dates.js';
import { generatePassword } from '../lib/password.js';

export const DEMO_EMAIL = 'demo@example.com';

/** Small deterministic PRNG, so every demo looks the same. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Json = Record<string, unknown>;

/** Calls the API in-process, as the demo user, with the same checks a browser request gets. */
class ApiCaller {
  constructor(
    private readonly app: FastifyInstance,
    private readonly headers: Record<string, string>,
  ) {}

  async call<T = Json>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
    const res = await this.app.inject({
      method,
      url: `/api${url}`,
      headers: { ...this.headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.statusCode >= 400) throw new Error(`demo seed: ${method} ${url} failed (${res.statusCode}): ${res.body}`);
    return (res.body ? JSON.parse(res.body) : undefined) as T;
  }
  get = <T = Json>(url: string) => this.call<T>('GET', url);
  post = <T = Json>(url: string, body: unknown = {}) => this.call<T>('POST', url, body);
  put = <T = Json>(url: string, body: unknown) => this.call<T>('PUT', url, body);
}

export interface DemoResult {
  email: string;
  password: string;
  householdId: string;
  transactions: number;
  userId: string;
}

export async function demoExists(app: FastifyInstance): Promise<boolean> {
  return (await app.deps.db.user.count({ where: { email: DEMO_EMAIL } })) > 0;
}

export async function seedDemo(app: FastifyInstance, opts: { password?: string; email?: string; name?: string } = {}): Promise<DemoResult> {
  const { config } = app.deps;
  const password = opts.password ?? generatePassword();
  const email = opts.email ?? DEMO_EMAIL;
  const { user, session } = await app.services.auth.register(
    { email, name: opts.name ?? 'Sam Demo', password, timezone: config.defaultTimezone, userAgent: 'demo seed' },
    { ignoreRegistrationSwitch: true },
  );

  // A CSRF cookie and token, then every call carries the session, token and origin.
  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const csrfCookie = csrfRes.cookies.find((c) => c.name === cookieNames(config).csrf)!;
  const api = new ApiCaller(app, {
    cookie: `${cookieNames(config).session}=${session.token}; ${csrfCookie.name}=${csrfCookie.value}`,
    'x-csrf-token': (JSON.parse(csrfRes.body) as { csrfToken: string }).csrfToken,
    origin: config.publicOrigin,
    'x-internal-key': app.internalRequestKey,
  });

  const rand = mulberry32(20261005);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));

  const settings = await api.get<{ id: string; timezone: string }>('/settings');
  const today = dateInTimeZone(app.deps.now(), settings.timezone);
  const yesterday = addDays(today, -1);
  const { year, month } = parseDateOnly(today);
  const start = addMonthsClamped(`${year}-${String(month).padStart(2, '0')}-01`, -12);
  await api.put('/settings', { name: 'Demo household' });

  const cats = (await api.get<{ items: { id: string; name: string; isGroup: boolean }[] }>('/categories')).items;
  const cat = (name: string) => {
    const c = cats.find((x) => x.name === name && !x.isGroup);
    if (!c) throw new Error(`demo seed: no category "${name}"`);
    return c.id;
  };
  const buckets = (await api.get<{ items: { id: string; key: string }[] }>('/buckets')).items;
  const bucket = (key: string) => buckets.find((b) => b.key === key)!.id;

  // ── Accounts ──────────────────────────────────────────────────────────────
  const account = async (body: Json) => (await api.post<{ id: string }>('/accounts', { openingDate: start, ...body })).id;
  const everyday = await account({ name: 'Everyday', type: 'TRANSACTION', institution: 'Demo Bank', openingBalanceCents: 320000, last4: '4821' });
  const billsSaver = await account({ name: 'Bills saver', type: 'SAVINGS', institution: 'Demo Bank', openingBalanceCents: 60000, bucketTagId: bucket('BILLS') });
  const smile = await account({ name: 'Smile', type: 'SAVINGS', institution: 'Demo Bank', openingBalanceCents: 150000, bucketTagId: bucket('SMILE') });
  const splurge = await account({ name: 'Splurge', type: 'TRANSACTION', institution: 'Demo Bank', openingBalanceCents: 20000, bucketTagId: bucket('SPLURGE') });
  const emergency = await account({ name: 'Emergency fund', type: 'SAVINGS', institution: 'Demo Bank', openingBalanceCents: 650000, bucketTagId: bucket('FIRE_EXTINGUISHER') });
  const visa = await account({ name: 'Visa', type: 'CREDIT_CARD', institution: 'Demo Bank', openingBalanceCents: 0, last4: '1093' });
  const mortgage = await account({ name: 'Home loan', type: 'MORTGAGE', institution: 'Demo Bank', openingBalanceCents: 52_000_000, repaymentTreatment: 'DEBT_REPAYMENT' });
  await account({ name: 'Offset', type: 'OFFSET', institution: 'Demo Bank', openingBalanceCents: 1_800_000, offsetForAccountId: mortgage });
  const carLoan = await account({ name: 'Car loan', type: 'CAR_LOAN', institution: 'Demo Finance', openingBalanceCents: 1_850_000, repaymentTreatment: 'DEBT_REPAYMENT' });
  const hecs = await account({ name: 'HECS-HELP', type: 'HECS_HELP', openingBalanceCents: 2_140_000 });
  await account({ name: 'Super', type: 'SUPERANNUATION', institution: 'Demo Super', openingBalanceCents: 6_800_000 });

  // ── Schedules ─────────────────────────────────────────────────────────────
  const firstWeekday = (from: DateOnly, weekday: number) => {
    let d = from;
    while (isoWeekday(d) !== weekday) d = addDays(d, 1);
    return d;
  };
  const payday = firstWeekday(start, 4); // Thursdays
  const schedule = async (body: Json) => (await api.post<{ id: string }>('/recurring-transactions', body)).id;
  const estimates = new Set<string>();
  const est = async (body: Json) => {
    const id = await schedule({ amountKind: 'ESTIMATE', ...body });
    estimates.add(id);
    return id;
  };

  await schedule({ name: 'Salary', type: 'INCOME', amountCents: 385000, frequency: 'FORTNIGHTLY', startDate: payday, accountId: everyday, categoryId: cat('Salary and wages'), payee: 'Demo Employer Pty Ltd' });
  await schedule({ name: 'Partner salary', type: 'INCOME', amountCents: 192000, frequency: 'FORTNIGHTLY', startDate: addDays(payday, 7), accountId: everyday, categoryId: cat('Salary and wages') });
  await schedule({ name: 'Smile transfer', type: 'TRANSFER', amountCents: 40000, frequency: 'FORTNIGHTLY', startDate: payday, accountId: everyday, toAccountId: smile, autoPost: true });
  await schedule({ name: 'Splurge transfer', type: 'TRANSFER', amountCents: 30000, frequency: 'FORTNIGHTLY', startDate: payday, accountId: everyday, toAccountId: splurge, autoPost: true });
  await schedule({ name: 'Emergency fund', type: 'SAVINGS_CONTRIBUTION', amountCents: 35000, frequency: 'FORTNIGHTLY', startDate: payday, accountId: everyday, toAccountId: emergency, categoryId: cat('Emergency fund'), autoPost: true });
  await schedule({ name: 'Home loan repayment', type: 'DEBT_REPAYMENT', amountCents: 310000, frequency: 'MONTHLY', startDate: addDays(start, 0), accountId: everyday, toAccountId: mortgage });
  await schedule({ name: 'Car loan repayment', type: 'DEBT_REPAYMENT', amountCents: 52000, frequency: 'MONTHLY', startDate: addDays(start, 9), accountId: everyday, toAccountId: carLoan });
  await est({ name: 'Electricity', type: 'EXPENSE', amountCents: 42000, frequency: 'QUARTERLY', startDate: addDays(start, 20), accountId: everyday, categoryId: cat('Electricity'), payee: 'Demo Energy' });
  await est({ name: 'Water', type: 'EXPENSE', amountCents: 26000, frequency: 'QUARTERLY', startDate: addDays(start, 40), accountId: everyday, categoryId: cat('Water') });
  await schedule({ name: 'Council rates', type: 'EXPENSE', amountCents: 48000, frequency: 'QUARTERLY', startDate: addDays(start, 30), accountId: everyday, categoryId: cat('Council rates') });
  await schedule({ name: 'Internet', type: 'EXPENSE', amountCents: 7900, frequency: 'MONTHLY', startDate: addDays(start, 3), accountId: visa, categoryId: cat('Internet') });
  await schedule({ name: 'Mobile phones', type: 'EXPENSE', amountCents: 9000, frequency: 'MONTHLY', startDate: addDays(start, 11), accountId: visa, categoryId: cat('Mobile phone') });
  await schedule({ name: 'Health insurance', type: 'EXPENSE', amountCents: 21400, frequency: 'MONTHLY', startDate: addDays(start, 1), accountId: everyday, categoryId: cat('Private health insurance') });
  await schedule({ name: 'Car insurance', type: 'EXPENSE', amountCents: 9500, frequency: 'MONTHLY', startDate: addDays(start, 14), accountId: everyday, categoryId: cat('Car insurance') });
  await schedule({ name: 'Netflix', type: 'EXPENSE', amountCents: 1899, frequency: 'MONTHLY', startDate: addDays(start, 6), accountId: visa, categoryId: cat('Streaming services'), autoPost: true });
  await schedule({ name: 'Spotify', type: 'EXPENSE', amountCents: 1399, frequency: 'MONTHLY', startDate: addDays(start, 17), accountId: visa, categoryId: cat('Music'), autoPost: true });
  const rego = await schedule({ name: 'Car rego', type: 'EXPENSE', amountCents: 88000, frequency: 'ANNUALLY', startDate: addMonthsClamped(start, 4), accountId: everyday, categoryId: cat('Car registration (rego)') });

  // Mark every past occurrence paid. Estimates come in a little above or below.
  const occurrences = (
    await api.get<{ items: { recurringId: string; occurrenceDate: string; status: string; autoPost: boolean }[] }>(`/recurring-transactions/occurrences?from=${start}&to=${yesterday}`)
  ).items.filter((o) => o.status === 'overdue' || o.status === 'due');
  for (const o of occurrences) {
    const path = `/recurring-transactions/${o.recurringId}/occurrences/${o.occurrenceDate}`;
    if (estimates.has(o.recurringId)) {
      const draft = await api.get<Json & { amountCents: number; splits?: { categoryId: string; amountCents: number }[] }>(`${path}/draft`);
      const amount = Math.round(draft.amountCents * (0.85 + rand() * 0.3));
      await api.post(`${path}/post`, { ...draft, amountCents: amount, splits: draft.splits?.map((s) => ({ ...s, amountCents: amount })) });
    } else {
      await api.post(`${path}/post`);
    }
  }

  // ── Everyday spending ─────────────────────────────────────────────────────
  let count = occurrences.length;
  const visaByMonth = new Map<string, number>();
  const spend = async (date: DateOnly, accountId: string, category: string, amountCents: number, description: string) => {
    await api.post('/transactions', { type: 'EXPENSE', date, accountId, amountCents, description, cleared: compareDates(date, addDays(today, -7)) < 0, splits: [{ categoryId: cat(category), amountCents }] });
    if (accountId === visa) visaByMonth.set(date.slice(0, 7), (visaByMonth.get(date.slice(0, 7)) ?? 0) + amountCents);
    count++;
  };
  for (let d = start; compareDates(d, today) <= 0; d = addDays(d, 1)) {
    const wd = isoWeekday(d);
    const { month: m, day } = parseDateOnly(d);
    if (wd === 6) await spend(d, everyday, 'Groceries', between(15000, 26000), pick(['WOOLWORTHS 3051', 'COLES 0712', 'ALDI STORES']));
    if (wd === 3 && rand() < 0.5) await spend(d, everyday, 'Groceries', between(2500, 6500), pick(['WOOLWORTHS METRO', 'IGA LOCAL']));
    if ((wd === 1 || wd === 4) && rand() < 0.45) await spend(d, visa, 'Fuel', between(5500, 9500), pick(['AMPOL FOODARY', 'BP CONNECT', '7-ELEVEN FUEL']));
    if (wd <= 5 && rand() < 0.55) await spend(d, splurge, 'Coffee', pick([480, 520, 550, 600]), pick(['DUKES COFFEE', 'LOCAL CAFE', 'BRUNETTI']));
    if ((wd === 5 || wd === 6) && rand() < 0.3) await spend(d, visa, 'Dining out', between(6000, 16000), pick(['THAI ORCHID', 'SUSHI TRAIN', 'PIZZERIA NAPOLI', 'THE LOCAL PUB']));
    if (rand() < 0.12) await spend(d, visa, 'Takeaway', between(2500, 5500), pick(['UBER *EATS', 'MENULOG', 'GUZMAN Y GOMEZ']));
    if (rand() < 0.05) await spend(d, everyday, 'Household supplies', between(1500, 9000), pick(['BUNNINGS', 'KMART', 'BIG W']));
    if (rand() < 0.035) await spend(d, everyday, 'Pharmacy', between(1200, 4800), pick(['CHEMIST WAREHOUSE', 'PRICELINE PHARMACY']));
    if (rand() < 0.04) await spend(d, splurge, 'Clothing', between(3000, 12000), pick(['UNIQLO', 'COTTON ON', 'MYER']));
    if (wd === 6 && rand() < 0.2) await spend(d, visa, 'Entertainment', between(2500, 7000), pick(['HOYTS', 'EVENT CINEMAS', 'TICKETEK']));
    if (m === 12 && day >= 5 && day <= 22 && rand() < 0.3) await spend(d, visa, 'Christmas', between(3000, 15000), pick(['MYER', 'DAVID JONES', 'JB HI-FI', 'DYMOCKS']));
    if (day === 12 && rand() < 0.3) await spend(d, everyday, 'Doctor', between(4000, 9000), 'MEDICAL CENTRE');
  }
  // One proper holiday from the Smile account, about four months ago.
  const holiday = addMonthsClamped(today, -4);
  await spend(holiday, smile, 'Holidays', 142000, 'QANTAS AIRWAYS');
  await spend(addDays(holiday, 1), smile, 'Holidays', 86000, 'BEACHSIDE APARTMENTS');

  // The card is paid off each month on the 15th.
  for (const [ym, total] of [...visaByMonth.entries()].sort()) {
    const due = addMonthsClamped(`${ym}-15`, 1);
    if (compareDates(due, today) > 0) continue;
    await api.post('/transactions', { type: 'TRANSFER', date: due, accountId: everyday, toAccountId: visa, amountCents: total, description: 'Visa payment', cleared: true });
    count++;
  }

  // ── Budget ────────────────────────────────────────────────────────────────
  const budget = (await api.get<{ items: { id: string }[] }>('/budgets')).items[0]!;
  const plan: [string, number, string][] = [
    ['Mortgage', 310000, 'MONTHLY'],
    ['Loan repayments', 52000, 'MONTHLY'],
    ['Electricity', 42000, 'QUARTERLY'],
    ['Water', 26000, 'QUARTERLY'],
    ['Council rates', 48000, 'QUARTERLY'],
    ['Internet', 7900, 'MONTHLY'],
    ['Mobile phone', 9000, 'MONTHLY'],
    ['Private health insurance', 21400, 'MONTHLY'],
    ['Car insurance', 9500, 'MONTHLY'],
    ['Streaming services', 1899, 'MONTHLY'],
    ['Music', 1399, 'MONTHLY'],
    ['Groceries', 23000, 'WEEKLY'],
    ['Fuel', 16000, 'MONTHLY'],
    ['Household supplies', 6000, 'MONTHLY'],
    ['Pharmacy', 4000, 'MONTHLY'],
    ['Doctor', 3000, 'MONTHLY'],
    ['Dining out', 22000, 'MONTHLY'],
    ['Takeaway', 14000, 'MONTHLY'],
    ['Entertainment', 8000, 'MONTHLY'],
    ['Christmas', 90000, 'ANNUALLY'],
    ['Holidays', 300000, 'ANNUALLY'],
    ['Coffee', 2500, 'WEEKLY'],
    ['Clothing', 10000, 'MONTHLY'],
    ['Emergency fund', 35000, 'FORTNIGHTLY'],
  ];
  for (const [name, amountCents, enteredFrequency] of plan) {
    await api.put(`/budgets/${budget.id}/items/${cat(name)}`, { amountCents, enteredFrequency });
  }

  // ── Sinking funds, goals, debts, assets, rules ────────────────────────────
  const fund = async (body: Json, monthly: number, months: number) => {
    const f = await api.post<{ id: string }>('/sinking-funds', { contributionFrequency: 'MONTHLY', accountId: billsSaver, ...body });
    for (let i = months; i >= 1; i--) {
      const date = addMonthsClamped(today, -i);
      if (compareDates(date, start) < 0) continue;
      await api.post(`/sinking-funds/${f.id}/contributions`, { amountCents: monthly, date, fromAccountId: everyday });
      count++;
    }
  };
  await fund({ name: 'Car rego', recurringId: rego, categoryId: cat('Car registration (rego)') }, 7500, 7);
  const { year: y } = parseDateOnly(today);
  const christmas = compareDates(today, `${y}-12-20`) < 0 ? `${y}-12-20` : `${y + 1}-12-20`;
  await fund({ name: 'Christmas', targetCents: 120000, dueDate: christmas, categoryId: cat('Christmas'), repeats: true }, 10000, 8);
  await fund({ name: 'Japan trip', targetCents: 600000, dueDate: addMonthsClamped(today, 9), categoryId: cat('Holidays') }, 25000, 5);

  await api.post('/goals', { name: 'Emergency fund', type: 'EMERGENCY_FUND', targetCents: 1_500_000, targetDate: addMonthsClamped(today, 18), accountId: emergency });
  await api.post('/goals', { name: 'ETF portfolio', type: 'INVESTMENT', targetCents: 2_500_000, targetDate: addMonthsClamped(today, 36), manualCurrentCents: 840_000, contributionCents: 50_000, contributionFrequency: 'MONTHLY' });

  await api.post('/debts', { accountId: visa, annualRate: '20.99', minRepaymentCents: 15000, repaymentFrequency: 'MONTHLY', dueDay: 15, categoryId: cat('Interest and fees') });
  await api.post('/debts', { accountId: carLoan, originalBalanceCents: 2_600_000, annualRate: '8.49', minRepaymentCents: 52000, repaymentFrequency: 'MONTHLY', dueDay: 10, startDate: addMonthsClamped(start, -14), categoryId: cat('Loan repayments') });
  await api.post('/debts', { accountId: mortgage, originalBalanceCents: 56_000_000, annualRate: '6.19', minRepaymentCents: 310000, repaymentFrequency: 'MONTHLY', dueDay: 1, startDate: addMonthsClamped(start, -30), categoryId: cat('Mortgage') });
  // HECS-HELP: indexed each 1 June, repaid through the employer's tax withholding.
  await api.post('/debts', { accountId: hecs, annualRate: '3.2', minRepaymentCents: 14000, repaymentFrequency: 'FORTNIGHTLY', indexationOnly: true, includeInPayoff: false });

  const home = await api.post<{ id: string }>('/assets', { name: 'Home', type: 'PROPERTY', valueCents: 84_500_000, valuedOn: start });
  const car = await api.post<{ id: string }>('/assets', { name: 'Car', type: 'VEHICLE', valueCents: 2_600_000, valuedOn: start });
  for (let q = 1; q <= 4; q++) {
    const date = addMonthsClamped(start, q * 3);
    if (compareDates(date, today) > 0) break;
    await api.post(`/assets/${home.id}/valuations`, { date, valueCents: 84_500_000 + q * 700_000 });
    await api.post(`/assets/${car.id}/valuations`, { date, valueCents: 2_600_000 - q * 90_000 });
  }

  for (const [matchValue, category] of [['WOOLWORTHS', 'Groceries'], ['COLES', 'Groceries'], ['ALDI', 'Groceries'], ['AMPOL', 'Fuel'], ['BP CONNECT', 'Fuel'], ['UBER *EATS', 'Takeaway'], ['CHEMIST WAREHOUSE', 'Pharmacy']] as const) {
    await api.post('/rules', { matchValue, setCategoryId: cat(category) });
  }

  app.log.info({ userId: user.id, transactions: count }, 'demo household created');
  return { email, password, householdId: settings.id, transactions: count, userId: user.id };
}
