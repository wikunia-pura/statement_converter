/**
 * "Znajdź pliki księgowe" — the pure half of the folder scan.
 *
 * The scan walks the statements folder (Settings → Folder z wyciągami), finds
 * the statement files and PDFs of ONE month and pins each to its community,
 * account and period. The walking, reading and renaming happen in the main
 * process (`main/statementScanner.ts`); everything that can be decided from
 * text alone lives here, dependency-free, so the renderer can reuse the
 * pairing and naming rules and the rules stay readable in one place.
 *
 * Nothing here guesses. A file that does not say plainly which account and
 * which days it covers is reported as unrecognized and left to the user —
 * the same stance the converters take on damaged bank text.
 */

import { normalizeAccount } from './account-extractor';
import { sanitizeForFilename } from './outputPaths';
import type { Adres, KontoTyp, KsiegowaniePlik } from './types';

/* ----------------------------- Formats & banks ----------------------------- */

/** The MT940 dialects — one layout, told apart only by the bank. */
const MT940_FAMILY = ['pko_mt940', 'ing', 'alior', 'pocztowy'];
/** ISO 20022 camt — BNP sends statements (053), BOŚ account reports (052). */
const CAMT_FAMILY = ['bnp_xml', 'bos_xml'];

/**
 * Which converters can read a text file, judged from its first bytes; null when
 * it is not a statement any converter knows. A family of several means the
 * layout is shared and the bank decides (see `pickConverter`).
 *
 * Zips are not judged here — what is inside decides, and that needs the
 * archive opened (main process).
 */
export function sniffTextFormat(head: string): string[] | null {
  if (head.includes('#SALDO#')) return ['pko_sa'];
  if (/<\?xml|<Document[\s>]/i.test(head)) {
    if (/camt\.05[23]|<BkToCstmr(Stmt|AcctRpt)/i.test(head)) return CAMT_FAMILY;
    if (/<statement[\s>]/i.test(head) || /<exe-date>/i.test(head)) return ['santander_xml'];
    return null;
  }
  if (/:20:/.test(head) && /:25:/.test(head) && /:(60F|61):/.test(head)) return MT940_FAMILY;
  return null;
}

/** An ELIXIR row as PKO Biznes exports it: `111,20260213,55677,…`. */
export function looksLikeElixir(text: string): boolean {
  return /^\s*\d{3},\d{8},/.test(text);
}

/** An MT940 file inside a zip (daily MT940 reports) — no converter reads the archive. */
export function looksLikeMt940(text: string): boolean {
  return /:20:/.test(text) && /:25:/.test(text);
}

/**
 * The bank's sorting code (cyfry 3–6 numeru NRB). Only used to choose between
 * converters that read the same layout — never to recognise a community.
 */
export function bankCodeOf(account: string): string {
  return account.slice(2, 6);
}

const CONVERTER_BY_BANK_CODE: Record<string, string> = {
  '1020': 'pko_mt940', // PKO BP
  '1050': 'ing', // ING Bank Śląski
  '2490': 'alior', // Alior Bank
  '1320': 'pocztowy', // Bank Pocztowy
  '1540': 'bos_xml', // Bank Ochrony Środowiska
  '1600': 'bnp_xml', // BNP Paribas
  '1750': 'bnp_xml', // BNP Paribas (dawny Raiffeisen)
  '2030': 'bnp_xml', // BNP Paribas (dawny BGŻ)
};

/**
 * The converter for a file whose layout `sniffTextFormat` narrowed to a family.
 * The community's own bank link wins (the user set it); otherwise the bank code
 * in the account number decides. Null when neither settles it.
 */
export function pickConverter(
  family: string[],
  account: string,
  adresBankConverterId: string | null,
): string | null {
  if (family.length === 1) return family[0];
  if (adresBankConverterId && family.includes(adresBankConverterId)) return adresBankConverterId;
  const byCode = CONVERTER_BY_BANK_CODE[bankCodeOf(account)];
  return byCode && family.includes(byCode) ? byCode : null;
}

/* ---------------------------------- Dates ---------------------------------- */

function isoOf(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(y, m, 0).getDate();
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A transaction date in any of the shapes the converters hand back — `YYMMDD`
 * (MT940), `YYYYMMDD`, `YYYY-MM-DD[T…]`, `DD.MM.YYYY`, `DD/MM/YYYY`,
 * `YYYY.MM.DD` — as ISO `YYYY-MM-DD`, or null.
 */
export function parseLooseDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[T\s])/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?:$|\s)/);
  if (m) return isoOf(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return isoOf(2000 + +m[1], +m[2], +m[3]);
  return null;
}

