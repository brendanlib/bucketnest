import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { keys, useApiMutation, useBuckets, useSessions, useSettings } from '../api/hooks';
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
import { PercentageEditor } from './PercentageEditor';

const SECTIONS = ['Budget', 'Localisation', 'Household', 'Security', 'Appearance'] as const;
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
  const [section, setSection] = useState<Section>('Budget');
  const settings = useSettings();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="segmented" role="tablist" aria-label="Settings sections" style={{ marginBottom: '1rem' }}>
        {SECTIONS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={section === s} aria-pressed={section === s} onClick={() => setSection(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="stack" role="tabpanel">
        {section === 'Budget' ? <BudgetSettings settings={settings.data} /> : null}
        {section === 'Localisation' ? <LocalisationSettings settings={settings.data} /> : null}
        {section === 'Household' ? <HouseholdSettings settings={settings.data} /> : null}
        {section === 'Security' ? <SecuritySettings /> : null}
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
  const saveBuckets = useApiMutation((b: { id: string; percentage: string }[]) => api.put('/buckets', { buckets: b }), [keys.buckets, ['dashboard'], ['budgets']]);
  const { save, isPending } = useSaveSettings();
  const [form, setForm] = useState({
    budgetPeriodType: settings.budgetPeriodType,
    budgetAnchorDate: settings.budgetAnchorDate,
    displayFrequency: settings.displayFrequency,
    allocationBasis: settings.allocationBasis,
    amberThreshold: String(settings.amberThreshold),
    redThreshold: String(settings.redThreshold),
  });

  return (
    <>
      <Card title="Bucket percentages" description="How take-home income is shared across the buckets. Must total exactly 100%.">
        {buckets.isPending ? (
          <Loading />
        ) : buckets.isError ? (
          <ErrorState error={buckets.error} />
        ) : (
          <PercentageEditor
            key={buckets.dataUpdatedAt}
            buckets={buckets.data}
            saving={saveBuckets.isPending}
            onSave={async (values) => {
              try {
                await saveBuckets.mutateAsync(values);
                toast('Percentages saved');
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
    <Card title="Household" description="Members and invites come in a later release.">
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
