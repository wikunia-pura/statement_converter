/**
 * Shared AddressMatcher - Generic address/apartment extraction logic
 * 
 * Merges patterns from both Santander XML and PKO MT940 converters.
 * Both converters delegate to this module for address matching.
 * 
 * Confidence model: overall = (address + apartment + tenantName) / 3
 * Address validation: extracted addresses are validated against known properties
 * Polish char normalization: handles ąćęłńóśźż transparently
 * 
 * REVERSIBILITY: If this module causes regressions, each converter's
 * regex-extractor.ts has the original logic in git history. Just revert
 * the regex-extractor files to restore old behavior.
 */

import { Adres } from './types';

// === PUBLIC TYPES ===

export interface ApartmentExtraction {
  building: string | null;
  apartment: string;
  source: 'identifier' | 'address-pattern' | 'prefix-pattern' | 'fallback';
}

export interface AddressExtraction {
  streetName: string | null;
  buildingNumber: string | null;
  apartmentNumber: string | null;
  fullAddress: string | null;
}

export interface ConfidenceScores {
  address: number;
  apartment: number;
  tenantName: number;
  overall: number;
}

export interface AddressMatchResult {
  streetName: string | null;
  buildingNumber: string | null;
  apartmentNumber: string | null;
  fullAddress: string | null;
  tenantName: string | null;
  isZGN: boolean;
  confidence: ConfidenceScores;
  warnings: string[];
}

// === MAIN CLASS ===

export class AddressMatcher {
  private addresses: Adres[];

  constructor(addresses: Adres[] = []) {
    this.addresses = addresses;
  }

  /**
   * Main entry point - extract address/apartment/tenant from transaction text.
   *
   * @param combinedText  All transaction text combined (description + counterparty etc.)
   * @param counterpartyName  Optional counterparty name for tenant name extraction.
   *                          For Santander: pass descOpt. For PKO: pass counterpartyName.
   */
  match(combinedText: string, counterpartyName?: string): AddressMatchResult {
    // 1. Check for ZGN (Zakład Gospodarki Nieruchomościami)
    if (combinedText.toUpperCase().includes('GOSP. NIERUCHOM')) {
      return {
        streetName: null,
        buildingNumber: null,
        apartmentNumber: 'ZGN',
        fullAddress: 'ZGN',
        tenantName: null,
        isZGN: true,
        confidence: { address: 100, apartment: 100, tenantName: 0, overall: 95 },
        warnings: [],
      };
    }

    // 2. Extract apartment/identifier from text (merged patterns from both converters)
    const apartmentResult = this.extractApartmentNumber(combinedText);

    // 3. Match address against known properties
    const addressResult = this.extractAddress(
      combinedText,
      apartmentResult?.apartment || null
    );

    // 4. Validate address against configured properties
    let isValidAddress = false;
    if (this.addresses.length === 0) {
      // No addresses configured → accept any detected address (testing/demo mode)
      isValidAddress = !!addressResult.streetName;
    } else if (addressResult.streetName) {
      isValidAddress = this.isAddressInKnownProperties(
        addressResult.streetName,
        addressResult.buildingNumber
      );
    }

    // 5. Determine data trust level
    //    Identifiers (IDENTYFIKATOR: X/Y, etc.) are trusted even without address validation
    //    Address/prefix patterns require address validation
    const hasIdentifier = apartmentResult?.source === 'identifier';
    const hasExplicitApartment = !!apartmentResult;
    const useData = isValidAddress || hasIdentifier;

    // 6. Extract tenant name (from counterparty if provided, else from combined text)
    const tenantName = this.extractTenantName(counterpartyName || combinedText);

    // 7. Calculate confidence scores
    const confidence = this.calculateConfidence(
      addressResult,
      tenantName,
      apartmentResult?.apartment || null,
      isValidAddress,
      hasExplicitApartment,
      hasIdentifier
    );

    // 8. Build warnings
    const warnings: string[] = [];
    if (!addressResult.fullAddress && !apartmentResult?.apartment) {
      warnings.push('No address or apartment found');
    }
    if (!tenantName) {
      warnings.push('No tenant name extracted');
    }
    if (!isValidAddress && addressResult.streetName) {
      warnings.push(
        `Address "${addressResult.streetName} ${addressResult.buildingNumber}" does not match managed properties`
      );
    }

    // 9. Build result
    let streetName: string | null = null;
    let buildingNumber: string | null = null;
    let apartmentNumber: string | null = null;
    let fullAddress: string | null = null;

    if (useData) {
      streetName = addressResult.streetName;
      buildingNumber = addressResult.buildingNumber || apartmentResult?.building || null;
      apartmentNumber = apartmentResult?.apartment || addressResult.apartmentNumber;
      fullAddress = addressResult.fullAddress;

      // If we got identifier data but no address context, build fullAddress from identifier
      if (!fullAddress && hasIdentifier && apartmentResult) {
        if (apartmentResult.building) {
          fullAddress = `${apartmentResult.building}/${apartmentResult.apartment}`;
        } else {
          fullAddress = `Lokal ${apartmentResult.apartment}`;
        }
      }
    }

    return {
      streetName,
      buildingNumber,
      apartmentNumber,
      fullAddress,
      tenantName,
      isZGN: false,
      confidence,
      warnings,
    };
  }

