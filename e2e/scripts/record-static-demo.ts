/**
 * Records the snapshot behind the website's read-only demo.
 *
 * Run it against an app started with DEMO_MODE=true (nothing else needs changing):
 *   cd e2e && E2E_BASE_URL=http://localhost:8080 node scripts/record-static-demo.ts ../frontend/static-demo-fixtures.json
 *
 * It opens a fresh demo household, visits every page, steps through periods,
 * months, tabs, report ranges and filters, and saves every GET response the app
 * made, plus a few sweeps the clicks don't reach. Only reads are allowed through,
 * so the household stays exactly as seeded. Then build the demo with
 *   cd frontend && STATIC_DEMO_FIXTURES=static-demo-fixtures.json npm run build:static-demo
 */
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const OUT = process.argv[2] ?? 'static-demo-fixtures.json';
const SOURCE_URL = process.env.SOURCE_URL ?? 'https://github.com/brendanlib/bucketnest';
/** How far either side of today the period, month and range steppers are recorded. */
const STEPS = 6;
/** Debt "extra repayment" amounts recorded; others use the nearest. */
const EXTRAS = [0, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000, 100000, 200000];

/** Must match fixtureKey() in frontend/src/static-demo/fake-api.ts. */
function fixtureKey(path: string, search: URLSearchParams | string = ''): string {
  const params = [...new URLSearchParams(search).entries()].sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  const qs = new URLSearchParams(params).toString();
  return qs ? `${path}?${qs}` : path;
}

const responses: Record<string, unknown> = {};
const pending = new Set<Promise<unknown>>();
const SKIP = /^\/(transactions|auth\/csrf|export)(\?|$)/;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-AU' });
const page = await context.newPage();

// Reads only: anything that would change the household is refused before it leaves the browser.
await page.route('**/api/**', (route) => {
  const r = route.request();
  return r.method() === 'GET' || new URL(r.url()).pathname === '/api/demo/start' ? route.continue() : route.abort();
});
page.on('response', (res) => {
  const url = new URL(res.url());
  if (res.request().method() !== 'GET' || res.status() !== 200 || !url.pathname.startsWith('/api/')) return;
  const path = url.pathname.slice(4);
  if (SKIP.test(path) || !(res.headers()['content-type'] ?? '').includes('application/json')) return;
  const p = res
    .json()
    .then((body) => void (responses[fixtureKey(path, url.search)] = body))
    .catch(() => undefined)
    .finally(() => pending.delete(p));
  pending.add(p);
});

async function settle() {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await Promise.all(pending);
}

/** A GET straight to the API with the visitor's session, saved like the app's own requests. */
async function api<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T | null> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const res = await page.request.get(`${BASE}/api${path}${qs.size ? `?${qs}` : ''}`);
  if (!res.ok()) {
    console.warn(`  (skipped ${path}${qs.size ? `?${qs}` : ''}: ${res.status()} ${(await res.text()).slice(0, 160)})`);
    return null;
  }
  const body = (await res.json()) as T;
  if (!SKIP.test(path)) responses[fixtureKey(path, qs)] = body;
  return body;
}

/** Every view control on screen: segmented buttons, then each option of each select outside a form. */
async function exploreControls() {
  for (const b of await page.locator('main [role="group"].segmented button').all()) {
    if (!(await b.isVisible()) || !(await b.isEnabled())) continue;
    await b.click();
    await settle();
  }
  for (const select of await page.locator('main select').all()) {
    if (!(await select.isVisible()) || (await select.evaluate((el) => !!el.closest('form, [role="dialog"]')))) continue;
    const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const original = await select.inputValue();
    for (const v of values) {
      await select.selectOption(v);
      await settle();
    }
    await select.selectOption(original);
    await settle();
  }
}

/** Previous/next period or month, STEPS each way from today. */
async function stepThrough(path: string) {
  for (const dir of ['Previous', 'Next']) {
    await page.goto(BASE + path);
    await settle();
    for (let i = 0; i < STEPS; i++) {
      const btn = page.getByRole('button', { name: new RegExp(`^${dir} (period|month)$`) }).first();
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click();
      await settle();
    }
  }
}

async function visit(path: string) {
  await page.goto(BASE + path);
  await settle();
  const tabs = await page.locator('main [role="tab"]').all();
  if (!tabs.length) return exploreControls();
  for (const tab of tabs) {
    if (!(await tab.isVisible())) continue;
    await tab.click();
    await settle();
    await exploreControls();
  }
}

/** Every period from STEPS back to STEPS ahead, following the server's own previous/next links. */
async function periodsFrom(fetchPeriod: (period?: string) => Promise<{ period: { start: string; previousStart: string; nextStart: string } } | null>) {
  const current = await fetchPeriod();
  if (!current) return [];
  const starts = [current.period.start];
  for (const dir of ['previousStart', 'nextStart'] as const) {
    let p = current.period;
    for (let i = 0; i < STEPS; i++) {
      const next = await fetchPeriod(p[dir]);
      if (!next) break;
      starts.push(p[dir]);
      p = next.period;
    }
  }
  return starts;
}

