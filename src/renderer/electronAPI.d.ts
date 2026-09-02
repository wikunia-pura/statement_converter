// Type definitions for Electron API exposed via preload

import { Bank, Converter, AppSettings, ConversionHistory, ConversionSummary, Kontrahent, Adres, ApartmentMapping, ConversionReviewData, ReviewDecision, TransactionForReview, KontrahentTyp, KontoTyp, BackupCounts, OdczytyHistoryEntry, OdczytySkippedRow, ZgnJednostka, MailingPole, MailingPoleTyp, MailingSzablon, MailingHistoryEntry, MailingSmtpConfig, MailingSmtpStatus, MailingSendResult, MailingProgressEvent, AppUser, SpotkanieTyp, Spotkanie, SpotkanieInput } from '../shared/types';

// Zaliczki shared types (referenced by the main-process helpers)
export type ZaliczkiCategory =
  | 'zaliczka_utrzymanie' | 'co_zmienna' | 'co_stala'
  | 'ciepla_woda_licznik' | 'ciepla_woda_ryczalt'
  | 'zw_kanalizacja_licznik' | 'zw_kanalizacja_ryczalt'
  | 'woda_gospodarcza'
  | 'razem_swiadczenia' | 'odpady_komunalne' | 'fundusz_remontowy'
  | 'razem_total';

export interface ZaliczkiPropertyData {
  property: string;
  values: Partial<Record<ZaliczkiCategory, number | null>>;
}

/** An arithmetic finding from checking a page against the totals printed on it. */
export interface ZaliczkiWarning {
  property: string;
  check:
    | 'swiadczenia_sum'
    | 'razem_total_sum'
    | 'components_missing'
    | 'empty_property'
    | 'page_failed';
  severity: 'error' | 'warning';
  message: string;
}

export interface ZaliczkiStats {
  pages: number;
  fromCache: number;
  escalated: number;
  failed: number;
  wholeFileFallback: boolean;
}

export interface ZaliczkiExtractionResult {
  filename: string;
  month: number | null;
  year: number | null;
  properties: ZaliczkiPropertyData[];
  rawResponse: string;
  warnings: ZaliczkiWarning[];
  stats: ZaliczkiStats;
}

export interface ZaliczkiProgress {
  filePath: string;
  totalPages: number;
  donePages: number;
  fromCache: number;
  stage: 'splitting' | 'extracting' | 'done';
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

export interface ScalanieAnalyzedFile {
  filePath: string;
  fileName: string;
  date: string | null;
  lineCount: number;
}

export interface ScalanieMergeFileInput {
  filePath: string;
  date: string | null;
}

export interface ScalanieMergeResult {
  outputPath: string;
  fileCount: number;
  startDate: string | null;
  endDate: string | null;
}

export interface HomebankingAddressHit {
  label: string;
  lineCount: number;
}

export interface HomebankingBankHit {
  bankId: number;
  bankName: string;
  lineCount: number;
}

export interface HomebankingAnalyzedFile {
  filePath: string;
  fileName: string;
  date: string | null;
  bankHits: HomebankingBankHit[];
  addressHits: HomebankingAddressHit[];
  lineCount: number;
}

export interface HomebankingMergeFileInput {
  filePath: string;
  bankIds: number[];
  date: string | null;
  splitByAddress: boolean;
}

export interface HomebankingMergeGroupResult {
  bankId: number;
  bankName: string;
  addressLabel: string | null;
  outputPath: string;
  fileCount: number;
  lineCount: number;
  startDate: string | null;
  endDate: string | null;
}

export type OdczytySupplierId = 'piaskan' | 'techem' | 'metrona' | 'ista';

/** Re-exported under the name the meter-readings views already use. */
export type OdczytySkipped = OdczytySkippedRow;
export type { OdczytyHistoryEntry } from '../shared/types';

export interface OdczytyAnalyzedFile {
  filePath: string;
  fileName: string;
  supplier: OdczytySupplierId;
  supplierLabel: string;
  /** Housing communities found in the file — one output file each. */
  communities: string[];
  latestDate: string | null;
  readingCount: number;
  /** Rows without a device number, reading value or date. */
  skippedCount: number;
  skipped: OdczytySkipped[];
}

export interface OdczytyOutputFile {
  wm: string;
  outputPath: string;
  fileName: string;
  date: string;
  readingCount: number;
}

export interface OdczytySourceSummary {
  fileName: string;
  filePath: string;
  supplierLabel: string | null;
  readingCount: number;
  skippedCount: number;
  skipped: OdczytySkipped[];
  error?: string;
}

export interface OdczytyConvertResult {
  outputDir: string;
  files: OdczytyOutputFile[];
  sources: OdczytySourceSummary[];
  readingCount: number;
  skippedCount: number;
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
  addBank: (name: string, converterId: string, accountPrefixes?: string[]) => Promise<Bank>;
  updateBank: (id: number, name: string, converterId: string, accountPrefixes?: string[]) => Promise<boolean>;
  deleteBank: (id: number) => Promise<boolean>;
  deleteAllBanks: () => Promise<boolean>;
  importBanksFromFile: () => Promise<{ success: boolean; count?: number; added?: number; updated?: number; error?: string }>;
  exportBanksToFile: () => Promise<{ success: boolean; count?: number; filePath?: string; error?: string }>;

