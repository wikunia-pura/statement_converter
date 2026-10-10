/**
 * "Znajdź pliki księgowe" — the folder scan, main-process half.
 *
 * Walks the statements folder (Settings → "Folder z wyciągami") recursively,
 * whatever its layout (today bank/month subfolders, tomorrow maybe not), and
 * pins the statements and PDFs of ONE month to their communities:
 *
 *   statement — recognised by content (format → converter, the "our account"
 *               line → community, the transaction dates → period), exactly
 *               the way a file dropped into the Converter is recognised;
 *   PDF       — recognised from the text of its first page (account + "za
 *               okres"), no AI.
 *
 * Both are renamed in place to `<adres>_<typ konta>_<RRRR-MM>.<rozszerzenie>`
 * once recognised (a statement keeps its extension).
 *
 * A newer file for something already pinned is never swapped in on its own:
 * it comes back as a conflict, and the user decides (`resolveScanConflicts`).
 * A file that does not say plainly what it is goes to the report as
 * unrecognized — nothing here guesses.
 *
 * The pure rules (formats, dates, PDF header, names) live in
 * `shared/statement-scan.ts`; this file only reads, hashes and renames.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import type {
  Adres,
  Bank,
  ConversionHistory,
  KontoTyp,
  KsiegowaniePlik,
  ScanConflict,
  ScanDecision,
  ScanFoundFile,
  ScanProblem,
  ScanProgress,
  ScanReport,
  ScanUnrecognized,
} from '../shared/types';
import { extractAccountNumbersFromFile } from '../shared/account-extractor-node';
import { findAdresByAccountNumbers, formatAccount, normalizeAccount } from '../shared/account-extractor';
import { readFileWithEncoding, readStatementText } from '../shared/encoding';
import {
  accountSuffixFor,
  accountTypeNameOf,
  datesInText,
  looksLikeElixir,
  looksLikeStatementPdf,
  looksLikeMt940,
  monthOfRange,
  parseLooseDate,
  periodOfDates,
  periodsOverlap,
  pickConverter,
  readPdfHeader,
  scanTargetName,
  sniffTextFormat,
} from '../shared/statement-scan';
import { linkConversions, toBookingRows } from '../shared/bookings';
import type { BaseConverter } from '../shared/base-converter';
import { SantanderXmlConverter } from '../converters/santander-xml';
import { PKOBPMT940Converter } from '../converters/pko-mt940';
import { BnpXmlConverter } from '../converters/bnp-xml';
import { BosXmlConverter } from '../converters/bos-xml';
import { AliorConverter } from '../converters/alior';
import { PKOBiznesConverter } from '../converters/pko-biznes';
import { PKOSAConverter } from '../converters/pko-sa';
import { INGConverter } from '../converters/ing';
import { PocztowyConverter } from '../converters/pocztowy';

/** The persistence the scan needs — `DatabaseService` satisfies it. */
export interface ScanStore {
  addKsiegowaniePlik(p: PlikDraft): Promise<KsiegowaniePlik>;
  replaceKsiegowaniePlik(id: number, p: PlikDraft): Promise<KsiegowaniePlik>;
  setKsiegowaniePlikIgnored(id: number, hashes: string[]): Promise<void>;
}

type PlikDraft = Omit<KsiegowaniePlik, 'id' | 'scannedAt'>;

export interface ScanInput {
  root: string;
  monthKey: string;
  adresy: Adres[];
  banks: Bank[];
  kontoTypy: KontoTyp[];
  history: ConversionHistory[];
  /** Everything pinned for the month so far. */
  existing: KsiegowaniePlik[];
  scannedBy: string;
  onProgress?: (p: ScanProgress) => void;
}

/** Larger than any statement; skipping it keeps a stray video from being hashed. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const HEAD_BYTES = 64 * 1024;
/** Never statements: office documents, images, mail, media, other archives. */
const NOT_STATEMENTS = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ods', '.odt', '.ppt', '.pptx', '.rtf',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.svg', '.webp',
  '.msg', '.eml', '.mp3', '.mp4', '.mov', '.avi', '.wav', '.rar', '.7z', '.gz', '.tar',
  '.exe', '.dll', '.lnk', '.ini', '.db', '.ds_store', '.json', '.html', '.htm',
]);

