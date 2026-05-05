/**
 * Scalanie wpłat — merge multiple deposit files into a single output file,
 * content concatenated byte-for-byte in date order with a single newline
 * separator between adjacent files.
 */

import fs from 'fs';
import path from 'path';
import { decodeBuffer } from '../../shared/encoding';

export interface AnalyzedFile {
  filePath: string;
  fileName: string;
  date: string | null; // ISO YYYY-MM-DD
  lineCount: number;
}

export interface MergeFileInput {
  filePath: string;
  /** Used to sort files in the merged output. */
  date: string | null;
}

export interface MergeResult {
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

export function analyzeFile(filePath: string): AnalyzedFile {
  const buffer = fs.readFileSync(filePath);
  const content = decodeBuffer(buffer);
  const fileName = path.basename(filePath);
  const date = extractDate(fileName, content);
  const lineCount = content.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  return { filePath, fileName, date, lineCount };
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
 * Sort `inputs` by date ascending and write a single merged file into
 * `outputDir`. Existing files with the same name get a numeric suffix.
 */
export function mergeFiles(
  inputs: MergeFileInput[],
  outputDir: string,
): MergeResult {
  const files = [...inputs].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.filePath.localeCompare(b.filePath);
  });

  const dates = files.map((f) => f.date).filter((d): d is string => !!d);
  const startDate = dates.length > 0 ? dates[0] : null;
  const endDate = dates.length > 0 ? dates[dates.length - 1] : null;

  const startCompact = compactDate(startDate);
  const endCompact = compactDate(endDate);
  const ext = path.extname(files[0].filePath) || '.txt';

  let dateRange = '';
  if (startCompact && endCompact) {
    dateRange = startCompact === endCompact
      ? `_${startCompact}`
      : `_${startCompact}-${endCompact}`;
  }

  let candidate = path.join(outputDir, `ELIXIR${dateRange}${ext}`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `ELIXIR${dateRange}_${suffix}${ext}`);
    suffix += 1;
  }

  const merged = concatBuffersWithNewline(files.map((f) => f.filePath));
  fs.writeFileSync(candidate, merged);

  return {
    outputPath: candidate,
    fileCount: files.length,
    startDate,
    endDate,
  };
}
