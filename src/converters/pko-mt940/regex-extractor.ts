/**
 * PKO BP MT940 Regex Extractor
 * Extract addresses and tenant names using regex patterns
 */

import { MT940Transaction, ExtractedData } from './types';
import { Adres } from '../../shared/types';

export class RegexExtractor {
  private addresses: Adres[];

  constructor(addresses: Adres[] = []) {
    this.addresses = addresses;
  }

  /**
   * Extract data from transaction using regex patterns
   */
  extract(transaction: MT940Transaction): ExtractedData {
    const description = transaction.details.description.join(''); // No space - preserve apartment numbers like "45"
    const counterpartyName = transaction.details.counterpartyName;
    
    // Check for ZGN pattern first (highest priority)
    // "ZAKŁ. GOSP. NIERUCHOM. DZ.MOKOTÓW" -> "ZGN"
    const counterpartyUpper = counterpartyName.toUpperCase();
    if (counterpartyUpper.includes('GOSP. NIERUCHOM')) {
      return {
        streetName: null,
        buildingNumber: null,
        apartmentNumber: 'ZGN',
        fullAddress: 'ZGN',
        tenantName: null,
        confidence: {
          address: 100,
          apartment: 100,
          tenantName: 0,
          overall: 95, // High confidence - explicit ZGN pattern is very reliable
        },
        extractionMethod: 'regex',
        warnings: [],
        rawData: {
          description,
          counterpartyName,
          counterpartyIBAN: transaction.details.counterpartyIBAN,
        },
      };
    }
    
    // Combine all text for searching
    const fullText = `${description} ${counterpartyName}`.toLowerCase();
    
    // Extract apartment number - try description first, then counterparty as fallback
    let apartmentNumber = this.extractApartmentNumber(description);
    if (!apartmentNumber) {
      apartmentNumber = this.extractApartmentNumber(counterpartyName);
    }
    
    // Extract address
    const addressResult = this.extractAddress(fullText, apartmentNumber);
    
    // IMPORTANT: If we have a known addresses list, validate the extracted address
    // Address validation is ALWAYS required - even with explicit apartment patterns
    let isValidAddress = true;
    if (this.addresses.length > 0 && addressResult.streetName) {
      isValidAddress = this.isAddressInKnownProperties(addressResult.streetName, addressResult.buildingNumber);
    }
    
    // Track if apartment was explicitly mentioned (for confidence calculation)
    const hasExplicitApartment = !!apartmentNumber;
    
    // Extract tenant name
    const tenantName = this.extractTenantName(counterpartyName);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(addressResult, tenantName, apartmentNumber, isValidAddress, hasExplicitApartment);
    
    // Warnings
    const warnings: string[] = [];
    if (!addressResult.fullAddress && !apartmentNumber) {
      warnings.push('No address or apartment found');
    }
    if (!tenantName) {
      warnings.push('No tenant name extracted');
    }
    if (!isValidAddress && addressResult.streetName) {
      warnings.push(`Address "${addressResult.streetName} ${addressResult.buildingNumber}" does not match managed properties`);
    }
    
    // Return extracted data
    // Address MUST be valid to return any data
    return {
      streetName: isValidAddress ? addressResult.streetName : null,
      buildingNumber: isValidAddress ? addressResult.buildingNumber : null,
      apartmentNumber: isValidAddress ? (apartmentNumber || addressResult.apartmentNumber) : null,
      fullAddress: isValidAddress ? addressResult.fullAddress : null,
      tenantName,
      confidence,
      extractionMethod: 'regex',
      warnings,
      rawData: {
        description,
        counterpartyName,
        counterpartyIBAN: transaction.details.counterpartyIBAN,
      },
    };
  }

