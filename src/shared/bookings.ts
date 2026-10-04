/**
 * "Księgowania" — conversion history read from the communities' side.
 *
 * The single determinant of a booking is the generated accounting file: a
 * history row that succeeded and has an `outputPath` produced one, so it counts
 * as a booking for its community. Errors produced nothing, so they are counted
 * separately and never as work done.
 *
 * The rows come from the dashboard's own table (`ksiegowania_konwersje`, read
 * with `getKsiegowaniaKonwersje()`), NOT from the history log: the Historia
 * module may clear its log, and the posting state must survive that.
 *
 * Everything here is pure and dependency-free (no Node, no Electron) so the
 * renderer can derive the whole dashboard from those records + `getAdresy()`
 * without another round trip.
 */

import { Adres, ConversionHistory, KsiegowaniePlik, KsiegowaniePriorytet, KsiegowanieUwaga } from './types';
import { adresPartOfOutputPath, sanitizeForFilename } from './outputPaths';
import { pdfForStatement } from './statement-scan';

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

/**
 * The group key (`id:…` / `name:…`) a priority or note belongs to — the same
 * keys `groupByAddress` gives its groups, so an item lands on the row it was
 * written for. Like `resolveHistoryAdres`, the id is tried first and the name
 * second: a restore renumbers the addresses, and the name is what survives.
 */
export function groupKeyOfAdresRef(
  ref: { adresId: number | null; adresNazwa: string },
  index: AdresIndex,
): string {
  if (ref.adresId != null) {
    const byId = index.byId.get(ref.adresId);
    if (byId) return `id:${byId.id}`;
  }
  const byName = index.byName.get(normalizeName(ref.adresNazwa));
  if (byName) return `id:${byName.id}`;
  // Community deleted since — the key a history row of it would get.
  return `name:${ref.adresNazwa}`;
}

/**
 * The open notes of every community, keyed by address id — what the Converter
 * asks when it has recognised a community: "is there something to know before
 * this one is posted?". Resolved notes never come back through here.
 */
export function openUwagiByAdresId(
  adresy: Adres[],
  uwagi: KsiegowanieUwaga[],
): Map<number, KsiegowanieUwaga[]> {
  const index = buildAdresIndex(adresy);
  const out = new Map<number, KsiegowanieUwaga[]>();
  for (const u of uwagi) {
    if (u.resolvedAt) continue;
    const key = groupKeyOfAdresRef(u, index);
    if (!key.startsWith('id:')) continue; // a deleted community cannot be converted for
    const id = Number(key.slice(3));
    const bucket = out.get(id);
    if (bucket) bucket.push(u);
    else out.set(id, [u]);
  }
  for (const bucket of out.values()) bucket.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out;
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
  /**
   * Marked as posted without a conversion: a booking with no accounting file.
   * Counts as generated and posted; it has nothing to open.
   */
  manual: boolean;
}

export function toBookingRows(history: ConversionHistory[], adresy: Adres[]): BookingRow[] {
  const index = buildAdresIndex(adresy);
  return history.map((entry) => {
    const { adresId, adresNazwa } = resolveHistoryAdres(entry, index);
    return {
      entry,
      adresId,
      adresNazwa,
      // The statement's own month when the conversion recorded it; older rows
      // fall back to the day they were converted.
      monthKey: entry.monthKey || monthKeyOf(entry.convertedAt),
      isBooking: entry.status === 'success' && (!!entry.outputPath || entry.manual === true),
      bookedInDom: entry.bookedInDom === true,
      manual: entry.manual === true,
    };
  });
}

/** Months that hold at least one row, newest first. */
export function monthsWithData(rows: BookingRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) if (row.monthKey) keys.add(row.monthKey);
  return [...keys].sort((a, b) => b.localeCompare(a));
}

/* ------------------------ Files pinned by the scan ----------------------- */