  // Kontrahenci
  getKontrahenci: () => Promise<Kontrahent[]>;
  addKontrahent: (nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typy?: KontrahentTyp[]) => Promise<Kontrahent>;
  updateKontrahent: (id: number, nazwa: string, kontoKontrahenta: string, nip?: string, alternativeNames?: string[], typy?: KontrahentTyp[]) => Promise<boolean>;
  deleteKontrahent: (id: number) => Promise<boolean>;
  deleteAllKontrahenci: () => Promise<boolean>;
  importKontrahenciFromFile: () => Promise<{ success: boolean; added?: number; updated?: number; error?: string }>;
  importKontrahenciFromDOM: () => Promise<{ success: boolean; added?: number; updated?: number; error?: string }>;
  exportKontrahenciToFile: () => Promise<{ success: boolean; count?: number; filePath?: string; error?: string }>;

  // Adresy
  getAdresy: () => Promise<Adres[]>;
  addAdres: (
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
    accountNumbers?: string[],
    apartmentMappings?: ApartmentMapping[],
    accountTypes?: Record<string, number>,
    zgnJednostkaId?: number | null,
  ) => Promise<Adres>;
  updateAdres: (
    id: number,
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
    accountNumbers?: string[],
    apartmentMappings?: ApartmentMapping[],
    accountTypes?: Record<string, number>,
    zgnJednostkaId?: number | null,
  ) => Promise<boolean>;
  deleteAdres: (id: number) => Promise<boolean>;
  deleteAllAdresy: () => Promise<boolean>;
  importAdresyFromFile: () => Promise<{ success: boolean; count?: number; errors?: string[]; error?: string }>;
  exportAdresyToFile: () => Promise<{ success: boolean; count?: number; filePath?: string; error?: string }>;

  // Konto typy
  getKontoTypy: () => Promise<KontoTyp[]>;
  addKontoTyp: (name: string, bankAccountSymbol: string, apartmentPrefix: string, isDefault: boolean) => Promise<KontoTyp>;
  updateKontoTyp: (id: number, name: string, bankAccountSymbol: string, apartmentPrefix: string, isDefault: boolean) => Promise<boolean>;
  deleteKontoTyp: (id: number) => Promise<boolean>;
  importKontoTypyFromFile: () => Promise<{ success: boolean; added?: number; updated?: number; error?: string }>;
  exportKontoTypyToFile: () => Promise<{ success: boolean; count?: number; filePath?: string; error?: string }>;

  // Converters
  getConverters: () => Promise<Converter[]>;

