import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { NotificationBell } from './NotificationBell';

const items = [
  { id: 'n1', type: 'UPCOMING_BILL', title: 'Rent is due Mon 6 Oct', body: '$2,000.00 from Everyday.', link: '/bills', read: false, createdAt: '2026-10-05T01:00:00Z' },
  { id: 'n2', type: 'BUDGET_REVIEW', title: 'New budget period', body: 'Last period you spent $3,100.00.', link: '/budget', read: true, createdAt: '2026-10-01T01:00:00Z' },
];

function mockFetch() {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (url.startsWith('/api/auth/csrf')) return new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 });
      if (url.startsWith('/api/notifications?')) {
        const read = calls.some((c) => c.method === 'POST');
        return new Response(JSON.stringify({ items: items.map((i) => (read ? { ...i, read: true } : i)), unreadCount: read ? 0 : 1 }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    }),
  );
  return calls;
}

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
          <Route path="/bills" element={<p>Bills page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('NotificationBell', () => {
  it('shows the unread count in its accessible name', async () => {
    mockFetch();
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
  });

  it('opens the panel, marks an item read and follows its link', async () => {
    const calls = mockFetch();
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }));
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Rent is due/ }));
    await waitFor(() => expect(screen.getByText('Bills page')).toBeInTheDocument());
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/notifications/n1/read')).toBe(true);
  });

  it('closes on Escape', async () => {
    mockFetch();
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  });
});