/** What a file turned out to be. */
type Classified =
  | { type: 'candidate'; c: Candidate }
  | { type: 'other-month' }
  | { type: 'ignore' }
  | { type: 'unrecognized'; item: ScanUnrecognized };

interface Candidate {
  absPath: string;
  draft: PlikDraft;
  /** PDFs: the name to give the file once it is pinned. */
  targetName: string | null;
}

/**
 * Conflicts of the last scan, waiting for the user's decision. Kept here (not
 * round-tripped through the renderer) so a decision can only ever apply what
 * the scan actually found. A new scan replaces them.
 */
const pendingConflicts = new Map<string, { c: Candidate; existing: KsiegowaniePlik }>();

/* --------------------------------- Walking --------------------------------- */

interface FoundOnDisk {
  absPath: string;
  relPath: string;
  size: number;
  mtime: Date;
}

/**
 * Every file under `root` changed on or after `since`. A statement for a month
 * cannot exist before that month began, so anything older is skipped without
 * being opened — the folder holds years of history, and the scan reads one month.
 */
async function walk(root: string, since: Date, onCount: (n: number) => void): Promise<FoundOnDisk[]> {
  const out: FoundOnDisk[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    await yieldToEventLoop();
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable subfolder — the rest of the tree still counts
    }
    const unpacked = unpackedFolderTest(entries);
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') || name.startsWith('~$')) continue;
      const absPath = path.join(dir, name);
      if (entry.isDirectory()) {
        if (!unpacked(name)) stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (NOT_STATEMENTS.has(path.extname(name).toLowerCase())) continue;
      try {
        const stat = await fs.promises.stat(absPath);
        if (stat.size === 0 || stat.size > MAX_FILE_BYTES || stat.mtime < since) continue;
        out.push({
          absPath,
          relPath: path.relative(root, absPath).split(path.sep).join('/'),
          size: stat.size,
          mtime: stat.mtime,
        });
        onCount(out.length);
      } catch {
        /* vanished or unreadable — skip */
      }
    }
  }
  return out;
}

/**
 * Folders that are an archive lying beside them, unpacked: `Raporty_MT940_….zip`
 * opened in Finder becomes `Raporty_MT940_…/` (or `Raporty_MT940_… 2/` when that
 * name is taken). The archive is the statement; its unpacked daily files would
 * be pinned a second time and converted twice, so the walk does not go in.
 */
function unpackedFolderTest(entries: fs.Dirent[]): (folder: string) => boolean {
  const stems = new Set(
    entries
      .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === '.zip')
      .map((e) => e.name.slice(0, -4).toLowerCase()),
  );
  if (stems.size === 0) return () => false;
  return (folder) => {
    const name = folder.toLowerCase();
    return stems.has(name) || stems.has(name.replace(/ \d+$/, ''));
  };
}

/**
 * Let the main process breathe. Most of a file's work here is synchronous
 * (reading, XML and PDF parsing), and a main process that never yields stalls
 * the window itself — the dialog's spinner and progress would not be painted
 * until the scan was over.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The file's SHA-1 — `KsiegowaniePlik.fileHash`, and the conversion's `inputHash`. */
export async function sha1(absPath: string): Promise<string> {
  return crypto.createHash('sha1').update(await fs.promises.readFile(absPath)).digest('hex');
}

