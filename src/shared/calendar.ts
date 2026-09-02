/**
 * "Kalendarz" — meetings, the pure logic behind the view.
 *
 * A meeting is one instant (`startsAt`) with an optional end, so everything the
 * calendar does is arithmetic on local calendar days: the grid, the grouping,
 * the "is this today" badge. Local, never UTC — a meeting at 00:30 belongs to
 * the day the user typed, not to the day the instant happens to fall on in
 * Greenwich. That is the same rule `bookings.ts` follows for months, and its
 * month-key helpers are re-exported here so both modules count months alike.
 */

import { Spotkanie, SpotkanieTyp } from './types';

export { monthKeyOf, currentMonthKey, shiftMonthKey, monthLabel } from './bookings';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local `YYYY-MM-DD` key. Empty string for a value that isn't a date. */
export function toDayKey(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(): string {
  return toDayKey(new Date());
}

/** `YYYY-MM` of a day key — cheaper and safer than re-parsing the date. */
export function monthOfDayKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/* ------------------------------ The month grid ----------------------------- */

export interface CalendarCell {
  /** Local `YYYY-MM-DD`. */
  dayKey: string;
  dayOfMonth: number;
  /** False for the leading/trailing days borrowed from the neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

/**
 * Monday-first grid of whole weeks covering the month, with as many rows as the
 * month actually needs (four to six) — a fixed six would leave a blank week
 * hanging under most months.
 */
export function buildMonthGrid(monthKey: string, today: Date = new Date()): CalendarCell[] {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return [];

  const first = new Date(year, month - 1, 1);
  // getDay() is 0=Sunday; the week starts on Monday here.
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;

  const tKey = toDayKey(today);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < cellCount; i++) {
    const date = new Date(year, month - 1, 1 - leading + i);
    const weekday = date.getDay();
    cells.push({
      dayKey: toDayKey(date),
      dayOfMonth: date.getDate(),
      inMonth: date.getMonth() === month - 1 && date.getFullYear() === year,
      isToday: toDayKey(date) === tKey,
      isWeekend: weekday === 0 || weekday === 6,
    });
  }
  return cells;
}

/** Short weekday names, Monday first. 2024-01-01 was a Monday. */
export function weekdayLabels(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }),
  );
}

/* --------------------------- Grouping and ordering -------------------------- */

/**
 * Chronological, earliest first; equal instants fall back to the name.
 *
 * Compared as instants, not as strings: Supabase renders `timestamptz` with a
 * `+00:00` offset while values the app builds end in `Z`, so the two orderings
 * only agree numerically.
 */
export function sortSpotkania(list: Spotkanie[], locale = 'pl-PL'): Spotkanie[] {
  return [...list].sort((a, b) => {
    const diff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    return diff !== 0 ? diff : a.nazwa.localeCompare(b.nazwa, locale);
  });
}

/** Meetings whose local day falls inside `monthKey`. */
export function spotkaniaInMonth(list: Spotkanie[], monthKey: string): Spotkanie[] {
  return list.filter((s) => monthOfDayKey(toDayKey(s.startsAt)) === monthKey);
}

/** Day key → that day's meetings, in order. */
export function groupByDay(list: Spotkanie[], locale = 'pl-PL'): Map<string, Spotkanie[]> {
  const byDay = new Map<string, Spotkanie[]>();
  for (const s of sortSpotkania(list, locale)) {
    const key = toDayKey(s.startsAt);
    if (!key) continue;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(s);
    else byDay.set(key, [s]);
  }
  return byDay;
}

/** Months holding at least one meeting, newest first. */
export function monthsWithSpotkania(list: Spotkanie[]): string[] {
  const keys = new Set<string>();
  for (const s of list) {
    const key = monthOfDayKey(toDayKey(s.startsAt));
    if (key) keys.add(key);
  }
  return [...keys].sort((a, b) => b.localeCompare(a));
}

/** The next meetings from `now` on, soonest first — a running one still counts. */
export function upcomingSpotkania(list: Spotkanie[], limit = 5, now: Date = new Date()): Spotkanie[] {
  const cutoff = now.getTime();
  return sortSpotkania(
    list.filter((s) => {
      const until = new Date(s.endsAt ?? s.startsAt).getTime();
      return !Number.isNaN(until) && until >= cutoff;
    }),
  ).slice(0, limit);
}

/* --------------------------------- Filtering -------------------------------- */

