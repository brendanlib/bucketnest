import { useHousehold } from '../lib/household';
import { useRegistration } from '../api/hooks';
import { strings } from '../locales/en-AU';

/** Shown inside a demo sandbox: what it is, how long it lasts, where to get the real thing. */
export function DemoBanner() {
  const { me } = useHousehold();
  const info = useRegistration();
  if (!me?.user.isDemo) return null;
  return (
    <div className="demo-banner" role="note">
      <strong>Demo</strong>
      <span>
        {import.meta.env.VITE_STATIC_DEMO === 'true'
          ? 'A sample household to look around. Every page works, but changes aren’t saved.'
          : 'This sample household is yours to explore for 24 hours, then it’s deleted. Bank feeds, invites and email are switched off.'}
      </span>
      <a className="btn small primary" href={info.data?.websiteUrl ?? 'https://bucketnest.org'}>
        Get {strings.appName}
      </a>
    </div>
  );
}