  /**
   * Extract apartment number from description
   * Looking for patterns like:
   * - "lokal numer: 111"
   * - "lokal 111"
   * - "m. 111"
   * - "lok. 111"
   * - "mieszkanie 111"
   */
  private extractApartmentNumber(description: string): string | null {
    const normalizedDesc = description.toLowerCase();
    
    // ==================== EXPLICIT PATTERNS (HIGHEST PRIORITY) ====================
    
    // Pattern 1: "ID LOKALU X/XX" - explicit identifier
    const patternID = /id\s+lokalu\s+\d+\/(\d+)/i;
    const matchID = normalizedDesc.match(patternID);
    if (matchID) {
      return matchID[1]; // Return apartment number after slash
    }
    
    // Pattern 2: "lokal numer: 111" or "lokal nr: 111" - explicit pattern
    const pattern2 = /lokal(?:\s+numer|\s+nr)?:?\s*(\d+)/i;
    const match2 = normalizedDesc.match(pattern2);
    if (match2) {
      return match2[1];
    }
    
    // ==================== ADDRESS-BASED PATTERNS ====================
    
    // Pattern 3: Address format with known street names "AL. LOTNIKÓW 20/82"
    // ONLY match if it's a real address pattern with street names (not dates like "01/2026")
    // This requires street prefix (aleja, al., ulica, ul.) OR known street name
    const pattern3 = /(?:aleja|al\.|ulica|ul\.)\s*[\wąćęłńóśźż\s]+?\s+(\d{1,3})\/(\d{1,4})/i;
    const match3 = description.match(pattern3);
    if (match3 && match3[2].length <= 3) { // Apartment numbers are typically 1-3 digits, not years
      return match3[2]; // Return the apartment number (after slash)
    }
    
    // ==================== PREFIX PATTERNS ====================
    
    // Pattern 4: "mieszkanie 111", "M. 111", "M.111", "M 111", "LOK. 111", "LOK.94"
    // Use word boundaries to avoid matching "REM." or other words containing "m"
    // Allow optional space after dot: "M.100" or "M. 100"
    const pattern4 = /\b(?:mieszkanie|lok\.?)\s+(\d+)|\bm\.?\s*(\d+)(?!\s*pln)/i;
    const match4 = normalizedDesc.match(pattern4);
    if (match4) {
      const apartmentNum = match4[1] || match4[2];
      if (apartmentNum && apartmentNum.length <= 4) {
        return apartmentNum;
      }
    }
    
    // ==================== FALLBACK PATTERNS ====================
    
    // Pattern 5: Just a number at the beginning (like "111" or "109")
    // Also ignore if followed by "PLN"
    const pattern5 = /^(\d{1,4})(?!\s*pln)\s/i;
    const match5 = normalizedDesc.match(pattern5);
    if (match5) {
      return match5[1];
    }
    
    return null;
  }

