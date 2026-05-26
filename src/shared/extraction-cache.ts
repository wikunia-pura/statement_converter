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

export class ExtractionCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxAge: number = 30 * 24 * 60 * 60 * 1000; // 30 days
  private persistPath?: string;
  private saveTimer?: NodeJS.Timeout;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) {
      this.loadFromDisk();
    }
  }

  /**
   * Generate cache key from desc fields
   */
  private getCacheKey(descBase: string, descOpt: string): string {
    const normalized = `${descBase.toLowerCase().trim()}|${descOpt.toLowerCase().trim()}`;
    return normalized;
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
