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

import { Spotkanie, SpotkanieLokalizacja, SpotkanieMaterialyStatus, SpotkanieTyp } from './types';

export { monthKeyOf, currentMonthKey, shiftMonthKey, monthLabel } from './bookings';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Local `YYYY-MM-DD` key. Empty string for a value that isn't a date.
 *
 * The one way to get a calendar day out of a stored instant: a meeting with no
 * hour is local midnight, which `toISOString()` writes as 22:00/23:00 of the day
 * BEFORE — so `iso.slice(0, 10)` (or `startsWith(year)`) prints the wrong day.
 * A bare day key is already a day and comes back as it is (`new Date()` would
 * read it as UTC midnight).
 */
export function toDayKey(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
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

/* ------------------------------ Periods (PDF) ------------------------------ */

/** The longest period one calendar PDF covers — one grid page per month. */
export const KALENDARZ_PDF_MAX_MIESIECY = 24;

/** Last day of a month, as a day key: `2026-02` → `2026-02-28`. */
export function lastDayOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return `${monthKey}-${pad(new Date(y, m, 0).getDate())}`;
}

/** Every month a period touches, in order: `2026-10-20`…`2026-12-02` → three. */
export function monthsInRange(od: string, doDnia: string): string[] {
  const out: string[] = [];
  let [y, m] = od.slice(0, 7).split('-').map(Number);
  const end = doDnia.slice(0, 7);
  for (let guard = 0; guard < 1200; guard++) {
    const key = `${y}-${pad(m)}`;
    out.push(key);
    if (key >= end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export type KalendarzOkresProblem = 'format' | 'kolejnosc' | 'za-dlugi';

/** What is wrong with a period asked for a PDF, or null when nothing is. */
export function kalendarzOkresProblem(od: unknown, doDnia: unknown): KalendarzOkresProblem | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof od !== 'string' || typeof doDnia !== 'string' || !day.test(od) || !day.test(doDnia)) {
    return 'format';
  }
  if (doDnia < od) return 'kolejnosc';
  if (monthsInRange(od, doDnia).length > KALENDARZ_PDF_MAX_MIESIECY) return 'za-dlugi';
  return null;
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
    spotkanie.lokalizacjaNazwa,
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

/** `null` means "every materials state"; otherwise exactly the one picked. */
export function matchesMaterialyFilter(
  spotkanie: Spotkanie,
  status: SpotkanieMaterialyStatus | null,
): boolean {
  return status === null || spotkanie.materialyStatus === status;
}

/* --------------------- Moved dates and tentative dates --------------------- */

/**
 * The states a meeting can be in that mean somebody still has something to do:
 *
 *   `overdue`   — materials still owed and the sending deadline has arrived,
 *   `changed`   — the date moved and nobody has said they saw it,
 *   `tentative` — the date was never settled in the first place.
 *
 * Each is a filter and a count: the dates in the warning strip above the month,
 * `overdue` among the materials chips (the other materials states are there too).
 */
export type SpotkanieStateFilter = 'all' | 'overdue' | 'changed' | 'tentative';

/**
 * The day a meeting's materials are due by, as its kind's notice period says —
 * what the meeting form offers before anyone sets a day of their own. Null when
 * the kind has no notice period or the start is not a date.
 */
export function defaultTerminWysylki(
  startsAt: string | null,
  typ: SpotkanieTyp | null | undefined,
): string | null {
  const days = typ?.dniNaDokumenty ?? null;
  if (!startsAt || days === null || days <= 0) return null;
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const due = new Date(start.getFullYear(), start.getMonth(), start.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
}

/** The last moment of a local calendar day (`YYYY-MM-DD`); null for a key that is no day. */
function koniecDnia(dayKey: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(end.getTime()) ? null : end;
}

/**
 * The moment this meeting's materials are due to go out, or null when its kind
 * has no notice period — which is what switches the whole deadline idea off.
 *
 * Always the end of a calendar day: the day set on the meeting, else the day the
 * form offers (`defaultTerminWysylki` — the meeting's day less the kind's notice,
 * counted in calendar days). Counting 24-hour blocks back from the meeting's hour
 * made the alert and the form disagree (due at 10:00 vs the day shown) and slip an
 * hour across a DST change.
 */
export function terminWysylkiDeadline(spotkanie: Spotkanie, typy: SpotkanieTyp[]): Date | null {
  // A day set on the meeting itself wins: due by the end of that day.
  if (spotkanie.terminWysylki) return koniecDnia(spotkanie.terminWysylki);
  const dzien = defaultTerminWysylki(spotkanie.startsAt, typOf(spotkanie, typy));
  return dzien ? koniecDnia(dzien) : null;
}

/**
 * Materials the meeting still owes: needed and not sent yet. "Not needed" owes
 * nothing, and "sent" is the end of the road.
 */
export function hasMaterialyOutstanding(spotkanie: Spotkanie): boolean {
  return spotkanie.materialyStatus !== 'brak' && spotkanie.materialyStatus !== 'wyslane';
}

/**
 * Materials still owed, and the sending deadline has arrived.
 *
 * Deliberately not "the meeting has passed": the point of a notice period is
 * that it runs out BEFORE the meeting, so this turns true while there is still
 * a meeting to send them for. A kind without a notice period never reports it.
 */
export function isMaterialyOverdue(
  spotkanie: Spotkanie,
  typy: SpotkanieTyp[],
  now: Date = new Date(),
): boolean {
  if (!hasMaterialyOutstanding(spotkanie)) return false;
  const deadline = terminWysylkiDeadline(spotkanie, typy);
  if (!deadline) return false;
  return now.getTime() >= deadline.getTime();
}

/**
 * True while a moved date is still waiting to be acknowledged.
 *
 * The acknowledgement — not the move — is what clears this: the point of the
 * mark is that a person has seen it, so an unread move stays loud however old
 * it is, and a read one goes quiet however recent.
 */
export function hasUnreadTerminChange(spotkanie: Spotkanie): boolean {
  return !!spotkanie.terminZmienionyAt && !spotkanie.terminZmianaOdczytanaAt;
}

/** True for a date that was never settled. */
export function isTerminWstepny(spotkanie: Spotkanie): boolean {
  return spotkanie.terminStatus === 'wstepny';
}

/** `typy` carry the notice periods the materials deadline comes from. */
export function matchesStateFilter(
  spotkanie: Spotkanie,
  filter: SpotkanieStateFilter,
  typy: SpotkanieTyp[],
): boolean {
  if (filter === 'overdue') return isMaterialyOverdue(spotkanie, typy);
  if (filter === 'changed') return hasUnreadTerminChange(spotkanie);
  if (filter === 'tentative') return isTerminWstepny(spotkanie);
  return true;
}

/**
 * What the strip above the month has to announce. Counted over whatever list the
 * caller considers "in view" — the month, so switching months answers for the
 * month you are looking at rather than for the whole database.
 */
export interface SpotkaniaAlerts {
  overdue: number;
  changed: number;
  tentative: number;
}

export function countAlerts(list: Spotkanie[], typy: SpotkanieTyp[]): SpotkaniaAlerts {
  const now = new Date();
  return {
    overdue: list.filter((s) => isMaterialyOverdue(s, typy, now)).length,
    changed: list.filter(hasUnreadTerminChange).length,
    tentative: list.filter(isTerminWstepny).length,
  };
}

/** True when at least one of the states has something to report. */
export function hasAnyAlert(alerts: SpotkaniaAlerts): boolean {
  return alerts.overdue > 0 || alerts.changed > 0 || alerts.tentative > 0;
}

/**
 * The meetings a dashboard should be counting: today's and everything after.
 *
 * A dashboard is about what can still be done. A notice period that ran out on
 * a meeting held in March is a fact, not a task, and letting those pile up
 * would make the tile a number nobody can ever bring back to zero. The calendar
 * still shows them when you browse to that month, which is where looking at
 * what already happened belongs.
 */
export function spotkaniaFromToday(list: Spotkanie[], now: Date = new Date()): Spotkanie[] {
  const today = toDayKey(now);
  return list.filter((s) => {
    const key = toDayKey(s.startsAt);
    return !!key && key >= today;
  });
}

/**
 * The month (`YYYY-MM`) of the earliest meeting in `list` in the given state —
 * where a dashboard tile should land, so the calendar opens on a month that
 * actually shows what the tile counted. Null when none (or for `all`).
 */
export function firstMonthWithState(
  list: Spotkanie[],
  filter: SpotkanieStateFilter,
  typy: SpotkanieTyp[],
): string | null {
  if (filter === 'all') return null;
  const first = sortSpotkania(list.filter((s) => matchesStateFilter(s, filter, typy)))[0];
  return first ? monthOfDayKey(toDayKey(first.startsAt)) : null;
}

/** The location of a meeting, or null — the lookup every renderer needs. */
export function lokalizacjaOf(
  spotkanie: Spotkanie,
  lokalizacje: SpotkanieLokalizacja[],
): SpotkanieLokalizacja | null {
  if (spotkanie.lokalizacjaId === null) return null;
  return lokalizacje.find((l) => l.id === spotkanie.lokalizacjaId) ?? null;
}

/**
 * What to show as the meeting's place: the live dictionary entry when the link
 * still resolves, otherwise the name snapshotted on the meeting. A location
 * deleted from the dictionary leaves the meeting saying where it was held.
 */
export function lokalizacjaLabel(
  spotkanie: Spotkanie,
  lokalizacje: SpotkanieLokalizacja[],
): string {
  return lokalizacjaOf(spotkanie, lokalizacje)?.nazwa || spotkanie.lokalizacjaNazwa || '';
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
