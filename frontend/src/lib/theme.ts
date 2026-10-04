/** Theme is a UI preference, so localStorage is fine for it (never for financial data). */
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'hb-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable: theme still applies for this visit */
  }
  applyTheme(pref);
}

export function watchSystemTheme() {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
}

const SIDEBAR_KEY = 'hb-sidebar-collapsed';
export const getSidebarCollapsed = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
};
export const setSidebarCollapsed = (v: boolean) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
};
