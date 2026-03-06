/**
 * BNP Paribas XML Regex Extractor
 *
 * Thin wrapper around shared AddressMatcher.
 * Combines description + counterparty name + counterparty address for matching.
 *
 * In BNP CAMT.053 the relevant text fields are:
 *   - description  (RmtInf/Ustrd)      → often contains flat/address info
 *   - counterpartyName (Dbtr/Nm)        → payer name + possibly address fragment
 *   - counterpartyAddress (PstlAdr)     → city / street
 */

import { ExtractedData, BnpTransaction } from './types';
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
  extract(transaction: BnpTransaction): ExtractedData | null {
    const { description, counterpartyName, counterpartyAddress } = transaction;

    // Build combined text for address matching
    // Order: description first (most detail), then counterparty name + address
    const combinedText = [description, counterpartyName, counterpartyAddress]
      .filter(Boolean)
      .join(' ');

    // counterpartyName is like descOpt in Santander — often contains the payer's name
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
      rawData: { description, counterpartyName, counterpartyAddress },
    };
  }
}
