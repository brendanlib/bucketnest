import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { MONEY_QUERIES, useAccounts, useApiMutation, useBankConnections, useImportInbox } from '../api/hooks';
import type { BankConnection } from '../api/types';
import { ConfirmDialog } from '../components/Modal';
import { DateInput } from '../components/DateInput';
import { Money } from '../components/Money';
import { ErrorState, FormError, Loading, errorMessage } from '../components/States';
import { useToast } from '../components/Toast';
import { addDaysIso, formatDateTime, todayIn } from '../lib/format';
import { useHousehold } from '../lib/household';

const FEED_QUERIES = [['bank-connections'], ['import-inbox'], ...MONEY_QUERIES];

function Card({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
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

/** Settings → Bank feeds: Up Bank's API, and folder import for every other bank. */
export function BankFeedsSettings() {
  return (
    <>
      <UpCard />
      <FolderCard />
    </>
  );
}

function UpCard() {
  const connections = useBankConnections();
  const [token, setToken] = useState('');
  const [error, setError] = useState<unknown>(null);
  const connect = useApiMutation((t: string) => api.post<BankConnection>('/bank-connections/up', { token: t }), FEED_QUERIES);

  if (connections.isPending) return <Loading />;
  if (connections.isError) return <ErrorState error={connections.error} onRetry={() => connections.refetch()} />;
  const up = connections.data.find((c) => c.provider === 'UP');

  return (
    <Card
      title="Up Bank"
      description="Up has its own API for customers, so the app talks to Up directly: no aggregator, and nothing leaves your server except the request to Up. Settled transactions sync every 30 minutes."
    >
      {up ? (
        <UpConnection connection={up} />
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await connect.mutateAsync(token);
              setToken('');
            } catch (err) {
              setError(err);
            }
          }}
        >
          <ol className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
            <li>
              Get a personal access token from <strong>api.up.com.au</strong> (or in the Up app: Data sharing → Personal Access Token).
            </li>
            <li>Paste it below. It’s checked with Up, stored encrypted on this server, and never shown again.</li>
            <li>Choose which app account each Up account feeds.</li>
          </ol>
          <FormError error={error} />
          <div className="field">
            <label htmlFor="up-token">Personal access token</label>
            <input id="up-token" className="input" type="password" autoComplete="off" spellCheck={false} placeholder="up:yeah:…" value={token} onChange={(e) => setToken(e.target.value)} />
            <span className="hint">The token can only read your Up data; it can’t move money. Revoke it any time from the same page.</span>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={!token.trim() || connect.isPending}>
              {connect.isPending ? 'Checking with Up…' : 'Connect Up'}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

function UpConnection({ connection: c }: { connection: BankConnection }) {
  const { locale, timezone } = useHousehold();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const sync = useApiMutation(() => api.post<{ summary: { imported: number; merged: number; matched: number } }>(`/bank-connections/${c.id}/sync`), FEED_QUERIES);
  const disconnect = useApiMutation(() => api.delete(`/bank-connections/${c.id}`), FEED_QUERIES);
  const linked = c.accounts.filter((a) => a.accountId);

  return (
    <div className="stack">
      <div className="row wrap">
        <span className={`badge${c.status === 'ACTIVE' ? ' ok' : ' warn'}`}>{c.status === 'ACTIVE' ? 'Connected' : 'Needs attention'}</span>
        <span className="muted small">{c.lastSyncAt ? `Last synced ${formatDateTime(c.lastSyncAt, locale, timezone)}` : 'Not synced yet'}</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn small primary"
          disabled={!linked.length || sync.isPending}
          onClick={async () => {
            try {
              const r = await sync.mutateAsync();
              const s = r.summary;
              toast(s.imported || s.merged ? `Synced: ${s.imported} new${s.matched ? ` (${s.matched} matched to bills)` : ''}${s.merged ? `, ${s.merged} linked` : ''}` : 'Synced: nothing new');
            } catch (err) {
              toast(errorMessage(err), 'error');
            }
          }}
        >
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </button>
        <button type="button" className="btn small danger" onClick={() => setConfirming(true)}>
          Disconnect
        </button>
      </div>
      {c.lastError ? (
        <p className="error small" role="alert">
          {c.lastError} {c.status === 'ERROR' ? 'Disconnect, then connect again with a new token.' : ''}
        </p>
      ) : null}
      <div className="stack-sm">
        {c.accounts.map((a) => (
          <FeedAccountRow key={a.id} feed={a} />
        ))}
      </div>
      <p className="muted small">
        Only settled transactions are imported; pending ones follow once they settle. Link all your Up accounts so moves between them are recorded as transfers. Each sync appears in{' '}
        <Link to="/import">import history</Link> and can be undone.
      </p>
      {confirming ? (
        <ConfirmDialog
          title="Disconnect Up?"
          confirmLabel="Disconnect"
          busy={disconnect.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await disconnect.mutateAsync(undefined);
            setConfirming(false);
            toast('Up disconnected. Imported transactions are kept.');
          }}
          message="The token is deleted from this server and syncing stops. Transactions already imported stay. To be thorough, also revoke the token at api.up.com.au."
        />
      ) : null}
    </div>
  );
}

function FeedAccountRow({ feed }: { feed: BankConnection['accounts'][number] }) {
  const accounts = useAccounts();
  const toast = useToast();
  const { timezone } = useHousehold();
  const [target, setTarget] = useState<string>(feed.accountId ?? '');
  const [syncFrom, setSyncFrom] = useState<string>(feed.syncFrom ?? addDaysIso(todayIn(timezone), -30));
  const save = useApiMutation((body: unknown) => api.put(`/bank-connections/accounts/${feed.id}`, body), FEED_QUERIES);
  const dirty = target !== (feed.accountId ?? '') || (target !== '' && syncFrom !== feed.syncFrom);
  const diff = feed.appBalanceCents !== null ? feed.appBalanceCents - feed.bankBalanceCents : null;

  return (
    <div className="list-item" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.75rem' }}>
      <div className="grow" style={{ minWidth: 160 }}>
        <strong>{feed.name}</strong>
        <div className="muted small">
          {feed.kind === 'SAVER' ? 'Saver' : feed.kind === 'HOME_LOAN' ? 'Home loan' : 'Spending'} · Up balance <Money cents={feed.bankBalanceCents} />
          {feed.accountId && diff !== null ? (
            diff === 0 ? (
              <> · matches the app</>
            ) : (
              <>
                {' '}
                · app <Money cents={feed.appBalanceCents!} /> ({diff > 0 ? 'ahead' : 'behind'} by <Money cents={Math.abs(diff)} />, usually pending transactions)
              </>
            )
          ) : null}
        </div>
      </div>
      <div className="field" style={{ minWidth: 200 }}>
        <label htmlFor={`feed-${feed.id}`}>Goes into</label>
        <select id={`feed-${feed.id}`} className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Don’t import</option>
          <option value="new">A new account</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {target ? (
        <div className="field" style={{ width: 170 }}>
          <label htmlFor={`from-${feed.id}`}>Import from</label>
          <DateInput id={`from-${feed.id}`} value={syncFrom} onChange={setSyncFrom} />
        </div>
      ) : null}
      <button
        type="button"
        className="btn"
        disabled={!dirty || save.isPending || (target !== '' && !syncFrom)}
        onClick={async () => {
          try {
            await save.mutateAsync(target === '' ? { accountId: null } : target === 'new' ? { createAccount: true, syncFrom } : { accountId: target, syncFrom });
            toast(target === '' ? `${feed.name} won’t be imported` : `${feed.name} linked. Use Sync now, or it syncs within 30 minutes.`);
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        }}
      >
        Save
      </button>
      {target && target !== 'new' && target !== feed.accountId ? (
        <p className="muted small" style={{ flexBasis: '100%' }}>
          Transactions from the import date on are added to this account. Its opening balance should be its balance just before that date; the account page has a one-step reconcile if it isn’t.
        </p>
      ) : null}
    </div>
  );
}

function FolderCard() {
  const inbox = useImportInbox();
  const toast = useToast();
  const toggle = useApiMutation((v: { id: string; on: boolean }) => (v.on ? api.post(`/import-inbox/${v.id}`) : api.delete(`/import-inbox/${v.id}`)), FEED_QUERIES);

  return (
    <Card
      title="Folder import (any bank)"
      description="For banks without their own API: give an account a folder on the server, then drop its CSV exports there (by hand, Syncthing, a NAS share, scp…). They import every few minutes with the account’s saved column layout, through the same duplicate checks, bill matching and rules."
    >
      {inbox.isPending ? (
        <Loading />
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} />
      ) : !inbox.data.enabled ? (
        <p className="small">
          Folder import is off on this server. To turn it on, set <code>IMPORT_INBOX_DIR</code> and mount a folder (see the deployment guide, “Folder import”).
        </p>
      ) : (
        <div className="stack-sm">
          {inbox.data.accounts.map((a) => (
            <div key={a.accountId} className="list-item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 200 }}>
                <strong>{a.accountName}</strong>
                {a.folder ? (
                  <div className="small">
                    Drop files in <code>inbox/{a.folder}/</code>
                    {!a.hasLayout ? (
                      <div className="error small">
                        Import one file from this bank by hand first (<Link to="/import">Import</Link>) so the app learns its columns.
                      </div>
                    ) : null}
                    {a.imported.length ? <div className="muted">Imported: {a.imported.slice(0, 3).join(', ')}</div> : null}
                    {a.failed.length ? <div className="error">Not imported (see the .error.txt beside each in failed/): {a.failed.slice(0, 3).join(', ')}</div> : null}
                  </div>
                ) : (
                  <div className="muted small">Not watching a folder</div>
                )}
              </div>
              <button
                type="button"
                className="btn small"
                onClick={async () => {
                  try {
                    await toggle.mutateAsync({ id: a.accountId, on: !a.folder });
                  } catch (err) {
                    toast(errorMessage(err), 'error');
                  }
                }}
              >
                {a.folder ? 'Stop watching' : 'Watch a folder'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
