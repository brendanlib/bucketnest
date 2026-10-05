import { useEffect, useState } from 'react';

/**
 * Resolves CSS custom properties to real colours for SVG charts, and updates
 * when the theme changes. (SVG presentation attributes don't reliably resolve var().)
 */
export function useCssColours<K extends string>(vars: readonly K[]): Record<K, string> {
  const read = () => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(vars.map((v) => [v, style.getPropertyValue(`--${v}`).trim() || '#888888'])) as Record<K, string>;
  };
  const [colours, setColours] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setColours(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return colours;
}

/** A colour that may be a var(--token) resolved to its current value. */
export function resolveColour(value: string, map: Record<string, string>): string {
  const m = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  return m ? (map[m[1]!] ?? value) : value;
}
