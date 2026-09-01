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

import { Adres, ApartmentMappingTarget } from './types';
import {
  isLetteredApartment,
  letteredApartmentInText,
  stripAddressCodes,
  apartmentGlueInText,
  apartmentWidthImplausible,
  HELD_BACK_CONFIDENCE,
} from './apartment-account';
import { mappingTargets } from './apartment-mapping';

/**
 * The letter part of an apartment number — the `A` in `17A`.
 *
 * Appended to every apartment capture group in this file. Two deliberate limits:
 *
 *  - **Glued only.** The letter must sit directly against the digits. A payer who
 *    writes "BOGUNKI 5/27 A" while their own address says "M.27" means apartment
 *    27, and treating the stray "A" as part of the number would invent a lokal
 *    27A — the same class of mis-booking, just in the other direction.
 *  - **Exactly one letter.** `(?![A-Za-z])` stops the group from eating into a
 *    following word, which matters because MT940 subfields are concatenated
 *    without a separator, so a field boundary can put text right after a number.
 *
 * Capturing the letter is not what makes this safe, though — see
 * letteredApartmentInText() and the needsAccount flag. If a lettered number ever
 * slipped past these groups, the result would be a bare "17", which is precisely
 * the bug. So the guard is built to notice the letter in the text independently
 * of whether any capture group managed to grab it.
 */
const APT_LETTER = String.raw`(?:[A-Za-z](?![A-Za-z]))?`;

/**
 * Apartment-extraction patterns, in the priority order extractApartmentNumber
 * applies them: explicit identifiers, then apartment prefixes, then address
 * shapes, then a bare leading number.
 *
 * Hoisted to module scope for the same two reasons as the generic patterns below:
 * they compile once instead of on every transaction, and the shared APT_LETTER
 * fragment is interpolated in exactly one place per pattern, so the letter cannot
 * be forgotten in one of them the way it originally was in all of them.
 */
const APT_PATTERNS = {
  /** "Wspolnotanr 27 - Identyfikator lokalu 26" (Santander-specific) */
  wspolnota: new RegExp(
    String.raw`wspolnotanr\s+(\d+)\s*-\s*identyfikator\s+lokalu\s+(\d+${APT_LETTER})`,
    'i',
  ),
  /** "identyfikator lokalu X/Y" or "identyfikator: X/Y" → building=X, apartment=Y */
  identSlash: new RegExp(
    String.raw`identyfikator(?:\s+lokalu)?[:\s]+(\d+)\/(\d+${APT_LETTER})`,
    'i',
  ),
  /** "identyfikator lokalu XX" (standalone, no slash) */
  identStandalone: new RegExp(
    String.raw`identyfikator\s+lokalu\s+(\d+${APT_LETTER})(?!\s*\/)`,
    'i',
  ),
  /** "lokal ID X/Y" (Santander-specific) */
  lokalId: new RegExp(String.raw`lokal\s+id\s+(\d+)\/(\d+${APT_LETTER})`, 'i'),
  /** "ID LOKALU X/Y" or "ID. LOKALU X/Y" */
  idLokaluSlash: new RegExp(String.raw`id\.?\s+lokalu\s+(\d+)\/(\d+${APT_LETTER})`, 'i'),
  /** "ID LOKALU XX" (standalone, no slash) */
  idLokaluStandalone: new RegExp(
    String.raw`id\.?\s+lokalu\s+(\d+${APT_LETTER})(?!\s*\/\d)`,
    'i',
  ),
  /** "ID: X/Y" or "ID.X/Y" (Santander-style, more general ID with slash) */
  idGeneralSlash: new RegExp(String.raw`\bid[:\s\.]+(\d+)\/(\d+${APT_LETTER})`, 'i'),
  /** "lokal numer: 111" / "lokal nr: 111" / "lokal: 111" / "lokal 111" */
  lokal: new RegExp(
    String.raw`lokal(?:\s+numer|\s+nr)?[:\s]+(\d+${APT_LETTER})(?![\d\/])`,
    'i',
  ),
  /** "lokalu: 17" / "lokalu 17" */
  lokalu: new RegExp(String.raw`lokalu[:\s]+(\d+${APT_LETTER})(?![\d\/])`, 'i'),
  /** "mieszkanie 111", "lok. 111", "loc. 111", "m. 111", "m.111" */
  prefix: new RegExp(
    String.raw`\b(?:mieszkanie|lok\.?|loc\.?|lokal)\s*(\d+${APT_LETTER})|\bm\.?\s*(\d+${APT_LETTER})(?!\s*pln)`,
    'i',
  ),
  /**
   * "AL. LOTNIKÓW 20/82", "ALEJA LOTNIKÓW20/51" — street prefix, building may
   * carry a letter (2A), apartment may too (17A). Years are excluded so a date
   * like "20/2026" is not read as apartment 2026.
   */
  addressWithPrefix: new RegExp(
    String.raw`(?:aleja|al\.|ulica|ul\.)\s*[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]+?\s*(\d{1,3}[A-Z]?)\/(?!(?:19|20)\d{2})(\d{1,4}${APT_LETTER})`,
    'i',
  ),
  /** "Lotników 20/33" — no street prefix, street name must be 4+ chars. */
  streetSlash: new RegExp(
    String.raw`(?<!czynsz|zaliczka|zaliczki|fundusz|remontowy|remontowa|opłata|oplata|rata|wpłata|wplata|przelew|należność|naleznosc)\s+([a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ]{4,})\s+(\d{1,3}[A-Z]?)\/(?!(?:19|20)\d{2})(\d{1,4}${APT_LETTER})`,
    'i',
  ),
  /** Glued postal code: "lok. 5602-668" → apartment=56, postal=02-668 */
  postalGlued: new RegExp(
    String.raw`\b(?:mieszkanie|lok\.?|loc\.|lokal)\s*(\d{1,3}${APT_LETTER})(0[0-9]-\d{3})`,
    'i',
  ),
  /** Number at the very beginning of the text: "109 CZYNSZ ZA..." */
  leadingNumber: new RegExp(String.raw`^(\d{1,4}${APT_LETTER})(?!\s*pln)\s`, 'i'),
} as const;

