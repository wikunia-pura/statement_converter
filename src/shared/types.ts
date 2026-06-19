// Shared types for the application

export interface Bank {
  id: number;
  name: string;
  converterId: string;
  /** Substrings (typically account-number prefixes) used by the "Homebanking" module to identify which bank a deposit file belongs to. Matched as "contains" against file content. */
  accountPrefixes?: string[];
  createdAt: string;
}

export type KontrahentTyp = 'Kontrahent' | 'Pozostałe przychody' | 'Pozostałe koszty';

export interface Kontrahent {
  id: number;
  nazwa: string;
  kontoKontrahenta: string;
  nip?: string;
  typ: KontrahentTyp;
  alternativeNames?: string[];
  createdAt: string;
}

/**
 * A user-defined rule that maps a "weird" recurring payment to an apartment
 * number under a specific address. Used for payers whose transfers the matcher
 * can't otherwise resolve (e.g. a tenant paying from a foreign account with a
 * different description every month). The `matchText` is compared as a
 * case-insensitive, Polish-diacritic-normalized substring against the combined
 * transaction text (counterparty name + description + counterparty address).
 */
export interface ApartmentMapping {
  /** Local identifier for React keys and edit/delete in the UI. */
  id: string;
  /** Phrase to look for in the transaction text (substring, normalized). */
  matchText: string;
  apartmentNumber: string;
  /** Optional human-readable note. */
  note?: string;
}

export interface Adres {
  id: number;
  nazwa: string;

  alternativeNames?: string[];
  /** Substring identifiers used by the "Scalanie wpłat" module — any one of these appearing anywhere in a file's content marks the file as belonging to this address. */
  swrkIdentifiers?: string[];
  /** Community bank account numbers used by the Converter to auto-pick the address when a statement file is uploaded. Stored as the canonical 26-digit form (no PL prefix, no spaces). Globally unique across all addresses — enforced at the DB layer in addAdres/updateAdres. */
  accountNumbers?: string[];
  /** Optional link to a Bank. When set, the converter only shows this address for files whose bank matches; null/undefined ⇒ address is available for all banks. */
  bankId?: number | null;
  /** User-defined rules mapping recurring "weird" payments to apartment numbers. */
  apartmentMappings?: ApartmentMapping[];
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
  pdfPath?: string;  // Optional PDF bank statement for cross-reference
  status: 'pending' | 'processing' | 'success' | 'error' | 'needs-ai';
  errorMessage?: string;
  outputPath?: string;  // Base output path (without -podglad or -accounting suffix)
  conversionSummary?: ConversionSummary;
  /** True when adresId was set automatically by matching detectedAccounts against the address book — used by the UI to show a "auto" hint. */
  adresAutoMatched?: boolean;
  /** Community account number(s) extracted from the statement file at upload time. Used to power the "no match → add address with this account" affordance when adresId stays null. */
  detectedAccounts?: string[];
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
    /** True when the apartment number came from a user-defined ApartmentMapping rule. */
    matchedByManualMapping?: boolean;
  };
  // For expenses
  matchedContractor?: {
    contractorName: string | null;
    contractorAccount: string | null;
    confidence: number;
    manuallySelectedId?: number; // ID of contractor manually selected by user
  };
}

/**
 * Special "do wyjaśnienia" (clarification) account. Records assigned here are
 * actually booked to this account in both the preview and accounting files,
 * instead of being left unrecognized.
 */
export const CLARIFICATION_ACCOUNT = '235-1';

export interface ReviewDecision {
  index: number; // Matches TransactionForReview.index
  action: 'accept' | 'reject' | 'manual' | 'clarify';
  manualApartmentNumber?: string; // Used when action is 'manual' for income
  manualContractorId?: number; // Used when action is 'manual' for expense
  manualRemainingIncomeId?: number; // Used when action is 'manual' for income - "Pozostałe przychody" entry
  manualRemainingCostId?: number; // Used when action is 'manual' for expense - "Pozostałe koszty" entry
}

export interface ConversionReviewData {
  needsReview: true;
  tempConversionId: string;
  fileName: string;
  bankName: string;
  adresId: number | null;
  adresName: string | null;
  transactions: TransactionForReview[];
  pdfLines?: string[];  // Extracted PDF text lines for cross-reference
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
  impexFolder: string;
  /** Default destination folder for "Scalanie wpłat" merged outputs. Empty string ⇒ ask the user during merge. */
  swrkFolder: string;
  darkMode: boolean;
  language: 'pl' | 'en';
  aiConfidenceThreshold: number; // Minimum confidence to skip AI warning (default: 95)
  skipUserApproval: boolean; // Skip transaction review and generate files directly
}

