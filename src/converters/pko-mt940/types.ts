/**
 * PKO BP MT940 Converter - Type Definitions
 */

import { MatchedContractor } from '../../shared/contractor-matcher';
import { Kontrahent, Adres } from '../../shared/types';

/**
 * MT940 Transaction (parsed from :61: and :86: fields)
 */
export interface MT940Transaction {
  // From :61: field
  valueDate: string;          // YYMMDD format (e.g., "260101")
  entryDate: string;          // MMDD format (e.g., "0101")
  debitCredit: 'D' | 'C';     // D = debit (expense), C = credit (income)
  amount: number;             // Transaction amount
  transactionType: string;    // e.g., "NU13", "NU12", "NG04", "N188"
  reference: string;          // Reference number (e.g., "5010594470002223")
  
  // From :86: field - structured information
  details: {
    transactionCode: string;   // ~00 field (e.g., "U13", "G04")
    description: string[];     // ~20-25 fields combined
    bankCode: string;          // ~30 field
    accountNumber: string;     // ~31 field
    counterpartyName: string;  // ~32-33 fields combined
    counterpartyIBAN: string;  // ~38 field
    transactionDate: string;   // ~60 field (if present)
    additionalInfo: string;    // ~63 field (if present)
  };
  
  // Raw data for debugging
  raw: {
    field61: string;  // Raw :61: field
    field86: string;  // Raw :86: field
  };
}

/**
 * MT940 Statement
 */
export interface MT940Statement {
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
  transactions: MT940Transaction[];
}

/**
 * Extracted data from transaction description
 */
export interface ExtractedData {
  // Address info
  streetName: string | null;           // "Aleja Lotników"
  buildingNumber: string | null;       // "20"
  apartmentNumber: string | null;      // "100"
  fullAddress: string | null;          // "Aleja Lotników 20/100"
  
  // Tenant info
  tenantName: string | null;           // "Ewa Szymczyk"
  
  // Confidence scores (0-100)
  confidence: {
    address: number;
    apartment: number;
    tenantName: number;
    overall: number;
  };
  
  // Metadata
  extractionMethod: 'regex' | 'ai' | 'hybrid' | 'cache' | 'manual';
  reasoning?: string;                  // AI explanation
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
  // Original transaction data
  original: MT940Transaction;
  
  // Extracted data (for positive amounts - income)
  extracted: ExtractedData;
  
  // Matched contractor (for negative amounts - expenses)
  matchedContractor?: MatchedContractor;
  
  // Transaction type
  transactionType: 'income' | 'expense';
  
  // Status for UI
  status: 'auto-approved' | 'needs-review' | 'needs-manual-input' | 'skipped';
  
  // User corrections (if any)
  corrected?: {
    fullAddress: string;
    tenantName: string;
    correctedBy: 'user';
    correctedAt: Date;
  };
  
  // User review decision (if reviewed)
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
    autoApproved: number;      // confidence >= 85%
    needsReview: number;       // 60% <= confidence < 85%
    needsManualInput: number;  // confidence < 60%
    skipped: number;           // bank fees, etc.
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
  aiProvider: 'anthropic' | 'openai' | 'none';
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
  contractors?: Kontrahent[];
  addresses?: Adres[];
  
  // Application language for AI reasoning output
  language?: 'pl' | 'en';
}
