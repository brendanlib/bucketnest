import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { formatMoneyInput, parseMoneyInput } from '../lib/format';
import { useHousehold } from '../lib/household';

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** Integer cents, or null when empty. */
  value: number | null;
  onChange: (cents: number | null) => void;
  allowNegative?: boolean;
}

/** Accepts "1,234.50", "$1234.5" etc. Emits integer cents; tidies the text on blur. */
export function MoneyInput({ value, onChange, allowNegative = false, ...rest }: MoneyInputProps) {
  const { locale } = useHousehold();
  const [text, setText] = useState(value === null ? '' : formatMoneyInput(value, locale));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    // Sync when the value is changed from outside (not while typing an equivalent value).
    const parsed = parseMoneyInput(text);
    if (parsed !== value) setText(value === null ? '' : formatMoneyInput(value, locale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locale]);

  return (
    <input
      {...rest}
      className={`input right ${rest.className ?? ''}`}
      inputMode="decimal"
      autoComplete="off"
      value={text}
      aria-invalid={invalid || rest['aria-invalid'] ? true : undefined}
      onChange={(e) => {
        setText(e.target.value);
        const cents = e.target.value.trim() === '' ? null : parseMoneyInput(e.target.value);
        const ok = e.target.value.trim() === '' || (cents !== null && (allowNegative || cents >= 0));
        setInvalid(!ok);
        if (ok) onChange(cents);
      }}
      onBlur={(e) => {
        const cents = parseMoneyInput(text);
        if (cents !== null && (allowNegative || cents >= 0)) setText(formatMoneyInput(cents, locale));
        rest.onBlur?.(e);
      }}
    />
  );
}
