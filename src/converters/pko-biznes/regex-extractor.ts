/**
 * PKO Biznes ELIXIR Regex Extractor
 *
 * Thin wrapper around shared AddressMatcher.
 * Combines description + counterparty name for matching.
 *
 * In PKO Biznes ELIXIR the relevant text fields are:
 *   - description           → often contains payment description / address
 *   - counterpartyName      → payer/payee name, sometimes includes address fragment
 *   - counterpartyNameExtra → additional counterparty information
 */

import { ExtractedData, PKOBiznesTransaction } from './types';
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
  extract(transaction: PKOBiznesTransaction): ExtractedData | null {
    const description = transaction.description;
    const counterpartyName = transaction.counterpartyName;
    const counterpartyExtra = transaction.counterpartyNameExtra;

    // Build combined text for address matching
    const combinedText = [description, counterpartyName, counterpartyExtra]
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
        counterpartyNameExtra: counterpartyExtra,
        counterpartyIBAN: transaction.counterpartyIBAN,
      },
    };
  }
}
