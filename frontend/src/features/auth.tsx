import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { keys, useRegistration } from '../api/hooks';
import type { Me } from '../api/types';
import { Field } from '../components/Field';
import { FormError } from '../components/States';
import { pendingInvite } from '../lib/invite';

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <span>Home Budget</span>
        </div>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function fieldError(error: unknown, field: string) {
  return error instanceof ApiError && error.field === field ? error.message : null;
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const registration = useRegistration();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>('/auth/login', { email, password });
      qc.setQueryData(keys.me, me);
      navigate(pendingInvite() ? '/invite' : '/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Log in">
      <form className="stack" onSubmit={submit} noValidate>
        <FormError error={error} />
        <Field label="Email">{(p) => <input {...p} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password">
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <div className="row wrap small">
          <Link to="/forgot-password">Forgot password?</Link>
          <span className="spacer" />
          {registration.data?.open ? <Link to="/register">Create an account</Link> : null}
        </div>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const registration = useRegistration();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const me = await api.post<Me>('/auth/register', { ...form, timezone });
      qc.setQueryData(keys.me, me);
      qc.invalidateQueries({ queryKey: keys.registration });
      navigate('/dashboard');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (registration.data && !registration.data.open) {
    return (
      <AuthCard title="Registration is closed">
        <p className="muted">This server is not accepting new accounts. To join someone’s household, ask them for an invite link and open it.</p>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/login">Back to log in</Link>
        </p>
      </AuthCard>
    );
  }

  const isFirst = registration.data?.open;
  return (
    <AuthCard title="Create your household">
      <form className="stack" onSubmit={submit} noValidate>
        {isFirst ? <p className="muted small">You’ll be the household owner.</p> : null}
        <FormError error={error instanceof ApiError && error.field ? null : error} />
        <Field label="Your name" error={fieldError(error, 'name')}>
          {(p) => <input {...p} className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Field label="Email" error={fieldError(error, 'email')}>
          {(p) => <input {...p} className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Password" hint="At least 12 characters. A few random words work well." error={fieldError(error, 'password')}>
          {(p) => (
            <input {...p} className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          )}
        </Field>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="small">
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const registration = useRegistration();
  const cliOnly = registration.data?.passwordReset === 'cli';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <AuthCard title="Reset your password">
      {cliOnly ? (
        <div className="stack">
          <p>Email isn’t set up on this server. Whoever runs it can reset your password with:</p>
          <pre className="card small" style={{ overflowX: 'auto', margin: 0 }}>
            docker compose exec backend npm run reset-password -- you@example.com
          </pre>
          <Link to="/login">Back to log in</Link>
        </div>
      ) : sent ? (
        <div className="stack">
          <p>If an account exists for that email, a reset link is on its way. It works for 30 minutes.</p>
          <Link to="/login">Back to log in</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <FormError error={error} />
          <Field label="Email">{(p) => <input {...p} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <button className="btn primary" type="submit">
            Send reset link
          </button>
          <Link to="/login" className="small">
            Back to log in
          </Link>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // Read once, then drop the token from the address bar so it isn't kept in history or sent as a Referer.
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => {
    if (params.has('token')) navigate('/reset-password', { replace: true });
  }, [params, navigate]);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <div className="stack">
          <p>Your password has been changed and all sessions were signed out.</p>
          <Link to="/login" className="btn primary">
            Log in
          </Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <FormError error={error} />
          <Field label="New password" hint="At least 12 characters.">
            {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <button className="btn primary" type="submit" disabled={!token}>
            Set password
          </button>
        </form>
      )}
    </AuthCard>
  );
}