/** Free-text search over everything a user would type to find a meeting. */
export function matchesSpotkanieSearch(
  spotkanie: Spotkanie,
  typy: SpotkanieTyp[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const typ = typy.find((t) => t.id === spotkanie.typId);
  const haystack = [
    spotkanie.nazwa,
    spotkanie.adresNazwa,
    spotkanie.opis,
    spotkanie.createdBy,
    typ?.nazwa ?? '',
    ...spotkanie.uczestnicy.flatMap((u) => [u.email, u.displayName ?? '']),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

/** `null` means "every type", including meetings whose type was deleted. */
export function matchesTypFilter(spotkanie: Spotkanie, typId: number | null): boolean {
  return typId === null || spotkanie.typId === typId;
}

/* -------------------------------- Presentation ------------------------------ */

export type SpotkanieWhen = 'past' | 'now' | 'today' | 'upcoming';

/**
 * Where a meeting sits relative to now.
 *
 * `now` is only knowable when an end was given. A meeting with no end is not
 * called over merely because its start has passed — the app was never told how
 * long it runs — so it stays `today` until the day itself is behind us.
 */
export function spotkanieWhen(spotkanie: Spotkanie, now: Date = new Date()): SpotkanieWhen {
  const start = new Date(spotkanie.startsAt).getTime();
  const end = spotkanie.endsAt ? new Date(spotkanie.endsAt).getTime() : null;
  const t = now.getTime();
  if (end !== null && t >= start && t <= end) return 'now';
  const sameDay = toDayKey(spotkanie.startsAt) === toDayKey(now);
  if (end !== null ? t > end : !sameDay && t > start) return 'past';
  return sameDay ? 'today' : 'upcoming';
}

/** `gg:mm`, in the user's locale. */
export function formatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** `10:00 – 11:30`, or just `10:00` when no end was given. */
export function formatTimeRange(spotkanie: Spotkanie, locale: string): string {
  const start = formatTime(spotkanie.startsAt, locale);
  if (!spotkanie.endsAt) return start;
  return `${start} – ${formatTime(spotkanie.endsAt, locale)}`;
}

/** "poniedziałek, 2 września" — the day, without the year that the header shows. */
export function formatDayLabel(dayKey: string, locale: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** "2 września 2026, 10:00" — for a single meeting, out of any day context. */
export function formatStamp(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ---------------------------- Form value plumbing --------------------------- */

/** The two halves an `<input type="date">` + `<input type="time">` pair holds. */
export interface DateTimeParts {
  date: string;
  time: string;
}

export const EMPTY_PARTS: DateTimeParts = { date: '', time: '' };

/** Split an instant into the local date and time the inputs display. */
export function toParts(iso: string | null | undefined): DateTimeParts {
  if (!iso) return EMPTY_PARTS;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY_PARTS;
  return { date: toDayKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * The instant those two inputs mean, read in the user's own timezone — the hour
 * they typed is the hour they meant. Null when the date is missing or unusable,
 * which is what makes it double as the form's validation.
 */
export function partsToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hhmm = /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
  const d = new Date(`${date}T${hhmm}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * `'10:00' + 60 → '11:00'`. Clamped at `23:59` rather than rolling into the next
 * day: the end date is not a field the user can see, so a rolled-over end would
 * silently land the meeting's end before its start.
 */
export function shiftTime(time: string, minutes: number): string {
  if (!/^\d{2}:\d{2}$/.test(time)) return time;
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) return '23:59';
  if (total < 0) return '00:00';
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/* ----------------------------------- Colour --------------------------------- */

/**
 * Palette offered when a type is created — the app's accent plus hues that stay
 * distinguishable next to it, and legible on both themes' surfaces.
 */
export const TYP_COLORS = [
  '#5b5ff6',
  '#0369a1',
  '#0f766e',
  '#1f6b43',
  '#b45309',
  '#c2410c',
  '#c62f37',
  '#a21caf',
  '#7c3aed',
  '#475569',
] as const;

export const DEFAULT_TYP_COLOR = TYP_COLORS[0];

/** A usable `#rrggbb`, whatever the row or the input actually contained. */
export function normalizeHexColor(value: string, fallback: string = DEFAULT_TYP_COLOR): string {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const [r, g, b] = v.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

/* -------------------------------- The title --------------------------------- */

/**
 * The title a meeting gets from its type and its community: "Zebranie wspólnoty
 * — ul. Puławska 116".
 *
 * The two pickers are what the user actually decides; the name is almost always
 * a restatement of them, so the form writes it and lets the user overrule it.
 * With only one of the two answered, that one *is* the title — a lone dash
 * would be worse than a short name. Empty when neither is set, which the form
 * reads as "nothing to suggest".
 */
export function suggestSpotkanieTitle(
  typNazwa: string | null | undefined,
  adresNazwa: string | null | undefined,
): string {
  return [typNazwa?.trim(), adresNazwa?.trim()].filter(Boolean).join(' — ');
}

/** The type of a meeting, or null — the lookup every renderer needs. */
export function typOf(spotkanie: Spotkanie, typy: SpotkanieTyp[]): SpotkanieTyp | null {
  if (spotkanie.typId === null) return null;
  return typy.find((t) => t.id === spotkanie.typId) ?? null;
}
