/**
 * Contractor Matcher
 * Matches transaction descriptions with contractors from database
 */

import { XmlTransaction } from './types';
import { Kontrahent } from '../../shared/types';

export interface MatchedContractor {
  contractor: Kontrahent | null;
  confidence: number;
  matchedIn: 'desc-opt' | 'desc-base' | 'none';
  matchedText?: string;
}

export class ContractorMatcher {
  private contractors: Kontrahent[];

  constructor(contractors: Kontrahent[]) {
    this.contractors = contractors;
  }

  /**
   * Match transaction with contractor
   * Priority: desc-opt > desc-base
   */
  match(transaction: XmlTransaction): MatchedContractor {
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
   * Returns the most likely contractors based on fuzzy matching
   * Score priority: NIP (110) > Main name = Alternative names (100 - EQUAL) > Word-based (0-70)
   */
  getTopCandidates(transaction: XmlTransaction, topN: number = 10): Kontrahent[] {
    // Combine desc-opt and desc-base for searching
    const searchText = `${transaction.descOpt || ''} ${transaction.descBase}`.toLowerCase();
    
    // Score all contractors
    const scored = this.contractors.map(contractor => {
      let score = 0;

      // HIGHEST PRIORITY: Check NIP (full match required) - Score: 110
      if (contractor.nip && contractor.nip.trim()) {
        const nip = contractor.nip.replace(/[\s-]/g, ''); // Remove spaces and dashes
        const searchNormalized = searchText.replace(/[\s-]/g, '');
        if (searchNormalized.includes(nip)) {
          score = 110; // Highest priority
        }
      }

      // If NIP not matched, check main name - Score: 100
      if (score === 0) {
        const contractorNameLower = contractor.nazwa.toLowerCase();
        if (searchText.includes(contractorNameLower)) {
          score = 100;
        }
      }

      // If main name not matched, check alternative names - Score: 100 (SAME as main name!)
      if (score === 0 && contractor.alternativeNames && contractor.alternativeNames.length > 0) {
        for (const altName of contractor.alternativeNames) {
          const altNameLower = altName.toLowerCase();
          if (searchText.includes(altNameLower)) {
            score = 100; // EQUAL priority with main name
            break;
          }
        }
      }

      // If no full match, try word-based matching on main name
      if (score === 0) {
        const contractorNameLower = contractor.nazwa.toLowerCase();
        const words = contractorNameLower.split(/\s+/).filter(w => w.length > 3);
        let matchedWords = 0;
        
        for (const word of words) {
          if (searchText.includes(word)) {
            matchedWords++;
          }
        }
        
        if (words.length > 0) {
          score = (matchedWords / words.length) * 70;
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
   * Note: Main name and alternative names have IDENTICAL confidence calculation
   */
  private findBestMatch(description: string): Omit<MatchedContractor, 'matchedIn'> {
    const descLower = description.toLowerCase();
    let bestMatch: Kontrahent | null = null;
    let bestConfidence = 0;
    let matchedText = '';

    for (const contractor of this.contractors) {
      // FIRST: Check NIP (highest priority - full match required)
      if (contractor.nip && contractor.nip.trim()) {
        const nip = contractor.nip.replace(/[\s-]/g, ''); // Remove spaces and dashes
        const descNormalized = descLower.replace(/[\s-]/g, '');
        
        if (descNormalized.includes(nip)) {
          // NIP match - 100% confidence if exact, 98% if embedded
          const confidence = descNormalized === nip ? 100 : 98;
          
          if (confidence > bestConfidence) {
            bestMatch = contractor;
            bestConfidence = confidence;
            matchedText = `NIP: ${contractor.nip}`;
          }
        }
      }

      // SECOND: Check main name (uses calculateConfidence - 75-100% depending on position)
      const contractorNameLower = contractor.nazwa.toLowerCase();
      if (descLower.includes(contractorNameLower)) {
        const confidence = this.calculateConfidence(contractorNameLower, descLower);
        
        if (confidence > bestConfidence) {
          bestMatch = contractor;
          bestConfidence = confidence;
          matchedText = contractor.nazwa;
        }
      }

      // THIRD: Check alternative names (SAME calculateConfidence as main name - EQUAL priority!)
      if (contractor.alternativeNames && contractor.alternativeNames.length > 0) {
        for (const altName of contractor.alternativeNames) {
          const altNameLower = altName.toLowerCase();
          
          if (descLower.includes(altNameLower)) {
            // Uses SAME confidence calculation as main name
            const confidence = this.calculateConfidence(altNameLower, descLower);
            
            if (confidence > bestConfidence) {
              bestMatch = contractor;
              bestConfidence = confidence;
              matchedText = altName; // Show which alternative name matched
            }
          }
        }
      }

      // Only if no full match found, try word-based matching on main name
      if (bestMatch !== contractor) {
        const words = contractorNameLower.split(/\s+/).filter(w => w.length > 3); // Only words > 3 chars
        let matchedWords = 0;
        
        for (const word of words) {
          if (descLower.includes(word)) {
            matchedWords++;
          }
        }
        
        if (matchedWords > 0 && words.length > 0) {
          const confidence = Math.floor((matchedWords / words.length) * 70); // Max 70% for partial match
          
          if (confidence > bestConfidence) {
            bestMatch = contractor;
            bestConfidence = confidence;
            matchedText = contractor.nazwa;
          }
        }
      }
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
   * Returns: 75-100 depending on position and length ratio
   */
  private calculateConfidence(contractorName: string, description: string): number {
    // Exact match
    if (description === contractorName) {
      return 100;
    }

    // Contractor name at the beginning
    if (description.startsWith(contractorName)) {
      return 95;
    }

    // Contractor name at the end
    if (description.endsWith(contractorName)) {
      return 90;
    }

    // Contractor name somewhere in the middle
    // Calculate based on ratio of lengths
    const ratio = contractorName.length / description.length;
    
    if (ratio > 0.8) {
      return 85; // Contractor name is most of the description
    } else if (ratio > 0.5) {
      return 80; // Contractor name is significant part
    } else {
      return 75; // Contractor name is smaller part
    }
  }
}