/** `YYYY-MM` of an ISO date. */
export function monthOfIso(iso: string): string {
  return iso.slice(0, 7);
}

export interface StatementPeriod {
  from: string;
  to: string;
  /** The month the statement belongs to. */
  monthKey: string;
}

/**
 * The period a statement covers, read from its transaction dates: first and
 * last day, and the month most of them fall in. The majority — not the last
 * date — because a value date can spill a day into the next month, and that
 * must not move an August statement to September. A tie goes to the earlier
 * month.
 */
export function periodOfDates(isoDates: (string | null)[]): StatementPeriod | null {
  const dates = isoDates.filter((d): d is string => !!d).sort();
  if (dates.length === 0) return null;
  const perMonth = new Map<string, number>();
  for (const d of dates) perMonth.set(monthOfIso(d), (perMonth.get(monthOfIso(d)) ?? 0) + 1);
  const monthKey = [...perMonth.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return { from: dates[0], to: dates[dates.length - 1], monthKey };
}

/** The month holding most days of a stated range (a PDF's "za okres …"). */
export function monthOfRange(from: string, to: string): string {
  const perMonth = new Map<string, number>();
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (d <= end) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
    d.setDate(d.getDate() + 1);
  }
  const best = [...perMonth.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : monthOfIso(from);
}

/**
 * Every date written in a file's text, for the month of a file no converter
 * could read (or that belongs to no community): written-out dates, plus the
 * MT940 balance and entry tags (`:60F:C260831`, `:61:260828…`).
 */
export function datesInText(text: string): string[] {
  const out: string[] = [];
  const re = /(?<!\d)(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4})(?!\d)/g;
  for (const m of text.matchAll(re)) {
    const iso = parseLooseDate(m[1]);
    if (iso) out.push(iso);
  }
  for (const m of text.matchAll(/:(?:6[02][FM]:[CD]|61:)(\d{6})/g)) {
    const iso = parseLooseDate(m[1]);
    if (iso) out.push(iso);
  }
  return out;
}

/** The first day and the last day of one month. */
export function isFullMonth(from: string, to: string): boolean {
  if (monthOfIso(from) !== monthOfIso(to) || !from.endsWith('-01')) return false;
  const [y, m] = from.split('-').map(Number);
  return to === isoOf(y, m, new Date(y, m, 0).getDate());
}

export function periodsOverlap(
  a: { periodFrom: string | null; periodTo: string | null },
  b: { periodFrom: string | null; periodTo: string | null },
): boolean {
  if (!a.periodFrom || !a.periodTo || !b.periodFrom || !b.periodTo) return false;
  return a.periodFrom <= b.periodTo && b.periodFrom <= a.periodTo;
}

