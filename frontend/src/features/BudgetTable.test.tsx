import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BudgetTable } from './BudgetTable';
import type { BudgetSummary, Variance } from '../api/types';
import { renderWithHousehold } from '../test/render';

const v = (budgetCents: number, actualCents: number, percentUsed: number | null, status: Variance['status']): Variance => ({
  budgetCents,
  actualCents,
  remainingCents: budgetCents - actualCents,
  percentUsed,
  status,
});

const summary: BudgetSummary = {
  budget: {
    id: 'b1',
    name: 'Household',
    periodType: 'MONTHLY',
    anchorDate: '2026-10-01',
    isActive: true,
    items: [{ categoryId: 'groceries', amountCents: 80000, enteredFrequency: 'MONTHLY', frequencyInterval: null, notes: 'weekly shop', periodAmountCents: 80000 }],
  },
  period: { start: '2026-10-01', end: '2026-10-31', previousStart: '2026-09-01', nextStart: '2026-11-01', isCurrent: true, today: '2026-10-15' },
  income: {
    plannedCents: 500000,
    plannedSource: 'schedules',
    actualCents: 0,
    scheduledActualCents: 0,
    expected: { weekly: 0, fortnightly: 0, monthly: 0, annual: 0 },
    allocationBasis: 'PLANNED',
    allocationIncomeCents: 500000,
    variance: v(500000, 0, 0, 'ok'),
  },
  buckets: [
    {
      ...v(80000, 74200, 92.75, 'amber'),
      bucketId: 'bills',
      key: 'BILLS',
      name: 'Bills',
      colour: '#00f',
      percentage: '60.00',
      allocatedCents: 300000,
      overAllocatedCents: 0,
      allocation: v(300000, 74200, 24.73, 'ok'),
      groups: [
        {
          ...v(80000, 74200, 92.75, 'amber'),
          groupId: 'food',
          name: 'Food',
          lines: [{ ...v(80000, 74200, 92.75, 'amber'), categoryId: 'groceries', name: 'Groceries', hasItem: true, isActive: true }],
        },
      ],
    },
    {
      ...v(0, 4500, null, 'unbudgeted'),
      bucketId: 'splurge',
      key: 'SPLURGE',
      name: 'Splurge',
      colour: '#0f0',
      percentage: '10.00',
      allocatedCents: 50000,
      overAllocatedCents: 0,
      allocation: v(50000, 4500, 9, 'ok'),
      groups: [
        {
          ...v(0, 4500, null, 'unbudgeted'),
          groupId: 'splurge-g',
          name: 'Splurge',
          lines: [{ ...v(0, 4500, null, 'unbudgeted'), categoryId: 'coffee', name: 'Coffee', hasItem: false, isActive: true }],
        },
      ],
    },
  ],
  total: v(80000, 78700, 98.38, 'amber'),
  incomeLines: [],
  thresholds: { amber: 90, red: 100 },
};

const table = () => screen.getAllByRole('table')[0]!;

describe('BudgetTable', () => {
  it('shows budget, actual, remaining and % used (spec §9 example)', () => {
    renderWithHousehold(<BudgetTable summary={summary} />);
    const row = within(table()).getByText('Groceries').closest('tr')!;
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(1, 4)).toEqual(['$800.00', '$742.00', '$58.00']);
    expect(within(row).getByText('92.75% used')).toBeInTheDocument();
    expect(within(row).getByText('weekly shop')).toBeInTheDocument();
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '92.75% used, near limit');
  });

  it('shows "—" and flags unbudgeted spending', () => {
    renderWithHousehold(<BudgetTable summary={summary} />);
    const row = within(table()).getByText('Coffee').closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText('Unbudgeted')).toBeInTheDocument();
    expect(within(row).getByText('-$45.00')).toHaveClass('num');
  });

  it('rolls up to bucket rows and a total, with the allocation', () => {
    renderWithHousehold(<BudgetTable summary={summary} />);
    const billsRow = within(table()).getByText('Bills').closest('tr')!;
    expect(billsRow).toHaveTextContent('Allocation $3,000.00 (60%)');
    const total = within(table()).getByText('Total').closest('tr')!;
    expect(within(total).getAllByRole('cell').map((c) => c.textContent).slice(1, 4)).toEqual(['$800.00', '$787.00', '$13.00']);
  });

  it('flags over-allocation', () => {
    const over = { ...summary, buckets: [{ ...summary.buckets[0]!, overAllocatedCents: 12000 }] };
    renderWithHousehold(<BudgetTable summary={over} />);
    expect(within(table()).getByText(/over-allocated by/)).toHaveTextContent('over-allocated by $120.00');
  });

  it('filters to one bucket and hides the total', () => {
    renderWithHousehold(<BudgetTable summary={summary} bucketKey="SPLURGE" />);
    expect(within(table()).queryByText('Groceries')).not.toBeInTheDocument();
    expect(within(table()).getByText('Coffee')).toBeInTheDocument();
    expect(within(table()).queryByText('Total')).not.toBeInTheDocument();
  });

  it('opens a line for editing', async () => {
    const onEdit = vi.fn();
    renderWithHousehold(<BudgetTable summary={summary} onEditLine={onEdit} />);
    await userEvent.click(within(table()).getByRole('button', { name: 'Edit budget for Groceries' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'groceries' }), summary.budget.items[0]);
  });
});
