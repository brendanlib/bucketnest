export type BucketKey = 'BILLS' | 'SMILE' | 'SPLURGE' | 'FIRE_EXTINGUISHER';

export interface Me {
  user: { id: string; email: string; name: string; dismissedTips: string[] };
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
  forecastMethod: 'AVG3' | 'AVG6' | 'AVG12' | 'MANUAL' | null;
  forecastManualCents: number | null;
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
  sinkingFundId: string | null;
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
  forecastMethod: 'AVG3' | 'AVG6' | 'AVG12' | 'MANUAL';
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
  sinkingFundId?: string;
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
  fire?: {
    savingsCents: number;
    investmentCents: number;
    extraRepaymentsCents: number;
    principalReducedCents: number;
    goals: { id: string; name: string; type: string; targetCents: number; currentCents: number; progressPercent: number | null; onTrack: boolean | null }[];
  };
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
  watch: { kind: 'sinking_fund' | 'goal'; id: string; name: string; date: string | null; targetCents: number; currentCents: number; shortfallCents: number; status: 'due_soon' | 'due_short' | 'behind' }[];
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
  splits?: { categoryId: string; amountCents: number; sinkingFundId?: string | null }[];
  notes?: string | null;
}

export type DateFormat = 'DD/MM/YYYY' | 'D/M/YY' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD MMM YYYY';
export type SignConvention = 'NEGATIVE_IS_DEBIT' | 'POSITIVE_IS_DEBIT' | 'DEBIT_CREDIT_COLUMNS';

export interface ColumnMapping {
  delimiter: string;
  hasHeader: boolean;
  dateFormat: DateFormat;
  signConvention: SignConvention;
  dateColumn: number;
  descriptionColumn: number;
  amountColumn?: number | null;
  debitColumn?: number | null;
  creditColumn?: number | null;
  balanceColumn?: number | null;
  payeeColumn?: number | null;
}

export type ImportAction = 'import' | 'skip' | 'match' | 'merge';

export interface ImportRow {
  index: number;
  raw: string[];
  date: string | null;
  description: string;
  payee: string | null;
  amountCents: number | null;
  direction: 'debit' | 'credit' | null;
  balanceCents: number | null;
  errors: string[];
  fingerprint: string | null;
  status: 'error' | 'duplicate' | 'new';
  duplicateOf: string | null;
  match: { recurringId: string; occurrenceDate: string; name: string; date: string; amountCents: number } | null;
  merge: { transactionId: string; date: string; description: string; type: string } | null;
  suggestion: {
    type: TransactionType;
    categoryId: string | null;
    toAccountId: string | null;
    fromAccountId: string | null;
    payee: string | null;
    notes: string | null;
    ruleId: string | null;
    ruleName: string | null;
  } | null;
  defaultAction: ImportAction;
}

export interface ParseResult {
  accountId: string;
  mapping: ColumnMapping;
  profileUsed: boolean;
  columns: string[];
  sample: string[][];
  summary: { total: number; new: number; duplicates: number; errors: number; matched: number; merges: number; categorised: number };
  balanceCheck: { date: string; statementBalanceCents: number; appBalanceBeforeCents: number; appBalanceAfterCents: number; differenceCents: number } | null;
  rows: ImportRow[];
}

export interface ImportDecision {
  index: number;
  action: ImportAction;
  type?: 'EXPENSE' | 'INCOME' | 'REFUND' | 'TRANSFER';
  categoryId?: string | null;
  otherAccountId?: string | null;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string;
  rowCount: number;
  importedCount: number;
  matchedCount: number;
  mergedCount: number;
  skippedCount: number;
  status: 'COMMITTED' | 'UNDONE';
  createdAt: string;
  undoneAt: string | null;
}