/**
 * How far a file's timestamp may run ahead of the conversion's and still count
 * as converted: the file server's clock and the database's are not the same
 * clock. Two minutes is far below any real "re-downloaded a newer version".
 */
const CLOCK_SKEW_MS = 2 * 60 * 1000;

function sameCommunity(row: BookingRow, plik: KsiegowaniePlik): boolean {
  if (row.adresId != null && plik.adresId != null) return row.adresId === plik.adresId;
  return !!row.adresNazwa && normalizeName(row.adresNazwa) === normalizeName(plik.adresNazwa);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Which pinned statement each conversion converted. Read from the history
 * rather than stored, so a statement dragged into the Converter by hand counts
 * just as one opened from the dashboard.
 *
 * A conversion that recorded its input file's hash belongs to the pinned
 * statement with that hash — the same content, whatever the file is called or
 * wherever it was moved since. Otherwise (older rows, or a file changed since)
 * it belongs to a pinned statement of the same community and file
 * name, made after that file last changed. When several pinned files share the
 * name (banks reuse "operacje_260601_260630 (1).xml" month after month), the
 * converted path decides first, and otherwise the newest version that already
 * existed at the time of the conversion — so each conversion lands on exactly
 * one file, and a newer version of a file is "not converted" again.
 */
export function linkConversions(
  pliki: KsiegowaniePlik[],
  rows: BookingRow[],
): { byPlik: Map<number, BookingRow>; monthByHistoryId: Map<number, string> } {
  const byName = new Map<string, KsiegowaniePlik[]>();
  const byHash = new Map<string, KsiegowaniePlik[]>();
  const push = (map: Map<string, KsiegowaniePlik[]>, key: string, p: KsiegowaniePlik) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(p);
    else map.set(key, [p]);
  };
  for (const p of pliki) {
    if (p.kind !== 'statement' || p.status !== 'ok') continue;
    push(byName, p.fileName.toLowerCase(), p);
    if (p.fileHash) push(byHash, p.fileHash, p);
  }
  const byPlik = new Map<number, BookingRow>();
  const monthByHistoryId = new Map<number, string>();
  if (byName.size === 0) return { byPlik, monthByHistoryId };

  for (const row of rows) {
    if (!row.isBooking) continue;
    const at = Date.parse(row.entry.convertedAt);
    const input = normalizePath(row.entry.inputPath ?? '');
    // Same content needs no timestamp check: it is exactly what was converted.
    const sameContent = row.entry.inputHash
      ? (byHash.get(row.entry.inputHash) ?? []).filter((p) => sameCommunity(row, p))
      : [];
    const candidates =
      sameContent.length > 0
        ? sameContent
        : (byName.get(row.entry.fileName.toLowerCase()) ?? []).filter(
            (p) => sameCommunity(row, p) && at >= Date.parse(p.fileMtime) - CLOCK_SKEW_MS,
          );
    if (candidates.length === 0) continue;
    const onPath = candidates.filter((p) => input.endsWith(`/${p.relPath.toLowerCase()}`));
    const pool = onPath.length > 0 ? onPath : candidates;
    const plik = pool.reduce((a, b) => (Date.parse(b.fileMtime) > Date.parse(a.fileMtime) ? b : a));
    monthByHistoryId.set(row.entry.id, plik.monthKey);
    const best = byPlik.get(plik.id);
    if (!best || row.entry.convertedAt > best.entry.convertedAt) byPlik.set(plik.id, row);
  }
  return { byPlik, monthByHistoryId };
}

/**
 * The month a conversion counts in. A conversion of a pinned statement counts
 * in the statement's own month — the June statement converted on 10 July is
 * June's work — and every other conversion in the month it was made, as before.
 */
export function attributeToStatementMonths(rows: BookingRow[], pliki: KsiegowaniePlik[]): BookingRow[] {
  const { monthByHistoryId } = linkConversions(pliki, rows);
  if (monthByHistoryId.size === 0) return rows;
  return rows.map((row) => {
    if (row.entry.monthKey) return row; // recorded at conversion — already the statement's month
    const month = monthByHistoryId.get(row.entry.id);
    return month && month !== row.monthKey ? { ...row, monthKey: month } : row;
  });
}

