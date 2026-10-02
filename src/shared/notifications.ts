/**
 * The system notifications the app can show, and which of them the person can
 * switch off (Ustawienia → Powiadomienia).
 *
 * Only the ids and the rules live here; the wording shown in the settings list
 * is in `translations.ts` under `notif_<id>` / `notif_<id>_desc`, and the wording
 * of the notification itself is in the main process (`notifier.ts`).
 *
 * `locked` notifications are the ones the app has always shown: they stay on and
 * the list shows them as such. The others are opt-in (`defaultOn: false`): a new
 * kind of notification must not start interrupting everyone on update — each
 * person turns on what they want, and the choice belongs to their account
 * (`notification_prefs`, keyed by mailbox), not to the machine.
 *
 * Adding a notification means adding it here, the two translation keys, and the
 * code in `notifier.ts` that raises it.
 */

export type NotificationGroup = 'zadania' | 'ksiegowania';

export const NOTIFICATION_DEFS = [
  // Zadania — about tasks assigned to me, and comments.
  { id: 'zadanieAssigned', group: 'zadania', locked: true, defaultOn: true },
  { id: 'zadanieChanged', group: 'zadania', locked: true, defaultOn: true },
  { id: 'zadanieOverdue', group: 'zadania', locked: true, defaultOn: true },
  { id: 'zadanieMention', group: 'zadania', locked: true, defaultOn: true },
  { id: 'zadanieComment', group: 'zadania', locked: true, defaultOn: true },
  // Księgowania — about what the team does on the month's list.
  { id: 'ksiegowaniaPriorytet', group: 'ksiegowania', locked: false, defaultOn: false },
  { id: 'ksiegowaniaPriorytetNotatka', group: 'ksiegowania', locked: false, defaultOn: false },
  { id: 'ksiegowaniaUwaga', group: 'ksiegowania', locked: false, defaultOn: false },
] as const;

export type NotificationId = (typeof NOTIFICATION_DEFS)[number]['id'];

export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = ['zadania', 'ksiegowania'];

/** One person's switches: only the ones they have flipped are stored. */
export type NotificationPrefs = Partial<Record<NotificationId, boolean>>;

export function isNotificationId(value: unknown): value is NotificationId {
  return NOTIFICATION_DEFS.some((d) => d.id === value);
}

/**
 * Whether a notification is on for a person. A locked one always is, whatever
 * was stored; any other follows the switch they flipped, and until they flip it
 * its `defaultOn`.
 */
export function isNotificationEnabled(
  prefs: NotificationPrefs | null | undefined,
  id: NotificationId,
): boolean {
  const def = NOTIFICATION_DEFS.find((d) => d.id === id);
  if (!def) return false;
  if (def.locked) return true;
  return prefs?.[id] ?? def.defaultOn;
}