  // Files
  selectFiles: () => Promise<{ fileName: string; filePath: string }[]>;
  selectPdf: () => Promise<{ fileName: string; filePath: string } | null>;
  extractPdfText: (filePath: string) => Promise<{ text: string; lines: string[]; numPages: number } | null>;
  selectOutputFolder: () => Promise<string | null>;
  convertFile: (inputPath: string, bankId: number, fileName: string, adresId?: number | null, accountTypeId?: number | null) => Promise<ConversionResult>;
  analyzeFile: (inputPath: string, bankId: number, adresId?: number | null) => Promise<ConversionSummary>;
  detectAccountNumbers: (inputPath: string, bankId?: number | null) => Promise<string[]>;
  convertFileWithAI: (inputPath: string, bankId: number, fileName: string, adresId?: number | null, accountTypeId?: number | null) => Promise<ConversionResult>;
  finalizeConversion: (tempConversionId: string, decisions: ReviewDecision[]) => Promise<ConversionResult>;
  rerunExpenseAI: (
    tempConversionId: string,
    indices: number[],
    fileName: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    updated?: TransactionForReview[];
    matchedCount?: number;
    processedCount?: number;
  }>;
  touchConversion: (tempConversionId: string) => Promise<boolean>;
  openFile: (filePath: string) => Promise<boolean>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setOutputFolder: (folderPath: string) => Promise<boolean>;
  setImpexFolder: (folderPath: string) => Promise<boolean>;
  setSwrkFolder: (folderPath: string) => Promise<boolean>;
  setDarkMode: (enabled: boolean) => Promise<boolean>;
  setLanguage: (language: string) => Promise<boolean>;
  setSkipUserApproval: (enabled: boolean) => Promise<boolean>;
  setAlwaysUseAI: (enabled: boolean) => Promise<boolean>;
  setContractorSortOrder: (sortOrder: string) => Promise<boolean>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<boolean>;
  setCalendarHoverCard: (enabled: boolean) => Promise<boolean>;
  setLastSeenVersion: (version: string) => Promise<boolean>;
  exportSettings: () => Promise<{ success: boolean; filePath?: string }>;
  importSettings: () => Promise<{ success: boolean; error?: string }>;

  // History
  getHistory: () => Promise<ConversionHistory[]>;
  clearHistory: () => Promise<boolean>;
  importHistoryFromFile: () => Promise<{ success: boolean; added?: number; skipped?: number; error?: string }>;
  exportHistoryToFile: () => Promise<{ success: boolean; count?: number; filePath?: string; error?: string }>;
  /** Tick / untick "posted in DOM" for the given history rows (Księgowania view). */
  setHistoryBookedInDom: (
    ids: number[],
    booked: boolean,
  ) => Promise<{ success: boolean; updated?: number; error?: string }>;

  // Backup
  backupExport: () => Promise<{ success: boolean; filePath?: string; counts?: BackupCounts; error?: string }>;
  backupRestore: () => Promise<{ success: boolean; counts?: BackupCounts; createdAt?: string; error?: string }>;
  backupGetStatus: () => Promise<{ folder: string; lastAutoBackup: string | null; autoBackupCount: number }>;
  backupOpenFolder: () => Promise<{ success: boolean }>;
  
