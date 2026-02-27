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
    
    // Extract apartment number from both sources
    // Try BOTH description and counterparty, then pick the best one
    const apartmentFromDesc = this.extractApartmentNumber(description);
    const apartmentFromCounterparty = this.extractApartmentNumber(counterpartyName);
    
    // Determine which apartment number to use:
    // - If only one has a value, use that
    // - If both have values, prefer XX/YY format ONLY if it's in context of our property
    //   Example: "Lotników 20/33" is good, but "Orzycka 6/6" is not our property
    let apartmentNumber: string | null = null;
    if (apartmentFromDesc && apartmentFromCounterparty) {
      // Both have values - check if counterparty has our address format (Lotników XX/YY)
      // Only prefer counterparty if it contains our known street name
      const knownStreetPattern = /lotnik[óo]w\s+\d+\/\d+/i;
      const counterpartyHasOurAddress = knownStreetPattern.test(counterpartyName);
      const descHasOurAddress = knownStreetPattern.test(description);
      
      if (counterpartyHasOurAddress && !descHasOurAddress) {
        // Counterparty has our property address format, prefer it
        apartmentNumber = apartmentFromCounterparty;
      } else {
        // Default: prefer description (more relevant to the transaction)
        apartmentNumber = apartmentFromDesc;
      }
    } else {
      // Use whichever has a value
      apartmentNumber = apartmentFromDesc || apartmentFromCounterparty;
    }
    
    // Extract address
    const addressResult = this.extractAddress(fullText, apartmentNumber);
    
    // IMPORTANT: If we have a known addresses list, validate the extracted address
    // Address validation is ALWAYS required - even with explicit apartment patterns
    // If no address was detected in text, it's NOT valid (we require address context)
    let isValidAddress = false;
    if (this.addresses.length === 0) {
      // No addresses configured - accept all (for testing/demo)
      isValidAddress = !!addressResult.streetName;
    } else if (addressResult.streetName) {
      // We have addresses configured AND detected a street - validate it
      isValidAddress = this.isAddressInKnownProperties(addressResult.streetName, addressResult.buildingNumber);
    }
    // If no streetName detected → isValidAddress stays false (address context required!)
    
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
    
    // Pattern 0a: "identyfikator lokalu X/XX" - explicit identifier with prefix/apartment
    const patternIdentyfikatorSlash = /identyfikator\s+lokalu\s+\d+\/(\d+)/i;
    const matchIdentyfikatorSlash = normalizedDesc.match(patternIdentyfikatorSlash);
    if (matchIdentyfikatorSlash) {
      return matchIdentyfikatorSlash[1]; // Return apartment number after slash
    }
    
    // Pattern 0b: "Identyfikator lokalu XX" - explicit identifier (e.g., "Identyfikator lokalu 92")
    const patternIdentyfikator = /identyfikator\s+lokalu\s+(\d+)/i;
    const matchIdentyfikator = normalizedDesc.match(patternIdentyfikator);
    if (matchIdentyfikator) {
      return matchIdentyfikator[1];
    }
    
    // Pattern 1: "ID LOKALU X/XX" or "ID. LOKALU X/XX" - explicit identifier
    const patternID = /id\.?\s+lokalu\s+\d+\/(\d+)/i;
    const matchID = normalizedDesc.match(patternID);
    if (matchID) {
      return matchID[1]; // Return apartment number after slash
    }
    
    // Pattern 1b: "ID Lokalu X/XX" without the slash in middle (e.g., "ID. LOKALU 1/110")
    // Also handle "ID LOKALU 110" without prefix number
    const patternID2 = /id\.?\s+lokalu\s+(\d+)(?!\s*\/\d)/i;
    const matchID2 = normalizedDesc.match(patternID2);
    if (matchID2) {
      return matchID2[1];
    }
    
    // Pattern 2: "lokal numer: 111" or "lokal nr: 111" - explicit pattern
    const pattern2 = /lokal(?:\s+numer|\s+nr)?\s*:?\s*(\d+)/i;
    const match2 = normalizedDesc.match(pattern2);
    if (match2) {
      return match2[1];
    }
    
    // ==================== ADDRESS-BASED PATTERNS ====================
    
    // Pattern 3: Address format with known street names "AL. LOTNIKÓW 20/82" or "ALEJA LOTNIKÓW20/51"
    // ONLY match if it's a real address pattern with street names (not dates like "01/2026")
    // This requires street prefix (aleja, al., ulica, ul.) OR known street name
    // Note: \s* before building number - sometimes there's no space (LOTNIKÓW20/51)
    const pattern3 = /(?:aleja|al\.|ulica|ul\.)\s*[\wąćęłńóśźż\s]+?\s*(\d{1,3})\/(\d{1,4})/i;
    const match3 = description.match(pattern3);
    if (match3 && match3[2].length <= 3) { // Apartment numbers are typically 1-3 digits, not years
      return match3[2]; // Return the apartment number (after slash)
    }
    
    // Pattern 3b: Address format WITHOUT street prefix: "Lotników 20/33"
    // Matches: [StreetName] [BuildingNumber]/[ApartmentNumber]
    // Street name must be at least 4 chars and contain Polish letters (to avoid matching dates)
    const pattern3b = /[a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ]{4,}\s+(\d{1,3})\/(\d{1,4})/i;
    const match3b = description.match(pattern3b);
    if (match3b && match3b[2].length <= 3) {
      return match3b[2];
    }
    
    // ==================== PREFIX PATTERNS ====================
    
    // Pattern 4: "mieszkanie 111", "M. 111", "M.111", "M 111", "LOK. 111", "LOK.94", "LOC121"
    // Use word boundaries to avoid matching "REM." or other words containing "m"
    // Allow optional space after dot: "M.100" or "M. 100"
    // Also support "LOC" (English variant of LOK)
    // IMPORTANT: Handle glued postal codes like "lok. 5602-668" where 56 is apartment, 02-668 is postal code
    const pattern4Postal = /\b(?:mieszkanie|lok\.?|loc\.?)\s*(\d{1,3})(0[0-9]-\d{3})/i;
    const match4Postal = normalizedDesc.match(pattern4Postal);
    if (match4Postal) {
      return match4Postal[1]; // Return just apartment number, not glued postal code
    }
    
    const pattern4 = /\b(?:mieszkanie|lok\.?|loc\.?)\s*(\d+)|\bm\.?\s*(\d+)(?!\s*pln)/i;
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
        // Also normalize Polish chars to handle "Lotnikow" vs "Lotników"
        const streetWithoutSpaces = this.normalizePolishChars(normalizedExtractedStreet).replace(/\s+/g, '');
        const knownStreetWithoutSpaces = this.normalizePolishChars(normalizedKnownStreet).replace(/\s+/g, '');
        
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
    // IMPORTANT: Only match "AL." with dot, or "AL " followed by space/end - NOT "ALEJA"!
    let normalizedText = text
      .replace(/\bal\.\s*/gi, 'aleja ')   // "AL." -> "aleja " (requires dot)
      .replace(/\bul\.\s*/gi, 'ulica ')   // "UL." -> "ulica " (requires dot)
      .replace(/\bm\.\s*/gi, ' ')         // "M." or "M. " -> " "
      .replace(/\blok\.\s*/gi, ' ')       // "LOK." -> " " (requires dot)
      .replace(/\bloc\.\s*/gi, ' ')       // "LOC." -> " " (requires dot)
      .replace(/([a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ])\.\s/g, '$1 ')  // Remove stray dots after words: "LOTNIKÓW. " -> "LOTNIKÓW "
      .replace(/([a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ])(\d)/g, '$1 $2')  // Insert space before numbers: LOTNIKÓW20 -> LOTNIKÓW 20
      .replace(/\s+/g, ' ')                // Normalize multiple spaces to single space
      .trim();
    
    // Also create ASCII-normalized version for matching without Polish chars
    const normalizedTextAscii = this.normalizePolishChars(normalizedText.toLowerCase());
    
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
        
        // Normalize the street name for comparison (remove diacritics)
        const streetAscii = this.normalizePolishChars(street);
        
        // Check if this address is mentioned in the text (try both with and without Polish chars)
        const streetPattern = new RegExp(
          `(${this.escapeRegex(streetAscii)})\\s*${this.escapeRegex(building)}\\s*[/\\s]?\\s*(?:m\\.?\\s*)?(?:lok\\.?\\s*)?(?:loc\\.?\\s*)?([0-9]+)?`,
          'i'
        );
        
        const match = normalizedTextAscii.match(streetPattern);
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
    return str.replace(/[.*+?^${}()[\]\\]/g, '\\$&');
  }

  /**
   * Normalize Polish diacritics (ą->a, ć->c, ę->e, ł->l, ń->n, ó->o, ś->s, ź->z, ż->z)
   * This helps match "Lotnikow" with "Lotników"
   */
  private normalizePolishChars(str: string): string {
    return str
      .replace(/[ąĄ]/g, 'a')
      .replace(/[ćĆ]/g, 'c')
      .replace(/[ęĘ]/g, 'e')
      .replace(/[łŁ]/g, 'l')
      .replace(/[ńŃ]/g, 'n')
      .replace(/[óÓ]/g, 'o')
      .replace(/[śŚ]/g, 's')
      .replace(/[źŹżŻ]/g, 'z');
  }
}
