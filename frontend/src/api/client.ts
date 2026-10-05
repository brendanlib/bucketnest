/**
 * Thin fetch wrapper. Same-origin `/api`, cookies sent automatically, CSRF
 * token fetched once and attached to every state-changing request.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** The field a validation error points at, e.g. "splits" or "body.name". */
  get field(): string | undefined {
    const d = this.details as { field?: string } | { field: string }[] | undefined;
    if (Array.isArray(d)) return d[0]?.field?.replace(/^body\./, '');
    return d?.field;
  }
}

let csrfToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

async function fetchCsrf(): Promise<string> {
  const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  const body = (await res.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken ?? (await fetchCsrf());
    if (body !== undefined) headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    // Not JSON: an error page from a proxy, e.g. 413 too large or 502 while the server restarts.
    if (res.ok) throw new ApiError(res.status, 'BAD_RESPONSE', 'The server sent an unexpected response');
    data = undefined;
  }
  if (res.ok) return data as T;

  const err = (data as { error?: { code: string; message: string; details?: unknown } } | undefined)?.error;
  if (res.status === 403 && err?.code === 'CSRF_INVALID' && retry) {
    await fetchCsrf();
    return request<T>(method, path, body, false);
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthenticated?.();
  throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? fallbackMessage(res.status), err?.details);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    search.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

function fallbackMessage(status: number): string {
  if (status === 413) return 'That is too large to upload';
  if (status === 502 || status === 503 || status === 504) return 'The server is not responding. It may be restarting — try again in a minute.';
  return `Request failed (${status})`;
}