function overlapDays(
  a: { periodFrom: string | null; periodTo: string | null },
  b: { periodFrom: string | null; periodTo: string | null },
): number {
  if (!periodsOverlap(a, b)) return 0;
  const from = a.periodFrom! > b.periodFrom! ? a.periodFrom! : b.periodFrom!;
  const to = a.periodTo! < b.periodTo! ? a.periodTo! : b.periodTo!;
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

/* ----------------------------------- PDF ----------------------------------- */

export type PdfHeaderProblem = 'no-text' | 'no-account' | 'unknown-account' | 'ambiguous-account' | 'no-period';

export interface PdfHeader {
  account: string | null;
  period: { from: string; to: string } | null;
  /** Which statement of the period was used — kept for the scan's diagnostics. */
  periodSource: 'okres' | 'columns' | 'statement-dates' | 'balances' | 'month' | 'range' | null;
  problem: PdfHeaderProblem | null;
  /** The account numbers behind `unknown-account` / `ambiguous-account`. */
  accounts: string[];
}

/** A Polish account number as statements print it: grouped, glued or with PL. */
const ACCOUNT_RE = /(?<!\d)(?:PL\s?)?(\d{2}(?:\s?\d{4}){6})(?!\d)/g;
/** The words a statement header puts next to the statement's own account. */
/**
 * The labels a statement header puts in front of the statement's OWN account:
 * "Numer rachunku" (BOŚ, BNP, Pocztowy), "Nr rachunku/karty" (PKO BP), "Nr
 * rachunku/NRB" (ING), "NR RACHUNKU" (Erste), "IBAN" (Alior). Specific on
 * purpose — a bare "rachunek" also turns up in transaction titles.
 */
const OWN_ACCOUNT_LABEL = /(numer|nr)\s*(rachunku|konta)|\biban\b|\bnrb\b/i;
/** A sub-account the statement merely mentions (split payment), never its own. */
const VAT_ACCOUNT_LABEL = /\bvat\b/i;
/** How far above an account number its label may stand (PDF text comes out in drawing order). */
const LABEL_LINES_ABOVE = 3;
const DATE = String.raw`(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4})`;
const RANGE_RE = new RegExp(`${DATE}\\s*(?:-|–|—|do)\\s*${DATE}`, 'gi');

/**
 * Which account and which days a statement PDF covers, read from the text of
 * its first page.
 *
 * The account must be one of the communities' accounts. A page can show
 * several — the transactions list counterparties, and a transfer between a
 * community's two accounts puts the other one on the page too — so when it
 * does, only a number printed on a line naming the account ("Numer rachunku",
 * "IBAN") counts. Still more than one, or none: the PDF is left to the user.
 *
 * The period is the first date range on the page, preferring one on a line
 * that says "okres". A range longer than a quarter is not a statement period.
 */
export function readPdfHeader(firstPageText: string, knownAccounts: Set<string>): PdfHeader {
  // PDFs often draw hyphens as soft or non-breaking ones (Erste writes
  // "2026­09­30" with U+00AD), and spaces as non-breaking ones.
  const text = (firstPageText ?? '').replace(/[\u00AD\u2010\u2011]/g, '-').replace(/\u00A0/g, ' ');
  if (text.replace(/\s+/g, '').length < 20) {
    return { account: null, period: null, periodSource: null, problem: 'no-text', accounts: [] };
  }
  const lines = text.split(/\r?\n/);

  // The statement's own account is the one printed at a label ("Numer
  // rachunku", "IBAN"…) — whether or not it is in the address book. Accounts
  // with no label are counterparties, and among them can be the community's
  // other account (a transfer between its own accounts), so they only count
  // when no account on the page carries a label at all.
  const labelledKnown: string[] = [];
  const labelledUnknown: string[] = [];
  const seen: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(ACCOUNT_RE)) {
      const acc = normalizeAccount(m[1]);
      if (!acc) continue;
      const above = lines.slice(Math.max(0, i - LABEL_LINES_ABOVE), i + 1).join(' ');
      // The split-payment VAT sub-account (Alior prints it under "Nr Rachunku VAT").
      if (VAT_ACCOUNT_LABEL.test(lines.slice(Math.max(0, i - 2), i + 1).join(' '))) continue;
      const labelled = OWN_ACCOUNT_LABEL.test(above);
      if (knownAccounts.has(acc)) {
        if (!seen.includes(acc)) seen.push(acc);
        if (labelled && !labelledKnown.includes(acc)) labelledKnown.push(acc);
      } else if (labelled && !labelledUnknown.includes(acc)) {
        labelledUnknown.push(acc);
      }
    }
  });

  let account: string | null = null;
  let problem: PdfHeaderProblem | null = null;
  let accounts: string[] = [];
  if (labelledKnown.length === 1) account = labelledKnown[0];
  else if (labelledKnown.length > 1) {
    problem = 'ambiguous-account';
    accounts = labelledKnown;
  } else if (labelledUnknown.length > 0) {
    // The statement names its own account and it is not in the address book —
    // say so, rather than settling for an account seen in a transfer.
    problem = 'unknown-account';
    accounts = labelledUnknown;
  } else if (seen.length === 1) account = seen[0];
  else if (seen.length > 1) {
    problem = 'ambiguous-account';
    accounts = seen;
  } else problem = 'no-account';

  let period: { from: string; to: string } | null = null;
  const ranges: { from: string; to: string; onPeriodLine: boolean }[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(RANGE_RE)) {
      const from = parseLooseDate(m[1]);
      const to = parseLooseDate(m[2]);
      if (!from || !to || from > to) continue;
      if (Date.parse(to) - Date.parse(from) > 92 * 86_400_000) continue;
      // The label can sit a few lines above its value: a PDF's text comes out
      // in drawing order, and Alior prints "Wyciąg za okres:" in one column and
      // "2026.09.01 - 2026.09.30" below the next label.
      const near = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
      ranges.push({ from, to, onPeriodLine: /okres/i.test(near) });
    }
  });
  // Banks state the period in one of three ways: a range ("za okres 01.08.2026
  // - 31.08.2026"), the opening and closing balance dates ("Saldo początkowe
  // (01.09.2026)" … "Saldo końcowe (30.09.2026)" — BNP), or the month itself
  // ("za miesiąc 09.2026"). An explicit "okres" range wins, then the balances,
  // then the month, and only then any other range on the page.
  const opening = text.match(new RegExp(`saldo\\s+pocz\\S*\\D{0,24}?${DATE}`, 'i'));
  const closing = text.match(new RegExp(`saldo\\s+ko[nń]c\\S*\\D{0,24}?${DATE}`, 'i'));
  const balanceFrom = opening ? parseLooseDate(opening[1]) : null;
  const balanceTo = closing ? parseLooseDate(closing[1]) : null;
  const month = text.match(/za\s+miesi[aą]c\s+(\d{1,2})[./-](\d{4})/i);
  // ING: no period, but "Data wyciągu: 30.09.2026" and "Data poprzedniego
  // wyciągu: 31.08.2026" — the statement covers the days in between.
  const previous = text.match(new RegExp(`data\\s+poprzedniego\\s+wyci[aą]gu\\s*:?\\s*${DATE}`, 'i'));
  const issued = text.match(new RegExp(`(?<!poprzedniego\\s)data\\s+wyci[aą]gu\\s*:?\\s*${DATE}`, 'i'));
  const previousDay = previous ? parseLooseDate(previous[1]) : null;
  const issuedDay = issued ? parseLooseDate(issued[1]) : null;
  const sincePrevious =
    previousDay && issuedDay && previousDay < issuedDay ? { from: nextDay(previousDay), to: issuedDay } : null;
  // Erste: a header row "DATA WYCIĄGU | WYCIĄG OD | DO | NR WYCIĄGU" over a row
  // of values that come out glued ("2026-09-302026-09-012026-09-30").
  const columns = periodFromOdDoColumns(lines);
  let periodSource: PdfHeader['periodSource'] = null;
  const best = ranges.find((r) => r.onPeriodLine);
  if (best) {
    period = { from: best.from, to: best.to };
    periodSource = 'okres';
  } else if (columns) {
    period = columns;
    periodSource = 'columns';
  } else if (sincePrevious && spanDays(sincePrevious.from, sincePrevious.to) <= 92) {
    period = sincePrevious;
    periodSource = 'statement-dates';
  } else if (balanceFrom && balanceTo && balanceFrom <= balanceTo) {
    period = { from: balanceFrom, to: balanceTo };
    periodSource = 'balances';
  } else if (month) {
    const [y, m] = [Number(month[2]), Number(month[1])];
    const from = isoOf(y, m, 1);
    const to = isoOf(y, m, new Date(y, m, 0).getDate());
    if (from && to) {
      period = { from, to };
      periodSource = 'month';
    }
  }
  if (!period && ranges[0]) {
    period = { from: ranges[0].from, to: ranges[0].to };
    periodSource = 'range';
  }
  if (!period && !problem) problem = 'no-period';

  return { account, period, periodSource, problem, accounts };
}

