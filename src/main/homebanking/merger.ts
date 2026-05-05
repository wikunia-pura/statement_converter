/**
 * Homebanking — merge multi-day deposit/payment files coming from many banks
 * into one file per bank, with optional split per address.
 *
 * Bank detection: each Bank carries `accountPrefixes`. A file belongs to the
 * bank whose prefix appears most frequently in the raw content (substring
 * match). Files without any matching bank are flagged and skipped during
 * merge.
 *
 * Address split (optional): when enabled, each "position" (line) in the
 * input is run through the shared AddressMatcher (same logic as the
 * Converter module). Lines are then grouped by the first matched address.
 * Lines without a matched address are written to the bank's "default" file.
 *
 * Output filename:
 *   - {Bank}_{startDate}-{endDate}.{ext}            (no split)
 *   - {Bank}_{Address}_{startDate}-{endDate}.{ext}  (split by address)
 */

import fs from 'fs';
import path from 'path';
import { Adres, Bank } from '../../shared/types';
import { decodeBuffer } from '../../shared/encoding';
import { AddressMatcher } from '../../shared/address-matcher';

export interface AnalyzedAddressHit {
  /** Display label, e.g. "Pieńkowskiego 4" */
  label: string;
  /** Number of lines in this file matched to this address. */
  lineCount: number;
}

export interface BankHit {
  bankId: number;
  bankName: string;
  /** How many lines in this file are routed to this bank. */
  lineCount: number;
}

export interface AnalyzedFile {
  filePath: string;
  fileName: string;
  date: string | null;
  /** All banks whose accountPrefixes match at least one line. .PLI-style files
   * routinely contain entries for multiple banks; single-bank files produce a
   * one-element list. */
  bankHits: BankHit[];
  /** First-line preview of address detections (one entry per known address that matched any line). */
  addressHits: AnalyzedAddressHit[];
  lineCount: number;
}

export interface MergeFileInput {
  filePath: string;
  /** User-selected bank ids. Lines whose detected bank isn't in this set are
   * dropped during merge. Empty set ⇒ nothing emitted from this file. */
  bankIds: number[];
  date: string | null;
  /** When true, split this file's selected lines into per-address output
   * buckets; lines without a confident address fall back to the bank's
   * default bucket. */
  splitByAddress: boolean;
}

export interface MergeGroupResult {
  bankId: number;
  bankName: string;
  /** Address label when split by addresses; null for the no-split case or "default" bucket. */
  addressLabel: string | null;
  outputPath: string;
  fileCount: number;
  /** Lines written into this output. */
  lineCount: number;
  startDate: string | null;
  endDate: string | null;
}

const DATE_FILENAME = /(?:^|[_\-\.])((?:19|20)\d{2})[_\-]?(\d{2})[_\-]?(\d{2})(?:[_\-\.]|$)/;
const DATE_CONTENT = /\b((?:19|20)\d{2})(\d{2})(\d{2})\b/;

export function extractDate(fileName: string, content: string): string | null {
  const fn = fileName.match(DATE_FILENAME);
  if (fn) return `${fn[1]}-${fn[2]}-${fn[3]}`;
  const c = content.match(DATE_CONTENT);
  if (c) return `${c[1]}-${c[2]}-${c[3]}`;
  return null;
}

/**
 * Pick the bank whose accountPrefixes appear most often (as substrings) in
 * `content`. Ties are broken by configured order (first wins) so detection
 * is stable across calls.
 */
export function detectBankForContent(
  content: string,
  banks: Bank[],
): { bankId: number; bankName: string } | null {
  let best: { bankId: number; bankName: string; hits: number } | null = null;

  for (const bank of banks) {
    const prefixes = bank.accountPrefixes ?? [];
    let hits = 0;
    for (const prefix of prefixes) {
      const trimmed = prefix.trim();
      if (!trimmed) continue;
      let from = 0;
      while (true) {
        const idx = content.indexOf(trimmed, from);
        if (idx === -1) break;
        hits += 1;
        from = idx + trimmed.length;
      }
    }
    if (hits === 0) continue;
    if (!best || hits > best.hits) {
      best = { bankId: bank.id, bankName: bank.name, hits };
    }
  }

  if (!best) return null;
  return { bankId: best.bankId, bankName: best.bankName };
}

/**
 * Detect the address for a single position (line) using the shared
 * AddressMatcher. We count any reasonably-confident street/building hit —
 * the same logic the Converter module trusts.
 */
function detectAddressLabel(line: string, matcher: AddressMatcher): string | null {
  if (!line.trim()) return null;
  const result = matcher.match(line);
  if (!result.streetName || !result.buildingNumber) return null;
  // address confidence ≥60 = "valid known address"; below = unknown
  if (result.confidence.address < 60) return null;
  return `${result.streetName} ${result.buildingNumber}`;
}

