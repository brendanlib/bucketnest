import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { DateOnly, Id, IdParams, Name, NonNegativeCents, OptionalText } from '../lib/schemas.js';
import { centsToDecimal, toCsv, type CsvColumn } from '../lib/csv.js';

const Range = { from: DateOnly, to: DateOnly };
const Filters = { accountId: Id.optional(), bucketId: Id.optional(), categoryId: Id.optional() };
const Format = { format: z.enum(['json', 'csv']).default('json') };
const money = (c: number) => centsToDecimal(c);

/** Sends a CSV download, bypassing the JSON serializer. */
function sendCsv<T>(reply: FastifyReply, name: string, rows: T[], columns: CsvColumn<T>[]) {
  return reply
    .type('text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}.csv"`)
    .serializer((x: unknown) => x as string)
    .send(toCsv(rows, columns));
}

const Csv = z.string().describe('CSV text when format=csv');
const Variance = { budgetCents: z.number().int(), actualCents: z.number().int(), remainingCents: z.number().int(), percentUsed: z.number().nullable(), status: z.string() };

const AssetBody = z.strictObject({
  name: Name,
  type: z.enum(['PROPERTY', 'VEHICLE', 'OTHER']),
  includeInNetWorth: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: OptionalText(2000),
  valueCents: NonNegativeCents.optional(),
  valuedOn: DateOnly.optional(),
});
const Asset = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['PROPERTY', 'VEHICLE', 'OTHER']),
  includeInNetWorth: z.boolean(),
  isActive: z.boolean(),
  notes: z.string().nullable(),
  valueCents: z.number().int(),
  valuedOn: z.string().nullable(),
  valuations: z.array(z.object({ id: z.string(), date: z.string(), valueCents: z.number().int(), notes: z.string().nullable() })),
});
const Breakdown = z.object({
  date: z.string(),
  assetsCents: z.number().int(),
  liabilitiesCents: z.number().int(),
  netWorthCents: z.number().int(),
  groups: z.array(
    z.object({
      group: z.string(),
      label: z.string(),
      side: z.string(),
      totalCents: z.number().int(),
      items: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['account', 'asset']), cents: z.number().int(), valuedOn: z.string().nullable() })),
    }),
  ),
});

