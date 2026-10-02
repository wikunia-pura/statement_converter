import { Notification } from 'electron';

/**
 * Every operating-system notification the app shows goes through here, so they
 * all behave the same way: they STAY until the person dismisses them.
 *
 * A notification about a task is worth nothing if it vanished while nobody was
 * looking — the app often runs in the background, and a banner that disappears
 * after a few seconds is gone before the person is back at the desk.
 *
 *   - Windows / Linux: `timeoutType: 'never'` keeps the toast open until it is
 *     closed or clicked.
 *   - macOS has no such option. Whether a notification is a banner (disappears)
 *     or an alert (stays) is the person's choice in System Settings →
 *     Notifications → this app → "Alerts"; the app cannot override it.
 */

/**
 * Notifications still on screen. Electron may garbage-collect a `Notification`
 * nobody references, and a collected one never fires its click handler — the
 * toast would stay but do nothing. Each is held until it is clicked or closed.
 */
const alive = new Set<Notification>();

export function showSystemNotification(
  options: { title: string; body: string },
  onClick?: () => void,
): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ ...options, timeoutType: 'never' });
  alive.add(notification);
  const release = () => {
    alive.delete(notification);
  };
  notification.on('click', () => {
    release();
    onClick?.();
  });
  notification.on('close', release);
  notification.on('failed', release);
  notification.show();
}