export function analyzeFile(
  filePath: string,
  banks: Bank[],
  addresses: Adres[],
): AnalyzedFile {
  // Homebanking files are typically Windows-1250 (Polish chars). decodeBuffer
  // auto-detects via BOM/heuristics and falls back to win1250 — which is what
  // the user explicitly called out.
  const buffer = fs.readFileSync(filePath);
  const content = decodeBuffer(buffer);
  const fileName = path.basename(filePath);
  const date = extractDate(fileName, content);

  const matcher = new AddressMatcher(addresses);
  const lines = content.split(/\r?\n/);

  const bankCounts = new Map<number, { bankName: string; lineCount: number }>();
  const addressCounts = new Map<string, number>();
  let nonEmpty = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    nonEmpty += 1;

    // Per-line bank detection — supports multi-bank files like .PLI
    const bank = detectBankForContent(line, banks);
    if (bank) {
      const prev = bankCounts.get(bank.bankId);
      if (prev) prev.lineCount += 1;
      else bankCounts.set(bank.bankId, { bankName: bank.bankName, lineCount: 1 });
    }

    const label = detectAddressLabel(line, matcher);
    if (label) addressCounts.set(label, (addressCounts.get(label) ?? 0) + 1);
  }

  const bankHits: BankHit[] = Array.from(bankCounts.entries())
    .map(([bankId, v]) => ({ bankId, bankName: v.bankName, lineCount: v.lineCount }))
    .sort((a, b) => b.lineCount - a.lineCount);

  const addressHits: AnalyzedAddressHit[] = Array.from(addressCounts.entries())
    .map(([label, lineCount]) => ({ label, lineCount }))
    .sort((a, b) => b.lineCount - a.lineCount);

  return {
    filePath,
    fileName,
    date,
    bankHits,
    addressHits,
    lineCount: nonEmpty,
  };
}

const POLISH_CHAR_MAP: Record<string, string> = {
  ą: 'a', Ą: 'A', ć: 'c', Ć: 'C', ę: 'e', Ę: 'E',
  ł: 'l', Ł: 'L', ń: 'n', Ń: 'N', ó: 'o', Ó: 'O',
  ś: 's', Ś: 'S', ź: 'z', Ź: 'Z', ż: 'z', Ż: 'Z',
};

function sanitizeForFilename(name: string): string {
  return name
    .replace(/[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]/g, (c) => POLISH_CHAR_MAP[c] ?? c)
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 80);
}

function compactDate(iso: string | null): string | null {
  if (!iso) return null;
  return iso.replace(/-/g, '');
}

interface BucketLine {
  /** ISO date of the source file. */
  date: string | null;
  /** Original byte buffer for one line (no trailing newline). Preserved verbatim so encoding is round-tripped. */
  bytes: Buffer;
}

/**
 * Decode a byte slice using the same encoding that decodeBuffer would pick,
 * so address detection runs on the right characters even when iconv decoding
 * is per-line.
 */
function readLinesBytes(filePath: string): { lineBuffers: Buffer[]; allText: string } {
  const buffer = fs.readFileSync(filePath);
  const allText = decodeBuffer(buffer);

  // Split on newlines while preserving byte positions. We re-scan the buffer
  // for 0x0A (LF) and treat the byte before LF as 0x0D (CR) — drop it so we
  // don't carry CRLF into the joined output.
  const lineBuffers: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) {
      let end = i;
      if (end > start && buffer[end - 1] === 0x0d) end -= 1;
      lineBuffers.push(buffer.slice(start, end));
      start = i + 1;
    }
  }
  if (start < buffer.length) {
    lineBuffers.push(buffer.slice(start));
  }
  return { lineBuffers, allText };
}

interface BucketKey {
  bankId: number;
  bankName: string;
  /** Empty string ⇒ bank's default (no-split) bucket. */
  addressLabel: string;
}

function makeBucketKey(k: BucketKey): string {
  return `${k.bankId} ${k.addressLabel}`;
}

/**
 * Walk every line of every input, route each line to its bank (per-line
 * detection), then bucket by per-file `splitByAddress`. Lines whose detected
 * bank isn't in the input's selected `bankIds` are dropped. Lines that don't
 * match any configured bank are also dropped — the file's selected bank set
 * is the routing whitelist.
 */
