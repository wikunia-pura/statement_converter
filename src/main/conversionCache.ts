/**
 * Cache for pending conversions awaiting user review.
 *
 * The full processed transaction set (including auto-approved rows the renderer
 * never sees) lives ONLY here between `convert` and `finalizeConversion`, so
 * losing an entry means the user has to re-upload and re-review everything.
 * To make that as unlikely as possible the cache:
 *   - keeps entries for several hours (not 30 min),
 *   - uses sliding expiration: reading or touching an entry resets its clock,
 *     so an open review screen (which heartbeats) never expires mid-review,
 *   - persists to disk in userData so it survives a main-process restart
 *     (e.g. an auto-update relaunch) while a review is open.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';

interface CachedConversion {
  id: string;
  fileName: string;
  bankName: string;
  converterId: string;
  inputPath: string;
  outputPath: string;
  processedTransactions: any[];
  previewOutput: string;
  /** Accounting symbols chosen for this conversion (bank-account side + apartment prefix). */
  accountConfig?: { bankAccountSymbol: string; apartmentPrefix: string };
  createdAt: Date;
  /** Sliding-expiration timestamp; refreshed on every read/touch. */
  lastAccessedAt: Date;
}

class ConversionCache {
  private cache: Map<string, CachedConversion> = new Map();
  // A manual review of a statement with many low-confidence transactions can
  // easily run past half an hour, or be left open over a break. Sliding
  // expiration keeps an actively-reviewed entry alive regardless; this TTL is
  // only the ceiling for an abandoned entry.
  private readonly CACHE_EXPIRY_MS = 6 * 60 * 60 * 1000; // 6 hours
  private loaded = false;

  constructor() {
    // Periodic sweep so a lone conversion that's never followed by another
    // doesn't keep its (potentially large) processedTransactions payload in
    // memory indefinitely. unref() so this timer never keeps the app alive.
    const timer = setInterval(() => {
      this.ensureLoaded();
      this.cleanupExpired();
    }, 5 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** Path to the on-disk snapshot, resolved lazily (needs app to be ready). */
  private storePath(): string | null {
    try {
      return path.join(app.getPath('userData'), 'pending-conversions.json');
    } catch {
      return null;
    }
  }

  /** Load persisted entries once, dropping anything already expired. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;

    const file = this.storePath();
    if (!file) return;

    try {
      if (!fs.existsSync(file)) return;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as any[];
      const now = Date.now();
      for (const entry of raw) {
        const createdAt = new Date(entry.createdAt);
        const lastAccessedAt = new Date(entry.lastAccessedAt ?? entry.createdAt);
        if (now - lastAccessedAt.getTime() > this.CACHE_EXPIRY_MS) continue;
        this.cache.set(entry.id, { ...entry, createdAt, lastAccessedAt });
      }
      log.info(`[ConversionCache] Restored ${this.cache.size} pending conversion(s) from disk`);
    } catch (err) {
      log.warn(`[ConversionCache] Failed to restore from disk: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Write the current cache to disk (best-effort; failures are non-fatal). */
  private persist(): void {
    const file = this.storePath();
    if (!file) return;

    try {
      const entries = Array.from(this.cache.values()).map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        lastAccessedAt: c.lastAccessedAt.toISOString(),
      }));
      fs.writeFileSync(file, JSON.stringify(entries), 'utf8');
    } catch (err) {
      log.warn(`[ConversionCache] Failed to persist to disk: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Generate unique ID for conversion
   */
  generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Store conversion data
   */
  store(
    fileName: string,
    bankName: string,
    converterId: string,
    inputPath: string,
    outputPath: string,
    processedTransactions: any[],
    previewOutput: string,
    accountConfig?: { bankAccountSymbol: string; apartmentPrefix: string }
  ): string {
    this.ensureLoaded();
    const id = this.generateId();
    const now = new Date();

    this.cache.set(id, {
      id,
      fileName,
      bankName,
      converterId,
      inputPath,
      outputPath,
      processedTransactions,
      previewOutput,
      accountConfig,
      createdAt: now,
      lastAccessedAt: now,
    });

    // Clean up expired entries
    this.cleanupExpired();
    this.persist();

    return id;
  }

  /**
   * Retrieve conversion data. Reading refreshes the sliding-expiration clock.
   */
  get(id: string): CachedConversion | null {
    this.ensureLoaded();
    const cached = this.cache.get(id);

    if (!cached) {
      return null;
    }

    // Check if expired (measured from last access, not creation)
    const age = Date.now() - cached.lastAccessedAt.getTime();
    if (age > this.CACHE_EXPIRY_MS) {
      this.cache.delete(id);
      this.persist();
      return null;
    }

    cached.lastAccessedAt = new Date();
    this.persist();
    return cached;
  }

  /**
   * Refresh an entry's sliding-expiration clock without reading it.
   * Called periodically by the renderer while a review screen is open so a
   * long/interrupted review never expires. Returns false if the entry is gone.
   */
  touch(id: string): boolean {
    this.ensureLoaded();
    const cached = this.cache.get(id);
    if (!cached) return false;

    const age = Date.now() - cached.lastAccessedAt.getTime();
    if (age > this.CACHE_EXPIRY_MS) {
      this.cache.delete(id);
      this.persist();
      return false;
    }

    cached.lastAccessedAt = new Date();
    this.persist();
    return true;
  }

  /**
   * Remove conversion from cache
   */
  remove(id: string): boolean {
    this.ensureLoaded();
    const removed = this.cache.delete(id);
    if (removed) this.persist();
    return removed;
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, cached] of this.cache.entries()) {
      const age = now - cached.lastAccessedAt.getTime();
      if (age > this.CACHE_EXPIRY_MS) {
        this.cache.delete(id);
        changed = true;
      }
    }

    if (changed) this.persist();
  }

  /**
   * Get cache size (for debugging)
   */
  size(): number {
    this.ensureLoaded();
    return this.cache.size;
  }

  /**
   * Clear all cache (for testing)
   */
  clear(): void {
    this.cache.clear();
    this.persist();
  }
}

// Singleton instance
export const conversionCache = new ConversionCache();
