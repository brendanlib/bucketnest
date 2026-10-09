/**
 * The app normally lives at the root of its own address. The static demo build
 * is served from a sub-path of the website (vite --base), so routes are relative to it.
 */
export const ROUTER_BASENAME = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

/** The current route without the base path, e.g. "/login". */
export function appPath(pathname = window.location.pathname): string {
  if (!ROUTER_BASENAME) return pathname;
  return pathname.startsWith(ROUTER_BASENAME) ? pathname.slice(ROUTER_BASENAME.length) || '/' : pathname;
}