function bucketLines(
  inputs: MergeFileInput[],
  banks: Bank[],
  matcher: AddressMatcher,
): Map<string, { key: BucketKey; lines: BucketLine[] }> {
  const buckets = new Map<string, { key: BucketKey; lines: BucketLine[] }>();
  const banksById = new Map<number, Bank>();
  for (const b of banks) banksById.set(b.id, b);

  // Sort inputs by date asc so within each bucket lines stay chronological.
  const sortedInputs = [...inputs].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.filePath.localeCompare(b.filePath);
  });

  for (const input of sortedInputs) {
    if (input.bankIds.length === 0) continue;
    const allowed = new Set(input.bankIds);
    const { lineBuffers } = readLinesBytes(input.filePath);
    for (const lineBuf of lineBuffers) {
      // empty lines: skip — they'd add stray separators on join
      if (lineBuf.length === 0) continue;
      const lineText = decodeBuffer(lineBuf);
      const bank = detectBankForContent(lineText, banks);
      if (!bank || !allowed.has(bank.bankId)) continue;

      let addressLabel = '';
      if (input.splitByAddress) {
        addressLabel = detectAddressLabel(lineText, matcher) ?? '';
      }
      const key: BucketKey = {
        bankId: bank.bankId,
        bankName: bank.bankName,
        addressLabel,
      };
      const id = makeBucketKey(key);
      const entry = buckets.get(id) ?? { key, lines: [] };
      entry.lines.push({ date: input.date, bytes: lineBuf });
      buckets.set(id, entry);
    }
  }

  return buckets;
}

function joinWithNewlines(lines: BucketLine[]): Buffer {
  if (lines.length === 0) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) parts.push(Buffer.from('\n', 'utf-8'));
    parts.push(lines[i].bytes);
  }
  // trailing newline so file ends cleanly
  parts.push(Buffer.from('\n', 'utf-8'));
  return Buffer.concat(parts);
}

function dateRangeForLines(lines: BucketLine[]): {
  startDate: string | null;
  endDate: string | null;
} {
  const dates = lines.map((l) => l.date).filter((d): d is string => !!d).sort();
  return {
    startDate: dates.length > 0 ? dates[0] : null,
    endDate: dates.length > 0 ? dates[dates.length - 1] : null,
  };
}

function buildOutputPath(
  outputDir: string,
  bankName: string,
  addressLabel: string | null,
  startDate: string | null,
  endDate: string | null,
  ext: string,
): string {
  const safeBank = sanitizeForFilename(bankName) || 'bank';
  const safeAddress = addressLabel ? sanitizeForFilename(addressLabel) : null;
  const startCompact = compactDate(startDate);
  const endCompact = compactDate(endDate);

  let dateRange = '';
  if (startCompact && endCompact) {
    dateRange = startCompact === endCompact
      ? `_${startCompact}`
      : `_${startCompact}-${endCompact}`;
  }

  const addressPart = safeAddress ? `_${safeAddress}` : '';
  let candidate = path.join(outputDir, `${safeBank}${addressPart}${dateRange}${ext}`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(
      outputDir,
      `${safeBank}${addressPart}${dateRange}_${suffix}${ext}`,
    );
    suffix += 1;
  }
  return candidate;
}

/**
 * Walk every line of every input, route by per-line bank detection, bucket
 * by (bank, address|default), and write one output per bucket.
 */
export function mergeGroups(
  inputs: MergeFileInput[],
  outputDir: string,
  banks: Bank[],
  addresses: Adres[],
): MergeGroupResult[] {
  const matcher = new AddressMatcher(addresses);
  const buckets = bucketLines(inputs, banks, matcher);

  // Track which inputs contributed any line per bank (for fileCount in results).
  const filesPerBank = new Map<number, Set<string>>();
  for (const input of inputs) {
    if (input.bankIds.length === 0) continue;
    for (const bankId of input.bankIds) {
      const set = filesPerBank.get(bankId) ?? new Set<string>();
      set.add(input.filePath);
      filesPerBank.set(bankId, set);
    }
  }

  const ext = path.extname(inputs[0]?.filePath ?? '') || '.txt';
  const results: MergeGroupResult[] = [];

  for (const { key, lines } of buckets.values()) {
    if (lines.length === 0) continue;
    const addressLabel = key.addressLabel || null;
    const { startDate, endDate } = dateRangeForLines(lines);
    const outputPath = buildOutputPath(
      outputDir,
      key.bankName,
      addressLabel,
      startDate,
      endDate,
      ext,
    );

    const merged = joinWithNewlines(lines);
    fs.writeFileSync(outputPath, merged);

    results.push({
      bankId: key.bankId,
      bankName: key.bankName,
      addressLabel,
      outputPath,
      fileCount: filesPerBank.get(key.bankId)?.size ?? 0,
      lineCount: lines.length,
      startDate,
      endDate,
    });
  }

  return results;
}
