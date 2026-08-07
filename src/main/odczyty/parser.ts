/**
 * Odczyty liczników — read a meter-reading workbook from one of the four
 * suppliers (PIASKAN, TECHEM, METRONA, ISTA) and normalise it into a flat list
 * of readings.
 *
 * Every supplier ships the same three facts in a different shape:
 *   - PIASKAN (.xls, legacy BIFF): "Nr Urządzenia" + six month columns headed
 *     "2026.6.30"… — the newest column holds the readings. WM = "Budynek".
 *   - TECHEM:  "Numer urządzenia" + a single date column (header is an Excel
 *     date serial). WM = "Adres".
 *   - METRONA: "Meter no." + "Reading" + a per-row "Reading date".
 *     WM is derived from "Address", which also carries the flat number.
 *   - ISTA:    "Nr urządzenia" + six month columns headed "30.06.2026"… —
 *     newest wins. WM = "Ulica"; one file per street.
 *
 * SheetJS is used rather than exceljs because PIASKAN still exports the legacy
 * .xls (OLE2/BIFF8) format, which exceljs cannot read.
 */

import * as XLSX from 'xlsx';

export type OdczytySupplierId = 'piaskan' | 'techem' | 'metrona' | 'ista';

export interface OdczytReading {
  /** Meter serial as printed by the supplier — kept verbatim. */
  deviceNumber: string;
  /** Reading date, ISO `YYYY-MM-DD`. */
  date: string;
  /** Reading value; rounding/formatting happens in the writer. */
  value: number;
  /** Housing-community name this reading belongs to (one output file each). */
  wm: string;
}

export type OdczytySkipReason = 'no-device' | 'no-value' | 'no-wm' | 'no-date';

/** A source row that produced no reading — reported so the user can go find it. */
export interface OdczytySkipped {
  /** Row number exactly as Excel shows it in the row gutter. */
  row: number;
  /** Sheet the row sits on ("Odczyty", "Braki", "Arkusz1"…). */
  sheet: string;
  reason: OdczytySkipReason;
  /** Header of the column we read and found unusable, e.g. "30.06.2026". */
  column: string;
  /** Meter serial from the row, when it has one. */
  deviceNumber: string;
  /** Community the row belongs to, when it could be determined. */
  wm: string;
  /** Locating columns copied from the row, e.g. Adres / medium / lokator. */
  context: { label: string; value: string }[];
  /**
   * Suppliers that ship six month columns sometimes leave the newest one blank
   * while an older month still holds a value — worth naming, because it tells
   * the user whether the meter is genuinely unread or just late.
   */
  fallback?: { column: string; value: string };
}

export interface OdczytyParseResult {
  supplier: OdczytySupplierId;
  supplierLabel: string;
  readings: OdczytReading[];
  skipped: OdczytySkipped[];
  /** Distinct WM names found, in first-seen order. */
  communities: string[];
  /** Newest reading date across the whole file, ISO. */
  latestDate: string | null;
}

export const SUPPLIER_LABELS: Record<OdczytySupplierId, string> = {
  piaskan: 'PIASKAN',
  techem: 'TECHEM',
  metrona: 'METRONA',
  ista: 'ISTA',
};

type Cell = string | number | boolean | Date | null;
type Row = Cell[];

/* ------------------------------------------------------------------ *
 * Cell helpers
 * ------------------------------------------------------------------ */

function asText(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).replace(/\s+/g, ' ').trim();
}

