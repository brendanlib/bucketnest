import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Services } from '../services/index.js';
import { authOf } from '../plugins/auth.js';
import { Id, IdParams, Name } from '../lib/schemas.js';
import { DATE_FORMATS } from '../import/parse.js';

const Column = z.number().int().min(0).max(200);
const Mapping = z.strictObject({
  delimiter: z.enum([',', ';', '\t', '|']),
  hasHeader: z.boolean(),
  dateFormat: z.enum(DATE_FORMATS as [string, ...string[]]),
  signConvention: z.enum(['NEGATIVE_IS_DEBIT', 'POSITIVE_IS_DEBIT', 'DEBIT_CREDIT_COLUMNS']),
  dateColumn: Column,
  descriptionColumn: Column,
  amountColumn: Column.nullish(),
  debitColumn: Column.nullish(),
  creditColumn: Column.nullish(),
  balanceColumn: Column.nullish(),
  payeeColumn: Column.nullish(),
});

/** Responses echo whatever mapping was used, so the delimiter is any string. */
const MappingOut = Mapping.extend({ delimiter: z.string() });

const ParseBody = z.strictObject({
  accountId: Id,
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1, 'The file is empty').max(6_000_000),
  mapping: Mapping.partial().optional(),
});

const Decision = z.strictObject({
  index: z.number().int().min(0),
  action: z.enum(['import', 'skip', 'match', 'merge']),
  type: z.enum(['EXPENSE', 'INCOME', 'REFUND', 'TRANSFER']).optional(),
  categoryId: Id.nullish(),
  otherAccountId: Id.nullish(),
  description: z.string().trim().min(1).max(300).optional(),
  payee: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const Suggestion = z.object({
  type: z.string(),
  categoryId: z.string().nullable(),
  toAccountId: z.string().nullable(),
  fromAccountId: z.string().nullable(),
  payee: z.string().nullable(),
  notes: z.string().nullable(),
  ruleId: z.string().nullable(),
  ruleName: z.string().nullable(),
});

const Row = z.object({
  index: z.number().int(),
  raw: z.array(z.string()),
  date: z.string().nullable(),
  description: z.string(),
  payee: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  direction: z.enum(['debit', 'credit']).nullable(),
  balanceCents: z.number().int().nullable(),
  errors: z.array(z.string()),
  fingerprint: z.string().nullable(),
  status: z.enum(['error', 'duplicate', 'new']),
  duplicateOf: z.string().nullable(),
  match: z.object({ recurringId: z.string(), occurrenceDate: z.string(), name: z.string(), date: z.string(), amountCents: z.number().int() }).nullable(),
  merge: z.object({ transactionId: z.string(), date: z.string(), description: z.string(), type: z.string() }).nullable(),
  suggestion: Suggestion.nullable(),
  defaultAction: z.enum(['import', 'skip', 'match', 'merge']),
});

const ParseResponse = z.object({
  accountId: z.string(),
  mapping: MappingOut,
  profileUsed: z.boolean(),
  columns: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  summary: z.object({ total: z.number().int(), new: z.number().int(), duplicates: z.number().int(), errors: z.number().int(), matched: z.number().int(), merges: z.number().int(), categorised: z.number().int() }),
  balanceCheck: z
    .object({ date: z.string(), statementBalanceCents: z.number().int(), appBalanceBeforeCents: z.number().int(), appBalanceAfterCents: z.number().int(), differenceCents: z.number().int() })
    .nullable(),
  rows: z.array(Row),
});

const Batch = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  fileName: z.string(),
  rowCount: z.number().int(),
  importedCount: z.number().int(),
  matchedCount: z.number().int(),
  mergedCount: z.number().int(),
  skippedCount: z.number().int(),
  status: z.enum(['COMMITTED', 'UNDONE']),
  createdAt: z.string(),
  undoneAt: z.string().nullable(),
});

const Profile = MappingOut.extend({ id: z.string(), accountId: z.string(), accountName: z.string(), name: z.string() });

export const importRoutes =
  (services: Services): FastifyPluginAsyncZod =>
  async (app) => {
    // CSV files up to 5 MB travel as JSON text; quotes are escaped, so allow headroom.
    const bodyLimit = 14 * 1024 * 1024;

    app.post(
      '/import/parse',
      {
        bodyLimit,
        schema: {
          tags: ['import'],
          description: 'Parses a bank CSV with a saved, given or guessed column mapping, and classifies every row. Nothing is saved.',
          body: ParseBody,
          response: { 200: ParseResponse },
        },
      },
      async (request) => services.imports.parse(authOf(request).householdId, request.body as never),
    );

    app.post(
      '/import/commit',
      {
        bodyLimit,
        schema: {
          tags: ['import'],
          description: 'Re-parses the file and imports it as one undoable batch. Rows without a decision use their default action.',
          body: ParseBody.extend({ decisions: z.array(Decision).max(25_000).default([]), saveProfile: z.boolean().optional() }),
          response: { 201: Batch },
        },
      },
      async (request, reply) => {
        const a = authOf(request);
        reply.status(201);
        return services.imports.commit(a.householdId, a.userId, request.body as never);
      },
    );

    app.get('/import/batches', { schema: { tags: ['import'], response: { 200: z.object({ items: z.array(Batch) }) } } }, async (request) => ({
      items: await services.imports.listBatches(authOf(request).householdId),
    }));

    app.delete(
      '/import/batches/:id',
      { schema: { tags: ['import'], description: 'Undo: removes the transactions the batch added and unlinks merges.', params: IdParams, response: { 200: z.object({ removed: z.number().int(), unmerged: z.number().int() }) } } },
      async (request) => services.imports.undo(authOf(request).householdId, request.params.id),
    );

    app.get('/import/profiles', { schema: { tags: ['import'], response: { 200: z.object({ items: z.array(Profile) }) } } }, async (request) => ({
      items: await services.imports.listProfiles(authOf(request).householdId),
    }));

    app.post(
      '/import/profiles',
      { schema: { tags: ['import'], body: z.strictObject({ accountId: Id, name: Name, mapping: Mapping }), response: { 200: Profile } } },
      async (request) => services.imports.saveProfile(authOf(request).householdId, request.body.accountId, request.body.name, request.body.mapping as never),
    );

    app.put(
      '/import/profiles/:id',
      { schema: { tags: ['import'], params: IdParams, body: z.strictObject({ accountId: Id, name: Name, mapping: Mapping }), response: { 200: Profile } } },
      async (request) => services.imports.saveProfile(authOf(request).householdId, request.body.accountId, request.body.name, request.body.mapping as never),
    );

    app.delete('/import/profiles/:id', { schema: { tags: ['import'], params: IdParams, response: { 204: z.null() } } }, async (request, reply) => {
      await services.imports.deleteProfile(authOf(request).householdId, request.params.id);
      return reply.status(204).send(null);
    });
  };
