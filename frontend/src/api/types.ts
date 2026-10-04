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

export type Frequency =
  | 'WEEKLY'
  | 'FORTNIGHTLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SIX_MONTHLY'
  | 'ANNUALLY'
  | 'EVERY_N_DAYS'
  | 'EVERY_N_WEEKS'
  | 'EVERY_N_MONTHS';

export type BudgetStatus = 'none' | 'ok' | 'amber' | 'red' | 'unbudgeted';

export interface Variance {
  budgetCents: number;
  actualCents: number;
  remainingCents: number;
  percentUsed: number | null;
  status: BudgetStatus;
}

export interface BudgetItem {
  categoryId: string;
  amountCents: number;
  enteredFrequency: Frequency;
  frequencyInterval: number | null;
  notes: string | null;
  periodAmountCents: number;
}

export interface Budget {
  id: string;
  name: string;
  periodType: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'ANNUAL';
  anchorDate: string;
  isActive: boolean;
  items: BudgetItem[];
}

export interface PeriodInfo {
  start: string;
  end: string;
  previousStart: string;
  nextStart: string;
  isCurrent: boolean;
  today: string;
}

export interface BudgetLine extends Variance {
  categoryId: string;
  name: string;
  hasItem: boolean;
  isActive: boolean;
}

export interface BudgetGroup extends Variance {
  groupId: string | null;
  name: string;
  lines: BudgetLine[];
}

export interface BudgetBucket extends Variance {
  bucketId: string;
  key: BucketKey;
  name: string;
  colour: string;
  percentage: string;
  allocatedCents: number;
  overAllocatedCents: number;
  allocation: Variance;
  groups: BudgetGroup[];
}

export interface Normalised {
  weekly: number;
  fortnightly: number;
  monthly: number;
  annual: number;
}

export interface BudgetSummary {
  budget: Budget;
  period: PeriodInfo;
  income: {
    plannedCents: number;
    plannedSource: 'schedules' | 'budget' | 'none';
    actualCents: number;
    scheduledActualCents: number;
    expected: Normalised;
    allocationBasis: 'PLANNED' | 'ACTUAL';
    allocationIncomeCents: number;
    variance: Variance;
  };
  buckets: BudgetBucket[];
  total: Variance;
  incomeLines: { categoryId: string; name: string; budgetCents: number; actualCents: number }[];
  thresholds: { amber: number; red: number };
}

export type RecurringType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'DEBT_REPAYMENT' | 'SAVINGS_CONTRIBUTION';

export interface Recurring {
  id: string;
  name: string;
  type: RecurringType;
  amountCents: number;
  amountKind: 'FIXED' | 'ESTIMATE';
  frequency: Frequency;
  interval: number | null;
  startDate: string;
  endDate: string | null;
  occurrenceCount: number | null;
  weekendRule: 'NONE' | 'PREVIOUS_BUSINESS_DAY' | 'NEXT_BUSINESS_DAY';
  autoPost: boolean;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  bucketKey: BucketKey | null;
  payee: string | null;
  notes: string | null;
  isActive: boolean;
  normalised: Normalised;
  nextOccurrence: { occurrenceDate: string; date: string; amountCents: number; overdue: boolean } | null;
}

export type OccurrenceStatus = 'posted' | 'skipped' | 'overdue' | 'due' | 'upcoming';

export interface Occurrence {
  recurringId: string;
  name: string;
  type: RecurringType;
  amountKind: 'FIXED' | 'ESTIMATE';
  accountName: string;
  toAccountName: string | null;
  categoryName: string | null;
  bucketKey: BucketKey | null;
  autoPost: boolean;
  occurrenceDate: string;
  date: string;
  amountCents: number;
  skipped: boolean;
  edited: boolean;
  status: OccurrenceStatus;
  transactionId: string | null;
}

export interface DashboardBucket {
  bucketId: string;
  key: BucketKey;
  name: string;
  colour: string;
  percentage: string;
  allocatedCents: number;
  actualCents: number;
  remainingCents: number;
  percentUsed: number | null;
  percentOfIncome: number | null;
  status: BudgetStatus;
  plannedCents: number;
  overAllocatedCents: number;
  fire?: { savingsCents: number; investmentCents: number; extraRepaymentsCents: number; principalReducedCents: number; goals: unknown[] };
}

export interface Dashboard {
  budget: { id: string; name: string; periodType: string };
  period: PeriodInfo;
  income: {
    expected: Normalised;
    plannedCents: number;
    plannedSource: 'schedules' | 'budget' | 'none';
    actualCents: number;
    scheduledCents: number;
    otherCents: number;
    allocationBasis: 'PLANNED' | 'ACTUAL';
    allocationIncomeCents: number;
  };
  buckets: DashboardBucket[];
  billsDue: Occurrence[];
  alerts: { categoryId: string; name: string; bucketKey: string; bucketName: string; colour: string; budgetCents: number; actualCents: number; remainingCents: number; percentUsed: number | null; status: 'amber' | 'red' }[];
  netWorth: { assetsCents: number; liabilitiesCents: number; netWorthCents: number; date: string; history: { date: string; netWorthCents: number }[] };
  uncategorisedCount: number;
}

/** What "mark paid" pre-fills, and what the post endpoint accepts. */
export interface TransactionDraft {
  date: string;
  description: string;
  payee?: string | null;
  amountCents: number;
  type: TransactionType;
  accountId: string;
  toAccountId?: string | null;
  splits?: { categoryId: string; amountCents: number }[];
  notes?: string | null;
}
