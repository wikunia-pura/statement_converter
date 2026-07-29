import { app } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs';
import { BackupData } from '../shared/types';
import DatabaseService from './database';

// Daily safety net: on every launch the app snapshots all shared data into
// userData/backups (one file per day, newest AUTO_BACKUP_KEEP kept). Manual
// exports from Settings go wherever the user points them; this folder exists
// so there's always a recent copy even if nobody remembers to export.

const AUTO_BACKUP_PREFIX = 'auto-backup-';
const AUTO_BACKUP_KEEP = 14;

export function getBackupsDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

/** Throw a user-readable error unless the parsed JSON is a backup we can restore. */
export function validateBackup(parsed: unknown): BackupData {
  const b = parsed as Partial<BackupData> | null;
  if (!b || b.format !== 'filefunky-backup' || !b.data) {
    throw new Error('To nie jest plik kopii zapasowej FileFunky.');
  }
  if (b.formatVersion !== 1) {
    throw new Error(`Nieobsługiwana wersja kopii zapasowej (${b.formatVersion}).`);
  }
  const d = b.data;
  for (const key of ['banks', 'kontrahenci', 'adresy', 'kontoTypy', 'history'] as const) {
    if (!Array.isArray(d[key])) throw new Error(`Uszkodzona kopia zapasowa: brak sekcji "${key}".`);
  }
  return b as BackupData;
}

function listAutoBackups(): string[] {
  const dir = getBackupsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.startsWith(AUTO_BACKUP_PREFIX) && f.endsWith('.json'))
    .sort(); // date-stamped names sort chronologically
}

export interface BackupStatus {
  folder: string;
  lastAutoBackup: string | null; // YYYY-MM-DD
  autoBackupCount: number;
}

export function getBackupStatus(): BackupStatus {
  const files = listAutoBackups();
  const last = files[files.length - 1];
  const match = last?.match(/^auto-backup-(\d{4}-\d{2}-\d{2})\.json$/);
  return {
    folder: getBackupsDir(),
    lastAutoBackup: match ? match[1] : null,
    autoBackupCount: files.length,
  };
}

export interface AutoBackupResult {
  filePath: string;
  date: string; // YYYY-MM-DD
}

/**
 * Write today's auto backup, then drop the oldest files beyond
 * AUTO_BACKUP_KEEP. One file per day: the exit backup passes `force` to
 * refresh it with the session's changes; the startup backup omits it, so it
 * only fills the gap when the file is missing — first open of the day, or
 * the previous session crashed before its exit backup could run. Never
 * throws — a failed backup (e.g. no Supabase session yet) must not break
 * app startup or shutdown. Returns null when skipped or failed.
 */
export async function runAutoBackup(
  database: DatabaseService,
  opts: { force?: boolean } = {},
): Promise<AutoBackupResult | null> {
  try {
    const dir = getBackupsDir();
    const today = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `${AUTO_BACKUP_PREFIX}${today}.json`);
    if (!opts.force && fs.existsSync(target)) return null;

    const backup = await database.exportFullBackup(app.getVersion());
    fs.mkdirSync(dir, { recursive: true });
    // Write via a temp file so a crash mid-write can't leave a truncated backup.
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(backup, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
    log.info(`[BACKUP] Auto backup written: ${target}`);

    for (const stale of listAutoBackups().slice(0, -AUTO_BACKUP_KEEP)) {
      fs.unlinkSync(path.join(dir, stale));
      log.info(`[BACKUP] Pruned old auto backup: ${stale}`);
    }
    return { filePath: target, date: today };
  } catch (error) {
    log.warn(`[BACKUP] Auto backup skipped: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
