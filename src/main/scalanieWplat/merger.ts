/**
 * Scalanie wpłat — merge multiple deposit files (one community/day per file)
 * into a single file per community, content concatenated byte-for-byte in
 * date order with a single newline separator between adjacent files.
 *
 * Community detection: each Adres carries a `swrkIdentifiers` list of
 * substrings (e.g. parts of the receiver IBAN, ID prefixes). A file is
 * assigned to the address whose identifiers appear most often in its
 * content. Date is parsed from the filename first (`*_YYYYMMDD*`), then
 * from content.
 */

import fs from 'fs';
import path from 'path';
import { Adres } from '../../shared/types';
import { decodeBuffer } from '../../shared/encoding';

export interface AnalyzedFile {
  filePath: string;
  fileName: string;
  date: string | null; // ISO YYYY-MM-DD
  detectedAddress: string | null; // e.g. "Pieńkowskiego 4"
  detectedAdresId: number | null;
  /** Most frequent long digit sequence in content (typically the receiver IBAN). Used to group files of the same community across days, so detection from one file can propagate to siblings whose content lacks address markers. */
  accountKey: string | null;
  lineCount: number;
}

export interface MergeFileInput {
  filePath: string;
  /** User-confirmed community key (typically the matched address full string). */
  communityKey: string;
  /** Used in the output filename. */
  communityLabel: string;
  /** Used to sort within a group. */
  date: string | null;
}

export interface MergeGroupResult {
  communityKey: string;
  communityLabel: string;
  outputPath: string;
  fileCount: number;
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
 * Detect the community by scanning content for SWRK identifiers configured
 * on each Adres. Each identifier is a substring; an Adres matches if any of
 * its identifiers appears anywhere in the file. When multiple addresses hit,
 * the one with the most identifier-occurrences wins (rarely needed — usually
 * a single address claims the file).
 */
export function detectCommunityAddress(
  content: string,
  addresses: Adres[],
): { label: string | null; adresId: number | null } {
  if (addresses.length === 0) return { label: null, adresId: null };

  let best: { adresId: number; label: string; hits: number } | null = null;

  for (const addr of addresses) {
    const ids = addr.swrkIdentifiers ?? [];
    if (ids.length === 0) continue;
    let hits = 0;
    for (const id of ids) {
      const trimmed = id.trim();
      if (!trimmed) continue;
      // Count distinct occurrences across content
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
      best = { adresId: addr.id, label: addr.nazwa, hits };
    }
  }

  if (!best) return { label: null, adresId: null };
  return { label: best.label, adresId: best.adresId };
}

/**
 * Stable cross-file identifier for the community. ELIXIR-style filenames
 * embed the receiver IBAN (`ELIXIR_<account>_<date>.txt`) — checking the
 * filename first is more reliable than counting digit sequences in content,
 * since a single-line file gives every IBAN equal weight and the sender's
 * happens to come first in the CSV record.
 *
 * Falls back to the most frequent long digit sequence in content for files
 * whose names don't carry an account number.
 */
export function detectAccountKey(fileName: string, content: string): string | null {
  const fnDigits = fileName.match(/\d{20,32}/g);
  if (fnDigits && fnDigits.length > 0) {
    return fnDigits.sort((a, b) => b.length - a.length)[0];
  }
  const matches = content.match(/\d{20,32}/g);
  if (!matches || matches.length === 0) return null;
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m, (counts.get(m) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best || null;
}

export function analyzeFile(filePath: string, addresses: Adres[]): AnalyzedFile {
  const buffer = fs.readFileSync(filePath);
  const content = decodeBuffer(buffer);
  const fileName = path.basename(filePath);
  const date = extractDate(fileName, content);
  const { label, adresId } = detectCommunityAddress(content, addresses);
  const accountKey = detectAccountKey(fileName, content);
  const lineCount = content.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  return {
    filePath,
    fileName,
    date,
    detectedAddress: label,
    detectedAdresId: adresId,
    accountKey,
    lineCount,
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

/**
 * Concatenate the raw bytes of the given files in order, ensuring exactly one
 * `\n` (0x0A) between adjacent files. The user requested byte-perfect output,
 * so no transcoding happens here.
 */
function concatBuffersWithNewline(filePaths: string[]): Buffer {
  const parts: Buffer[] = [];
  for (let i = 0; i < filePaths.length; i++) {
    const buf = fs.readFileSync(filePaths[i]);
    if (i === 0) {
      parts.push(buf);
      continue;
    }
    const prev = parts[parts.length - 1];
    const lastByte = prev.length > 0 ? prev[prev.length - 1] : -1;
    if (lastByte !== 0x0a) {
      parts.push(Buffer.from('\n', 'utf-8'));
    }
    parts.push(buf);
  }
  return Buffer.concat(parts);
}

/**
 * Group `inputs` by `communityKey`, sort each group by date ascending, and
 * write one output file per group into `outputDir`. Returns metadata for the
 * UI. Existing files with the same name get a numeric suffix.
 */
export function mergeGroups(
  inputs: MergeFileInput[],
  outputDir: string,
): MergeGroupResult[] {
  const groups = new Map<string, MergeFileInput[]>();
  for (const input of inputs) {
    const arr = groups.get(input.communityKey) ?? [];
    arr.push(input);
    groups.set(input.communityKey, arr);
  }

  const results: MergeGroupResult[] = [];

  for (const [key, files] of groups) {
    files.sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.filePath.localeCompare(b.filePath);
    });

    const dates = files.map((f) => f.date).filter((d): d is string => !!d);
    const startDate = dates.length > 0 ? dates[0] : null;
    const endDate = dates.length > 0 ? dates[dates.length - 1] : null;

    const label = files[0].communityLabel || 'wspolnota';
    const safeLabel = sanitizeForFilename(label);
    const startCompact = compactDate(startDate);
    const endCompact = compactDate(endDate);
    const ext = path.extname(files[0].filePath) || '.txt';

    let dateRange = '';
    if (startCompact && endCompact) {
      dateRange = startCompact === endCompact
        ? `_${startCompact}`
        : `_${startCompact}-${endCompact}`;
    }

    let candidate = path.join(outputDir, `ELIXIR_${safeLabel}${dateRange}${ext}`);
    let suffix = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(
        outputDir,
        `ELIXIR_${safeLabel}${dateRange}_${suffix}${ext}`,
      );
      suffix += 1;
    }

    const merged = concatBuffersWithNewline(files.map((f) => f.filePath));
    fs.writeFileSync(candidate, merged);

    results.push({
      communityKey: key,
      communityLabel: label,
      outputPath: candidate,
      fileCount: files.length,
      startDate,
      endDate,
    });
  }

  return results;
}