/* ── Record ─────────────────────────────────────── */

await page.goto(`${BASE}/demo`);
await page.waitForURL('**/dashboard', { timeout: 60_000 });
await settle();

type Me = { user: { email: string }; household: { timezone: string } };
const me = (await api<Me>('/auth/me'))!;
const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const tz = me.household.timezone;
const today = todayIn(tz);
console.log(`Recording the demo household for ${today} (${tz})…`);

for (const path of ['/dashboard', '/budget', '/bills', '/recurring', '/import', '/rules', '/sinking-funds', '/fire-extinguisher', '/debts', '/reports', '/net-worth', '/calendar', '/transactions', '/accounts', '/categories', '/settings']) {
  await visit(path);
  console.log(`  ${path}`);
}
for (const path of ['/dashboard', '/budget', '/bills', '/calendar']) await stepThrough(path);

type Item = { id: string };
const accounts = (await api<{ items: Item[] }>('/accounts', { includeClosed: true }))?.items ?? [];
for (const a of accounts) await visit(`/accounts/${a.id}`);
const debts = (await api<{ items: (Item & { extraRepaymentCents?: number })[] }>('/debts'))?.items ?? [];
for (const d of debts) {
  await visit(`/debts/${d.id}`);
  for (const extraCents of EXTRAS) await api(`/debts/${d.id}/payoff`, { extraCents });
}
for (const strategy of ['SNOWBALL', 'AVALANCHE']) {
  await api('/debts/plan', { strategy });
  for (const extraMonthlyCents of EXTRAS) await api('/debts/plan', { strategy, extraMonthlyCents });
}
for (const f of (await api<{ items: Item[] }>('/sinking-funds'))?.items ?? []) await api(`/sinking-funds/${f.id}`);

// Dashboard and bills for every period, each allocation basis.
type WithPeriod = { period: { start: string; end: string; previousStart: string; nextStart: string } };
const dashboardPeriods = await periodsFrom((period) => api<WithPeriod>('/dashboard', { period }));
for (const period of [undefined, ...dashboardPeriods]) {
  for (const basis of ['PLANNED', 'ACTUAL']) await api('/dashboard', { period, basis });
  const d = await api<WithPeriod>('/dashboard', { period });
  if (d) await api('/recurring-transactions/occurrences', { from: d.period.start, to: d.period.end });
}
// Each budget, every period, with and without empty lines.
for (const b of (await api<{ items: Item[] }>('/budgets'))?.items ?? []) {
  const periods = await periodsFrom((period) => api<WithPeriod>(`/budgets/${b.id}/summary`, { period, includeEmpty: false }));
  for (const period of [undefined, ...periods]) for (const includeEmpty of [false, true]) await api(`/budgets/${b.id}/summary`, { period, includeEmpty });
}

// Every transaction, for the in-browser list.
const transactions: Item[] = [];
for (let p = 1; ; p++) {
  const page_ = await api<{ items: Item[]; total: number }>('/transactions', { page: p, pageSize: 200, sort: 'date', order: 'desc' });
  if (!page_) throw new Error('Could not list transactions');
  transactions.push(...page_.items);
  if (transactions.length >= page_.total || !page_.items.length) break;
}
await settle();

if (todayIn(tz) !== today) throw new Error(`The date in ${tz} changed while recording. Run it again.`);

/* ── Tidy and save ──────────────────────────────── */

// The demo is reached from the website, and has no sign-up.
responses['/auth/registration'] = { open: false, passwordReset: 'cli', demo: true, sourceUrl: SOURCE_URL, websiteUrl: '/' };
// Nothing about the machine that recorded it.
const sessions = responses['/auth/sessions'] as { items: { userAgent: string | null }[] } | undefined;
for (const s of sessions?.items ?? []) s.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

/** 20:00 on the recorded day in the household's timezone, so visitors have hours before "today" moves on. */
function eveningOf(day: string, timeZone: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  let t = Date.UTC(y, m - 1, d, 20);
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(t).map((p) => [p.type, p.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    t -= shown - Date.UTC(y, m - 1, d, 20);
  }
  return new Date(t).toISOString();
}

const fixtures = { version: 1, recordedAt: eveningOf(today, tz), responses, transactions };
// The sandbox's random address, everywhere it appears.
const json = JSON.stringify(fixtures).replaceAll(me.user.email, 'visitor@demo.bucketnest.invalid');
writeFileSync(OUT, json);
console.log(`Saved ${Object.keys(responses).length} responses and ${transactions.length} transactions to ${OUT} (${Math.round(json.length / 1024)} KB).`);
await browser.close();
