/**
 * Shared Contractor Matcher
 * Matches transaction descriptions with contractors from database.
 * Converter-independent — operates on AITransaction (descBase/descOpt).
 */

import { AITransaction, MatchedContractor } from './ai-types';
import { Kontrahent } from './types';

export type { MatchedContractor } from './ai-types';

export class ContractorMatcher {
  private contractors: Kontrahent[];

  constructor(contractors: Kontrahent[]) {
    this.contractors = contractors;
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
   * Calculate Levenshtein distance between two strings (edit distance)
   * Used for fuzzy matching when exact substring match fails
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j - 1] + 1, // substitution
            dp[i - 1][j] + 1,     // deletion
            dp[i][j - 1] + 1      // insertion
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Check fuzzy match between contractor name and transaction text
   * Returns score based on similarity (0 = no match, 85-95 = fuzzy match)
   * 
   * Compares words from contractor name against words in transaction text.
   * If any word pair has >75% similarity (Levenshtein-based), returns fuzzy match score.
   */
  private fuzzyMatch(contractorName: string, searchText: string): number {
    const contractorWords = contractorName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const searchWords = searchText.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    let bestScore = 0;

    // Check each contractor word against search words
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
        }
      }
    }

    return bestScore;
  }

  /**
   * Match transaction with contractor
   * Priority: desc-opt > desc-base
   */
  match(transaction: AITransaction): MatchedContractor {
    // Try desc-opt first (higher priority)
    if (transaction.descOpt && transaction.descOpt.trim() !== '') {
      const match = this.findBestMatch(transaction.descOpt);
      if (match.contractor) {
        return {
          ...match,
          matchedIn: 'desc-opt',
        };
      }
    }

    // Try desc-base
    const match = this.findBestMatch(transaction.descBase);
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
   * Get top N candidate contractors for a transaction (for AI pre-filtering)
   * Returns the most likely contractors based on matching (exact and fuzzy)
   * Score priority: NIP (110) > Main name = Alternative names (100 - EQUAL) > Fuzzy match (85-95)
   */
  getTopCandidates(transaction: AITransaction, topN: number = 10): Kontrahent[] {
    // Combine desc-opt and desc-base for searching
    const searchText = `${transaction.descOpt || ''} ${transaction.descBase}`.toLowerCase();
    const searchTextNormalized = this.normalizeText(searchText);
    
    // Score all contractors
    const scored = this.contractors.map(contractor => {
      let score = 0;

      // HIGHEST PRIORITY: Check NIP (full match required) - Score: 110
      if (contractor.nip && contractor.nip.trim()) {
        const nip = contractor.nip.replace(/[\s-]/g, '');
        const searchNormalized = searchText.replace(/[\s-]/g, '');
        if (searchNormalized.includes(nip)) {
          score = 110;
        }
      }

      // If NIP not matched, check main name - Score: 100
      if (score === 0) {
        const contractorNameLower = contractor.nazwa.toLowerCase();
        const contractorNameNormalized = this.normalizeText(contractorNameLower);
        if (searchTextNormalized.includes(contractorNameNormalized)) {
          score = 100;
        }
      }

      // If main name not matched, check alternative names - Score: 100 (SAME as main name!)
      if (score === 0 && contractor.alternativeNames && contractor.alternativeNames.length > 0) {
        for (const altName of contractor.alternativeNames) {
          const altNameLower = altName.toLowerCase();
          const altNameNormalized = this.normalizeText(altNameLower);
          if (searchTextNormalized.includes(altNameNormalized)) {
            score = 100;
            break;
          }
        }
      }

      // If exact match not found, try fuzzy matching - Score: 85-95
      // This catches typos and similar names (e.g., "Gontarek" vs "Guntarek")
      if (score === 0) {
        // Try fuzzy match on main name
        score = this.fuzzyMatch(contractor.nazwa, searchText);

        // If main name fuzzy match weak, try alternative names
        if (score < 90 && contractor.alternativeNames && contractor.alternativeNames.length > 0) {
          for (const altName of contractor.alternativeNames) {
            const altScore = this.fuzzyMatch(altName, searchText);
            score = Math.max(score, altScore);
            if (score >= 90) break; // Good enough, stop checking
          }
        }
      }

      return { contractor, score };
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
  private findBestMatch(description: string): Omit<MatchedContractor, 'matchedIn'> {
    const descLower = description.toLowerCase();
    const descNormalizedText = this.normalizeText(descLower);
    let bestMatch: Kontrahent | null = null;
    let bestConfidence = 0;
    let matchedText = '';

    for (const contractor of this.contractors) {
      // FIRST: Check NIP (highest priority - full match required)
      if (contractor.nip && contractor.nip.trim()) {
        const nip = contractor.nip.replace(/[\s-]/g, '');
        const descNormalized = descLower.replace(/[\s-]/g, '');
        
        if (descNormalized.includes(nip)) {
          const confidence = descNormalized === nip ? 100 : 98;
          
          if (confidence > bestConfidence) {
            bestMatch = contractor;
            bestConfidence = confidence;
            matchedText = `NIP: ${contractor.nip}`;
          }
        }
      }

      // SECOND: Check main name (with normalization)
      const contractorNameLower = contractor.nazwa.toLowerCase();
      const contractorNameNormalized = this.normalizeText(contractorNameLower);
      if (descNormalizedText.includes(contractorNameNormalized)) {
        const confidence = this.calculateConfidence(contractorNameNormalized, descNormalizedText);
        
        if (confidence > bestConfidence) {
          bestMatch = contractor;
          bestConfidence = confidence;
          matchedText = contractor.nazwa;
        }
      }

      // THIRD: Check alternative names (SAME confidence as main name, with normalization)
      if (contractor.alternativeNames && contractor.alternativeNames.length > 0) {
        for (const altName of contractor.alternativeNames) {
          const altNameLower = altName.toLowerCase();
          const altNameNormalized = this.normalizeText(altNameLower);
          
          if (descNormalizedText.includes(altNameNormalized)) {
            const confidence = this.calculateConfidence(altNameNormalized, descNormalizedText);
            
            if (confidence > bestConfidence) {
              bestMatch = contractor;
              bestConfidence = confidence;
              matchedText = altName;
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
