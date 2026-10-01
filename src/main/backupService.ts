import { app } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs';
import os from 'os';
import yaml from 'js-yaml';
import { BackupData } from '../shared/types';
import DatabaseService from './database';

// Safety net: the app snapshots all shared data into userData/backups at least
// every AUTO_BACKUP_INTERVAL_MS while it runs (the main process asks every few
// minutes; a run happens only once that long has passed since the last file),
// and once more when it quits. Manual exports from Settings go wherever the
// user points them; this folder exists so there's always a recent copy even if
// nobody remembers to export.
//
// Every run is its own file, `auto-backup-YYYY-MM-DD-HHmm.json` (local time),
// so a bad state written at noon cannot overwrite the good one from 8:00.
// Retention thins them out: everything from the last AUTO_BACKUP_KEEP_ALL_DAYS
// days stays, and older days keep only their last file, up to
// AUTO_BACKUP_KEEP_DAYS days. Files written before this scheme — one per day,
// `auto-backup-YYYY-MM-DD.json` — are still recognised and thinned the same way.

const AUTO_BACKUP_PREFIX = 'auto-backup-';
/** A scheduled run happens when the newest backup is at least this old. */
export const AUTO_BACKUP_INTERVAL_MS = 4 * 60 * 60 * 1000;
const AUTO_BACKUP_KEEP_DAYS = 14;
const AUTO_BACKUP_KEEP_ALL_DAYS = 2;

const AUTO_BACKUP_NAME = /^auto-backup-(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2}))?\.json$/;

interface ParsedBackupName {
  file: string;
  /** YYYY-MM-DD */
  date: string;
  /** HHmm, or null for a file from the one-per-day era. */
  time: string | null;
}

function parseBackupName(file: string): ParsedBackupName | null {
  const m = file.match(AUTO_BACKUP_NAME);
  return m ? { file, date: m[1], time: m[2] ? `${m[2]}${m[3]}` : null } : null;
}