// IPC Channel names
export const IPC_CHANNELS = {
  // Database operations
  GET_BANKS: 'db:get-banks',
  ADD_BANK: 'db:add-bank',
  UPDATE_BANK: 'db:update-bank',
  DELETE_BANK: 'db:delete-bank',
  DELETE_ALL_BANKS: 'db:delete-all-banks',
  IMPORT_BANKS_FROM_FILE: 'db:import-banks-from-file',
  EXPORT_BANKS_TO_FILE: 'db:export-banks-to-file',
  
  // Kontrahenci operations
  GET_KONTRAHENCI: 'db:get-kontrahenci',
  ADD_KONTRAHENT: 'db:add-kontrahent',
  UPDATE_KONTRAHENT: 'db:update-kontrahent',
  DELETE_KONTRAHENT: 'db:delete-kontrahent',
  DELETE_ALL_KONTRAHENCI: 'db:delete-all-kontrahenci',
  IMPORT_KONTRAHENCI_FROM_FILE: 'db:import-kontrahenci-from-file',
  IMPORT_KONTRAHENCI_FROM_DOM: 'db:import-kontrahenci-from-dom',
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
  SELECT_PDF: 'files:select-pdf',
  EXTRACT_PDF_TEXT: 'files:extract-pdf-text',
  SELECT_OUTPUT_FOLDER: 'files:select-output-folder',
  CONVERT_FILE: 'files:convert',
  CONVERT_FILE_WITH_AI: 'files:convert-with-ai',
  FINALIZE_CONVERSION: 'files:finalize-conversion',
  CONVERT_ALL: 'files:convert-all',
  OPEN_FILE: 'files:open',
  DETECT_ACCOUNT_NUMBERS: 'files:detect-account-numbers',
  
  // Settings
  GET_SETTINGS: 'settings:get',
  SET_OUTPUT_FOLDER: 'settings:set-output-folder',
  SET_IMPEX_FOLDER: 'settings:set-impex-folder',
  SET_SWRK_FOLDER: 'settings:set-swrk-folder',
  SET_DARK_MODE: 'settings:set-dark-mode',
  SET_LANGUAGE: 'settings:set-language',
  SET_SKIP_USER_APPROVAL: 'settings:set-skip-user-approval',
  EXPORT_SETTINGS: 'settings:export',
  IMPORT_SETTINGS: 'settings:import',
  
  // History
  GET_HISTORY: 'history:get-all',
  CLEAR_HISTORY: 'history:clear',

  // Zaliczki (housing-community monthly fee summary)
  ZALICZKI_SELECT_PDFS: 'zaliczki:select-pdfs',
  ZALICZKI_EXTRACT_PDF: 'zaliczki:extract-pdf',
  ZALICZKI_GENERATE_XLSX: 'zaliczki:generate-xlsx',
  ZALICZKI_GET_MODELS: 'zaliczki:get-models',

  // Noty Świadczenia (correction notices for housing community settlements)
  NOTY_SELECT_PDFS: 'noty:select-pdfs',
  NOTY_SELECT_OUTPUT_DIR: 'noty:select-output-dir',
  NOTY_CONVERT: 'noty:convert',

  // Scalanie wpłat (merge daily-deposit files per community)
  SCALANIE_SELECT_FILES: 'scalanie:select-files',
  SCALANIE_ANALYZE_FILE: 'scalanie:analyze-file',
  SCALANIE_SELECT_OUTPUT_DIR: 'scalanie:select-output-dir',
  SCALANIE_MERGE: 'scalanie:merge',

  // Homebanking (merge multi-day, multi-bank homebanking files per bank)
  HOMEBANKING_SELECT_FILES: 'homebanking:select-files',
  HOMEBANKING_ANALYZE_FILE: 'homebanking:analyze-file',
  HOMEBANKING_SELECT_OUTPUT_DIR: 'homebanking:select-output-dir',
  HOMEBANKING_MERGE: 'homebanking:merge',

  // Auth (Supabase-backed)
  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',
  AUTH_GET_SESSION: 'auth:get-session',

  // One-time local→cloud migration
  MIGRATION_GET_STATUS: 'migration:get-status',
  MIGRATION_RUN: 'migration:run',
} as const;
