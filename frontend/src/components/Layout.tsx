import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icon';
import { api } from '../api/client';
import { useHousehold } from '../lib/household';
import { getSidebarCollapsed, setSidebarCollapsed } from '../lib/theme';
import { Modal } from './Modal';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

/** Only pages that exist are listed; later build phases add Overview and Fire Extinguisher groups. */
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  {
    group: 'Money',
    items: [
      { to: '/transactions', label: 'Transactions', icon: 'transactions' },
      { to: '/accounts', label: 'Accounts', icon: 'accounts' },
      { to: '/budget', label: 'Budget', icon: 'budget' },
      { to: '/bills', label: 'Bills', icon: 'bills' },
      { to: '/recurring', label: 'Recurring', icon: 'recurring' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { to: '/categories', label: 'Categories', icon: 'categories' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

const TABS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/transactions', label: 'Transactions', icon: 'transactions' },
  { to: '/budget', label: 'Budget', icon: 'budget' },
  { to: '/bills', label: 'Bills', icon: 'bills' },
];

export function Layout() {
  const [collapsed, setCollapsed] = useState(getSidebarCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const { me } = useHousehold();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    qc.clear();
    navigate('/login');
  }

  return (
    <div className="app">
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <span className="brand-name">Home Budget</span>
        </div>
        <nav className="stack">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group-title">{g.group}</div>
              {g.items.map((item) => (
                <NavLink key={item.to} to={item.to} className="nav-link" title={collapsed ? item.label : undefined}>
                  <Icon name={item.icon} />
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <span className="spacer" />
        <button
          type="button"
          className="nav-link btn ghost"
          onClick={() => {
            setCollapsed(!collapsed);
            setSidebarCollapsed(!collapsed);
          }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
          <span className="nav-label">Collapse</span>
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <strong className="truncate">{me?.household.name}</strong>
          <span className="spacer" />
          <span className="muted small truncate">{me?.user.name}</span>
          <button type="button" className="btn ghost icon" onClick={logout} aria-label="Log out" title="Log out">
            <Icon name="logout" />
          </button>
        </header>
        <main id="main" className="content">
          <Outlet />
        </main>
      </div>

      <nav className="tabbar" aria-label="Main navigation" style={{ ['--tabs' as string]: TABS.length + 1 }}>
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to}>
            <Icon name={t.icon} />
            {t.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)}>
          <Icon name="more" />
          More
        </button>
      </nav>

      {moreOpen ? (
        <Modal title="More" onClose={() => setMoreOpen(false)}>
          <nav className="stack-sm">
            {NAV.flatMap((g) => g.items).map((item) => (
              <NavLink key={item.to} to={item.to} className="nav-link" onClick={() => setMoreOpen(false)}>
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
            <button type="button" className="nav-link btn ghost" onClick={logout}>
              <Icon name="logout" />
              Log out
            </button>
          </nav>
        </Modal>
      ) : null}
    </div>
  );
}