// Generic fallback patterns — hoisted to module scope so they're compiled once,
// not rebuilt on every extractAddress() call.
const GENERIC_PATTERN_1 = new RegExp(
  String.raw`(?:aleja|al|ulica|ul)\.?\s+([\wąćęłńóśźż]+(?:\s+[\wąćęłńóśźż]+)?)\s+(\d+)\s*[/\s]?\s*(?:m\.?\s*)?(?:lok\.?\s*)?(\d+${APT_LETTER})?`,
  'i',
);
const GENERIC_PATTERN_2 = new RegExp(
  String.raw`([\wąćęłńóśźż]+(?:\s+[\wąćęłńóśźż]+)?)\s+(\d+)\s*[/\s]?\s*(?:m\.?\s*)?(?:lok\.?\s*)?(\d+${APT_LETTER})?`,
  'i',
);
/**
 * Splits a configured address name into street + building number: "Bogunki 5",
 * "Bachmacka 6A".
 *
 * The optional letter is load-bearing. Without it a name like "Bachmacka 6A"
 * parsed to *no* building number, and extractAddress skips every variation whose
 * building is unknown — so the known-address path silently never ran for such a
 * community, leaving it on the generic fallback patterns.
 */
const ADDRESS_NAME = /^(.+?)\s+(\d+[A-Za-z]?)$/;
const STREET_BLACKLIST =
  /^(czynsz|zaliczka|zaliczki|fundusz|remontowy|remontowa|opłata|oplata|rata|wpłata|wplata|przelew|należność|naleznosc|płatność|platnosc|faktura|rachunek|za\s+)/i;

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
  /** True when the apartment number came from a user-defined ApartmentMapping rule. */
  matchedByManualMapping: boolean;
  /** Account symbol from the matching rule's "konto lokalu", when the rule set one. */
  accountOverride: string | null;
  /**
   * True when the apartment number carries a letter (17A) and no account symbol
   * is known for it, so the transaction must not be booked automatically. The
   * confidence is held below the review threshold whenever this is set.
   */
  needsAccount: boolean;
  /**
   * The apartments a matched rule offers, when the rule names more than one.
   * Empty for every other kind of match.
   *
   * While this is non-empty, `apartmentNumber` is deliberately null: the rule
   * recognized the payer, not the apartment, and picking one of several owned by
   * the same person is a decision only the user can make. Leaving the number out
   * is what keeps the money safe — nothing downstream can book a transaction with
   * no apartment, so an ignored row lands in "NIEROZPOZNANE" instead of on a
   * plausible-looking wrong account.
   */
  apartmentChoices: ApartmentMappingTarget[];
}

