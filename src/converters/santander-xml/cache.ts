/**
 * Cache system for extraction results
 * Reduces API calls by caching previously extracted data
 */

import { ExtractedData, CacheEntry } from './types';

export class ExtractionCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxAge: number = 30 * 24 * 60 * 60 * 1000; // 30 days

  /**
   * Generate cache key from desc fields
   */
  private getCacheKey(descBase: string, descOpt: string): string {
    // Normalize and create hash
    const normalized = `${descBase.toLowerCase().trim()}|${descOpt.toLowerCase().trim()}`;
    return normalized;
  }

  /**
   * Get cached extraction if exists
   */
  get(descBase: string, descOpt: string): ExtractedData | null {
    const key = this.getCacheKey(descBase, descOpt);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if cache entry is too old
    const age = Date.now() - entry.timestamp.getTime();
    if (age > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    // Update usage count
    entry.usageCount++;

    return {
      ...entry.extracted,
      extractionMethod: 'cache',
    };
  }

  /**
   * Save extraction to cache
   */
  set(descBase: string, descOpt: string, extracted: ExtractedData): void {
    const key = this.getCacheKey(descBase, descOpt);
    
    this.cache.set(key, {
      key,
      extracted,
      timestamp: new Date(),
      usageCount: 1,
    });
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

    return removed;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
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
}
