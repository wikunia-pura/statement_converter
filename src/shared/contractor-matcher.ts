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
 *
 * Names match only as whole words of the normalized text (see normalizeText and
 * containsWords). A bare substring test used to let an alternative name "-",
 * which normalizes to nothing, match every description, and "FV" match inside
 * "FVSERWIS" — each at 95%, straight into the books.
 */

import { AITransaction, MatchedContractor } from './ai-types';
import { Kontrahent, KontrahentTyp } from './types';
import { foldText } from './text';

export type { MatchedContractor } from './ai-types';

/**
 * Shortest normalized name the matcher will look for. Below this a name is an
 * abbreviation ("FV", "SA") that occurs as a word in unrelated titles far too
 * often to book money on.
 */
const MIN_NAME_LENGTH = 3;

/**
 * A long name the bank glued to the word after it ("…SP Z O OUL LIPOWA" — fixed-
 * width fields often lose the space after a name). Found at the start of a word,
 * it is very likely that contractor, but the text is damaged, so the row is held
 * for review with this contractor already picked: one click to confirm, never
 * booked unseen. Kept below the review threshold (70) on purpose, and the
 * expense pipeline also gives such a row the 'glued-name' hold — the confidence
 * alone would not stop the Converter's "skip approval" mode, which accepts every
 * row it is handed as it stands.
 */
export const GLUED_MATCH_CONFIDENCE = 65;

/** Shortest name (letters and digits, spaces removed) trusted as a glued-on prefix. */
const GLUED_MIN_LENGTH = 12;

/** Precomputed, transaction-independent derived data for one alternative name. */
interface DerivedAlt {
  /** normalizeText(altName); '' when too short to match on (see MIN_NAME_LENGTH) */
  norm: string;
  /** norm with all whitespace removed */
  noSpace: string;
  /** norm split into words of length > 2 (for fuzzy matching) */
  words: string[];
}

/**
 * One description, normalized once and shared by every contractor it is
 * compared against.
 */
interface PreparedText {
  /** normalizeText(text), padded with a space on both ends for whole-word tests. */
  padded: string;
  /** normalizeText(text) with all whitespace removed. */
  noSpace: string;
  /** Offsets in `noSpace` where a word of the normalized text starts. */
  wordStarts: Set<number>;
  /** Offsets in `noSpace` just past the end of a word of the normalized text. */
  wordEnds: Set<number>;
  /** Words of length > 2 (for fuzzy matching). */
  words: string[];
}

