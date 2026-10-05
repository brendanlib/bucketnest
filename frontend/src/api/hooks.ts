import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, qs } from './client';
import type { Account, BalanceHistory, Bucket, Budget, BudgetSummary, Category, Dashboard, Debt, Goal, ImportBatch, Me, Occurrence, Page, PayoffComparison, PayoffPlan, Recurring, Rule, SessionInfo, Settings, SinkingFund, Transaction } from './types';

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
  budgets: ['budgets'] as const,
  budgetSummary: (id: string, period?: string, includeEmpty?: boolean) => ['budgets', id, 'summary', { period, includeEmpty }] as const,
  recurring: ['recurring'] as const,
  occurrences: (from: string, to: string) => ['recurring', 'occurrences', { from, to }] as const,
  dashboard: (period?: string, basis?: string) => ['dashboard', { period, basis }] as const,
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
  importBatchId?: string;
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

export const useBudgets = () => useQuery({ queryKey: keys.budgets, queryFn: async () => (await api.get<{ items: Budget[] }>('/budgets')).items });
export const useBudgetSummary = (id: string | undefined, period?: string, includeEmpty?: boolean) =>
  useQuery({
    queryKey: keys.budgetSummary(id ?? '', period, includeEmpty),
    queryFn: () => api.get<BudgetSummary>(`/budgets/${id}/summary${qs({ period, includeEmpty })}`),
    enabled: Boolean(id),
    placeholderData: (prev) => prev,
  });
export const useRecurring = () =>
  useQuery({ queryKey: keys.recurring, queryFn: async () => (await api.get<{ items: Recurring[] }>('/recurring-transactions?includeInactive=true')).items });
export const useOccurrences = (from: string, to: string) =>
  useQuery({
    queryKey: keys.occurrences(from, to),
    queryFn: async () => (await api.get<{ items: Occurrence[] }>(`/recurring-transactions/occurrences${qs({ from, to })}`)).items,
  });
export const useDashboard = (period?: string, basis?: 'PLANNED' | 'ACTUAL') =>
  useQuery({ queryKey: keys.dashboard(period, basis), queryFn: () => api.get<Dashboard>(`/dashboard${qs({ period, basis })}`), placeholderData: (prev) => prev });

export const useImportBatches = () =>
  useQuery({ queryKey: ['imports'], queryFn: async () => (await api.get<{ items: ImportBatch[] }>('/import/batches')).items });
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: async () => (await api.get<{ items: Rule[] }>('/rules')).items });

export const useSinkingFunds = () =>
  useQuery({ queryKey: ['sinking-funds'], queryFn: async () => (await api.get<{ items: SinkingFund[] }>('/sinking-funds')).items });
export const useSinkingFund = (id: string) => useQuery({ queryKey: ['sinking-funds', id], queryFn: () => api.get<SinkingFund>(`/sinking-funds/${id}`) });
export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: async () => (await api.get<{ items: Goal[] }>('/goals')).items });
export const useDebts = () => useQuery({ queryKey: ['debts'], queryFn: async () => (await api.get<{ items: Debt[] }>('/debts')).items });
export const usePayoff = (id: string, extraCents?: number) =>
  useQuery({ queryKey: ['debts', id, 'payoff', extraCents], queryFn: () => api.get<PayoffComparison>(`/debts/${id}/payoff${qs({ extraCents })}`), placeholderData: (p) => p });
export const usePayoffPlan = (strategy?: string, extraMonthlyCents?: number) =>
  useQuery({ queryKey: ['debts', 'plan', strategy, extraMonthlyCents], queryFn: () => api.get<PayoffPlan>(`/debts/plan${qs({ strategy, extraMonthlyCents })}`), placeholderData: (p) => p });

/** Anything that moves money can change balances, budgets, the dashboard and occurrence status. */
export const MONEY_QUERIES: QueryKey[] = [['transactions'], ['accounts'], ['categories'], ['dashboard'], ['budgets'], ['recurring'], ['imports'], ['sinking-funds'], ['goals'], ['debts']];
