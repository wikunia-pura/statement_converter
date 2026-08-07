/**
 * Odczyty liczników — turn parsed readings into the internal import format:
 * one tab-separated .txt per housing community, no header row, three columns
 *
 *     nr urządzenia <TAB> data odczytu (YYYY.MM.DD) <TAB> wartość odczytu
 *
 * Files land in the configured IMPEX folder and are named `<WM>_<data>.txt`, so
 * re-running the same month overwrites its own output instead of piling up.
 * Written in Windows-1250, matching every other IMPEX file the app produces.
 */

import fs from 'fs';
import path from 'path';
import { writeFileWin1250 } from '../../shared/encoding';
import { OdczytReading } from './parser';

export interface OdczytyOutputFile {
  wm: string;
  outputPath: string;
  fileName: string;
  date: string;
  readingCount: number;
}

/**
 * Round half away from zero to two decimals and render with a Polish decimal
 * comma. Values arrive as IEEE doubles, so 1.005 is really 1.00499…; scaling
 * through the decimal string representation keeps the rounding intuitive.
 */
export function formatReadingValue(value: number): string {
  const sign = value < 0 ? '-' : '';
  const scaled = Math.round(Number((Math.abs(value) * 100).toPrecision(12)));
  const whole = Math.floor(scaled / 100);
  const cents = scaled % 100;
  return `${sign}${whole},${String(cents).padStart(2, '0')}`;
}

/** Strip characters Windows forbids in file names, keeping Polish letters. */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim();
}

/** Reading date for the file body: US order, dot-separated — `2026.06.30`. */
export function formatReadingDate(iso: string): string {
  return iso.replace(/-/g, '.');
}

export function buildFileContent(readings: OdczytReading[]): string {
  return readings
    .map(
      (r) =>
        `${r.deviceNumber}\t${formatReadingDate(r.date)}\t${formatReadingValue(r.value)}`,
    )
    .join('\n');
}

/**
 * Group `readings` by housing community and write one file per group into
 * `outputDir`. The file's date is the newest reading date inside the group.
 * Readings from several input files that share a community end up in one file.
 */
export function writeOdczytyFiles(
  readings: OdczytReading[],
  outputDir: string,
): OdczytyOutputFile[] {
  if (readings.length === 0) {
    throw new Error('Plik nie zawiera żadnych odczytów do zapisania.');
  }
  if (!outputDir) {
    throw new Error('Folder IMPEX nie jest skonfigurowany (Ustawienia → Folder IMPEX).');
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const groups = new Map<string, OdczytReading[]>();
  for (const reading of readings) {
    const list = groups.get(reading.wm) ?? [];
    list.push(reading);
    groups.set(reading.wm, list);
  }

  const files: OdczytyOutputFile[] = [];
  for (const [wm, groupReadings] of groups) {
    const date = groupReadings.reduce(
      (max, r) => (r.date > max ? r.date : max),
      groupReadings[0].date,
    );
    const fileName = `${sanitizeFileName(wm)}_${date}.txt`;
    const outputPath = path.join(outputDir, fileName);
    writeFileWin1250(outputPath, buildFileContent(groupReadings));
    files.push({ wm, outputPath, fileName, date, readingCount: groupReadings.length });
  }

  files.sort((a, b) => a.wm.localeCompare(b.wm, 'pl'));
  return files;
}
