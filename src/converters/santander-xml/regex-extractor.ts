/**
 * Regex-based extractor for quick wins
 * Handles simple, high-confidence patterns without AI
 */

import { ExtractedData, XmlTransaction } from './types';
import { Adres } from '../../shared/types';

export class RegexExtractor {
  private addresses: Adres[];

  constructor(addresses: Adres[] = []) {
    this.addresses = addresses;
  }

  /**
   * Try to extract data using regex patterns
   * Returns null if confidence is too low
   */
  extract(transaction: XmlTransaction): ExtractedData | null {
    const { descBase, descOpt } = transaction;

    let extracted: Partial<ExtractedData> = {
      streetName: null,
      buildingNumber: null,
      apartmentNumber: null,
      fullAddress: null,
      tenantName: null,
      confidence: {
        address: 0,
        apartment: 0,
        tenantName: 0,
        overall: 0,
      },
      extractionMethod: 'regex',
      warnings: [],
      rawData: { descBase, descOpt },
    };

    // Strategy 1: Identifier (highest confidence)
    const identifierMatch = this.extractIdentifier(descBase, descOpt);
    if (identifierMatch) {
      extracted.buildingNumber = identifierMatch.buildingNumber || extracted.buildingNumber;
      extracted.apartmentNumber = identifierMatch.apartmentNumber || extracted.apartmentNumber;
      extracted.fullAddress = identifierMatch.fullAddress || extracted.fullAddress;
      extracted.confidence!.address = Math.max(extracted.confidence!.address, identifierMatch.confidence!.address);
      extracted.confidence!.apartment = Math.max(extracted.confidence!.apartment, identifierMatch.confidence!.apartment);
    }

    // Strategy 2: Address patterns
    const addressMatch = this.extractAddress(descBase, descOpt);
    if (addressMatch) {
      extracted.streetName = addressMatch.streetName || extracted.streetName;
      extracted.buildingNumber = addressMatch.buildingNumber || extracted.buildingNumber;
      extracted.apartmentNumber = addressMatch.apartmentNumber || extracted.apartmentNumber;
      extracted.fullAddress = addressMatch.fullAddress || extracted.fullAddress;
      extracted.confidence!.address = Math.max(extracted.confidence!.address, addressMatch.confidence!.address);
      extracted.confidence!.apartment = Math.max(extracted.confidence!.apartment, addressMatch.confidence!.apartment);
    }

    // Strategy 3: Tenant name
    const nameMatch = this.extractTenantName(descBase, descOpt);
    if (nameMatch) {
      extracted.tenantName = nameMatch.tenantName || extracted.tenantName;
      extracted.confidence!.tenantName = Math.max(extracted.confidence!.tenantName, nameMatch.confidence!.tenantName);
    }

    // Calculate overall confidence
    // NOTE: Overall confidence based ONLY on apartment number (most critical for accounting system)
    const confidence = extracted.confidence!;
    confidence.overall = confidence.apartment;

    // Only return if we have apartment number with reasonable confidence
    if (confidence.apartment >= 70) {
      return extracted as ExtractedData;
    }

    return null;
  }

  /**
   * Extract identifier patterns (e.g., "IDENTYFIKATOR: 27/4", "ID 22211214")
   */
  private extractIdentifier(descBase: string, descOpt: string): Partial<ExtractedData> | null {
    const combined = descBase + ' ' + descOpt;
    const combinedUpper = combined.toUpperCase();
    
    // Check for ZGN pattern first (highest priority)
    // Just look for "GOSP. NIERUCHOM" anywhere in the text
    if (combinedUpper.includes('GOSP. NIERUCHOM')) {
      return {
        buildingNumber: null,
        apartmentNumber: 'ZGN',
        fullAddress: 'ZGN',
        confidence: {
          address: 100,
          apartment: 100,
          tenantName: 0,
          overall: 0,
        },
      };
    }

    const patterns = [
      /identyfikator[:\s]+(\d+)\/(\d+)/i,  // IDENTYFIKATOR: 27/4
      /lokal\s+id\s+(\d+)\/(\d+)/i,        // lokal ID 27/7
      /id[:\s\.]+(\d+)\/(\d+)/i,           // ID.22211201 -> extract digits
      /wspolnotanr\s+(\d+)\s*-\s*identyfikator\s+lokalu\s+(\d+)/i, // Wspolnotanr 27 - Identyfikator lokalu 26
      // NOTE: "lokal 17" pattern is handled separately below (standalone)
    ];

    for (const pattern of patterns) {
      const match = (descBase + ' ' + descOpt).match(pattern);
      if (match) {
        const building = match[1];
        const apartment = match[2];
        
        return {
          buildingNumber: building,
          apartmentNumber: apartment,
          fullAddress: `${building}/${apartment}`,
          confidence: {
            address: 95,
            apartment: 95,
            tenantName: 0,
            overall: 0,
          },
        };
      }
    }

    // Check for standalone "lokal X" or "lokalu X" pattern (without building number)
    const standaloneLokalkMatch = (descBase + ' ' + descOpt).match(/lokal[ua]?[:\s]+(\d+)(?![\d\/])/i);
    if (standaloneLokalkMatch) {
      const apartment = standaloneLokalkMatch[1];
      return {
        buildingNumber: null,
        apartmentNumber: apartment,
        fullAddress: `Lokal ${apartment}`,
        confidence: {
          address: 95,
          apartment: 95,
          tenantName: 0,
          overall: 0,
        },
      };
    }

    return null;
  }

