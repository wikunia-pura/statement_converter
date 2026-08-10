/**
 * On-disk cache of per-page extraction results, keyed by page content.
 *
 * Sending a page to the model is the only expensive step in this module, and it
 * used to be repeated for every reason imaginable: the results lived solely in
 * renderer state, so an app restart, an accidental "OCR ponownie", or re-adding
 * the same file paid full price again. Keying on the SHA-256 of the one-page PDF
 * makes every repeat free and instant, and makes a partially failed file resume
 * only the pages it still needs.
 *
 * Not part of the backup. This is derived data, not user data: every entry can
 * be rebuilt from the source PDFs, the key is a content hash so nothing here is
 * addressable without those PDFs in hand, and a restore onto another machine
 * would carry a large blob whose only value is avoiding one re-run. Losing the
 * directory costs money and minutes, never information — which is why it is
 * deliberately absent from `BackupData` rather than overlooked.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import logger from '../../shared/logger';
import type { PropertyData } from './extractor';
import type { ZaliczkiWarning } from './validator';

/**
 * Bump when a change to the prompt or the parsing rules would make previously
 * cached answers wrong or stale. Entries from other versions are ignored, so a
 * bump silently invalidates the cache instead of serving outdated extractions.
 */
export const PROMPT_VERSION = 2;

export interface CachedPage {
  promptVersion: number;
  /** Model that produced this answer, after any escalation. */
  model: string;
  month: number | null;
  year: number | null;
  properties: PropertyData[];
  warnings: ZaliczkiWarning[];
  /** ISO timestamp, used for pruning. */
  storedAt: string;
}

/** Entries untouched for this long are pruned on startup. */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

let cacheDir: string | null = null;
let pruned = false;

function dir(): string | null {
  if (cacheDir) return cacheDir;
  try {
    // Overridable so the accuracy harness (scripts/zaliczki-eval.ts) gets a real
    // cache while running outside Electron, where `app` does not exist. `||` so an
    // empty value falls through to the app path instead of writing to the cwd.
    const resolved =
      process.env.ZALICZKI_CACHE_DIR || path.join(app.getPath('userData'), 'zaliczki-cache');
    fs.mkdirSync(resolved, { recursive: true });
    cacheDir = resolved;
    return resolved;
  } catch (err) {
    logger.warn(
      `[ZALICZKI] Nie udało się przygotować katalogu cache: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

/**
 * One file per page keyed by content hash and model, so concurrent writes never
 * touch the same file and nothing has to be rewritten wholesale.
 */
function entryPath(base: string, sha256: string, model: string): string {
  const safeModel = model.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(base, `${sha256}.${safeModel}.json`);
}

export function readCachedPage(sha256: string, model: string): CachedPage | null {
  const base = dir();
  if (!base) return null;
  pruneOnce(base);

  const file = entryPath(base, sha256, model);
  try {
    if (!fs.existsSync(file)) return null;
    const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedPage;
    if (entry.promptVersion !== PROMPT_VERSION) return null;
    if (!Array.isArray(entry.properties)) return null;
    // Refresh mtime so pages in active use survive pruning.
    fs.utimes(file, new Date(), new Date(), () => undefined);
    return { ...entry, warnings: entry.warnings ?? [] };
  } catch (err) {
    logger.warn(
      `[ZALICZKI] Uszkodzony wpis cache ${path.basename(file)}: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

/**
 * `keyModel` is the model the caller will look this page up by — the primary
 * model chosen in the UI. It is deliberately separate from `entry.model`, which
 * records who actually answered: an escalated page is stored under the primary
 * model's key, or the next run would look under the primary key, miss, and pay
 * for the page again.
 */
export function writeCachedPage(sha256: string, keyModel: string, entry: CachedPage): void {
  const base = dir();
  if (!base) return;
  const file = entryPath(base, sha256, keyModel);
  try {
    // Write-then-rename so a crash mid-write cannot leave a truncated entry
    // that would later read back as a valid-looking result.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    logger.warn(
      `[ZALICZKI] Nie udało się zapisać cache dla strony: ${err instanceof Error ? err.message : err}`,
    );
  }
}

function pruneOnce(base: string): void {
  if (pruned) return;
  pruned = true;
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    let removed = 0;
    for (const name of fs.readdirSync(base)) {
      const file = path.join(base, name);
      const stat = fs.statSync(file);
      if (name.endsWith('.tmp') || stat.mtimeMs < cutoff) {
        fs.unlinkSync(file);
        removed++;
      }
    }
    if (removed > 0) logger.info(`[ZALICZKI] Cache: usunięto ${removed} nieużywanych wpisów`);
  } catch (err) {
    logger.warn(
      `[ZALICZKI] Porządkowanie cache nie udało się: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** Drop every cached page. Exposed for the "wyczyść cache" action and tests. */
export function clearCache(): number {
  const base = dir();
  if (!base) return 0;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(base)) {
      fs.unlinkSync(path.join(base, name));
      removed++;
    }
  } catch (err) {
    logger.warn(
      `[ZALICZKI] Czyszczenie cache nie udało się: ${err instanceof Error ? err.message : err}`,
    );
  }
  return removed;
}

export function cacheStats(): { entries: number; bytes: number } {
  const base = dir();
  if (!base) return { entries: 0, bytes: 0 };
  try {
    let entries = 0;
    let bytes = 0;
    for (const name of fs.readdirSync(base)) {
      if (name.endsWith('.tmp')) continue;
      entries++;
      bytes += fs.statSync(path.join(base, name)).size;
    }
    return { entries, bytes };
  } catch {
    return { entries: 0, bytes: 0 };
  }
}