export const reportRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    // ─── Assets ──────────────────────────────────────────────────────────────
    app.get('/assets', { schema: { tags: ['net worth'], response: { 200: z.object({ items: z.array(Asset) }) } } }, async (request) => ({
      items: await services.netWorth.listAssets(authOf(request).householdId),
    }));
    app.post('/assets', { schema: { tags: ['net worth'], description: 'Property, vehicles and other assets not held in accounts.', body: AssetBody, response: { 201: Asset } } }, async (request, reply) => {
      reply.status(201);
      return services.netWorth.createAsset(authOf(request).householdId, request.body);
    });
    app.put('/assets/:id', { schema: { tags: ['net worth'], params: IdParams, body: AssetBody, response: { 200: Asset } } }, async (request) =>
      services.netWorth.updateAsset(authOf(request).householdId, request.params.id, request.body),
    );
    app.delete('/assets/:id', { schema: { tags: ['net worth'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.netWorth.deleteAsset(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });
    app.post(
      '/assets/:id/valuations',
      { schema: { tags: ['net worth'], params: IdParams, body: z.strictObject({ date: DateOnly, valueCents: NonNegativeCents, notes: OptionalText(500) }), response: { 201: Asset } } },
      async (request, reply) => {
        reply.status(201);
        return services.netWorth.addValuation(authOf(request).householdId, request.params.id, request.body);
      },
    );
    app.delete(
      '/assets/:id/valuations/:valuationId',
      { schema: { tags: ['net worth'], params: z.strictObject({ id: Id, valuationId: Id }), response: { 200: Asset } } },
      async (request) => services.netWorth.deleteValuation(authOf(request).householdId, request.params.id, request.params.valuationId),
    );

    // ─── Reports ─────────────────────────────────────────────────────────────
    app.get(
      '/reports/spending',
      {
        schema: {
          tags: ['reports'],
          description: 'Spending by bucket, by category (top 15 + Other) and by month. Net of refunds.',
          querystring: z.strictObject({ ...Range, ...Filters, ...Format, view: z.enum(['bucket', 'category', 'month']).default('category') }),
          response: {
            200: z.union([
              z.object({
                from: z.string(),
                to: z.string(),
                totalCents: z.number().int(),
                byBucket: z.array(z.object({ bucketId: z.string(), key: z.string(), name: z.string(), colour: z.string(), isSaving: z.boolean(), amountCents: z.number().int() })),
                byCategory: z.array(z.object({ categoryId: z.string().nullable(), name: z.string(), bucketKey: z.string().nullable(), amountCents: z.number().int() })),
                monthly: z.array(z.object({ month: z.string(), totalCents: z.number().int(), byBucket: z.record(z.string(), z.number().int()) })),
              }),
              Csv,
            ]),
          },
        },
      },
      async (request, reply) => {
        const r = await services.reports.spending(authOf(request).householdId, request.query);
        if (request.query.format === 'csv') {
          if (request.query.view === 'bucket') return sendCsv(reply, 'spending-by-bucket', r.byBucket, [{ label: 'Bucket', value: (x) => x.name }, { label: 'Amount', value: (x) => money(x.amountCents) }]);
          if (request.query.view === 'month') {
            const keys = r.byBucket.map((b) => b.key);
            return sendCsv(reply, 'monthly-spending', r.monthly, [
              { label: 'Month', value: (x) => x.month },
              { label: 'Spending', value: (x) => money(x.totalCents) },
              ...keys.map((k) => ({ label: r.byBucket.find((b) => b.key === k)!.name, value: (x: (typeof r.monthly)[number]) => money(x.byBucket[k] ?? 0) })),
            ]);
          }
          return sendCsv(reply, 'spending-by-category', r.byCategory, [{ label: 'Category', value: (x) => x.name }, { label: 'Amount', value: (x) => money(x.amountCents) }]);
        }
        return r;
      },
    );

    app.get(
      '/reports/income-vs-expenses',
      {
        schema: {
          tags: ['reports'],
          description: 'Monthly income, spending, Fire Extinguisher saving, net and savings rate = (income − spending) ÷ income.',
          querystring: z.strictObject({ ...Range, accountId: Id.optional(), ...Format }),
          response: {
            200: z.union([
              z.object({
                from: z.string(),
                to: z.string(),
                monthly: z.array(z.object({ month: z.string(), incomeCents: z.number().int(), spendingCents: z.number().int(), savedCents: z.number().int(), netCents: z.number().int(), savingsRate: z.number().nullable() })),
                totals: z.object({ incomeCents: z.number().int(), spendingCents: z.number().int(), savedCents: z.number().int(), netCents: z.number().int(), savingsRate: z.number().nullable() }),
              }),
              Csv,
            ]),
          },
        },
      },
      async (request, reply) => {
        const r = await services.reports.incomeVsExpenses(authOf(request).householdId, request.query);
        if (request.query.format === 'csv') {
          return sendCsv(reply, 'income-vs-expenses', r.monthly, [
            { label: 'Month', value: (x) => x.month },
            { label: 'Income', value: (x) => money(x.incomeCents) },
            { label: 'Spending', value: (x) => money(x.spendingCents) },
            { label: 'Saved (Fire Extinguisher)', value: (x) => money(x.savedCents) },
            { label: 'Net', value: (x) => money(x.netCents) },
            { label: 'Savings rate %', value: (x) => (x.savingsRate === null ? '' : x.savingsRate.toFixed(2)) },
          ]);
        }
        return r;
      },
    );

    app.get(
      '/reports/budget-vs-actual',
      {
        schema: {
          tags: ['reports'],
          querystring: z.strictObject({ period: DateOnly.optional(), groupBy: z.enum(['category', 'bucket']).default('category'), budgetId: Id.optional(), ...Format }),
          response: {
            200: z.union([
              z.object({
                period: z.object({ start: z.string(), end: z.string(), previousStart: z.string(), nextStart: z.string(), isCurrent: z.boolean(), today: z.string() }),
                groupBy: z.enum(['category', 'bucket']),
                rows: z.array(z.object({ id: z.string(), name: z.string(), bucketKey: z.string(), ...Variance })),
                total: z.object(Variance),
              }),
              Csv,
            ]),
          },
        },
      },
      async (request, reply) => {
        const r = await services.reports.budgetVsActual(authOf(request).householdId, request.query);
        if (request.query.format === 'csv') {
          return sendCsv(reply, `budget-vs-actual-${r.period.start}`, r.rows, [
            { label: request.query.groupBy === 'bucket' ? 'Bucket' : 'Category', value: (x) => x.name },
            { label: 'Budget', value: (x) => money(x.budgetCents) },
            { label: 'Actual', value: (x) => money(x.actualCents) },
            { label: 'Remaining', value: (x) => money(x.remainingCents) },
            { label: '% used', value: (x) => (x.percentUsed === null ? '' : x.percentUsed.toFixed(2)) },
          ]);
        }
        return r;
      },
    );

    app.get(
      '/reports/net-worth',
      {
        schema: {
          tags: ['reports'],
          description: 'Month-end assets, liabilities and net worth, recomputed from transactions and valuations; plus the breakdown at the end date and stored snapshots.',
          querystring: z.strictObject({ ...Range, ...Format }),
          response: {
            200: z.union([
              z.object({
                from: z.string(),
                to: z.string(),
                series: z.array(z.object({ date: z.string(), assetsCents: z.number().int(), liabilitiesCents: z.number().int(), netWorthCents: z.number().int() })),
                breakdown: Breakdown,
                snapshots: z.array(z.object({ date: z.string(), assetsCents: z.number().int(), liabilitiesCents: z.number().int(), netWorthCents: z.number().int() })),
              }),
              Csv,
            ]),
          },
        },
      },
      async (request, reply) => {
        const r = await services.reports.netWorth(authOf(request).householdId, request.query);
        if (request.query.format === 'csv') {
          return sendCsv(reply, 'net-worth', r.series, [
            { label: 'Date', value: (x) => x.date },
            { label: 'Assets', value: (x) => money(x.assetsCents) },
            { label: 'Liabilities', value: (x) => money(x.liabilitiesCents) },
            { label: 'Net worth', value: (x) => money(x.netWorthCents) },
          ]);
        }
        return r;
      },
    );

    app.get(
      '/reports/debt-reduction',
      {
        schema: {
          tags: ['reports'],
          description: 'Each debt’s actual month-end balance, then its projected payoff (an estimate).',
          querystring: z.strictObject({ months: z.coerce.number().int().min(1).max(120).default(12), ...Format }),
          response: {
            200: z.union([
              z.object({
                items: z.array(
                  z.object({
                    debtId: z.string(),
                    name: z.string(),
                    history: z.array(z.object({ date: z.string(), balanceCents: z.number().int() })),
                    projection: z.array(z.object({ date: z.string(), balanceCents: z.number().int() })),
                    payoffDate: z.string().nullable(),
                    warning: z.string().nullable(),
                  }),
                ),
              }),
              Csv,
            ]),
          },
        },
      },
      async (request, reply) => {
        const items = await services.reports.debtReduction(authOf(request).householdId, request.query);
        if (request.query.format === 'csv') {
          const rows = items.flatMap((d) => [...d.history.map((h) => ({ debt: d.name, date: h.date, kind: 'actual', cents: h.balanceCents })), ...d.projection.slice(1).map((p) => ({ debt: d.name, date: p.date, kind: 'projected', cents: p.balanceCents }))]);
          return sendCsv(reply, 'debt-reduction', rows, [
            { label: 'Debt', value: (x) => x.debt },
            { label: 'Date', value: (x) => x.date },
            { label: 'Actual or projected', value: (x) => x.kind },
            { label: 'Balance', value: (x) => money(x.cents) },
          ]);
        }
        return { items };
      },
    );

    app.get(
      '/reports/forecast',
      {
        schema: {
          tags: ['reports'],
          description: 'The next 1–12 months: per category (scheduled + average of unscheduled, completed months only), per bucket, total, income and account month-end balances. Estimates.',
          querystring: z.strictObject({ months: z.coerce.number().int().min(1).max(12).default(6), method: z.enum(['AVG3', 'AVG6', 'AVG12']).optional(), ...Format }),
          response: {
            200: z.union([
              z.object({
                method: z.string(),
                months: z.array(z.string()),
                historyMonths: z.number().int(),
                limitedHistory: z.boolean(),
                categories: z.array(z.object({ categoryId: z.string(), name: z.string(), bucketId: z.string(), method: z.string(), baseCents: z.number().int(), months: z.array(z.number().int()), limitedHistory: z.boolean() })),
                buckets: z.array(z.object({ bucketId: z.string(), key: z.string(), name: z.string(), colour: z.string(), months: z.array(z.number().int()) })),
                totals: z.array(z.object({ month: z.string(), incomeCents: z.number().int(), spendingCents: z.number().int(), savingCents: z.number().int(), netCents: z.number().int() })),
                accounts: z.array(z.object({ accountId: z.string(), name: z.string(), class: z.string(), currentCents: z.number().int(), monthEndCents: z.array(z.number().int()) })),
              }),
              Csv,
            ]),
          },
        },
      },
      async (request, reply) => {
        const r = await services.reports.forecast(authOf(request).householdId, request.query);
        if (request.query.format === 'csv') {
          return sendCsv(reply, 'forecast', r.categories, [
            { label: 'Category', value: (x) => x.name },
            { label: 'Method', value: (x) => x.method },
            ...r.months.map((m, i) => ({ label: m, value: (x: (typeof r.categories)[number]) => money(x.months[i]!) })),
          ]);
        }
        return r;
      },
    );

    // ─── Calendar ────────────────────────────────────────────────────────────
    app.get(
      '/calendar',
      {
        schema: {
          tags: ['calendar'],
          description: 'Scheduled occurrences (posted and upcoming), sinking fund due dates and goal target dates.',
          querystring: z.strictObject(Range),
          response: {
            200: z.object({
              items: z.array(
                z.object({
                  kind: z.enum(['occurrence', 'sinking_fund', 'goal']),
                  id: z.string(),
                  date: z.string(),
                  title: z.string(),
                  amountCents: z.number().int(),
                  type: z.string().nullable(),
                  bucketKey: z.string().nullable(),
                  colour: z.string().nullable(),
                  status: z.string(),
                  occurrence: z.record(z.string(), z.unknown()).nullable(),
                }),
              ),
            }),
          },
        },
      },
      async (request) => ({ items: await services.reports.calendar(authOf(request).householdId, request.query) }),
    );
  };
