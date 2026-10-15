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
 *
 * An entry the user overrules in the acceptance screen (rejected, or replaced by
 * another contractor) is deleted when the conversion is finalized, so the same
 * wrong answer is not served again next month.
 *
 * Each entry also carries a fingerprint of the contractor it names (see
 * contractorFingerprint), and stops being served once that contractor's
 * matching data changed. Other entries are untouched: editing one contractor
 * used to throw the whole cache away, and every recurring vendor went back to
 * the AI the next month.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface MatchCacheValue {
  contractorId: number;
  confidence: number;
  matchedIn: 'desc-opt' | 'desc-base' | 'none';
  reasoning?: string;
}

/** What the cache needs to know of a contractor. */
export type MatchCacheContractor = {
  id: number;
  nazwa?: string;
  alternativeNames?: string[];
  typy?: string[];
  nip?: string;
};

/**
 * Identity of one contractor as far as matching reads it: name, alternative
 * names, roles (`typy`) and NIP. An entry naming this contractor is served only
 * while it is unchanged — renamed, given another alternative name or NIP, or
 * moved between expense and income roles, the description may no longer be its.
 * An account change needs no detecting: reads re-resolve the id, so the current
 * account is booked anyway.
 *
 * Deliberately not covered: a contractor *added* after an entry was written, who
 * might have been the better match for it. That is the price of not discarding
 * the whole cache on every edit, and it is small — the deterministic matcher runs
 * before the cache, so a new contractor whose name is in the text wins at once;
 * only a match that only the AI could make stays as cached, until the user
 * overrules it in the review (which deletes it) or it expires.
 */
export function contractorFingerprint(c: MatchCacheContractor): string {
  const canonical = [
    c.nazwa ?? '',
    [...(c.alternativeNames ?? [])].sort(),
    [...(c.typy ?? [])].sort(),
    c.nip ?? '',
  ];
  return crypto.createHash('sha1').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

/**
 * The whole-set fingerprint files written before per-entry fingerprints carried
 * (count and highest id: it changed whenever a contractor was added). Read only
 * to decide whether such a file's entries are still as valid as they were.
 */
function legacySetFingerprint(contractors: MatchCacheContractor[]): string {
  let maxId = 0;
  for (const c of contractors) if (c.id > maxId) maxId = c.id;
  return `${contractors.length}:${maxId}`;
}

interface MatchCacheEntry extends MatchCacheValue {
  key: string;
  timestamp: Date;
  usageCount: number;
  /** contractorFingerprint of the contractor when the entry was written. */
  fp?: string;
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
  /** contractorFingerprint by contractor id; undefined when no list was given. */
  private fingerprints?: Map<number, string>;
  private legacyFingerprint?: string;
  /** The whole-set fingerprint the file was read with (see legacySetFingerprint). */
  private storedLegacyFingerprint?: string;

  /**
   * @param contractors The current contractor list. An entry is served only while
   *   its contractor is on it with the fingerprint the entry was written with.
   *   Omit it to skip the check (a cache opened only to delete entries).
   */
  constructor(persistPath?: string, contractors?: MatchCacheContractor[]) {
    this.persistPath = persistPath;
    if (contractors) {
      this.fingerprints = new Map(contractors.map((c) => [c.id, contractorFingerprint(c)]));
      this.legacyFingerprint = legacySetFingerprint(contractors);
    }
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

    if (this.fingerprints) {
      const current = this.fingerprints.get(entry.contractorId);
      // Contractor gone (or not in this list): a miss, but the entry stays — a
      // list that came back incomplete must not cost the cache its entries, and
      // a deleted contractor's entry expires on its own.
      if (current === undefined) return null;
      // Its matching data changed since: this answer is stale for good.
      if (entry.fp !== current) {
        this.cache.delete(key);
        this.scheduleSave();
        return null;
      }
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
    // A contractor missing from the list could never be served back.
    if (this.fingerprints && !this.fingerprints.has(value.contractorId)) return;
    const key = this.getCacheKey(descBase, descOpt);
    this.cache.set(key, {
      key,
      ...value,
      timestamp: new Date(),
      usageCount: 1,
      fp: this.fingerprints?.get(value.contractorId),
    });
    this.scheduleSave();
  }

  /** Forget the match cached for this description. True when there was one. */
  delete(descBase: string, descOpt: string): boolean {
    const removed = this.cache.delete(this.getCacheKey(descBase, descOpt));
    if (removed) this.scheduleSave();
    return removed;
  }

  /** Write pending changes now instead of after the debounce. */
  flush(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.saveToDisk();
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
      this.storedLegacyFingerprint = stored.fingerprint;

      // Entries written before per-entry fingerprints (no `fp`) were valid as long
      // as the file's whole-set fingerprint matched — no contractor added since.
      // When it still does, they are adopted with their contractor's current
      // fingerprint; otherwise only they are dropped, as that version would have
      // dropped them. Without a contractor list nothing can be decided, and they
      // are kept as they are.
      const adoptLegacy = !!this.fingerprints && stored.fingerprint === this.legacyFingerprint;

      const now = Date.now();
      let loaded = 0;
      let expired = 0;
      let legacyDropped = 0;
      for (const entry of entries) {
        if (!entry?.key || typeof entry.contractorId !== 'number' || !entry?.timestamp) continue;
        const ts = new Date(entry.timestamp);
        if (now - ts.getTime() > this.maxAge) {
          expired++;
          continue;
        }
        let fp: string | undefined = typeof entry.fp === 'string' ? entry.fp : undefined;
        if (fp === undefined && this.fingerprints) {
          fp = adoptLegacy ? this.fingerprints.get(entry.contractorId) : undefined;
          if (fp === undefined) {
            legacyDropped++;
            continue;
          }
        }
        this.cache.set(entry.key, {
          key: entry.key,
          contractorId: entry.contractorId,
          confidence: entry.confidence ?? 0,
          matchedIn: entry.matchedIn ?? 'none',
          reasoning: entry.reasoning,
          timestamp: ts,
          usageCount: entry.usageCount ?? 1,
          fp,
        });
        loaded++;
      }
      if (legacyDropped > 0) this.scheduleSave();
      if (loaded > 0 || expired > 0 || legacyDropped > 0) {
        console.log(
          `📦 MatchCache loaded ${loaded} entries from disk (${expired} expired, ` +
            `${legacyDropped} unverifiable old-format entries skipped)`,
        );
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
        fp: e.fp,
      }));
      // Temp file + rename, like ExtractionCache: a crash mid-write must not
      // leave a truncated file behind.
      const tmp = `${this.persistPath}.tmp`;
      fs.writeFileSync(
        tmp,
        // `fingerprint` is the legacy whole-set one, kept only for entries still
        // without `fp` — which only a cache opened without a contractor list has.
        JSON.stringify(
          { fingerprint: this.fingerprints ? undefined : this.storedLegacyFingerprint, entries },
          null,
          2,
        ),
        'utf-8',
      );
      fs.renameSync(tmp, this.persistPath);
    } catch (e) {
      console.warn('MatchCache: failed to save to disk:', e);
    }
  }
}