async function readHead(absPath: string): Promise<Buffer> {
  const handle = await fs.promises.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Readable either way — formats and dates are ASCII, the encoding only matters for words. */
function decodeHead(buf: Buffer): string {
  const utf = buf.toString('utf8');
  return utf.includes('�') ? iconv.decode(buf, 'windows-1250') : utf;
}

/* ------------------------------ Statement files ----------------------------- */

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

interface ZipLook {
  family: string[] | null;
  /** Daily MT940 reports packed together — recognisable, not convertible. */
  mt940: boolean;
  /** Accounts and days the entry names carry (`MT940_<konto>_<RRRRMMDD>.txt`). */
  accounts: string[];
  dates: string[];
}

/** The converter family of a zip, judged from its first text entry. */
function lookIntoZip(absPath: string): ZipLook {
  const none: ZipLook = { family: null, mt940: false, accounts: [], dates: [] };
  try {
    const entries = new AdmZip(absPath).getEntries().filter((e) => !e.isDirectory && /\.(txt|csv)$/i.test(e.entryName));
    if (entries.length === 0) return none;
    const text = entries[0].getData().subarray(0, 4096).toString('latin1');
    if (looksLikeElixir(text)) return { ...none, family: ['pko_biznes'] };
    if (!looksLikeMt940(text)) return none;
    const accounts = new Set<string>();
    const dates: string[] = [];
    for (const e of entries) {
      for (const m of e.entryName.matchAll(/(?<!\d)(\d{26}|\d{8})(?!\d)/g)) {
        if (m[1].length === 26) accounts.add(m[1]);
        else {
          const iso = parseLooseDate(m[1]);
          if (iso) dates.push(iso);
        }
      }
    }
    return { family: null, mt940: true, accounts: [...accounts], dates };
  } catch {
    return none;
  }
}

/** The MT940 dialects — one layout, told apart only by the bank (see `pickConverter`). */
const MT940_FAMILY = ['pko_mt940', 'ing', 'alior', 'pocztowy'];

/** Formats whose "our account" is the FIRST account in the file — the rest are counterparties. */
const OWNER_FIRST = new Set(['bnp_xml', 'bos_xml', 'santander_xml']);

/** A converter good for parsing only: no AI, no contractors, no caches on disk. */
function inspectorFor(converterId: string): BaseConverter<any> | null {
  const config = { aiProvider: 'none' as const, apiKey: '', contractors: [], addresses: [] };
  switch (converterId) {
    case 'santander_xml':
      return new SantanderXmlConverter(config);
    case 'pko_mt940':
      return new PKOBPMT940Converter(config);
    case 'bnp_xml':
      return new BnpXmlConverter(config);
    case 'bos_xml':
      return new BosXmlConverter(config);
    case 'alior':
      return new AliorConverter(config);
    case 'pko_biznes':
      return new PKOBiznesConverter(config);
    case 'pko_sa':
      return new PKOSAConverter(config);
    case 'ing':
      return new INGConverter(config);
    case 'pocztowy':
      return new PocztowyConverter(config);
    default:
      return null;
  }
}

/** The content as the Converter reads it for that bank — see converterRegistry. */
function contentFor(converterId: string, absPath: string): any {
  if (converterId === 'pko_biznes') return fs.readFileSync(absPath);
  if (converterId === 'pko_mt940') return readStatementText(absPath);
  if (converterId === 'alior' || converterId === 'ing') return readFileWithEncoding(absPath, 'cp852');
  if (converterId === 'pocztowy') return readFileWithEncoding(absPath, 'win1250');
  return readFileWithEncoding(absPath);
}

const FAMILY_LABEL: Record<string, string> = {
  pko_mt940: 'MT940',
  bnp_xml: 'XML camt',
};

/**
 * Which days a statement covers, from its own transactions — the scan's
 * reading, and the one every conversion records its month with.
 */
export async function statementPeriodOf(converterId: string, absPath: string) {
  const inspector = inspectorFor(converterId);
  if (!inspector) throw new Error(`brak konwertera ${converterId}`);
  const transactions = await inspector.inspect(contentFor(converterId, absPath));
  return periodOfDates(transactions.map((t) => parseLooseDate(t.exeDate) ?? parseLooseDate(t.creatDate)));
}

class Scanner {
  private readonly accountTypeOf: (adres: Adres, account: string) => string | null;
  private readonly knownAccounts: Set<string>;

  constructor(private readonly input: ScanInput) {
    this.accountTypeOf = (adres, account) => accountTypeNameOf(adres, account, input.kontoTypy);
    this.knownAccounts = new Set(
      input.adresy.flatMap((a) => (a.accountNumbers ?? []).map(normalizeAccount).filter((x): x is string => !!x)),
    );
  }

  private draft(file: FoundOnDisk, hash: string, fields: Partial<PlikDraft> & Pick<PlikDraft, 'kind' | 'adresNazwa'>): PlikDraft {
    return {
      monthKey: this.input.monthKey,
      status: 'ok',
      errorMessage: null,
      adresId: null,
      accountNumber: null,
      accountTypeName: null,
      bankId: null,
      bankName: null,
      converterId: null,
      relPath: file.relPath,
      fileName: path.basename(file.absPath),
      originalName: null,
      fileSize: file.size,
      fileMtime: file.mtime.toISOString(),
      fileHash: hash,
      ignoredHashes: [],
      periodFrom: null,
      periodTo: null,
      scannedBy: this.input.scannedBy,
      ...fields,
    };
  }

  private unrecognized(file: FoundOnDisk, problem: ScanProblem, detail?: string, adres?: Adres): Classified {
    return {
      type: 'unrecognized',
      item: { relPath: file.relPath, fileName: path.basename(file.absPath), problem, detail, adresNazwa: adres?.nazwa },
    };
  }

  /**
   * A statement of a recognised community that cannot be converted. It is
   * pinned as an error — and shows under the dashboard's "Błędy" — when the
   * text itself says which month it is; otherwise it can only be reported.
   */
  private async failed(
    file: FoundOnDisk,
    dates: string[],
    adres: Adres,
    account: string,
    problem: ScanProblem,
    message: string,
    detail?: string,
  ): Promise<Classified> {
    const month = periodOfDates(dates)?.monthKey;
    if (!month) return this.unrecognized(file, problem, detail, adres);
    if (month !== this.input.monthKey) return { type: 'other-month' };
    return {
      type: 'candidate',
      c: {
        absPath: file.absPath,
        targetName: null,
        draft: this.draft(file, await sha1(file.absPath), {
          kind: 'statement',
          status: 'error',
          errorMessage: message,
          adresId: adres.id,
          adresNazwa: adres.nazwa,
          accountNumber: account,
          accountTypeName: this.accountTypeOf(adres, account),
        }),
      },
    };
  }

  async classifyStatement(file: FoundOnDisk): Promise<Classified> {
    const buf = await readHead(file.absPath);
    const head = decodeHead(buf);
    const headDates = () => datesInText(head);
    let family: string[] | null;
    // Accounts a ZIP names in its entries ("MT940_<konto>_<RRRRMMDD>.txt").
    let zipAccounts: string[] = [];
    if (buf.subarray(0, 4).equals(ZIP_MAGIC)) {
      const zip = lookIntoZip(file.absPath);
      // A ZIP of daily MT940 reports (PKO BP "Raporty_MT940_….zip") is a
      // month's MT940 statement — the Converter reads it as one.
      family = zip.family ?? (zip.mt940 ? MT940_FAMILY : null);
      zipAccounts = zip.accounts;
    } else {
      family = sniffTextFormat(head);
    }
    if (!family) return { type: 'ignore' };

    // The community: the same "our account" extraction the Converter runs. In
    // the XML formats every counterparty has an IBAN too — and one of them can
    // be the community's other account — so there only the first one counts.
    const ordered: string[] = [...zipAccounts];
    for (const converterId of family) {
      for (const acc of extractAccountNumbersFromFile(file.absPath, converterId)) {
        if (!ordered.includes(acc)) ordered.push(acc);
      }
    }
    const accounts = new Set(OWNER_FIRST.has(family[0]) ? ordered.slice(0, 1) : ordered);
    const found = findAdresByAccountNumbers([...accounts], this.input.adresy);
    if (!found.adres) {
      // Not a community's file — worth a line in the report only when it is
      // this month's (or its month cannot be told), not on every scan forever.
      const hint = periodOfDates(headDates())?.monthKey;
      if (hint && hint !== this.input.monthKey) return { type: 'other-month' };
      if (found.candidates.length > 1) {
        return this.unrecognized(file, 'ambiguous-account', found.candidates.map((a) => a.nazwa).join(', '));
      }
      const first = [...accounts][0];
      return first
        ? this.unrecognized(file, 'unknown-account', formatAccount(first))
        : this.unrecognized(file, 'no-account');
    }
    const adres = found.adres;
    const own = (adres.accountNumbers ?? []).map(normalizeAccount).filter((x): x is string => !!x);
    const matched = own.filter((acc) => accounts.has(acc));
    if (matched.length !== 1) {
      const hint = periodOfDates(headDates())?.monthKey;
      if (hint && hint !== this.input.monthKey) return { type: 'other-month' };
      return this.unrecognized(file, 'ambiguous-account', matched.map(formatAccount).join(', '), adres);
    }
    const account = matched[0];

    const adresBank = adres.bankId ? this.input.banks.find((b) => b.id === adres.bankId) : undefined;
    const converterId = pickConverter(family, account, adresBank?.converterId ?? null);
    if (!converterId) {
      const label = FAMILY_LABEL[family[0]] ?? family.join('/');
      return this.failed(
        file, headDates(), adres, account, 'unknown-bank',
        `Nie rozpoznano banku dla pliku ${label} (konto ${formatAccount(account)}). Przypisz bank do wspólnoty w zakładce Adresy.`,
        label,
      );
    }
    const bank =
      (adresBank && adresBank.converterId === converterId ? adresBank : undefined) ??
      this.input.banks.find((b) => b.converterId === converterId);
    if (!bank) {
      return this.failed(
        file, headDates(), adres, account, 'no-bank-row',
        `Brak banku z konwerterem „${converterId}” w zakładce Banki.`,
        converterId,
      );
    }

    let period;
    try {
      period = await statementPeriodOf(converterId, file.absPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failed(
        file, headDates(), adres, account, 'parse-failed',
        `Nie udało się odczytać pliku (${bank.name}): ${message}`,
        message,
      );
    }
    if (!period) {
      // No transactions (an empty statement): the balance dates still tell the month.
      const hint = periodOfDates(headDates())?.monthKey;
      if (hint && hint !== this.input.monthKey) return { type: 'other-month' };
      return this.unrecognized(file, 'no-period', undefined, adres);
    }
    if (period.monthKey !== this.input.monthKey) return { type: 'other-month' };

    const typeName = this.accountTypeOf(adres, account);
    return {
      type: 'candidate',
      c: {
        absPath: file.absPath,
        targetName: scanTargetName(
          adres.nazwa,
          typeName,
          period.from,
          period.to,
          path.extname(file.absPath),
          accountSuffixFor(adres, account, this.input.kontoTypy),
        ),
        draft: this.draft(file, await sha1(file.absPath), {
          kind: 'statement',
          adresId: adres.id,
          adresNazwa: adres.nazwa,
          accountNumber: account,
          accountTypeName: typeName,
          bankId: bank.id,
          bankName: bank.name,
          converterId,
          periodFrom: period.from,
          periodTo: period.to,
        }),
      },
    };
  }

  /* ------------------------------- PDF files -------------------------------- */

  async classifyPdf(file: FoundOnDisk): Promise<Classified> {
    let text: string;
    try {
      // Lazy, like pdf-utils: pdf-parse touches browser globals at load time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse');
      text = (await pdfParse(await fs.promises.readFile(file.absPath), { max: 1 })).text ?? '';
    } catch (error) {
      return this.unrecognized(file, 'read-failed', error instanceof Error ? error.message : String(error));
    }
    const header = readPdfHeader(text, this.knownAccounts);
    const statementLike = looksLikeStatementPdf(path.basename(file.absPath), text);
    if (header.problem === 'no-text') {
      return statementLike ? this.unrecognized(file, 'pdf-no-text') : { type: 'ignore' };
    }
    if (header.period && monthOfRange(header.period.from, header.period.to) !== this.input.monthKey) {
      return { type: 'other-month' };
    }
    // An invoice or a chart of accounts lying next to the statements is not a
    // statement that failed — only report PDFs that read like one.
    if (header.problem === 'no-account' && !statementLike) return { type: 'ignore' };
    if (!header.account) {
      const problem: ScanProblem =
        header.problem === 'ambiguous-account' || header.problem === 'unknown-account' ? header.problem : 'no-account';
      return this.unrecognized(file, problem, header.accounts.map(formatAccount).join(', ') || undefined);
    }
    const adres = this.input.adresy.find((a) =>
      (a.accountNumbers ?? []).some((acc) => normalizeAccount(acc) === header.account),
    );
    if (!adres) return this.unrecognized(file, 'unknown-account', formatAccount(header.account));
    if (!header.period) return this.unrecognized(file, 'no-period', undefined, adres);
    if (monthOfRange(header.period.from, header.period.to) !== this.input.monthKey) return { type: 'other-month' };

    const typeName = this.accountTypeOf(adres, header.account);
    return {
      type: 'candidate',
      c: {
        absPath: file.absPath,
        targetName: scanTargetName(
          adres.nazwa,
          typeName,
          header.period.from,
          header.period.to,
          '.pdf',
          accountSuffixFor(adres, header.account, this.input.kontoTypy),
        ),
        draft: this.draft(file, await sha1(file.absPath), {
          kind: 'pdf',
          adresId: adres.id,
          adresNazwa: adres.nazwa,
          accountNumber: header.account,
          accountTypeName: typeName,
          periodFrom: header.period.from,
          periodTo: header.period.to,
        }),
      },
    };
  }

  classify(file: FoundOnDisk): Promise<Classified> {
    return path.extname(file.absPath).toLowerCase() === '.pdf'
      ? this.classifyPdf(file)
      : this.classifyStatement(file);
  }
}

/* ------------------------------ Placing files ------------------------------ */

function samePath(a: string, b: string): boolean {
  // Mac and Windows file systems ignore case; a rename that only changes case
  // must not count the file itself as "taken".
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * Give a recognised file (statement or PDF) its name, in its own folder. A
 * name already taken by another file gets `_2`, `_3`… — nothing is ever
 * overwritten. On failure the file stays pinned under the name it had. Error
 * rows have no target name and keep theirs.
 */
async function placeFile(
  root: string,
  c: Candidate,
  failures: ScanReport['renameFailures'],
): Promise<PlikDraft> {
  const current = path.basename(c.absPath);
  if (!c.targetName || current === c.targetName) return c.draft;
  const dir = path.dirname(c.absPath);
  let name = c.targetName;
  for (let n = 2; fs.existsSync(path.join(dir, name)) && !samePath(path.join(dir, name), c.absPath); n++) {
    const ext = path.extname(c.targetName);
    name = `${c.targetName.slice(0, c.targetName.length - ext.length)}_${n}${ext}`;
  }
  const target = path.join(dir, name);
  try {
    await fs.promises.rename(c.absPath, target);
  } catch (error) {
    failures.push({ relPath: c.draft.relPath, message: error instanceof Error ? error.message : String(error) });
    return c.draft;
  }
  c.absPath = target;
  return {
    ...c.draft,
    relPath: path.relative(root, target).split(path.sep).join('/'),
    fileName: name,
    originalName: c.draft.originalName ?? current,
  };
}

function foundOf(draft: PlikDraft): ScanFoundFile {
  return {
    relPath: draft.relPath,
    fileName: draft.fileName,
    kind: draft.kind,
    adresNazwa: draft.adresNazwa,
    accountNumber: draft.accountNumber,
    accountTypeName: draft.accountTypeName,
    periodFrom: draft.periodFrom,
    periodTo: draft.periodTo,
    fileMtime: draft.fileMtime,
    originalName: draft.originalName,
    errorMessage: draft.errorMessage,
  };
}

function sameCommunity(a: Pick<KsiegowaniePlik, 'adresId' | 'adresNazwa'>, b: Pick<KsiegowaniePlik, 'adresId' | 'adresNazwa'>): boolean {
  if (a.adresId != null && b.adresId != null) return a.adresId === b.adresId;
  return a.adresNazwa.trim().toLowerCase() === b.adresNazwa.trim().toLowerCase();
}

/* ---------------------------------- Scan ----------------------------------- */

export async function scanStatementsFolder(input: ScanInput, store: ScanStore): Promise<ScanReport> {
  pendingConflicts.clear();
  const { root, monthKey } = input;
  const [year, month] = monthKey.split('-').map(Number);
  const report: ScanReport = {
    monthKey,
    examined: 0,
    added: [],
    unchanged: 0,
    duplicates: 0,
    skippedBooked: 0,
    conflicts: [],
    errors: [],
    unrecognized: [],
    renameFailures: [],
  };

  const files = await walk(root, new Date(year, month - 1, 1), (n) =>
    input.onProgress?.({ phase: 'walk', done: n, total: 0 }),
  );
  report.examined = files.length;

  const scanner = new Scanner(input);
  const candidates: Candidate[] = [];
  for (let i = 0; i < files.length; i++) {
    input.onProgress?.({ phase: 'read', done: i, total: files.length });
    let result: Classified;
    try {
      result = await scanner.classify(files[i]);
    } catch (error) {
      result = {
        type: 'unrecognized',
        item: {
          relPath: files[i].relPath,
          fileName: path.basename(files[i].absPath),
          problem: 'read-failed',
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (result.type === 'candidate') candidates.push(result.c);
    else if (result.type === 'unrecognized') report.unrecognized.push(result.item);
    await yieldToEventLoop();
  }
  input.onProgress?.({ phase: 'read', done: files.length, total: files.length });

  const existing = [...input.existing];
  // Whether a pinned statement is converted / ticked in DOM, from the history.
  const converted = linkConversions(input.existing, toBookingRows(input.history, input.adresy)).byPlik;
  const conversion = (p: KsiegowaniePlik) => converted.get(p.id) ?? null;
  const isBooked = (p: KsiegowaniePlik): boolean => {
    if (p.kind === 'statement') return conversion(p)?.bookedInDom === true;
    // A PDF is "booked" with the statements it documents.
    return existing.some(
      (s) =>
        s.kind === 'statement' &&
        s.accountNumber === p.accountNumber &&
        sameCommunity(s, p) &&
        periodsOverlap(s, p) &&
        conversion(s)?.bookedInDom === true,
    );
  };

  // Newest first: of two copies of the same statement found together, the newer
  // is pinned and the older one is recognised as superseded, not as a rival.
  candidates.sort((a, b) => b.draft.fileMtime.localeCompare(a.draft.fileMtime));
  const conflictByExisting = new Map<number, string>();

  for (const c of candidates) {
    try {
      await reconcile(c);
    } catch (error) {
      // One file that cannot be saved must not cost the user the whole scan.
      report.unrecognized.push({
        relPath: c.draft.relPath,
        fileName: c.draft.fileName,
        problem: 'read-failed',
        detail: error instanceof Error ? error.message : String(error),
        adresNazwa: c.draft.adresNazwa,
      });
    }
  }

  return report;

  async function reconcile(c: Candidate): Promise<void> {
    const d = c.draft;
    const byPath = existing.find((e) => e.kind === d.kind && e.relPath === d.relPath);
    if (byPath) {
      if (byPath.fileHash === d.fileHash) {
        report.unchanged++;
        return;
      }
      // The file was overwritten in place. A broken one is simply re-read;
      // a good one is a newer version, and that is the user's call.
      if (byPath.status === 'error' || d.status === 'error') {
        const row = await store.replaceKsiegowaniePlik(byPath.id, { ...d, ignoredHashes: byPath.ignoredHashes });
        existing[existing.indexOf(byPath)] = row;
        (d.status === 'error' ? report.errors : report.added).push(foundOf(d));
        return;
      }
    }

    const byHash = existing.find((e) => e.kind === d.kind && e.fileHash === d.fileHash);
    if (byHash && !byPath) {
      if (fs.existsSync(path.join(root, ...byHash.relPath.split('/')))) {
        report.duplicates++;
      } else {
        // Same file, moved: follow it.
        const placed = await placeFile(root, c, report.renameFailures);
        const row = await store.replaceKsiegowaniePlik(byHash.id, {
          ...placed,
          originalName: byHash.originalName ?? placed.originalName,
          ignoredHashes: byHash.ignoredHashes,
        });
        existing[existing.indexOf(byHash)] = row;
        report.unchanged++;
      }
      return;
    }

    if (d.status === 'error' && !byPath) {
      existing.push(await store.addKsiegowaniePlik(d));
      report.errors.push(foundOf(d));
      return;
    }

    // The rival: what is pinned for the same account and (overlapping) days.
    const rivals = byPath
      ? [byPath]
      : existing.filter(
          (e) =>
            e.kind === d.kind &&
            e.status === 'ok' &&
            e.accountNumber === d.accountNumber &&
            sameCommunity(e, d),
        );
    const samePeriod = rivals.find((e) => e.periodFrom === d.periodFrom && e.periodTo === d.periodTo);
    // A file overwritten in place competes with its own row, whatever days it covers now.
    const rival = byPath ?? samePeriod ?? rivals.find((e) => periodsOverlap(e, d));
    if (rival) {
      // Only a NEWER file is offered, once, and not after "Zostaw obecny".
      // Compared as instants: the database writes `+00:00` where the scan wrote `Z`.
      const newer = Date.parse(d.fileMtime) > Date.parse(rival.fileMtime);
      if (!newer || rival.ignoredHashes.includes(d.fileHash) || conflictByExisting.has(rival.id)) {
        report.duplicates++;
        return;
      }
      if (isBooked(rival)) {
        report.skippedBooked++;
        return;
      }
      const id = crypto.randomUUID();
      conflictByExisting.set(rival.id, id);
      pendingConflicts.set(id, { c, existing: rival });
      const conflict: ScanConflict = {
        id,
        kind: samePeriod || byPath ? 'version' : 'overlap',
        existing: rival,
        found: foundOf(d),
        existingConverted: rival.kind === 'statement' && conversion(rival) !== null,
      };
      report.conflicts.push(conflict);
      return;
    }

    const placed = await placeFile(root, c, report.renameFailures);
    existing.push(await store.addKsiegowaniePlik(placed));
    report.added.push(foundOf(placed));
  }
}

/* -------------------------------- Decisions -------------------------------- */

/**
 * Apply the user's answers to the last scan's conflicts:
 *   replace — the pinned row now points at the newer file,
 *   keep    — remembered, so the same file is not offered again,
 *   add     — pinned beside the existing one (overlapping periods only).
 */
export async function resolveScanConflicts(
  root: string,
  decisions: { id: string; decision: ScanDecision }[],
  store: ScanStore,
): Promise<{ applied: number; failed: { relPath: string; message: string }[] }> {
  const failed: { relPath: string; message: string }[] = [];
  let applied = 0;
  for (const { id, decision } of decisions) {
    const pending = pendingConflicts.get(id);
    if (!pending) continue;
    pendingConflicts.delete(id);
    const { c, existing } = pending;
    try {
      if (decision === 'keep') {
        await store.setKsiegowaniePlikIgnored(existing.id, [...existing.ignoredHashes, c.draft.fileHash]);
        applied++;
        continue;
      }
      // The file must still be the one the user was shown.
      if (!fs.existsSync(c.absPath) || (await sha1(c.absPath)) !== c.draft.fileHash) {
        failed.push({ relPath: c.draft.relPath, message: 'Plik zmienił się od skanowania — uruchom skan ponownie.' });
        continue;
      }
      const renameFailures: ScanReport['renameFailures'] = [];
      const placed = await placeFile(root, c, renameFailures);
      failed.push(...renameFailures);
      if (decision === 'replace') {
        await store.replaceKsiegowaniePlik(existing.id, { ...placed, ignoredHashes: existing.ignoredHashes });
      } else {
        await store.addKsiegowaniePlik(placed);
      }
      applied++;
    } catch (error) {
      failed.push({ relPath: c.draft.relPath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { applied, failed };
}
