import { app } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs';
import os from 'os';
import yaml from 'js-yaml';
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

    // Off-site copy: push the file to the private backups repo. Failure is
    // logged and reported back but never fails the backup itself (offline,
    // no token, …) — the local file is already safe on disk by now.
    const upload = await uploadBackupToRepo(target);

    return { filePath: target, date: today, upload };
  } catch (error) {
    log.warn(`[BACKUP] Auto backup skipped: ${error instanceof Error ? error.message : error}`);
    return null;
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
 * Create or update `<hostname>/<file>` in the configured private repo.
 * Per-machine folders keep several installations from clobbering each other.
 */
async function uploadBackupToRepo(filePath: string): Promise<BackupUploadStatus> {
  const cfg = loadUploadConfig();
  if (!cfg) return 'disabled'; // upload not configured on this machine — fine
  try {
    const remotePath = `${os.hostname()}/${path.basename(filePath)}`;

    // Updating an existing file requires its current blob sha.
    let sha: string | undefined;
    const existing = await githubApi(cfg, 'GET', remotePath);
    if (existing.ok) {
      sha = ((await existing.json()) as { sha?: string }).sha;
    } else if (existing.status !== 404) {
      throw new Error(`GET ${remotePath}: HTTP ${existing.status}`);
    }

    const put = await githubApi(cfg, 'PUT', remotePath, {
      message: `Auto backup ${path.basename(filePath)} (${os.hostname()})`,
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