export interface Rule {
  id: string;
  name: string | null;
  priority: number;
  matchField: 'DESCRIPTION' | 'PAYEE';
  matchType: 'CONTAINS' | 'STARTS_WITH' | 'EQUALS';
  matchValue: string;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  direction: 'ANY' | 'DEBIT' | 'CREDIT';
  accountId: string | null;
  accountName: string | null;
  setCategoryId: string | null;
  setCategoryName: string | null;
  setType: 'EXPENSE' | 'INCOME' | 'REFUND' | 'TRANSFER' | null;
  setToAccountId: string | null;
  setToAccountName: string | null;
  setPayee: string | null;
  addNote: string | null;
  isActive: boolean;
}

export interface SinkingFund {
  id: string;
  name: string;
  targetCents: number;
  dueDate: string;
  targetSource: 'schedule' | 'fund';
  ownTargetCents: number;
  ownDueDate: string;
  contributionFrequency: Frequency;
  contributionInterval: number | null;
  contributionAnchorDate: string;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  bucketKey: BucketKey | null;
  recurringId: string | null;
  recurringName: string | null;
  repeats: boolean;
  manualCurrentCents: number | null;
  isActive: boolean;
  notes: string | null;
  currentCents: number;
  currentSource: 'account' | 'contributions';
  contributionsCents: number;
  paymentsCents: number;
  remainingCents: number;
  progressPercent: number | null;
  datesLeft: number;
  recommendedContributionCents: number;
  status: 'funded' | 'on_track' | 'due_soon' | 'due_short';
  shortfallCents: number;
  contributions?: { id: string; date: string; amountCents: number; transactionId: string | null; notes: string | null }[];
}

export interface Goal {
  id: string;
  name: string;
  type: 'EMERGENCY_FUND' | 'SAVINGS' | 'INVESTMENT';
  targetCents: number;
  targetDate: string | null;
  priority: number;
  accountId: string | null;
  accountName: string | null;
  manualCurrentCents: number | null;
  contributionCents: number | null;
  contributionFrequency: Frequency | null;
  contributionInterval: number | null;
  isActive: boolean;
  notes: string | null;
  currentCents: number;
  currentSource: 'account' | 'manual';
  contributedCents: number;
  progressPercent: number | null;
  remainingCents: number;
  reached: boolean;
  requiredContributionCents: number | null;
  projectedDate: string | null;
  onTrack: boolean | null;
}

export type DebtWarning = 'REPAYMENT_TOO_LOW' | 'NOT_WITHIN_LIMIT' | null;

export interface Debt {
  id: string;
  accountId: string;
  accountName: string;
  accountType: AccountType;
  originalBalanceCents: number;
  currentBalanceCents: number;
  annualRate: string;
  minRepaymentCents: number;
  repaymentFrequency: Frequency;
  repaymentInterval: number | null;
  extraRepaymentCents: number;
  dueDay: number | null;
  startDate: string | null;
  categoryId: string | null;
  categoryName: string | null;
  indexationOnly: boolean;
  includeInPayoff: boolean;
  offsetAccounts: { id: string; name: string }[];
  offsetCents: number;
  repaidCents: number;
  percentRepaid: number | null;
  principalReducedThisPeriodCents: number;
  nextInterestCents: number;
  payoffDate: string | null;
  totalInterestCents: number;
  repayments: number;
  warning: DebtWarning;
  minimumOnlyPayoffDate: string | null;
  minimumOnlyInterestCents: number;
}

export interface DebtPeriod {
  date: string;
  openingCents: number;
  interestCents: number;
  paymentCents: number;
  principalCents: number;
  closingCents: number;
}

export interface PayoffResult {
  paidOff: boolean;
  warning: DebtWarning;
  payoffDate: string | null;
  totalInterestCents: number;
  repayments: number;
  nextInterestCents: number;
  schedule: DebtPeriod[];
}

export interface PayoffComparison {
  debtId: string;
  accountName: string;
  balanceCents: number;
  offsetCents: number;
  extraCents: number;
  monthsSaved: number | null;
  interestSavedCents: number | null;
  minimum: PayoffResult;
  withExtra: PayoffResult;
}

