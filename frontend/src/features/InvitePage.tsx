import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { keys } from '../api/hooks';
import type { InviteInfo, Me } from '../api/types';
import { Field } from '../components/Field';
import { FormError, Loading } from '../components/States';
import { formatDate } from '../lib/format';
import { forgetInvite, pendingInvite, rememberInvite } from '../lib/invite';
import { AuthCard, fieldError } from './auth';

/**
 * /invite#<token>: join a household. New people create an account here (even
 * when sign-up is closed); people with an account log in, then join.
 */
const VIEWER = ['invite-viewer'] as const;

export function InvitePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [token] = useState(() => window.location.hash.slice(1) || pendingInvite() || '');
  useEffect(() => {
    if (!token) return;
    rememberInvite(token);
    // Out of the address bar and history once read.
    if (window.location.hash) window.history.replaceState(null, '', '/invite');
  }, [token]);

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.post<InviteInfo>('/invites/lookup', { token }),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });
  // Who's logged in, if anyone. A 401 just means "nobody". Its own key, because
  // the app-wide 401 handler clears keys.me (which would refetch it in a loop).
  const me = useQuery({ queryKey: VIEWER, queryFn: () => api.get<Me>('/auth/me'), retry: false });

  function done(next: Me) {
    forgetInvite();
    qc.clear();
    qc.setQueryData(keys.me, next);
    navigate('/dashboard', { replace: true });
  }

  if (!token) {
    return (
      <AuthCard title="Invite link incomplete">
        <p className="muted">This link is missing its code. Open the full link from the invite, or ask for a new one.</p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/login">Go to log in</Link>
        </p>
      </AuthCard>
    );
  }
  if (invite.isPending || me.isPending) return <Loading />;
  if (invite.isError) {
    return (
      <AuthCard title="This invite can’t be used">
        <p className="muted">{invite.error instanceof ApiError ? invite.error.message : 'Something went wrong. Try again.'}</p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/login" onClick={forgetInvite}>
            Go to log in
          </Link>
        </p>
      </AuthCard>
    );
  }

  const info = invite.data;
  const intro = (
    <p className="muted">
      {info.invitedBy ? `${info.invitedBy} has invited you` : 'You’ve been invited'} to share the budget for <strong>{info.householdName}</strong>. The invite expires on {formatDate(info.expiresAt.slice(0, 10), 'en-AU', 'long')}.
    </p>
  );

  if (me.data) return <AcceptAsUser me={me.data} info={info} token={token} intro={intro} onJoined={done} />;
  return <RegisterWithInvite info={info} token={token} intro={intro} onJoined={done} />;
}

function AcceptAsUser({ me, info, token, intro, onJoined }: { me: Me; info: InviteInfo; token: string; intro: React.ReactNode; onJoined: (me: Me) => void }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const wrongAccount = info.email !== null && info.email !== me.user.email;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      onJoined(await api.post<Me>('/invites/accept', { token }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  async function switchAccount() {
    await api.post('/auth/logout').catch(() => {});
    qc.removeQueries({ queryKey: keys.me });
    await qc.resetQueries({ queryKey: VIEWER });
  }

  return (
    <AuthCard title={`Join ${info.householdName}`}>
      <div className="stack">
        {intro}
        <FormError error={error} />
        {wrongAccount ? (
          <>
            <p>
              This invite is for <strong>{info.email}</strong>, but you’re logged in as {me.user.email}.
            </p>
            <button type="button" className="btn primary" onClick={switchAccount}>
              Log out and continue
            </button>
          </>
        ) : (
          <>
            <p className="small">
              You’ll join as <strong>{me.user.email}</strong>.{' '}
              {me.households.length ? 'Your other households stay as they are; switch between them from the top of the page.' : ''}
            </p>
            <button type="button" className="btn primary" onClick={join} disabled={busy}>
              {busy ? 'Joining…' : `Join ${info.householdName}`}
            </button>
            <button type="button" className="link-btn small" onClick={switchAccount}>
              Use a different account
            </button>
          </>
        )}
      </div>
    </AuthCard>
  );
}

function RegisterWithInvite({ info, token, intro, onJoined }: { info: InviteInfo; token: string; intro: React.ReactNode; onJoined: (me: Me) => void }) {
  const [form, setForm] = useState({ name: '', email: info.email ?? '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onJoined(await api.post<Me>('/invites/register', { token, ...form }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  // The invited email already has an account: log in, then come back here.
  if (info.hasAccount) {
    return (
      <AuthCard title={`Join ${info.householdName}`}>
        <div className="stack">
          {intro}
          <p>
            <strong>{info.email}</strong> already has an account here. Log in to join.
          </p>
          <button type="button" className="btn primary" onClick={() => navigate('/login')}>
            Log in to join
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Join ${info.householdName}`}>
      <form className="stack" onSubmit={submit} noValidate>
        {intro}
        <FormError error={error instanceof ApiError && error.field ? null : error} />
        <Field label="Your name" error={fieldError(error, 'name')}>
          {(p) => <input {...p} className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Field label="Email" hint={info.email ? 'This invite is for this address.' : undefined} error={fieldError(error, 'email')}>
          {(p) => (
            <input {...p} className="input" type="email" autoComplete="email" readOnly={info.email !== null} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          )}
        </Field>
        <Field label="Password" hint="At least 12 characters. A few random words work well." error={fieldError(error, 'password')}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Joining…' : 'Create account and join'}
        </button>
        <p className="small">
          Already have an account? <Link to="/login">Log in</Link> and you’ll come back here.
        </p>
      </form>
    </AuthCard>
  );
}
