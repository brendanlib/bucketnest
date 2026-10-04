import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAccounts, useBuckets } from '../api/hooks';
import type { Account } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { Money } from '../components/Money';
import { Icon } from '../components/Icon';
import { strings } from '../locales/en-AU';
import { AccountForm } from './AccountForm';

export function AccountsPage() {
  const [showClosed, setShowClosed] = useState(false);
  const accounts = useAccounts(showClosed);
  const buckets = useBuckets();
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const welcome = params.get('welcome') === '1';

  if (accounts.isPending) return <Loading />;
  if (accounts.isError) return <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />;

  const list = accounts.data;
  const bucketName = (id: string | null) => buckets.data?.find((b) => b.id === id);
  const groups: { title: string; items: Account[] }[] = [
    { title: 'Accounts', items: list.filter((a) => a.class === 'ASSET') },
    { title: 'Cards and loans', items: list.filter((a) => a.class === 'LIABILITY') },
  ];

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Balances are worked out from each account’s opening balance and transactions."
        actions={
          <>
            <label className="checkbox small">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
              Show closed
            </label>
            <button type="button" className="btn primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> Add account
            </button>
          </>
        }
      />
      {welcome && list.length === 0 ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2>Welcome! Start by adding your accounts</h2>
          <p className="muted" style={{ marginTop: '0.4rem' }}>
            Add your everyday bank account, any bucket accounts (Bills, Smile, Splurge, Fire Extinguisher), and your cards and loans. Your buckets and categories are already set up.
          </p>
        </div>
      ) : null}
      {list.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No accounts yet"
            action={
              <button type="button" className="btn primary" onClick={() => setAdding(true)}>
                Add your first account
              </button>
            }
          >
            Accounts hold your balances. Every transaction belongs to one.
          </EmptyState>
        </div>
      ) : (
        <div className="stack">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.title} className="card" aria-labelledby={`h-${g.title}`}>
                <div className="card-header">
                  <h2 id={`h-${g.title}`}>{g.title}</h2>
                </div>
                <div>
                  {g.items.map((a) => {
                    const tag = bucketName(a.bucketTagId);
                    return (
                      <Link key={a.id} to={`/accounts/${a.id}`} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
                        <span className="dot" style={{ background: tag?.colour ?? 'var(--border)' }} aria-hidden="true" />
                        <div className="grow">
                          <div className="truncate" style={{ fontWeight: 600 }}>
                            {a.name} {a.isClosed ? <span className="badge">Closed</span> : null}
                          </div>
                          <div className="muted small truncate">
                            {strings.accountTypes[a.type]}
                            {a.institution ? ` · ${a.institution}` : ''}
                            {a.last4 ? ` · ••${a.last4}` : ''}
                            {tag ? ` · ${tag.name}` : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <Money cents={a.balanceCents} className={a.class === 'ASSET' && a.balanceCents < 0 ? 'neg' : ''} />
                          {a.class === 'LIABILITY' ? <div className="muted small">owed</div> : null}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
        </div>
      )}
      {adding ? <AccountForm onClose={() => setAdding(false)} /> : null}
    </>
  );
}