export interface PayoffPlan {
  strategy: 'SNOWBALL' | 'AVALANCHE';
  order: string[];
  debtFreeDate: string | null;
  totalInterestCents: number;
  months: number;
  extraMonthlyCents: number;
  debts: { id: string; name: string; balanceCents: number; annualRate: string; payoffDate: string | null; interestCents: number }[];
  timeline: { date: string; balanceCents: number }[];
  alternative: { strategy: string; debtFreeDate: string | null; totalInterestCents: number };
}

export type OnboardingStep = 'accounts' | 'income' | 'bills' | 'budget' | 'transactions' | 'savings';

export interface Onboarding {
  dismissed: boolean;
  showWelcome: boolean;
  steps: { key: OnboardingStep; done: boolean }[];
  completed: number;
  total: number;
}

export interface SpendingReport {
  from: string;
  to: string;
  totalCents: number;
  byBucket: { bucketId: string; key: BucketKey; name: string; colour: string; isSaving: boolean; amountCents: number }[];
  byCategory: { categoryId: string | null; name: string; bucketKey: BucketKey | null; amountCents: number }[];
  monthly: { month: string; totalCents: number; byBucket: Record<string, number> }[];
}

export interface IncomeReport {
  from: string;
  to: string;
  monthly: { month: string; incomeCents: number; spendingCents: number; savedCents: number; netCents: number; savingsRate: number | null }[];
  totals: { incomeCents: number; spendingCents: number; savedCents: number; netCents: number; savingsRate: number | null };
}

export interface BudgetActualReport {
  period: PeriodInfo;
  groupBy: 'category' | 'bucket';
  rows: ({ id: string; name: string; bucketKey: BucketKey } & Variance)[];
  total: Variance;
}

export interface NetWorthPoint {
  date: string;
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
}

export interface NetWorthBreakdown {
  date: string;
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  groups: { group: string; label: string; side: 'ASSET' | 'LIABILITY'; totalCents: number; items: { id: string; name: string; kind: 'account' | 'asset'; cents: number; valuedOn: string | null }[] }[];
}

export interface NetWorthReport {
  from: string;
  to: string;
  series: NetWorthPoint[];
  breakdown: NetWorthBreakdown;
  snapshots: NetWorthPoint[];
}

export interface DebtReductionItem {
  debtId: string;
  name: string;
  history: { date: string; balanceCents: number }[];
  projection: { date: string; balanceCents: number }[];
  payoffDate: string | null;
  warning: string | null;
}

export interface ForecastReport {
  method: string;
  months: string[];
  historyMonths: number;
  limitedHistory: boolean;
  categories: { categoryId: string; name: string; bucketId: string; method: string; baseCents: number; months: number[]; limitedHistory: boolean }[];
  buckets: { bucketId: string; key: BucketKey; name: string; colour: string; months: number[] }[];
  totals: { month: string; incomeCents: number; spendingCents: number; savingCents: number; netCents: number }[];
  accounts: { accountId: string; name: string; class: 'ASSET' | 'LIABILITY'; currentCents: number; monthEndCents: number[] }[];
}

export interface Asset {
  id: string;
  name: string;
  type: 'PROPERTY' | 'VEHICLE' | 'OTHER';
  includeInNetWorth: boolean;
  isActive: boolean;
  notes: string | null;
  valueCents: number;
  valuedOn: string | null;
  valuations: { id: string; date: string; valueCents: number; notes: string | null }[];
}

export interface CalendarItem {
  kind: 'occurrence' | 'sinking_fund' | 'goal';
  id: string;
  date: string;
  title: string;
  amountCents: number;
  type: string | null;
  bucketKey: BucketKey | null;
  colour: string | null;
  status: string;
  occurrence: Occurrence | null;
}

export type NotificationType = 'UPCOMING_BILL' | 'OVERSPENDING' | 'SINKING_FUND_DEADLINE' | 'BUDGET_REVIEW' | 'GOAL_MILESTONE';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationSetting {
  type: NotificationType;
  enabled: boolean;
  daysBefore: number | null;
  emailEnabled: boolean;
}
