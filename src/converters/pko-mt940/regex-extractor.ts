/**
 * PKO BP MT940 Regex Extractor
 * 
 * Thin wrapper around shared AddressMatcher.
 * Handles PKO-specific text extraction (MT940 format).
 * 
 * REVERSIBILITY: Original implementation is in git history.
 * To revert: `git checkout HEAD~1 -- src/converters/pko-mt940/regex-extractor.ts`
 */

import { MT940Transaction, ExtractedData } from './types';
import { Adres } from '../../shared/types';
import { AddressMatcher } from '../../shared/address-matcher';

export class RegexExtractor {
  private addressMatcher: AddressMatcher;

  constructor(addresses: Adres[] = []) {
    this.addressMatcher = new AddressMatcher(addresses);
  }

  /**
   * Extract data from transaction using regex patterns.
   * Always returns ExtractedData (PKO-specific behavior - never null).
   */
  extract(transaction: MT940Transaction): ExtractedData {
    const description = transaction.details.description.join(''); // No space - preserve apartment numbers
    const counterpartyName = transaction.details.counterpartyName;
    const combinedText = `${description} ${counterpartyName}`;

    // Delegate to shared AddressMatcher
    const result = this.addressMatcher.match(combinedText, counterpartyName);

    return {
      streetName: result.streetName,
      buildingNumber: result.buildingNumber,
      apartmentNumber: result.apartmentNumber,
      fullAddress: result.fullAddress,
      tenantName: result.tenantName,
      confidence: result.confidence,
      extractionMethod: 'regex',
      warnings: result.warnings,
      rawData: {
        description,
        counterpartyName,
        counterpartyIBAN: transaction.details.counterpartyIBAN,
      },
    };
  }
}
