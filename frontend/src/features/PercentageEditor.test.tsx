import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PercentageEditor } from './PercentageEditor';
import type { Bucket } from '../api/types';

const buckets: Bucket[] = [
  { id: 'b', key: 'BILLS', name: 'Bills', percentage: '60.00', sortOrder: 1, colour: '#000' },
  { id: 's', key: 'SMILE', name: 'Smile', percentage: '10.00', sortOrder: 2, colour: '#000' },
  { id: 'p', key: 'SPLURGE', name: 'Splurge', percentage: '10.00', sortOrder: 3, colour: '#000' },
  { id: 'f', key: 'FIRE_EXTINGUISHER', name: 'Fire Extinguisher', percentage: '20.00', sortOrder: 4, colour: '#000' },
];

describe('PercentageEditor', () => {
  it('shows a live total and saves when it is exactly 100%', async () => {
    const onSave = vi.fn();
    render(<PercentageEditor buckets={buckets} onSave={onSave} />);
    expect(screen.getByTestId('percentage-total')).toHaveTextContent('100.00%');
    await userEvent.click(screen.getByRole('button', { name: 'Save percentages' }));
    expect(onSave).toHaveBeenCalledWith([
      { id: 'b', percentage: '60.00' },
      { id: 's', percentage: '10.00' },
      { id: 'p', percentage: '10.00' },
      { id: 'f', percentage: '20.00' },
    ]);
  });

  it('blocks saving and explains when the total is off', async () => {
    const onSave = vi.fn();
    render(<PercentageEditor buckets={buckets} onSave={onSave} />);
    const fire = screen.getByLabelText('Fire Extinguisher');
    await userEvent.clear(fire);
    await userEvent.type(fire, '15');
    expect(screen.getByTestId('percentage-total')).toHaveTextContent('95.00%');
    expect(screen.getByRole('alert')).toHaveTextContent('under by 5.00%');
    expect(screen.getByRole('button', { name: 'Save percentages' })).toBeDisabled();
  });

  it('handles decimals exactly (33.33 + 33.33 + 33.34)', async () => {
    const three = buckets.slice(0, 3).map((b, i) => ({ ...b, percentage: ['33.33', '33.33', '33.34'][i]! }));
    render(<PercentageEditor buckets={three} onSave={() => {}} />);
    expect(screen.getByTestId('percentage-total')).toHaveTextContent('100.00%');
  });

  it('rejects text that is not a percentage', async () => {
    render(<PercentageEditor buckets={buckets} onSave={() => {}} />);
    const bills = screen.getByLabelText('Bills');
    await userEvent.clear(bills);
    await userEvent.type(bills, 'abc');
    expect(bills).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('percentage-total')).toHaveTextContent('—');
  });
});