// === INTERNAL PRECOMPUTED TYPES ===

/** One name-variation of an address, with everything derivable precomputed. */
interface CompiledVariation {
  /** Building number for this variation (from the variation, or the main name). */
  building: string | null;
  /** Regex matching "street + building + optional apartment" — null when no building. */
  streetPattern: RegExp | null;
  /** Street (ascii, no diacritics, no spaces/hyphens) for validation containment checks. */
  knownWithoutSpaces: string;
}

/** One apartment a rule points at, normalized at build time. */
interface CompiledMappingTarget {
  apartment: string;
  /** Explicit account symbol from the rule, or null to use the default prefix rule. */
  accountOverride: string | null;
}

/** A precomputed apartment-mapping rule (street/building/apartments fixed at build time). */
interface CompiledMapping {
  needle: string;
  streetName: string;
  buildingNumber: string | null;
  /** Address without an apartment — used when the rule offers several. */
  baseAddress: string;
  /** Never empty; more than one entry means the user has to pick. */
  targets: CompiledMappingTarget[];
}

/** All transaction-independent derived data for one address. */
interface CompiledAddress {
  mainStreet: string;
  variations: CompiledVariation[];
  mappings: CompiledMapping[];
}

// === MAIN CLASS ===

export class AddressMatcher {
  private addresses: Adres[];
  /** Precomputed per-address regexes/normalized strings — built once, reused per transaction. */
  private compiled: CompiledAddress[];

  constructor(addresses: Adres[] = []) {
    this.addresses = addresses;
    this.compiled = addresses.map(addr => this.compileAddress(addr));
  }

