// Type definitions for Electron API exposed via preload

import { Bank, Converter, AppSettings, ConversionHistory, ConversionSummary, Kontrahent } from '../shared/types';

interface ConversionResult {
  success: boolean;
  outputPath?: string;
  duplicateWarning?: boolean;
  error?: string;
}

interface ElectronAPI {
  // Banks
  getBanks: () => Promise<Bank[]>;
  addBank: (name: string, converterId: string) => Promise<Bank>;
  updateBank: (id: number, name: string, converterId: string) => Promise<boolean>;
  deleteBank: (id: number) => Promise<boolean>;

  // Kontrahenci
  getKontrahenci: () => Promise<Kontrahent[]>;
  addKontrahent: (nazwa: string, kontoKontrahenta: string) => Promise<Kontrahent>;
  updateKontrahent: (id: number, nazwa: string, kontoKontrahenta: string) => Promise<boolean>;
  deleteKontrahent: (id: number) => Promise<boolean>;
  deleteAllKontrahenci: () => Promise<boolean>;
  importKontrahenciFromFile: () => Promise<{ success: boolean; count?: number; error?: string }>;

  // Converters
  getConverters: () => Promise<Converter[]>;

  // Files
  selectFiles: () => Promise<{ fileName: string; filePath: string }[]>;
  selectOutputFolder: () => Promise<string | null>;
  convertFile: (inputPath: string, bankId: number, fileName: string) => Promise<ConversionResult>;
  analyzeFile: (inputPath: string, bankId: number) => Promise<ConversionSummary>;
  convertFileWithAI: (inputPath: string, bankId: number, fileName: string) => Promise<ConversionResult>;
  openFile: (filePath: string) => Promise<boolean>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setOutputFolder: (folderPath: string) => Promise<boolean>;
  setDarkMode: (enabled: boolean) => Promise<boolean>;
  setLanguage: (language: string) => Promise<boolean>;
  exportSettings: () => Promise<{ success: boolean; filePath?: string }>;
  importSettings: () => Promise<{ success: boolean; error?: string }>;

  // History
  getHistory: () => Promise<ConversionHistory[]>;
  clearHistory: () => Promise<boolean>;
  
  // App info
  getAppVersion: () => Promise<string>;

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
