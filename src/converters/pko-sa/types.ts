/**
 * PKO SA EXP Converter - Type Definitions
 * Format: Text file with #DATA#, #SALDO#, and #OPERACJA# tags
 */

import { MatchedContractor } from '../../shared/contractor-matcher';
import { Kontrahent, Adres } from '../../shared/types';

/**
 * PKO SA EXP Transaction (parsed from #OPERACJA# line)
 *
 * Format details:
 *   - Text format with tags: #DATA#, #SALDO#, #OPERACJA#
 *   - Encoding: Windows-1250
 *   - Fields enclosed in double quotes, separated by spaces
 *   - Line format: #OPERACJA# "amount" "description" "counterparty" "currency" "date" "account" "code"
 *   - Date format: DD/MM/YYYY
 *   - Positive amounts = income (credit)
 *   - Negative amounts = expense (debit)
 */
export interface PKOSATransaction {
  // Core transaction data
  amount: number;                 // Transaction amount in PLN (positive or negative)
  amountAbsolute: number;        // Absolute value of amount
  isIncome: boolean;             // true if amount > 0
  
  // Transaction details
  description: string;            // Transaction description
  counterparty: string;           // Counterparty name and address
  currency: string;               // Currency (usually "PLN")
  date: string;                   // Date in DD/MM/YYYY format
  dateFormatted: string;          // Date in YYYY-MM-DD format
  accountNumber: string;          // Account number (may be empty)
  code: string;                   // Transaction code (e.g., "2400", "6310", "7750")
  
  // Raw data for debugging
  raw: {
    line: string;                 // Original line from file
    fields: string[];             // Parsed fields
  };
}

/**
 * PKO SA Statement
 */
export interface PKOSAStatement {
  // Statement metadata
  startDate: string;              // Start date from #DATA# (DD/MM/YYYY)
  endDate: string;                // End date from #DATA# (DD/MM/YYYY)
  
  // Account information
  accountNumber?: string;         // Account number from #SALDO#
  openingBalance?: number;        // Opening balance from #SALDO#
  closingBalance?: number;        // Closing balance from #SALDO#
  currency?: string;              // Currency from #SALDO#
  
  // Transactions
  transactions: PKOSATransaction[];
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
    counterparty: string;
    accountNumber: string;
  };
}

/**
 * Processed transaction with extraction results
 */
export interface ProcessedTransaction {
  original: PKOSATransaction;
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
  errors: any[];
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
  useAIForExpenses?: boolean;
  contractors?: Kontrahent[];
  addresses?: Adres[];
  language?: 'pl' | 'en';
}
