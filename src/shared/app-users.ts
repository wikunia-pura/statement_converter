/**
 * How a person is named across the app.
 *
 * One place, because the answer has to be identical everywhere: the calendar's
 * participant picker, the chips on a saved meeting, the greeting in the sidebar
 * and the one on the dashboard. Three fields can each supply a name and they
 * are not equal in authority:
 *
 *   1. `firstName` / `lastName` — typed by a person in Ustawienia → Użytkownicy.
 *      This is the app's own answer and it wins.
 *   2. `displayName` — mirrored from the Supabase account's metadata by a
 *      trigger. Usually absent; the fallback for accounts nobody has named yet.
 *   3. `email` — always there, and the last resort. A mailbox is not a name,
 *      which is the whole reason the first two exist.
 */

/** Anything that carries a name: an `AppUser`, or a participant snapshot. */
export interface NamedPerson {
  email: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

function clean(value?: string | null): string {
  return (value ?? '').trim();
}

/**
 * The person's full name, or null when nobody has given them one. Null rather
 * than the mailbox, so callers can tell "unnamed" from "named" — the user list
 * needs that difference, and so does the decision to greet someone by name.
 */
export function personName(person: NamedPerson): string | null {
  const typed = [clean(person.firstName), clean(person.lastName)].filter(Boolean).join(' ');
  return typed || clean(person.displayName) || null;
}

/** The label to show wherever a person appears. Falls back to the mailbox. */
export function personLabel(person: NamedPerson): string {
  return personName(person) ?? person.email;
}

/**
 * The one word to greet someone with. Prefers the typed first name; failing
 * that, the first word of whatever name exists; failing that, the part of the
 * mailbox before the @ — "wiktor.mankowski" reads better than the whole
 * address, and greeting nobody at all reads worse than both.
 */
export function greetingName(person: NamedPerson): string {
  const first = clean(person.firstName);
  if (first) return first;
  const name = personName(person);
  if (name) return name.split(/\s+/)[0];
  return person.email.split('@')[0] || person.email;
}

/**
 * Order people the way a reader scans them: by the label they are shown under,
 * Polish collation, so Ł sorts where a Polish reader looks for it. Sorting by
 * mailbox — which is what the database can do — puts names in an order that
 * looks arbitrary the moment names are what you see.
 */
export function comparePeople(a: NamedPerson, b: NamedPerson): number {
  return personLabel(a).localeCompare(personLabel(b), 'pl', { sensitivity: 'base' });
}

/**
 * Up to two letters for an avatar. Initials of the first and last name where
 * they exist, otherwise the opening letters of the mailbox — never empty, so
 * the avatar never renders as a blank circle.
 */
export function personInitials(person: NamedPerson): string {
  const parts = [clean(person.firstName), clean(person.lastName)].filter(Boolean);
  const source = parts.length > 0 ? parts : (personName(person) ?? person.email).split(/[\s.@_-]+/);
  const letters = source
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return letters || person.email.slice(0, 1).toUpperCase() || '?';
}
