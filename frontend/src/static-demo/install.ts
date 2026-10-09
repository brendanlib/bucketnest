import { startClockAt } from './clock';
import { createFakeApi, type Fixtures } from './fake-api';

/**
 * The static demo build (vite --mode static-demo) runs this before the app starts:
 * the snapshot is loaded, the clock set to it, and every /api request answered in
 * the browser. Nothing is sent to a server.
 */
export async function installStaticDemo() {
  const res = await fetch(`${import.meta.env.BASE_URL}fixtures.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`The demo data didn’t load (${res.status})`);
  const fixtures = (await res.json()) as Fixtures;

  globalThis.Date = startClockAt(Date.parse(fixtures.recordedAt));

  // "Sign out" goes back to the website's demo page.
  // Views the snapshot doesn't cover are listed here for e2e/tests/static-demo.spec.ts.
  const misses: string[] = [];
  (window as unknown as { __staticDemoMisses: string[] }).__staticDemoMisses = misses;
  const api = createFakeApi(fixtures, {
    onLogout: () => setTimeout(() => window.location.assign('/demo'), 50),
    onMiss: (key) => misses.push(key),
  });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const answer = api.handle(request.method, url);
    // A moment's pause, so the app behaves as it does over a network.
    await new Promise((r) => setTimeout(r, 30));
    if (answer.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
  };
}