  // ============================================================
  // APARTMENT EXTRACTION
  // Merged patterns from both Santander and PKO converters.
  // Priority: Identifiers > Address patterns > Prefix patterns > Fallback
  // ============================================================

  private extractApartmentNumber(text: string): ApartmentExtraction | null {
    const normalized = text.toLowerCase();

    // === IDENTIFIERS (highest priority) ===
    // These are explicit building/apartment references from property management systems.

    // "Wspolnotanr 27 - Identyfikator lokalu 26" (Santander-specific)
    const wspolnotaMatch = normalized.match(
      /wspolnotanr\s+(\d+)\s*-\s*identyfikator\s+lokalu\s+(\d+)/i
    );
    if (wspolnotaMatch) {
      return { building: wspolnotaMatch[1], apartment: wspolnotaMatch[2], source: 'identifier' };
    }

    // "identyfikator lokalu X/Y" or "identyfikator: X/Y" → building=X, apartment=Y
    const identSlash = normalized.match(
      /identyfikator(?:\s+lokalu)?[:\s]+(\d+)\/(\d+)/i
    );
    if (identSlash) {
      return { building: identSlash[1], apartment: identSlash[2], source: 'identifier' };
    }

    // "identyfikator lokalu XX" (standalone, no slash)
    const identStandalone = normalized.match(
      /identyfikator\s+lokalu\s+(\d+)(?!\s*\/)/i
    );
    if (identStandalone) {
      return { building: null, apartment: identStandalone[1], source: 'identifier' };
    }

    // "lokal ID X/Y" (Santander-specific)
    const lokalIdMatch = normalized.match(/lokal\s+id\s+(\d+)\/(\d+)/i);
    if (lokalIdMatch) {
      return { building: lokalIdMatch[1], apartment: lokalIdMatch[2], source: 'identifier' };
    }

    // "ID LOKALU X/Y" or "ID. LOKALU X/Y"
    const idLokaluSlash = normalized.match(/id\.?\s+lokalu\s+(\d+)\/(\d+)/i);
    if (idLokaluSlash) {
      return { building: idLokaluSlash[1], apartment: idLokaluSlash[2], source: 'identifier' };
    }

    // "ID LOKALU XX" (standalone, no slash)
    const idLokaluStandalone = normalized.match(/id\.?\s+lokalu\s+(\d+)(?!\s*\/\d)/i);
    if (idLokaluStandalone) {
      return { building: null, apartment: idLokaluStandalone[1], source: 'identifier' };
    }

    // "ID: X/Y" or "ID.X/Y" (Santander-style, more general ID with slash)
    const idGeneralSlash = normalized.match(/\bid[:\s\.]+(\d+)\/(\d+)/i);
    if (idGeneralSlash) {
      return { building: idGeneralSlash[1], apartment: idGeneralSlash[2], source: 'identifier' };
    }

    // "lokal numer: 111" / "lokal nr: 111" / "lokal: 111" / "lokal 111"
    const lokalMatch = normalized.match(
      /lokal(?:\s+numer|\s+nr)?[:\s]+(\d+)(?![\d\/])/i
    );
    if (lokalMatch) {
      return { building: null, apartment: lokalMatch[1], source: 'identifier' };
    }

    // "lokalu X" (standalone, e.g., "lokalu: 17" or "lokalu 17")
    const lokaluMatch = normalized.match(/lokalu[:\s]+(\d+)(?![\d\/])/i);
    if (lokaluMatch) {
      return { building: null, apartment: lokaluMatch[1], source: 'identifier' };
    }

    // === ADDRESS-BASED PATTERNS ===
    // Extract apartment from address format: "Street XX/YY"

    // "AL. LOTNIKÓW 20/82" or "ALEJA LOTNIKÓW20/51" (with street prefix)
    const addressWithPrefix = text.match(
      /(?:aleja|al\.|ulica|ul\.)\s*[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]+?\s*(\d{1,3})\/(\d{1,4})/i
    );
    if (addressWithPrefix && addressWithPrefix[2].length <= 3) {
      return {
        building: addressWithPrefix[1],
        apartment: addressWithPrefix[2],
        source: 'address-pattern',
      };
    }

    // "Lotników 20/33" (without prefix, street name must be 4+ chars)
    const streetSlash = text.match(
      /[a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ]{4,}\s+(\d{1,3})\/(\d{1,4})/i
    );
    if (streetSlash && streetSlash[2].length <= 3) {
      return {
        building: streetSlash[1],
        apartment: streetSlash[2],
        source: 'address-pattern',
      };
    }

    // === PREFIX PATTERNS ===
    // "mieszkanie X", "lok. X", "m. X" etc.

    // Handle glued postal codes: "lok. 5602-668" → apartment=56, postal=02-668
    const postalGlued = normalized.match(
      /\b(?:mieszkanie|lok\.?|loc\.?)\s*(\d{1,3})(0[0-9]-\d{3})/i
    );
    if (postalGlued) {
      return { building: null, apartment: postalGlued[1], source: 'prefix-pattern' };
    }

    // "mieszkanie 111", "lok. 111", "loc. 111", "m. 111", "m.111"
    const prefixMatch = normalized.match(
      /\b(?:mieszkanie|lok\.?|loc\.?)\s*(\d+)|\bm\.?\s*(\d+)(?!\s*pln)/i
    );
    if (prefixMatch) {
      const apt = prefixMatch[1] || prefixMatch[2];
      if (apt && apt.length <= 4) {
        return { building: null, apartment: apt, source: 'prefix-pattern' };
      }
    }

    // === FALLBACK ===
    // Number at the very beginning of text (e.g., "109 CZYNSZ ZA...")
    const fallbackMatch = normalized.match(/^(\d{1,4})(?!\s*pln)\s/i);
    if (fallbackMatch) {
      return { building: null, apartment: fallbackMatch[1], source: 'fallback' };
    }

    return null;
  }