/** One pinned statement, read against the history and the month's PDFs. */
export interface PlikStatus {
  plik: KsiegowaniePlik;
  conversion: BookingRow | null;
  /** The PDF that goes with it, when one was found. */
  pdf: KsiegowaniePlik | null;
}

/** Last path segment, both separators. */
function fileNameOf(p: string): string {
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return cut < 0 ? p : p.slice(cut + 1);
}

/** The part of an output name between the address and the timestamp — the account type, when there is one. */
function typeOfOutput(row: BookingRow): string {
  return fileNameOf(row.entry.outputPath).replace(/_\d{8}_\d{6}.*$/, '').toLowerCase();
}

/**
 * Which pinned PDF goes with each accounting file of the month. A file made
 * from a pinned statement takes that statement's PDF. One made from a
 * statement the scan never saw — converted from another folder, or from a
 * bank file no scan reads — still deserves its PDF: it is matched by the
 * account type its name carries ("…_Eksploatacja_…"), and when a community
 * with a single account has one such file and one such PDF, the two simply go
 * together.
 */
function pdfsOfConversions(
  statements: PlikStatus[],
  bookings: BookingRow[],
  pdfs: KsiegowaniePlik[],
  singleAccount: boolean,
): Map<number, KsiegowaniePlik> {
  const out = new Map<number, KsiegowaniePlik>();
  for (const s of statements) {
    if (s.conversion && s.pdf) out.set(s.conversion.entry.id, s.pdf);
  }
  const taken = new Set(statements.map((s) => s.pdf?.id).filter((id): id is number => id != null));
  const linked = new Set(statements.map((s) => s.conversion?.entry.id).filter((id): id is number => id != null));
  const free = pdfs.filter((p) => !taken.has(p.id));
  const used = new Set<number>();
  const open = bookings.filter((r) => !linked.has(r.entry.id));
  const unmatched: BookingRow[] = [];
  for (const row of open) {
    const name = fileNameOf(row.entry.outputPath).toLowerCase();
    const ofType = (p: KsiegowaniePlik) =>
      !!p.accountTypeName && name.includes(`_${sanitizeForFilename(p.accountTypeName).toLowerCase()}_`);
    // The month's only PDF of that type is that file's PDF, even if a pinned
    // statement shows it too (the file was converted from another copy).
    const onlyOfType = pdfs.filter(ofType);
    const byType = onlyOfType.length === 1 ? onlyOfType : free.filter(ofType);
    if (byType.length >= 1) {
      // Several PDFs of one type (partial periods): the latest period first.
      // Not used up — converting the same statement again is another file of
      // the same type, and it has the same PDF.
      const pdf = [...byType].sort((a, b) => (b.periodTo ?? '').localeCompare(a.periodTo ?? ''))[0];
      out.set(row.entry.id, pdf);
      used.add(pdf.id);
    } else unmatched.push(row);
  }
  const left = free.filter((p) => !used.has(p.id));
  if (singleAccount && unmatched.length >= 1 && left.length === 1 && new Set(unmatched.map(typeOfOutput)).size === 1) {
    // A community with one account, one kind of file and one PDF: they belong
    // together. With more accounts, a PDF found for one of them says nothing
    // about the files of the other.
    for (const row of unmatched) out.set(row.entry.id, left[0]);
  }
  return out;
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
  /**
   * Place in this month's priority queue — 1 for the first community to do, 2
   * for the next — or null when it is not flagged. The number is the place in
   * the order, not a stored value, so it never has gaps.
   */
  priorityRank: number | null;
  /** The priority row behind `priorityRank`, for editing and removing it. */
  priority: KsiegowaniePriorytet | null;
  /** Every note on this community, newest first — open and resolved. */
  uwagi: KsiegowanieUwaga[];
  /** …of which still open: what the Converter warns about. */
  openUwagi: number;
  /** The month's statements pinned by the folder scan, with their state. */
  statements: PlikStatus[];
  /** The month's pinned PDFs. */
  pdfs: KsiegowaniePlik[];
  /** Pinned statements still waiting for a conversion — "Gotowe do zaksięgowania". */
  ready: number;
  /**
   * The PDF of each accounting file of the month, by conversion record id —
   * through its pinned statement, or matched directly when the file was made
   * from a statement the scan never pinned (converted from elsewhere).
   */
  pdfByConversionId: Map<number, KsiegowaniePlik>;
  /** Pinned statements and accounting files with no PDF beside them — "Bez PDF". */
  noPdf: number;
  /** Pinned files no converter could read (still unresolved) — part of `errors`. */
  fileErrors: KsiegowaniePlik[];
}

