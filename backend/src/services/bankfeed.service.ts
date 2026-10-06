import type { Deps } from './context.js';
import type { ImportService, SourceRow } from './import.service.js';
import type { AccountService } from './account.service.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { open, seal } from '../lib/crypto.js';
import { cents, dateIn, dateOut } from '../lib/serialize.js';
import { upClient, UpError, type UpAccount, type UpTransaction } from '../lib/up.js';
import { addDays, dateInTimeZone } from '../finance/dates.js';

const TOKEN_PURPOSE = 'bank-token';
/** Re-read this many days before the last sync, so late settlements are caught (duplicates are skipped by id). */
const OVERLAP_DAYS = 14;
const MIN_MANUAL_SYNC_MS = 60_000;

/** Up account types → app account types. */
const APP_TYPE: Record<string, 'TRANSACTION' | 'SAVINGS' | 'MORTGAGE'> = { TRANSACTIONAL: 'TRANSACTION', SAVER: 'SAVINGS', HOME_LOAN: 'MORTGAGE' };

/**
 * Direct bank connections (Up Bank's personal API; no aggregator). Settled
 * transactions flow through the import pipeline, so duplicates are skipped by
 * Up's own ids, scheduled payments matched, rules applied, and every sync is
 * an undoable import batch.
 */
