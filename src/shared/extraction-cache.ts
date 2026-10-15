/**
 * Shared Extraction Cache
 * Reduces API calls by caching previously extracted data.
 * Converter-independent — operates on descBase/descOpt keys.
 *
 * When constructed with a `persistPath`, the cache is loaded from that file
 * on init (best-effort, ignores missing/corrupt files) and saved after writes
 * with a short debounce so multiple sets within one conversion coalesce into
 * a single fs write.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AIExtractedData, CacheEntry } from './ai-types';

/**
 * Which community an answer belongs to, as part of the cache key.
 *
 * The cache file is one for every bank and every community, and the same title
 * ("CZYNSZ LOKAL 12") means apartment 12 of whichever community received it — so
 * an answer must only be served back to the community it was read for. The
 * converter knows the community through the addresses it was given: one when the
 * file belongs to a community (adresId), all of them otherwise.
 *
 * "All of them" is one constant scope, not the list of their ids: keyed by the
 * list, adding a community changed the scope of every conversion run without one,
 * and all of their answers stopped being found. More than one address can only
 * mean "all" — the registry narrows to exactly one or none (with a single
 * address in the database the two cases are the same community anyway).
 */
export function extractionCacheScope(addresses: Array<{ id: number }> | undefined): string {
  const list = addresses ?? [];
  if (list.length > 1) return 'a:all';
  return list.length === 1 ? `a:${list[0].id}` : 'a:none';
}

