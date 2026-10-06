import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { keys, useApiMutation, useBuckets, useMembers, useNotificationSettings, useSessions, useSettings } from '../api/hooks';
import type { HouseholdMembers, NotificationSetting } from '../api/types';
import { ConfirmDialog } from '../components/Modal';
import { TabList, tabPanelProps } from '../components/Tabs';
import type { Settings } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { ErrorState, FormError, Loading, errorMessage } from '../components/States';
import { Field } from '../components/Field';
import { DateInput } from '../components/DateInput';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../lib/format';
import { useHousehold } from '../lib/household';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { strings } from '../locales/en-AU';
import { BucketEditor } from './BucketEditor';
import { BankFeedsSettings } from './BankFeedsSettings';
import { TwoStepSettings } from './TwoStepSettings';

const SECTIONS = ['Budget', 'Localisation', 'Notifications', 'Household', 'Bank feeds', 'Security', 'Data', 'Appearance'] as const;
type Section = (typeof SECTIONS)[number];

function Card({ title, children, description }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card stack">
      <div>
        <h2>{title}</h2>
        {description ? <p className="muted small" style={{ marginTop: '0.25rem' }}>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const [params] = useSearchParams();
  const [section, setSection] = useState<Section>((SECTIONS as readonly string[]).includes(params.get('section') ?? '') ? (params.get('section') as Section) : 'Budget');
  const settings = useSettings();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  return (
    <>
      <PageHeader title="Settings" />
      <TabList label="Settings sections" id="settings" tabs={SECTIONS.map((s) => ({ key: s, label: s }))} value={section} onChange={setSection} />
      <div className="stack" {...tabPanelProps('settings', section)}>
        {section === 'Budget' ? <BudgetSettings settings={settings.data} /> : null}
        {section === 'Localisation' ? <LocalisationSettings settings={settings.data} /> : null}
        {section === 'Household' ? <HouseholdSettings settings={settings.data} /> : null}
        {section === 'Notifications' ? <NotificationSettings /> : null}
        {section === 'Bank feeds' ? <BankFeedsSettings /> : null}
        {section === 'Security' ? <SecuritySettings /> : null}
        {section === 'Data' ? <DataSettings settings={settings.data} /> : null}
        {section === 'Appearance' ? <AppearanceSettings /> : null}
      </div>
    </>
  );
}

function useSaveSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useApiMutation((body: Partial<Settings>) => api.put<Settings>('/settings', body), [keys.settings, keys.me, ['dashboard'], ['budgets']]);
  return {
    ...m,
    save: async (body: Partial<Settings>) => {
      try {
        await m.mutateAsync(body);
        await qc.invalidateQueries({ queryKey: keys.me });
        toast('Settings saved');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    },
  };
}

function BudgetSettings({ settings }: { settings: Settings }) {
  const buckets = useBuckets();
  const toast = useToast();
  // Bucket changes touch every view that groups by bucket.
  const bucketViews = [keys.buckets, ['dashboard'], ['budgets'], ['categories'], ['accounts'], ['reports'], ['calendar']];
  const saveBuckets = useApiMutation((b: { id: string; name: string; percentage: string }[]) => api.put('/buckets', { buckets: b }), bucketViews);
  const addBucket = useApiMutation((name: string) => api.post('/buckets', { name }), bucketViews);
  const removeBucket = useApiMutation((v: { id: string; moveTo: string }) => api.delete<{ movedCategories: number }>(`/buckets/${v.id}`, { moveTo: v.moveTo }), bucketViews);
  const { save, isPending } = useSaveSettings();
  const [form, setForm] = useState({
    budgetPeriodType: settings.budgetPeriodType,
    budgetAnchorDate: settings.budgetAnchorDate,
    displayFrequency: settings.displayFrequency,
    allocationBasis: settings.allocationBasis,
    amberThreshold: String(settings.amberThreshold),
    redThreshold: String(settings.redThreshold),
    forecastMethod: settings.forecastMethod === 'MANUAL' ? 'AVG3' : settings.forecastMethod,
  });

  return (
    <>
      <Card title="Buckets" description="Name your buckets, put them in order and share take-home income across them (exactly 100%). Up to 8 buckets.">
        {buckets.isPending ? (
          <Loading />
        ) : buckets.isError ? (
          <ErrorState error={buckets.error} />
        ) : (
          <BucketEditor
            key={buckets.dataUpdatedAt}
            buckets={buckets.data}
            saving={saveBuckets.isPending}
            onSave={async (rows) => {
              try {
                await saveBuckets.mutateAsync(rows);
                toast('Buckets saved');
              } catch (err) {
                toast(errorMessage(err), 'error');
              }
            }}
            onAdd={async (name) => {
              try {
                await addBucket.mutateAsync(name);
                toast(`${name} added at 0%`);
              } catch (err) {
                toast(errorMessage(err), 'error');
                throw err;
              }
            }}
            onRemove={async (id, moveTo) => {
              try {
                const r = await removeBucket.mutateAsync({ id, moveTo });
                toast(`Bucket removed; ${r.movedCategories} categor${r.movedCategories === 1 ? 'y' : 'ies'} moved`);
              } catch (err) {
                toast(errorMessage(err), 'error');
              }
            }}
          />
        )}
      </Card>
      <Card title="Budget period">
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save({ ...form, amberThreshold: Number(form.amberThreshold), redThreshold: Number(form.redThreshold) });
          }}
        >
          <div className="grid-2">
            <Field label="Budget period">
              {(p) => (
                <select {...p} className="input" value={form.budgetPeriodType} onChange={(e) => setForm({ ...form, budgetPeriodType: e.target.value as Settings['budgetPeriodType'] })}>
                  {(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUAL'] as const).map((p) => (
                    <option key={p} value={p}>
                      {strings.frequencies[p]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Period starts on" hint={form.budgetPeriodType === 'FORTNIGHTLY' ? 'Use a payday so fortnights line up with your pay.' : undefined}>
              {(p) => <DateInput {...p} value={form.budgetAnchorDate} onChange={(d) => setForm({ ...form, budgetAnchorDate: d })} />}
            </Field>
            <Field label="Show planning figures as" hint="Normalised amounts such as expected income.">
              {(p) => (
                <select {...p} className="input" value={form.displayFrequency} onChange={(e) => setForm({ ...form, displayFrequency: e.target.value as Settings['displayFrequency'] })}>
                  {(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUALLY'] as const).map((p) => (
                    <option key={p} value={p}>
                      {strings.frequencies[p]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Allocate buckets from">
              {(p) => (
                <select {...p} className="input" value={form.allocationBasis} onChange={(e) => setForm({ ...form, allocationBasis: e.target.value as Settings['allocationBasis'] })}>
                  <option value="PLANNED">Planned income</option>
                  <option value="ACTUAL">Actual income received</option>
                </select>
              )}
            </Field>
            <Field label="Amber warning at (% used)">
              {(p) => <input {...p} className="input right" inputMode="decimal" value={form.amberThreshold} onChange={(e) => setForm({ ...form, amberThreshold: e.target.value })} />}
            </Field>
            <Field label="Forecast from" hint="How reports project each category; you can override a category on its edit screen.">
              {(p) => (
                <select {...p} className="input" value={form.forecastMethod} onChange={(e) => setForm({ ...form, forecastMethod: e.target.value as 'AVG3' | 'AVG6' | 'AVG12' })}>
                  <option value="AVG3">3-month average</option>
                  <option value="AVG6">6-month average</option>
                  <option value="AVG12">12-month average</option>
                </select>
              )}
            </Field>
            <Field label="Red warning above (% used)">
              {(p) => <input {...p} className="input right" inputMode="decimal" value={form.redThreshold} onChange={(e) => setForm({ ...form, redThreshold: e.target.value })} />}
            </Field>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={isPending}>
              Save
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}

const TIMEZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Australia/Sydney'];
const CURRENCIES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : ['AUD'];

function LocalisationSettings({ settings }: { settings: Settings }) {
  const { save, isPending } = useSaveSettings();
  const [form, setForm] = useState({
    currency: settings.currency,
    locale: settings.locale,
    timezone: settings.timezone,
    fyStartMonth: settings.fyStartMonth,
    weekStartDay: settings.weekStartDay,
  });
  return (
    <Card title="Localisation" description="Defaults follow Australian conventions. Changing currency relabels amounts; it does not convert them.">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save(form);
        }}
      >
        <div className="grid-2">
          <Field label="Currency">
            {(p) => (
              <select {...p} className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Locale" hint="Sets date and number formats, e.g. en-AU, en-NZ, en-GB, en-US.">
            {(p) => <input {...p} className="input" value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} />}
          </Field>
          <Field label="Time zone">
            {(p) => (
              <select {...p} className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                {TIMEZONES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Financial year starts">
            {(p) => (
              <select {...p} className="input" value={form.fyStartMonth} onChange={(e) => setForm({ ...form, fyStartMonth: Number(e.target.value) })}>
                {strings.months.map((m, i) => (
                  <option key={m} value={i + 1}>
                    1 {m}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Week starts on">
            {(p) => (
              <select {...p} className="input" value={form.weekStartDay} onChange={(e) => setForm({ ...form, weekStartDay: Number(e.target.value) })}>
                {strings.weekdays.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={isPending}>
            Save
          </button>
        </div>
      </form>
    </Card>
  );
}

function HouseholdSettings({ settings }: { settings: Settings }) {
  const { save, isPending } = useSaveSettings();
  const [name, setName] = useState(settings.name);
  return (
    <>
    <Card title="Household">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save({ name });
        }}
      >
        <Field label="Household name">{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={isPending || !name.trim()}>
            Save
          </button>
        </div>
      </form>
    </Card>
    <MembersCard />
    </>
  );
}

type Member = HouseholdMembers['members'][number];

/** Who shares this household, invites for new people, and (for the owner) managing members. */
function MembersCard() {
  const members = useMembers();
  const { me, locale, timezone } = useHousehold();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [inviteEmail, setInviteEmail] = useState('');
  const [created, setCreated] = useState<{ link: string; emailed: boolean; expiresAt: string; email: string | null } | null>(null);
  const [inviteError, setInviteError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'owner'; member: Member } | 'leave' | null>(null);
  const [busy, setBusy] = useState(false);
  const createInvite = useApiMutation((email: string | null) => api.post<{ link: string; emailed: boolean; expiresAt: string }>('/household/invites', { email }), [['members']]);
  const revoke = useApiMutation((id: string) => api.delete(`/household/invites/${id}`), [['members']]);

  if (members.isPending) return <Loading />;
  if (members.isError) return <ErrorState error={members.error} onRetry={() => members.refetch()} />;
  const { canManage, invites } = members.data;
  const householdName = me?.household.name ?? 'this household';
  const onlyHousehold = (me?.households.length ?? 1) <= 1;

  async function afterLeaving(accountDeleted: boolean) {
    qc.clear();
    navigate(accountDeleted ? '/login' : '/dashboard', { replace: true });
  }

  async function runConfirmed() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === 'leave') {
        const r = await api.post<{ accountDeleted: boolean }>('/household/leave');
        await afterLeaving(r.accountDeleted);
        return;
      }
      if (confirm.kind === 'remove') {
        await api.delete(`/household/members/${confirm.member.userId}`);
        toast(`${confirm.member.name} was removed`);
      } else {
        await api.post(`/household/members/${confirm.member.userId}/make-owner`);
        toast(`${confirm.member.name} is now the owner`);
        await qc.invalidateQueries({ queryKey: keys.me });
      }
      await qc.invalidateQueries({ queryKey: ['members'] });
      setConfirm(null);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Members" description="Everyone here sees and edits the same budget. Only the owner can invite or remove people, or delete the household.">
        <div>
          {members.data.members.map((m) => (
            <div key={m.userId} className="list-item" style={{ flexWrap: 'wrap' }}>
              <div className="grow">
                <strong>{m.name}</strong> {m.isYou ? <span className="muted small">(you)</span> : null}
                <div className="muted small">
                  {m.email} · joined {formatDateTime(m.joinedAt, locale, timezone)}
                </div>
              </div>
              <span className={`badge${m.role === 'OWNER' ? ' ok' : ''}`}>{m.role === 'OWNER' ? 'Owner' : 'Member'}</span>
              {canManage && !m.isYou ? (
                <>
                  <button type="button" className="btn small" onClick={() => setConfirm({ kind: 'owner', member: m })}>
                    Make owner
                  </button>
                  <button type="button" className="btn small danger" onClick={() => setConfirm({ kind: 'remove', member: m })}>
                    Remove
                  </button>
                </>
              ) : null}
              {!canManage && m.isYou ? (
                <button type="button" className="btn small danger" onClick={() => setConfirm('leave')}>
                  Leave household
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {canManage ? (
        <Card title="Invite someone" description="Creates a link that lets one person join this household. It works once and expires after 7 days.">
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setInviteError(null);
              try {
                const email = inviteEmail.trim() || null;
                const r = await createInvite.mutateAsync(email);
                setCreated({ ...r, email });
                setInviteEmail('');
              } catch (err) {
                setInviteError(err);
              }
            }}
          >
            <FormError error={inviteError} />
            <Field label="Their email (optional)" hint="If you add it, only that address can use the link — and it’s emailed to them when email is set up on this server.">
              {(p) => <input {...p} className="input" type="email" autoComplete="off" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />}
            </Field>
            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={createInvite.isPending}>
                Create invite link
              </button>
            </div>
          </form>
          {created ? (
            <div className="tip" role="status" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <strong>{created.emailed ? `Invite emailed to ${created.email}` : 'Invite link ready'}</strong>
              <p className="small">
                {created.emailed ? 'You can also send them this link yourself.' : 'Send this link to the person you’re inviting, by message or email.'} It works once, expires on{' '}
                {formatDateTime(created.expiresAt, locale, timezone)}, and won’t be shown again.
              </p>
              <div className="row" style={{ gap: '0.5rem' }}>
                <input className="input grow" readOnly value={created.link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(created.link);
                      toast('Link copied');
                    } catch {
                      toast('Select the link and copy it', 'error');
                    }
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          ) : null}
          {invites.length ? (
            <div>
              <span className="field-label">Open invites</span>
              {invites.map((i) => (
                <div key={i.id} className="list-item">
                  <div className="grow">
                    <div>{i.email ?? 'Anyone with the link'}</div>
                    <div className="muted small">
                      {i.invitedBy ? `by ${i.invitedBy} · ` : ''}expires {formatDateTime(i.expiresAt, locale, timezone)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn small"
                    onClick={async () => {
                      await revoke.mutateAsync(i.id);
                      toast('Invite revoked');
                    }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={runConfirmed}
          {...(confirm === 'leave'
            ? {
                title: `Leave ${householdName}?`,
                confirmLabel: 'Leave',
                message: onlyHousehold
                  ? 'This is your only household, so your login will be deleted too. The household and its data stay with the other members.'
                  : 'You’ll lose access to this household’s budget. Its data stays with the other members.',
              }
            : confirm.kind === 'remove'
              ? {
                  title: `Remove ${confirm.member.name}?`,
                  confirmLabel: 'Remove',
                  message: `${confirm.member.name} will lose access to this household straight away. If it’s their only household, their login is deleted too. The household’s data isn’t changed.`,
                }
              : {
                  title: `Make ${confirm.member.name} the owner?`,
                  confirmLabel: 'Make owner',
                  danger: false,
                  message: `${confirm.member.name} will be able to invite and remove people and delete the household. You’ll become a member.`,
                })}
        />
      ) : null}
    </>
  );
}

function SecuritySettings() {
  const sessions = useSessions();
  const { locale, timezone } = useHousehold();
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const change = useApiMutation((body: typeof pw) => api.post('/auth/change-password', body), [keys.sessions]);
  const revoke = useApiMutation((id: string) => api.delete(`/auth/sessions/${id}`), [keys.sessions]);

  return (
    <>
      <TwoStepSettings />
      <Card title="Change password" description="Changing your password signs out every other device.">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await change.mutateAsync(pw);
              setPw({ currentPassword: '', newPassword: '' });
              toast('Password changed. Other devices were signed out.');
            } catch {
              /* shown */
            }
          }}
        >
          <FormError error={change.error} />
          <div className="grid-2">
            <Field label="Current password">
              {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}
            </Field>
            <Field label="New password" hint="At least 12 characters.">
              {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}
            </Field>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={change.isPending || !pw.currentPassword || !pw.newPassword}>
              Change password
            </button>
          </div>
        </form>
      </Card>
      <Card title="Active sessions">
        {sessions.isPending ? (
          <Loading />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} />
        ) : (
          <div>
            {sessions.data.map((s) => (
              <div key={s.id} className="list-item">
                <div className="grow">
                  <div className="truncate">{describeAgent(s.userAgent)}</div>
                  <div className="muted small">
                    Last active {formatDateTime(s.lastSeenAt, locale, timezone)} · signed in {formatDateTime(s.createdAt, locale, timezone)}
                  </div>
                </div>
                {s.current ? (
                  <span className="badge ok">This device</span>
                ) : (
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={async () => {
                      await revoke.mutateAsync(s.id);
                      toast('Session signed out');
                    }}
                  >
                    Sign out
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function AppearanceSettings() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => setThemePref(pref), [pref]);
  return (
    <>
    <Card title="Help" description="Bring back the getting-started checklist and the tips at the top of each page.">
      <div>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await api.post('/me/tips/reset');
            await Promise.all([qc.invalidateQueries({ queryKey: keys.me }), qc.invalidateQueries({ queryKey: ['onboarding'] })]);
            toast('Tips are showing again');
          }}
        >
          Show help tips again
        </button>
      </div>
    </Card>
    <Card title="Appearance">
      <div className="segmented" role="group" aria-label="Theme">
        {(['light', 'dark', 'system'] as const).map((p) => (
          <button key={p} type="button" aria-pressed={pref === p} onClick={() => setPref(p)}>
            {p === 'system' ? 'System' : p === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
    </Card>
    </>
  );
}

const NOTIFICATION_LABELS: Record<NotificationSetting['type'], { title: string; help: string; days?: string }> = {
  UPCOMING_BILL: { title: 'Bills due soon', help: 'A bill or repayment that hasn’t been recorded yet. (Auto-post schedules record themselves.)', days: 'Days before' },
  OVERSPENDING: { title: 'Near or over budget', help: 'A category reaches the amber threshold, and again if it goes over.' },
  SINKING_FUND_DEADLINE: { title: 'Sinking fund deadlines', help: 'A fund is due soon and isn’t fully saved yet.', days: 'Days before' },
  BUDGET_REVIEW: { title: 'New budget period', help: 'At the start of each period, with how the last one went.' },
  GOAL_MILESTONE: { title: 'Goal milestones', help: 'A goal reaches 25%, 50%, 75% or 100%.' },
};

function NotificationSettings() {
  const query = useNotificationSettings();
  const toast = useToast();
  const [items, setItems] = useState<NotificationSetting[] | null>(null);
  const save = useApiMutation((body: unknown) => api.put('/notifications/settings', body), [['notifications']]);
  useEffect(() => {
    if (query.data && !items) setItems(query.data.items);
  }, [query.data, items]);
  if (query.isPending || !items) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const set = (type: NotificationSetting['type'], patch: Partial<NotificationSetting>) => setItems(items.map((i) => (i.type === type ? { ...i, ...patch } : i)));
  return (
    <Card title="Notifications" description="Alerts appear under the bell at the top of the page. They’re checked whenever you open the app (and hourly in the background), and each one appears only once.">
      {!query.data.emailAvailable ? <p className="muted small">Email isn’t set up on this server (SMTP in .env), so alerts are in-app only.</p> : null}
      <div className="stack-sm">
        {items.map((i) => {
          const label = NOTIFICATION_LABELS[i.type];
          return (
            <div key={i.type} className="list-item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <label className="checkbox grow" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={i.enabled} onChange={(e) => set(i.type, { enabled: e.target.checked })} />
                <span>
                  <strong>{label.title}</strong>
                  <span className="muted small" style={{ display: 'block' }}>{label.help}</span>
                </span>
              </label>
              {label.days ? (
                <label className="row small" style={{ gap: '0.4rem' }}>
                  {label.days}
                  <input className="input right" style={{ width: 70 }} type="number" min={0} max={60} disabled={!i.enabled} value={i.daysBefore ?? ''} onChange={(e) => set(i.type, { daysBefore: e.target.value === '' ? null : Number(e.target.value) })} />
                </label>
              ) : null}
              <label className="checkbox small">
                <input type="checkbox" disabled={!i.enabled || !query.data.emailAvailable} checked={i.emailEnabled} onChange={(e) => set(i.type, { emailEnabled: e.target.checked })} />
                Email
              </label>
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn primary"
          disabled={save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({ items });
              toast('Notification settings saved');
            } catch (err) {
              toast(errorMessage(err), 'error');
            }
          }}
        >
          Save
        </button>
      </div>
    </Card>
  );
}

const CSV_ENTITIES: { key: string; label: string }[] = [
  { key: 'transactions', label: 'Transactions (one row per category split)' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'categories', label: 'Categories' },
  { key: 'budget', label: 'Budget plans' },
  { key: 'recurring', label: 'Recurring schedules' },
  { key: 'sinking-funds', label: 'Sinking funds' },
  { key: 'goals', label: 'Goals' },
  { key: 'debts', label: 'Debts' },
  { key: 'assets', label: 'Asset valuations' },
  { key: 'rules', label: 'Rules' },
];

function DataSettings({ settings }: { settings: Settings }) {
  const { me } = useHousehold();
  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const owner = me?.household.role === 'OWNER';
  return (
    <>
      <Card title="Export your data" description="A copy of everything, to keep or to use elsewhere. It complements, but doesn’t replace, the server’s database backups.">
        <div className="row wrap">
          <a className="btn primary" href="/api/export?format=json" download>
            Download everything (JSON)
          </a>
        </div>
        <div className="stack-sm">
          <span className="field-label">Or one spreadsheet at a time (CSV)</span>
          <div className="row wrap">
            {CSV_ENTITIES.map((e) => (
              <a key={e.key} className="btn small" href={`/api/export?format=csv&entity=${e.key}`} download>
                {e.label}
              </a>
            ))}
          </div>
        </div>
      </Card>
      {owner ? (
        <section className="card stack danger-zone">
          <div>
            <h2>Delete household</h2>
            <p className="muted small" style={{ marginTop: '0.25rem' }}>
              Permanently deletes “{settings.name}” and every account, transaction, budget and setting in it. Members with no other household lose their login. This can’t be undone — download an export first.
            </p>
          </div>
          <div>
            <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
              Delete household…
            </button>
          </div>
        </section>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title="Delete this household?"
          confirmLabel="Delete everything"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setError(null);
            setBusy(true);
            try {
              await api.delete('/household', { confirmName, password });
              qc.clear();
              navigate('/login');
            } catch (err) {
              setError(err);
              setBusy(false);
            }
          }}
          message={
            <div className="stack">
              <FormError error={error} />
              <Field label={`Type “${settings.name}” to confirm`}>{(p) => <input {...p} className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />}</Field>
              <Field label="Your password">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            </div>
          }
        />
      ) : null}
    </>
  );
}
