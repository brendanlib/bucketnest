import { useState, type FormEvent } from 'react';
import { bucketColour } from '../lib/colours';
import { api, ApiError } from '../api/client';
import { useApiMutation, useBuckets, useCategories } from '../api/hooks';
import type { Bucket, Category } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { PageTip } from '../components/PageTip';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ErrorState, FormError, Loading, errorMessage } from '../components/States';
import { Field } from '../components/Field';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

const CATEGORY_QUERIES = [['categories'], ['transactions'], ['budgets'], ['dashboard']];

type Editing = { mode: 'new'; kind: 'INCOME' | 'EXPENSE'; bucketId: string | null; parentId: string | null; isGroup: boolean } | { mode: 'edit'; category: Category };

export function CategoriesPage() {
  const categories = useCategories(true);
  const buckets = useBuckets();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toast = useToast();
  const update = useApiMutation(({ id, body }: { id: string; body: Record<string, unknown> }) => api.put(`/categories/${id}`, body), CATEGORY_QUERIES);

  if (categories.isPending || buckets.isPending) return <Loading />;
  if (categories.isError) return <ErrorState error={categories.error} onRetry={() => categories.refetch()} />;
  if (buckets.isError) return <ErrorState error={buckets.error} onRetry={() => buckets.refetch()} />;

  const all = categories.data;
  const groupsOf = (bucketId: string | null, kind: 'INCOME' | 'EXPENSE') =>
    all.filter((c) => c.isGroup && c.kind === kind && c.bucketId === bucketId).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (parentId: string | null, bucketId: string | null, kind: 'INCOME' | 'EXPENSE') =>
    all.filter((c) => !c.isGroup && c.kind === kind && c.parentId === parentId && (parentId !== null || c.bucketId === bucketId)).sort((a, b) => a.sortOrder - b.sortOrder);

  async function move(list: Category[], index: number, delta: -1 | 1) {
    const a = list[index];
    const b = list[index + delta];
    if (!a || !b) return;
    // Swap positions; equal sort orders get distinct values.
    const aOrder = b.sortOrder === a.sortOrder ? a.sortOrder + delta : b.sortOrder;
    await update.mutateAsync({ id: a.id, body: { sortOrder: Math.max(0, aOrder) } });
    await update.mutateAsync({ id: b.id, body: { sortOrder: a.sortOrder } });
  }

  async function toggleActive(c: Category) {
    try {
      await update.mutateAsync({ id: c.id, body: { isActive: !c.isActive } });
      toast(c.isActive ? `${c.name} disabled` : `${c.name} enabled`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const renderList = (list: Category[]) =>
    list.map((c, i) => (
      <div key={c.id} className="list-item" style={{ paddingLeft: '1rem' }}>
        <div className="grow">
          <span className={c.isActive ? undefined : 'muted'} style={{ textDecoration: c.isActive ? undefined : 'line-through' }}>
            {c.name}
          </span>{' '}
          {!c.isActive ? <span className="badge">Disabled</span> : null}
          {c.isSystem ? <span className="badge" title="Used by the budgeting rules">System</span> : null}
          {c.transactionCount ? <span className="muted small"> · {c.transactionCount} uses</span> : null}
        </div>
        <button type="button" className="btn ghost icon small" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(list, i, -1)}>
          ↑
        </button>
        <button type="button" className="btn ghost icon small" aria-label={`Move ${c.name} down`} disabled={i === list.length - 1} onClick={() => move(list, i, 1)}>
          ↓
        </button>
        <button type="button" className="btn ghost small" onClick={() => setEditing({ mode: 'edit', category: c })}>
          Edit
        </button>
        {!c.isSystem ? (
          <button type="button" className="btn ghost small" onClick={() => toggleActive(c)}>
            {c.isActive ? 'Disable' : 'Enable'}
          </button>
        ) : null}
        {!c.isSystem ? (
          <button type="button" className="btn ghost icon" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
            <Icon name="trash" />
          </button>
        ) : null}
      </div>
    ));

  const section = (title: string, colour: string | null, bucketId: string | null, kind: 'INCOME' | 'EXPENSE') => {
    const groups = groupsOf(bucketId, kind);
    const loose = childrenOf(null, bucketId, kind);
    const isCollapsed = collapsed.has(title);
    const count = all.filter((c) => !c.isGroup && c.kind === kind && (kind === 'INCOME' || c.bucketId === bucketId)).length;
    return (
      <section key={title} className="card" aria-labelledby={`cat-${title}`}>
        <div className="card-header" style={isCollapsed ? { marginBottom: 0 } : undefined}>
          <button
            type="button"
            className="btn ghost icon small"
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? 'Show' : 'Hide'} ${title} categories`}
            onClick={() => {
              const next = new Set(collapsed);
              if (isCollapsed) next.delete(title);
              else next.add(title);
              setCollapsed(next);
            }}
          >
            <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} />
          </button>
          {colour ? <span className="dot" style={{ background: bucketColour(colour) }} aria-hidden="true" /> : null}
          <h2 id={`cat-${title}`}>{title}</h2>
          <span className="muted small">{count} categories</span>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={() => setEditing({ mode: 'new', kind, bucketId, parentId: null, isGroup: true })}>
            Add group
          </button>
          <button type="button" className="btn small primary" onClick={() => setEditing({ mode: 'new', kind, bucketId, parentId: groups[0]?.id ?? null, isGroup: false })}>
            <Icon name="plus" /> Category
          </button>
        </div>
        {isCollapsed ? null : groups.map((g, gi) => (
          <div key={g.id} style={{ marginBottom: '0.75rem' }}>
            <div className="row" style={{ borderBottom: '1px solid var(--border)', padding: '0.4rem 0' }}>
              <h3>{g.name}</h3>
              <span className="spacer" />
              <button type="button" className="btn ghost icon small" aria-label={`Move group ${g.name} up`} disabled={gi === 0} onClick={() => move(groups, gi, -1)}>
                ↑
              </button>
              <button type="button" className="btn ghost icon small" aria-label={`Move group ${g.name} down`} disabled={gi === groups.length - 1} onClick={() => move(groups, gi, 1)}>
                ↓
              </button>
              <button type="button" className="btn ghost small" onClick={() => setEditing({ mode: 'new', kind, bucketId, parentId: g.id, isGroup: false })}>
                Add
              </button>
              <button type="button" className="btn ghost small" onClick={() => setEditing({ mode: 'edit', category: g })}>
                Edit
              </button>
              <button type="button" className="btn ghost icon" aria-label={`Delete group ${g.name}`} onClick={() => setDeleting(g)}>
                <Icon name="trash" />
              </button>
            </div>
            {renderList(childrenOf(g.id, bucketId, kind))}
          </div>
        ))}
        {!isCollapsed && loose.length ? renderList(loose) : null}
      </section>
    );
  };

  return (
    <>
      <PageHeader title="Categories" subtitle="Every expense category belongs to one bucket. You choose categories; the bucket follows." />
      <PageTip id="categories" title="Categories decide the bucket">
        Each category belongs to one bucket. Moving a category to another bucket changes past bucket totals too, so you’ll be asked to confirm. Disable categories you don’t use rather than deleting them.
      </PageTip>
      <div className="stack">
        {buckets.data.map((b) => section(b.name, b.colour, b.id, 'EXPENSE'))}
        {section('Income', null, null, 'INCOME')}
      </div>
      {editing ? <CategoryForm editing={editing} categories={all} buckets={buckets.data} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeleteCategoryDialog category={deleting} categories={all} onClose={() => setDeleting(null)} /> : null}
    </>
  );
}

function CategoryForm({ editing, categories, buckets, onClose }: { editing: Editing; categories: Category[]; buckets: Bucket[]; onClose: () => void }) {
  const existing = editing.mode === 'edit' ? editing.category : null;
  const kind = existing?.kind ?? (editing.mode === 'new' ? editing.kind : 'EXPENSE');
  const isGroup = existing?.isGroup ?? (editing.mode === 'new' ? editing.isGroup : false);
  const [name, setName] = useState(existing?.name ?? '');
  const [bucketId, setBucketId] = useState(existing?.bucketId ?? (editing.mode === 'new' ? editing.bucketId : null) ?? '');
  const [parentId, setParentId] = useState(existing?.parentId ?? (editing.mode === 'new' ? editing.parentId : null) ?? '');
  const [confirmMove, setConfirmMove] = useState(false);
  const toast = useToast();
  const save = useApiMutation(
    (body: Record<string, unknown>) => (existing ? api.put(`/categories/${existing.id}`, body) : api.post('/categories', body)),
    CATEGORY_QUERIES,
  );

  const groups = categories.filter((c) => c.isGroup && c.kind === kind && (kind === 'INCOME' || c.bucketId === bucketId));
  const bucketChanged = existing && existing.bucketId !== (bucketId || null);

  async function submit(e: FormEvent, confirmed = false) {
    e.preventDefault();
    if (bucketChanged && !confirmed) {
      setConfirmMove(true);
      return;
    }
    const body: Record<string, unknown> = existing
      ? { name, ...(kind === 'EXPENSE' ? { bucketId: bucketId || null } : {}), ...(isGroup ? {} : { parentId: parentId || null }), ...(bucketChanged ? { confirmBucketChange: true } : {}) }
      : { name, kind, isGroup, bucketId: kind === 'EXPENSE' ? bucketId || null : null, parentId: isGroup ? null : parentId || null };
    try {
      await save.mutateAsync(body);
      toast(existing ? 'Saved' : 'Added');
      onClose();
    } catch {
      setConfirmMove(false);
    }
  }

  const title = existing ? `Edit ${isGroup ? 'group' : 'category'}` : `Add ${isGroup ? 'group' : 'category'}`;
  return (
    <>
      <Modal
        title={title}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="category-form" className="btn primary" disabled={save.isPending || !name.trim()}>
              Save
            </button>
          </>
        }
      >
        <form id="category-form" className="stack" onSubmit={submit} noValidate>
          <FormError error={save.error} />
          <Field label="Name" error={save.error instanceof ApiError && save.error.code === 'DUPLICATE_NAME' ? save.error.message : null}>
            {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          {kind === 'EXPENSE' ? (
            <Field label="Bucket" hint={existing ? 'Moving a category changes historical bucket totals.' : undefined}>
              {(p) => (
                <select
                  {...p}
                  className="input"
                  value={bucketId}
                  onChange={(e) => {
                    setBucketId(e.target.value);
                    setParentId('');
                  }}
                >
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          {!isGroup ? (
            <Field label="Group">
              {(p) => (
                <select {...p} className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">No group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </form>
      </Modal>
      {confirmMove ? (
        <ConfirmDialog
          title="Move to another bucket?"
          message={`Bucket totals are worked out from categories, so every past transaction in ${existing?.name ?? 'this category'} will count toward ${buckets.find((b) => b.id === bucketId)?.name ?? 'the new bucket'} instead — including in past periods.`}
          confirmLabel="Move it"
          danger={false}
          busy={save.isPending}
          onCancel={() => setConfirmMove(false)}
          onConfirm={() => submit({ preventDefault() {} } as FormEvent, true)}
        />
      ) : null}
    </>
  );
}

function DeleteCategoryDialog({ category, categories, onClose }: { category: Category; categories: Category[]; onClose: () => void }) {
  const [reassignTo, setReassignTo] = useState('');
  const toast = useToast();
  const remove = useApiMutation(() => api.delete(`/categories/${category.id}${reassignTo ? `?reassignTo=${reassignTo}` : ''}`), CATEGORY_QUERIES);
  const inUse = (category.transactionCount ?? 0) > 0 || (remove.error instanceof ApiError && remove.error.code === 'CATEGORY_IN_USE');
  const targets = categories.filter((c) => !c.isGroup && c.isActive && c.kind === category.kind && c.id !== category.id);

  return (
    <ConfirmDialog
      title={`Delete ${category.name}?`}
      busy={remove.isPending}
      confirmLabel={inUse ? 'Reassign and delete' : 'Delete'}
      onCancel={onClose}
      onConfirm={async () => {
        if (inUse && !reassignTo) return;
        try {
          await remove.mutateAsync(undefined);
          toast(`${category.name} deleted`);
          onClose();
        } catch {
          /* shown */
        }
      }}
      message={
        <>
          {remove.error && !(remove.error instanceof ApiError && remove.error.code === 'CATEGORY_IN_USE') ? <FormError error={remove.error} /> : null}
          {category.isGroup ? (
            <p>The group must be empty before it can be deleted.</p>
          ) : inUse ? (
            <>
              <p>
                {category.name} has history. Choose a category to move it to, or cancel and disable it instead to keep it as is.
              </p>
              <select className="input" aria-label="Reassign to" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                <option value="">Move its transactions to…</option>
                {targets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p>It isn’t used anywhere, so it can be deleted safely.</p>
          )}
        </>
      }
    />
  );
}