/** Precomputed, transaction-independent derived data for one contractor. */
interface DerivedContractor {
  contractor: Kontrahent;
  typy: KontrahentTyp[];
  /** contractor.nip with spaces/hyphens stripped; '' when no NIP. */
  nipDigits: string;
  /** normalizeText(nazwa); '' when too short to match on (see MIN_NAME_LENGTH) */
  nameNorm: string;
  /** nameNorm with all whitespace removed */
  nameNoSpace: string;
  /** nameNorm split into words of length > 2 (for fuzzy matching) */
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
    const nameNorm = this.matchableName(contractor.nazwa);
    const alts: DerivedAlt[] = (contractor.alternativeNames ?? []).map(altName => {
      const norm = this.matchableName(altName);
      return {
        norm,
        noSpace: norm.replace(/\s/g, ''),
        words: this.fuzzyWords(norm),
      };
    });
    return {
      contractor,
      typy: contractor.typy && contractor.typy.length > 0 ? contractor.typy : ['Kontrahent'],
      nipDigits: contractor.nip && contractor.nip.trim() ? contractor.nip.replace(/[\s-]/g, '') : '',
      nameNorm,
      nameNoSpace: nameNorm.replace(/\s/g, ''),
      nameWords: this.fuzzyWords(nameNorm),
      alts,
    };
  }

  /**
   * A name normalized for matching, or '' when it is too short to be trusted —
   * which includes a name that is nothing but punctuation ("-") and therefore
   * normalizes to nothing. Every match test skips an empty name.
   */
  private matchableName(name: string): string {
    const norm = this.normalizeText(name ?? '');
    return norm.replace(/\s/g, '').length >= MIN_NAME_LENGTH ? norm : '';
  }

  /** Words of length > 2, as fuzzy matching compares them. */
  private fuzzyWords(norm: string): string[] {
    return norm ? norm.split(' ').filter(w => w.length > 2) : [];
  }

  /**
   * Normalize one description once for all the contractors it is compared against.
   *
   * `parts` are the bank subfields the text was glued from (see
   * AITransaction.descBaseParts). Where a format joins them with no separator, a
   * name that ends exactly where a subfield ends ("…SP Z O O" + "UL. KRUCZA")
   * runs into the next word and no whole-word test can find it. Joined with a
   * space here, the seam is a word boundary; the letters and digits are the same,
   * so the space-insensitive test still finds a name the bank wrapped mid-word.
   */
  private prepareText(text: string, parts?: string[]): PreparedText {
    const source = parts && parts.length > 0 ? parts.join(' ') : text;
    const norm = this.normalizeText(source ?? '');
    const wordStarts = new Set<number>();
    const wordEnds = new Set<number>();
    let noSpace = '';
    for (const word of norm ? norm.split(' ') : []) {
      wordStarts.add(noSpace.length);
      noSpace += word;
      wordEnds.add(noSpace.length);
    }
    return { padded: ` ${norm} `, noSpace, wordStarts, wordEnds, words: this.fuzzyWords(norm) };
  }

  /** True when `name` (normalized, non-empty) occurs in `text` as whole words. */
  private containsWords(text: PreparedText, name: string): boolean {
    return name !== '' && text.padded.includes(` ${name} `);
  }

  /**
   * True when `noSpaceName` occurs in the whitespace-stripped text starting at the
   * start of a word and ending at the end of one — so a name the bank's line
   * wrapping cut in two ("Dud ziński") still matches, but one glued into a longer
   * word does not. Keeps the 8-character floor, below which a space-insensitive
   * hit is too likely to be an accident.
   */
  private containsWithoutSpaces(text: PreparedText, noSpaceName: string): boolean {
    if (noSpaceName.length < 8) return false;
    let from = 0;
    while (true) {
      const at = text.noSpace.indexOf(noSpaceName, from);
      if (at === -1) return false;
      if (text.wordStarts.has(at) && text.wordEnds.has(at + noSpaceName.length)) return true;
      from = at + 1;
    }
  }

  /**
   * True when `noSpaceName` occurs in the whitespace-stripped text starting at the
   * start of a word but running into the next one — the glued case described at
   * GLUED_MATCH_CONFIDENCE. Long names only; the start must still be a word start,
   * so a name inside a longer word ("XPKOBP") never counts.
   */
  private startsAtWord(text: PreparedText, noSpaceName: string): boolean {
    if (noSpaceName.length < GLUED_MIN_LENGTH) return false;
    let from = 0;
    while (true) {
      const at = text.noSpace.indexOf(noSpaceName, from);
      if (at === -1) return false;
      if (text.wordStarts.has(at)) return true;
      from = at + 1;
    }
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
   * Normalize text for matching: lower-case, Polish diacritics folded (the shared
   * foldText, so "Usługi" and "USLUGI" are the same name), and every character
   * that is not a letter or digit turned into a word separator. Word boundaries
   * are what the match tests rely on, so "FV/123" is the words "fv" and "123",
   * while "FVSERWIS" stays one word.
   */
  private normalizeText(text: string): string {
    return foldText(text)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
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
    let heldOpt: Omit<MatchedContractor, 'matchedIn'> | null = null;
    if (transaction.descOpt && transaction.descOpt.trim() !== '') {
      const match = this.findBestMatch(transaction.descOpt, transaction.descOptParts, pool);
      if (match.contractor && match.confidence > GLUED_MATCH_CONFIDENCE) {
        return {
          ...match,
          matchedIn: 'desc-opt',
        };
      }
      // Only a glued (held) name in desc-opt: a clean match in desc-base wins.
      if (match.contractor) heldOpt = match;
    }

    // Try desc-base
    const match = this.findBestMatch(transaction.descBase, transaction.descBaseParts, pool);
    if (match.contractor && (!heldOpt || match.confidence > heldOpt.confidence)) {
      return {
        ...match,
        matchedIn: 'desc-base',
      };
    }
    if (heldOpt) {
      return {
        ...heldOpt,
        matchedIn: 'desc-opt',
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
   * Look up a contractor by id, honoring the type filter. Used to re-resolve a
   * cached match against the current database: the cache stores only the id, so
   * a renamed or re-accounted contractor comes back with its current data, and a
   * deleted one comes back undefined (treated as a cache miss by the caller).
   */
  getById(id: number, allowedTypes?: KontrahentTyp[]): Kontrahent | undefined {
    return this.filterByTypes(allowedTypes).find(d => d.contractor.id === id)?.contractor;
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
    // the transaction, so compute them ONCE (not per contractor). Subfields are
    // kept apart the same way match() keeps them (see prepareText).
    const searchText = `${transaction.descOpt || ''} ${transaction.descBase}`.toLowerCase();
    const search = this.prepareText(searchText, [
      ...(transaction.descOptParts?.length ? transaction.descOptParts : [transaction.descOpt || '']),
      ...(transaction.descBaseParts?.length ? transaction.descBaseParts : [transaction.descBase]),
    ]);
    const searchNipNormalized = searchText.replace(/[\s-]/g, '');

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
        if (this.containsWords(search, d.nameNorm)) {
          score = 100;
        }
      }

      // If main name not matched, check alternative names - Score: 100 (SAME as main name!)
      if (score === 0 && d.alts.length > 0) {
        for (const alt of d.alts) {
          if (this.containsWords(search, alt.norm)) {
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
        if (this.containsWithoutSpaces(search, d.nameNoSpace)) {
          score = 98;
        }
        if (score === 0 && d.alts.length > 0) {
          for (const alt of d.alts) {
            if (this.containsWithoutSpaces(search, alt.noSpace)) {
              score = 98;
              break;
            }
          }
        }
      }

      // A long name glued to the next word - Score: 96 (the model sees the
      // whole text and can confirm it).
      if (score === 0) {
        if (this.startsAtWord(search, d.nameNoSpace) || d.alts.some(alt => this.startsAtWord(search, alt.noSpace))) {
          score = 96;
        }
      }

      // If exact match not found, try fuzzy matching - Score: 85-95
      // This catches typos and similar names (e.g., "Gontarek" vs "Guntarek")
      if (score === 0) {
        // Try fuzzy match on main name
        score = this.fuzzyMatchWords(d.nameWords, search.words);

        // If main name fuzzy match weak, try alternative names
        if (score < 90 && d.alts.length > 0) {
          for (const alt of d.alts) {
            const altScore = this.fuzzyMatchWords(alt.words, search.words);
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
    parts: string[] | undefined,
    pool: DerivedContractor[],
  ): Omit<MatchedContractor, 'matchedIn'> {
    const descLower = description.toLowerCase();
    // Normalized once, with the word positions that the whole-word tests and the
    // space-insensitive one (FOURTH check below) need.
    const desc = this.prepareText(description, parts);
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

      // SECOND: Check main name (with normalization), as whole words only
      if (this.containsWords(desc, d.nameNorm)) {
        const confidence = this.calculateConfidence(d.nameNorm, desc);

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
          if (this.containsWords(desc, alt.norm)) {
            const confidence = this.calculateConfidence(alt.norm, desc);

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
      // with all whitespace removed, starting and ending on word boundaries. The
      // min-length guard avoids short-name false positives; requiring the whole
      // name contiguous makes this stricter than fuzzy.
      if (bestConfidence < 88) {
        if (this.containsWithoutSpaces(desc, d.nameNoSpace)) {
          bestMatch = contractor;
          bestConfidence = 88;
          matchedText = contractor.nazwa;
        }
      }
      if (bestConfidence < 88 && d.alts.length > 0) {
        for (let i = 0; i < d.alts.length; i++) {
          const alt = d.alts[i];
          if (this.containsWithoutSpaces(desc, alt.noSpace)) {
            bestMatch = contractor;
            bestConfidence = 88;
            matchedText = contractor.alternativeNames![i];
            break;
          }
        }
      }

      // FIFTH: a long name glued to the word after it — held for review with
      // this contractor picked (see GLUED_MATCH_CONFIDENCE).
      if (bestConfidence < GLUED_MATCH_CONFIDENCE) {
        if (this.startsAtWord(desc, d.nameNoSpace)) {
          bestMatch = contractor;
          bestConfidence = GLUED_MATCH_CONFIDENCE;
          matchedText = contractor.nazwa;
        } else {
          for (let i = 0; i < d.alts.length; i++) {
            if (this.startsAtWord(desc, d.alts[i].noSpace)) {
              bestMatch = contractor;
              bestConfidence = GLUED_MATCH_CONFIDENCE;
              matchedText = contractor.alternativeNames![i];
              break;
            }
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
   * Calculate confidence score for a whole-word match
   * Used for BOTH main name and alternative names (ensures EQUAL confidence)
   */
  private calculateConfidence(contractorName: string, text: PreparedText): number {
    const description = text.padded.trim();
    if (description === contractorName) return 100;
    if (text.padded.startsWith(` ${contractorName} `)) return 95;
    if (text.padded.endsWith(` ${contractorName} `)) return 90;

    const ratio = contractorName.length / description.length;
    if (ratio > 0.8) return 85;
    if (ratio > 0.5) return 80;
    return 75;
  }
}
