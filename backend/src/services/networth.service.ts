import type { AccountType, AssetType } from '@prisma/client';
import type { Deps } from './context.js';
import type { AccountService } from './account.service.js';
import { listAccounts } from '../repositories/accounts.js';
import { getHousehold } from '../repositories/households.js';
import { notFound, validationError } from '../lib/errors.js';
import { cents, dateIn, dateOut } from '../lib/serialize.js';
import { calculateNetWorth } from '../finance/balance.js';
import { dateInTimeZone, formatDateOnly, parseDateOnly } from '../finance/dates.js';

export interface AssetInput {
  name: string;
  type: AssetType;
  includeInNetWorth?: boolean;
  isActive?: boolean;
  notes?: string | null;
  /** First valuation, when creating. */
  valueCents?: number;
  valuedOn?: string;
}

type Group = 'cash' | 'investments' | 'super' | 'property' | 'vehicles' | 'other_assets' | 'mortgage' | 'cards' | 'loans' | 'hecs' | 'other_liabilities';

const GROUP_LABEL: Record<Group, string> = {
  cash: 'Cash and savings',
  investments: 'Investments',
  super: 'Superannuation',
  property: 'Property',
  vehicles: 'Vehicles',
  other_assets: 'Other assets',
  mortgage: 'Mortgages',
  cards: 'Credit cards',
  loans: 'Personal and car loans',
  hecs: 'HECS/HELP',
  other_liabilities: 'Other liabilities',
};

const ACCOUNT_GROUP: Record<AccountType, Group> = {
    TRANSACTION: 'cash', SAVINGS: 'cash', OFFSET: 'cash', CASH: 'cash',
    INVESTMENT: 'investments', SUPERANNUATION: 'super', OTHER_ASSET: 'other_assets',
    MORTGAGE: 'mortgage', CREDIT_CARD: 'cards', PERSONAL_LOAN: 'loans', CAR_LOAN: 'loans', HECS_HELP: 'hecs', OTHER_LIABILITY: 'other_liabilities',
};
const accountGroup = (t: AccountType): Group => ACCOUNT_GROUP[t];

const assetGroup = (t: AssetType): Group => (t === 'PROPERTY' ? 'property' : t === 'VEHICLE' ? 'vehicles' : 'other_assets');

