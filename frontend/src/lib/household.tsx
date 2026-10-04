import { createContext, useContext, type ReactNode } from 'react';
import type { Me } from '../api/types';

export interface HouseholdCtx {
  currency: string;
  locale: string;
  timezone: string;
  me: Me | null;
}

const fallback: HouseholdCtx = { currency: 'AUD', locale: 'en-AU', timezone: 'Australia/Sydney', me: null };
const Ctx = createContext<HouseholdCtx>(fallback);

export function HouseholdProvider({ me, children }: { me: Me | null; children: ReactNode }) {
  const value = me ? { currency: me.household.currency, locale: me.household.locale, timezone: me.household.timezone, me } : fallback;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useHousehold = () => useContext(Ctx);
