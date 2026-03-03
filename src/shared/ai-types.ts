/**
 * Shared AI types - converter-independent interfaces for AI extraction and contractor matching
 */

import { Kontrahent, Adres } from './types';

/**
 * Generic transaction format for AI processing.
 * Each converter maps its bank-specific transaction to this format before passing to AIExtractor.
 */
export interface AITransaction {
  descBase: string;     // Main description (e.g., Santander desc-base, PKO description fields joined)
  descOpt: string;      // Secondary description (e.g., Santander desc-opt, PKO counterparty name)
  exeDate: string;      // Execution date
  value: number;        // Transaction amount
  // Optional fields - only used for preview/pass-through, not by AI logic
  trnCode?: string;
  creatDate?: string;
  accValue?: number;
  realValue?: number;
}

/**
 * AI extraction result - converter-independent
 */
export interface AIExtractedData {
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
  
  // Raw data that was sent to AI
  rawData: {
    descBase: string;
    descOpt: string;
  };
}

/**
 * AI extraction API request format
 */
export interface AIExtractionRequest {
  transactions: Array<{
    index: number;
    descBase: string;
    descOpt: string;
    value: number;
    date: string;
  }>;
}

/**
 * AI extraction API response format
 */
export interface AIExtractionResponse {
  results: Array<{
    index: number;
    streetName: string | null;
    buildingNumber: string | null;
    apartmentNumber: string | null;
    fullAddress: string | null;
    tenantName: string | null;
    confidence: {
      address: number;
      apartment: number;
      tenantName: number;
    };
    reasoning: string;
  }>;
}

/**
 * Cache entry for extraction results
 */
export interface CacheEntry {
  key: string;
  extracted: AIExtractedData;
  timestamp: Date;
  usageCount: number;
}

/**
 * Matched contractor result
 */
export interface MatchedContractor {
  contractor: Kontrahent | null;
  confidence: number;
  matchedIn: 'desc-opt' | 'desc-base' | 'none' | 'manual';
  matchedText?: string;
  reasoning?: string; // AI reasoning for why this contractor was matched
}

/**
 * Shared AI configuration - converter-independent settings needed by AI modules
 */
export interface AIConfig {
  // AI provider settings
  aiProvider: 'openai' | 'anthropic' | 'ollama' | 'none';
  apiKey?: string;
  model?: string;
  
  // Processing settings
  useBatchProcessing?: boolean;
  batchSize?: number;
  
  // Thresholds
  confidenceThresholds: {
    autoApprove: number;
    needsReview: number;
  };
  
  // Data for AI context
  contractors?: Kontrahent[];
  addresses?: Adres[];
  
  // Application language for AI reasoning output
  language?: 'pl' | 'en';
}
