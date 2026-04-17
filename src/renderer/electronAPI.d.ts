// Type definitions for Electron API exposed via preload

import { Bank, Converter, AppSettings, ConversionHistory, ConversionSummary, Kontrahent, Adres, ConversionReviewData, ReviewDecision, KontrahentTyp } from '../shared/types';

// Zaliczki shared types (referenced by the main-process helpers)
export type ZaliczkiCategory =
  | 'zaliczka_utrzymanie' | 'co_zmienna' | 'co_stala'
  | 'ciepla_woda_licznik' | 'ciepla_woda_ryczalt'
  | 'zimna_woda_licznik' | 'zimna_woda_ryczalt'
  | 'scieki_licznik' | 'scieki_ryczalt'
  | 'razem_swiadczenia' | 'odpady_komunalne' | 'fundusz_remontowy'
  | 'razem_total';

export interface ZaliczkiPropertyData {
  property: string;
  values: Partial<Record<ZaliczkiCategory, number | null>>;
}

export interface ZaliczkiExtractionResult {
  filename: string;
  month: number | null;
  year: number | null;
  properties: ZaliczkiPropertyData[];
  rawResponse: string;
}

export interface ZaliczkiEditedFile {
  filename: string;
  month: number | null;
  year: number | null;
  properties: ZaliczkiPropertyData[];
}

export interface ZaliczkiModel {
  id: string;
  label: string;
}

interface ConversionResult {
  success?: boolean;
  outputPath?: string;
  duplicateWarning?: boolean;
  error?: string;
  warningMessage?: string;  // Info message (not an error, but user should know)
  // Review flow
  needsReview?: boolean;
  reviewData?: ConversionReviewData;
}

interface ElectronAPI {
  // Banks
  getBanks: () => Promise<Bank[]>;
  addBank: (name: string, converterId: string) => Promise<Bank>;
  updateBank: (id: number, name: string, converterId: string) => Promise<boolean>;
  deleteBank: (id: number) => Promise<boolean>;

  // Kontrahenci
  getKontrahenci: () => Promise<Kontrahent[]>;
  addKontrahent: (nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typ?: KontrahentTyp) => Promise<Kontrahent>;
  updateKontrahent: (id: number, nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typ?: KontrahentTyp) => Promise<boolean>;
  deleteKontrahent: (id: number) => Promise<boolean>;
  deleteAllKontrahenci: () => Promise<boolean>;
  importKontrahenciFromFile: () => Promise<{ success: boolean; added?: number; updated?: number; error?: string }>;
  importKontrahenciFromDOM: () => Promise<{ success: boolean; added?: number; updated?: number; error?: string }>;
  exportKontrahenciToFile: () => Promise<{ success: boolean; count?: number; filePath?: string; error?: string }>;

  // Adresy
  getAdresy: () => Promise<Adres[]>;
  addAdres: (nazwa: string, alternativeNames?: string[]) => Promise<Adres>;
  updateAdres: (id: number, nazwa: string, alternativeNames?: string[]) => Promise<boolean>;
  deleteAdres: (id: number) => Promise<boolean>;
  deleteAllAdresy: () => Promise<boolean>;
  importAdresyFromFile: () => Promise<{ success: boolean; count?: number; error?: string }>;
  exportAdresyToFile: () => Promise<{ success: boolean; count?: number; filePath?: string; error?: string }>;

  // Converters
  getConverters: () => Promise<Converter[]>;

  // Files
  selectFiles: () => Promise<{ fileName: string; filePath: string }[]>;
  selectPdf: () => Promise<{ fileName: string; filePath: string } | null>;
  extractPdfText: (filePath: string) => Promise<{ text: string; lines: string[]; numPages: number } | null>;
  selectOutputFolder: () => Promise<string | null>;
  convertFile: (inputPath: string, bankId: number, fileName: string, adresId?: number | null) => Promise<ConversionResult>;
  analyzeFile: (inputPath: string, bankId: number, adresId?: number | null) => Promise<ConversionSummary>;
  convertFileWithAI: (inputPath: string, bankId: number, fileName: string, adresId?: number | null) => Promise<ConversionResult>;
  finalizeConversion: (tempConversionId: string, decisions: ReviewDecision[]) => Promise<ConversionResult>;
  openFile: (filePath: string) => Promise<boolean>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setOutputFolder: (folderPath: string) => Promise<boolean>;
  setDarkMode: (enabled: boolean) => Promise<boolean>;
  setLanguage: (language: string) => Promise<boolean>;
  setSkipUserApproval: (enabled: boolean) => Promise<boolean>;
  exportSettings: () => Promise<{ success: boolean; filePath?: string }>;
  importSettings: () => Promise<{ success: boolean; error?: string }>;

  // History
  getHistory: () => Promise<ConversionHistory[]>;
  clearHistory: () => Promise<boolean>;
  
  // Zaliczki
  zaliczkiGetModels: () => Promise<{ models: readonly ZaliczkiModel[]; default: string }>;
  zaliczkiSelectPdfs: () => Promise<{ fileName: string; filePath: string }[]>;
  zaliczkiExtractPdf: (filePath: string, model: string) =>
    Promise<{ data?: ZaliczkiExtractionResult; error?: string }>;
  zaliczkiGenerateXlsx: (files: ZaliczkiEditedFile[], year: number) =>
    Promise<{ success?: boolean; filePath?: string; canceled?: boolean; error?: string }>;

  // App info
  getAppVersion: () => Promise<string>;

  // Zoom controls
  zoomIn: () => Promise<boolean>;
  zoomOut: () => Promise<boolean>;
  zoomReset: () => Promise<boolean>;

  // Auto-updater
  checkForUpdates: () => Promise<{ available: boolean; info?: any; error?: string; message?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; downloadPath?: string; message?: string; error?: string }>;
  openDownloadsFolder: () => Promise<{ success: boolean }>;
  openLogsFolder: () => Promise<{ success: boolean; logPath?: string }>;
  getLogPath: () => Promise<{ path: string }>;
  onUpdateAvailable: (callback: (info: any) => void) => void;
  onUpdateDownloaded: (callback: (info: any) => void) => void;
  onUpdateError: (callback: (error: string) => void) => void;
  onDownloadProgress: (callback: (progress: any) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export { ElectronAPI, ConversionResult };
