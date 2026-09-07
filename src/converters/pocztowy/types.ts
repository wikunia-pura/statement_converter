/**
 * Bank Pocztowy MT940 Converter - Type Definitions
 * Format: MT940 (SWIFT) with `<XX` subfield delimiters in :86:
 *
 * The per-transaction field set is the same as ING's MT940, so `PocztowyTransaction`
 * extends `INGTransaction` and the ING RegexExtractor / CsvExporter are reused
 * verbatim (same trick BOŚ plays with BNP's). Only the two Pocztowy-only fields
 * below are added.
 *
 * Key differences from the other MT940 dialects:
 *   - subfields are marked `<XX` at the start of a continuation line (PKO/Alior use
 *     `<XX` inline, ING uses `~XX`), and the `:86:` tag line itself is empty
 *   - :61: carries no transaction-type code and no reference:
 *     `2607010701C653,00` — value date, entry date, D/C, amount, and nothing else
 *   - `<20`..`<26` description, `<32`+`<33` counterparty, `<27`+`<28` statement
 *     owner, all cut into fixed-width chunks with trailing blanks stripped
 *   - a trailing statement-level `:86:NAME ACCOUNT OWNER:…` after :62F:
 *   - Encoding: Windows-1250
 */

import { INGTransaction } from '../ing/types';
import { Kontrahent, Adres } from '../../shared/types';

/**
 * One booked operation. Subfield → field mapping:
 *   `<00` → details.transactionCode (bank reference: booking date + ref + D/C flag)
 *   `<10` → ordinal
 *   `<20`..`<26` → details.description
 *   `<27`+`<28` → accountOwnerName (our own side — deliberately kept out of
 *                 details, so it never reaches address/contractor matching)
 *   `<30` → details.bankCode
 *   `<31` → details.counterpartyAccount / accountNumber / counterpartyIBAN
 *   `<32`+`<33` → details.counterpartyName (name and address, as one string)
 *   `<38` → beneficiary account; only used as the IBAN fallback when `<31` is empty
 */
export interface PocztowyTransaction extends INGTransaction {
  /** `<10` — the operation's ordinal number inside the statement (1, 2, 3, …). */
  ordinal: string;
  /**
   * `<27`+`<28` — the statement owner's own name as it was printed on the transfer
   * (the community, or whoever the payer addressed the transfer to). Every row has
   * it and it always names the community's own street, so feeding it to the address
   * matcher would only invent apartment numbers; it is shown in the preview only.
   */
  accountOwnerName: string;
}

/**
 * A parsed Pocztowy MT940 statement.
 */
export interface PocztowyStatement {
  /** :20: — statement reference */
  reference: string;
  /** :25: — the owner ("our") account, 26 digits */
  accountIBAN: string;
  /** :28C: — statement number, e.g. "07M/2026" */
  statementNumber: string;
  /** :60F: — opening balance */
  openingBalance: {
    debitCredit: 'D' | 'C';
    date: string; // YYMMDD
    amount: number;
  };
  /** :62F: — closing balance */
  closingBalance: {
    debitCredit: 'D' | 'C';
    date: string; // YYMMDD
    amount: number;
  };
  /** :64: — available balance, when the bank sends one */
  availableBalance?: {
    debitCredit: 'D' | 'C';
    date: string; // YYMMDD
    amount: number;
  };
  /** Trailing `:86:NAME ACCOUNT OWNER:…`, empty when absent */
  accountOwner: string;
  transactions: PocztowyTransaction[];
}

/**
 * Converter configuration (same shape as every other converter's).
 */
export interface ConverterConfig {
  aiProvider: 'anthropic' | 'openai' | 'ollama' | 'none';
  apiKey?: string;
  model?: string;
  useBatchProcessing: boolean;
  batchSize: number;
  confidenceThresholds: {
    autoApprove: number;
    needsReview: number;
  };
  useCache: boolean;
  useRegexFirst: boolean;
  skipNegativeAmounts: boolean;
  skipBankFees: boolean;
  useAIForExpenses: boolean;
  contractors?: Kontrahent[];
  addresses?: Adres[];
  language?: 'pl' | 'en';
  cachePath?: string;
  aiConcurrency?: number;
}
