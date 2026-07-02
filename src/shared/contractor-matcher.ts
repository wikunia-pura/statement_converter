/**
 * Shared Contractor Matcher
 * Matches transaction descriptions with contractors from database.
 * Converter-independent — operates on AITransaction (descBase/descOpt).
 *
 * Performance: every string derived purely from a contractor (lowercased +
 * normalized name, whitespace-stripped variant, NIP digits, fuzzy word lists)
 * is precomputed ONCE per contractor in the constructor — not recomputed for
 * every transaction. Type-filtered pools are memoized. This turns the hot path
 * from O(transactions · contractors · nameLength) of regex re-normalization into
 * O(contractors) of one-time setup + cheap substring/Set lookups per transaction.
 */

import { AITransaction, MatchedContractor } from './ai-types';
import { Kontrahent, KontrahentTyp } from './types';

export type { MatchedContractor } from './ai-types';

/** Precomputed, transaction-independent derived data for one alternative name. */
interface DerivedAlt {
  /** normalizeText(altName.toLowerCase()) */
  norm: string;
  /** norm with all whitespace removed */
  noSpace: string;
  /** altName.toLowerCase() split into words of length > 2 (for fuzzy matching) */
  words: string[];
}

/** Precomputed, transaction-independent derived data for one contractor. */
interface DerivedContractor {
  contractor: Kontrahent;
  typy: KontrahentTyp[];
  /** contractor.nip with spaces/hyphens stripped; '' when no NIP. */
  nipDigits: string;
  /** normalizeText(nazwa.toLowerCase()) */
  nameNorm: string;
  /** nameNorm with all whitespace removed */
  nameNoSpace: string;
  /** nazwa.toLowerCase() split into words of length > 2 (for fuzzy matching) */
  nameWords: string[];
  alts: DerivedAlt[];
}

export class ContractorMatcher {
  private derived: DerivedContractor[];
  /** Memoized type-filtered pools, keyed by the sorted allowed-types set. */
  private poolCache = new Map<string, DerivedContractor[]>();

  constructor(contractors: Kontrahent[]) {
    this.derived = contractors.map(c => this.deriveContractor(c));
  }

  private deriveContractor(contractor: Kontrahent): DerivedContractor {
    const nameLower = contractor.nazwa.toLowerCase();
    const nameNorm = this.normalizeText(nameLower);
    const alts: DerivedAlt[] = (contractor.alternativeNames ?? []).map(altName => {
      const altLower = altName.toLowerCase();
      const norm = this.normalizeText(altLower);
      return {
        norm,
        noSpace: norm.replace(/\s/g, ''),
        words: altLower.split(/\s+/).filter(w => w.length > 2),
      };
    });
    return {
      contractor,
      typy: contractor.typy && contractor.typy.length > 0 ? contractor.typy : ['Kontrahent'],
      nipDigits: contractor.nip && contractor.nip.trim() ? contractor.nip.replace(/[\s-]/g, '') : '',
      nameNorm,
      nameNoSpace: nameNorm.replace(/\s/g, ''),
      nameWords: nameLower.split(/\s+/).filter(w => w.length > 2),
      alts,
    };
  }

  /**
   * Return the precomputed pool that holds at least one of `allowedTypes`. A
   * contractor can carry several roles (`typy`), so a company that is both
   * `Kontrahent` and `Pozostałe przychody` qualifies for both the expense and
   * income pools. Missing/empty `typy` is treated as `['Kontrahent']`.
   * Results are memoized so the filter+Set allocation happens once per set.
   */
  private filterByTypes(allowedTypes?: KontrahentTyp[]): DerivedContractor[] {
    if (!allowedTypes || allowedTypes.length === 0) return this.derived;
    const key = [...allowedTypes].sort().join('|');
    const cached = this.poolCache.get(key);
    if (cached) return cached;
    const allowed = new Set(allowedTypes);
    const pool = this.derived.filter(d => d.typy.some(t => allowed.has(t)));
    this.poolCache.set(key, pool);
    return pool;
  }

  /**
   * Normalize text for fuzzy matching
   * Removes punctuation and normalizes whitespace
   */
  private normalizeText(text: string): string {
    return text
      .replace(/[.,;:\-_]/g, ' ')  // Replace punctuation with spaces
      .replace(/\s+/g, ' ')          // Normalize multiple spaces to single space
      .trim();                        // Remove leading/trailing spaces
  }