export interface BookingTotals {
  /** Rows on the list: every community, plus the catch-all bucket when present. */
  rows: number;
  /**
   * The month's denominator: every community on the list. That is the address
   * book, plus any community that has work this month but has since been
   * removed from the book — its work is real and still shown, so counting it
   * keeps `dom` a subset of this and the progress bar inside 100%.
   */
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
  /** Communities with a pinned statement still to convert. */
  ready: number;
  /** Communities with no pinned statement and no accounting file. */
  noFiles: number;
  /** Communities with a pinned statement that has no PDF. */
  noPdf: number;
  /**
   * Share of the communities that are fully posted in DOM (0–100).
   *
   * Communities, not files — the same unit as the tiles and the list beside it.
   * Measured against files it read "37 files, 12 posted", which answered a
   * question nobody asked: the 37 was however many statements happened to be
   * converted, so the denominator moved every time work was done and the bar
   * could sit at 100% while half the communities had nothing at all. Against
   * the address book the bar means "how much of the month is behind us", and it
   * only reaches 100% when every community is actually done.
   */
  domPercent: number;
}

function newestFirst(list: KsiegowanieUwaga[]): KsiegowanieUwaga[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
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
  priorities: KsiegowaniePriorytet[] = [],
  uwagi: KsiegowanieUwaga[] = [],
  pliki: KsiegowaniePlik[] = [],
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

  // Priorities of THIS month and every note, each under the key of its row.
  const refIndex = buildAdresIndex(adresy);
  const priorityByKey = new Map<string, KsiegowaniePriorytet>();
  for (const p of priorities) {
    if (p.monthKey !== monthKey) continue;
    const key = groupKeyOfAdresRef(p, refIndex);
    // Unique per community and month in the table; keep the first if not.
    if (!priorityByKey.has(key)) priorityByKey.set(key, p);
  }
  const uwagiByKey = new Map<string, KsiegowanieUwaga[]>();
  for (const u of uwagi) {
    const key = groupKeyOfAdresRef(u, refIndex);
    const bucket = uwagiByKey.get(key);
    if (bucket) bucket.push(u);
    else uwagiByKey.set(key, [u]);
  }
  const accountsById = new Map(adresy.map((a) => [a.id, (a.accountNumbers ?? []).length]));
  // Every pinned statement's conversion (any month), and the month's files
  // under the key of their community's row.
  const conversions = linkConversions(pliki, rows).byPlik;
  const plikiByKey = new Map<string, KsiegowaniePlik[]>();
  for (const p of pliki) {
    if (p.monthKey !== monthKey) continue;
    const key = groupKeyOfAdresRef(p, refIndex);
    const bucket = plikiByKey.get(key);
    if (bucket) bucket.push(p);
    else plikiByKey.set(key, [p]);
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
    // A failed attempt stops needing attention once the community has a file for
    // the month (generated, or already ticked in DOM): the retry worked, so the
    // old error is history. The rows stay in `rows`; only the alarm goes.
    const conversionErrors =
      bookings.length > 0
        ? 0
        : sorted.filter((r) => r.entry.status === 'error' && !r.bookedInDom).length;

    // Files pinned by the scan. An unreadable statement stops being an error the
    // same way: once a good statement of the same account is pinned too.
    const groupPliki = unassigned ? [] : plikiByKey.get(key) ?? [];
    const pdfs = groupPliki.filter((p) => p.kind === 'pdf' && p.status === 'ok');
    const statements: PlikStatus[] = groupPliki
      .filter((p) => p.kind === 'statement' && p.status === 'ok')
      .sort((a, b) => (a.periodFrom ?? '').localeCompare(b.periodFrom ?? '') || a.id - b.id)
      .map((plik) => ({
        plik,
        conversion: conversions.get(plik.id) ?? null,
        pdf: pdfForStatement(plik, pdfs),
      }));
    const accountCount = adresId != null ? (accountsById.get(adresId) ?? 0) : 0;
    const pdfByConversionId = pdfsOfConversions(statements, bookings, pdfs, accountCount === 1);
    // Accounting files with no PDF, among those not made from a pinned
    // statement (those are counted through the statement itself).
    const linked = new Set(statements.map((s) => s.conversion?.entry.id).filter((id): id is number => id != null));
    const bookingsWithoutPdf = bookings.filter(
      (r) => !linked.has(r.entry.id) && !pdfByConversionId.has(r.entry.id),
    ).length;
    const goodAccounts = new Set(statements.map((s) => s.plik.accountNumber));
    const fileErrors = groupPliki.filter(
      (p) => p.status === 'error' && !goodAccounts.has(p.accountNumber),
    );
    const errors = conversionErrors + fileErrors.length;
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
      // The rank is settled for the whole list below, once every group exists.
      priorityRank: null,
      priority: unassigned ? null : priorityByKey.get(key) ?? null,
      uwagi: unassigned ? [] : newestFirst(uwagiByKey.get(key) ?? []),
      openUwagi: unassigned ? 0 : (uwagiByKey.get(key) ?? []).filter((u) => !u.resolvedAt).length,
      statements,
      pdfs,
      ready: statements.filter((s) => !s.conversion).length,
      pdfByConversionId,
      noPdf: statements.filter((s) => !s.pdf).length + bookingsWithoutPdf,
      fileErrors,
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
    seen.add(key);
    groups.push(build(key, null, groupRows[0]?.adresNazwa ?? key, groupRows));
  }

  // Files pinned to such a community, with no conversion this month.
  for (const [key, groupPliki] of plikiByKey) {
    if (seen.has(key)) continue;
    groups.push(build(key, null, groupPliki[0]?.adresNazwa ?? key, []));
  }

  if (unassignedRows.length > 0) {
    groups.push(build('unassigned', null, '', unassignedRows, true));
  }

  // The queue's numbers: a priority's place among the ones that landed on a row
  // — so a flag on a community that has since been deleted does not leave a hole
  // in "1, 2, 4".
  groups
    .filter((g) => g.priority)
    .sort(
      (a, b) => a.priority!.position - b.priority!.position || a.priority!.id - b.priority!.id,
    )
    .forEach((g, i) => {
      g.priorityRank = i + 1;
    });

  // Communities are the unit of this screen: that is what the list shows, what a
  // filter selects, what the tiles count and what the progress bar measures. The
  // file counters (`generated`, `booked`, `todo`, `errors`) stay as they are —
  // they are the volume of work behind those communities, named as files
  // wherever they are shown. The catch-all bucket is a row, not a community, so
  // it never inflates the community counters, but its files are real accounting
  // files and do count as such.
  const communities = groups.filter((g) => !g.unassigned);
  const generated = groups.reduce((sum, g) => sum + g.generated, 0);
  const booked = groups.reduce((sum, g) => sum + g.booked, 0);

  const totals: BookingTotals = {
    rows: groups.length,
    addresses: communities.length,
    unbooked: communities.filter((g) => g.state === 'missing').length,
    waiting: communities.filter((g) => g.todo > 0).length,
    dom: communities.filter((g) => g.state === 'done').length,
    withErrors: communities.filter((g) => g.errors > 0).length,
    generated,
    booked,
    todo: generated - booked,
    errors: groups.reduce((sum, g) => sum + g.errors, 0),
    ready: communities.filter((g) => g.ready > 0).length,
    noFiles: communities.filter((g) => g.statements.length === 0 && g.generated === 0).length,
    noPdf: communities.filter((g) => g.noPdf > 0).length,
    domPercent:
      communities.length === 0
        ? 0
        : Math.round((communities.filter((g) => g.state === 'done').length / communities.length) * 100),
  };

  return { groups, totals };
}