/** Case/diacritics-insensitive header comparison. */
function normHeader(cell: Cell): string {
  return asText(cell)
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findColumn(header: Row, ...candidates: string[]): number {
  const wanted = candidates.map((c) => normHeader(c));
  return header.findIndex((cell) => wanted.includes(normHeader(cell)));
}

/**
 * Excel stores dates as a day count from 1899-12-30 (the offset already absorbs
 * the fictional 1900-02-29 that Excel believes in for serials ≥ 61).
 */
function serialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 60000) return null;
  const ms = Math.round(serial) * 86400000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoFromParts(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Parse a date out of a cell that may be an Excel serial, a JS Date, or one of
 * the textual shapes the suppliers use: `2026.6.30`, `30.06.2026`, `2026-06-30`.
 */
export function parseCellDate(cell: Cell): string | null {
  if (cell === null || cell === undefined || cell === '') return null;
  if (cell instanceof Date) {
    return isoFromParts(cell.getFullYear(), cell.getMonth() + 1, cell.getDate());
  }
  if (typeof cell === 'number') return serialToISO(cell);

  const text = asText(cell);
  // Numeric string that is really a serial (some exports quote them).
  if (/^\d{4,5}$/.test(text)) return serialToISO(Number(text));

  let m = text.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/); // 2026.6.30 / 2026-06-30
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));

  m = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/); // 30.06.2026
  if (m) return isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));

  return null;
}

/**
 * Reading values arrive as numbers (TECHEM/METRONA/ISTA) or as Polish-formatted
 * strings (PIASKAN: `2,670`, occasionally with a thousands space).
 */
export function parseReadingValue(cell: Cell): number | null {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'boolean') return null;

  const text = asText(cell).replace(/ /g, '').replace(/\s/g, '');
  if (!text) return null;
  // Polish decimal comma; a dot in such a string is a thousands separator.
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ *
 * Supplier detection
 * ------------------------------------------------------------------ */

interface SheetLayout {
  sheetName: string;
  rows: Row[];
  headerIndex: number;
  header: Row;
  /** Excel row number of `rows[0]` — sheets need not start at A1. */
  firstRowNumber: number;
}

interface SupplierSpec {
  id: OdczytySupplierId;
  /** Header names identifying the meter-serial column. */
  device: string[];
  /** Header names identifying the housing-community column. */
  wm: string[];
  /** Extra header that disambiguates suppliers sharing a device column name. */
  marker: string[];
  /** Columns copied into a skipped-row report so the row is easy to locate. */
  context: string[];
}

const SUPPLIER_SPECS: SupplierSpec[] = [
  {
    id: 'metrona',
    device: ['Meter no.'],
    wm: ['Address'],
    marker: ['Reading date'],
    context: ['Address', 'Usage', 'Location no.'],
  },
  {
    id: 'techem',
    device: ['Numer urządzenia'],
    wm: ['Adres'],
    marker: ['Nr budynku'],
    context: ['Nr lokalu', 'Pomieszczenie', 'Typ urządzenia'],
  },
  {
    id: 'ista',
    device: ['Nr urządzenia'],
    wm: ['Ulica'],
    marker: ['zw/cw/co'],
    context: ['Adres', 'zw/cw/co', 'Użytkownik'],
  },
  {
    id: 'piaskan',
    device: ['Nr Urządzenia'],
    wm: ['Budynek'],
    marker: ['Grupa'],
    context: ['Lokal', 'Lokalizacja', 'Typ'],
  },
];

/** How far down a sheet we look for the header row (TECHEM starts at row 2). */
const HEADER_SCAN_ROWS = 15;