  /**
   * Check if extracted address matches any of the known managed properties
   * Supports both main name (nazwa) and alternative names (alternativeNames)
   */
  private isAddressInKnownProperties(streetName: string | null, buildingNumber: string | null): boolean {
    if (!streetName || this.addresses.length === 0) {
      return true; // If no addresses configured, accept all
    }
    
    const normalizedStreet = streetName.toLowerCase().trim();
    
    for (const addr of this.addresses) {
      // Get all name variations (main name + alternative names)
      const nameVariations = [
        addr.nazwa,
        ...(addr.alternativeNames || [])
      ];
      
      // Check each variation
      for (const addrName of nameVariations) {
        // Parse address from name field (e.g., "Aleja Lotników 20")
        const addressMatch = addrName.match(/^(.+?)\s+(\d+)$/);
        if (!addressMatch) continue;
        
        const knownStreet = addressMatch[1].toLowerCase().trim();
        const knownBuilding = addressMatch[2];
        
        // Normalize for comparison (remove "aleja", "ulica" prefixes)
        const normalizedKnownStreet = knownStreet
          .replace(/^(?:aleja|al\.?|ulica|ul\.?)\s+/i, '');
        const normalizedExtractedStreet = normalizedStreet
          .replace(/^(?:aleja|al\.?|ulica|ul\.?)\s+/i, '');
        
        // Check if streets match (allow partial match for encoding issues)
        // Remove spaces for comparison to handle "lo tników" vs "lotników"
        const streetWithoutSpaces = normalizedExtractedStreet.replace(/\s+/g, '');
        const knownStreetWithoutSpaces = normalizedKnownStreet.replace(/\s+/g, '');
        
        if (streetWithoutSpaces.includes(knownStreetWithoutSpaces) || 
            knownStreetWithoutSpaces.includes(streetWithoutSpaces)) {
          // If we have building number, check it too
          if (buildingNumber && buildingNumber !== knownBuilding) {
            continue;
          }
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Extract address from text
   * Looking for patterns like:
   * - "AL. LOTNIKÓW 20 M.100"
   * - "Aleja Lotników 20/100"
   * - "al.lotników 20 m.100"
   * - "LOTNIKÓW 20 LOK. 100"
   */
  private extractAddress(text: string, existingApartment: string | null = null): {
    streetName: string | null;
    buildingNumber: string | null;
    apartmentNumber: string | null;
    fullAddress: string | null;
  } {
    // Normalize text for better matching
    // Replace abbreviations with full forms, ensuring proper spacing
    const normalizedText = text
      .replace(/\bal\.\s*/gi, 'aleja ')  // "AL." or "AL. " -> "aleja "
      .replace(/\bul\.\s*/gi, 'ulica ')  // "UL." or "UL. " -> "ulica "
      .replace(/\bm\.\s*/gi, ' ')         // "M." or "M. " -> " "
      .replace(/\blok\.\s*/gi, ' ')       // "LOK." or "LOK. " -> " "
      .replace(/\s+/g, ' ')                // Normalize multiple spaces to single space
      .trim();
    
    // Try to match against known addresses first
    // Check both main name (nazwa) and alternative names (alternativeNames)
    for (const addr of this.addresses) {
      // Get all name variations (main name + alternative names)
      const nameVariations = [
        addr.nazwa,
        ...(addr.alternativeNames || [])
      ];
      
      // Try each variation
      for (const addrName of nameVariations) {
        // Parse the address from name field (e.g., "Aleja Lotników 20")
        const addressMatch = addrName.match(/^(.+?)\s+(\d+)$/);
        if (!addressMatch) continue;
        
        const street = addressMatch[1].toLowerCase();
        const building = addressMatch[2];
        
        // Check if this address is mentioned in the text
        const streetPattern = new RegExp(
          `(${this.escapeRegex(street)})\\s*${this.escapeRegex(building)}\\s*[/\\s]?\\s*(?:m\\.?\\s*)?(?:lok\\.?\\s*)?([0-9]+)?`,
          'i'
        );
        
        const match = normalizedText.match(streetPattern);
        if (match) {
          const apartment = existingApartment || match[2] || null;
          // Return using the MAIN name (nazwa), not the alternative variant
          const mainAddressMatch = addr.nazwa.match(/^(.+?)\s+(\d+)$/);
          if (!mainAddressMatch) continue;
          
          return {
            streetName: mainAddressMatch[1],
            buildingNumber: mainAddressMatch[2],
            apartmentNumber: apartment,
            fullAddress: apartment ? `${mainAddressMatch[1]} ${mainAddressMatch[2]}/${apartment}` : `${mainAddressMatch[1]} ${mainAddressMatch[2]}`,
          };
        }
      }
    }
    
    // Generic patterns if no known address matched
    
    // Pattern 1: Street name + building + apartment
    // e.g., "Aleja Lotników 20/100", "AL. LOTNIKÓW 20 M.100"
    const pattern1 = /(?:aleja|al|ulica|ul)\.?\s+([\wąćęłńóśźż]+(?:\s+[\wąćęłńóśźż]+)?)\s+(\d+)\s*[/\s]?\s*(?:m\.?\s*)?(?:lok\.?\s*)?(\d+)?/i;
    const match1 = normalizedText.match(pattern1);
    
    if (match1) {
      const streetName = this.capitalizeStreet(match1[1]);
      const buildingNumber = match1[2];
      const apartmentNumber = existingApartment || match1[3] || null;
      
      return {
        streetName,
        buildingNumber,
        apartmentNumber,
        fullAddress: apartmentNumber 
          ? `${streetName} ${buildingNumber}/${apartmentNumber}`
          : `${streetName} ${buildingNumber}`,
      };
    }
    
    // Pattern 2: Just street name with numbers
    // e.g., "LOTNIKÓW 20 100", "lotników 20m100"
    const pattern2 = /([\wąćęłńóśźż]+(?:\s+[\wąćęłńóśźż]+)?)\s+(\d+)\s*[/\s]?\s*(?:m\.?\s*)?(?:lok\.?\s*)?(\d+)?/i;
    const match2 = normalizedText.match(pattern2);
    
    if (match2 && match2[1].length > 3) { // Avoid matching random short words
      const streetName = this.capitalizeStreet(match2[1]);
      const buildingNumber = match2[2];
      const apartmentNumber = existingApartment || match2[3] || null;
      
      return {
        streetName,
        buildingNumber,
        apartmentNumber,
        fullAddress: apartmentNumber 
          ? `${streetName} ${buildingNumber}/${apartmentNumber}`
          : `${streetName} ${buildingNumber}`,
      };
    }
    
    return {
      streetName: null,
      buildingNumber: null,
      apartmentNumber: null,
      fullAddress: null,
    };
  }

  /**
   * Extract tenant name from counterparty name
   * Usually the counterparty name is the tenant name
   */
  private extractTenantName(counterpartyName: string): string | null {
    if (!counterpartyName) return null;
    
    // Clean up the name
    let name = counterpartyName.trim();
    
    // Remove extra spaces
    name = name.replace(/\s+/g, ' ');
    
    // Remove address parts at the end (e.g., "JOHN DOE 02-668 WARSZAWA")
    name = name.replace(/\s+\d{2}-\d{3}\s+.+$/i, '');
    
    // Remove street addresses
    name = name.replace(/\s+(?:al\.|aleja|ul\.|ulica)\s+.+$/i, '');
    
    // Capitalize properly
    name = this.capitalizeName(name);
    
    return name.trim() || null;
  }

  /**
   * Calculate confidence scores
   */
  private calculateConfidence(
    addressResult: { streetName: string | null; buildingNumber: string | null; apartmentNumber: string | null; fullAddress: string | null },
    tenantName: string | null,
    extractedApartment: string | null,
    isValidAddress: boolean,
    hasExplicitApartment: boolean
  ): ExtractedData['confidence'] {
    let addressConfidence = 0;
    let apartmentConfidence = 0;
    let tenantNameConfidence = 0;
    
    // If address is not in known properties, set very low confidence
    // This applies even with explicit apartment patterns - address validation is paramount
    if (!isValidAddress && addressResult.streetName) {
      addressConfidence = 10; // Very low - wrong property
      apartmentConfidence = 10;
      tenantNameConfidence = tenantName ? 30 : 0; // Some credit for having a name
      
      const overall = Math.round(
        (addressConfidence + apartmentConfidence + tenantNameConfidence) / 3
      );
      
      return {
        address: addressConfidence,
        apartment: apartmentConfidence,
        tenantName: tenantNameConfidence,
        overall,
      };
    }
    // Normal case: valid address or no address validation
    else {
      // Apartment confidence
      // Note: explicit apartment patterns (hasExplicitApartment) only boost confidence
      // when address is valid - otherwise rejected above
      if (extractedApartment) {
        apartmentConfidence = 95; // High confidence if we found "lokal numer: XXX"
      } else if (addressResult.apartmentNumber) {
        apartmentConfidence = 85; // Good confidence if found in address
      }
      
      // Address confidence
      if (addressResult.fullAddress) {
        if (addressResult.streetName && addressResult.buildingNumber) {
          addressConfidence = 95; // High confidence if we have street and building
        } else {
          addressConfidence = 60; // Medium confidence - partial match
        }
      } else if (extractedApartment) {
        // If we have apartment but no address, give some credit
        addressConfidence = 50;
      }
    }
    
    // Tenant name confidence
    if (tenantName) {
      if (tenantName.split(' ').length >= 2) {
        tenantNameConfidence = 95; // High confidence if we have at least first and last name
      } else {
        tenantNameConfidence = 70; // Medium confidence - only one name part
      }
    }
    
    // Overall confidence
    const overall = Math.round(
      (addressConfidence + apartmentConfidence + tenantNameConfidence) / 3
    );
    
    return {
      address: addressConfidence,
      apartment: apartmentConfidence,
      tenantName: tenantNameConfidence,
      overall,
    };
  }

  /**
   * Capitalize street name properly
   */
  private capitalizeStreet(street: string): string {
    return street
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Capitalize name properly
   */
  private capitalizeName(name: string): string {
    return name
      .toLowerCase()
      .split(' ')
      .map(word => {
        // Handle special cases like "von", "van", "de", etc.
        if (['von', 'van', 'de', 'da', 'di', 'del'].includes(word.toLowerCase())) {
          return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
