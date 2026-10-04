import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoneyInput } from './MoneyInput';

function Harness({ onValue, initial = null, allowNegative }: { onValue: (c: number | null) => void; initial?: number | null; allowNegative?: boolean }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <MoneyInput
      aria-label="Amount"
      value={v}
      allowNegative={allowNegative}
      onChange={(c) => {
        setV(c);
        onValue(c);
      }}
    />
  );
}

describe('MoneyInput', () => {
  it('accepts "1,234.50" and emits integer cents', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await userEvent.type(screen.getByLabelText('Amount'), '1,234.50');
    expect(onValue).toHaveBeenLastCalledWith(123450);
  });

  it('accepts "$1234.5" and tidies it on blur', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '$1234.5');
    expect(onValue).toHaveBeenLastCalledWith(123450);
    await userEvent.tab();
    expect(input).toHaveValue('1,234.50');
  });

  it('shows an existing value formatted', () => {
    render(<Harness onValue={() => {}} initial={99} />);
    expect(screen.getByLabelText('Amount')).toHaveValue('0.99');
  });

  it('flags text that is not money and does not emit it', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '12.345');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onValue).toHaveBeenLastCalledWith(1234);
  });

  it('rejects negatives unless allowed', async () => {
    const onValue = vi.fn();
    const { unmount } = render(<Harness onValue={onValue} />);
    await userEvent.type(screen.getByLabelText('Amount'), '-5');
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-invalid', 'true');
    unmount();
    const allowed = vi.fn();
    render(<Harness onValue={allowed} allowNegative />);
    await userEvent.type(screen.getByLabelText('Amount'), '-5');
    expect(allowed).toHaveBeenLastCalledWith(-500);
  });

  it('emits null when cleared', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} initial={500} />);
    await userEvent.clear(screen.getByLabelText('Amount'));
    expect(onValue).toHaveBeenLastCalledWith(null);
  });
});
