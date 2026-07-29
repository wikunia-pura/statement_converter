/**
 * Contractor-match cache
 *
 * Expense transactions that neither the deterministic matcher nor the cache can
 * resolve go to the AI, and that call is the dominant AI cost of a conversion.
 * Housing communities pay the same vendors every month, so the same description
 * would otherwise be re-sent to the model on every statement. This cache stores
 * what the AI decided, keyed on the transaction description, exactly like
 * ExtractionCache does for the income side.
 *
 * Two deliberate design choices:
 *  - Only the contractor **id** is stored, never the whole contractor. Reads
 *    re-resolve the id against the current database, so a renamed contractor or
 *    a changed account number is picked up automatically, and a deleted one
 *    degrades to a cache miss.
 *  - Negative results (AI found no match) are **not** cached. A "no match" is
 *    precisely the case the user fixes by adding the missing contractor, and a
 *    cached null would keep hiding that new entry until the TTL expired.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface MatchCacheValue {
  contractorId: number;
  confidence: number;
  matchedIn: 'desc-opt' | 'desc-base' | 'none';
  reasoning?: string;
}

/**
 * Cheap identity of the contractor set, stored with the cache so the cache can
 * drop itself when the set changed.
 *
 * Only **additions** need detecting: a rename or an account change is already
 * handled (reads re-resolve the id), and a deletion degrades to a miss. An
 * addition is the one case a cached entry cannot notice on its own — the newly
 * added contractor might have been the better match for a description that is
 * already cached against someone else. Count plus highest id catches every
 * addition, including an add-and-delete that leaves the count unchanged, because
 * Postgres ids are monotonic.
 */
export function contractorSetFingerprint(contractors: Array<{ id: number }>): string {
  let maxId = 0;
  for (const c of contractors) if (c.id > maxId) maxId = c.id;
  return `${contractors.length}:${maxId}`;
}

interface MatchCacheEntry extends MatchCacheValue {
  key: string;
  timestamp: Date;
  usageCount: number;
}

export class MatchCache {
  private cache: Map<string, MatchCacheEntry> = new Map();
  /**
   * 180 days, deliberately longer than ExtractionCache's 30.
   *
   * Vendor invoices arrive on a monthly cycle — 28 to 31 days apart — so a
   * 30-day TTL expires an entry at almost exactly the moment the next occurrence
   * of the same payment would have used it, making a hit a coin flip. Half a year
   * spans several cycles. The staleness risk stays bounded because reads
   * re-resolve the stored id against the current database, so renames, deletions
   * and type changes are picked up regardless of the entry's age.
   */
  private maxAge: number = 180 * 24 * 60 * 60 * 1000;
  private persistPath?: string;
  private saveTimer?: NodeJS.Timeout;
  private fingerprint?: string;

  /**
   * @param fingerprint Identity of the contractor set this cache may be used
   *   with (see contractorSetFingerprint). When it differs from the one stored
   *   on disk, the cached entries are discarded instead of loaded — contractors
   *   were added since they were written, and one of them may be a better match
   *   than what a cached entry holds. Pass undefined to skip the check.
   */
  constructor(persistPath?: string, fingerprint?: string) {
    this.persistPath = persistPath;
    this.fingerprint = fingerprint;
    if (persistPath) {
      this.loadFromDisk();
    }
  }

  /** Same key shape as ExtractionCache, so a description hits both consistently. */
  private getCacheKey(descBase: string, descOpt: string): string {
    return `${descBase.toLowerCase().trim()}|${(descOpt || '').toLowerCase().trim()}`;
  }

  get(descBase: string, descOpt: string): MatchCacheValue | null {
    const key = this.getCacheKey(descBase, descOpt);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp.getTime() > this.maxAge) {
      this.cache.delete(key);
      this.scheduleSave();
      return null;
    }

    entry.usageCount++;
    return {
      contractorId: entry.contractorId,
      confidence: entry.confidence,
      matchedIn: entry.matchedIn,
      reasoning: entry.reasoning,
    };
  }

  set(descBase: string, descOpt: string, value: MatchCacheValue): void {
    const key = this.getCacheKey(descBase, descOpt);
    this.cache.set(key, {
      key,
      ...value,
      timestamp: new Date(),
      usageCount: 1,
    });
    this.scheduleSave();
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.scheduleSave();
  }

  /** Best-effort load; missing/corrupt files and expired entries are skipped. */
  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));

      // A bare array is a pre-fingerprint file: treat its provenance as unknown.
      const stored: { fingerprint?: string; entries?: unknown } = Array.isArray(parsed)
        ? { entries: parsed }
        : parsed;
      const entries = stored.entries;
      if (!Array.isArray(entries)) return;

      if (this.fingerprint && stored.fingerprint !== this.fingerprint) {
        // Contractor set changed since these were written — start clean rather
        // than serve a match that a newly added contractor may have won.
        console.log(
          `📦 MatchCache: lista kontrahentów zmieniła się (${stored.fingerprint ?? 'brak odcisku'} → ${this.fingerprint}), ` +
            `odrzucono ${entries.length} wpisów`,
        );
        this.scheduleSave();
        return;
      }

      const now = Date.now();
      let loaded = 0;
      let expired = 0;
      for (const entry of entries) {
        if (!entry?.key || typeof entry.contractorId !== 'number' || !entry?.timestamp) continue;
        const ts = new Date(entry.timestamp);
        if (now - ts.getTime() > this.maxAge) {
          expired++;
          continue;
        }
        this.cache.set(entry.key, {
          key: entry.key,
          contractorId: entry.contractorId,
          confidence: entry.confidence ?? 0,
          matchedIn: entry.matchedIn ?? 'none',
          reasoning: entry.reasoning,
          timestamp: ts,
          usageCount: entry.usageCount ?? 1,
        });
        loaded++;
      }
      if (loaded > 0 || expired > 0) {
        console.log(`📦 MatchCache loaded ${loaded} entries from disk (${expired} expired skipped)`);
      }
    } catch (e) {
      console.warn('MatchCache: failed to load from disk:', e);
    }
  }

  /** Debounced write so a burst of set() calls in one conversion is a single fs write. */
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
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const entries = Array.from(this.cache.values()).map(e => ({
        key: e.key,
        contractorId: e.contractorId,
        confidence: e.confidence,
        matchedIn: e.matchedIn,
        reasoning: e.reasoning,
        timestamp: e.timestamp.toISOString(),
        usageCount: e.usageCount,
      }));
      fs.writeFileSync(
        this.persistPath,
        JSON.stringify({ fingerprint: this.fingerprint, entries }, null, 2),
        'utf-8',
      );
    } catch (e) {
      console.warn('MatchCache: failed to save to disk:', e);
    }
  }
}