/** Local `YYYY-MM-DD` and `HHmm` — the person's own clock, not UTC. */
function localStamp(d: Date = new Date()): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}`,
  };
}

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

/**
 * The auto backups on disk, oldest first. Sorted by date and then time — a file
 * from the one-per-day era has no time and counts as the END of its day, so it
 * is never mistaken for older than a stamped file of the same date.
 */
function listAutoBackups(): ParsedBackupName[] {
  const dir = getBackupsDir();
  if (!fs.existsSync(dir)) return [];
  const key = (b: ParsedBackupName) => `${b.date}-${b.time ?? '2400'}`;
  return fs
    .readdirSync(dir)
    .map(parseBackupName)
    .filter((b): b is ParsedBackupName => b !== null)
    .sort((a, b) => key(a).localeCompare(key(b)));
}

export interface BackupStatus {
  folder: string;
  lastAutoBackup: string | null; // YYYY-MM-DD HH:mm (YYYY-MM-DD for an old one-per-day file)
  autoBackupCount: number;
}

function describeBackup(b: ParsedBackupName): string {
  return b.time ? `${b.date} ${b.time.slice(0, 2)}:${b.time.slice(2)}` : b.date;
}

export function getBackupStatus(): BackupStatus {
  const files = listAutoBackups();
  const last = files[files.length - 1];
  return {
    folder: getBackupsDir(),
    lastAutoBackup: last ? describeBackup(last) : null,
    autoBackupCount: files.length,
  };
}

/** How long ago the newest auto backup was written, or Infinity when there is none. */
function newestBackupAgeMs(): number {
  const last = listAutoBackups().pop();
  if (!last) return Infinity;
  try {
    return Date.now() - fs.statSync(path.join(getBackupsDir(), last.file)).mtimeMs;
  } catch {
    return Infinity;
  }
}

/** Thin the folder out: see the note at the top of this file for what stays. */
function pruneAutoBackups(): void {
  const dir = getBackupsDir();
  const byDay = new Map<string, ParsedBackupName[]>();
  for (const b of listAutoBackups()) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);
  const days = [...byDay.keys()].sort();
  const keptDays = new Set(days.slice(-AUTO_BACKUP_KEEP_DAYS));
  const allDays = new Set(days.slice(-AUTO_BACKUP_KEEP_ALL_DAYS));
  for (const [day, files] of byDay) {
    const stale = !keptDays.has(day)
      ? files // older than the retention window: all of it
      : allDays.has(day)
        ? [] // recent: every run stays
        : files.slice(0, -1); // in between: only the day's last file
    for (const b of stale) {
      fs.unlinkSync(path.join(dir, b.file));
      log.info(`[BACKUP] Pruned old auto backup: ${b.file}`);
    }
  }
}

/**
 * Outcome of the off-site push. 'disabled' means this machine has no upload
 * config — the normal state for untrusted installs, so it must read as "fine",
 * not as a failure. 'failed' is the one the user has to see.
 */
export type BackupUploadStatus = 'uploaded' | 'failed' | 'disabled';

export interface AutoBackupResult {
  filePath: string;
  date: string; // YYYY-MM-DD
  upload: BackupUploadStatus;
}

/** True while a backup is being written, so two never run at once. */
let backupInFlight = false;

/**
 * Write a new auto backup, then thin the folder out (see the note at the top).
 *
 * Without `force` this is the SCHEDULED run: it does nothing unless the newest
 * backup is at least AUTO_BACKUP_INTERVAL_MS old, which is what makes it safe to
 * call every few minutes — and to call at startup, where it covers the gap left
 * by a session that crashed before its exit backup. The exit backup passes
 * `force` to capture the session's last changes whatever the clock says.
 * Never throws — a failed backup (e.g. no Supabase session yet) must not break
 * app startup or shutdown. Returns null when skipped or failed.
 */
export async function runAutoBackup(
  database: DatabaseService,
  opts: { force?: boolean } = {},
): Promise<AutoBackupResult | null> {
  if (!opts.force && newestBackupAgeMs() < AUTO_BACKUP_INTERVAL_MS) return null;
  // A scheduled run yields to one already under way; the exit backup does not
  // skip, since it may be the last chance to save the session's changes.
  if (backupInFlight && !opts.force) return null;
  backupInFlight = true;
  try {
    const dir = getBackupsDir();
    const { date: today, time } = localStamp();
    const target = path.join(dir, `${AUTO_BACKUP_PREFIX}${today}-${time}.json`);

    const backup = await database.exportFullBackup(app.getVersion());
    fs.mkdirSync(dir, { recursive: true });
    // Write via a temp file so a crash mid-write can't leave a truncated backup.
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(backup, null, 2), 'utf-8');
    fs.renameSync(tmp, target);
    log.info(`[BACKUP] Auto backup written: ${target}`);

    pruneAutoBackups();

    // Off-site copy: push the file to the private backups repo. Failure is
    // logged and reported back but never fails the backup itself (offline,
    // no token, …) — the local file is already safe on disk by now.
    // One remote file per DAY, overwritten by each run: the repo's own git history
    // keeps every version, and a file per run would grow it six times as fast.
    const upload = await uploadBackupToRepo(target, `${AUTO_BACKUP_PREFIX}${today}.json`);

    return { filePath: target, date: `${today} ${time.slice(0, 2)}:${time.slice(2)}`, upload };
  } catch (error) {
    log.warn(`[BACKUP] Auto backup skipped: ${error instanceof Error ? error.message : error}`);
    return null;
  } finally {
    backupInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Off-site upload — GitHub Contents API
//
// The backup holds personal data (resident names, account numbers, NIPs), so
// it must ONLY ever go to a PRIVATE repo. The token is deliberately NOT baked
// into CI builds: release binaries are public, and a bundled token would let
// anyone read the backups repo. Instead each trusted machine gets a local
// config/backup-config.yml (gitignored), or the env vars.

interface BackupUploadConfig {
  token: string;
  /** owner/name, e.g. "wikunia-pura/statement-converter-backups" */
  repo: string;
}

function loadUploadConfig(): BackupUploadConfig | null {
  try {
    const configPath = path.join(app.getAppPath(), 'config', 'backup-config.yml');
    if (fs.existsSync(configPath)) {
      const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as {
        backup?: { github_token?: string; github_repo?: string };
      };
      const token = parsed?.backup?.github_token?.trim();
      const repo = parsed?.backup?.github_repo?.trim();
      if (token && repo) return { token, repo };
    }
  } catch (error) {
    log.warn(`[BACKUP] Cannot read backup-config.yml: ${error instanceof Error ? error.message : error}`);
  }
  const token = process.env.BACKUP_GITHUB_TOKEN?.trim();
  const repo = process.env.BACKUP_GITHUB_REPO?.trim();
  if (token && repo) return { token, repo };
  return null;
}

async function githubApi(
  cfg: BackupUploadConfig,
  method: 'GET' | 'PUT',
  remotePath: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`https://api.github.com/repos/${cfg.repo}/contents/${remotePath}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'FileFunky-backup',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * Create or update `<hostname>/<remoteName>` in the configured private repo.
 * Per-machine folders keep several installations from clobbering each other.
 */
async function uploadBackupToRepo(
  filePath: string,
  remoteName: string,
): Promise<BackupUploadStatus> {
  const cfg = loadUploadConfig();
  if (!cfg) return 'disabled'; // upload not configured on this machine — fine
  try {
    const remotePath = `${os.hostname()}/${remoteName}`;

    // Updating an existing file requires its current blob sha.
    let sha: string | undefined;
    const existing = await githubApi(cfg, 'GET', remotePath);
    if (existing.ok) {
      sha = ((await existing.json()) as { sha?: string }).sha;
    } else if (existing.status !== 404) {
      throw new Error(`GET ${remotePath}: HTTP ${existing.status}`);
    }

    const put = await githubApi(cfg, 'PUT', remotePath, {
      message: `Auto backup ${remoteName} (${os.hostname()})`,
      content: fs.readFileSync(filePath).toString('base64'),
      ...(sha ? { sha } : {}),
    });
    if (!put.ok) {
      throw new Error(`PUT ${remotePath}: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
    }
    log.info(`[BACKUP] Uploaded to ${cfg.repo}/${remotePath}`);
    return 'uploaded';
  } catch (error) {
    log.warn(`[BACKUP] Repo upload failed: ${error instanceof Error ? error.message : error}`);
    return 'failed';
  }
}
