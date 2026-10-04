import { type Cents, assertCents } from './money.js';

export type AccountClass = 'ASSET' | 'LIABILITY';

export type TransactionType =
  | 'INCOME'
  | 'EXPENSE'
  | 'REFUND'
  | 'TRANSFER'
  | 'DEBT_REPAYMENT'
  | 'SAVINGS_CONTRIBUTION'
  | 'BALANCE_ADJUSTMENT'
  | 'INTEREST_CHARGE';

export type AdjustmentDirection = 'INCREASE' | 'DECREASE';

/** Types that move money between two of the household's accounts. */
export const TWO_ACCOUNT_TYPES: readonly TransactionType[] = ['TRANSFER', 'DEBT_REPAYMENT', 'SAVINGS_CONTRIBUTION'];

export interface BalanceMovement {
  type: TransactionType;
  amountCents: Cents;
  direction?: AdjustmentDirection | null;
  /** Whether the account is the transaction's account (`from`) or its to-account (`to`). */
  role: 'from' | 'to';
}

/**
 * Signed change to an account's displayed balance. For assets the balance is
 * money held; for liabilities it is the amount owed. Money flowing into an
 * account raises an asset and lowers a liability, and the reverse for money out.
 */
export function balanceEffect(movement: BalanceMovement, accountClass: AccountClass): Cents {
  const { type, amountCents, role } = movement;
  assertCents(amountCents);
  const inflow = accountClass === 'ASSET' ? amountCents : -amountCents;

  if (role === 'to') {
    if (!TWO_ACCOUNT_TYPES.includes(type)) return 0;
    return inflow;
  }

  switch (type) {
    case 'INCOME':
    case 'REFUND':
      return inflow;
    case 'EXPENSE':
    case 'TRANSFER':
    case 'DEBT_REPAYMENT':
    case 'SAVINGS_CONTRIBUTION':
    case 'INTEREST_CHARGE':
      return -inflow;
    case 'BALANCE_ADJUSTMENT':
      if (!movement.direction) throw new Error('Balance adjustment needs a direction');
      return movement.direction === 'INCREASE' ? amountCents : -amountCents;
  }
}

/** Current balance = opening balance + the effect of every transaction (spec §3.6). */
export function calculateAccountBalance(
  openingBalanceCents: Cents,
  accountClass: AccountClass,
  movements: Iterable<BalanceMovement>,
): Cents {
  let balance = openingBalanceCents;
  for (const m of movements) balance += balanceEffect(m, accountClass);
  assertCents(balance, 'balance');
  return balance;
}

/**
 * The adjustment that brings the app's balance to a statement balance, or null
 * when they already agree.
 */
export function reconciliationAdjustment(
  currentCents: Cents,
  statementCents: Cents,
): { direction: AdjustmentDirection; amountCents: Cents } | null {
  const diff = statementCents - currentCents;
  if (diff === 0) return null;
  return { direction: diff > 0 ? 'INCREASE' : 'DECREASE', amountCents: Math.abs(diff) };
}

/** Net worth = asset balances + latest asset valuations − liability balances (spec §3.6). */
export function calculateNetWorth(input: {
  accounts: { accountClass: AccountClass; balanceCents: Cents }[];
  assetValuationsCents: Cents[];
}): { assetsCents: Cents; liabilitiesCents: Cents; netWorthCents: Cents } {
  let assets = 0;
  let liabilities = 0;
  for (const a of input.accounts) {
    if (a.accountClass === 'ASSET') assets += a.balanceCents;
    else liabilities += a.balanceCents;
  }
  for (const v of input.assetValuationsCents) assets += v;
  return { assetsCents: assets, liabilitiesCents: liabilities, netWorthCents: assets - liabilities };
}
