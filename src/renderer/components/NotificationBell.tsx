import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InboxNotification, NotificationTarget } from '../../shared/types';
import { translations, Language } from '../translations';
import Icon from './Icon';

interface Props {
  language: Language;
  /** Go where the notification points (the same place its desktop toast opens). */
  onOpenTarget: (target: NotificationTarget) => void;
}

/** "5 min ago" in the app's language; under a minute is "just now". */
function ago(iso: string, language: Language, justNow: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60) return justNow;
  const rtf = new Intl.RelativeTimeFormat(language === 'en' ? 'en' : 'pl', { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

/**
 * The bell by the greeting: how many notifications are unread, and the list
 * behind it. Each can be opened (which marks it read), marked read, or removed;
 * the header does the same for all at once.
 */
const NotificationBell: React.FC<Props> = ({ language, onOpenTarget }) => {
  const t = translations[language];
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await window.electronAPI.getInbox());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    return window.electronAPI.onInboxChanged(() => void reload());
  }, [reload]);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [at]);

  const unread = items.filter((n) => !n.read).length;

  const toggle = () => {
    if (at) {
      setAt(null);
      return;
    }
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    // Beside the sidebar, whatever its width: the rail is collapsed by default.
    const sidebar = button.current?.closest('.sidebar')?.getBoundingClientRect();
    setAt({
      left: (sidebar?.right ?? rect.right) + 8,
      top: Math.max(8, Math.min(rect.top, window.innerHeight - 440)),
    });
    void reload();
  };

  // Local first, then the write — the list answers at once.
  const markRead = (ids: string[] | null) => {
    setItems((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    void window.electronAPI.markInboxRead(ids).catch(() => void reload());
  };

  const remove = (ids: string[] | null) => {
    setItems((prev) => (ids ? prev.filter((n) => !ids.includes(n.id)) : []));
    void window.electronAPI.deleteInbox(ids).catch(() => void reload());
  };

  const open = (n: InboxNotification) => {
    if (!n.read) markRead([n.id]);
    setAt(null);
    onOpenTarget(n.target);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`bell${at ? ' is-open' : ''}`}
        title={unread > 0 ? t.inboxUnreadTitle.replace('{count}', String(unread)) : t.inboxTitle}
        aria-label={t.inboxTitle}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        onClick={toggle}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="bell__count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {at &&
        createPortal(
          <div
            ref={panel}
            className="inbox"
            role="dialog"
            aria-label={t.inboxTitle}
            style={{ left: at.left, top: at.top }}
          >
            <div className="inbox__head">
              <span className="inbox__title">{t.inboxTitle}</span>
              <span className="inbox__bulk">
                <button
                  type="button"
                  className="inbox__icon"
                  title={t.inboxMarkAllRead}
                  aria-label={t.inboxMarkAllRead}
                  disabled={unread === 0}
                  onClick={() => markRead(null)}
                >
                  <Icon name="check-circle" size={16} />
                </button>
                <button
                  type="button"
                  className="inbox__icon"
                  title={t.inboxDeleteAll}
                  aria-label={t.inboxDeleteAll}
                  disabled={items.length === 0}
                  onClick={() => remove(null)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
            {items.length === 0 ? (
              <div className="inbox__empty">{t.inboxEmpty}</div>
            ) : (
              <ul className="inbox__list">
                {items.map((n) => (
                  <li key={n.id} className={`inbox__item${n.read ? '' : ' is-unread'}`}>
                    <button type="button" className="inbox__open" onClick={() => open(n)}>
                      <span className="inbox__dot" aria-hidden="true" />
                      <span className="inbox__text">
                        <span className="inbox__item-title">{n.title}</span>
                        <span className="inbox__item-body">{n.body}</span>
                        <span className="inbox__time">{ago(n.createdAt, language, t.inboxJustNow)}</span>
                      </span>
                    </button>
                    <span className="inbox__actions">
                      {!n.read && (
                        <button
                          type="button"
                          className="inbox__icon"
                          title={t.inboxMarkRead}
                          aria-label={t.inboxMarkRead}
                          onClick={() => markRead([n.id])}
                        >
                          <Icon name="check" size={15} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="inbox__icon"
                        title={t.inboxDelete}
                        aria-label={t.inboxDelete}
                        onClick={() => remove([n.id])}
                      >
                        <Icon name="x" size={15} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

export default NotificationBell;
