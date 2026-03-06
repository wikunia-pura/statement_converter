/**
 * ING Bank MT940 Regex Extractor
 *
 * Thin wrapper around shared AddressMatcher.
 * Combines description + counterparty name + additional info (~62) for matching.
 *
 * In ING MT940 the relevant text fields are:
 *   - description (~20-~25)          → payment description, often contains address
 *   - counterpartyName (~32+~33)     → payer/payee name, sometimes includes address
 *   - additionalInfo (~62)           → continuation of counterparty name/address
 */

import { ExtractedData, INGTransaction } from './types';
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
  extract(transaction: INGTransaction): ExtractedData | null {
    const description = transaction.details.description.join(''); // No space - preserve apartment numbers
    const counterpartyName = transaction.details.counterpartyName;
    const additionalInfo = transaction.details.additionalInfo;

    // Build combined text: description + counterparty name + ~62 continuation
    const combinedText = [description, counterpartyName, additionalInfo]
      .filter(Boolean)
      .join(' ');

    const result = this.addressMatcher.match(combinedText, counterpartyName);

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
        counterpartyName,
        counterpartyIBAN: transaction.details.counterpartyIBAN,
      },
    };
  }
}
