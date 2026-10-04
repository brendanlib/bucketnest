import type { Prisma } from '@prisma/client';
import type { Deps } from './context.js';
import { getHousehold, updateHousehold } from '../repositories/households.js';
import { validationError } from '../lib/errors.js';
import { dateIn, dateOut, decimalOut } from '../lib/serialize.js';
import { isValidTimeZone } from '../finance/dates.js';

export interface SettingsInput {
  name?: string;
  currency?: string;
  locale?: string;
  timezone?: string;
  fyStartMonth?: number;
  weekStartDay?: number;
  budgetPeriodType?: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'ANNUAL';
  budgetAnchorDate?: string;
  displayFrequency?: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'ANNUALLY';
  allocationBasis?: 'PLANNED' | 'ACTUAL';
  amberThreshold?: number;
  redThreshold?: number;
  debtPayoffStrategy?: 'SNOWBALL' | 'AVALANCHE';
  gstEnabled?: boolean;
}

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

function canonicalLocale(locale: string): string | null {
  try {
    const [canonical] = Intl.getCanonicalLocales(locale);
    return canonical ?? null;
  } catch {
    return null;
  }
}

export function serializeSettings(h: Prisma.HouseholdGetPayload<object>) {
  return {
    id: h.id,
    name: h.name,
    currency: h.currency,
    locale: h.locale,
    timezone: h.timezone,
    fyStartMonth: h.fyStartMonth,
    weekStartDay: h.weekStartDay,
    budgetPeriodType: h.budgetPeriodType,
    budgetAnchorDate: dateOut(h.budgetAnchorDate),
    displayFrequency: h.displayFrequency as SettingsInput['displayFrequency'] & string,
    allocationBasis: h.allocationBasis,
    amberThreshold: Number(decimalOut(h.amberThreshold)),
    redThreshold: Number(decimalOut(h.redThreshold)),
    debtPayoffStrategy: h.debtPayoffStrategy,
    gstEnabled: h.gstEnabled,
  };
}

export function createSettingsService(deps: Deps) {
  const { db } = deps;
  return {
    async get(householdId: string) {
      return serializeSettings(await getHousehold(db, householdId));
    },

    async update(householdId: string, input: SettingsInput) {
      const current = await getHousehold(db, householdId);
      const data: Prisma.HouseholdUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.currency !== undefined) {
        const c = input.currency.toUpperCase();
        if (!CURRENCIES.has(c)) throw validationError(`Unknown currency ${input.currency}`, { field: 'currency' });
        data.currency = c;
      }
      if (input.locale !== undefined) {
        const l = canonicalLocale(input.locale);
        if (!l) throw validationError(`Unknown locale ${input.locale}`, { field: 'locale' });
        data.locale = l;
      }
      if (input.timezone !== undefined) {
        if (!isValidTimeZone(input.timezone)) throw validationError(`Unknown time zone ${input.timezone}`, { field: 'timezone' });
        data.timezone = input.timezone;
      }
      if (input.fyStartMonth !== undefined) data.fyStartMonth = input.fyStartMonth;
      if (input.weekStartDay !== undefined) data.weekStartDay = input.weekStartDay;
      if (input.budgetPeriodType !== undefined) data.budgetPeriodType = input.budgetPeriodType;
      if (input.budgetAnchorDate !== undefined) data.budgetAnchorDate = dateIn(input.budgetAnchorDate);
      if (input.displayFrequency !== undefined) data.displayFrequency = input.displayFrequency;
      if (input.allocationBasis !== undefined) data.allocationBasis = input.allocationBasis;
      if (input.debtPayoffStrategy !== undefined) data.debtPayoffStrategy = input.debtPayoffStrategy;
      if (input.gstEnabled !== undefined) data.gstEnabled = input.gstEnabled;

      const amber = input.amberThreshold ?? Number(current.amberThreshold);
      const red = input.redThreshold ?? Number(current.redThreshold);
      if (amber > red) throw validationError('The amber threshold must not be above the red threshold', { field: 'amberThreshold' });
      if (input.amberThreshold !== undefined) data.amberThreshold = input.amberThreshold.toFixed(2);
      if (input.redThreshold !== undefined) data.redThreshold = input.redThreshold.toFixed(2);

      const updated = await updateHousehold(db, householdId, data);
      // The active budget follows the household's budget period settings.
      if (input.budgetPeriodType !== undefined || input.budgetAnchorDate !== undefined) {
        await db.budget.updateMany({
          where: { householdId, isActive: true },
          data: { periodType: updated.budgetPeriodType, anchorDate: updated.budgetAnchorDate },
        });
      }
      return serializeSettings(updated);
    },
  };
}
