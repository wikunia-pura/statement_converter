/**
 * Community-account extraction from raw statement files. Node-only — uses fs
 * and adm-zip. Called from the main process via the
 * `files:detect-account-numbers` IPC handler.
 *
 * Every supported bank format embeds the statement-owner ("our") account number
 * in a predictable place. We read only the file header / a small slice (or for
 * PKO Biznes a single CSV row per inner file) to pull it out, so it's cheap
 * enough to run on every file the user drops into the Converter.
 *
 * Layout-aware (per converterId) when we know the bank, with a generic
 * fallback that scans for any 26-digit Polish account anywhere in the slice.
 *
 * Returns the canonical 26-digit form (no PL prefix, no spaces, no slashes).
 */
import fs from 'fs';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { normalizeAccount } from './account-extractor';

const HEADER_BYTES = 16 * 1024;

/**
 * Layout-aware extraction. Reads a slice of the file (or the inner CSVs for
 * pko_biznes zips) and pulls every "our account" candidate.
 *
 * Returns canonical 26-digit numbers, deduped. Empty array on any failure —
 * extraction is best-effort, never throws to the caller.
 */
export function extractAccountNumbersFromFile(
  filePath: string,
  converterId?: string | null,
): string[] {
  try {
    if (converterId === 'pko_biznes') {
      return extractFromPkoBiznesZip(filePath);
    }

    // Read a header slice — enough to capture statement-level fields without
    // pulling the whole file into memory. All single-account formats put the
    // IBAN near the top.
    const buf = readHead(filePath, HEADER_BYTES);

    // For MT940 (PL latin-1-ish) and the XMLs we try several encodings; the
    // IBAN is ASCII either way, so this just keeps surrounding context readable.
    const candidates: (string | null)[] = [
      tryDecode(buf, 'utf8'),
      tryDecode(buf, 'windows-1250'),
      tryDecode(buf, 'iso-8859-2'),
    ];

    const found = new Set<string>();
    for (const text of candidates) {
      if (!text) continue;
      for (const acc of extractFromText(text, converterId)) {
        found.add(acc);
      }
    }
    return Array.from(found);
  } catch {
    return [];
  }
}

/**
 * Layout-aware extraction from already-decoded text. Useful when the caller
 * has the content in memory (tests, debugging).
 */
export function extractAccountNumbersFromText(
  text: string,
  converterId?: string | null,
): string[] {
  return Array.from(new Set(extractFromText(text, converterId)));
}

// ─────────────────────────── internals ───────────────────────────

function readHead(filePath: string, maxBytes: number): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stats = fs.fstatSync(fd);
    const len = Math.min(stats.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function tryDecode(buf: Buffer, encoding: string): string | null {
  try {
    return iconv.decode(buf, encoding);
  } catch {
    return null;
  }
}

function extractFromText(text: string, converterId?: string | null): string[] {
  const results: string[] = [];

  switch (converterId) {
    case 'pko_mt940':
    case 'ing':
    case 'alior':
      // MT940 :25: tag carries the owner account. May or may not have leading slash + "PL".
      // Example: ":25:/PL49102010260000120201852748"
      for (const m of text.matchAll(/:25:\s*\/?(?:PL)?\s*([\d\s]{26,40})/gi)) {
        const acc = normalizeAccount(m[1]);
        if (acc) results.push(acc);
      }
      break;

    case 'pko_sa':
      // #SALDO# "26-digit-account" "..." "..."
      for (const m of text.matchAll(/#SALDO#\s*"([\d\s]{26,40})"/g)) {
        const acc = normalizeAccount(m[1]);
        if (acc) results.push(acc);
      }
      break;

    case 'santander_xml':
      // <account><iban>26 digits</iban></account>
      for (const m of text.matchAll(/<iban>\s*(?:PL)?\s*([\d\s]{26,40})\s*<\/iban>/gi)) {
        const acc = normalizeAccount(m[1]);
        if (acc) results.push(acc);
      }
      break;

    case 'bnp_xml':
    case 'bos_xml':
      // ISO 20022: <Acct><Id><IBAN>PL26-digits</IBAN>
      for (const m of text.matchAll(/<IBAN>\s*(?:PL)?\s*([\d\s]{26,40})\s*<\/IBAN>/gi)) {
        const acc = normalizeAccount(m[1]);
        if (acc) results.push(acc);
      }
      break;
  }

  // Generic fallback — covers unknown converters and provides a safety net when
  // a layout-aware match misses (e.g. unusual whitespace). Looks for 26 digits
  // optionally prefixed by PL, possibly with spaces every 4 digits.
  if (results.length === 0) {
    for (const m of text.matchAll(/(?:^|[^\d])(?:PL)?[ ]?((?:\d[ ]?){26})(?!\d)/gi)) {
      const acc = normalizeAccount(m[1]);
      if (acc) results.push(acc);
    }
  }

  return results;
}

function extractFromPkoBiznesZip(filePath: string): string[] {
  const found = new Set<string>();
  try {
    const zip = new AdmZip(filePath);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const name = entry.entryName.toLowerCase();
      if (!name.endsWith('.txt') && !name.endsWith('.csv')) continue;
      const text = iconv.decode(entry.getData(), 'windows-1250');
      // ELIXIR rows: type,date,amount,bankCode,0,"<OWN>","<CPTY>",...
      // The own account is the 6th comma-separated field (index 5).
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const fields = line.split(',');
        if (fields.length < 6) continue;
        const raw = fields[5].replace(/["']/g, '').trim();
        const acc = normalizeAccount(raw);
        if (acc) found.add(acc);
      }
    }
  } catch {
    /* fall through to empty */
  }
  return Array.from(found);
}
