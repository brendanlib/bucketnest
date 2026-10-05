import { Link, useNavigate } from 'react-router';
import { useDismissTip, useOnboarding } from '../api/hooks';
import type { OnboardingStep } from '../api/types';
import { Modal } from '../components/Modal';
import { useHousehold } from '../lib/household';

const STEPS: Record<OnboardingStep, { title: string; why: string; to: string; action: string }> = {
  accounts: {
    title: 'Add your accounts',
    why: 'Your everyday account, any bucket accounts, and your cards and loans. Balances are worked out from here.',
    to: '/accounts?add=1',
    action: 'Add an account',
  },
  income: {
    title: 'Add your pay',
    why: 'Your take-home pay as a recurring income. It sets how much each bucket gets.',
    to: '/recurring?add=INCOME',
    action: 'Add your pay',
  },
  bills: {
    title: 'Add your regular bills',
    why: 'Rent or mortgage, utilities, insurance, subscriptions. They’ll show up before they’re due.',
    to: '/recurring?add=EXPENSE',
    action: 'Add a bill',
  },
  budget: {
    title: 'Plan your budget',
    why: 'Set a planned amount for the categories you spend on, in whatever frequency suits — $200 a week, $900 a year.',
    to: '/budget?all=1',
    action: 'Open the budget',
  },
  transactions: {
    title: 'Record what you spend',
    why: 'Import a CSV from your bank, or add transactions by hand. Rules can categorise imports for you.',
    to: '/import',
    action: 'Import a bank file',
  },
  savings: {
    title: 'Start saving for something',
    why: 'A sinking fund for a big irregular bill like rego, or a Fire Extinguisher goal like an emergency fund.',
    to: '/sinking-funds',
    action: 'Start a sinking fund',
  },
};

/** The getting-started checklist on the dashboard. Steps tick themselves off as the household fills in. */
export function GettingStarted() {
  const onboarding = useOnboarding();
  const dismiss = useDismissTip();
  if (!onboarding.data || onboarding.data.dismissed) return null;
  const { steps, completed, total } = onboarding.data;
  const next = steps.find((s) => !s.done);
  const all = completed === total;

  return (
    <section className="card stack getting-started" aria-labelledby="gs-h">
      <div className="row wrap">
        <h2 id="gs-h">{all ? 'You’re all set up' : 'Getting started'}</h2>
        <span className="badge num">
          {completed} of {total}
        </span>
        <span className="spacer" />
        <button type="button" className="btn small ghost" onClick={() => dismiss.mutate('getting-started')}>
          {all ? 'Done' : 'Hide'}
        </button>
      </div>
      <div className="progress status-ok" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
        <span style={{ width: `${(completed / total) * 100}%` }} />
      </div>
      {all ? (
        <p className="small">Your budget is running. The dashboard now shows where every bucket stands this period.</p>
      ) : (
        <ol className="gs-steps">
          {steps.map((s, i) => {
            const info = STEPS[s.key];
            const isNext = s.key === next?.key;
            return (
              <li key={s.key} className={s.done ? 'done' : isNext ? 'next' : undefined}>
                <span className="gs-mark" aria-hidden="true">
                  {s.done ? '✓' : i + 1}
                </span>
                <div className="grow">
                  <div>
                    <strong>{info.title}</strong>
                    {s.done ? <span className="sr-only"> (done)</span> : null}
                  </div>
                  {!s.done ? <div className="muted small">{info.why}</div> : null}
                </div>
                {!s.done ? (
                  <Link to={info.to} className={`btn small${isNext ? ' primary' : ''}`}>
                    {info.action}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** First-login welcome: the bucket idea in one screen, then straight to the first step. */
export function WelcomeDialog() {
  const onboarding = useOnboarding();
  const dismiss = useDismissTip();
  const navigate = useNavigate();
  const { me } = useHousehold();
  if (!onboarding.data?.showWelcome || me?.user.dismissedTips.includes('welcome')) return null;
  const close = (to?: string) => {
    dismiss.mutate('welcome');
    if (to) navigate(to);
  };
  return (
    <Modal
      title={`Welcome, ${me?.user.name.split(' ')[0] ?? ''}`}
      onClose={() => close()}
      footer={
        <>
          <button type="button" className="btn" onClick={() => close()}>
            Look around first
          </button>
          <button type="button" className="btn primary" onClick={() => close('/accounts?add=1')}>
            Add my first account
          </button>
        </>
      }
    >
      <div className="stack">
        <p>Home Budget follows the Barefoot Investor bucket method. Your take-home pay is shared across four buckets:</p>
        <ul className="bucket-legend">
          <li>
            <span className="dot" style={{ background: '#2563EB' }} aria-hidden="true" /> <strong>Bills</strong> — essentials and fixed costs (60%)
          </li>
          <li>
            <span className="dot" style={{ background: '#DB2777' }} aria-hidden="true" /> <strong>Smile</strong> — saving for things you’ll enjoy (10%)
          </li>
          <li>
            <span className="dot" style={{ background: '#0D9488' }} aria-hidden="true" /> <strong>Splurge</strong> — guilt-free spending (10%)
          </li>
          <li>
            <span className="dot" style={{ background: '#EA580C' }} aria-hidden="true" /> <strong>Fire Extinguisher</strong> — emergency fund, debt and investing (20%)
          </li>
        </ul>
        <p className="muted small">You pick a category for each expense and the bucket follows. You can change the percentages any time in Settings.</p>
        <p>
          It takes about ten minutes to set up. There’s a checklist on the dashboard, and each step ticks itself off as you go.
        </p>
      </div>
    </Modal>
  );
}
