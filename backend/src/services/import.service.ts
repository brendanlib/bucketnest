import type { ImportProfile } from '@prisma/client';
import type { Deps } from './context.js';
import type { TransactionService, PrepareMemo } from './transaction.service.js';
import type { RecurringService } from './recurring.service.js';
import type { RuleService, Suggestion } from './rule.service.js';
import { defaultSuggestion, firstMatchingRule, suggestFromRule, suggestionToInput, toSpec } from './rule.service.js';
import { exceptionsOf, specOf } from './recurring.service.js';
import { findAccount } from '../repositories/accounts.js';
import { listRecurring, postedOccurrences } from '../repositories/recurring.js';
import * as txRepo from '../repositories/transactions.js';
import { AppError, conflict, notFound, validationError } from '../lib/errors.js';
import { cents, dateIn, dateOut } from '../lib/serialize.js';
import { detectDelimiter, parseCsv } from '../import/csv.js';
import { applyMapping, guessMapping, type ColumnMapping, type ParsedRow } from '../import/mapping.js';
import { DATE_FORMATS, type DateFormat } from '../import/parse.js';
import { fingerprintRows } from '../import/fingerprint.js';
import { amountsMatch, MATCH_WINDOW_DAYS, pairClosest } from '../import/match.js';
import { generateOccurrences } from '../finance/recurrence.js';
import { addDays } from '../finance/dates.js';
import { balanceEffect } from '../finance/balance.js';
import type { TransactionInput } from './transaction.service.js';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

export type ImportAction = 'import' | 'skip' | 'match' | 'merge';

export interface ParseInput {
  accountId: string;
  fileName: string;
  csv: string;
  mapping?: Partial<ColumnMapping>;
}

export interface Decision {
  index: number;
  action: ImportAction;
  type?: 'EXPENSE' | 'INCOME' | 'REFUND' | 'TRANSFER';
  categoryId?: string | null;
  /** For transfers: the other account (money goes to it for debits, comes from it for credits). */
  otherAccountId?: string | null;
  description?: string;
  payee?: string | null;
  notes?: string | null;
}

const profileToMapping = (p: ImportProfile): ColumnMapping => ({
  delimiter: p.delimiter,
  hasHeader: p.hasHeader,
  dateFormat: (DATE_FORMATS as string[]).includes(p.dateFormat) ? (p.dateFormat as DateFormat) : 'DD/MM/YYYY',
  signConvention: p.signConvention,
  dateColumn: p.dateColumn,
  descriptionColumn: p.descriptionColumn,
  amountColumn: p.amountColumn,
  debitColumn: p.debitColumn,
  creditColumn: p.creditColumn,
  balanceColumn: p.balanceColumn,
  payeeColumn: p.payeeColumn,
});

function validateMapping(m: ColumnMapping, width: number) {
  const inRange = (i: number | null | undefined) => i === null || i === undefined || (Number.isInteger(i) && i >= 0 && i < width);
  for (const key of ['dateColumn', 'descriptionColumn', 'amountColumn', 'debitColumn', 'creditColumn', 'balanceColumn', 'payeeColumn'] as const) {
    if (!inRange(m[key])) throw validationError(`The file has no column ${(m[key] as number) + 1}`, { field: `mapping.${key}` });
  }
  if (m.signConvention === 'DEBIT_CREDIT_COLUMNS') {
    if (m.debitColumn == null || m.creditColumn == null) throw validationError('Choose the debit and credit columns', { field: 'mapping.debitColumn' });
  } else if (m.amountColumn == null) {
    throw validationError('Choose the amount column', { field: 'mapping.amountColumn' });
  }
}