/**
 * Whether an unreadable PDF is worth a line in the scan report. The statements
 * folder also holds other PDFs — charts of accounts, scanned advance-payment
 * summaries — and listing them on every scan would bury the real misses. A PDF
 * counts as a statement that failed when its text says so, or (with no text at
 * all) when its name looks like a statement's.
 */
export function looksLikeStatementPdf(fileName: string, text: string): boolean {
  if (/wyci[aą]g\s+(nr|numer|bankow|z\s+rachunku|za)|saldo\s+pocz|saldo\s+ko[nń]c|za\s+okres|historia\s+rachunku/i.test(text)) {
    return true;
  }
  if (text.replace(/\s+/g, '').length >= 20) return false;
  return /wyci[aą]g|statement|operacje|\bbnk\b|^wb[\s_]|\d{12,}/i.test(fileName);
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * A header row naming the period's columns — "WYCIĄG OD … DO" — with the values
 * on one of the next lines, possibly glued together. The dates are read in
 * the columns' order; a "DATA WYCIĄGU" column before "OD" shifts them by one.
 */
function periodFromOdDoColumns(lines: string[]): { from: string; to: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i];
    if (!/wyci[aą]g\s*od\s*do/i.test(label)) continue;
    const offset = /data\s*wyci[aą]gu.*od\s*do/i.test(label) ? 1 : 0;
    for (const valueLine of lines.slice(i + 1, i + 3)) {
      const dates = [...valueLine.matchAll(/(\d{4}[-./]\d{2}[-./]\d{2}|\d{2}[-./]\d{2}[-./]\d{4})/g)]
        .map((m) => parseLooseDate(m[1]))
        .filter((d): d is string => !!d);
      if (dates.length < offset + 2) continue;
      const from = dates[offset];
      const to = dates[offset + 1];
      if (from <= to && spanDays(from, to) <= 92) return { from, to };
    }
  }
  return null;
}

