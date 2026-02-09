/**
 * Regex-based extractor for quick wins
 * Handles simple, high-confidence patterns without AI
 */

import { ExtractedData, XmlTransaction } from './types';

export class RegexExtractor {
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
    const patterns = [
      /identyfikator[:\s]+(\d+)\/(\d+)/i,  // IDENTYFIKATOR: 27/4
      /lokal\s+id\s+(\d+)\/(\d+)/i,        // lokal ID 27/7
      /id[:\s\.]+(\d+)\/(\d+)/i,           // ID.22211201 -> extract digits
      /wspolnotanr\s+(\d+)\s*-\s*identyfikator\s+lokalu\s+(\d+)/i, // Wspolnotanr 27 - Identyfikator lokalu 26
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

    return null;
  }

  /**
   * Extract address patterns (e.g., "Joliot-Curie 3/27", "JOLIOT CURIE 3 M.11")
   */
  private extractAddress(descBase: string, descOpt: string): Partial<ExtractedData> | null {
    const combined = `${descBase} ${descOpt}`;
    
    const patterns = [
      // Joliot-Curie 3/27 (most common format)
      {
        regex: /(joliot[-\s]?curie)\s+(\d+)\/(\d+)/i,
        extractStreet: (m: RegExpMatchArray) => this.normalizeStreetName(m[1]),
        extractBuilding: (m: RegExpMatchArray) => m[2],
        extractApartment: (m: RegExpMatchArray) => m[3],
        confidence: 95,
      },
      // UL. JOLIOT CURIE 3  M.11 (with periods and spaces)
      {
        regex: /(joliot[-\s]?curie)\s+(\d+)\s+m\.(\d+)/i,
        extractStreet: (m: RegExpMatchArray) => this.normalizeStreetName(m[1]),
        extractBuilding: (m: RegExpMatchArray) => m[2],
        extractApartment: (m: RegExpMatchArray) => m[3],
        confidence: 95,
      },
      // JOLIOT CURIE 3 M 11 (without period)
      {
        regex: /(joliot[-\s]?curie)\s+(\d+)\s+m\s+(\d+)/i,
        extractStreet: (m: RegExpMatchArray) => this.normalizeStreetName(m[1]),
        extractBuilding: (m: RegExpMatchArray) => m[2],
        extractApartment: (m: RegExpMatchArray) => m[3],
        confidence: 95,
      },
      // JOLIOT CURIE 3 M.33 or M33 (no space before number)
      {
        regex: /(joliot[-\s]?curie)\s+(\d+)\s+m\.?(\d+)/i,
        extractStreet: (m: RegExpMatchArray) => this.normalizeStreetName(m[1]),
        extractBuilding: (m: RegExpMatchArray) => m[2],
        extractApartment: (m: RegExpMatchArray) => m[3],
        confidence: 95,
      },
      // J. CURIE 3/27 (abbreviated)
      {
        regex: /j\.?\s*curie\s+(\d+)\/(\d+)/i,
        extractStreet: () => 'Joliot-Curie',
        extractBuilding: (m: RegExpMatchArray) => m[1],
        extractApartment: (m: RegExpMatchArray) => m[2],
        confidence: 90,
      },
      // J. CURIE 3 M.11 or M 11 (abbreviated with M)
      {
        regex: /j\.?\s*curie\s+(\d+)\s+m\.?\s*(\d+)/i,
        extractStreet: () => 'Joliot-Curie',
        extractBuilding: (m: RegExpMatchArray) => m[1],
        extractApartment: (m: RegExpMatchArray) => m[2],
        confidence: 90,
      },
      // JCURIE 3/34 (very abbreviated)
      {
        regex: /jcurie\s+(\d+)\/(\d+)/i,
        extractStreet: () => 'Joliot-Curie',
        extractBuilding: (m: RegExpMatchArray) => m[1],
        extractApartment: (m: RegExpMatchArray) => m[2],
        confidence: 85,
      },
    ];

    for (const pattern of patterns) {
      const match = combined.match(pattern.regex);
      if (match) {
        const street = pattern.extractStreet(match);
        const building = pattern.extractBuilding(match);
        const apartment = pattern.extractApartment(match);
        
        return {
          streetName: street,
          buildingNumber: building,
          apartmentNumber: apartment,
          fullAddress: `${street} ${building}/${apartment}`,
          confidence: {
            address: pattern.confidence,
            apartment: pattern.confidence,
            tenantName: 0,
            overall: 0,
          },
        };
      }
    }

    return null;
  }

  /**
   * Extract tenant name from descriptions
   */
  private extractTenantName(descBase: string, descOpt: string): Partial<ExtractedData> | null {
    // Look for name patterns in desc-opt first (more reliable)
    const namePattern = /^([A-ZĄĆĘŁŃÓŚŹŻ\s-]{3,50}?)\s+(?:UL\.|ul\.|JOLIOT|[0-9])/i;
    
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
   * Normalize street name to consistent format
   */
  private normalizeStreetName(street: string): string {
    return street
      .replace(/joliot[-\s]?curie/i, 'Joliot-Curie')
      .replace(/j\.?\s*curie/i, 'Joliot-Curie')
      .replace(/jcurie/i, 'Joliot-Curie')
      .trim();
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