export function createBankFeedService(deps: Deps, services: { imports: ImportService; accounts: AccountService }) {
  const { db, config, log } = deps;
  const tokenOf = (c: { tokenCiphertext: string }) => open(config.sessionSecret, TOKEN_PURPOSE, c.tokenCiphertext);
  const client = (token: string) => upClient(token, deps.fetch);
  const inFlight = new Map<string, Promise<unknown>>();

  async function loadConnection(householdId: string, id: string) {
    const c = await db.bankConnection.findFirst({ where: { householdId, id }, include: { accounts: true } });
    if (!c) throw notFound('Bank connection');
    return c;
  }

  async function refreshAccounts(connectionId: string, householdId: string, remote: UpAccount[]) {
    for (const a of remote) {
      await db.bankFeedAccount.upsert({
        where: { connectionId_externalId: { connectionId, externalId: a.id } },
        create: { householdId, connectionId, externalId: a.id, name: a.name, kind: a.kind, balanceCents: BigInt(a.balanceCents) },
        update: { name: a.name, kind: a.kind, balanceCents: BigInt(a.balanceCents) },
      });
    }
  }

  function toRows(txns: UpTransaction[], timezone: string, syncFrom: string, linked: Map<string, string>): SourceRow[] {
    return txns
      .map((t) => ({ t, date: dateInTimeZone(new Date(t.createdAt), timezone) }))
      .filter(({ date }) => date >= syncFrom)
      .sort((a, b) => (a.t.createdAt < b.t.createdAt ? -1 : 1))
      .map(({ t, date }, index) => ({
        index,
        raw: [t.rawText ?? '', t.message ?? ''],
        date,
        description: t.description.slice(0, 300),
        payee: null,
        amountCents: Math.abs(t.amountCents),
        direction: t.amountCents < 0 ? ('debit' as const) : ('credit' as const),
        balanceCents: null,
        errors: t.amountCents === 0 ? ['Zero amount'] : [],
        fingerprint: `up:${t.id}`,
        ...(t.transferAccountId && linked.has(t.transferAccountId) ? { transferAccountId: linked.get(t.transferAccountId)! } : {}),
      }));
  }

  async function syncConnection(connectionId: string) {
    const c = await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId }, include: { accounts: true, household: { select: { timezone: true } } } });
    const up = client(tokenOf(c));
    const summary = { accounts: 0, imported: 0, merged: 0, matched: 0, skipped: 0 };
    try {
      await refreshAccounts(c.id, c.householdId, await up.accounts());
      const feeds = await db.bankFeedAccount.findMany({ where: { connectionId: c.id, accountId: { not: null }, syncFrom: { not: null } } });
      const linked = new Map(feeds.map((f) => [f.externalId, f.accountId!]));
      for (const f of feeds) {
        const syncFrom = dateOut(f.syncFrom!);
        const lastDay = f.lastSyncAt ? addDays(dateInTimeZone(f.lastSyncAt, c.household.timezone), -OVERLAP_DAYS) : syncFrom;
        const since = lastDay > syncFrom ? lastDay : syncFrom;
        // A day early in UTC covers every Australian time zone; rows are filtered by local date.
        const txns = await up.transactions(f.externalId, `${addDays(since, -1)}T00:00:00Z`, { settledOnly: true });
        const rows = toRows(txns, c.household.timezone, syncFrom, linked);
        const batch = rows.length ? await services.imports.importRows(c.householdId, f.accountId!, rows, `Up: ${f.name}`) : null;
        if (batch) {
          summary.imported += batch.importedCount;
          summary.merged += batch.mergedCount;
          summary.matched += batch.matchedCount;
        }
        summary.skipped += rows.length - (batch ? batch.importedCount + batch.mergedCount : 0);
        summary.accounts++;
        await db.bankFeedAccount.update({ where: { id: f.id }, data: { lastSyncAt: deps.now() } });
      }
      await db.bankConnection.update({ where: { id: c.id }, data: { status: 'ACTIVE', lastError: null, lastSyncAt: deps.now() } });
      log.info({ connectionId: c.id, ...summary }, 'bank sync finished');
      return summary;
    } catch (err) {
      const message = err instanceof UpError ? err.message : 'The sync failed. It will try again later.';
      await db.bankConnection.update({ where: { id: c.id }, data: { status: err instanceof UpError && err.status === 401 ? 'ERROR' : c.status, lastError: message } });
      log.error({ connectionId: c.id, err: (err as Error).message }, 'bank sync failed');
      throw err instanceof UpError ? validationError(message) : err;
    }
  }

  /** One sync at a time per connection (the job and "Sync now" share it). */
  function syncOnce(connectionId: string) {
    const running = inFlight.get(connectionId);
    if (running) return running as ReturnType<typeof syncConnection>;
    const run = syncConnection(connectionId).finally(() => inFlight.delete(connectionId));
    inFlight.set(connectionId, run);
    return run;
  }

  const serialize = async (householdId: string, c: Awaited<ReturnType<typeof loadConnection>>) => {
    const appIds = c.accounts.map((a) => a.accountId).filter((x): x is string => Boolean(x));
    const appAccounts = appIds.length ? (await services.accounts.list(householdId, { includeClosed: true })).filter((a) => appIds.includes(a.id)) : [];
    return {
      id: c.id,
      provider: c.provider,
      label: c.label,
      status: c.status,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      lastError: c.lastError,
      accounts: c.accounts
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => {
          const app = appAccounts.find((x) => x.id === a.accountId);
          return {
            id: a.id,
            name: a.name,
            kind: a.kind,
            bankBalanceCents: cents(a.balanceCents),
            accountId: a.accountId,
            accountName: app?.name ?? null,
            appBalanceCents: app?.balanceCents ?? null,
            syncFrom: a.syncFrom ? dateOut(a.syncFrom) : null,
            lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
          };
        }),
    };
  };

  return {
    async list(householdId: string) {
      const rows = await db.bankConnection.findMany({ where: { householdId }, include: { accounts: true }, orderBy: { createdAt: 'asc' } });
      return Promise.all(rows.map((c) => serialize(householdId, c)));
    },

    /** Checks the token with Up, stores it encrypted and lists the accounts it can see. Nothing is imported yet. */
    async connectUp(householdId: string, userId: string, rawToken: string) {
      const token = rawToken.trim();
      if (!/^up:yeah:[A-Za-z0-9]+$/.test(token)) throw validationError('That doesn’t look like an Up personal access token (it starts with up:yeah:)', { field: 'token' });
      const up = client(token);
      let remote: UpAccount[];
      try {
        await up.ping();
        remote = await up.accounts();
      } catch (err) {
        if (err instanceof UpError) throw validationError(err.message, { field: 'token' });
        throw validationError('Couldn’t reach Up. Check the server can make outgoing HTTPS connections and try again.', { field: 'token' });
      }
      const c = await db.bankConnection.create({
        data: { householdId, provider: 'UP', label: 'Up Bank', tokenCiphertext: seal(config.sessionSecret, TOKEN_PURPOSE, token), createdById: userId },
      });
      await refreshAccounts(c.id, householdId, remote);
      log.info({ householdId, connectionId: c.id, accounts: remote.length }, 'bank connected');
      return serialize(householdId, await loadConnection(householdId, c.id));
    },

    /**
     * Chooses where a bank account's transactions go: an existing account, a
     * new one (its opening balance worked out so it matches Up after the first
     * sync), or nowhere.
     */
    async link(householdId: string, feedId: string, input: { accountId?: string | null; createAccount?: boolean; syncFrom?: string | null }) {
      const feed = await db.bankFeedAccount.findFirst({ where: { householdId, id: feedId }, include: { connection: true } });
      if (!feed) throw notFound('Bank account');
      if (!input.createAccount && !input.accountId) {
        await db.bankFeedAccount.update({ where: { id: feed.id }, data: { accountId: null } });
        return serialize(householdId, await loadConnection(householdId, feed.connectionId));
      }
      const syncFrom = input.syncFrom;
      if (!syncFrom) throw validationError('Choose the date to import from', { field: 'syncFrom' });
      if (syncFrom > dateInTimeZone(deps.now(), config.defaultTimezone)) throw validationError('The import date can’t be in the future', { field: 'syncFrom' });

      let accountId = input.accountId ?? null;
      if (input.createAccount) {
        const type = APP_TYPE[feed.kind] ?? 'TRANSACTION';
        // Up's balance includes pending transactions, so everything since syncFrom, pending
        // included, explains the gap. Pending ones import once settled, and then the balances agree.
        let net = 0;
        try {
          const up = client(tokenOf(feed.connection));
          const household = await db.household.findUniqueOrThrow({ where: { id: householdId }, select: { timezone: true } });
          for (const t of await up.transactions(feed.externalId, `${addDays(syncFrom, -1)}T00:00:00Z`, { settledOnly: false })) {
            if (dateInTimeZone(new Date(t.createdAt), household.timezone) >= syncFrom) net += t.amountCents;
          }
        } catch (err) {
          if (err instanceof UpError) throw validationError(err.message);
          throw err;
        }
        const openingAsset = cents(feed.balanceCents) - net;
        const created = await services.accounts.create(householdId, {
          name: `Up ${feed.name}`.slice(0, 100),
          type,
          institution: 'Up',
          openingBalanceCents: type === 'MORTGAGE' ? -openingAsset : openingAsset,
          openingDate: syncFrom,
          ...(type === 'MORTGAGE' ? { repaymentTreatment: 'DEBT_REPAYMENT' as const } : {}),
        });
        accountId = created.id;
      } else {
        const account = await db.account.findFirst({ where: { householdId, id: accountId! } });
        if (!account) throw notFound('Account');
      }
      const taken = await db.bankFeedAccount.findFirst({ where: { accountId, id: { not: feed.id } } });
      if (taken) throw conflict('ACCOUNT_LINKED', `That account already gets transactions from ${taken.name}`);
      await db.bankFeedAccount.update({ where: { id: feed.id }, data: { accountId, syncFrom: dateIn(syncFrom), lastSyncAt: null } });
      return serialize(householdId, await loadConnection(householdId, feed.connectionId));
    },

    async sync(householdId: string, connectionId: string) {
      const c = await loadConnection(householdId, connectionId);
      if (c.lastSyncAt && deps.now().getTime() - c.lastSyncAt.getTime() < MIN_MANUAL_SYNC_MS && !inFlight.has(c.id)) {
        throw validationError('It synced less than a minute ago. Try again shortly.');
      }
      const summary = await syncOnce(c.id);
      return { summary, connection: await serialize(householdId, await loadConnection(householdId, c.id)) };
    },

    /** The scheduled job: every active connection, one at a time. */
    async syncAll() {
      const rows = await db.bankConnection.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      let ok = 0;
      for (const c of rows) {
        try {
          await syncOnce(c.id);
          ok++;
        } catch {
          /* recorded on the connection */
        }
      }
      return { connections: rows.length, ok };
    },

    /** Forgets the token and the account links. Imported transactions stay. */
    async disconnect(householdId: string, connectionId: string) {
      await loadConnection(householdId, connectionId);
      await db.bankConnection.delete({ where: { id: connectionId } });
      log.info({ householdId, connectionId }, 'bank disconnected');
    },
  };
}

export type BankFeedService = ReturnType<typeof createBankFeedService>;
