/**
 * Santander XML Regex Extractor
 * 
 * Thin wrapper around shared AddressMatcher.
 * Handles Santander-specific text extraction and null-return behavior.
 * 
 * REVERSIBILITY: Original implementation is in git history.
 * To revert: `git checkout HEAD~1 -- src/converters/santander-xml/regex-extractor.ts`
 */

import { ExtractedData, XmlTransaction } from './types';
import { Adres } from '../../shared/types';
import { AddressMatcher } from '../../shared/address-matcher';

export class RegexExtractor {
  private addressMatcher: AddressMatcher;

  constructor(addresses: Adres[] = []) {
    this.addressMatcher = new AddressMatcher(addresses);
  }

  /**
   * Try to extract data using regex patterns.
   * Returns null if confidence is too low (Santander-specific behavior).
   */
  extract(transaction: XmlTransaction): ExtractedData | null {
    const { descBase, descOpt } = transaction;
    const combinedText = `${descBase} ${descOpt}`;

    // Delegate to shared AddressMatcher
    // Pass descOpt as counterpartyName (in Santander XML, descOpt often contains name + address)
    const result = this.addressMatcher.match(combinedText, descOpt);

    // Santander-specific: return null when confidence is too low
    // This signals the caller to try AI extraction
    if (!result.isZGN && result.confidence.apartment < 70) {
      return null;
    }

    return {
      streetName: result.streetName,
      buildingNumber: result.buildingNumber,
      apartmentNumber: result.apartmentNumber,
      fullAddress: result.fullAddress,
      tenantName: result.tenantName,
      confidence: result.confidence,
      extractionMethod: 'regex',
      warnings: result.warnings,
      rawData: { descBase, descOpt },
    };
  }
}
