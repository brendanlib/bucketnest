import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../api/types';
import { startClockAt } from './clock';
import { createFakeApi, fixtureKey, READ_ONLY_MESSAGE, type Fixtures } from './fake-api';

const txn = (over: Partial<Transaction>): Transaction =>
  ({
    id: 'id',
    date: '2026-10-01',
    description: 'Something',
    payee: null,
    amountCents: 1000,
    type: 'EXPENSE',
    direction: null,
    accountId: 'everyday',
    accountName: 'Everyday',
    toAccountId: null,
    toAccountName: null,
    splits: [],
    buckets: [],
    uncategorised: false,
    notes: null,
    cleared: true,
    recurringId: null,
    occurrenceDate: null,
    importBatchId: null,
    goalId: null,
    gstCents: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }) as Transaction;

const split = (categoryId: string, bucketId: string) => ({ id: `s-${categoryId}`, categoryId, categoryName: categoryId, bucketId, amountCents: 1000, isExtraRepayment: false, isSinkingFundPayment: false, sinkingFundId: null });

function fixtures(): Fixtures {
  return {
    version: 1,
    recordedAt: '2026-10-09T09:00:00.000Z',
    responses: {
      '/auth/me': { user: { id: 'u', email: 'visitor@demo.bucketnest.invalid', name: 'Demo visitor', dismissedTips: [], isDemo: true }, households: [], household: {} },
      '/onboarding': { dismissed: false, showWelcome: true, steps: [], completed: 0, total: 0 },
      [fixtureKey('/dashboard', 'period=2026-09-01')]: { which: 'september' },
      [fixtureKey('/debts/plan', 'strategy=AVALANCHE&extraMonthlyCents=5000')]: { extra: 5000 },
      [fixtureKey('/debts/plan', 'strategy=AVALANCHE&extraMonthlyCents=10000')]: { extra: 10000 },
      [fixtureKey('/debts/plan', 'strategy=SNOWBALL&extraMonthlyCents=100000')]: { extra: 'snowball' },
      [fixtureKey('/notifications', 'limit=30')]: { items: [{ id: 'n1', read: false }, { id: 'n2', read: false }], unreadCount: 2 },
    },
    transactions: [
      txn({ id: 'a', date: '2026-10-05', description: 'WOOLWORTHS 1234', amountCents: 8450, splits: [split('groceries', 'bills')], createdAt: '2026-10-05T01:00:00Z' }),
      txn({ id: 'b', date: '2026-10-03', description: 'Pay', type: 'INCOME', amountCents: 250000, payee: 'Employer' }),
      txn({ id: 'c', date: '2026-09-28', description: 'Cinema', amountCents: 3200, splits: [split('movies', 'fun')], notes: 'with woolies voucher' }),
      txn({ id: 'd', date: '2026-09-20', description: 'Transfer', type: 'TRANSFER', accountId: 'everyday', toAccountId: 'savings', amountCents: 50000 }),
      txn({ id: 'e', date: '2026-09-15', description: 'Mystery', amountCents: 999 }),
    ],
  };
}

const get = (api: ReturnType<typeof createFakeApi>, path: string) => api.handle('GET', new URL(`https://bucketnest.org/api${path}`));

