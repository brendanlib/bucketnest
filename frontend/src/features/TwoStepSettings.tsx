import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api } from '../api/client';
import { keys } from '../api/hooks';
import { Modal } from '../components/Modal';
import { Field } from '../components/Field';
import { FormError, Loading, ErrorState } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../lib/format';
import { useHousehold } from '../lib/household';

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

const useMfa = () => useQuery({ queryKey: ['mfa'], queryFn: () => api.get<MfaStatus>('/auth/mfa') });

/** Settings → Security: two-step sign-in with an authenticator app. */
export function TwoStepSettings() {
  const mfa = useMfa();
  const { locale, timezone } = useHousehold();
  const [dialog, setDialog] = useState<'enable' | 'disable' | 'codes' | null>(null);

  return (
    <section className="card stack">
      <div>
        <h2>Two-step sign-in</h2>
        <p className="muted small" style={{ marginTop: '0.25rem' }}>
          After your password, signing in also needs a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Authy…). Someone who learns your password still can’t get in.
        </p>
      </div>
      {mfa.isPending ? (
        <Loading />
      ) : mfa.isError ? (
        <ErrorState error={mfa.error} />
      ) : mfa.data.enabled ? (
        <>
          <div className="row wrap">
            <span className="badge ok">On</span>
            <span className="muted small">
              since {formatDateTime(mfa.data.enabledAt!, locale, timezone)} · {mfa.data.recoveryCodesLeft} recovery code{mfa.data.recoveryCodesLeft === 1 ? '' : 's'} left
            </span>
          </div>
          {mfa.data.recoveryCodesLeft <= 3 ? (
            <p className="error small" role="alert">
              You’re running low on recovery codes. Make new ones and keep them somewhere safe.
            </p>
          ) : null}
          <div className="row wrap">
            <button type="button" className="btn" onClick={() => setDialog('codes')}>
              New recovery codes
            </button>
            <button type="button" className="btn danger" onClick={() => setDialog('disable')}>
              Turn off
            </button>
          </div>
        </>
      ) : (
        <div>
          <button type="button" className="btn primary" onClick={() => setDialog('enable')}>
            Turn on two-step sign-in
          </button>
        </div>
      )}
      {dialog === 'enable' ? <EnableDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'disable' || dialog === 'codes' ? <ConfirmWithCodeDialog kind={dialog} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

function EnableDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<'password' | 'scan' | 'codes'>('password');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!setup) return;
    QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(null));
  }, [setup]);

  async function run(e: FormEvent, fn: () => Promise<void>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ['mfa'] });
    await qc.invalidateQueries({ queryKey: keys.sessions });
    toast('Two-step sign-in is on. Other devices were signed out.');
    onClose();
  };

  return (
    <Modal title="Turn on two-step sign-in" onClose={step === 'codes' ? () => saved && finish() : onClose}>
      {step === 'password' ? (
        <form
          className="stack"
          onSubmit={(e) =>
            run(e, async () => {
              setSetup(await api.post<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', { password }));
              setStep('scan');
            })
          }
        >
          <p className="muted small">First, confirm it’s you.</p>
          <FormError error={error} />
          <Field label="Your password">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}</Field>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!password || busy}>
              Continue
            </button>
          </div>
        </form>
      ) : step === 'scan' && setup ? (
        <form
          className="stack"
          onSubmit={(e) =>
            run(e, async () => {
              const r = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code });
              setCodes(r.recoveryCodes);
              setStep('codes');
            })
          }
        >
          <p className="small">1. In your authenticator app, add an account and scan this code.</p>
          <div className="qr-box">{qr ? <img src={qr} width={220} height={220} alt="QR code to add Home Budget to your authenticator app" /> : <Loading />}</div>
          <details className="small">
            <summary>Can’t scan it? Enter this key instead</summary>
            <code className="secret-key">{setup.secret.match(/.{1,4}/g)!.join(' ')}</code>
            <span className="muted"> (time-based, 6 digits)</span>
          </details>
          <p className="small">2. Enter the 6-digit code the app shows.</p>
          <FormError error={error} />
          <Field label="6-digit code">
            {(p) => <input {...p} className="input otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} />}
          </Field>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={code.replace(/\s/g, '').length !== 6 || busy}>
              Turn on
            </button>
          </div>
        </form>
      ) : (
        <RecoveryCodes codes={codes} saved={saved} onSaved={setSaved} onDone={finish} />
      )}
    </Modal>
  );
}

function RecoveryCodes({ codes, saved, onSaved, onDone }: { codes: string[]; saved: boolean; onSaved: (v: boolean) => void; onDone: () => void }) {
  const toast = useToast();
  const text = `Home Budget recovery codes\nEach code works once, if you can't use your authenticator app.\n\n${codes.join('\n')}\n`;
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return (
    <div className="stack">
      <p className="small">
        <strong>Save these recovery codes</strong> somewhere safe, such as a password manager. If you lose your phone, each one lets you sign in once. They won’t be shown again.
      </p>
      <ol className="recovery-codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="row wrap">
        <a className="btn small" href={href} download="home-budget-recovery-codes.txt">
          Download
        </a>
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast('Copied');
            } catch {
              toast('Select the codes and copy them', 'error');
            }
          }}
        >
          Copy
        </button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(e) => onSaved(e.target.checked)} /> I’ve saved these codes
      </label>
      <div className="form-actions">
        <button type="button" className="btn primary" disabled={!saved} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Turning it off, or replacing the recovery codes: both need the password and a current code. */
function ConfirmWithCodeDialog({ kind, onClose }: { kind: 'disable' | 'codes'; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['mfa'] });
    onClose();
  };

  return (
    <Modal title={kind === 'disable' ? 'Turn off two-step sign-in?' : 'New recovery codes'} onClose={codes ? () => saved && done() : onClose}>
      {codes ? (
        <RecoveryCodes codes={codes} saved={saved} onSaved={setSaved} onDone={done} />
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              if (kind === 'disable') {
                await api.post('/auth/mfa/disable', { password, code });
                toast('Two-step sign-in is off');
                await done();
              } else {
                setCodes((await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { password, code })).recoveryCodes);
              }
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="muted small">
            {kind === 'disable' ? 'Signing in will need only your password again.' : 'Your old recovery codes stop working as soon as the new ones are made.'}
          </p>
          <FormError error={error} />
          <Field label="Your password">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}</Field>
          <Field label="Code from your app (or a recovery code)">{(p) => <input {...p} className="input" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`btn ${kind === 'disable' ? 'danger solid' : 'primary'}`} disabled={!password || code.trim().length < 6 || busy}>
              {kind === 'disable' ? 'Turn off' : 'Make new codes'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