export function createImportService(deps: Deps, services: { transactions: TransactionService; recurring: RecurringService; rules: RuleService }) {
  const { db } = deps;

  async function analyse(householdId: string, input: ParseInput) {
    const account = await findAccount(db, householdId, input.accountId);
    if (!account) throw validationError('Unknown account', { field: 'accountId' });
    if (Buffer.byteLength(input.csv, 'utf8') > MAX_IMPORT_BYTES) throw validationError('The file is larger than 5 MB', { field: 'csv' });

    const profile = await db.importProfile.findFirst({ where: { householdId, accountId: account.id } });
    const delimiter = input.mapping?.delimiter ?? profile?.delimiter ?? detectDelimiter(input.csv);
    const table = parseCsv(input.csv, delimiter);
    if (table.length === 0) throw validationError('The file is empty', { field: 'csv' });
    if (table.length > MAX_IMPORT_ROWS + 1) throw validationError(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString('en-AU')} rows`, { field: 'csv' });
    const width = Math.max(...table.map((r) => r.length));

    const defined = Object.fromEntries(Object.entries(input.mapping ?? {}).filter(([, v]) => v !== undefined)) as Partial<ColumnMapping>;
    const base = profile && profile.delimiter === delimiter ? profileToMapping(profile) : guessMapping(table, delimiter);
    const mapping: ColumnMapping = { ...base, ...defined, delimiter };
    validateMapping(mapping, width);

    const parsed = applyMapping(table, mapping);
    const valid = parsed.filter((r) => r.errors.length === 0) as (ParsedRow & { date: string; amountCents: number; direction: 'debit' | 'credit' })[];
    const fingerprints = new Map<number, string>();
    fingerprintRows(account.id, valid).forEach((fp, i) => fingerprints.set(valid[i]!.index, fp));

    // Duplicates: bank rows already linked for this account.
    const existing = new Map<string, string>();
    const fpList = [...fingerprints.values()];
    for (let i = 0; i < fpList.length; i += 1000) {
      const found = await db.importLink.findMany({
        where: { householdId, accountId: account.id, fingerprint: { in: fpList.slice(i, i + 1000) } },
        select: { transactionId: true, fingerprint: true },
      });
      for (const f of found) existing.set(f.fingerprint, f.transactionId);
    }

    const dates = valid.map((r) => r.date).sort();
    const from = dates.length ? addDays(dates[0]!, -MATCH_WINDOW_DAYS) : null;
    const to = dates.length ? addDays(dates[dates.length - 1]!, MATCH_WINDOW_DAYS) : null;
    const candidateRows = parsed.map((r) => {
      const fp = fingerprints.get(r.index);
      return r.errors.length === 0 && fp && !existing.has(fp) ? { date: r.date!, amountCents: r.amountCents!, direction: r.direction! } : null;
    });

    // Unposted recurring occurrences on this account (spec §8: ±3 days; fixed exact, estimates ±20%).
    type OccCandidate = { date: string; amountCents: number; direction: 'debit' | 'credit'; kind: 'FIXED' | 'ESTIMATE'; recurringId: string; occurrenceDate: string; name: string; schedule: Awaited<ReturnType<typeof listRecurring>>[number] };
    const occCands: OccCandidate[] = [];
    if (from && to) {
      const schedules = (await listRecurring(db, householdId)).filter((r) => r.accountId === account.id || r.toAccountId === account.id);
      const posted = await postedOccurrences(db, householdId, schedules.map((s) => s.id));
      for (const s of schedules) {
        const direction: 'debit' | 'credit' = s.accountId === account.id ? (s.type === 'INCOME' ? 'credit' : 'debit') : 'credit';
        for (const o of generateOccurrences(specOf(s), from, to, exceptionsOf(s))) {
          if (o.skipped || posted.has(`${s.id}|${o.occurrenceDate}`)) continue;
          occCands.push({ date: o.date, amountCents: o.amountCents, direction, kind: s.amountKind, recurringId: s.id, occurrenceDate: o.occurrenceDate, name: s.name, schedule: s });
        }
      }
    }
    const occPairs = pairClosest(candidateRows, occCands, (r, c) => amountsMatch(c.amountCents, r.amountCents, c.kind));

    // Existing transactions entered by hand or auto-posted, not yet linked to a bank row: offered as merges.
    type TxCandidate = { date: string; amountCents: number; direction: 'debit' | 'credit'; id: string; description: string; type: string };
    let txCands: TxCandidate[] = [];
    if (from && to) {
      const rows = await db.transaction.findMany({
        where: {
          householdId,
          OR: [{ accountId: account.id }, { toAccountId: account.id }],
          date: { gte: dateIn(from), lte: dateIn(to) },
          // Not yet linked to a row of this account's statement (a transfer can be linked once per side).
          bankRows: { none: { accountId: account.id } },
        },
        select: { id: true, date: true, amountCents: true, type: true, direction: true, accountId: true, description: true },
      });
      txCands = rows.map((t) => {
        const effect = balanceEffect({ type: t.type, direction: t.direction, amountCents: cents(t.amountCents), role: t.accountId === account.id ? 'from' : 'to' }, account.class);
        const credit = account.class === 'ASSET' ? effect > 0 : effect < 0;
        return { date: dateOut(t.date), amountCents: cents(t.amountCents), direction: credit ? 'credit' : 'debit', id: t.id, description: t.description, type: t.type };
      });
    }
    const forMerge = candidateRows.map((r, i) => (occPairs.has(i) ? null : r));
    const mergePairs = pairClosest(forMerge, txCands, (r, c) => r.amountCents === c.amountCents);

    const rules = await services.rules.activeSpecs(householdId);
    const specs = rules.map((r) => ({ ...toSpec(r), rule: r }));

    const rows = parsed.map((r, i) => {
      const fp = fingerprints.get(r.index) ?? null;
      const duplicateOf = fp ? (existing.get(fp) ?? null) : null;
      const occ = occPairs.has(i) ? occCands[occPairs.get(i)!]! : null;
      const merge = mergePairs.has(i) ? txCands[mergePairs.get(i)!]! : null;
      let suggestion: Suggestion | null = null;
      if (r.errors.length === 0) {
        if (occ) {
          const s = occ.schedule;
          const transferIn = s.toAccountId === account.id;
          suggestion = {
            type: s.type,
            categoryId: s.categoryId,
            toAccountId: transferIn ? null : s.toAccountId,
            fromAccountId: transferIn ? s.accountId : null,
            payee: s.payee,
            notes: null,
            ruleId: null,
            ruleName: null,
          };
        } else {
          const subject = { description: r.description, payee: r.payee, amountCents: r.amountCents!, direction: r.direction!, accountId: account.id };
          const hit = firstMatchingRule(specs, subject);
          suggestion = hit ? suggestFromRule(hit.rule, hit.rule.setCategory?.kind ?? null, subject, account.class) : defaultSuggestion(r.direction!, account.class);
        }
      }
      const status = r.errors.length ? 'error' : duplicateOf ? 'duplicate' : 'new';
      const defaultAction: ImportAction = status !== 'new' ? 'skip' : occ ? 'match' : merge ? 'merge' : 'import';
      return {
        index: r.index,
        raw: r.raw,
        date: r.date,
        description: r.description,
        payee: r.payee,
        amountCents: r.amountCents,
        direction: r.direction,
        balanceCents: r.balanceCents,
        errors: r.errors,
        fingerprint: fp,
        status: status as 'error' | 'duplicate' | 'new',
        duplicateOf,
        match: occ ? { recurringId: occ.recurringId, occurrenceDate: occ.occurrenceDate, name: occ.name, date: occ.date, amountCents: occ.amountCents } : null,
        merge: merge ? { transactionId: merge.id, date: merge.date, description: merge.description, type: merge.type } : null,
        suggestion,
        defaultAction,
      };
    });

    return { account, mapping, table, rows, profileUsed: Boolean(profile && profile.delimiter === delimiter) };
  }

  type Analysed = Awaited<ReturnType<typeof analyse>>;
  type Row = Analysed['rows'][number];

  /** Statement closing balance (from a mapped balance column) against the app's balance after this import. */
  async function balanceCheck(householdId: string, a: Analysed, decide: (row: Row) => ImportAction) {
    if (a.mapping.balanceColumn == null) return null;
    const withBalance = a.rows.filter((r) => r.date && r.balanceCents !== null && r.errors.length === 0);
    if (!withBalance.length) return null;
    const maxDate = withBalance.reduce((m, r) => (r.date! > m ? r.date! : m), withBalance[0]!.date!);
    const first = withBalance[0]!;
    const last = withBalance[withBalance.length - 1]!;
    const newestFirst = first.date! > last.date!;
    const onMax = withBalance.filter((r) => r.date === maxDate);
    const closing = newestFirst ? onMax[0]! : onMax[onMax.length - 1]!;
    const current = (await services.transactions.balanceOf(householdId, a.account.id, maxDate)) ?? 0;
    let added = 0;
    for (const r of a.rows) {
      const action = decide(r);
      if ((action === 'import' || action === 'match') && r.date && r.date <= maxDate && r.amountCents) {
        const inflow = r.direction === 'credit' ? r.amountCents : -r.amountCents;
        added += a.account.class === 'ASSET' ? inflow : -inflow;
      }
    }
    // Card and loan statements often show the amount owed as a negative balance.
    const statement = a.account.class === 'LIABILITY' && closing.balanceCents! < 0 ? -closing.balanceCents! : closing.balanceCents!;
    return { date: maxDate, statementBalanceCents: statement, appBalanceBeforeCents: current, appBalanceAfterCents: current + added, differenceCents: statement - (current + added) };
  }

  const summarise = (rows: Row[]) => ({
    total: rows.length,
    new: rows.filter((r) => r.status === 'new').length,
    duplicates: rows.filter((r) => r.status === 'duplicate').length,
    errors: rows.filter((r) => r.status === 'error').length,
    matched: rows.filter((r) => r.defaultAction === 'match').length,
    merges: rows.filter((r) => r.defaultAction === 'merge').length,
    categorised: rows.filter((r) => r.status === 'new' && (r.suggestion?.categoryId || r.suggestion?.type === 'TRANSFER')).length,
  });

  return {
    async parse(householdId: string, input: ParseInput) {
      const a = await analyse(householdId, input);
      const width = Math.max(...a.table.map((r) => r.length));
      const columns = a.mapping.hasHeader ? Array.from({ length: width }, (_, i) => a.table[0]![i] || `Column ${i + 1}`) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
      return {
        accountId: a.account.id,
        mapping: a.mapping,
        profileUsed: a.profileUsed,
        columns,
        sample: (a.mapping.hasHeader ? a.table.slice(1) : a.table).slice(0, 5),
        summary: summarise(a.rows),
        balanceCheck: await balanceCheck(householdId, a, (r) => r.defaultAction),
        rows: a.rows,
      };
    },

    /** Re-parses the file on the server and applies the user's decisions in one database transaction. */
    async commit(householdId: string, userId: string, input: ParseInput & { decisions: Decision[]; saveProfile?: boolean }) {
      const a = await analyse(householdId, input);
      const decisions = new Map(input.decisions.map((d) => [d.index, d]));
      const memo: PrepareMemo = new Map();
      const creates: { index: number; data: Awaited<ReturnType<TransactionService['prepare']>>; fingerprint: string; link?: { recurringId: string; occurrenceDate: string } }[] = [];
      const merges: { index: number; transactionId: string; fingerprint: string }[] = [];
      const problems: { index: number; message: string }[] = [];
      let skipped = 0;

      for (const row of a.rows) {
        const d = decisions.get(row.index);
        const action = d?.action ?? row.defaultAction;
        if (action === 'skip') {
          skipped++;
          continue;
        }
        if (row.status !== 'new' || !row.suggestion || !row.fingerprint) {
          problems.push({ index: row.index, message: row.status === 'duplicate' ? 'Already imported' : row.errors[0] ?? 'Cannot import this row' });
          continue;
        }
        try {
          if (action === 'merge') {
            if (!row.merge) throw validationError('No transaction to merge with');
            merges.push({ index: row.index, transactionId: row.merge.transactionId, fingerprint: row.fingerprint });
            continue;
          }
          const bank = { date: row.date!, description: d?.description?.trim() || row.description, amountCents: row.amountCents!, accountId: a.account.id, payee: row.payee };
          let txInput: TransactionInput;
          let link: { recurringId: string; occurrenceDate: string } | undefined;
          if (action === 'match') {
            if (!row.match) throw validationError('No scheduled payment to match');
            const draft = await services.recurring.draft(householdId, row.match.recurringId, row.match.occurrenceDate);
            const categoryId = d?.categoryId !== undefined ? d.categoryId : (draft.splits?.[0]?.categoryId ?? null);
            txInput = {
              ...draft,
              date: bank.date,
              description: bank.description,
              amountCents: bank.amountCents,
              payee: d?.payee ?? draft.payee ?? bank.payee,
              notes: d?.notes ?? draft.notes,
              splits: categoryId ? [{ categoryId, amountCents: bank.amountCents }] : draft.type === 'SAVINGS_CONTRIBUTION' ? undefined : [],
              cleared: true,
            };
            link = { recurringId: row.match.recurringId, occurrenceDate: row.match.occurrenceDate };
          } else {
            const s = { ...row.suggestion };
            if (d?.type) s.type = d.type;
            if (d?.categoryId !== undefined) s.categoryId = d.categoryId;
            if (d?.payee !== undefined) s.payee = d.payee;
            if (d?.notes !== undefined) s.notes = d.notes;
            if (s.type === 'TRANSFER') {
              const other = d?.otherAccountId ?? s.toAccountId ?? s.fromAccountId;
              s.toAccountId = row.direction === 'debit' ? other : null;
              s.fromAccountId = row.direction === 'credit' ? other : null;
              s.categoryId = null;
            }
            txInput = suggestionToInput(s, { ...bank, cleared: true });
          }
          const data = await services.transactions.prepare(householdId, txInput, { allowUncategorised: true, memo });
          creates.push({ index: row.index, data, fingerprint: row.fingerprint, link });
        } catch (err) {
          if (err instanceof AppError) problems.push({ index: row.index, message: err.message });
          else throw err;
        }
      }
      if (problems.length) {
        throw validationError(`${problems.length} row${problems.length === 1 ? '' : 's'} can’t be imported as chosen`, { rows: problems.slice(0, 100) });
      }

      const batch = await db.$transaction(
        async (tx) => {
          const b = await tx.importBatch.create({
            data: {
              householdId,
              accountId: a.account.id,
              fileName: input.fileName.slice(0, 200),
              rowCount: a.rows.length,
              importedCount: creates.length,
              matchedCount: creates.filter((c) => c.link).length,
              mergedCount: merges.length,
              skippedCount: skipped,
            },
          });
          for (const c of creates) {
            const created = await txRepo.createTransaction(
              tx,
              householdId,
              {
                ...c.data.data,
                createdById: userId,
                fingerprint: c.fingerprint,
                importBatchId: b.id,
                ...(c.link ? { recurringId: c.link.recurringId, occurrenceDate: dateIn(c.link.occurrenceDate) } : {}),
              },
              c.data.splits,
            );
            await tx.importLink.create({ data: { householdId, transactionId: created.id, accountId: a.account.id, fingerprint: c.fingerprint, importBatchId: b.id } });
          }
          for (const m of merges) {
            // Unique (transaction, account) means a row can only merge into a side not yet linked.
            await tx.importLink.create({ data: { householdId, transactionId: m.transactionId, accountId: a.account.id, fingerprint: m.fingerprint, importBatchId: b.id, merged: true } });
          }
          if (input.saveProfile !== false) {
            const m = a.mapping;
            const data = {
              name: input.fileName.slice(0, 120),
              delimiter: m.delimiter,
              hasHeader: m.hasHeader,
              dateFormat: m.dateFormat,
              signConvention: m.signConvention,
              dateColumn: m.dateColumn,
              descriptionColumn: m.descriptionColumn,
              amountColumn: m.amountColumn ?? null,
              debitColumn: m.debitColumn ?? null,
              creditColumn: m.creditColumn ?? null,
              balanceColumn: m.balanceColumn ?? null,
              payeeColumn: m.payeeColumn ?? null,
            };
            await tx.importProfile.upsert({ where: { accountId: a.account.id }, create: { householdId, accountId: a.account.id, ...data }, update: data });
          }
          return b;
        },
        { timeout: 120_000, maxWait: 10_000 },
      ).catch((err: unknown) => {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
          throw conflict('IMPORT_CHANGED', 'Some rows were imported or posted while you were reviewing. Check the file again.');
        }
        throw err;
      });
      return this.getBatch(householdId, batch.id);
    },

    async listBatches(householdId: string) {
      const rows = await db.importBatch.findMany({ where: { householdId }, include: { account: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
      return rows.map(serializeBatch);
    },

    async getBatch(householdId: string, id: string) {
      const b = await db.importBatch.findFirst({ where: { householdId, id }, include: { account: { select: { name: true } } } });
      if (!b) throw notFound('Import');
      return serializeBatch(b);
    },

    /** Undo removes exactly what the batch added and unlinks what it merged. */
    async undo(householdId: string, id: string) {
      const b = await db.importBatch.findFirst({ where: { householdId, id } });
      if (!b) throw notFound('Import');
      if (b.status === 'UNDONE') throw conflict('ALREADY_UNDONE', 'This import was already undone');
      const result = await db.$transaction(async (tx) => {
        const removed = await tx.transaction.deleteMany({ where: { householdId, importBatchId: id } });
        // What is left of the batch's links are merges into transactions that existed before.
        const unmerged = await tx.importLink.deleteMany({ where: { householdId, importBatchId: id } });
        await tx.importBatch.update({ where: { id }, data: { status: 'UNDONE', undoneAt: deps.now() } });
        return { removed: removed.count, unmerged: unmerged.count };
      });
      deps.log.info({ batchId: id, ...result }, 'import undone');
      return result;
    },

    async listProfiles(householdId: string) {
      const rows = await db.importProfile.findMany({ where: { householdId }, include: { account: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
      return rows.map((p) => ({ id: p.id, accountId: p.accountId, accountName: p.account.name, name: p.name, ...profileToMapping(p) }));
    },

    async saveProfile(householdId: string, accountId: string, name: string, m: ColumnMapping) {
      const account = await findAccount(db, householdId, accountId);
      if (!account) throw validationError('Unknown account', { field: 'accountId' });
      validateMapping(m, 1000);
      const data = { name, delimiter: m.delimiter, hasHeader: m.hasHeader, dateFormat: m.dateFormat, signConvention: m.signConvention, dateColumn: m.dateColumn, descriptionColumn: m.descriptionColumn, amountColumn: m.amountColumn ?? null, debitColumn: m.debitColumn ?? null, creditColumn: m.creditColumn ?? null, balanceColumn: m.balanceColumn ?? null, payeeColumn: m.payeeColumn ?? null };
      await db.importProfile.upsert({ where: { accountId }, create: { householdId, accountId, ...data }, update: data });
      return (await this.listProfiles(householdId)).find((p) => p.accountId === accountId)!;
    },

    async deleteProfile(householdId: string, id: string) {
      const r = await db.importProfile.deleteMany({ where: { householdId, id } });
      if (r.count === 0) throw notFound('Import profile');
    },
  };
}

function serializeBatch(b: { id: string; accountId: string; fileName: string; rowCount: number; importedCount: number; mergedCount: number; matchedCount: number; skippedCount: number; status: 'COMMITTED' | 'UNDONE'; createdAt: Date; undoneAt: Date | null; account: { name: string } }) {
  return {
    id: b.id,
    accountId: b.accountId,
    accountName: b.account.name,
    fileName: b.fileName,
    rowCount: b.rowCount,
    importedCount: b.importedCount,
    matchedCount: b.matchedCount,
    mergedCount: b.mergedCount,
    skippedCount: b.skippedCount,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    undoneAt: b.undoneAt?.toISOString() ?? null,
  };
}

export type ImportService = ReturnType<typeof createImportService>;
