import type { AccountType, TransactionType } from '../api/types';

/** All user-facing labels for terms that vary by country. Another locale file can relabel them. */
export const strings = {
  appName: 'Home Budget',
  accountTypes: {
    TRANSACTION: 'Transaction',
    SAVINGS: 'Savings',
    OFFSET: 'Offset',
    CASH: 'Cash',
    INVESTMENT: 'Investment',
    SUPERANNUATION: 'Superannuation',
    OTHER_ASSET: 'Other asset',
    CREDIT_CARD: 'Credit card',
    MORTGAGE: 'Mortgage',
    PERSONAL_LOAN: 'Personal loan',
    CAR_LOAN: 'Car loan',
    HECS_HELP: 'HECS/HELP',
    OTHER_LIABILITY: 'Other liability',
  } satisfies Record<AccountType, string>,
  transactionTypes: {
    EXPENSE: 'Expense',
    INCOME: 'Income',
    REFUND: 'Refund',
    TRANSFER: 'Transfer',
    DEBT_REPAYMENT: 'Debt repayment',
    SAVINGS_CONTRIBUTION: 'Savings contribution',
    BALANCE_ADJUSTMENT: 'Balance adjustment',
    INTEREST_CHARGE: 'Interest charge',
  } satisfies Record<TransactionType, string>,
  transactionTypeHelp: {
    EXPENSE: 'Money spent. Counts as spending in its category’s bucket.',
    INCOME: 'Take-home pay and other income into an account.',
    REFUND: 'Money back for a purchase. Reduces that category’s spending.',
    TRANSFER: 'Between your own accounts. Never income or spending.',
    DEBT_REPAYMENT: 'From an account to a loan or card. Split automatically into the minimum (Bills) and any extra (Fire Extinguisher).',
    SAVINGS_CONTRIBUTION: 'Into a Fire Extinguisher savings account. Counts toward Fire Extinguisher.',
    BALANCE_ADJUSTMENT: 'Corrects a balance to match a statement. Neither income nor spending.',
    INTEREST_CHARGE: 'Interest charged on a loan. Card interest is recorded as an Interest and fees expense.',
  } satisfies Record<TransactionType, string>,
  repaymentTreatments: {
    TRANSFER: 'Transfer — spending is counted at purchase',
    DEBT_REPAYMENT: 'Debt repayment — minimum is a Bills cost, extra is Fire Extinguisher',
  },
  frequencies: {
    WEEKLY: 'Weekly',
    FORTNIGHTLY: 'Fortnightly',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
    SIX_MONTHLY: 'Six-monthly',
    ANNUALLY: 'Annually',
    ANNUAL: 'Annual',
  } as Record<string, string>,
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

export const ASSET_TYPES: AccountType[] = ['TRANSACTION', 'SAVINGS', 'OFFSET', 'CASH', 'INVESTMENT', 'SUPERANNUATION', 'OTHER_ASSET'];
export const LIABILITY_TYPES: AccountType[] = ['CREDIT_CARD', 'MORTGAGE', 'PERSONAL_LOAN', 'CAR_LOAN', 'HECS_HELP', 'OTHER_LIABILITY'];
