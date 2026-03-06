/**
 * BNP Paribas XML Converter - Type Definitions
 * Format: ISO 20022 CAMT.053.001.02 (camt.053)
 */

import { MatchedContractor } from '../../shared/contractor-matcher';
import { Kontrahent, Adres } from '../../shared/types';

export interface BnpTransaction {
  /** Amount (always positive — use creditDebitIndicator for direction) */
  amount: number;
  /** Currency code (e.g., "PLN") */
  currency: string;
  /** CRDT = credit (income), DBIT = debit (expense) */
  creditDebitIndicator: 'CRDT' | 'DBIT';
  /** Booking status (e.g., "BOOK") */
  status: string;
  /** Booking date (YYYY-MM-DD) */
  bookingDate: string;
  /** Value date (YYYY-MM-DD) */
  valueDate: string;
  /** Bank transaction code (domain code, e.g., "723", "225", "244") */
  txCode: string;
  /** Instruction ID */
  instrId: string;
  /** End-to-end ID */
  endToEndId: string;
  /** Counterparty name (Dbtr for CRDT, Cdtr for DBIT) */
  counterpartyName: string;
  /** Counterparty address lines joined */
  counterpartyAddress: string;
  /** Counterparty country */
  counterpartyCountry: string;
  /** Counterparty account number */
  counterpartyAccount: string;
  /** Remittance information (description) */
  description: string;
}

export interface BnpStatement {
  /** Message ID */
  messageId: string;
  /** Statement creation date-time */
  creationDateTime: string;
  /** Statement ID (e.g., "02/2026/M") */
  statementId: string;
  /** Statement period start */
  periodStart: string;
  /** Statement period end */
  periodEnd: string;
  /** Account IBAN */
  iban: string;
  /** Account currency */
  currency: string;
  /** Account name */
  accountName: string;
  /** Account owner name */
  ownerName: string;
  /** Account owner address lines */
  ownerAddress: string[];
  /** Opening balance */
  openingBalance: number;
  /** Closing balance */
  closingBalance: number;
  /** All entries */
  transactions: BnpTransaction[];
}

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
    counterpartyAddress: string;
  };
}

export interface ProcessedTransaction {
  original: BnpTransaction;
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

  errors: Array<{
    transaction: BnpTransaction;
    error: string;
  }>;
}

export interface ConverterConfig {
  aiProvider: 'openai' | 'anthropic' | 'ollama' | 'none';
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
