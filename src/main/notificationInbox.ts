import Store from 'electron-store';
import { randomUUID } from 'crypto';
import { InboxNotification } from '../shared/types';

/**
 * The list behind the bell in the sidebar: every notification the notifier
 * raised, kept so that one missed on the desktop can still be read, opened,
 * marked as read or thrown away.
 *
 * Per mailbox and per machine, like the notifier's own picture of the board: it
 * is a record of what THIS computer announced, not shared data, so it is not part
 * of a backup. Capped, because nobody scrolls back through hundreds.
 */
const MAX_PER_PERSON = 100;

interface Schema {
  people: Record<string, InboxNotification[]>;
}

const store = new Store<Schema>({ name: 'notification-inbox', defaults: { people: {} } });

const key = (email: string) => email.trim().toLowerCase();

export function listInbox(email: string): InboxNotification[] {
  return store.get('people')[key(email)] ?? [];
}

function save(email: string, items: InboxNotification[]): void {
  const people = store.get('people');
  people[key(email)] = items;
  store.set('people', people);
}

/** Newest first. Returns the stored entries so a click on the desktop toast can mark its own. */
export function addToInbox(
  email: string,
  entries: Pick<InboxNotification, 'kind' | 'title' | 'body' | 'target'>[],
): InboxNotification[] {
  const created = entries.map(
    (e): InboxNotification => ({
      ...e,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      read: false,
    }),
  );
  save(email, [...created.reverse(), ...listInbox(email)].slice(0, MAX_PER_PERSON));
  return created;
}

/** `ids` null = all of them. */
export function markInboxRead(email: string, ids: string[] | null): void {
  const wanted = ids ? new Set(ids) : null;
  save(
    email,
    listInbox(email).map((n) => (!wanted || wanted.has(n.id) ? { ...n, read: true } : n)),
  );
}

/** `ids` null = all of them. */
export function deleteFromInbox(email: string, ids: string[] | null): void {
  const wanted = ids ? new Set(ids) : null;
  save(email, wanted ? listInbox(email).filter((n) => !wanted.has(n.id)) : []);
}
