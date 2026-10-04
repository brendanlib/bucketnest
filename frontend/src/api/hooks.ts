import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, qs } from './client';
import type { Account, BalanceHistory, Bucket, Category, Me, Page, SessionInfo, Settings, Transaction } from './types';

export const keys = {
  me: ['me'] as const,
  registration: ['registration'] as const,
  settings: ['settings'] as const,
  buckets: ['buckets'] as const,
  categories: (includeInactive = false) => ['categories', { includeInactive }] as const,
  accounts: (includeClosed = false) => ['accounts', { includeClosed }] as const,
  account: (id: string) => ['accounts', id] as const,
  balanceHistory: (id: string, from?: string, to?: string) => ['accounts', id, 'history', { from, to }] as const,
  transactions: (params: Record<string, unknown>) => ['transactions', params] as const,
  sessions: ['sessions'] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/auth/me'), retry: false, staleTime: 60_000 });
export const useRegistration = () =>
  useQuery({ queryKey: keys.registration, queryFn: () => api.get<{ open: boolean; passwordReset: 'email' | 'cli' }>('/auth/registration') });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api.get<Settings>('/settings') });
export const useBuckets = () =>
  useQuery({ queryKey: keys.buckets, queryFn: async () => (await api.get<{ items: Bucket[] }>('/buckets')).items });
export const useCategories = (includeInactive = false) =>
  useQuery({
    queryKey: keys.categories(includeInactive),
    queryFn: async () => (await api.get<{ items: Category[] }>(`/categories${qs({ includeInactive })}`)).items,
  });
export const useAccounts = (includeClosed = false) =>
  useQuery({
    queryKey: keys.accounts(includeClosed),
    queryFn: async () => (await api.get<{ items: Account[] }>(`/accounts${qs({ includeClosed })}`)).items,
  });
export const useAccount = (id: string) => useQuery({ queryKey: keys.account(id), queryFn: () => api.get<Account>(`/accounts/${id}`) });
export const useBalanceHistory = (id: string, from?: string, to?: string) =>
  useQuery({ queryKey: keys.balanceHistory(id, from, to), queryFn: () => api.get<BalanceHistory>(`/accounts/${id}/balance-history${qs({ from, to })}`) });

export interface TransactionQuery {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  accountId?: string;
  bucketId?: string;
  categoryId?: string;
  type?: string[];
  minCents?: number;
  maxCents?: number;
  search?: string;
  uncategorised?: boolean;
  sort: string;
  order: 'asc' | 'desc';
}

export const useTransactions = (q: TransactionQuery) =>
  useQuery({
    queryKey: keys.transactions(q as unknown as Record<string, unknown>),
    queryFn: () => api.get<Page<Transaction>>(`/transactions${qs(q as never)}`),
    placeholderData: (prev) => prev,
  });

export const useSessions = () =>
  useQuery({ queryKey: keys.sessions, queryFn: async () => (await api.get<{ items: SessionInfo[] }>('/auth/sessions')).items });

/** A mutation that refetches the given queries afterwards. Money changes touch balances, so most invalidate accounts too. */
export function useApiMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, invalidate: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
    },
  });
}

export const MONEY_QUERIES: QueryKey[] = [['transactions'], ['accounts'], ['categories'], ['dashboard'], ['budgets']];
