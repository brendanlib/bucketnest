import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { datePlaceholder, formatDateInput, parseDateInput } from '../lib/format';
import { useHousehold } from '../lib/household';
import { Icon } from './Icon';

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** YYYY-MM-DD or '' */
  value: string;
  onChange: (iso: string) => void;
}

/** Text entry in the household date format (DD/MM/YYYY for en-AU), plus a calendar picker. */
export function DateInput({ value, onChange, ...rest }: DateInputProps) {
  const { locale } = useHousehold();
  const [text, setText] = useState(value ? formatDateInput(value, locale) : '');
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (parseDateInput(text, locale) !== value) setText(value ? formatDateInput(value, locale) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locale]);

  return (
    <div className="input-group">
      <input
        {...rest}
        className="input"
        placeholder={datePlaceholder(locale)}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-invalid={invalid || rest['aria-invalid'] ? true : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const iso = parseDateInput(e.target.value, locale);
          setInvalid(e.target.value.trim() !== '' && !iso);
          if (iso) onChange(iso);
          else if (e.target.value.trim() === '') onChange('');
        }}
        onBlur={() => {
          const iso = parseDateInput(text, locale);
          if (iso) setText(formatDateInput(iso, locale));
        }}
      />
      <button
        type="button"
        className="btn icon"
        aria-label="Open calendar"
        onClick={() => {
          const el = picker.current;
          try {
            el?.showPicker();
          } catch {
            el?.focus();
          }
        }}
      >
        <Icon name="calendar" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    </div>
  );
}
