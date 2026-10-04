// Type definitions for Electron API exposed via preload

import type { NotificationPrefs } from '../shared/notifications';
import { Bank, Converter, AppSettings, ConversionHistory, ConversionSummary, Kontrahent, Adres, ApartmentMapping, ConversionReviewData, ReviewDecision, TransactionForReview, KontrahentTyp, KontoTyp, BackupCounts, OdczytyHistoryEntry, OdczytySkippedRow, ZgnJednostka, ZgnPelnomocnik, ZarzadOsoba, MailingPole, MailingPoleTyp, MailingSzablon, MailingHistoryEntry, MailingSmtpConfig, MailingSmtpStatus, MailingSendResult, MailingProgressEvent, AppUser, SpotkanieTyp, SpotkanieLokalizacja, Spotkanie, SpotkanieInput, KalendarzPdfRequest, SpotkanieMailing, SpotkanieTerminStatus, SpotkanieMaterialyStatus, SpotkanieMaterialyKrok, KsiegowaniePriorytet,
  KsiegowaniePrzypisanie, KsiegowanieUwaga, KsiegowaniePlik, ScanDecision, ScanProgress, ScanReport, Zadanie, ZadanieInput, ZadanieStatus, ZadanieZalacznik, ZadanieKomentarz, ZadanieKomentarzInput, ZadanieKomentarzPodsumowanie, ZadanieNotatka, MailingAdresaci, MailingTypDef, MailingKalendarzContext, MailingExportRequest, MailingExportResult, Zebranie, ZebranieInput, ZebranieStatus, ZebranieWersja, ZebranieWersjaInput, SprawozdaniaImportResult, SprawozdaniaWlasneImportResult, SprawozdanieExportRequest, PlanWlasny, PlanWlasnyExportRequest, SprawozdanieZapisane, SprawozdanieWstepTekst, PlanGospodarczy, ZebraniaWspolnota, AdresUdzialy, ZebraniaUstawienia, ZebranieDokumentRequest } from '../shared/types';