  /**
   * Levenshtein (edit) distance using two rolling rows — O(min(m,n)) memory and
   * no per-call 2D matrix allocation, which matters because fuzzyMatch invokes
   * this for every word pair of every candidate.
   */
  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    let prev = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      const ai = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
    }

    return prev[n];
  }

  /**
   * Check fuzzy match between two pre-split word lists.
   * Returns score based on similarity (0 = no match, 85-95 = fuzzy match).
   * If any word pair has >75% similarity (Levenshtein-based), returns fuzzy match score.
   */
  private fuzzyMatchWords(contractorWords: string[], searchWords: string[]): number {
    let bestScore = 0;

    for (const cWord of contractorWords) {
      for (const sWord of searchWords) {
        // Skip if length difference is too large (optimization)
        if (Math.abs(cWord.length - sWord.length) > 3) continue;

        const distance = this.levenshteinDistance(cWord, sWord);
        const maxLen = Math.max(cWord.length, sWord.length);
        const similarity = 1 - (distance / maxLen);

        // If similarity > 75%, consider it a fuzzy match
        if (similarity > 0.75) {
          // Score: 85-95 based on similarity (0.75 -> 85, 1.0 -> 95)
          const score = 85 + Math.floor((similarity - 0.75) * 40);
          bestScore = Math.max(bestScore, score);
          if (bestScore >= 95) return bestScore; // can't do better
        }
      }
    }

    return bestScore;
  }

  /**
   * Match transaction with contractor
   * Priority: desc-opt > desc-base
   *
   * When `allowedTypes` is provided, only contractors with those typ values are considered.
   * This enforces the semantic rule: expense pipeline rejects 'Pozostałe przychody',
   * income pipeline only considers 'Pozostałe przychody'.
   */
  match(transaction: AITransaction, allowedTypes?: KontrahentTyp[]): MatchedContractor {
    const pool = this.filterByTypes(allowedTypes);

    // Try desc-opt first (higher priority)
    if (transaction.descOpt && transaction.descOpt.trim() !== '') {
      const match = this.findBestMatch(transaction.descOpt, pool);
      if (match.contractor) {
        return {
          ...match,
          matchedIn: 'desc-opt',
        };
      }
    }

    // Try desc-base
    const match = this.findBestMatch(transaction.descBase, pool);
    if (match.contractor) {
      return {
        ...match,
        matchedIn: 'desc-base',
      };
    }

    // No match found
    return {
      contractor: null,
      confidence: 0,
      matchedIn: 'none',
    };
  }

  /**
   * Return the full contractor catalog filtered by typ.
   * Used as an AI fallback pool when fuzzy pre-filtering surfaces no candidates
   * (e.g. names corrupted by 35-char line wrapping that inject spaces into a name),
   * so the AI can still match instead of being forced to return null.
   */
  getAllByTypes(allowedTypes?: KontrahentTyp[]): Kontrahent[] {
    return this.filterByTypes(allowedTypes).map(d => d.contractor);
  }

  /**
   * Get top N candidate contractors for a transaction (for AI pre-filtering)
   * Returns the most likely contractors based on matching (exact and fuzzy)
   * Score priority: NIP (110) > Main name = Alternative names (100 - EQUAL) > Fuzzy match (85-95)
   */
  getTopCandidates(
    transaction: AITransaction,
    topN: number = 10,
    allowedTypes?: KontrahentTyp[]
  ): Kontrahent[] {
    const pool = this.filterByTypes(allowedTypes);

    // Combine desc-opt and desc-base for searching. All of these depend only on
    // the transaction, so compute them ONCE (not per contractor).
    const searchText = `${transaction.descOpt || ''} ${transaction.descBase}`.toLowerCase();
    const searchTextNormalized = this.normalizeText(searchText);
    const searchNoSpace = searchTextNormalized.replace(/\s/g, '');
    const searchNipNormalized = searchText.replace(/[\s-]/g, '');
    const searchWords = searchText.split(/\s+/).filter(w => w.length > 2);

    // Score all contractors
    const scored = pool.map(d => {
      let score = 0;

      // HIGHEST PRIORITY: Check NIP (full match required) - Score: 110
      if (d.nipDigits) {
        if (searchNipNormalized.includes(d.nipDigits)) {
          score = 110;
        }
      }

      // If NIP not matched, check main name - Score: 100
      if (score === 0) {
        if (searchTextNormalized.includes(d.nameNorm)) {
          score = 100;
        }
      }

      // If main name not matched, check alternative names - Score: 100 (SAME as main name!)
      if (score === 0 && d.alts.length > 0) {
        for (const alt of d.alts) {
          if (searchTextNormalized.includes(alt.norm)) {
            score = 100;
            break;
          }
        }
      }

      // Space-insensitive full-name match - Score: 98 (just below exact name)
      // Handles names mangled by fixed-width line wrapping ("Sp"→"S p",
      // "Dudziński"→"Dud ziński"). Stricter than fuzzy: requires the whole name
      // contiguous once whitespace is removed.
      if (score === 0) {
        if (d.nameNoSpace.length >= 8 && searchNoSpace.includes(d.nameNoSpace)) {
          score = 98;
        }
        if (score === 0 && d.alts.length > 0) {
          for (const alt of d.alts) {
            if (alt.noSpace.length >= 8 && searchNoSpace.includes(alt.noSpace)) {
              score = 98;
              break;
            }
          }
        }
      }

      // If exact match not found, try fuzzy matching - Score: 85-95
      // This catches typos and similar names (e.g., "Gontarek" vs "Guntarek")
      if (score === 0) {
        // Try fuzzy match on main name
        score = this.fuzzyMatchWords(d.nameWords, searchWords);

        // If main name fuzzy match weak, try alternative names
        if (score < 90 && d.alts.length > 0) {
          for (const alt of d.alts) {
            const altScore = this.fuzzyMatchWords(alt.words, searchWords);
            score = Math.max(score, altScore);
            if (score >= 90) break; // Good enough, stop checking
          }
        }
      }

      return { contractor: d.contractor, score };
    });

    // Sort by score (highest first) and take top N
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(s => s.contractor);
  }

  /**
   * Find best matching contractor in description
   * Priority order checked: NIP (highest) > Main name = Alternative names (EQUAL) > Word-based
   */
  private findBestMatch(
    description: string,
    pool: DerivedContractor[],
  ): Omit<MatchedContractor, 'matchedIn'> {
    const descLower = description.toLowerCase();
    const descNormalizedText = this.normalizeText(descLower);
    // Whitespace-stripped variant, for matching names mangled by fixed-width
    // line wrapping that injects spaces mid-word (see FOURTH check below).
    const descNoSpace = descNormalizedText.replace(/\s/g, '');
    // NIP comparison strips only spaces/hyphens (keeps other chars) — computed
    // once here, not per contractor.
    const descNipNormalized = descLower.replace(/[\s-]/g, '');
    let bestMatch: Kontrahent | null = null;
    let bestConfidence = 0;
    let matchedText = '';

    for (const d of pool) {
      const contractor = d.contractor;

      // FIRST: Check NIP (highest priority - full match required)
      if (d.nipDigits) {
        if (descNipNormalized.includes(d.nipDigits)) {
          const confidence = descNipNormalized === d.nipDigits ? 100 : 98;

          if (confidence > bestConfidence) {
            bestMatch = contractor;
            bestConfidence = confidence;
            matchedText = `NIP: ${contractor.nip}`;
          }
        }
      }

      // SECOND: Check main name (with normalization)
      if (descNormalizedText.includes(d.nameNorm)) {
        const confidence = this.calculateConfidence(d.nameNorm, descNormalizedText);

        if (confidence > bestConfidence) {
          bestMatch = contractor;
          bestConfidence = confidence;
          matchedText = contractor.nazwa;
        }
      }

      // THIRD: Check alternative names (SAME confidence as main name, with normalization)
      if (d.alts.length > 0) {
        for (let i = 0; i < d.alts.length; i++) {
          const alt = d.alts[i];
          if (descNormalizedText.includes(alt.norm)) {
            const confidence = this.calculateConfidence(alt.norm, descNormalizedText);

            if (confidence > bestConfidence) {
              bestMatch = contractor;
              bestConfidence = confidence;
              matchedText = contractor.alternativeNames![i];
            }
          }
        }
      }

      // FOURTH: space-insensitive match — handles names mangled by fixed-width
      // line wrapping that injects spaces mid-word (e.g. "Sp"→"S p",
      // "Dudziński"→"Dud ziński"). Match the full name as a contiguous substring
      // with all whitespace removed. The min-length guard avoids short-name false
      // positives; requiring the whole name contiguous makes this stricter than fuzzy.
      if (bestConfidence < 88) {
        if (d.nameNoSpace.length >= 8 && descNoSpace.includes(d.nameNoSpace)) {
          bestMatch = contractor;
          bestConfidence = 88;
          matchedText = contractor.nazwa;
        }
      }
      if (bestConfidence < 88 && d.alts.length > 0) {
        for (let i = 0; i < d.alts.length; i++) {
          const alt = d.alts[i];
          if (alt.noSpace.length >= 8 && descNoSpace.includes(alt.noSpace)) {
            bestMatch = contractor;
            bestConfidence = 88;
            matchedText = contractor.alternativeNames![i];
            break;
          }
        }
      }

      // Word-based matching DISABLED - too aggressive and unreliable
      // Only exact matches (NIP, full name, alternative names) are used
    }

    return {
      contractor: bestMatch,
      confidence: bestConfidence,
      matchedText,
    };
  }

  /**
   * Calculate confidence score for a match
   * Used for BOTH main name and alternative names (ensures EQUAL confidence)
   */
  private calculateConfidence(contractorName: string, description: string): number {
    if (description === contractorName) return 100;
    if (description.startsWith(contractorName)) return 95;
    if (description.endsWith(contractorName)) return 90;

    const ratio = contractorName.length / description.length;
    if (ratio > 0.8) return 85;
    if (ratio > 0.5) return 80;
    return 75;
  }
}
