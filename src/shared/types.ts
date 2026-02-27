// Shared types for the application

export interface Bank {
  id: number;
  name: string;
  converterId: string;
  createdAt: string;
}

export interface Kontrahent {
  id: number;
  nazwa: string;
  kontoKontrahenta: string;
  nip?: string;
  alternativeNames?: string[];
  createdAt: string;
}

export interface Adres {
  id: number;
  nazwa: string;

  alternativeNames?: string[];
  createdAt: string;
}

export interface Converter {
  id: string;
  name: string;
  description: string;
}

export interface FileEntry {
  id: string;
  fileName: string;
  filePath: string;
  bankId: number | null;
  bankName: string | null;
  adresId: number | null;
  status: 'pending' | 'processing' | 'success' | 'error' | 'needs-ai';
  errorMessage?: string;
  conversionSummary?: ConversionSummary;
}

export interface ConversionSummary {
  totalTransactions: number;
  lowConfidenceCount: number;
  averageConfidence: number;
  needsAI: boolean;
}

// Transaction review types
export interface TransactionForReview {
  index: number; // Index in original transaction list
  transactionType: 'income' | 'expense';
  // Original data
  original: {
    date: string;
    amount: number;
    description: string;
    counterparty: string;
  };
  // AI/Regex extracted data
  extracted: {
    apartmentNumber: string | null;
    fullAddress: string | null;
    streetName: string | null;
    buildingNumber: string | null;
    tenantName: string | null;
    confidence: number;
    reasoning?: string;
  };
  // For expenses
  matchedContractor?: {
    contractorName: string | null;
    contractorAccount: string | null;
    confidence: number;
  };
}

export interface ReviewDecision {
  index: number; // Matches TransactionForReview.index
  action: 'accept' | 'reject' | 'manual';
  manualApartmentNumber?: string; // Used when action is 'manual'
}

export interface ConversionReviewData {
  needsReview: true;
  tempConversionId: string;
  fileName: string;
  bankName: string;
  adresId: number | null;
  adresName: string | null;
  transactions: TransactionForReview[];
}

export interface ConversionHistory {
  id: number;
  fileName: string;
  bankName: string;
  converterName: string;
  status: 'success' | 'error';
  errorMessage?: string;
  inputPath: string;
  outputPath: string;
  convertedAt: string;
}

export interface AppSettings {
  outputFolder: string;
  darkMode: boolean;
  language: 'pl' | 'en';
  aiConfidenceThreshold: number; // Minimum confidence to skip AI warning (default: 95)
}

// IPC Channel names
export const IPC_CHANNELS = {
  // Database operations
  GET_BANKS: 'db:get-banks',
  ADD_BANK: 'db:add-bank',
  UPDATE_BANK: 'db:update-bank',
  DELETE_BANK: 'db:delete-bank',
  
  // Kontrahenci operations
  GET_KONTRAHENCI: 'db:get-kontrahenci',
  ADD_KONTRAHENT: 'db:add-kontrahent',
  UPDATE_KONTRAHENT: 'db:update-kontrahent',
  DELETE_KONTRAHENT: 'db:delete-kontrahent',
  DELETE_ALL_KONTRAHENCI: 'db:delete-all-kontrahenci',
  IMPORT_KONTRAHENCI_FROM_FILE: 'db:import-kontrahenci-from-file',
  EXPORT_KONTRAHENCI_TO_FILE: 'db:export-kontrahenci-to-file',
  
  // Adresy operations
  GET_ADRESY: 'db:get-adresy',
  ADD_ADRES: 'db:add-adres',
  UPDATE_ADRES: 'db:update-adres',
  DELETE_ADRES: 'db:delete-adres',
  DELETE_ALL_ADRESY: 'db:delete-all-adresy',
  IMPORT_ADRESY_FROM_FILE: 'db:import-adresy-from-file',
  EXPORT_ADRESY_TO_FILE: 'db:export-adresy-to-file',
  
  // Converters
  GET_CONVERTERS: 'converters:get-all',
  
  // File operations
  SELECT_FILES: 'files:select',
  SELECT_OUTPUT_FOLDER: 'files:select-output-folder',
  CONVERT_FILE: 'files:convert',
  CONVERT_FILE_WITH_AI: 'files:convert-with-ai',
  FINALIZE_CONVERSION: 'files:finalize-conversion',
  CONVERT_ALL: 'files:convert-all',
  OPEN_FILE: 'files:open',
  
  // Settings
  GET_SETTINGS: 'settings:get',
  SET_OUTPUT_FOLDER: 'settings:set-output-folder',
  SET_DARK_MODE: 'settings:set-dark-mode',
  SET_LANGUAGE: 'settings:set-language',
  EXPORT_SETTINGS: 'settings:export',
  IMPORT_SETTINGS: 'settings:import',
  
  // History
  GET_HISTORY: 'history:get-all',
  CLEAR_HISTORY: 'history:clear',
} as const;
