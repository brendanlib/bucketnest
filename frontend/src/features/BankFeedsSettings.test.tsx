import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { BankFeedsSettings } from './BankFeedsSettings';

const connected = {
  id: 'c1',
  provider: 'UP',
  label: 'Up Bank',
  status: 'ACTIVE',
  lastSyncAt: null,
  lastError: null,
  accounts: [
    { id: 'f1', name: 'Spending', kind: 'TRANSACTIONAL', bankBalanceCents: 300000, accountId: null, accountName: null, appBalanceCents: null, syncFrom: null, lastSyncAt: null },
    { id: 'f2', name: 'Rainy day', kind: 'SAVER', bankBalanceCents: 50000, accountId: 'a1', accountName: 'Savings', appBalanceCents: 52000, syncFrom: '2026-09-01', lastSyncAt: null },
  ],
};

function mockApi(state: { connections: unknown[] }) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url === '/api/auth/csrf') return json({ csrfToken: 't' });
      if (url === '/api/bank-connections' && method === 'GET') return json({ items: state.connections });
      if (url === '/api/bank-connections/up') {
        if (body.token === 'up:yeah:bad') return json({ error: { code: 'VALIDATION_ERROR', message: 'Up didn’t accept the access token.', details: { field: 'token' } } }, 400);
        state.connections = [connected];
        return json(connected, 201);
      }
      if (url.startsWith('/api/bank-connections/accounts/')) return json(connected);
      if (url.startsWith('/api/accounts')) return json({ items: [{ id: 'a1', name: 'Savings' }, { id: 'a2', name: 'Everyday' }] });
      if (url === '/api/import-inbox') return json({ enabled: true, accounts: [{ accountId: 'a2', accountName: 'Everyday', folder: 'everyday-1a2b3c', hasLayout: false, imported: [], failed: [] }] });
      return json({});
    }),
  );
  return calls;
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <BankFeedsSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('BankFeedsSettings', () => {
  it('connects Up with a token and shows what Up said when it fails', async () => {
    const state = { connections: [] as unknown[] };
    const calls = mockApi(state);
    renderPage();
    const input = await screen.findByLabelText('Personal access token');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.type(input, 'up:yeah:bad');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Up' }));
    expect(await screen.findByText(/didn’t accept the access token/)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'up:yeah:good');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Up' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/api/bank-connections/up').map((c) => c.body)).toEqual([{ token: 'up:yeah:bad' }, { token: 'up:yeah:good' }]);
  });

  it('links an Up account to a new account from a chosen date, and explains a balance gap', async () => {
    const calls = mockApi({ connections: [connected] });
    renderPage();
    const spending = (await screen.findByText('Spending')).closest('.list-item') as HTMLElement;
    await userEvent.selectOptions(within(spending).getByLabelText('Goes into'), 'A new account');
    const from = within(spending).getByLabelText('Import from');
    await userEvent.clear(from);
    await userEvent.type(from, '01/10/2026');
    await userEvent.click(within(spending).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/bank-connections/accounts/f1')?.body).toEqual({ createAccount: true, syncFrom: '2026-10-01' }));
    const saver = screen.getByText('Rainy day').closest('.list-item') as HTMLElement;
    expect(saver).toHaveTextContent(/ahead by \$20\.00, usually pending transactions/);
  });

  it('shows each watched folder and warns until the bank’s layout is known', async () => {
    mockApi({ connections: [] });
    renderPage();
    expect(await screen.findByText('inbox/everyday-1a2b3c/')).toBeInTheDocument();
    expect(screen.getByText(/Import one file from this bank by hand first/)).toBeInTheDocument();
  });
});
