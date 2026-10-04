export type BucketKey = 'BILLS' | 'SMILE' | 'SPLURGE' | 'FIRE_EXTINGUISHER';

export interface Me {
  user: { id: string; email: string; name: string };
  household: { id: string; name: string; role: 'OWNER' | 'MEMBER'; currency: string; locale: string; timezone: string };
}

export interface Bucket {
  id: string;
  key: BucketKey;
  name: string;
  percentage: string;
  sortOrder: number;
  colour: string;
}

export interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  bucketId: string | null;
  parentId: string | null;
  isGroup: boolean;
  isActive: boolean;
  isSystem: boolean;
  systemKey: string | null;
  sortOrder: number;
  transactionCount?: number;
}

export type AccountType =
  | 'TRANSACTION'
  | 'SAVINGS'
  | 'OFFSET'
  | 'CASH'
  | 'INVESTMENT'
  | 'SUPERANNUATION'
  | 'OTHER_ASSET'
  | 'CREDIT_CARD'
  | 'MORTGAGE'
  | 'PERSONAL_LOAN'
  | 'CAR_LOAN'
  | 'HECS_HELP'
  | 'OTHER_LIABILITY';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  class: 'ASSET' | 'LIABILITY';
  institution: string | null;
  openingBalanceCents: number;
  openingDate: string;
  balanceCents: number;
  last4: string | null;
  bucketTagId: string | null;
  includeInBudget: boolean;
  includeInNetWorth: boolean;
  repaymentTreatment: 'TRANSFER' | 'DEBT_REPAYMENT' | null;
  offsetForAccountId: string | null;
  hasDebtProfile: boolean;
  notes: string | null;
  isClosed: boolean;
  sortOrder: number;
}

export type TransactionType =
  | 'INCOME'
  | 'EXPENSE'
  | 'REFUND'
  | 'TRANSFER'
  | 'DEBT_REPAYMENT'
  | 'SAVINGS_CONTRIBUTION'
  | 'BALANCE_ADJUSTMENT'
  | 'INTEREST_CHARGE';

export interface Split {
  id: string;
  categoryId: string;
  categoryName: string;
  bucketId: string | null;
  amountCents: number;
  isExtraRepayment: boolean;
  isSinkingFundPayment: boolean;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  payee: string | null;
  amountCents: number;
  type: TransactionType;
  direction: 'INCREASE' | 'DECREASE' | null;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  splits: Split[];
  buckets: { id: string; key: string; name: string; colour: string }[];
  uncategorised: boolean;
  notes: string | null;
  cleared: boolean;
  recurringId: string | null;
  occurrenceDate: string | null;
  importBatchId: string | null;
  goalId: string | null;
  gstCents: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Settings {
  id: string;
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  fyStartMonth: number;
  weekStartDay: number;
  budgetPeriodType: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'ANNUAL';
  budgetAnchorDate: string;
  displayFrequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'ANNUALLY';
  allocationBasis: 'PLANNED' | 'ACTUAL';
  amberThreshold: number;
  redThreshold: number;
  debtPayoffStrategy: 'SNOWBALL' | 'AVALANCHE';
  gstEnabled: boolean;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface BalanceHistory {
  accountId: string;
  from: string;
  to: string;
  openingBalanceCents: number;
  points: { date: string; balanceCents: number }[];
}
