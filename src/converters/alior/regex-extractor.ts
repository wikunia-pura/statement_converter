/**
 * Alior Bank MT940 Regex Extractor
 *
 * Thin wrapper around shared AddressMatcher.
 * Combines description + counterparty name + counterparty address for matching.
 *
 * In Alior MT940 the relevant text fields are:
 *   - description (<20>-<25>)       → often contains payment description / address
 *   - counterpartyName (<27>+<28>)  → payer/payee name, sometimes includes address fragment
 *   - counterpartyAddress (<29>)    → explicit address line
 */

import { ExtractedData, AliorTransaction } from './types';
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
  extract(transaction: AliorTransaction): ExtractedData | null {
    const description = transaction.details.description.join(' ');
    const counterpartyName = transaction.details.counterpartyName;
    const counterpartyAddress = transaction.details.counterpartyAddress;

    // Build combined text for address matching
    const combinedText = [description, counterpartyName, counterpartyAddress]
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