  private compileAddress(addr: Adres): CompiledAddress {
    const mainParsed = addr.nazwa.match(ADDRESS_NAME);
    const mainStreet = mainParsed ? mainParsed[1] : addr.nazwa;
    const mainBuilding = mainParsed ? mainParsed[2] : null;

    const nameVariations = [addr.nazwa, ...(addr.alternativeNames || [])];
    const variations: CompiledVariation[] = nameVariations.map(addrName => {
      const addressMatch = addrName.match(ADDRESS_NAME);
      const street = addressMatch ? addressMatch[1].toLowerCase() : addrName.toLowerCase();
      const building = addressMatch ? addressMatch[2] : mainBuilding;

      // Build the street+building matching regex (only when a building is known).
      let streetPattern: RegExp | null = null;
      if (building) {
        const streetAscii = this.normalizePolishChars(street);
        const flexibleStreet = this.flexifyStreetName(streetAscii);
        streetPattern = new RegExp(
          `(${flexibleStreet})\\s*${this.escapeRegex(building)}\\s*[/\\s]?\\s*(?:m\\.?\\s*)?(?:lok\\.?\\s*)?(?:loc\\.?\\s*)?([0-9]+${APT_LETTER})?`,
          'i',
        );
      }

      // Validation containment key (mirrors isAddressInKnownProperties).
      const knownStreet = (addressMatch ? addressMatch[1] : addrName).toLowerCase().trim();
      const normalizedKnown = knownStreet.replace(/^(?:aleja|al\.?|ulica|ul\.?)\s+/i, '');
      const knownWithoutSpaces = this.normalizePolishChars(normalizedKnown).replace(/[-\s]+/g, '');

      return { building, streetPattern, knownWithoutSpaces };
    });

    // Parse street/building context from the address name for apartment mappings.
    const parsed = addr.nazwa.match(ADDRESS_NAME);
    const mapStreet = parsed ? parsed[1] : addr.nazwa;
    const mapBuilding = parsed ? parsed[2] : null;
    const mappings: CompiledMapping[] = (addr.apartmentMappings || [])
      .map(mapping => {
        const needle = this.normalizePolishChars((mapping.matchText || '').trim().toLowerCase());
        const targets: CompiledMappingTarget[] = mappingTargets(mapping)
          .map(target => ({
            apartment: this.normalizeApartment(target.apartmentNumber),
            accountOverride: (target.kontoLokalu || '').trim() || null,
          }))
          .filter(target => target.apartment.length > 0);
        if (!needle || targets.length === 0) return null;
        return {
          needle,
          streetName: mapStreet,
          buildingNumber: mapBuilding,
          baseAddress: mapBuilding ? `${mapStreet} ${mapBuilding}` : mapStreet,
          targets,
        };
      })
      .filter((m): m is CompiledMapping => m !== null);

    return { mainStreet, variations, mappings };
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
        matchedByManualMapping: false,
        accountOverride: null,
        needsAccount: false,
        apartmentChoices: [],
      };
    }

    // 1b. User-defined apartment mappings (highest priority — explicit rules for
    //     "weird" recurring payments the matcher can't otherwise resolve).
    //     High confidence (95) so the regex path accepts it and AI is skipped;
    //     the matchedByManualMapping flag still forces the transaction into review.
    //     A rule naming several apartments returns no number and offers them as
    //     `apartmentChoices` instead — see matchApartmentMapping.
    const mappingMatch = this.matchApartmentMapping(combinedText, counterpartyName);
    if (mappingMatch) {
      return mappingMatch;
    }

    // 2. Take the address codes out, then extract apartment/identifier from text.
    //    Both extractors below read the stripped text, because the glued postal
    //    code fools them in opposite directions: the apartment patterns read
    //    "M.202-620" as apartment 202, and the known-address path reads the plain
    //    "Puławska 116 02-620" as apartment 02. Stripping happens *after* the
    //    rules above, so a rule whose phrase contains a postal code still matches.
    const scanText = stripAddressCodes(combinedText);
    const apartmentResult = this.extractApartmentNumber(scanText);

    // 3. Match address against known properties
    const addressResult = this.extractAddress(
      scanText,
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
    const useData = isValidAddress || hasIdentifier;

    // 5a. Determine apartment source quality
    //     "confirmed" = apartment number came from known address match (extractAddress with match[2])
    //     "unconfirmed" = apartment came from extractApartmentNumber (may be tenant's home address)
    const apartmentFromKnownAddress = isValidAddress && !!addressResult.apartmentNumber;
    const apartmentFromIdentifier = hasIdentifier && !!apartmentResult?.apartment;
    const apartmentConfirmed = apartmentFromKnownAddress || apartmentFromIdentifier;

    // 6. Extract tenant name (from counterparty if provided, else from combined text)
    const tenantName = this.extractTenantName(counterpartyName || combinedText);

    // 7. Calculate confidence scores (CONSERVATIVE policy)
    const confidence = this.calculateConfidence(
      addressResult,
      tenantName,
      isValidAddress,
      hasIdentifier,
      apartmentConfirmed
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
    if (!apartmentConfirmed && apartmentResult?.apartment) {
      warnings.push(
        `Apartment "${apartmentResult.apartment}" extracted from generic pattern (not from known address) — needs verification`
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

      // When we matched a known address from the database, prefer its apartment number
      // over the one extracted by extractApartmentNumber (which may come from tenant's home address)
      if (apartmentFromKnownAddress) {
        apartmentNumber = addressResult.apartmentNumber;
      } else if (apartmentFromIdentifier) {
        apartmentNumber = apartmentResult!.apartment;
      } else {
        // Fallback: use whatever we have, but confidence will be low
        apartmentNumber = apartmentResult?.apartment || addressResult.apartmentNumber;
      }

      fullAddress = addressResult.fullAddress;

      // If apartment was overridden from addressResult, update fullAddress too
      if (apartmentFromKnownAddress && addressResult.streetName && addressResult.buildingNumber) {
        fullAddress = `${addressResult.streetName} ${addressResult.buildingNumber}/${addressResult.apartmentNumber}`;
      }

      // If we got identifier data but no address context, build fullAddress from identifier
      if (!fullAddress && hasIdentifier && apartmentResult) {
        if (apartmentResult.building) {
          fullAddress = `${apartmentResult.building}/${apartmentResult.apartment}`;
        } else {
          fullAddress = `Lokal ${apartmentResult.apartment}`;
        }
      }
    }

    // 10. Lettered-apartment guard.
    //
    // Two distinct dangers, and only the second one is about our own regexes:
    //
    //  a) We *did* read a letter ("17A"). The number is right, but no account
    //     symbol can be derived for it, so booking must wait for the user.
    //  b) The text clearly shows a lettered apartment while we ended up with a
    //     plain number. That is the mis-booking case — 17A landing on lokal 17 —
    //     and it must be caught even though no capture group produced the letter,
    //     because a missed letter looks exactly like a correct plain number.
    //
    // Both push the transaction below the review threshold. Under-booking costs a
    // click; over-confident booking moves money to the wrong owner.
    const letteredInText = letteredApartmentInText(combinedText);
    const apartmentIsLettered = isLetteredApartment(apartmentNumber);
    const letterLost = !!letteredInText && !!apartmentNumber && !apartmentIsLettered;
    const needsAccount = apartmentIsLettered || letterLost;

    if (apartmentIsLettered) {
      warnings.push(
        `Apartment "${apartmentNumber}" has a letter — its account symbol must be set by the user (apartment rule or review)`
      );
    } else if (letterLost) {
      warnings.push(
        `Text mentions apartment "${letteredInText}" but "${apartmentNumber}" was recognized — verify before booking`
      );
    }

    // 10b. Glue guard — the same shape of danger as (b) above, one field over.
    //
    // Step 2 removes the address codes we can split deterministically. This
    // catches what is left: a number standing on a field boundary the bank did
    // not separate, or one so wide it has plainly swallowed its neighbour. Either
    // way the digits may belong to two fields, and a wrong apartment number is
    // indistinguishable from a right one once it reaches the books.
    const glueResidue = apartmentGlueInText(combinedText, apartmentNumber);
    const implausibleWidth = apartmentWidthImplausible(apartmentNumber);
    const gluedNumber = !!glueResidue || implausibleWidth;

    if (implausibleWidth) {
      warnings.push(
        `Apartment "${apartmentNumber}" is too wide to be a real one — it has absorbed glued text; verify before booking`
      );
    } else if (glueResidue) {
      warnings.push(
        `Apartment "${apartmentNumber}" runs straight into "${glueResidue.trim()}" — the field boundary is unclear; verify before booking`
      );
    }

    return {
      streetName,
      buildingNumber,
      apartmentNumber,
      fullAddress,
      tenantName,
      isZGN: false,
      confidence:
        needsAccount || gluedNumber ? this.holdBackForReview(confidence) : confidence,
      warnings,
      matchedByManualMapping: false,
      accountOverride: null,
      needsAccount,
      apartmentChoices: [],
    };
  }

  /**
   * Push confidence below the review threshold (70) while keeping the relative
   * scores readable, so a held-back transaction still shows why it was matched.
   */
  private holdBackForReview(confidence: ConfidenceScores): ConfidenceScores {
    return {
      ...confidence,
      apartment: Math.min(confidence.apartment, HELD_BACK_CONFIDENCE),
      overall: Math.min(confidence.overall, HELD_BACK_CONFIDENCE),
    };
  }

  // ============================================================
  // USER-DEFINED APARTMENT MAPPINGS
  // Match the transaction text against each address's apartmentMappings.
  // matchText is compared as a normalized (lowercase, no Polish diacritics)
  // substring of the combined text + counterparty name.
  // ============================================================

  private matchApartmentMapping(
    combinedText: string,
    counterpartyName?: string
  ): AddressMatchResult | null {
    const haystack = this.normalizePolishChars(
      `${combinedText} ${counterpartyName || ''}`.toLowerCase()
    );

    for (const compiled of this.compiled) {
      for (const mapping of compiled.mappings) {
        if (!haystack.includes(mapping.needle)) continue;

        const tenantName = this.extractTenantName(counterpartyName || combinedText);

        // A rule naming several apartments identifies the payer but not which of
        // their apartments this transfer is for — one owner, one account, one
        // description, several apartments. So no number is returned at all and the
        // apartments travel as choices for the acceptance screen.
        //
        // The confidence stays high on purpose, even without a number: it is what
        // tells the pipeline the text is understood, so the transaction is not sent
        // to the AI to have the missing apartment invented. The empty number is
        // what keeps it out of the books until the user picks.
        if (mapping.targets.length > 1) {
          return {
            streetName: mapping.streetName,
            buildingNumber: mapping.buildingNumber,
            apartmentNumber: null,
            fullAddress: mapping.baseAddress,
            tenantName,
            isZGN: false,
            confidence: {
              address: 95,
              apartment: 95,
              tenantName: tenantName ? 95 : 0,
              overall: 95,
            },
            warnings: [
              `Rule matched ${mapping.targets.length} apartments (${mapping.targets
                .map(target => target.apartment)
                .join(', ')}) — the user picks one on the acceptance screen`,
            ],
            matchedByManualMapping: true,
            accountOverride: null,
            needsAccount: false,
            apartmentChoices: mapping.targets.map(target => ({
              apartmentNumber: target.apartment,
              ...(target.accountOverride ? { kontoLokalu: target.accountOverride } : {}),
            })),
          };
        }

        const [target] = mapping.targets;

        // A rule pointing at a lettered apartment is only bookable when it also
        // carries the account symbol — otherwise the rule states *which* apartment
        // this is, but not where to book it, and the user still has to say.
        const needsAccount =
          isLetteredApartment(target.apartment) && !target.accountOverride;
        const warnings = needsAccount
          ? [
              `Rule matched apartment "${target.apartment}" but the rule has no account symbol ("konto lokalu") — set one to book it automatically`,
            ]
          : [];
        const confidence = {
          address: 95,
          apartment: needsAccount ? 40 : 95,
          tenantName: tenantName ? 95 : 0,
          overall: needsAccount ? 40 : 95,
        };

        return {
          streetName: mapping.streetName,
          buildingNumber: mapping.buildingNumber,
          apartmentNumber: target.apartment,
          fullAddress: mapping.buildingNumber
            ? `${mapping.streetName} ${mapping.buildingNumber}/${target.apartment}`
            : `${mapping.streetName} ${target.apartment}`,
          tenantName,
          isZGN: false,
          confidence,
          warnings,
          matchedByManualMapping: true,
          accountOverride: target.accountOverride,
          needsAccount,
          apartmentChoices: [],
        };
      }
    }

    return null;
  }

  // ============================================================
  // APARTMENT EXTRACTION
  // Merged patterns from both Santander and PKO converters.
  // Priority: Identifiers > Address patterns > Prefix patterns > Fallback
  // ============================================================

  private extractApartmentNumber(text: string): ApartmentExtraction | null {
    const normalized = text.toLowerCase();
    const found = (
      building: string | null,
      apartment: string,
      source: ApartmentExtraction['source'],
    ): ApartmentExtraction => ({
      building,
      apartment: this.normalizeApartment(apartment),
      source,
    });

    // === IDENTIFIERS (highest priority) ===
    // These are explicit building/apartment references from property management systems.

    const wspolnotaMatch = normalized.match(APT_PATTERNS.wspolnota);
    if (wspolnotaMatch) {
      return found(wspolnotaMatch[1], wspolnotaMatch[2], 'identifier');
    }

    const identSlash = normalized.match(APT_PATTERNS.identSlash);
    if (identSlash) {
      return found(identSlash[1], identSlash[2], 'identifier');
    }

    const identStandalone = normalized.match(APT_PATTERNS.identStandalone);
    if (identStandalone) {
      return found(null, identStandalone[1], 'identifier');
    }

    const lokalIdMatch = normalized.match(APT_PATTERNS.lokalId);
    if (lokalIdMatch) {
      return found(lokalIdMatch[1], lokalIdMatch[2], 'identifier');
    }

    const idLokaluSlash = normalized.match(APT_PATTERNS.idLokaluSlash);
    if (idLokaluSlash) {
      return found(idLokaluSlash[1], idLokaluSlash[2], 'identifier');
    }

    const idLokaluStandalone = normalized.match(APT_PATTERNS.idLokaluStandalone);
    if (idLokaluStandalone) {
      return found(null, idLokaluStandalone[1], 'identifier');
    }

    const idGeneralSlash = normalized.match(APT_PATTERNS.idGeneralSlash);
    if (idGeneralSlash) {
      return found(idGeneralSlash[1], idGeneralSlash[2], 'identifier');
    }

    const lokalMatch = normalized.match(APT_PATTERNS.lokal);
    if (lokalMatch) {
      return found(null, lokalMatch[1], 'identifier');
    }

    const lokaluMatch = normalized.match(APT_PATTERNS.lokalu);
    if (lokaluMatch) {
      return found(null, lokaluMatch[1], 'identifier');
    }

    // === PREFIX PATTERNS (higher priority than address patterns) ===
    // "mieszkanie X", "lok. X", "m. X" etc. - explicit apartment references
    // These are treated as identifiers (trusted without address validation)
    const prefixMatch = normalized.match(APT_PATTERNS.prefix);
    if (prefixMatch) {
      const apt = prefixMatch[1] || prefixMatch[2];
      // Length is measured on the digits alone, so "128A" is not rejected as
      // 4-digits-plus for carrying a letter.
      if (apt && this.apartmentDigits(apt).length <= 4) {
        return found(null, apt, 'identifier');
      }
    }

    // === ADDRESS-BASED PATTERNS ===
    // Extract apartment from address format: "Street XX/YY"
    // NOTE: Exclude dates (MM/20XX or XX/19XX patterns)
    // NOTE: Exclude common non-street words (CZYNSZ, ZALICZKA, FUNDUSZ, REMONTOWY, etc.)
    const addressWithPrefix = text.match(APT_PATTERNS.addressWithPrefix);
    if (addressWithPrefix && this.apartmentDigits(addressWithPrefix[2]).length <= 3) {
      return found(addressWithPrefix[1], addressWithPrefix[2], 'address-pattern');
    }

    const streetSlash = text.match(APT_PATTERNS.streetSlash);
    if (streetSlash && this.apartmentDigits(streetSlash[3]).length <= 3) {
      return found(streetSlash[2], streetSlash[3], 'address-pattern');
    }

    // === POSTAL CODE PATTERNS ===
    const postalGlued = normalized.match(APT_PATTERNS.postalGlued);
    if (postalGlued) {
      return found(null, postalGlued[1], 'identifier');
    }

    // === FALLBACK ===
    // Number at the very beginning of text (e.g., "109 CZYNSZ ZA...")
    const fallbackMatch = normalized.match(APT_PATTERNS.leadingNumber);
    if (fallbackMatch) {
      return found(null, fallbackMatch[1], 'fallback');
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
    for (const compiled of this.compiled) {
      const mainStreet = compiled.mainStreet;

      for (const variation of compiled.variations) {
        // Skip variations for which we couldn't determine a building number.
        if (!variation.building || !variation.streetPattern) continue;

        const match = normalizedTextAscii.match(variation.streetPattern);
        if (match) {
          // IMPORTANT: If the known address pattern itself captured an apartment number (match[2]),
          // prefer it over existingApartment which may come from an unrelated address
          // (e.g., tenant's home address like "Belwederska 5/7" vs managed property "Głogowa 26/9")
          const apartment = match[2]
            ? this.normalizeApartment(match[2])
            : existingApartment || null;
          const building = variation.building;

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
    const match1 = normalizedText.match(GENERIC_PATTERN_1);
    if (match1) {
      const streetName = this.capitalizeStreet(match1[1]);
      const buildingNumber = match1[2];
      const apartmentNumber =
        existingApartment || (match1[3] ? this.normalizeApartment(match1[3]) : null);

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
    // BUT: Exclude common non-street words (CZYNSZ, FUNDUSZ, etc.)
    const match2 = normalizedText.match(GENERIC_PATTERN_2);
    if (match2 && match2[1].length > 3) {
      const streetCandidate = match2[1].trim();

      // Skip if matched word is in blacklist
      if (!STREET_BLACKLIST.test(streetCandidate)) {
        const streetName = this.capitalizeStreet(match2[1]);
        const buildingNumber = match2[2];
        const apartmentNumber =
          existingApartment || (match2[3] ? this.normalizeApartment(match2[3]) : null);

        return {
          streetName,
          buildingNumber,
          apartmentNumber,
          fullAddress: apartmentNumber
            ? `${streetName} ${buildingNumber}/${apartmentNumber}`
            : `${streetName} ${buildingNumber}`,
        };
      }
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
    const normalizedExtracted = normalizedStreet.replace(/^(?:aleja|al\.?|ulica|ul\.?)\s+/i, '');
    // Extracted-street key — depends only on the transaction, computed once.
    const streetWithoutSpaces = this.normalizePolishChars(normalizedExtracted).replace(/[-\s]+/g, '');

    for (const compiled of this.compiled) {
      for (const variation of compiled.variations) {
        const knownWithoutSpaces = variation.knownWithoutSpaces;

        if (
          streetWithoutSpaces.includes(knownWithoutSpaces) ||
          knownWithoutSpaces.includes(streetWithoutSpaces)
        ) {
          // If both building numbers are known, they must match
          if (buildingNumber && variation.building && buildingNumber !== variation.building) {
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
  // CONSERVATIVE POLICY: High confidence (≥60) ONLY when:
  //   1. Identifier found (source='identifier') — always trusted
  //   2. Known address matched AND apartment from that same match
  //   3. ZGN marker (handled separately in match())
  // Everything else → <60 → requires manual review.
  // This prevents producing wrong output from tenant home addresses.
  //
  // To revert to old behavior: git checkout 8d07ece -- src/shared/address-matcher.ts
  // ============================================================

  private calculateConfidence(
    addressResult: AddressExtraction,
    tenantName: string | null,
    isValidAddress: boolean,
    hasIdentifier: boolean,
    apartmentConfirmed: boolean
  ): ConfidenceScores {
    let addressConfidence = 0;
    let apartmentConfidence = 0;
    let tenantNameConfidence = 0;

    // Tenant name confidence (independent of address/apartment)
    if (tenantName) {
      tenantNameConfidence = tenantName.split(' ').length >= 2 ? 95 : 70;
    }

    const hasConfiguredProperties = this.addresses.length > 0;

    // === CASE 1: Identifier found (e.g., "identyfikator lokalu 27/9") ===
    if (hasIdentifier && apartmentConfirmed) {
      apartmentConfidence = 95;
      addressConfidence = isValidAddress ? 95 : 50;
    }
    // === CASE 2: Known address matched + apartment from that match ===
    else if (isValidAddress && apartmentConfirmed) {
      addressConfidence = 95;
      apartmentConfidence = 95;
    }
    // === CASE 3: Known address matched but apartment from elsewhere (or missing) ===
    else if (isValidAddress && !apartmentConfirmed) {
      addressConfidence = 90;
      apartmentConfidence = 30; // Low — apartment source is unverified or missing
    }
    // === CASE 4: User has properties configured but no known address found ===
    else if (hasConfiguredProperties && !isValidAddress) {
      if (addressResult.streetName) {
        // Found a street but it's not in the database
        addressConfidence = 10;
        apartmentConfidence = 10;
      } else {
        // No street found at all
        addressConfidence = 20;
        apartmentConfidence = 20;
      }
    }
    // === CASE 5: No properties configured (demo/testing mode) ===
    else {
      if (addressResult.fullAddress) {
        addressConfidence = addressResult.streetName && addressResult.buildingNumber ? 80 : 50;
      }
      apartmentConfidence = apartmentConfirmed ? 80 : 40;
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

  /**
   * Canonical form of an apartment number: trimmed, letter upper-cased.
   *
   * Most patterns run against a lower-cased copy of the text, so a match yields
   * "17a". Left alone, "17a" and "17A" would become two different apartments and
   * therefore two different accounts for the same owner.
   */
  private normalizeApartment(value: string): string {
    return value.trim().toUpperCase();
  }

  /** The digits of an apartment number, without the optional trailing letter. */
  private apartmentDigits(value: string): string {
    return value.replace(/[A-Za-z]+$/, '');
  }

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
