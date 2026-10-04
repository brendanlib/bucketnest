import { describe, expect, it } from 'vitest';
import {
  balanceEffect,
  calculateAccountBalance,
  calculateNetWorth,
  reconciliationAdjustment,
  type BalanceMovement,
} from './balance.js';

const m = (type: BalanceMovement['type'], amountCents: number, role: 'from' | 'to' = 'from', direction?: 'INCREASE' | 'DECREASE'): BalanceMovement => ({
  type,
  amountCents,
  role,
  direction,
});

describe('account balances', () => {
  it('derives an asset balance from opening balance and transactions', () => {
    const balance = calculateAccountBalance(100000, 'ASSET', [
      m('INCOME', 350000),
      m('EXPENSE', 18000),
      m('REFUND', 2000),
      m('TRANSFER', 50000),
      m('TRANSFER', 10000, 'to'),
      m('DEBT_REPAYMENT', 250000),
      m('SAVINGS_CONTRIBUTION', 20000),
    ]);
    expect(balance).toBe(100000 + 350000 - 18000 + 2000 - 50000 + 10000 - 250000 - 20000);
  });

  it('treats liability balances as amounts owed', () => {
    // Card: owe $500, spend $100, pay $300 off, charged $5 interest.
    const balance = calculateAccountBalance(50000, 'LIABILITY', [
      m('EXPENSE', 10000),
      m('TRANSFER', 30000, 'to'),
      m('INTEREST_CHARGE', 500),
      m('REFUND', 2000),
    ]);
    expect(balance).toBe(50000 + 10000 - 30000 + 500 - 2000);
  });

  it('reduces a loan when a repayment arrives', () => {
    expect(balanceEffect(m('DEBT_REPAYMENT', 300000, 'to'), 'LIABILITY')).toBe(-300000);
    expect(balanceEffect(m('DEBT_REPAYMENT', 300000, 'from'), 'ASSET')).toBe(-300000);
  });

  it('applies balance adjustments in the stated direction for either class', () => {
    expect(balanceEffect(m('BALANCE_ADJUSTMENT', 100, 'from', 'INCREASE'), 'ASSET')).toBe(100);
    expect(balanceEffect(m('BALANCE_ADJUSTMENT', 100, 'from', 'DECREASE'), 'ASSET')).toBe(-100);
    expect(balanceEffect(m('BALANCE_ADJUSTMENT', 100, 'from', 'INCREASE'), 'LIABILITY')).toBe(100);
    expect(() => balanceEffect(m('BALANCE_ADJUSTMENT', 100), 'ASSET')).toThrow();
  });

  it('ignores the to-role for single-account types', () => {
    expect(balanceEffect(m('INCOME', 100, 'to'), 'ASSET')).toBe(0);
  });

  it('works out the reconciliation adjustment', () => {
    expect(reconciliationAdjustment(10000, 12550)).toEqual({ direction: 'INCREASE', amountCents: 2550 });
    expect(reconciliationAdjustment(10000, 9000)).toEqual({ direction: 'DECREASE', amountCents: 1000 });
    expect(reconciliationAdjustment(10000, 10000)).toBeNull();
  });

  it('a transfer moves money without changing the household total', () => {
    const transfer = { type: 'TRANSFER' as const, amountCents: 50000 };
    const main = balanceEffect({ ...transfer, role: 'from' }, 'ASSET');
    const smile = balanceEffect({ ...transfer, role: 'to' }, 'ASSET');
    expect(main + smile).toBe(0);
  });
});

describe('net worth', () => {
  it('is assets plus valuations minus liabilities', () => {
    expect(
      calculateNetWorth({
        accounts: [
          { accountClass: 'ASSET', balanceCents: 1000000 },
          { accountClass: 'LIABILITY', balanceCents: 40000000 },
          { accountClass: 'ASSET', balanceCents: 500000 },
        ],
        assetValuationsCents: [80000000],
      }),
    ).toEqual({ assetsCents: 81500000, liabilitiesCents: 40000000, netWorthCents: 41500000 });
  });
});
