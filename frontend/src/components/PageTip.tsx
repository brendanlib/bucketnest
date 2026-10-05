import type { ReactNode } from 'react';
import { useDismissTip } from '../api/hooks';
import { useHousehold } from '../lib/household';
import { Icon } from './Icon';

/** A short explanation at the top of a page, until the user says "Got it". Remembered per user. */
export function PageTip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const { me } = useHousehold();
  const dismiss = useDismissTip();
  if (!me || me.user.dismissedTips.includes(id)) return null;
  return (
    <aside className="tip" aria-label={title}>
      <span className="tip-icon" aria-hidden="true">
        <Icon name="info" />
      </span>
      <div className="grow">
        <strong>{title}</strong>
        <div className="small">{children}</div>
      </div>
      <button type="button" className="btn small ghost" onClick={() => dismiss.mutate(id)}>
        Got it
      </button>
    </aside>
  );
}
