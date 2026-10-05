import { useRef, type KeyboardEvent } from 'react';

/**
 * WAI-ARIA tabs: one tab in the tab order, arrow keys (and Home/End) move
 * between tabs and select them. Pair with tabPanelProps on the content.
 */
export function TabList<T extends string>({
  label,
  id,
  tabs,
  value,
  onChange,
}: {
  label: string;
  id: string;
  tabs: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  function onKeyDown(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.key === value);
    const next =
      e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!.key);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  return (
    <div className="segmented" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown} style={{ marginBottom: '1rem' }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`${id}-tab-${t.key}`}
          aria-selected={value === t.key}
          aria-controls={`${id}-panel`}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export const tabPanelProps = (id: string, value: string) => ({
  role: 'tabpanel' as const,
  id: `${id}-panel`,
  'aria-labelledby': `${id}-tab-${value}`,
});