  /**
   * Extract address patterns dynamically from configured addresses
   * Supports main name and alternative names for each address
   */
  private extractAddress(descBase: string, descOpt: string): Partial<ExtractedData> | null {
    const combined = `${descBase} ${descOpt}`;
    
    // If no addresses configured, return null
    if (!this.addresses || this.addresses.length === 0) {
      return null;
    }
    
    // For each address, try all pattern variations
    for (const address of this.addresses) {
      // Get all name variations (main name + alternative names)
      const nameVariations = [
        address.nazwa,
        ...(address.alternativeNames || [])
      ];
      
      for (const streetName of nameVariations) {
        // Escape special regex characters and create flexible pattern
        const escapedName = this.escapeRegex(streetName);
        // Allow for spaces, hyphens, and missing characters in the name
        const flexibleName = escapedName
          .replace(/[-\s]+/g, '[-\\s]?')  // Allow optional spaces/hyphens
          .replace(/\./g, '\\.?');         // Make dots optional
        
        const patterns = [
          // Format: "Street 3/27" (most common - slash separator)
          {
            regex: new RegExp(`(${flexibleName})\\s+(\\d+)\\/(\\d+)`, 'i'),
            extractBuilding: (m: RegExpMatchArray) => m[2],
            extractApartment: (m: RegExpMatchArray) => m[3],
            confidence: 95,
          },
          // Format: "Street 3  19" (spaces between numbers)
          {
            regex: new RegExp(`(${flexibleName})\\s+(\\d+)\\s+(\\d{1,3})(?:\\s|$)`, 'i'),
            extractBuilding: (m: RegExpMatchArray) => m[2],
            extractApartment: (m: RegExpMatchArray) => m[3],
            confidence: 95,
          },
          // Format: "Street 3 M. 23" (with M. and space)
          {
            regex: new RegExp(`(${flexibleName})\\s+(\\d+)\\s+m\\.\\s+(\\d+)`, 'i'),
            extractBuilding: (m: RegExpMatchArray) => m[2],
            extractApartment: (m: RegExpMatchArray) => m[3],
            confidence: 95,
          },
          // Format: "Street 3  M.11" (with M. but no space before number)
          {
            regex: new RegExp(`(${flexibleName})\\s+(\\d+)\\s+m\\.(\\d+)`, 'i'),
            extractBuilding: (m: RegExpMatchArray) => m[2],
            extractApartment: (m: RegExpMatchArray) => m[3],
            confidence: 95,
          },
          // Format: "Street 3 M 11" (with M but no period)
          {
            regex: new RegExp(`(${flexibleName})\\s+(\\d+)\\s+m\\s+(\\d+)`, 'i'),
            extractBuilding: (m: RegExpMatchArray) => m[2],
            extractApartment: (m: RegExpMatchArray) => m[3],
            confidence: 95,
          },
          // Format: "Street 3 M.33" or "Street 3 M33" (no space before number)
          {
            regex: new RegExp(`(${flexibleName})\\s+(\\d+)\\s+m\\.?(\\d+)`, 'i'),
            extractBuilding: (m: RegExpMatchArray) => m[2],
            extractApartment: (m: RegExpMatchArray) => m[3],
            confidence: 95,
          },
        ];
        
        for (const pattern of patterns) {
          const match = combined.match(pattern.regex);
          if (match) {
            const building = pattern.extractBuilding(match);
            const apartment = pattern.extractApartment(match);
            
            return {
              streetName: address.nazwa, // Always use the main name from database
              buildingNumber: building,
              apartmentNumber: apartment,
              fullAddress: `${address.nazwa} ${building}/${apartment}`,
              confidence: {
                address: pattern.confidence,
                apartment: pattern.confidence,
                tenantName: 0,
                overall: 0,
              },
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Extract tenant name from descriptions
   */
  private extractTenantName(descBase: string, descOpt: string): Partial<ExtractedData> | null {
    // Look for name patterns in desc-opt first (more reliable)
    const namePattern = /^([A-ZĄĆĘŁŃÓŚŹŻ\s-]{3,50}?)\s+(?:UL\.|ul\.|[0-9])/i;
    
    const optMatch = descOpt.match(namePattern);
    if (optMatch) {
      const name = this.normalizeName(optMatch[1]);
      return {
        tenantName: name,
        confidence: {
          address: 0,
          apartment: 0,
          tenantName: 75,
          overall: 0,
        },
      };
    }

    // Try desc-base (less reliable)
    const baseMatch = descBase.match(namePattern);
    if (baseMatch) {
      const name = this.normalizeName(baseMatch[1]);
      return {
        tenantName: name,
        confidence: {
          address: 0,
          apartment: 0,
          tenantName: 60,
          overall: 0,
        },
      };
    }

    return null;
  }

  /**
   * Normalize name to Title Case
   */
  private normalizeName(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .map(word => {
        // Keep all uppercase words as-is (might be initials)
        if (word === word.toUpperCase() && word.length <= 3) {
          return word;
        }
        // Title case for regular words
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }
}