import type { MailingRecipientsResolved } from '../shared/mailing-recipients';

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
  /** Stopped by "Anuluj": nothing was written or recorded. */
  cancelled?: boolean;
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
  /** Stop the conversion of this input file; it resolves with `cancelled: true`. */
  cancelConversion: (inputPath: string) => Promise<boolean>;
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
  setStatementsFolder: (folderPath: string) => Promise<boolean>;
  setDarkMode: (enabled: boolean) => Promise<boolean>;
  setLanguage: (language: string) => Promise<boolean>;
  setSkipUserApproval: (enabled: boolean) => Promise<boolean>;
  setAlwaysUseAI: (enabled: boolean) => Promise<boolean>;
  setContractorSortOrder: (sortOrder: string) => Promise<boolean>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<boolean>;
  /** The menu's order as view ids; null restores the default. */
  setSidebarOrder: (order: string[] | null) => Promise<boolean>;
  setBookingsCollapsed: (collapsed: boolean) => Promise<boolean>;
  /** The dashboard's filter tiles as filter ids; null restores the default order. */
  setBookingsTileOrder: (order: string[] | null) => Promise<boolean>;
  /** Remember the month the Pulpit / Księgowania view is on (`YYYY-MM`). */
  setBookingsMonth: (monthKey: string) => Promise<boolean>;
  setCalendarHoverCard: (enabled: boolean) => Promise<boolean>;
  /** The signed-in person's own switches (only the flipped ones). */
  /** Raises a real system notification whose click opens a card — to check the whole path. */
  /** The bell's list for the signed-in person, newest first. */
  getInbox: () => Promise<import('../shared/types').InboxNotification[]>;
  /** ids null = all. */
  markInboxRead: (ids: string[] | null) => Promise<boolean>;
  deleteInbox: (ids: string[] | null) => Promise<boolean>;
  /** The list changed (a notification arrived) — read it again. */
  onInboxChanged: (callback: () => void) => () => void;
  sendTestNotification: () => Promise<{ shown: boolean; withTask: boolean }>;
  /** A test of one materials notification, about the nearest meeting. */
  sendTestMaterialyNotification: (
    krok: SpotkanieMaterialyKrok,
  ) => Promise<{ shown: boolean; withMeeting: boolean }>;
  getNotificationPrefs: () => Promise<NotificationPrefs>;
  /** Switch a notification on or off for the signed-in person. A locked or unknown one is refused (false). */
  setNotificationPref: (id: string, enabled: boolean) => Promise<boolean>;
  setLastSeenVersion: (version: string) => Promise<boolean>;
  exportSettings: () => Promise<{ success: boolean; filePath?: string }>;
  importSettings: () => Promise<{ success: boolean; error?: string }>;

  // History
  getHistory: () => Promise<ConversionHistory[]>;
  clearHistory: () => Promise<boolean>;
  importHistoryFromFile: () => Promise<{ success: boolean; added?: number; skipped?: number; error?: string }>;
  exportHistoryToFile: () => Promise<{ success: boolean; count?: number; filePath?: string; error?: string }>;
  /**
   * The dashboard's own conversion records (Pulpit → Księgowania), with the DOM
   * tick — independent of the history log, which may be cleared.
   */
  getKsiegowaniaKonwersje: () => Promise<ConversionHistory[]>;
  /** Tick / untick "posted in DOM" for the given conversion records (Księgowania view). */
  setKsiegowanieBookedInDom: (
    ids: number[],
    booked: boolean,
  ) => Promise<{ success: boolean; updated?: number; error?: string }>;
  /** Mark a pinned statement as posted in DOM without converting it (no accounting file). */
  markKsiegowaniePlikBooked: (plikId: number) => Promise<{ success: boolean; error?: string }>;
  /** Undo such a mark: deletes the manual record, never a real conversion. */
  undoKsiegowanieManual: (id: number) => Promise<{ success: boolean; error?: string }>;

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
  /** The unit serves exactly these communities: assigns them, unassigns the rest. */
  setZgnAdresy: (jednostkaId: number, adresIds: number[]) => Promise<boolean>;
  /** Replace a community's board — the whole list, as the modal holds it. */
  setAdresZarzad: (id: number, zarzad: ZarzadOsoba[]) => Promise<boolean>;
  /** Every proxy of every city unit. */
  getZgnPelnomocnicy: () => Promise<ZgnPelnomocnik[]>;
  addZgnPelnomocnik: (jednostkaId: number, imieNazwisko: string, email: string) => Promise<ZgnPelnomocnik>;
  updateZgnPelnomocnik: (id: number, imieNazwisko: string, email: string) => Promise<boolean>;
  deleteZgnPelnomocnik: (id: number) => Promise<boolean>;

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
    /** The meeting this send was triggered from, recorded on every history row. */
    spotkanieId?: number | null;
    /** Recipient groups for this send; absent ⇒ the kind's stored default. */
    adresaci?: MailingAdresaci;
    /** Mailboxes (lower-cased) unticked for this send. */
    wykluczeni?: string[];
    /** What the meeting fills the calendar fields with, when sent from one. */
    kalendarz?: MailingKalendarzContext | null;
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

  // Mailing — typy mailingu (the built-in one first)
  mailingGetTypy: () => Promise<MailingTypDef[]>;
  mailingAddTyp: (nazwa: string, opis: string, adresaci: MailingAdresaci) => Promise<MailingTypDef>;
  /** The built-in kind keeps its name whatever is sent. */
  mailingUpdateTyp: (
    id: number,
    nazwa: string,
    opis: string,
    adresaci: MailingAdresaci,
  ) => Promise<boolean>;
  /** Refused (with a message to show) for the built-in kind and for a kind templates still use. */
  mailingDeleteTyp: (id: number) => Promise<{ success?: boolean; error?: string }>;
  /** "Pobierz jako e-mail / PDF" — files in Downloads, nothing sent or recorded. */
  mailingExport: (
    request: MailingExportRequest,
  ) => Promise<({ success: true } & MailingExportResult) | { success?: undefined; error: string }>;
  /** Who a letter would go to — same resolution as a send. */
  mailingResolveOdbiorcy: (request: {
    adresId: number | null;
    spotkanieId?: number | null;
    adresaci: MailingAdresaci;
    wykluczeni?: string[];
  }) => Promise<MailingRecipientsResolved>;
  /** Reveal a file in Finder / Explorer. False when it no longer exists. */
  mailingShowInFolder: (filePath: string) => Promise<boolean>;
  /** Reveal a file in Finder / Explorer, selected. False when it is not there. */
  showInFolder: (filePath: string) => Promise<boolean>;

  // Zebrania — meeting materials, versioned
  /** Every entry with its versions (oldest first), newest entry first. */
  getZebrania: () => Promise<Zebranie[]>;
  /** "Przygotuj materiały": the meeting's entry — created on first use (version 1.0), returned after. */
  zebranieFromSpotkanie: (spotkanieId: number) => Promise<Zebranie>;
  /** A meeting saved with materials needed: its entry, created when missing — the meeting's status is left as it is. */
  ensureZebranieForSpotkanie: (spotkanieId: number) => Promise<Zebranie>;
  /** A standalone entry, not linked to a meeting. */
  addZebranie: (input: ZebranieInput) => Promise<Zebranie>;
  /** Standalone entries only — a linked one is edited in the Kalendarz. */
  updateZebranie: (id: number, input: ZebranieInput) => Promise<boolean>;
  deleteZebranie: (id: number) => Promise<boolean>;
  /** A new revision (1.0 → 1.1), copied from the newest version; the meeting goes back to "to prepare". */
  addZebranieWersja: (zebranieId: number) => Promise<ZebranieWersja>;
  updateZebranieWersja: (id: number, input: ZebranieWersjaInput) => Promise<boolean>;
  /** The newest version of a linked entry moves the meeting's materials status with it. */
  setZebranieWersjaStatus: (id: number, status: ZebranieStatus) => Promise<boolean>;
  /** Rename a revision; an empty name falls back to its number. */
  setZebranieWersjaNazwa: (id: number, nazwa: string) => Promise<boolean>;
  /** Pick a vDom "RozliczenieWsp" PDF and store every community's statement; null when cancelled. */
  importSprawozdania: () => Promise<SprawozdaniaImportResult | null>;
  /** The statement library, without the statements themselves. */
  getSprawozdaniaLista: () => Promise<SprawozdanieZapisane[]>;
  getSprawozdanie: (id: number) => Promise<SprawozdanieZapisane | null>;
  /** Attach a library statement to a version, as a copy. */
  attachZebranieSprawozdanie: (wersjaId: number, sprawozdanieId: number) => Promise<boolean>;
  removeZebranieSprawozdanie: (wersjaId: number) => Promise<boolean>;
  /** Save the edited introduction of a version's statement; null goes back to the computed one. */
  setZebranieSprawozdanieWstep: (wersjaId: number, wstep: SprawozdanieWstepTekst | null) => Promise<boolean>;
  /** Save (or with null remove) a version's budget plan. */
  setZebranieWersjaPlan: (wersjaId: number, plan: PlanGospodarczy | null) => Promise<boolean>;
  getZebraniaWspolnoty: () => Promise<ZebraniaWspolnota[]>;
  setZebraniaWspolnota: (
    adresNazwa: string,
    patch: { vdomNr?: number | null; udzialy?: AdresUdzialy | null },
  ) => Promise<boolean>;
  getZebraniaUstawienia: () => Promise<ZebraniaUstawienia>;
  setZebraniaUstawienia: (value: ZebraniaUstawienia) => Promise<boolean>;
  /** Write a version's statement or plan to Downloads; the path of the file. */
  exportZebranieDokument: (request: ZebranieDokumentRequest) => Promise<{ filePath: string }>;
  /**
   * Sprawozdania: pick a vDom file and add the statements Zebrania does not
   * have (those it has are counted in `pominiete`); null when cancelled.
   */
  importSprawozdaniaWlasne: () => Promise<SprawozdaniaWlasneImportResult | null>;
  /** Remove a statement added in Sprawozdania; one from Zebrania is refused. */
  deleteSprawozdanieWlasne: (id: number) => Promise<boolean>;
  /** Write a library statement to Downloads as PDF or Excel; the path of the file. */
  exportSprawozdanie: (request: SprawozdanieExportRequest) => Promise<{ filePath: string }>;
  /** Plans made in Plany gospodarcze (Zebrania's are read from the versions). */
  getPlanyWlasne: () => Promise<PlanWlasny[]>;
  /** Refused when Zebrania has a plan of this community (vDom number) and year. */
  addPlanWlasny: (nrWsp: number, nazwa: string, plan: PlanGospodarczy) => Promise<PlanWlasny>;
  /** Refused when the (changed) year is one Zebrania has a plan for. */
  setPlanWlasny: (id: number, plan: PlanGospodarczy) => Promise<boolean>;
  deletePlanWlasny: (id: number) => Promise<boolean>;
  /** Write a module plan to Downloads as PDF or Excel; the path of the file. */
  exportPlanWlasny: (request: PlanWlasnyExportRequest) => Promise<{ filePath: string }>;
  /** Note a download on the material it came from. */
  recordZebraniePobranie: (wersjaId: number, materialId: string, pliki: string[]) => Promise<boolean>;

  // Kalendarz — spotkania, ich typy i konta do listy uczestników
  /** The application's accounts, offered by the participant picker. */
  getAppUsers: () => Promise<AppUser[]>;
  /** Name an account. Empty strings clear the name. */
  setAppUserName: (id: string, firstName: string, lastName: string) => Promise<boolean>;
  /** null = back to the automatic colour. */
  setAppUserColor: (id: string, color: string | null) => Promise<boolean>;
  getSpotkaniaTypy: () => Promise<SpotkanieTyp[]>;
  addSpotkanieTyp: (
    nazwa: string,
    kolor: string,
    opis: string,
    /** Days before a meeting of this kind its documents are due; null = no rule. */
    dniNaDokumenty?: number | null,
  ) => Promise<SpotkanieTyp>;
  updateSpotkanieTyp: (
    id: number,
    nazwa: string,
    kolor: string,
    opis: string,
    dniNaDokumenty?: number | null,
  ) => Promise<boolean>;
  deleteSpotkanieTyp: (id: number) => Promise<boolean>;
  getSpotkania: () => Promise<Spotkanie[]>;
  /** The month as a PDF in Downloads — a grid of the meetings, then their details. */
  exportKalendarzPdf: (request: KalendarzPdfRequest) => Promise<{ filePath: string }>;
  /** `createdBy` is filled in by the main process from the session. */
  addSpotkanie: (input: SpotkanieInput) => Promise<Spotkanie>;
  updateSpotkanie: (id: number, input: SpotkanieInput) => Promise<boolean>;
  deleteSpotkanie: (id: number) => Promise<boolean>;
  /** "I have seen that this moved" — stops the meeting being marked as changed. */
  ackSpotkanieTermin: (id: number) => Promise<boolean>;
  setSpotkanieTerminStatus: (id: number, status: SpotkanieTerminStatus) => Promise<boolean>;
  /** Tick or untick "documents sent", with a note of what went out. */
  setSpotkanieDokumenty: (id: number, sent: boolean, opis: string) => Promise<boolean>;
  /** Move the materials status; who and when come from the session. */
  setSpotkanieMaterialy: (id: number, status: SpotkanieMaterialyStatus) => Promise<boolean>;
  /** Every Mailing send triggered from a meeting, newest first. */
  getSpotkaniaMailingi: () => Promise<SpotkanieMailing[]>;

  // Zadania — tablica Kanban
  getZadania: () => Promise<Zadanie[]>;
  /** `createdBy` is filled in by the main process from the session. */
  addZadanie: (input: ZadanieInput) => Promise<Zadanie>;
  updateZadanie: (id: number, input: ZadanieInput) => Promise<boolean>;
  /**
   * Put a card in a column: its status, and the order of that whole column
   * (`orderedIds`, top first). Reordering touches neither `updatedAt` nor
   * `updatedBy`, so it never counts as a change to notify about.
   */
  moveZadanie: (id: number, status: ZadanieStatus, orderedIds: number[]) => Promise<boolean>;
  deleteZadanie: (id: number) => Promise<boolean>;
  /** Hide a card from the board (kept in the archive) or bring it back. */
  archiveZadanie: (id: number, archived: boolean) => Promise<boolean>;
  /** Opens the file dialog. null = cancelled; a refusal carries a code, not wording. */
  zadaniaPickAttachment: () => Promise<
    | { ok: true; token: string; nazwa: string; rozmiar: number }
    | { ok: false; error: 'too_large' | 'not_a_file' | 'unreadable' }
    | null
  >;
  /** Uploads the file a pick handed out a token for. */
  zadaniaUploadAttachment: (
    token: string,
  ) => Promise<
    | { ok: true; zalacznik: ZadanieZalacznik }
    | { ok: false; error: 'too_large' | 'not_a_file' | 'unreadable' | 'failed' }
  >;
  /** Save dialog, then the file. false = the user cancelled. */
  /** Where the attachment was saved, or null when the save dialog was cancelled. */
  zadaniaDownloadAttachment: (zalacznik: { sciezka: string; nazwa: string }) => Promise<string | null>;
  /** Remove uploads that never reached a card (a cancelled form). */
  zadaniaDiscardAttachments: (paths: string[]) => Promise<boolean>;
  onOpenKsiegowania: (callback: () => void) => () => void;
  onOpenSpotkanie: (callback: (spotkanieId: number) => void) => () => void;
  /** One entry per card that has comments — its count and newest comment. */
  getZadaniaKomentarzePodsumowanie: () => Promise<ZadanieKomentarzPodsumowanie[]>;
  /** Notes pinned to the board, newest first. */
  getZadaniaNotatki: () => Promise<ZadanieNotatka[]>;
  /** `autorEmail` is filled in by the main process from the session. */
  addZadanieNotatka: (tresc: string) => Promise<ZadanieNotatka>;
  /** Only the author's own note can be reworded; returns false when nobody is signed in. */
  updateZadanieNotatka: (id: number, tresc: string) => Promise<boolean>;
  /** Only the author's own note goes; returns false when nobody is signed in. */
  deleteZadanieNotatka: (id: number) => Promise<boolean>;
  getZadanieKomentarze: (zadanieId: number) => Promise<ZadanieKomentarz[]>;
  /** `autorEmail` is filled in by the main process from the session. */
  addZadanieKomentarz: (input: ZadanieKomentarzInput) => Promise<ZadanieKomentarz>;
  /** Only the author's own comment goes; returns false when nobody is signed in. */
  deleteZadanieKomentarz: (id: number) => Promise<boolean>;
  onOpenZadania: (callback: (zadanieId?: number) => void) => () => void;

  // Księgowania: priorities with a note, and notes on a community. Who did it
  // (`createdBy`, `resolvedBy`) is filled in by the main process from the session.
  /** Every month's priorities; the view picks the month it shows. */
  getKsiegowaniaPriorytety: () => Promise<KsiegowaniePriorytet[]>;
  /** Every month's assignments (who posts which community); the view picks its month. */
  getKsiegowaniaPrzypisania: () => Promise<KsiegowaniePrzypisanie[]>;
  /** Assign the community's month to a person; `email: null` clears it. */
  setKsiegowaniePrzypisanie: (
    monthKey: string,
    adresId: number | null,
    adresNazwa: string,
    email: string | null,
  ) => Promise<KsiegowaniePrzypisanie | null>;
  /** Flag a community for the month; it goes to the end of that month's queue. */
  addKsiegowaniePriorytet: (
    monthKey: string,
    adresId: number | null,
    adresNazwa: string,
    notatka: string,
  ) => Promise<KsiegowaniePriorytet>;
  setKsiegowaniePriorytetNotatka: (id: number, notatka: string) => Promise<boolean>;
  removeKsiegowaniePriorytet: (id: number) => Promise<boolean>;
  /** Rewrite the month's queue to this order (ids of that month's priorities). */
  reorderKsiegowaniaPriorytety: (monthKey: string, orderedIds: number[]) => Promise<boolean>;
  /** Open and resolved alike; the callers split them. */
  getKsiegowaniaUwagi: () => Promise<KsiegowanieUwaga[]>;
  addKsiegowanieUwaga: (
    adresId: number | null,
    adresNazwa: string,
    tresc: string,
  ) => Promise<KsiegowanieUwaga>;
  updateKsiegowanieUwaga: (id: number, tresc: string) => Promise<boolean>;
  setKsiegowanieUwagaResolved: (id: number, resolved: boolean) => Promise<boolean>;
  deleteKsiegowanieUwaga: (id: number) => Promise<boolean>;
  /** Every file the folder scan pinned (all months); [] when the table is not there yet. */
  getKsiegowaniaPliki: () => Promise<KsiegowaniePlik[]>;
  /** "Znajdź pliki księgowe" for one month (`YYYY-MM`). */
  scanKsiegowaniaPliki: (
    monthKey: string,
  ) => Promise<
    | { success: true; report: ScanReport }
    | { success: false; error: 'no-folder' | 'folder-missing' | 'busy' | 'invalid-month' | string; folder?: string }
  >;
  /** The user's answers to the last scan's conflicts. */
  resolveKsiegowaniaScan: (
    decisions: { id: string; decision: ScanDecision }[],
  ) => Promise<{ applied: number; failed: { relPath: string; message: string }[] }>;
  /** "Odepnij" — forget a pinned file; the file itself stays on disk. */
  deleteKsiegowaniePlik: (id: number) => Promise<boolean>;
  /** Open a PDF in a preview window over the app (system viewer as a fallback). */
  previewPdf: (filePath: string) => Promise<boolean>;
  getSpotkaniaLokalizacje: () => Promise<SpotkanieLokalizacja[]>;
  addSpotkanieLokalizacja: (
    nazwa: string,
    adres: string,
    opis: string,
  ) => Promise<SpotkanieLokalizacja>;
  updateSpotkanieLokalizacja: (
    id: number,
    nazwa: string,
    adres: string,
    opis: string,
  ) => Promise<boolean>;
  deleteSpotkanieLokalizacja: (id: number) => Promise<boolean>;

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
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
  onBackupCreated: (callback: (info: { filePath: string; date: string; upload: 'uploaded' | 'failed' | 'disabled'; trigger: 'startup' | 'scheduled' | 'quit' }) => void) => () => void;
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
