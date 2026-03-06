/**
 * Alior Bank MT940 Converter - Type Definitions
 * Format: MT940 (SWIFT) with `<XX` subfield delimiters in :86:
 */

import { MatchedContractor } from '../../shared/contractor-matcher';
import { Kontrahent, Adres } from '../../shared/types';

/**
 * Alior MT940 Transaction (parsed from :61: and :86: fields)
 *
 * Key differences from PKO MT940:
 *   - :86: subfield delimiter is `<` instead of `~`
 *   - :61: field contains optional funds code after D/C indicator
 *   - Counterparty: <27>+<28> = name, <29> = address, <32> = short name
 *   - Bank fees: transaction type `NCHG` / code `8090`
 *   - ASCII encoding (no Polish diacritics)
 */
export interface AliorTransaction {
  // From :61: field
  valueDate: string;          // YYMMDD format (e.g., "260202")
  entryDate: string;          // MMDD format (e.g., "0202")
  debitCredit: 'D' | 'C';    // D = debit (expense), C = credit (income)
  amount: number;             // Transaction amount (always positive)
  transactionType: string;    // e.g., "NTRF", "NCHG"
  reference: string;          // Reference number after NONREF// (e.g., "17929")

  // From :86: field - structured information
  details: {
    transactionCode: string;   // <00 field (e.g., "p. przychodzacy krajowy/wewnetrzny")
    description: string[];     // <20-<25 fields combined
    counterpartyName: string;  // <27 + <28 fields combined
    counterpartyAddress: string; // <29 field
    counterpartyShortName: string; // <32 field
    bankCode: string;          // <30 field
    accountNumber: string;     // <31 field
    counterpartyIBAN: string;  // <38 field
    city: string;              // <60 field (if present)
    additionalInfo: string;    // <63 field (if present)
  };

  // Raw data for debugging
  raw: {
    field61: string;  // Raw :61: field
    field86: string;  // Raw :86: field
  };
}

/**
 * Alior MT940 Statement
 */
export interface AliorStatement {
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
  transactions: AliorTransaction[];
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
  original: AliorTransaction;
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