  // Zaliczki
  zaliczkiGetModels: () => Promise<{ models: readonly ZaliczkiModel[]; default: string }>;
  zaliczkiSelectPdfs: () => Promise<{ fileName: string; filePath: string }[]>;
  /** `force` skips the per-page cache and re-asks the model. */
  zaliczkiExtractPdf: (filePath: string, model: string, force?: boolean) =>
    Promise<{ data?: ZaliczkiExtractionResult; error?: string }>;
  zaliczkiGenerateXlsx: (files: ZaliczkiEditedFile[], year: number) =>
    Promise<{ success?: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  zaliczkiCacheStats: () => Promise<{ entries: number; bytes: number }>;
  zaliczkiClearCache: () => Promise<{ removed: number }>;
  onZaliczkiProgress: (callback: (progress: ZaliczkiProgress) => void) => () => void;

  // Noty Świadczenia
  notySelectPdfs: () => Promise<{ fileName: string; filePath: string }[]>;
  notySelectOutputDir: () => Promise<string | null>;
  notyConvert: (filePath: string, outputDir: string | null) =>
    Promise<{ success?: boolean; filePath?: string; canceled?: boolean; error?: string }>;

  // Scalanie wpłat
  scalanieSelectFiles: () => Promise<{ fileName: string; filePath: string }[]>;
  scalanieAnalyzeFile: (filePath: string) => Promise<{
    data?: ScalanieAnalyzedFile;
    error?: string;
  }>;
  scalanieSelectOutputDir: () => Promise<string | null>;
  scalanieMerge: (files: ScalanieMergeFileInput[], outputDir: string) => Promise<{
    success?: boolean;
    result?: ScalanieMergeResult;
    error?: string;
  }>;

  // Homebanking
  homebankingSelectFiles: () => Promise<{ fileName: string; filePath: string }[]>;
  homebankingAnalyzeFile: (filePath: string) => Promise<{
    data?: HomebankingAnalyzedFile;
    error?: string;
  }>;
  homebankingSelectOutputDir: () => Promise<string | null>;
  homebankingMerge: (
    files: HomebankingMergeFileInput[],
    outputDir: string,
  ) => Promise<{
    success?: boolean;
    results?: HomebankingMergeGroupResult[];
    error?: string;
  }>;

  // Odczyty liczników
  odczytySelectFiles: () => Promise<{ fileName: string; filePath: string }[]>;
  odczytyAnalyzeFile: (filePath: string) => Promise<{
    data?: OdczytyAnalyzedFile;
    error?: string;
  }>;
  odczytySelectOutputDir: () => Promise<string | null>;
  odczytyConvert: (
    filePaths: string[],
    outputDir: string | null,
  ) => Promise<{
    success?: boolean;
    result?: OdczytyConvertResult;
    error?: string;
  }>;
  odczytyGetHistory: () => Promise<OdczytyHistoryEntry[]>;
  odczytyClearHistory: () => Promise<boolean>;

  // Mailing — jednostki ZGN
  mailingGetZgn: () => Promise<ZgnJednostka[]>;
  mailingAddZgn: (nazwa: string, email: string) => Promise<ZgnJednostka>;
  mailingUpdateZgn: (id: number, nazwa: string, email: string) => Promise<boolean>;
  mailingDeleteZgn: (id: number) => Promise<boolean>;

  // Mailing — pola dynamiczne
  mailingGetPola: () => Promise<MailingPole[]>;
  mailingAddPole: (
    nazwa: string,
    tekst: string,
    jednostka: string,
    typWartosci: MailingPoleTyp,
  ) => Promise<MailingPole>;
  mailingUpdatePole: (
    id: number,
    nazwa: string,
    tekst: string,
    jednostka: string,
    typWartosci: MailingPoleTyp,
  ) => Promise<boolean>;
  mailingDeletePole: (id: number) => Promise<boolean>;

  // Mailing — szablony
  mailingGetSzablony: () => Promise<MailingSzablon[]>;
  mailingAddSzablon: (data: Omit<MailingSzablon, 'id' | 'createdAt'>) => Promise<MailingSzablon>;
  mailingUpdateSzablon: (
    id: number,
    data: Omit<MailingSzablon, 'id' | 'createdAt'>,
  ) => Promise<boolean>;
  mailingDeleteSzablon: (id: number) => Promise<boolean>;

  // Mailing — wysyłka i historia
  mailingSelectAttachments: () => Promise<{ fileName: string; filePath: string }[]>;
  mailingSend: (request: {
    typ: string;
    templateId: number;
    /** Subject and body for this send — may differ from the stored template. */
    temat: string;
    tresc: string;
    adresIds: number[];
    values: Record<string, string>;
    /** Fields making up the `{{Tabela pól}}` table in the body, in row order. */
    tableFields: string[];
    attachPdf: boolean;
    attachments: { fileName: string; filePath: string }[];
  }) => Promise<{ success?: boolean; results?: MailingSendResult[]; error?: string }>;
  mailingGetHistory: () => Promise<MailingHistoryEntry[]>;
  mailingClearHistory: () => Promise<boolean>;
  mailingGetFilesInfo: () => Promise<{ dir: string; fileCount: number; totalBytes: number }>;
  mailingCleanupFiles: () => Promise<{
    success?: boolean;
    removedFiles?: number;
    freedBytes?: number;
    error?: string;
  }>;
  mailingGetSmtp: () => Promise<MailingSmtpStatus>;
  /** `pass` omitted ⇒ the stored password stays as it is. */
  mailingSetSmtp: (config: MailingSmtpConfig & { pass?: string }) => Promise<boolean>;
  mailingTestSmtp: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onMailingProgress: (callback: (progress: MailingProgressEvent) => void) => () => void;

  // Kalendarz — spotkania, ich typy i konta do listy uczestników
  /** The application's accounts, offered by the participant picker. */
  getAppUsers: () => Promise<AppUser[]>;
  getSpotkaniaTypy: () => Promise<SpotkanieTyp[]>;
  addSpotkanieTyp: (nazwa: string, kolor: string, opis: string) => Promise<SpotkanieTyp>;
  updateSpotkanieTyp: (
    id: number,
    nazwa: string,
    kolor: string,
    opis: string,
  ) => Promise<boolean>;
  deleteSpotkanieTyp: (id: number) => Promise<boolean>;
  getSpotkania: () => Promise<Spotkanie[]>;
  /** `createdBy` is filled in by the main process from the session. */
  addSpotkanie: (input: SpotkanieInput) => Promise<Spotkanie>;
  updateSpotkanie: (id: number, input: SpotkanieInput) => Promise<boolean>;
  deleteSpotkanie: (id: number) => Promise<boolean>;

  // Auth (Supabase)
  authSignIn: (
    email: string,
    password: string,
  ) => Promise<{ ok: true; session: { email: string; userId: string } } | { ok: false; error: string }>;
  authSignOut: () => Promise<void>;
  authGetSession: () => Promise<{ email: string; userId: string } | null>;
  /** True when the last session ended by expiring rather than by signing out. */
  authConsumeExpiryNotice: () => Promise<boolean>;
  /** Fires when the session dies mid-work; the app returns to the login screen. */
  onSessionExpired: (callback: (info: { message: string }) => void) => () => void;

  // App info
  getAppVersion: () => Promise<string>;

  // Zoom controls
  zoomIn: () => Promise<boolean>;
  zoomOut: () => Promise<boolean>;
  zoomReset: () => Promise<boolean>;

  platform: NodeJS.Platform;

  // Auto-updater
  checkForUpdates: () => Promise<{ available: boolean; info?: any; error?: string; message?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; downloadPath?: string; message?: string; error?: string; openedRelease?: boolean }>;
  openDownloadsFolder: () => Promise<{ success: boolean }>;
  openLogsFolder: () => Promise<{ success: boolean; logPath?: string }>;
  getLogPath: () => Promise<{ path: string }>;
  onUpdateAvailable: (callback: (info: any) => void) => () => void;
  onUpdateDownloaded: (callback: (info: any) => void) => () => void;
  onUpdateError: (callback: (error: string) => void) => () => void;
  onDownloadProgress: (callback: (progress: any) => void) => () => void;
  onConversionProgress: (callback: (progress: ConversionProgressEvent) => void) => () => void;
  onBackupCreated: (callback: (info: { filePath: string; date: string; upload: 'uploaded' | 'failed' | 'disabled'; trigger: 'startup' | 'quit' }) => void) => () => void;
}

export interface ConversionProgressEvent {
  fileName: string;
  phase: 'parse' | 'filter' | 'income-quick' | 'income-ai' | 'expense-quick' | 'expense-ai' | 'done';
  label: string;
  aiBatchesCompleted: number;
  aiBatchesTotal: number;
  percent: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export { ElectronAPI, ConversionResult };