/* -------------------------------- Filters ------------------------------- */

/**
 * The four questions the dashboard is for, plus "everything":
 *   unbooked — no accounting file this month, so nothing to post yet,
 *   waiting  — the file exists and is not (fully) ticked in DOM,
 *   dom      — every file of the community is ticked,
 *   errors   — a conversion failed (or a pinned statement is unreadable), so
 *              no file was produced at all.
 * And three about the files the folder scan pinned:
 *   ready    — a statement is pinned and waits to be converted,
 *   nofiles  — no statement pinned and nothing converted: the bank's file has
 *              not turned up yet,
 *   nopdf    — a pinned statement has no PDF beside it.
 */
export type BookingFilter =
  | 'all'
  | 'unbooked'
  | 'waiting'
  | 'dom'
  | 'errors'
  | 'ready'
  | 'nofiles'
  | 'nopdf';

/**
 * The dashboard's filter tiles, left to right, until the person arranges them:
 * the whole month, then the work in the order it is done, then the problems.
 */
export const DEFAULT_BOOKING_TILE_ORDER: readonly BookingFilter[] = [
  'all',
  'unbooked',
  'ready',
  'waiting',
  'dom',
  'nofiles',
  'nopdf',
  'errors',
];

/**
 * A saved tile order made whole: unknown ids dropped, tiles the save predates
 * appended in their default place in the order.
 */
