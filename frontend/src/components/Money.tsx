import { formatMoney } from '../lib/format';
import { useHousehold } from '../lib/household';

/** Displays integer cents in the household currency. */
export function Money({ cents, signed, colour, className }: { cents: number; signed?: boolean; colour?: boolean; className?: string }) {
  const ctx = useHousehold();
  const cls = ['num', colour && cents < 0 ? 'neg' : '', colour && cents > 0 ? 'pos' : '', className ?? ''].filter(Boolean).join(' ');
  return <span className={cls}>{formatMoney(cents, ctx, { signDisplay: signed ? 'exceptZero' : 'auto' })}</span>;
}
