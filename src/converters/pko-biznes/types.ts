/**
 * PKO Biznes ELIXIR Converter - Type Definitions
 * Format: CSV files in ZIP archive (one statement = multiple CSV files)
 */

import { MatchedContractor } from '../../shared/contractor-matcher';
import { Kontrahent, Adres } from '../../shared/types';

/**
 * PKO Biznes ELIXIR Transaction (parsed from CSV file)
 *
 * Format details:
 *   - CSV with comma separators
 *   - Encoding: Windows-1250
 *   - Multiple files in ZIP treated as single statement
 *   - Pipe character (|) used as line separator in multi-line fields
 *   - Fields structure:
 *     1. Operation type: 111 (credit/income), 222 (debit/expense)
 *     2. Date: YYYYMMDD
 *     3. Amount: in groszy (cents)
 *     4-5. Various codes (code1, code2)
 *     6. Counterparty IBAN
 *     7. Own account number
 *     8. Counterparty name (with | as line separator)
 *     9. Additional counterparty info
 *     10. General code
 *     11. Bank code
 *     12. Description/title (with | as line separator)
 *     13. Empty field
 *     14. Reference number
 *     15-16. Empty fields
 */
export interface PKOBiznesTransaction {
  // Core transaction data
  operationType: '111' | '222';  // 111 = credit (income), 222 = debit (expense)
  date: string;                   // YYYYMMDD format (e.g., "20260220")
  amount: number;                 // Transaction amount in PLN (converted from groszy)
  amountGroszy: number;          // Original amount in groszy
  
  // Account information
  ownAccountNumber: string;       // Own account number
  counterpartyIBAN: string;       // Counterparty IBAN (with PL prefix)
  
  // Counterparty information
  counterpartyName: string;       // Counterparty name (| replaced with space)
  counterpartyNameExtra: string;  // Additional counterparty info (if any)
  
  // Transaction details
  description: string;            // Transaction description/title (| replaced with space)
  referenceNumber: string;        // Reference number
  
  // Codes
  code1: string;                  // Code field 4
  code2: string;                  // Code field 5
  generalCode: string;            // General code field 10
  bankCode: string;               // Bank code field 11
  
  // Metadata
  sourceFile: string;             // Original filename from ZIP
  
  // Raw data for debugging
  raw: {
    line: string;                 // Original CSV line
    fields: string[];             // Parsed CSV fields
  };
}

/**
 * PKO Biznes Statement (from ZIP archive)
 */
export interface PKOBiznesStatement {
  // Statement metadata
  sourceZipFile: string;          // Original ZIP filename
  filesCount: number;             // Number of CSV files in ZIP
  
  // Account information (extracted from filenames and data)
  accountNumbers: string[];       // All account numbers found in files
  
  // Date range
  startDate: string;              // Earliest transaction date
  endDate: string;                // Latest transaction date
  
  // Transactions from all files
  transactions: PKOBiznesTransaction[];
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
    counterpartyNameExtra: string;
    counterpartyIBAN: string;
  };
}

/**
 * Processed transaction with extraction results
 */
export interface ProcessedTransaction {
  original: PKOBiznesTransaction;
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
