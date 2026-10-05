# Home Budget

A self-hosted household budget app built on the Barefoot Investor bucket method: Bills, Smile, Splurge and Fire Extinguisher. It runs on your own server with `docker compose up -d` and keeps everything in PostgreSQL.

> **Build status: Phase 5 of 6.** The final hardening pass (security review, accessibility, performance, demo data) remains. See [Roadmap](#roadmap).

## What works now

- **Accounts:** everyday, savings, offset, cash, investment, super, cards and loans. Balances are always worked out from the opening balance plus transactions, never typed in. There's a balance history chart and a one-step "reconcile to statement".
- **Transactions:** income, expenses (split across categories if you like), refunds, transfers, debt repayments, savings contributions, balance adjustments and interest charges. Search, filter, sort, paginate, bulk recategorise and bulk delete.
- **The money rules from the spec:**
  - Transfers and card repayments never count as spending.
  - Loan repayments split automatically into the minimum (Bills) and any extra (Fire Extinguisher).
  - Refunds reduce their category.
  - Card interest is an *Interest and fees* expense.
- **Buckets and categories:** seeded with the Australian defaults. You can rename, reorder, move, disable or delete categories (deleting one with history reassigns it). Bucket percentages must total exactly 100%.
- **Security:**
  - Argon2id passwords and server-side sessions in HTTP-only cookies, revocable instantly.
  - CSRF tokens, Origin checks, per-IP and per-email rate limits with backoff.
  - A registration switch, strict security headers, and full household isolation.
- **Dashboard:** one view of the current budget period, stepping back or forward through periods. It shows:
  - expected income (weekly, fortnightly, monthly and annual) and income received;
  - a card per bucket with allocated, spent and remaining, plus a progress bar that turns amber and red;
  - Fire Extinguisher contributions and debt principal reduced;
  - bills due in the next 14 days, which you can mark paid straight from the dashboard;
  - a watch list of near-limit and overspent categories;
  - net worth with a 12-month sparkline;
  - the uncategorised count.
- **Budget:**
  - Plan each category in whatever frequency suits it ($900 a year for rego, $200 a week for groceries). It's converted to the budget period.
  - Budget vs actual rolls up by group, bucket and total, and spending with no budget line is flagged.
  - Buckets show "over-allocated by $X" when their plans exceed the allocation.
  - Keep several budgets, copy one, and choose which is active.
- **Recurring schedules:**
  - Pay, bills, repayments, transfers and savings that repeat. They project occurrences but never create future transactions.
  - Mark paid (pre-filled and editable), skip, edit one occurrence, or edit the series from a date onward.
  - Auto-post records an occurrence on its day, from 02:00 household time.
  - Monthly dates keep their day and clamp at month end. Weekend dates can move to the Friday before or the Monday after.
- **Sinking funds:**
  - Save for irregular bills. Each fund recommends how much to put aside each pay, counted from the actual dates left and rounded up so you reach the target.
  - Link a recurring bill and the target and due date follow it, rolling forward after each payment.
  - Contributions are the fund's budget line. A bill marked "paid from sinking fund" stays in the category's history but doesn't show as overspending.
- **Fire Extinguisher goals:** emergency fund, savings and investment goals, in priority order. Each shows progress, the contribution needed to hit its date, and a projected completion date. Investment and super accounts are listed alongside.
- **Debts:**
  - A profile on each card or loan account, with interest charged daily.
  - Offset accounts are included.
  - You're warned when a repayment doesn't cover the interest.
  - Minimum-only and with-extra projections are compared, with time and interest saved, a chart and the full repayment schedule.
  - A snowball or avalanche payoff plan rolls each cleared debt's repayment into the next.
  - HECS/HELP is indexed yearly and left out of the payoff plan by default.
  - All results are labelled as estimates.
- **CSV import:**
  - Upload a bank export of up to 5 MB.
  - The column layout is detected, including files with no header, signed amounts or separate debit and credit columns, and several date formats. Each account remembers its layout.
  - Every row is checked before anything is saved:
    - duplicates are skipped, so importing the same file twice adds nothing;
    - rows matching a scheduled bill within ±3 days are recorded as that occurrence (fixed amounts exactly, estimates within ±20%);
    - rows matching something you entered yourself are linked to it rather than added again;
    - categorisation rules fill in categories and transfers.
  - You approve, change or skip each row. With a balance column, the import checks you'll match the statement.
  - Every import can be undone in one step.
- **Rules:**
  - "Description contains WOOLWORTHS → Groceries", with optional amount, account and money-in or money-out conditions. Plain text only, never regex.
  - Rules run in order and can be tested against recent transactions or applied to uncategorised ones.
  - When you categorise an imported transaction, the app offers to make a rule.
- **Bills:** every Bills-bucket schedule, with its next due date, fixed or estimate, and what's been paid this period.
- **Reports:** every report has a chart, a table view and a CSV download. Date presets cover this month, last month, financial year to date, last financial year, last 12 months and custom ranges.
  - **Spending:** by bucket (donut), by category (top 15 + Other) and by month. Net of refunds, with bucket, category and account filters.
  - **Income vs expenses:** monthly, with the savings rate.
  - **Budget vs actual:** for any period, by category or by bucket.
  - **Debt reduction:** each debt's actual balance, then its projected payoff.
  - **Forecast:** for 1–12 months — per category, per bucket, income, and every account's month-end balance.
- **Net worth:** account balances plus dated valuations for property, vehicles and anything else you own, less what you owe. It comes with a breakdown table and a history chart that is recomputed from transactions. A snapshot is also stored on the 1st of each month.
- **Calendar:** pay, bills, repayments and transfers, sinking fund due dates and goal targets. Recorded and upcoming items look different. On desktop it's a month grid; on mobile, an agenda list. Tap a day to mark items paid or skip them.
- **Getting started:**
  - On first login a welcome screen explains the buckets.
  - A dashboard checklist (accounts, pay, bills, budget, transactions, savings) ticks itself off from your data.
  - Each main page has a short tip until you dismiss it. Dismissals are saved per user; Settings → Appearance → *Show help tips again* brings them back.
- **Notifications:**
  - The bell at the top of every page shows bills due soon that aren't recorded yet, categories at the amber threshold or over budget, sinking funds due soon that aren't fully saved, the start of each budget period, and (if turned on) goal milestones at 25/50/75/100%.
  - Alerts are checked whenever you open the app and hourly in the background, and each one appears only once.
  - Settings → Notifications turns each type on or off and sets how many days ahead to warn. With SMTP configured, each type can also be emailed to every household member.
- **Your data:**
  - Settings → Data downloads everything as one JSON file, or any list (transactions, accounts, categories, budgets, schedules, funds, goals, debts, valuations, rules) as CSV. Transactions export one row per category split. Exports never include passwords or sessions.
  - The household owner can delete the household and everything in it after typing its name and their password. Members with no other household lose their login.
- **Settings:** budget period, display frequency, thresholds, currency, locale, time zone, financial year, theme (light, dark or system).

## Quick start (Ubuntu server)

You need Docker Engine with the Compose plugin.

```bash
git clone <repository> /opt/home-budget
cd /opt/home-budget
cp .env.example .env
openssl rand -hex 32   # paste into SESSION_SECRET
openssl rand -hex 24   # paste into POSTGRES_PASSWORD
nano .env              # set PUBLIC_URL to the address you'll use
docker compose up -d
```

Point your reverse proxy at port 8080 and open your `PUBLIC_URL`. The first person to register becomes the household owner, and registration then closes.

See [docs/deployment.md](docs/deployment.md) for reverse proxy setup (Nginx Proxy Manager, Traefik, Cloudflare Tunnel) and plain-HTTP LAN testing.

## Everyday commands

```bash
docker compose up -d                       # start
docker compose down                        # stop (data is kept)
docker compose logs -f                     # follow logs
docker compose restart                     # restart everything
git pull && docker compose up -d --build   # update; migrations run on start
./scripts/backup.sh                        # back up the database
./scripts/restore.sh backups/<file>.dump   # restore a backup
docker compose exec backend npm run reset-password -- you@example.com
```

> ⚠️ **`docker compose down -v` deletes the database volume and every record in it.** Never add `-v` unless you mean to wipe everything. Take a backup first.

- `docker compose pull` only refreshes the PostgreSQL image. The app images are built locally, so update with `git pull && docker compose up -d --build`.
- Major PostgreSQL version upgrades (16 → 17) need a dump and restore. See [docs/backup-restore.md](docs/backup-restore.md).

## Forgotten passwords

With SMTP configured in `.env`, "Forgot password" emails a single-use link that is valid for 30 minutes. Without SMTP, whoever runs the server resets it from the command line:

```bash
docker compose exec backend npm run reset-password -- you@example.com
```

That prints a temporary password and signs the user out everywhere. Change it afterwards in **Settings → Security**.

## Backups

```bash
./scripts/backup.sh
```

This writes `backups/budget-YYYYMMDD-HHMMSS.dump` (readable by your user only), keeps the newest `BACKUP_RETENTION` files, and exits non-zero on failure so cron can alert you. Run it nightly:

```cron
0 2 * * * cd /opt/home-budget && ./scripts/backup.sh
```

Copy backups off the server as well. A backup on the same disk won't survive the disk failing. The in-app export (Settings → Data) is useful for spreadsheets but doesn't replace these backups. Restore and test-restore steps are in [docs/backup-restore.md](docs/backup-restore.md).

## Development

You'll need Node 24 and a PostgreSQL 16 database. The backend reads `backend/.env`:

```env
DATABASE_URL=postgresql://budget:budget@localhost:5432/budget_dev
PUBLIC_URL=http://localhost:5173
SESSION_SECRET=<at least 32 random characters>
NODE_ENV=development
ALLOW_REGISTRATION=true
```

```bash
cd backend && npm ci && npx prisma migrate deploy && npm run dev   # API on :3000
cd frontend && npm ci && npm run dev                               # UI on :5173, proxies /api
```

The API docs (OpenAPI) are at `/api/docs` once you're logged in.

### Tests

```bash
cd backend
npm test                 # unit + API tests; API tests start PostgreSQL with Testcontainers (needs Docker)
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/budget_test npm test   # or use an existing empty database
TZ=Australia/Melbourne npm run test:finance   # finance tests under another time zone
npm run test:coverage    # finance module must stay at 100% line coverage, backend ≥ 70%

cd frontend && npm test  # component tests
cd e2e && npx playwright test   # smoke test against the Compose stack on :8080 (ALLOW_REGISTRATION=true)
```

## Project layout

```
backend/   Fastify API, Prisma schema and migrations, finance module (src/finance), jobs, CLI
frontend/  React + Vite UI, served by nginx, which also proxies /api
e2e/       Playwright smoke tests
scripts/   backup.sh, restore.sh
docs/      deployment, backup and restore, data model
```

## Roadmap

1. **Foundation** ✅ Docker Compose, schema, auth and security, buckets and categories, accounts, transactions, finance core.
2. **Budget and recurring** ✅ budgets and budget vs actual, dashboard, recurring schedules (post, skip, auto-post), Bills page.
3. **Fire Extinguisher** ✅ sinking funds, goals, debts with payoff simulation, offsets, extra repayments, payoff order, investments.
4. **Insight** ✅ reports, forecast, net worth with valuations and snapshots, calendar.
5. **Automation** ✅ CSV import and categorisation rules, notifications (in-app and email), data export (JSON and CSV), household deletion.
6. **Hardening and docs:** OWASP review, accessibility pass, 50,000-transaction performance check, demo data.

Out of scope for v1: bank feeds, multi-currency, public holiday calendars, native apps, live investment prices, and hosting under a subpath.
