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
   */
  getTopCandidates(transaction: XmlTransaction, topN: number = 10): Kontrahent[] {
    // Combine desc-opt and desc-base for searching
    const searchText = `${transaction.descOpt || ''} ${transaction.descBase}`.toLowerCase();
    
    // Score all contractors
    const scored = this.contractors.map(contractor => {
      const contractorNameLower = contractor.nazwa.toLowerCase();
      let score = 0;

      // Full name match
      if (searchText.includes(contractorNameLower)) {
        score = 100;
      } else {
        // Word-based matching
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
   */
  private findBestMatch(description: string): Omit<MatchedContractor, 'matchedIn'> {
    const descLower = description.toLowerCase();
    let bestMatch: Kontrahent | null = null;
    let bestConfidence = 0;
    let matchedText = '';

    for (const contractor of this.contractors) {
      const contractorNameLower = contractor.nazwa.toLowerCase();
      
      // Check for partial match (contractor name is contained in description)
      if (descLower.includes(contractorNameLower)) {
        // Full name match - highest confidence
        const confidence = this.calculateConfidence(contractorNameLower, descLower);
        
        if (confidence > bestConfidence) {
          bestMatch = contractor;
          bestConfidence = confidence;
          matchedText = contractor.nazwa;
        }
      } else {
        // Check for word matches (individual words from contractor name)
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