function detectInSheet(
  sheetName: string,
  rows: Row[],
  firstRowNumber: number,
): { spec: SupplierSpec; layout: SheetLayout } | null {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length);
  for (let i = 0; i < limit; i++) {
    const header = rows[i];
    if (!header) continue;
    for (const spec of SUPPLIER_SPECS) {
      const hasDevice = findColumn(header, ...spec.device) >= 0;
      const hasWm = findColumn(header, ...spec.wm) >= 0;
      const hasMarker = findColumn(header, ...spec.marker) >= 0;
      if (hasDevice && hasWm && hasMarker) {
        return {
          spec,
          layout: { sheetName, rows, headerIndex: i, header, firstRowNumber },
        };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * WM naming
 * ------------------------------------------------------------------ */

/** Longest whitespace-delimited common prefix of a set of addresses. */
function commonWordPrefix(values: string[]): string {
  if (values.length === 0) return '';
  const split = values.map((v) => v.split(' ').filter(Boolean));
  const first = split[0];
  const out: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const token = first[i];
    if (!split.every((parts) => parts[i] === token)) break;
    out.push(token);
  }
  return out.join(' ');
}

/** Address truncated after the first token containing a digit (the house number). */
function upToHouseNumber(address: string): string {
  const parts = address.split(' ').filter(Boolean);
  const idx = parts.findIndex((p) => /\d/.test(p));
  return idx < 0 ? address : parts.slice(0, idx + 1).join(' ');
}

/**
 * METRONA's "Address" column carries the flat too ("Dąbrowskiego 26 1",
 * "Dąbrowskiego 26 pralnia"), so the community name is the part all rows of one
 * building share. Rows are grouped by Property/Branch when the file provides
 * those ids; the common prefix is then taken inside each group. If the prefix
 * comes out without a house number — which means the group really does span
 * several buildings — each row falls back to "street + house number".
 */
function metronaCommunityResolver(
  rows: Row[],
  addressCol: number,
  propertyCol: number,
  branchCol: number,
): (row: Row) => string {
  const groupKey = (row: Row): string =>
    propertyCol >= 0 && branchCol >= 0
      ? `${asText(row[propertyCol])}|${asText(row[branchCol])}`
      : 'all';

  const byGroup = new Map<string, string[]>();
  for (const row of rows) {
    const address = asText(row[addressCol]);
    if (!address) continue;
    const key = groupKey(row);
    const list = byGroup.get(key) ?? [];
    list.push(address);
    byGroup.set(key, list);
  }

  const names = new Map<string, string>();
  for (const [key, addresses] of byGroup) {
    const distinct = [...new Set(addresses)];
    // With a single distinct address there is nothing to intersect — the prefix
    // would keep the flat number, so cut at the house number instead.
    const candidate =
      distinct.length > 1 ? commonWordPrefix(distinct) : upToHouseNumber(distinct[0]);
    const prefix = candidate.replace(/[\s,/-]+$/, '');
    names.set(key, /\d/.test(prefix) ? prefix : '');
  }

  return (row: Row) => {
    const address = asText(row[addressCol]);
    if (!address) return '';
    return names.get(groupKey(row)) || upToHouseNumber(address);
  };
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

interface DateColumn {
  index: number;
  date: string;
}

/** Date-headed reading columns to the right of the device column, newest first. */
function findDateColumns(header: Row, afterCol: number): DateColumn[] {
  const cols: DateColumn[] = [];
  for (let i = afterCol + 1; i < header.length; i++) {
    const date = parseCellDate(header[i]);
    if (date) cols.push({ index: i, date });
  }
  return cols.sort((a, b) => b.date.localeCompare(a.date));
}

function parseSheet(
  spec: SupplierSpec,
  layout: SheetLayout,
  readings: OdczytReading[],
  skipped: OdczytySkipped[],
): void {
  const { header, headerIndex, rows, sheetName, firstRowNumber } = layout;
  const deviceCol = findColumn(header, ...spec.device);
  const wmCol = findColumn(header, ...spec.wm);
  const dataRows = rows.slice(headerIndex + 1);

  // Which column holds the value, and where the date comes from.
  let valueCol = -1;
  let fixedDate: string | null = null;
  let dateCol = -1; // per-row date (METRONA only)
  let olderColumns: DateColumn[] = [];

  if (spec.id === 'metrona') {
    valueCol = findColumn(header, 'Reading');
    dateCol = findColumn(header, 'Reading date');
  } else {
    const dateColumns = findDateColumns(header, deviceCol);
    if (dateColumns.length === 0) return; // sheet has no reading columns at all
    valueCol = dateColumns[0].index;
    fixedDate = dateColumns[0].date;
    olderColumns = dateColumns.slice(1);
  }
  if (valueCol < 0) return;

  const valueColumnLabel = asText(header[valueCol]) || fixedDate || '';

  const contextCols = spec.context
    .map((name) => ({ label: name, index: findColumn(header, name) }))
    .filter((c) => c.index >= 0);

  const communityOf =
    spec.id === 'metrona'
      ? metronaCommunityResolver(
          dataRows,
          wmCol,
          findColumn(header, 'Property no.'),
          findColumn(header, 'Branch no.'),
        )
      : (row: Row) => asText(row[wmCol]);

  /** Newest older month that still holds a value — explains a blank newest column. */
  const findFallback = (row: Row): { column: string; value: string } | undefined => {
    for (const col of olderColumns) {
      const value = parseReadingValue(row[col.index]);
      if (value !== null) {
        return { column: asText(header[col.index]) || col.date, value: asText(row[col.index]) };
      }
    }
    return undefined;
  };

  dataRows.forEach((row, i) => {
    if (!row || row.every((c) => asText(c) === '')) return;
    const rowNumber = firstRowNumber + headerIndex + 1 + i;

    const deviceNumber = asText(row[deviceCol]);
    const wm = communityOf(row);
    const base = {
      row: rowNumber,
      sheet: sheetName,
      column: valueColumnLabel,
      deviceNumber,
      wm,
      context: contextCols.map((c) => ({ label: c.label, value: asText(row[c.index]) })),
    };

    if (!deviceNumber) {
      skipped.push({ ...base, reason: 'no-device' });
      return;
    }
    if (!wm) {
      skipped.push({ ...base, reason: 'no-wm', column: asText(header[wmCol]) || '' });
      return;
    }
    const value = parseReadingValue(row[valueCol]);
    if (value === null) {
      skipped.push({ ...base, reason: 'no-value', fallback: findFallback(row) });
      return;
    }
    const date = dateCol >= 0 ? parseCellDate(row[dateCol]) : fixedDate;
    if (!date) {
      skipped.push({
        ...base,
        reason: 'no-date',
        column: dateCol >= 0 ? asText(header[dateCol]) : valueColumnLabel,
      });
      return;
    }

    readings.push({ deviceNumber, date, value, wm });
  });
}

/**
 * Read a supplier workbook and return every reading it contains. Throws when the
 * file matches none of the four known layouts.
 */
export function parseOdczytyFile(filePath: string): OdczytyParseResult {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: true });

  let supplier: SupplierSpec | null = null;
  const readings: OdczytReading[] = [];
  const skipped: OdczytySkipped[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    // blankrows must stay on: dropping empty rows would shift every index and
    // the row numbers we report would no longer match the source sheet.
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    // A sheet's used range need not start at A1, so anchor row numbers to it.
    const ref = sheet['!ref'];
    const firstRowNumber = ref ? XLSX.utils.decode_range(ref).s.r + 1 : 1;
    const detected = detectInSheet(sheetName, rows, firstRowNumber);
    if (!detected) continue;
    // A workbook is single-supplier; ignore sheets that claim a different one.
    if (supplier && detected.spec.id !== supplier.id) continue;
    supplier = detected.spec;
    parseSheet(detected.spec, detected.layout, readings, skipped);
  }

  if (!supplier) {
    throw new Error(
      'Nie rozpoznano formatu pliku. Obsługiwane są odczyty od: PIASKAN, TECHEM, METRONA, ISTA.',
    );
  }

  const communities: string[] = [];
  for (const r of readings) {
    if (!communities.includes(r.wm)) communities.push(r.wm);
  }
  const latestDate = readings.reduce<string | null>(
    (max, r) => (max === null || r.date > max ? r.date : max),
    null,
  );

  return {
    supplier: supplier.id,
    supplierLabel: SUPPLIER_LABELS[supplier.id],
    readings,
    skipped,
    communities,
    latestDate,
  };
}
