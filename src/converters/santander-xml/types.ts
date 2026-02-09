/**
 * Santander XML Converter - Type Definitions
 */

export interface XmlTransaction {
  trnCode: string;
  exeDate: string;
  creatDate: string;
  value: number;
  accValue: number;
  realValue: number;
  descBase: string;
  descOpt: string;
}

export interface XmlStatement {
  bankName: string;
  iban: string;
  stmtNo: string;
  beginDate: string;
  endDate: string;
  beginValue: number;
  endValue: number;
  transactions: XmlTransaction[];
}

export interface ExtractedData {
  // Address info
  streetName: string | null;           // "Joliot-Curie"
  buildingNumber: string | null;       // "3"
  apartmentNumber: string | null;      // "27"
  fullAddress: string | null;          // "Joliot-Curie 3/27"
  
  // Tenant info
  tenantName: string | null;           // "Ewa Teresa Osiecka-Cisowska"
  
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
    descBase: string;
    descOpt: string;
  };
}

export interface ProcessedTransaction {
  // Original transaction data
  original: XmlTransaction;
  
  // Extracted data
  extracted: ExtractedData;
  
  // Status for UI
  status: 'auto-approved' | 'needs-review' | 'needs-manual-input' | 'skipped';
  
  // User corrections (if any)
  corrected?: {
    fullAddress: string;
    tenantName: string;
    correctedBy: 'user';
    correctedAt: Date;
  };
}

export interface ImportResult {
  totalTransactions: number;
  processed: ProcessedTransaction[];
  
  summary: {
    autoApproved: number;      // confidence >= 85%
    needsReview: number;       // 60% <= confidence < 85%
    needsManualInput: number;  // confidence < 60%
    skipped: number;           // negative amounts, bank fees, etc.
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
    transaction: XmlTransaction;
    error: string;
  }>;
}

export interface AIExtractionRequest {
  transactions: Array<{
    index: number;
    descBase: string;
    descOpt: string;
    value: number;
    date: string;
  }>;
}

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

export interface CacheEntry {
  key: string;
  extracted: ExtractedData;
  timestamp: Date;
  usageCount: number;
}

export interface ConverterConfig {
  // AI settings
  aiProvider: 'openai' | 'anthropic' | 'ollama' | 'none';
  apiKey?: string;
  model?: string;
  
  // Processing settings
  useBatchProcessing: boolean;
  batchSize: number;
  
  // Thresholds
  confidenceThresholds: {
    autoApprove: number;    // Default: 85
    needsReview: number;    // Default: 60
  };
  
  // Optimization
  useCache: boolean;
  useRegexFirst: boolean;
  skipNegativeAmounts: boolean;
  skipBankFees: boolean;
}
