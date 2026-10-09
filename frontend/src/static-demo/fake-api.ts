import type { AppNotification, Me, Onboarding, Transaction } from '../api/types';
import { listTransactions } from './transactions';

/**
 * The static demo's stand-in for the server. It answers from a snapshot of a
 * real demo household (recorded by e2e/scripts/record-static-demo.ts), so the
 * numbers are exactly what the app computes. Reads work; saving is switched
 * off, apart from a few harmless things (help tips, notifications) kept in memory.
 */
export interface Fixtures {
  version: 1;
  /** The moment the snapshot represents; the demo's clock starts here. */
  recordedAt: string;
  /** GET responses keyed by fixtureKey(). */
  responses: Record<string, unknown>;
  /** Every transaction, so the transaction list can filter, sort and page itself. */
  transactions: Transaction[];
}

export interface FakeResponse {
  status: number;
  body?: unknown;
}

/** "/dashboard?period=2026-09-01&basis=ACTUAL" with the query in a stable order. */
export function fixtureKey(path: string, search: URLSearchParams | string = ''): string {
  const params = [...new URLSearchParams(search).entries()].sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  const qs = new URLSearchParams(params).toString();
  return qs ? `${path}?${qs}` : path;
}

export const READ_ONLY_MESSAGE = 'This demo is read-only, so changes aren’t saved. Install BucketNest or join the hosted waitlist to try it for real.';

const error = (status: number, code: string, message: string): FakeResponse => ({ status, body: { error: { code, message } } });
const isNumeric = (v: string) => v !== '' && Number.isFinite(Number(v));

export function createFakeApi(fixtures: Fixtures, hooks: { onLogout?: () => void; onMiss?: (key: string) => void } = {}) {
  const responses = structuredClone(fixtures.responses);
  const recorded = Object.keys(responses).map((key) => {
    const [path, qs = ''] = key.split('?', 2) as [string, string?];
    return { key, path, params: new URLSearchParams(qs) };
  });

  /**
   * A query the snapshot doesn't have exactly, such as a debt plan with an extra
   * $73 a month: the recorded one with the same filters and the nearest numbers.
   * Anything that differs in a non-numeric value (a period, a date range) isn't guessed.
   */
  function nearest(path: string, params: URLSearchParams): unknown {
    const keys = [...new Set(params.keys())].sort().join(',');
    let best: { key: string; distance: number } | null = null;
    for (const r of recorded) {
      if (r.path !== path || [...new Set(r.params.keys())].sort().join(',') !== keys) continue;
      let distance = 0;
      let ok = true;
      for (const [k, v] of params) {
        const rv = r.params.get(k)!;
        if (rv === v) continue;
        if (isNumeric(v) && isNumeric(rv)) distance += Math.abs(Number(v) - Number(rv));
        else ok = false;
      }
      if (ok && (!best || distance < best.distance)) best = { key: r.key, distance };
    }
    return best ? responses[best.key] : undefined;
  }

  const me = () => responses['/auth/me'] as Me | undefined;
  const notifications = () => responses[fixtureKey('/notifications', 'limit=30')] as { items: AppNotification[]; unreadCount: number } | undefined;

  function setTips(dismissedTips: string[]) {
    const m = me();
    if (m) m.user.dismissedTips = dismissedTips;
    const onboarding = responses['/onboarding'] as Onboarding | undefined;
    if (onboarding) onboarding.dismissed = dismissedTips.includes('checklist');
    return { status: 200, body: { dismissedTips } };
  }

  function get(path: string, params: URLSearchParams): FakeResponse {
    if (path === '/auth/csrf') return { status: 200, body: { csrfToken: 'static-demo' } };
    if (path === '/transactions') return { status: 200, body: listTransactions(fixtures.transactions, params) };
    const txn = /^\/transactions\/([^/]+)$/.exec(path);
    if (txn) {
      const found = fixtures.transactions.find((t) => t.id === txn[1]);
      return found ? { status: 200, body: found } : error(404, 'NOT_FOUND', 'Transaction not found');
    }
    const key = fixtureKey(path, params);
    if (key in responses) return { status: 200, body: responses[key] };
    const close = nearest(path, params);
    if (close !== undefined) return { status: 200, body: close };
    hooks.onMiss?.(key);
    return error(404, 'DEMO_NOT_RECORDED', 'This view isn’t part of the demo. It covers a few months either side of today.');
  }

  function post(path: string): FakeResponse | null {
    if (path === '/demo/start') {
      const m = me();
      return m ? { status: 200, body: m } : null;
    }
    if (path === '/auth/logout') {
      hooks.onLogout?.();
      return { status: 204 };
    }
    const tip = /^\/me\/tips\/([\w-]+)\/dismiss$/.exec(path);
    if (tip) return setTips([...new Set([...(me()?.user.dismissedTips ?? []), tip[1]!])]);
    if (path === '/me/tips/reset') return setTips([]);
    const read = /^\/notifications\/([^/]+)\/read$/.exec(path);
    if (read || path === '/notifications/read-all') {
      const n = notifications();
      let updated = 0;
      for (const item of n?.items ?? []) {
        if (!item.read && (!read || item.id === read[1])) {
          item.read = true;
          updated++;
        }
      }
      if (n) n.unreadCount = n.items.filter((i) => !i.read).length;
      return read ? { status: 204 } : { status: 200, body: { updated } };
    }
    return null;
  }

  return {
    /** `url` is the full request URL; only /api/... is answered here. */
    handle(method: string, url: URL): FakeResponse {
      const path = url.pathname.replace(/^\/api(?=\/)/, '');
      if (method === 'GET' || method === 'HEAD') return get(path, url.searchParams);
      if (method === 'POST') {
        const handled = post(path);
        if (handled) return handled;
      }
      return error(403, 'DEMO_READ_ONLY', READ_ONLY_MESSAGE);
    },
  };
}

export type FakeApi = ReturnType<typeof createFakeApi>;
