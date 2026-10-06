import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BucketEditor } from './BucketEditor';
import type { Bucket } from '../api/types';

const b = (id: string, key: string, role: Bucket['role'], name: string, percentage: string, sortOrder: number): Bucket => ({ id, key, role, name, percentage, sortOrder, colour: '#2A78D6', deletable: role === 'SPENDING' });
const buckets: Bucket[] = [
  b('b', 'BILLS', 'BILLS', 'Bills', '60.00', 1),
  b('s', 'SMILE', 'SPENDING', 'Smile', '10.00', 2),
  b('p', 'SPLURGE', 'SPENDING', 'Splurge', '10.00', 3),
  b('f', 'FIRE_EXTINGUISHER', 'SAVING', 'Fire Extinguisher', '20.00', 4),
];
const props = () => ({ buckets, onSave: vi.fn(), onAdd: vi.fn(async () => {}), onRemove: vi.fn(async () => {}) });

describe('BucketEditor', () => {
  it('renames and reorders, then saves the whole list in its new order', async () => {
    const p = props();
    render(<BucketEditor {...p} />);
    expect(screen.getByRole('button', { name: 'Save buckets' })).toBeDisabled(); // nothing changed yet
    const fire = screen.getByLabelText('Name of bucket 4');
    await userEvent.clear(fire);
    await userEvent.type(fire, 'Savings');
    await userEvent.click(screen.getByRole('button', { name: 'Move Splurge up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save buckets' }));
    expect(p.onSave).toHaveBeenCalledWith([
      { id: 'b', name: 'Bills', percentage: '60.00' },
      { id: 'p', name: 'Splurge', percentage: '10.00' },
      { id: 's', name: 'Smile', percentage: '10.00' },
      { id: 'f', name: 'Savings', percentage: '20.00' },
    ]);
  });

  it('needs a 100% total and different names', async () => {
    render(<BucketEditor {...props()} />);
    const pct = screen.getByLabelText('Fire Extinguisher percentage');
    await userEvent.clear(pct);
    await userEvent.type(pct, '15');
    expect(screen.getByTestId('percentage-total')).toHaveTextContent('95.00%');
    expect(screen.getByRole('alert')).toHaveTextContent('under by 5.00%');
    await userEvent.clear(pct);
    await userEvent.type(pct, '20');
    const smile = screen.getByLabelText('Name of bucket 2');
    await userEvent.clear(smile);
    await userEvent.type(smile, 'splurge');
    expect(screen.getByRole('alert')).toHaveTextContent('no two can share one');
    expect(screen.getByRole('button', { name: 'Save buckets' })).toBeDisabled();
  });

  it('only offers removal for spending buckets, and asks where things go', async () => {
    const p = props();
    render(<BucketEditor {...p} />);
    expect(screen.queryByRole('button', { name: 'Remove Bills' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Fire Extinguisher' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Splurge' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Move everything to'), 'Fire Extinguisher');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove and move to Fire Extinguisher' }));
    expect(p.onRemove).toHaveBeenCalledWith('p', 'f');
  });

  it('adds buckets, but not with unsaved edits, and stops at eight', async () => {
    const p = props();
    const { unmount } = render(<BucketEditor {...p} />);
    await userEvent.type(screen.getByLabelText('Add a bucket'), 'Kids');
    await userEvent.click(screen.getByRole('button', { name: 'Add bucket' }));
    expect(p.onAdd).toHaveBeenCalledWith('Kids');
    await userEvent.type(screen.getByLabelText('Name of bucket 1'), '!');
    await userEvent.type(screen.getByLabelText('Add a bucket'), 'Giving');
    expect(screen.getByRole('button', { name: 'Add bucket' })).toBeDisabled();
    unmount();

    const eight = Array.from({ length: 8 }, (_, i) => b(`x${i}`, `K${i}`, 'SPENDING', `B${i}`, i === 0 ? '100.00' : '0.00', i + 1));
    render(<BucketEditor {...props()} buckets={eight} />);
    expect(screen.queryByLabelText('Add a bucket')).toBeNull();
    expect(screen.getByText(/most buckets a household can have/)).toBeInTheDocument();
  });
});