describe('the static demo API', () => {
  it('answers recorded reads whatever order the query is in', () => {
    const api = createFakeApi(fixtures());
    expect(get(api, '/dashboard?period=2026-09-01')).toEqual({ status: 200, body: { which: 'september' } });
    expect(get(api, '/debts/plan?extraMonthlyCents=5000&strategy=AVALANCHE').body).toEqual({ extra: 5000 });
    expect(get(api, '/auth/csrf').body).toEqual({ csrfToken: 'static-demo' });
  });

  it('uses the nearest recorded number, but never guesses a period', () => {
    const onMiss = vi.fn();
    const api = createFakeApi(fixtures(), { onMiss });
    expect(get(api, '/debts/plan?strategy=AVALANCHE&extraMonthlyCents=8000').body).toEqual({ extra: 10000 });
    expect(get(api, '/debts/plan?strategy=AVALANCHE&extraMonthlyCents=100').body).toEqual({ extra: 5000 });
    const miss = get(api, '/dashboard?period=2026-08-01');
    expect(miss.status).toBe(404);
    expect((miss.body as { error: { code: string } }).error.code).toBe('DEMO_NOT_RECORDED');
    expect(onMiss).toHaveBeenCalledWith('/dashboard?period=2026-08-01');
  });

  it('refuses to save anything, with a friendly message', () => {
    const api = createFakeApi(fixtures());
    for (const [method, path] of [['POST', '/transactions'], ['PUT', '/settings'], ['DELETE', '/accounts/x'], ['POST', '/auth/change-password']] as const) {
      const res = api.handle(method, new URL(`https://bucketnest.org/api${path}`));
      expect(res).toEqual({ status: 403, body: { error: { code: 'DEMO_READ_ONLY', message: READ_ONLY_MESSAGE } } });
    }
  });

  it('keeps tips, notifications and sign-out working in memory', () => {
    const onLogout = vi.fn();
    const f = fixtures();
    const api = createFakeApi(f, { onLogout });
    const post = (path: string) => api.handle('POST', new URL(`https://bucketnest.org/api${path}`));

    expect(post('/me/tips/checklist/dismiss').body).toEqual({ dismissedTips: ['checklist'] });
    expect((get(api, '/auth/me').body as { user: { dismissedTips: string[] } }).user.dismissedTips).toEqual(['checklist']);
    expect((get(api, '/onboarding').body as { dismissed: boolean }).dismissed).toBe(true);
    expect(post('/me/tips/reset').body).toEqual({ dismissedTips: [] });

    expect(post('/notifications/n1/read').status).toBe(204);
    expect((get(api, '/notifications?limit=30').body as { unreadCount: number }).unreadCount).toBe(1);
    expect(post('/notifications/read-all').body).toEqual({ updated: 1 });

    expect(post('/demo/start').body).toMatchObject({ user: { isDemo: true } });
    expect(post('/auth/logout').status).toBe(204);
    expect(onLogout).toHaveBeenCalled();
    // The recorded fixtures themselves are never changed.
    expect((f.responses['/auth/me'] as { user: { dismissedTips: string[] } }).user.dismissedTips).toEqual([]);
  });
});

describe('the static demo transaction list', () => {
  const ids = (path: string) => (get(createFakeApi(fixtures()), path).body as { items: { id: string }[] }).items.map((t) => t.id);

  it('filters like the server', () => {
    expect(ids('/transactions?search=wool')).toEqual(['a', 'c']); // description or notes, any case
    expect(ids('/transactions?search=employer')).toEqual(['b']);
    expect(ids('/transactions?from=2026-09-20&to=2026-10-03')).toEqual(['b', 'c', 'd']);
    expect(ids('/transactions?accountId=savings')).toEqual(['d']); // either side of a transfer
    expect(ids('/transactions?bucketId=fun')).toEqual(['c']);
    expect(ids('/transactions?categoryId=groceries')).toEqual(['a']);
    expect(ids('/transactions?type=INCOME,TRANSFER')).toEqual(['b', 'd']);
    expect(ids('/transactions?minCents=3200&maxCents=50000')).toEqual(['a', 'c', 'd']);
    expect(ids('/transactions?uncategorised=true')).toEqual(['b', 'e']); // income needs one too; transfers don't
  });

  it('sorts and pages', () => {
    expect(ids('/transactions?sort=amount&order=asc')).toEqual(['e', 'c', 'a', 'd', 'b']);
    expect(ids('/transactions?sort=payee&order=asc')[0]).toBe('b'); // blank payees last
    expect(ids('/transactions?sort=payee&order=desc')[0]).toBe('b');
    const page = get(createFakeApi(fixtures()), '/transactions?page=2&pageSize=2').body;
    expect(page).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect((page as { items: { id: string }[] }).items.map((t) => t.id)).toEqual(['c', 'd']);
    expect(get(createFakeApi(fixtures()), '/transactions/c').body).toMatchObject({ description: 'Cinema' });
  });
});

describe('the demo clock', () => {
  it('starts at the snapshot and keeps moving', () => {
    const DemoDate = startClockAt(Date.parse('2026-10-09T09:00:00.000Z'));
    const start = new DemoDate().getTime();
    expect(Math.abs(start - Date.parse('2026-10-09T09:00:00.000Z'))).toBeLessThan(1000);
    expect(Math.abs(DemoDate.now() - start)).toBeLessThan(1000);
    expect(new DemoDate('2020-01-02T00:00:00Z').toISOString()).toBe('2020-01-02T00:00:00.000Z');
    expect(new DemoDate(0).getTime()).toBe(0);
    expect(DemoDate.UTC(2026, 0, 1)).toBe(Date.UTC(2026, 0, 1));
  });
});
