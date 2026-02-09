// Shared types for the application

export interface Bank {
  id: number;
  name: string;
  converterId: string;
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
  
  // Converters
  GET_CONVERTERS: 'converters:get-all',
  
  // File operations
  SELECT_FILES: 'files:select',
  SELECT_OUTPUT_FOLDER: 'files:select-output-folder',
  CONVERT_FILE: 'files:convert',
  CONVERT_FILE_WITH_AI: 'files:convert-with-ai',
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
