/**
 * Minimal client for Up Bank's personal API (https://developer.up.com.au).
 * Read-only: accounts and transactions. Personal access tokens look like up:yeah:…
 */
export const UP_API = 'https://api.up.com.au/api/v1';

export type Fetch = typeof fetch;

export interface UpAccount {
  id: string;
  name: string;
  /** SAVER, TRANSACTIONAL or HOME_LOAN. */
  kind: string;
  balanceCents: number;
}

export interface UpTransaction {
  id: string;
  status: 'HELD' | 'SETTLED';
  description: string;
  rawText: string | null;
  message: string | null;
  /** Negative for money out. */
  amountCents: number;
  createdAt: string;
  settledAt: string | null;
  /** The other Up account, for transfers between the customer's own accounts. */
  transferAccountId: string | null;
}

export class UpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface UpPage<T> {
  data: T[];
  links?: { next: string | null };
}

export function upClient(token: string, fetchImpl: Fetch = fetch) {
  async function get<T>(url: string): Promise<T> {
    const full = url.startsWith('http') ? url : `${UP_API}${url}`;
    // The token goes in every request, so it is only ever sent to Up's API (pagination links included).
    if (!full.startsWith(`${UP_API}/`)) throw new UpError('Up sent a link to another server; the sync stopped to keep the token safe.', 502);
    const res = await fetchImpl(full, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) throw new UpError('Up didn’t accept the access token. It may have been revoked: create a new one in the Up app and paste it here.', 401);
    if (res.status === 429) throw new UpError('Up is rate-limiting requests. The next sync will try again.', 429);
    if (!res.ok) throw new UpError(`Up returned an error (${res.status}). The next sync will try again.`, res.status);
    return (await res.json()) as T;
  }

  /** Follows links.next to the end. */
  async function all<T>(first: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = first;
    for (let pages = 0; url && pages < 500; pages++) {
      const page: UpPage<T> = await get<UpPage<T>>(url);
      out.push(...page.data);
      url = page.links?.next ?? null;
    }
    return out;
  }

  return {
    async ping() {
      await get('/util/ping');
    },

    async accounts(): Promise<UpAccount[]> {
      type Raw = { id: string; attributes: { displayName: string; accountType: string; balance: { valueInBaseUnits: number } } };
      return (await all<Raw>('/accounts?page[size]=100')).map((a) => ({
        id: a.id,
        name: a.attributes.displayName,
        kind: a.attributes.accountType,
        balanceCents: a.attributes.balance.valueInBaseUnits,
      }));
    },

    /** Transactions created since `since` (RFC 3339): settled only, or pending ones too. */
    async transactions(accountId: string, since: string, opts: { settledOnly: boolean }): Promise<UpTransaction[]> {
      type Raw = {
        id: string;
        attributes: { status: 'HELD' | 'SETTLED'; description: string; rawText: string | null; message: string | null; amount: { valueInBaseUnits: number }; createdAt: string; settledAt: string | null };
        relationships?: { transferAccount?: { data: { id: string } | null } };
      };
      const q = new URLSearchParams({ 'page[size]': '100', ...(opts.settledOnly ? { 'filter[status]': 'SETTLED' } : {}), 'filter[since]': since });
      return (await all<Raw>(`/accounts/${encodeURIComponent(accountId)}/transactions?${q}`)).map((t) => ({
        id: t.id,
        status: t.attributes.status,
        description: t.attributes.description,
        rawText: t.attributes.rawText,
        message: t.attributes.message,
        amountCents: t.attributes.amount.valueInBaseUnits,
        createdAt: t.attributes.createdAt,
        settledAt: t.attributes.settledAt,
        transferAccountId: t.relationships?.transferAccount?.data?.id ?? null,
      }));
    },
  };
}