/* ------------------------------ Names & types ------------------------------ */

/** The account type a community's account is booked as — its own, else the default. */
export function accountTypeNameOf(adres: Adres, account: string, kontoTypy: KontoTyp[]): string | null {
  const typeId = adres.accountTypes?.[account];
  const type =
    (typeId != null ? kontoTypy.find((k) => k.id === typeId) : undefined) ??
    kontoTypy.find((k) => k.isDefault) ??
    kontoTypy[0];
  return type?.name ?? null;
}

/**
 * The month a period stands for in a name: one it covers entirely, spilling
 * over by at most three days — ING closes September's statement "since the
 * previous one of 30.08", so it runs 31.08–30.09 and is still September's.
 * Null for part of a month.
 */
export function monthCovered(from: string, to: string): string | null {
  const month = monthOfRange(from, to);
  const [y, m] = month.split('-').map(Number);
  const first = isoOf(y, m, 1)!;
  const last = isoOf(y, m, new Date(y, m, 0).getDate())!;
  if (from > first || to < last) return null;
  const spill = spanDays(from, first) + spanDays(last, to);
  return spill <= 3 ? month : null;
}

/**
 * The name a recognised statement PDF is given:
 * `Pulawska_116_Eksploatacja_2026-08.pdf` for a whole month,
 * `Pulawska_116_Eksploatacja_2026-08-01_2026-08-15.pdf` for part of one.
 * `accountSuffix` (the account's last digits) tells two accounts of the same
 * type apart: `Modzelewskiego_52_Eksploatacja_4963_2026-09.pdf`.
 */
export function pdfTargetName(
  adresNazwa: string,
  accountTypeName: string | null,
  from: string,
  to: string,
  accountSuffix?: string | null,
): string {
  const parts = [sanitizeForFilename(adresNazwa)];
  if (accountTypeName) parts.push(sanitizeForFilename(accountTypeName));
  if (accountSuffix) parts.push(accountSuffix);
  parts.push(monthCovered(from, to) ?? `${from}_${to}`);
  return `${parts.filter(Boolean).join('_')}.pdf`;
}

/**
 * The last four digits of the account, when the community has another account
 * of the same type — the only case where the type alone does not name it.
 */
export function accountSuffixFor(adres: Adres, account: string, kontoTypy: KontoTyp[]): string | null {
  const type = accountTypeNameOf(adres, account, kontoTypy);
  const sameType = (adres.accountNumbers ?? [])
    .map(normalizeAccount)
    .filter((acc): acc is string => !!acc && acc !== account)
    .some((acc) => accountTypeNameOf(adres, acc, kontoTypy) === type);
  return sameType ? account.slice(-4) : null;
}

/* --------------------------------- Pairing --------------------------------- */

function sameCommunity(a: KsiegowaniePlik, b: KsiegowaniePlik): boolean {
  if (a.adresId != null && b.adresId != null) return a.adresId === b.adresId;
  return a.adresNazwa.trim().toLowerCase() === b.adresNazwa.trim().toLowerCase();
}

/**
 * The PDF that goes with a statement file: same community and account, and the
 * period overlapping most. One monthly PDF can serve several daily statements.
 */
export function pdfForStatement(statement: KsiegowaniePlik, pliki: KsiegowaniePlik[]): KsiegowaniePlik | null {
  let best: KsiegowaniePlik | null = null;
  let bestDays = 0;
  for (const p of pliki) {
    if (p.kind !== 'pdf' || p.status !== 'ok') continue;
    if (p.accountNumber !== statement.accountNumber || !sameCommunity(p, statement)) continue;
    const days = overlapDays(p, statement);
    if (days > bestDays) {
      best = p;
      bestDays = days;
    }
  }
  return best;
}

/**
 * An absolute path from the scan folder and a stored relative one. Relative
 * paths are stored with `/`, so the same row opens on a Mac and on Windows,
 * whatever drive letter or mount point the shared folder has there.
 */
export function joinScanPath(root: string, relPath: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  return `${base}${sep}${relPath.split('/').join(sep)}`;
}
