/**
 * ING Bank MT940 Converter - Type Definitions
 * Format: MT940 (SWIFT) with `~XX` subfield delimiters in :86:
 *
 * Key differences from PKO MT940:
 *   - :86: appears TWICE per transaction: first is just the code, second has ~XX details
 *   - :61: uses `S` prefix before 3-digit transaction type (e.g., S082, S020, S034)
 *   - Additional ~62 field with continuation of counterparty address/name
 *   - Last "transaction" may be balance info (S940NONREF) — should be filtered
 *   - ~34 field contains transaction code (same as leading code in :86:)
 */

import { MatchedContractor } from '../../shared/contractor-matcher';
import { Kontrahent, Adres } from '../../shared/types';

/**
 * ING MT940 Transaction (parsed from :61: and :86: fields)
 */
export interface INGTransaction {
  // From :61: field
  valueDate: string;          // YYMMDD format (e.g., "260131")
  entryDate: string;          // MMDD format (e.g., "0131")
  debitCredit: 'D' | 'C';    // D = debit (expense), C = credit (income)
  amount: number;             // Transaction amount (always positive)
  transactionType: string;    // 3-digit code after S prefix (e.g., "082", "020", "034")
  reference: string;          // Reference number after the transaction type

  // From :86: field - structured information (~XX subfields)
  details: {
    transactionCode: string;   // ~00 field (e.g., "TS41PRZELEW", "JOCGPRZELEW")
    description: string[];     // ~20-~25 fields combined
    counterpartyAccount: string; // ~29 field (raw counterparty account)
    bankCode: string;          // ~30 field
    accountNumber: string;     // ~31 field
    counterpartyName: string;  // ~32 + ~33 fields combined
    transactionCodeField: string; // ~34 field (transaction code)
    counterpartyIBAN: string;  // ~38 field (PL-prefixed IBAN)
    additionalInfo: string;    // ~62 field (continuation of name/address)
    additionalInfo2: string;   // ~63 field
  };

  // Raw data for debugging
  raw: {
    field61: string;  // Raw :61: field
    field86: string;  // Raw :86: field (the detailed one)
  };
}

/**
 * ING MT940 Statement
 */
export interface INGStatement {
  reference: string;           // :20: field
  accountIBAN: string;         // :25: field
  statementNumber: string;     // :28C: field
  openingBalance: {
    debitCredit: 'D' | 'C';
    date: string;              // YYMMDD format
    amount: number;
  };
  closingBalance: {
    debitCredit: 'D' | 'C';
    date: string;              // YYMMDD format
    amount: number;
  };
  availableBalance?: {
    debitCredit: 'D' | 'C';
    date: string;              // YYMMDD format
    amount: number;
  };
  transactions: INGTransaction[];
}

/**
 * Extracted data from transaction description
 */
export interface ExtractedData {
  // Address info
  streetName: string | null;
  buildingNumber: string | null;
  apartmentNumber: string | null;
  fullAddress: string | null;

  // Tenant info
  tenantName: string | null;

  // Confidence scores (0-100)
  confidence: {
    address: number;
    apartment: number;
    tenantName: number;
    overall: number;
  };

  // Metadata
  extractionMethod: 'regex' | 'ai' | 'hybrid' | 'cache' | 'manual';
  reasoning?: string;
  warnings: string[];

  // Raw data for review
  rawData: {
    description: string;
    counterpartyName: string;
    counterpartyIBAN: string;
  };
}

/**
 * Processed transaction with extraction/matching results
 */
export interface ProcessedTransaction {
  original: INGTransaction;
  extracted: ExtractedData;
  matchedContractor?: MatchedContractor;
  transactionType: 'income' | 'expense';
  status: 'auto-approved' | 'needs-review' | 'needs-manual-input' | 'skipped';
  corrected?: {
    fullAddress: string;
    tenantName: string;
    correctedBy: 'user';
    correctedAt: Date;
  };
  reviewedByUser?: {
    action: 'accept' | 'reject' | 'manual';
    originalValue?: string | null;
    manualValue?: string;
    extractedFrom?: string;
  };
}

/**
 * Import result
 */
export interface ImportResult {
  totalTransactions: number;
  processed: ProcessedTransaction[];

  summary: {
    autoApproved: number;
    needsReview: number;
    needsManualInput: number;
    skipped: number;
  };

  statistics: {
    averageConfidence: number;
    extractionMethods: {
      regex: number;
      ai: number;
      cache: number;
      manual: number;
    };
  };

  errors: string[];
}

/**
 * Converter configuration
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
}
