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
  /** `#rrggbb` chosen for the person, or empty for the automatic one. */
  color?: string | null;
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

/**
 * Hues an automatic colour may take. Spread around the wheel and picked by
 * hand-sized steps, so two people in a small office land on clearly different
 * colours instead of two neighbouring blues.
 */
const AVATAR_HUES = [8, 28, 46, 98, 142, 168, 192, 214, 238, 262, 286, 318, 340];

const AVATAR_SATURATION = 62;
const AVATAR_LIGHTNESS = 54;

/** `#rrggbb` — the only form a chosen colour is stored in. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** The person's automatic hue, derived from the mailbox. */
function automaticHue(email: string): number {
  const key = (email ?? '').trim().toLowerCase();
  // FNV-1a — tiny, and spreads similar mailboxes ("anna@", "anna2@") apart.
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return AVATAR_HUES[(hash >>> 0) % AVATAR_HUES.length];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const channel = (n: number) =>
    Math.round(255 * (lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[0, 8, 4].map((n) => channel(n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A colour for a person, as `#rrggbb`: the one chosen in Ustawienia →
 * Użytkownicy if there is one, otherwise derived from the mailbox.
 *
 * The automatic colour is derived rather than drawn at random each time:
 * "random" only has to mean "nobody chose it", but a colour that changed on
 * reload would stop being a way to recognise someone. The mailbox is the key a
 * person is known by everywhere else (assignments, backups), so it is the key
 * here too — the same colour on every machine and every launch.
 */
export function personColor(person: Pick<NamedPerson, 'email' | 'color'>): string {
  if (isHexColor(person.color)) return person.color;
  return hslToHex(automaticHue(person.email), AVATAR_SATURATION, AVATAR_LIGHTNESS);
}
