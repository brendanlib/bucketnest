import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useNotifications } from '../api/hooks';
import type { AppNotification } from '../api/types';
import { Icon } from './Icon';
import { formatDateTime } from '../lib/format';
import { useHousehold } from '../lib/household';

/** The in-app notification centre: a bell with the unread count and a panel of recent alerts. */
export function NotificationBell() {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { locale, timezone } = useHousehold();
  const unread = notifications.data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function openItem(n: AppNotification) {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  return (
    <div className="bell" ref={panel}>
      <button
        type="button"
        className="btn ghost icon"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" />
        {unread ? <span className="bell-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="bell-panel" role="region" aria-label="Notifications">
          <div className="row" style={{ padding: '0.6rem 0.9rem', borderBottom: '1px solid var(--border)' }}>
            <strong>Notifications</strong>
            <span className="spacer" />
            {unread ? (
              <button
                type="button"
                className="link-btn small"
                onClick={async () => {
                  await api.post('/notifications/read-all');
                  await qc.invalidateQueries({ queryKey: ['notifications'] });
                }}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="bell-list">
            {notifications.data?.items.length ? (
              notifications.data.items.map((n) => (
                <button key={n.id} type="button" className={`bell-item${n.read ? '' : ' unread'}`} onClick={() => openItem(n)}>
                  {!n.read ? <span className="dot" style={{ background: 'var(--primary)' }} aria-label="Unread" role="img" /> : <span style={{ width: 10 }} />}
                  <span className="grow">
                    <strong className="small">{n.title}</strong>
                    <span className="small muted" style={{ display: 'block' }}>{n.body}</span>
                    <span className="small muted">{formatDateTime(n.createdAt, locale, timezone)}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="muted small" style={{ padding: '1rem' }}>Nothing yet. Bills due soon, budgets running low and deadlines will show up here.</p>
            )}
          </div>
          <div style={{ padding: '0.5rem 0.9rem', borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              className="link-btn small"
              onClick={() => {
                setOpen(false);
                navigate('/settings?section=Notifications');
              }}
            >
              Notification settings
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