  // ============================================================
  // ADDRESS EXTRACTION
  // Match against known property addresses, then fall back to generic patterns.
  // ============================================================

  private extractAddress(
    text: string,
    existingApartment: string | null
  ): AddressExtraction {
    // Normalize text for better matching
    let normalizedText = text
      .replace(/\bal\.\s*/gi, 'aleja ')
      .replace(/\bul\.\s*/gi, 'ulica ')
      .replace(/\bm\.\s*/gi, ' ')
      .replace(/\blok\.\s*/gi, ' ')
      .replace(/\bloc\.\s*/gi, ' ')
      .replace(/([a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ])\.\s/g, '$1 ')
      .replace(/([a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ])(\d)/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();

    // ASCII-normalized version for matching without Polish chars
    const normalizedTextAscii = this.normalizePolishChars(normalizedText.toLowerCase());

    // --- Try known addresses first (highest confidence) ---
    for (const addr of this.addresses) {
      // Parse the main address to get default building number
      const mainParsed = addr.nazwa.match(/^(.+?)\s+(\d+)$/);
      const mainStreet = mainParsed ? mainParsed[1] : addr.nazwa;
      const mainBuilding = mainParsed ? mainParsed[2] : null;

      const nameVariations = [addr.nazwa, ...(addr.alternativeNames || [])];

      for (const addrName of nameVariations) {
        // Parse "Aleja Lotników 20" → street="Aleja Lotników", building="20"
        // If name has no trailing number (e.g., "joliot curie"), use building from main name
        const addressMatch = addrName.match(/^(.+?)\s+(\d+)$/);
        const street = addressMatch ? addressMatch[1].toLowerCase() : addrName.toLowerCase();
        const building = addressMatch ? addressMatch[2] : mainBuilding;

        // Skip if we couldn't determine a building number at all
        if (!building) continue;

        const streetAscii = this.normalizePolishChars(street);

        // Build pattern: street + building + optional apartment
        // Use flexible name matching: hyphens/spaces interchangeable, dots optional
        const flexibleStreet = this.flexifyStreetName(streetAscii);
        const streetPattern = new RegExp(
          `(${flexibleStreet})\\s*${this.escapeRegex(building)}\\s*[/\\s]?\\s*(?:m\\.?\\s*)?(?:lok\\.?\\s*)?(?:loc\\.?\\s*)?([0-9]+)?`,
          'i'
        );

        const match = normalizedTextAscii.match(streetPattern);
        if (match) {
          const apartment = existingApartment || match[2] || null;

          return {
            streetName: mainStreet,
            buildingNumber: building,
            apartmentNumber: apartment,
            fullAddress: apartment
              ? `${mainStreet} ${building}/${apartment}`
              : `${mainStreet} ${building}`,
          };
        }
      }
    }

    // --- Generic patterns (no known address matched) ---

    // Pattern 1: "Aleja Lotników 20/100", "UL. Kowalska 5 M.12"
    const pattern1 =
      /(?:aleja|al|ulica|ul)\.?\s+([\wąćęłńóśźż]+(?:\s+[\wąćęłńóśźż]+)?)\s+(\d+)\s*[/\s]?\s*(?:m\.?\s*)?(?:lok\.?\s*)?(\d+)?/i;
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

    // Pattern 2: "LOTNIKÓW 20 100" (street name without prefix)
    const pattern2 =
      /([\wąćęłńóśźż]+(?:\s+[\wąćęłńóśźż]+)?)\s+(\d+)\s*[/\s]?\s*(?:m\.?\s*)?(?:lok\.?\s*)?(\d+)?/i;
    const match2 = normalizedText.match(pattern2);
    if (match2 && match2[1].length > 3) {
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

  // ============================================================
  // ADDRESS VALIDATION
  // Check if extracted address matches any managed property.
  // Supports main name (nazwa) and alternative names (alternativeNames).
  // ============================================================

  private isAddressInKnownProperties(
    streetName: string | null,
    buildingNumber: string | null
  ): boolean {
    if (!streetName || this.addresses.length === 0) {
      return true; // No validation possible → accept
    }

    const normalizedStreet = streetName.toLowerCase().trim();

    for (const addr of this.addresses) {
      // Parse the main address to get default building number
      const mainParsed = addr.nazwa.match(/^(.+?)\s+(\d+)$/);
      const mainBuilding = mainParsed ? mainParsed[2] : null;

      const nameVariations = [addr.nazwa, ...(addr.alternativeNames || [])];

      for (const addrName of nameVariations) {
        // Parse name; if no trailing number, use building from main name
        const addressMatch = addrName.match(/^(.+?)\s+(\d+)$/);
        const knownStreet = (addressMatch ? addressMatch[1] : addrName).toLowerCase().trim();
        const knownBuilding = addressMatch ? addressMatch[2] : mainBuilding;

        // Normalize: remove "aleja/al./ulica/ul." prefixes
        const normalizedKnown = knownStreet.replace(
          /^(?:aleja|al\.?|ulica|ul\.?)\s+/i,
          ''
        );
        const normalizedExtracted = normalizedStreet.replace(
          /^(?:aleja|al\.?|ulica|ul\.?)\s+/i,
          ''
        );

        // Compare without spaces/hyphens and without Polish diacritics
        const streetWithoutSpaces = this.normalizePolishChars(normalizedExtracted).replace(/[-\s]+/g, '');
        const knownWithoutSpaces = this.normalizePolishChars(normalizedKnown).replace(/[-\s]+/g, '');

        if (
          streetWithoutSpaces.includes(knownWithoutSpaces) ||
          knownWithoutSpaces.includes(streetWithoutSpaces)
        ) {
          // If both building numbers are known, they must match
          if (buildingNumber && knownBuilding && buildingNumber !== knownBuilding) {
            continue;
          }
          return true;
        }
      }
    }

    return false;
  }

  // ============================================================
  // TENANT NAME EXTRACTION
  // Cleans up counterparty name by removing address/postal code parts.
  // ============================================================

  private extractTenantName(text: string): string | null {
    if (!text) return null;

    let name = text.trim().replace(/\s+/g, ' ');

    // Remove postal codes and city: "KOWALSKI JAN 02-668 WARSZAWA" → "KOWALSKI JAN"
    name = name.replace(/\s+\d{2}-\d{3}\s+.+$/i, '');

    // Remove addresses: "KOWALSKI JAN UL. LOTNIKOW 20/33" → "KOWALSKI JAN"
    name = name.replace(/\s+(?:al\.|aleja|ul\.|ulica)\s+.+$/i, '');

    // Capitalize properly
    name = this.capitalizeName(name);

    return name.trim() || null;
  }

  // ============================================================
  // CONFIDENCE CALCULATION
  // Uses PKO-style model: overall = (address + apartment + tenantName) / 3
  // ============================================================

  private calculateConfidence(
    addressResult: AddressExtraction,
    tenantName: string | null,
    extractedApartment: string | null,
    isValidAddress: boolean,
    hasExplicitApartment: boolean,
    hasIdentifier: boolean
  ): ConfidenceScores {
    let addressConfidence = 0;
    let apartmentConfidence = 0;
    let tenantNameConfidence = 0;

    if (hasIdentifier && extractedApartment) {
      // Identifier-based: high apartment confidence
      // Address confidence depends on whether we also found a valid address
      apartmentConfidence = 95;
      addressConfidence = isValidAddress ? 95 : 50;
    } else if (!isValidAddress && addressResult.streetName) {
      // Address detected but NOT in known properties → very low confidence
      const overall = Math.round((10 + 10 + (tenantName ? 30 : 0)) / 3);
      return {
        address: 10,
        apartment: 10,
        tenantName: tenantName ? 30 : 0,
        overall,
      };
    } else {
      // Valid address or no address validation needed
      if (extractedApartment) {
        apartmentConfidence = 95;
      } else if (addressResult.apartmentNumber) {
        apartmentConfidence = 85;
      }

      if (addressResult.fullAddress) {
        addressConfidence =
          addressResult.streetName && addressResult.buildingNumber ? 95 : 60;
      } else if (extractedApartment) {
        addressConfidence = 50;
      }
    }

    // Tenant name confidence
    if (tenantName) {
      tenantNameConfidence = tenantName.split(' ').length >= 2 ? 95 : 70;
    }

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

  // ============================================================
  // UTILITIES
  // ============================================================

  private capitalizeStreet(street: string): string {
    return street
      .toLowerCase()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private capitalizeName(name: string): string {
    return name
      .toLowerCase()
      .split(' ')
      .map((w) => {
        if (['von', 'van', 'de', 'da', 'di', 'del'].includes(w.toLowerCase())) {
          return w.toLowerCase();
        }
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
  }

  /** Normalize Polish diacritics for comparison (ą→a, ć→c, etc.) */
  normalizePolishChars(str: string): string {
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

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()[\]\\]/g, '\\$&');
  }

  /**
   * Convert a street name into a flexible regex pattern where:
   * - hyphens and spaces are interchangeable (e.g., "Joliot-Curie" matches "joliot curie")
   * - dots are optional (e.g., "Al." matches "Al")
   */
  private flexifyStreetName(name: string): string {
    const escaped = this.escapeRegex(name);
    return escaped
      .replace(/[-\s]+/g, '[-\\s]+')
      .replace(/\\\./g, '\\.?');
  }
}