/** Net worth = asset account balances + latest asset valuations − liability balances, at any date (spec §3.6, §12). */
export function createNetWorthService(deps: Deps, accounts: AccountService) {
  const { db } = deps;

  async function today(householdId: string) {
    return dateInTimeZone(deps.now(), (await getHousehold(db, householdId)).timezone);
  }

  /** The latest valuation on or before each date, per asset. */
  async function valuationsAsOf(householdId: string, dates: string[]) {
    const assets = await db.asset.findMany({ where: { householdId, includeInNetWorth: true }, include: { valuations: { orderBy: { date: 'asc' } } } });
    return dates.map((d) =>
      assets.map((a) => {
        const v = [...a.valuations].reverse().find((x) => dateOut(x.date) <= d);
        return { asset: a, valueCents: v ? cents(v.valueCents) : 0, valuedOn: v ? dateOut(v.date) : null };
      }),
    );
  }

  async function at(householdId: string, date: string) {
    const list = (await listAccounts(db, householdId, { includeClosed: true })).filter((a) => a.includeInNetWorth);
    const [balances, [vals]] = await Promise.all([accounts.balancesFor(householdId, list, dateIn(date)), valuationsAsOf(householdId, [date])]);
    const lines = [
      ...list.map((a) => ({ id: a.id, name: a.name, kind: 'account' as const, group: accountGroup(a.type), class: a.class, cents: balances.get(a.id) ?? 0, valuedOn: null as string | null })),
      ...vals!.map((v) => ({ id: v.asset.id, name: v.asset.name, kind: 'asset' as const, group: assetGroup(v.asset.type), class: 'ASSET' as const, cents: v.valueCents, valuedOn: v.valuedOn })),
    ].filter((l) => l.cents !== 0 || (l.kind === 'account' && !list.find((a) => a.id === l.id)?.isClosed));
    const totals = calculateNetWorth({
      accounts: lines.filter((l) => l.kind === 'account').map((l) => ({ accountClass: l.class, balanceCents: l.cents })),
      assetValuationsCents: lines.filter((l) => l.kind === 'asset').map((l) => l.cents),
    });
    const groups = (Object.keys(GROUP_LABEL) as Group[])
      .map((g) => {
        const items = lines.filter((l) => l.group === g);
        return { group: g, label: GROUP_LABEL[g], side: items[0]?.class ?? (g.startsWith('other_l') || ['mortgage', 'cards', 'loans', 'hecs'].includes(g) ? 'LIABILITY' : 'ASSET'), totalCents: items.reduce((s, l) => s + l.cents, 0), items: items.map(({ id, name, kind, cents: c, valuedOn }) => ({ id, name, kind, cents: c, valuedOn })) };
      })
      .filter((g) => g.items.length);
    return { date, ...totals, groups };
  }

  /** Month-end net worth for every month in a range (the current month ends today). */
  async function series(householdId: string, from: string, to: string) {
    const t = await today(householdId);
    const end = to < t ? to : t;
    const dates: string[] = [];
    const f = parseDateOnly(from);
    let y = f.year;
    let m = f.month;
    for (let i = 0; i < 240; i++) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const d = formatDateOnly(y, m, last);
      dates.push(d < end ? d : end);
      if (d >= end) break;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    const list = (await listAccounts(db, householdId, { includeClosed: true })).filter((a) => a.includeInNetWorth);
    const vals = await valuationsAsOf(householdId, dates);
    return Promise.all(
      dates.map(async (d, i) => {
        const balances = await accounts.balancesFor(householdId, list, dateIn(d));
        const totals = calculateNetWorth({
          accounts: list.map((a) => ({ accountClass: a.class, balanceCents: balances.get(a.id) ?? 0 })),
          assetValuationsCents: vals[i]!.map((v) => v.valueCents),
        });
        return { date: d, ...totals };
      }),
    );
  }

  async function serializeAsset(householdId: string, id: string) {
    const a = await db.asset.findFirst({ where: { householdId, id }, include: { valuations: { orderBy: { date: 'desc' } } } });
    if (!a) throw notFound('Asset');
    const latest = a.valuations[0];
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      includeInNetWorth: a.includeInNetWorth,
      isActive: a.isActive,
      notes: a.notes,
      valueCents: latest ? cents(latest.valueCents) : 0,
      valuedOn: latest ? dateOut(latest.date) : null,
      valuations: a.valuations.map((v) => ({ id: v.id, date: dateOut(v.date), valueCents: cents(v.valueCents), notes: v.notes })),
    };
  }

  return {
    at,
    series,
    today,

    async listAssets(householdId: string) {
      const rows = await db.asset.findMany({ where: { householdId }, orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }], select: { id: true } });
      return Promise.all(rows.map((r) => serializeAsset(householdId, r.id)));
    },

    async createAsset(householdId: string, input: AssetInput) {
      const date = input.valuedOn ?? (await today(householdId));
      const a = await db.asset.create({
        data: {
          householdId,
          name: input.name,
          type: input.type,
          includeInNetWorth: input.includeInNetWorth ?? true,
          isActive: input.isActive ?? true,
          notes: input.notes ?? null,
          ...(input.valueCents !== undefined ? { valuations: { create: { householdId, date: dateIn(date), valueCents: BigInt(input.valueCents) } } } : {}),
        },
      });
      return serializeAsset(householdId, a.id);
    },

    async updateAsset(householdId: string, id: string, input: AssetInput) {
      await serializeAsset(householdId, id);
      await db.asset.updateMany({
        where: { householdId, id },
        data: { name: input.name, type: input.type, includeInNetWorth: input.includeInNetWorth ?? true, isActive: input.isActive ?? true, notes: input.notes ?? null },
      });
      return serializeAsset(householdId, id);
    },

    async deleteAsset(householdId: string, id: string) {
      await serializeAsset(householdId, id);
      await db.asset.deleteMany({ where: { householdId, id } });
    },

    /** Records a dated value. One valuation per asset per day: a second one replaces it. */
    async addValuation(householdId: string, id: string, input: { date: string; valueCents: number; notes?: string | null }) {
      await serializeAsset(householdId, id);
      if (input.valueCents < 0) throw validationError('A value can’t be negative', { field: 'valueCents' });
      await db.assetValuation.upsert({
        where: { assetId_date: { assetId: id, date: dateIn(input.date) } },
        create: { householdId, assetId: id, date: dateIn(input.date), valueCents: BigInt(input.valueCents), notes: input.notes ?? null },
        update: { valueCents: BigInt(input.valueCents), notes: input.notes ?? null },
      });
      return serializeAsset(householdId, id);
    },

    async deleteValuation(householdId: string, id: string, valuationId: string) {
      await serializeAsset(householdId, id);
      const r = await db.assetValuation.deleteMany({ where: { householdId, assetId: id, id: valuationId } });
      if (r.count === 0) throw notFound('Valuation');
      return serializeAsset(householdId, id);
    },

    async snapshots(householdId: string) {
      const rows = await db.netWorthSnapshot.findMany({ where: { householdId }, orderBy: { date: 'asc' } });
      return rows.map((r) => ({ date: dateOut(r.date), assetsCents: cents(r.assetsCents), liabilitiesCents: cents(r.liabilitiesCents), netWorthCents: cents(r.assetsCents) - cents(r.liabilitiesCents) }));
    },

    /**
     * Stores a snapshot for the 1st of the current month in each household's time
     * zone, if missing (spec §12). History can always be recomputed, so a missed
     * run loses nothing.
     */
    async snapshotAll() {
      const households = await db.household.findMany({ select: { id: true, timezone: true } });
      let created = 0;
      for (const h of households) {
        const local = dateInTimeZone(deps.now(), h.timezone);
        const first = `${local.slice(0, 8)}01`;
        const exists = await db.netWorthSnapshot.findUnique({ where: { householdId_date: { householdId: h.id, date: dateIn(first) } } });
        if (exists) continue;
        const nw = await at(h.id, first);
        await db.netWorthSnapshot.upsert({
          where: { householdId_date: { householdId: h.id, date: dateIn(first) } },
          create: { householdId: h.id, date: dateIn(first), assetsCents: BigInt(nw.assetsCents), liabilitiesCents: BigInt(nw.liabilitiesCents) },
          update: {},
        });
        created++;
      }
      return { created };
    },
  };
}

export type NetWorthService = ReturnType<typeof createNetWorthService>;
