import type { BucketKey, NotificationType } from '@prisma/client';

/**
 * Bucket colours are validated as a categorical set (colour-blind safe on all
 * pairs, light and dark): see docs/data-model.md. Dark mode uses darker steps.
 */
export const DEFAULT_BUCKETS: { key: BucketKey; name: string; percentage: string; colour: string; sortOrder: number }[] = [
  { key: 'BILLS', name: 'Bills', percentage: '60.00', colour: '#2A78D6', sortOrder: 1 },
  { key: 'SMILE', name: 'Smile', percentage: '10.00', colour: '#4A3AA7', sortOrder: 2 },
  { key: 'SPLURGE', name: 'Splurge', percentage: '10.00', colour: '#1BAF7A', sortOrder: 3 },
  { key: 'FIRE_EXTINGUISHER', name: 'Fire Extinguisher', percentage: '20.00', colour: '#EB6834', sortOrder: 4 },
];

/**
 * System keys mark the categories the financial rules rely on (spec §3.4–3.5).
 * They can be renamed and moved but not deleted or disabled.
 */
export const SYSTEM_CATEGORY = {
  mortgage: 'mortgage',
  interestAndFees: 'interest_and_fees',
  loanRepayments: 'loan_repayments',
  creditCardRepayments: 'credit_card_repayments',
  otherMandatoryRepayments: 'other_mandatory_repayments',
  extraDebtRepayments: 'extra_debt_repayments',
  emergencyFund: 'emergency_fund',
  savingsContributions: 'savings_contributions',
  investmentContributions: 'investment_contributions',
  salary: 'salary_and_wages',
  otherIncome: 'other_income',
} as const;

type CategorySeed = string | { name: string; systemKey: string };

interface GroupSeed {
  bucket: BucketKey | null;
  group: string;
  categories: CategorySeed[];
}

export const DEFAULT_CATEGORIES: GroupSeed[] = [
  {
    bucket: 'BILLS',
    group: 'Housing',
    categories: [
      { name: 'Mortgage', systemKey: SYSTEM_CATEGORY.mortgage },
      'Rent',
      'Council rates',
      'Body corporate',
      'Strata',
      'Home maintenance',
      'Home repairs',
    ],
  },
  { bucket: 'BILLS', group: 'Utilities', categories: ['Electricity', 'Gas', 'Water', 'Internet', 'Mobile phone', 'Home phone'] },
  {
    bucket: 'BILLS',
    group: 'Insurance',
    categories: [
      'Home insurance',
      'Contents insurance',
      'Car insurance',
      'Private health insurance',
      'Life insurance',
      'Income protection',
      'Pet insurance',
      'Other insurance',
    ],
  },
  {
    bucket: 'BILLS',
    group: 'Transport',
    categories: [
      'Fuel',
      'Public transport',
      'Car registration (rego)',
      'Car servicing',
      'Car repairs',
      'Tyres',
      'Roadside assistance',
      'Parking',
      'Tolls',
    ],
  },
  { bucket: 'BILLS', group: 'Food', categories: ['Groceries', 'Household supplies', 'Cleaning products', 'Pet food'] },
  {
    bucket: 'BILLS',
    group: 'Health',
    categories: ['Doctor', 'Dentist', 'Pharmacy', 'Specialist', 'Optical', 'Medicare gap and out-of-pocket'],
  },
  {
    bucket: 'BILLS',
    group: 'Family',
    categories: ['Childcare', 'School fees', 'School supplies', 'Uniforms', "Children's activities", 'Child support'],
  },
  {
    bucket: 'BILLS',
    group: 'Financial',
    categories: [
      'Bank fees',
      { name: 'Interest and fees', systemKey: SYSTEM_CATEGORY.interestAndFees },
      { name: 'Loan repayments', systemKey: SYSTEM_CATEGORY.loanRepayments },
      { name: 'Credit card repayments', systemKey: SYSTEM_CATEGORY.creditCardRepayments },
      { name: 'Other mandatory repayments', systemKey: SYSTEM_CATEGORY.otherMandatoryRepayments },
    ],
  },
  {
    bucket: 'BILLS',
    group: 'Subscriptions',
    categories: ['Streaming services', 'Music', 'Software', 'Cloud storage', 'Other subscriptions'],
  },
  {
    bucket: 'SMILE',
    group: 'Smile',
    categories: [
      'Holidays',
      'Weekend trips',
      'Dining out',
      'Takeaway',
      'Entertainment',
      'Concerts',
      'Sporting events',
      'Hobbies',
      'Golf',
      'Gaming',
      'Movies',
      'Travel',
      'Gifts',
      'Birthdays',
      'Christmas',
      'Special occasions',
    ],
  },
  {
    bucket: 'SPLURGE',
    group: 'Splurge',
    categories: [
      'Personal spending',
      'Clothing',
      'Shoes',
      'Coffee',
      'Snacks',
      'Alcohol',
      'Electronics',
      'Gadgets',
      'Impulse purchases',
      'Luxury purchases',
      'Personal hobbies',
      'Other discretionary spending',
    ],
  },
  {
    bucket: 'FIRE_EXTINGUISHER',
    group: 'Fire Extinguisher',
    categories: [
      { name: 'Extra debt repayments', systemKey: SYSTEM_CATEGORY.extraDebtRepayments },
      { name: 'Emergency fund', systemKey: SYSTEM_CATEGORY.emergencyFund },
      { name: 'Savings contributions', systemKey: SYSTEM_CATEGORY.savingsContributions },
      { name: 'Investment contributions', systemKey: SYSTEM_CATEGORY.investmentContributions },
    ],
  },
  {
    bucket: null,
    group: 'Income',
    categories: [
      { name: 'Salary and wages', systemKey: SYSTEM_CATEGORY.salary },
      'Bonus',
      'Interest earned',
      'Dividends',
      'Government payments',
      'Side income',
      { name: 'Other income', systemKey: SYSTEM_CATEGORY.otherIncome },
    ],
  },
];

export const DEFAULT_NOTIFICATION_SETTINGS: { type: NotificationType; enabled: boolean; daysBefore: number | null }[] = [
  { type: 'UPCOMING_BILL', enabled: true, daysBefore: 3 },
  { type: 'OVERSPENDING', enabled: true, daysBefore: null },
  { type: 'SINKING_FUND_DEADLINE', enabled: true, daysBefore: 14 },
  { type: 'BUDGET_REVIEW', enabled: true, daysBefore: null },
  { type: 'GOAL_MILESTONE', enabled: false, daysBefore: null },
];
