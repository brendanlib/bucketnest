/**
 * The invite token, kept for the tab while someone detours through logging in.
 * It arrives in the link's #fragment, which browsers never send to the server.
 */
const KEY = 'hb_pending_invite';

export function rememberInvite(token: string) {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable: the link still works if opened again */
  }
}

export function pendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetInvite() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