export class ExtractionCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxAge: number = 30 * 24 * 60 * 60 * 1000; // 30 days
  private persistPath?: string;
  private saveTimer?: NodeJS.Timeout;
  private scope: string;

  /**
   * @param scope The community the answers belong to (see extractionCacheScope).
   *   Entries of other scopes in the same file are kept but never served here.
   */
  constructor(persistPath?: string, scope = 'a:none') {
    this.persistPath = persistPath;
    this.scope = scope;
    if (persistPath) {
      this.loadFromDisk();
    }
  }

  /**
   * Version of the extraction logic whose answers this cache may serve.
   *
   * Part of the key, so entries written by an older reading of the text simply
   * stop being found. Without it a fix to extraction is invisible for the 30 days
   * an entry lives: the cache is consulted *before* the regex path runs, so a
   * payer whose glued postal code was once booked as apartment 202 would keep
   * being served that 202 long after the code stopped producing it — and the fix
   * would look like it had not worked. Bump on every change to how text is read.
   *
   * v4: the key carries the community scope, and answers are paired with their
   * transaction by the index the model returned instead of the reply's order.
   */
  private static readonly KEY_VERSION = 'v4';

  /** The description part of a key, shared by every scope. */
  private static textKey(descBase: string, descOpt: string): string {
    return `${(descBase || '').toLowerCase().trim()}|${(descOpt || '').toLowerCase().trim()}`;
  }

  /**
   * Generate cache key from desc fields
   */
  private getCacheKey(descBase: string, descOpt: string): string {
    return `${ExtractionCache.KEY_VERSION}|${this.scope}|${ExtractionCache.textKey(descBase, descOpt)}`;
  }

  /**
   * Forget the answer for this description — in every community scope — so a row
   * the user corrected or rejected is asked again next time instead of being
   * served the answer the user just overruled. Returns how many entries went.
   */
  delete(descBase: string, descOpt: string): number {
    const suffix = `|${ExtractionCache.textKey(descBase, descOpt)}`;
    const prefix = `${ExtractionCache.KEY_VERSION}|`;
    let removed = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix) && key.endsWith(suffix)) {
        // The scope never contains "|", so the description part starts right
        // after the second separator and must equal the suffix exactly.
        const afterScope = key.indexOf('|', prefix.length);
        if (afterScope !== -1 && key.slice(afterScope) === suffix) {
          this.cache.delete(key);
          removed++;
        }
      }
    }
    if (removed > 0) this.scheduleSave();
    return removed;
  }

  /** Write pending changes now instead of after the debounce. */
  flush(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.saveToDisk();
  }

  /**
   * Get cached extraction if exists
   */
  get(descBase: string, descOpt: string): AIExtractedData | null {
    const key = this.getCacheKey(descBase, descOpt);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp.getTime();
    if (age > this.maxAge) {
      this.cache.delete(key);
      this.scheduleSave();
      return null;
    }

    entry.usageCount++;

    return {
      ...entry.extracted,
      extractionMethod: 'cache',
    };
  }

  /**
   * Save extraction to cache
   */
  set(descBase: string, descOpt: string, extracted: AIExtractedData): void {
    const key = this.getCacheKey(descBase, descOpt);

    this.cache.set(key, {
      key,
      extracted,
      timestamp: new Date(),
      usageCount: 1,
    });

    this.scheduleSave();
  }

  /**
   * Check if cache has entry
   */
  has(descBase: string, descOpt: string): boolean {
    const key = this.getCacheKey(descBase, descOpt);
    return this.cache.has(key);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hitRate: number;
    mostUsed: Array<{ key: string; usageCount: number }>;
  } {
    const entries = Array.from(this.cache.values());
    const totalUsage = entries.reduce((sum, entry) => sum + entry.usageCount, 0);
    const totalHits = entries.reduce((sum, entry) => sum + (entry.usageCount - 1), 0);

    return {
      size: this.cache.size,
      hitRate: totalUsage > 0 ? (totalHits / totalUsage) * 100 : 0,
      mostUsed: entries
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 10)
        .map((entry) => ({
          key: entry.key.substring(0, 50) + '...',
          usageCount: entry.usageCount,
        })),
    };
  }

  /**
   * Clear old cache entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp.getTime();
      if (age > this.maxAge) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) this.scheduleSave();
    return removed;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.scheduleSave();
  }

  /**
   * Export cache to JSON (for persistence)
   */
  export(): string {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      extracted: entry.extracted,
      timestamp: entry.timestamp.toISOString(),
      usageCount: entry.usageCount,
    }));

    return JSON.stringify(entries, null, 2);
  }

  /**
   * Import cache from JSON
   */
  import(json: string): void {
    try {
      const entries = JSON.parse(json);

      for (const entry of entries) {
        this.cache.set(entry.key, {
          key: entry.key,
          extracted: entry.extracted,
          timestamp: new Date(entry.timestamp),
          usageCount: entry.usageCount,
        });
      }
    } catch (error) {
      console.error('Failed to import cache:', error);
    }
  }

  /**
   * Load cache from disk. Best-effort: missing/corrupt files are ignored.
   * Expired entries are dropped at load time.
   */
  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) return;

      const now = Date.now();
      let loaded = 0;
      let expired = 0;
      for (const entry of entries) {
        if (!entry?.key || !entry?.extracted || !entry?.timestamp) continue;
        const ts = new Date(entry.timestamp);
        if (now - ts.getTime() > this.maxAge) {
          expired++;
          continue;
        }
        this.cache.set(entry.key, {
          key: entry.key,
          extracted: entry.extracted,
          timestamp: ts,
          usageCount: entry.usageCount ?? 1,
        });
        loaded++;
      }
      if (loaded > 0 || expired > 0) {
        console.log(
          `📦 ExtractionCache loaded ${loaded} entries from disk (${expired} expired skipped)`
        );
      }
    } catch (e) {
      console.warn('ExtractionCache: failed to load from disk:', e);
    }
  }

  /**
   * Debounced write to disk. Coalesces bursts of set() calls into one fs write.
   */
  private scheduleSave(): void {
    if (!this.persistPath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.saveToDisk();
    }, 500);
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Write to a temp file then rename for atomicity.
      const tmp = `${this.persistPath}.tmp`;
      fs.writeFileSync(tmp, this.export(), 'utf-8');
      fs.renameSync(tmp, this.persistPath);
    } catch (e) {
      console.warn('ExtractionCache: failed to save to disk:', e);
    }
  }
}
