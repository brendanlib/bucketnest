import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Horizontal scroller for wide tables. When the table is wider than the
 * screen it becomes a labelled, focusable region, so keyboard users can
 * scroll it with the arrow keys (WCAG 2.1.1).
 */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="table-wrap" {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-label': `${label} (scrolls sideways)` } : {})}>
      {children}
    </div>
  );
}