export function resolveBookingTileOrder(saved: readonly string[] | null | undefined): BookingFilter[] {
  const known = new Set<string>(DEFAULT_BOOKING_TILE_ORDER);
  const kept = (saved ?? []).filter(
    (id, i, all): id is BookingFilter => known.has(id) && all.indexOf(id) === i,
  );
  const missing = DEFAULT_BOOKING_TILE_ORDER.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

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
    case 'ready':
      return group.ready > 0;
    case 'nofiles':
      return !group.unassigned && group.statements.length === 0 && group.generated === 0;
    case 'nopdf':
      return group.noPdf > 0;
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
    ...group.uwagi.map((u) => u.tresc),
    group.priority?.notatka ?? '',
    ...group.rows.map((r) => `${r.entry.fileName} ${r.entry.converterName} ${r.entry.outputPath}`),
    ...group.statements.map((s) => `${s.plik.fileName} ${s.plik.relPath}`),
    ...group.pdfs.map((p) => `${p.fileName} ${p.originalName ?? ''}`),
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

/**
 * Stick the priority queue on top of whatever order the list already has.
 *
 * Not a sort of its own: the chosen sort (and the order the list is being held
 * in) decides everything below the queue, and the queue — in its own order, 1st,
 * 2nd, 3rd… — sits above it. Applying it AFTER the held order is what lets a
 * flag pull a row to the top without re-sorting the rest of the list, and lets
 * an unflagged row fall back to the place it was held in.
 */
export function pinPriorities(groups: AddressBookingGroup[]): AddressBookingGroup[] {
  const queue = groups
    .filter((g) => g.priorityRank !== null)
    .sort((a, b) => a.priorityRank! - b.priorityRank!);
  if (queue.length === 0) return groups;
  return [...queue, ...groups.filter((g) => g.priorityRank === null)];
}
