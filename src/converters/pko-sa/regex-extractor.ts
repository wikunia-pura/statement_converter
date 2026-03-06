/**
 * PKO SA EXP Regex Extractor
 *
 * Thin wrapper around shared AddressMatcher.
 * Combines description + counterparty for matching.
 *
 * In PKO SA EXP the relevant text fields are:
 *   - description  → often contains payment description / address
 *   - counterparty → payer/payee name and address
 */

import { ExtractedData, PKOSATransaction } from './types';
import { Adres } from '../../shared/types';
import { AddressMatcher } from '../../shared/address-matcher';

export class RegexExtractor {
  private addressMatcher: AddressMatcher;

  constructor(addresses: Adres[] = []) {
    this.addressMatcher = new AddressMatcher(addresses);
  }

  /**
   * Try to extract data using regex patterns.
   * Returns null if confidence is too low (signals caller to try AI extraction).
   */
  extract(transaction: PKOSATransaction): ExtractedData | null {
    const description = transaction.description;
    const counterparty = transaction.counterparty;

    // Build combined text for address matching
    const combinedText = [description, counterparty]
      .filter(Boolean)
      .join(' ');

    const result = this.addressMatcher.match(combinedText, counterparty);

    // Return null when confidence is too low → triggers AI extraction
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
      rawData: {
        description,
        counterparty,
        accountNumber: transaction.accountNumber,
      },
    };
  }
}
