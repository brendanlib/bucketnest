import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { BucketCard } from './BucketCard';
import type { DashboardBucket } from '../api/types';
import { renderWithHousehold } from '../test/render';

const base: DashboardBucket = {
  bucketId: 'b',
  key: 'BILLS',
  name: 'Bills',
  colour: '#2563EB',
  percentage: '60.00',
  allocatedCents: 300000,
  actualCents: 274200,
  remainingCents: 25800,
  percentUsed: 91.4,
  percentOfIncome: 54.84,
  status: 'amber',
  plannedCents: 312000,
  overAllocatedCents: 12000,
};

describe('BucketCard', () => {
  it('shows allocated, spent and remaining from the API', () => {
    renderWithHousehold(<BucketCard bucket={base} />);
    const card = screen.getByRole('article', { name: 'Bills' });
    expect(within(card).getByText('$3,000.00')).toBeInTheDocument();
    expect(within(card).getByText('$2,742.00')).toBeInTheDocument();
    expect(within(card).getByText('Remaining')).toBeInTheDocument();
    expect(within(card).getByText('$258.00')).toBeInTheDocument();
    expect(within(card).getByText('54.84% of income so far')).toBeInTheDocument();
    expect(within(card).getByText('60%')).toBeInTheDocument();
  });

  it('signals near-limit with text, not only colour', () => {
    renderWithHousehold(<BucketCard bucket={base} />);
    expect(screen.getByText('Near limit')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Bills used' })).toHaveAttribute('aria-valuetext', '91.40% used, near limit');
    expect(screen.getByText(/over-allocated by/)).toHaveTextContent('over-allocated by $120.00');
  });

  it('shows "Over by" when the bucket is overspent', () => {
    renderWithHousehold(<BucketCard bucket={{ ...base, actualCents: 310000, remainingCents: -10000, percentUsed: 103.33, status: 'red' }} />);
    expect(screen.getByText('Over by')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toHaveClass('num');
    expect(screen.getByText('Over budget')).toBeInTheDocument();
  });

  it('shows Fire Extinguisher contributions and debt progress', () => {
    renderWithHousehold(
      <BucketCard
        bucket={{
          ...base,
          key: 'FIRE_EXTINGUISHER',
          name: 'Fire Extinguisher',
          status: 'ok',
          overAllocatedCents: 0,
          fire: { savingsCents: 25000, investmentCents: 0, extraRepaymentsCents: 50000, principalReducedCents: 120000, goals: [] },
        }}
      />,
    );
    expect(screen.getByText('Contributions')).toBeInTheDocument();
    expect(screen.getByText('Debt principal reduced').nextSibling).toHaveTextContent('$1,200.00');
    expect(screen.getByText('Extra repayments').nextSibling).toHaveTextContent('$500.00');
    expect(screen.queryByText(/over-allocated/)).not.toBeInTheDocument();
  });

  it('links to the filtered budget view', () => {
    renderWithHousehold(<BucketCard bucket={base} />);
    expect(screen.getByRole('link', { name: 'View Bills budget' })).toHaveAttribute('href', '/budget?bucket=BILLS');
  });
});
