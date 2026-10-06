import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Deps } from './context.js';
import type { ImportService } from './import.service.js';
import { notFound, validationError } from '../lib/errors.js';
import { MAX_IMPORT_BYTES } from './import.service.js';

/** Files this young may still be being copied in, so they wait for the next scan. */
const SETTLE_MS = 30_000;
const IMPORTABLE = /\.(csv|txt)$/i;

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'account';

/**
 * Folder import: each account can have a folder under IMPORT_INBOX_DIR.
 * A CSV dropped there (by Syncthing, scp, a NAS share…) is imported with the
 * account's saved column layout, then moved to imported/ or, if it can't be
 * imported, to failed/ with a .error.txt beside it explaining why.
 */
export function createInboxService(deps: Deps, imports: ImportService) {
  const { db, config, log } = deps;
  const root = config.importInboxDir;

  async function recent(dir: string) {
    try {
      const names = (await readdir(dir)).filter((n) => !n.endsWith('.error.txt')).sort().reverse().slice(0, 5);
      return names;
    } catch {
      return [];
    }
  }

  return {
    enabled: Boolean(root),

    async list(householdId: string) {
      const accounts = await db.account.findMany({ where: { householdId, isClosed: false }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { importProfiles: { select: { id: true } } } });
      return {
        enabled: Boolean(root),
        accounts: await Promise.all(
          accounts.map(async (a) => ({
            accountId: a.id,
            accountName: a.name,
            folder: a.inboxFolder,
            hasLayout: a.importProfiles.length > 0,
            imported: a.inboxFolder && root ? await recent(join(root, a.inboxFolder, 'imported')) : [],
            failed: a.inboxFolder && root ? await recent(join(root, a.inboxFolder, 'failed')) : [],
          })),
        ),
      };
    },

    /** Gives the account a folder (an unguessable name, unique on the server) and creates it. */
    async enable(householdId: string, accountId: string) {
      if (!root) throw validationError('Folder import is off on this server. Set IMPORT_INBOX_DIR (see the deployment guide).');
      const account = await db.account.findFirst({ where: { householdId, id: accountId } });
      if (!account) throw notFound('Account');
      const folder = account.inboxFolder ?? `${slug(account.name)}-${randomBytes(3).toString('hex')}`;
      try {
        await mkdir(join(root, folder), { recursive: true, mode: 0o770 });
      } catch (err) {
        log.error({ err: (err as Error).message, root }, 'inbox folder could not be created');
        throw validationError(`The server can’t write to ${root}. Check the folder exists and belongs to the app’s user (uid 1000).`);
      }
      await db.account.update({ where: { id: account.id }, data: { inboxFolder: folder } });
      return this.list(householdId);
    },

    /** Stops watching. The folder and its files are left on disk. */
    async disable(householdId: string, accountId: string) {
      const r = await db.account.updateMany({ where: { householdId, id: accountId }, data: { inboxFolder: null } });
      if (r.count === 0) throw notFound('Account');
      return this.list(householdId);
    },

    /** The scheduled job: imports every settled file in every watched folder. */
    async scan() {
      if (!root) return { files: 0 };
      const accounts = await db.account.findMany({ where: { inboxFolder: { not: null } }, select: { id: true, householdId: true, inboxFolder: true } });
      let files = 0;
      for (const a of accounts) {
        const dir = join(root, a.inboxFolder!);
        let names: string[];
        try {
          names = (await readdir(dir)).filter((n) => IMPORTABLE.test(n) && !n.startsWith('.'));
        } catch {
          continue; // folder removed by hand
        }
        for (const name of names) {
          const path = join(dir, name);
          const info = await stat(path).catch(() => null);
          if (!info?.isFile() || deps.now().getTime() - info.mtimeMs < SETTLE_MS) continue;
          const stamp = deps.now().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
          try {
            if (info.size > MAX_IMPORT_BYTES) throw validationError('The file is larger than 5 MB');
            const csv = (await readFile(path, 'utf8')).replace(/^﻿/, '');
            const result = await imports.importFile(a.householdId, a.id, csv, name);
            await mkdir(join(dir, 'imported'), { recursive: true });
            await rename(path, join(dir, 'imported', `${stamp}-${name}`));
            log.info({ accountId: a.id, file: name, imported: result.batch?.importedCount ?? 0 }, 'inbox file imported');
          } catch (err) {
            await mkdir(join(dir, 'failed'), { recursive: true });
            await rename(path, join(dir, 'failed', `${stamp}-${name}`)).catch(() => {});
            await writeFile(join(dir, 'failed', `${stamp}-${name}.error.txt`), `${(err as Error).message}\n`).catch(() => {});
            log.warn({ accountId: a.id, file: name, err: (err as Error).message }, 'inbox file not imported');
          }
          files++;
        }
      }
      return { files };
    },
  };
}

export type InboxService = ReturnType<typeof createInboxService>;
