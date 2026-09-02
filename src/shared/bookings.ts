/**
 * "Księgowania" — conversion history read from the communities' side.
 *
 * The single determinant of a booking is the generated accounting file: a
 * history row that succeeded and has an `outputPath` produced one, so it counts
 * as a booking for its community. Errors produced nothing, so they are counted
 * separately and never as work done.
 *
 * Everything here is pure and dependency-free (no Node, no Electron) so the
 * renderer can derive the whole dashboard from `getHistory()` + `getAdresy()`
 * without another round trip.
 */

import { Adres, ConversionHistory } from './types';
import { adresPartOfOutputPath, sanitizeForFilename } from './outputPaths';

/* ------------------------------- Months -------------------------------- */

/** Local `YYYY-MM` key — grouping must follow the user's calendar, not UTC. */
export function monthKeyOf(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonthKey(): string {
  return monthKeyOf(new Date());
}

/** Neighbouring month key: `shiftMonthKey('2026-01', -1) === '2025-12'`. */
export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  const d = new Date(y, m - 1 + delta, 1);
  return monthKeyOf(d);
}

/** "wrzesień 2026" / "September 2026", capitalized. */
export function monthLabel(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  const label = new Date(y, m - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/* ---------------------- Attributing rows to addresses ------------------- */

/** Case- and whitespace-insensitive; diacritics are kept (they distinguish names). */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface AdresIndex {
  byId: Map<number, Adres>;
  byName: Map<string, Adres>;
  /** Sanitized name → address, to read the community back out of a filename. */
  byFilenamePart: Map<string, Adres>;
}

export function buildAdresIndex(adresy: Adres[]): AdresIndex {
  const byId = new Map<number, Adres>();
  const byName = new Map<string, Adres>();
  const byFilenamePart = new Map<string, Adres>();
  for (const a of adresy) {
    byId.set(a.id, a);
    byName.set(normalizeName(a.nazwa), a);
    byFilenamePart.set(sanitizeForFilename(a.nazwa).toLowerCase(), a);
    for (const alt of a.alternativeNames ?? []) {
      if (!alt.trim()) continue;
      if (!byName.has(normalizeName(alt))) byName.set(normalizeName(alt), a);
    }
  }
  return { byId, byName, byFilenamePart };
}

/**
 * Which community a history row belongs to. Three sources, in order of trust:
 *   1. `adresId` — written by the conversion itself.
 *   2. `adresNazwa` — survives a restore, which renumbers the addresses.
 *   3. the generated filename, which starts with the sanitized address name —
 *      the only signal rows written before this feature carry.
 */
export function resolveHistoryAdres(
  entry: ConversionHistory,
  index: AdresIndex,
): { adresId: number | null; adresNazwa: string | null } {
  if (entry.adresId != null) {
    const byId = index.byId.get(entry.adresId);
    if (byId) return { adresId: byId.id, adresNazwa: byId.nazwa };
  }
  if (entry.adresNazwa) {
    const byName = index.byName.get(normalizeName(entry.adresNazwa));
    if (byName) return { adresId: byName.id, adresNazwa: byName.nazwa };
    // Address deleted since — keep the name so the row stays readable.
    return { adresId: null, adresNazwa: entry.adresNazwa };
  }
  const part = adresPartOfOutputPath(entry.outputPath);
  if (part) {
    const byPart = index.byFilenamePart.get(part.toLowerCase());
    if (byPart) return { adresId: byPart.id, adresNazwa: byPart.nazwa };
  }
  return { adresId: null, adresNazwa: null };
}

/* ------------------------------ Booking rows ---------------------------- */

/** One history row, resolved: which community, which month, booked or not. */
export interface BookingRow {
  entry: ConversionHistory;
  adresId: number | null;
  /** Null only when nothing could attribute the row to a community. */
  adresNazwa: string | null;
  monthKey: string;
  /** An accounting file was generated — this row IS a booking. */
  isBooking: boolean;
  bookedInDom: boolean;
}

export function toBookingRows(history: ConversionHistory[], adresy: Adres[]): BookingRow[] {
  const index = buildAdresIndex(adresy);
  return history.map((entry) => {
    const { adresId, adresNazwa } = resolveHistoryAdres(entry, index);
    return {
      entry,
      adresId,
      adresNazwa,
      monthKey: monthKeyOf(entry.convertedAt),
      isBooking: entry.status === 'success' && !!entry.outputPath,
      bookedInDom: entry.bookedInDom === true,
    };
  });
}

/** Months that hold at least one row, newest first. */
export function monthsWithData(rows: BookingRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) if (row.monthKey) keys.add(row.monthKey);
  return [...keys].sort((a, b) => b.localeCompare(a));
}

/* --------------------------- Per-address groups ------------------------- */

export type AddressBookingState = 'missing' | 'todo' | 'partial' | 'done';

export interface AddressBookingGroup {
  /** Null for a community that no longer exists (or was never resolved). */
  adresId: number | null;
  /** Stable key for React / selection, including the unattributed bucket. */
  key: string;
  nazwa: string;
  /** True for the "nieprzypisane" bucket — rows with no community at all. */
  unassigned: boolean;
  /** Every row of the selected month, newest first (bookings and errors). */
  rows: BookingRow[];
  /** Accounting files generated in the month. */
  generated: number;
  /** …of which already ticked as posted in DOM. */
  booked: number;
  /** …still waiting for the DOM tick. */
  todo: number;
  /** Failed conversions in the month — nothing was generated for these. */
  errors: number;
  state: AddressBookingState;
  /** Newest row in the month, for sorting and the "last activity" line. */
  lastAt: string | null;
  /** Newest booking in ANY month — the answer to "when was it last done?". */
  lastBookingEverAt: string | null;
  banks: string[];
}

export interface BookingTotals {
  /** Rows on the list: every community, plus the catch-all bucket when present. */
  rows: number;
  /** Communities in the address book (the denominator of the month). */
  addresses: number;
  /** Communities with no accounting file at all this month. */
  unbooked: number;
  /** Communities whose file is generated but not (fully) ticked in DOM. */
  waiting: number;
  /** Communities whose every file is ticked in DOM. */
  dom: number;
  /** Communities with a failed conversion this month (nothing was generated). */
  withErrors: number;
  /** Accounting files generated this month. */
  generated: number;
  /** …of which ticked in DOM. */
  booked: number;
  /** …still waiting for the tick. */
  todo: number;
  /** Failed conversions this month. */
  errors: number;
  /** Share of this month's accounting files already posted in DOM (0–100). */
  domPercent: number;
}

function stateOf(generated: number, booked: number): AddressBookingState {
  if (generated === 0) return 'missing';
  if (booked >= generated) return 'done';
  if (booked > 0) return 'partial';
  return 'todo';
}

/**
 * One group per community — every address in the book, so "what's still
 * missing this month" is answerable, plus a bucket for rows that couldn't be
 * attributed to any community.
 */
export function groupByAddress(
  rows: BookingRow[],
  adresy: Adres[],
  monthKey: string,
): { groups: AddressBookingGroup[]; totals: BookingTotals } {
  const inMonth = new Map<string, BookingRow[]>();
  const lastBookingEver = new Map<string, string>();
  const unassignedRows: BookingRow[] = [];

  const keyOf = (row: BookingRow): string =>
    row.adresId != null ? `id:${row.adresId}` : row.adresNazwa ? `name:${row.adresNazwa}` : 'unassigned';

  for (const row of rows) {
    const key = keyOf(row);
    if (row.isBooking) {
      const best = lastBookingEver.get(key);
      if (!best || row.entry.convertedAt > best) lastBookingEver.set(key, row.entry.convertedAt);
    }
    if (row.monthKey !== monthKey) continue;
    if (key === 'unassigned') {
      unassignedRows.push(row);
      continue;
    }
    const bucket = inMonth.get(key);
    if (bucket) bucket.push(row);
    else inMonth.set(key, [row]);
  }

  const groups: AddressBookingGroup[] = [];
  const seen = new Set<string>();

  const build = (
    key: string,
    adresId: number | null,
    nazwa: string,
    groupRows: BookingRow[],
    unassigned = false,
  ): AddressBookingGroup => {
    const sorted = [...groupRows].sort(
      (a, b) => new Date(b.entry.convertedAt).getTime() - new Date(a.entry.convertedAt).getTime(),
    );
    const bookings = sorted.filter((r) => r.isBooking);
    const booked = bookings.filter((r) => r.bookedInDom).length;
    const errors = sorted.filter((r) => r.entry.status === 'error').length;
    return {
      adresId,
      key,
      nazwa,
      unassigned,
      rows: sorted,
      generated: bookings.length,
      booked,
      todo: bookings.length - booked,
      errors,
      state: stateOf(bookings.length, booked),
      lastAt: sorted[0]?.entry.convertedAt ?? null,
      lastBookingEverAt: lastBookingEver.get(key) ?? null,
      banks: [...new Set(sorted.map((r) => r.entry.bankName).filter(Boolean))],
    };
  };

  for (const adres of adresy) {
    const key = `id:${adres.id}`;
    seen.add(key);
    groups.push(build(key, adres.id, adres.nazwa, inMonth.get(key) ?? []));
  }

  // Rows naming a community that is no longer in the address book.
  for (const [key, groupRows] of inMonth) {
    if (seen.has(key)) continue;
    groups.push(build(key, null, groupRows[0]?.adresNazwa ?? key, groupRows));
  }

  if (unassignedRows.length > 0) {
    groups.push(build('unassigned', null, '', unassignedRows, true));
  }

  // Two different units, and mixing them is what made the old tiles unreadable:
  // the tiles count COMMUNITIES (that is what the list shows and what a filter
  // selects), the progress bar and the header count FILES. The catch-all bucket
  // is a row, not a community, so it never inflates the community counters —
  // but its files are real accounting files and do count as such.
  const communities = groups.filter((g) => !g.unassigned);
  const generated = groups.reduce((sum, g) => sum + g.generated, 0);
  const booked = groups.reduce((sum, g) => sum + g.booked, 0);

  const totals: BookingTotals = {
    rows: groups.length,
    addresses: adresy.length,
    unbooked: communities.filter((g) => g.state === 'missing').length,
    waiting: communities.filter((g) => g.todo > 0).length,
    dom: communities.filter((g) => g.state === 'done').length,
    withErrors: communities.filter((g) => g.errors > 0).length,
    generated,
    booked,
    todo: generated - booked,
    errors: groups.reduce((sum, g) => sum + g.errors, 0),
    domPercent: generated === 0 ? 0 : Math.round((booked / generated) * 100),
  };

  return { groups, totals };
}

/* -------------------------------- Filters ------------------------------- */

/**
 * The four questions the dashboard is for, plus "everything":
 *   unbooked — no accounting file this month, so nothing to post yet,
 *   waiting  — the file exists and is not (fully) ticked in DOM,
 *   dom      — every file of the community is ticked,
 *   errors   — a conversion failed, so no file was produced at all.
 */
export type BookingFilter = 'all' | 'unbooked' | 'waiting' | 'dom' | 'errors';

export function matchesBookingFilter(group: AddressBookingGroup, filter: BookingFilter): boolean {
  switch (filter) {
    case 'unbooked':
      return group.state === 'missing' && !group.unassigned;
    case 'waiting':
      return group.todo > 0;
    case 'dom':
      return group.generated > 0 && group.state === 'done';
    case 'errors':
      return group.errors > 0;
    case 'all':
    default:
      return true;
  }
}

/** Free-text search over the community and everything under it. */
export function matchesBookingSearch(group: AddressBookingGroup, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    group.nazwa,
    ...group.banks,
    ...group.rows.map((r) => `${r.entry.fileName} ${r.entry.converterName} ${r.entry.outputPath}`),
  ]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export type BookingSort = 'todo-first' | 'name' | 'recent';

/** Comparators kept here so the list order is part of the tested logic. */
export function sortGroups(groups: AddressBookingGroup[], sort: BookingSort, locale: string): AddressBookingGroup[] {
  const byName = (a: AddressBookingGroup, b: AddressBookingGroup) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    return a.nazwa.localeCompare(b.nazwa, locale);
  };
  const rank: Record<AddressBookingState, number> = { todo: 0, partial: 1, missing: 2, done: 3 };
  const copy = [...groups];
  if (sort === 'name') return copy.sort(byName);
  if (sort === 'recent') {
    return copy.sort((a, b) => {
      const at = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const bt = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      return bt - at || byName(a, b);
    });
  }
  return copy.sort((a, b) => {
    // Errors bubble to the very top: they mean nothing was generated at all.
    if ((a.errors > 0) !== (b.errors > 0)) return a.errors > 0 ? -1 : 1;
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    return byName(a, b);
  });
}
