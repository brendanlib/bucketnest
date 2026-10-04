import type { SelectHTMLAttributes } from 'react';
import type { Account, Bucket, Category } from '../api/types';

/** Categories grouped by bucket, then group. Disabled categories are hidden unless already selected. */
export function CategorySelect({
  categories,
  buckets,
  kind,
  bucketKeys,
  value,
  onChange,
  placeholder = 'Choose a category',
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  categories: Category[];
  buckets: Bucket[];
  kind: 'INCOME' | 'EXPENSE';
  bucketKeys?: string[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const groups = new Map(categories.filter((c) => c.isGroup).map((c) => [c.id, c]));
  const usable = categories.filter((c) => !c.isGroup && c.kind === kind && (c.isActive || c.id === value));
  const sections: { label: string; items: Category[] }[] = [];
  if (kind === 'INCOME') {
    sections.push({ label: 'Income', items: usable });
  } else {
    for (const b of buckets) {
      if (bucketKeys && !bucketKeys.includes(b.key)) continue;
      const inBucket = usable.filter((c) => c.bucketId === b.id);
      const byGroup = new Map<string, Category[]>();
      for (const c of inBucket) {
        const g = c.parentId ? (groups.get(c.parentId)?.name ?? '') : '';
        byGroup.set(g, [...(byGroup.get(g) ?? []), c]);
      }
      for (const [g, items] of byGroup) sections.push({ label: g && g !== b.name ? `${b.name} · ${g}` : b.name, items });
    }
  }
  return (
    <select {...rest} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {sections.map((s) => (
        <optgroup key={s.label} label={s.label}>
          {s.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isActive ? '' : ' (disabled)'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function AccountSelect({
  accounts,
  value,
  onChange,
  filter,
  placeholder = 'Choose an account',
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  filter?: (a: Account) => boolean;
  placeholder?: string;
}) {
  const list = accounts.filter((a) => (!a.isClosed || a.id === value) && (!filter || filter(a)));
  const assets = list.filter((a) => a.class === 'ASSET');
  const liabilities = list.filter((a) => a.class === 'LIABILITY');
  return (
    <select {...rest} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {assets.length ? (
        <optgroup label="Accounts">
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {liabilities.length ? (
        <optgroup label="Cards and loans">
          {liabilities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}
