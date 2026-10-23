// Type definitions for Electron API exposed via preload

import type { NotificationPrefs } from '../shared/notifications';
import type { PitDane, PodatekPit } from '../shared/podatki-pit';
import type { PodatekZusPlatnik, PodatekZusRozliczenie, ZusPlatnikDane, ZusRozliczenieDane } from '../shared/podatki-zus';
import type { ZusSrodowisko, ZusWysylka } from '../shared/zus-ewd';
import type { PodatkiPitUpoResult, PodatkiZusPotwierdzeniaResult, PodatkiZusWyslijResult } from '../shared/types';
import type { CitPrzegladPozycja } from '../shared/podatki-cit';
import type {
  PodatkiPitExcelResult,
  PodatkiPitImportResult,
  PodatkiZusImportResult,
  PodatkiZusPlikiOpcje,
  PodatkiZusPlikiResult,
  PodatkiPitPlikiResult,
  PodatkiPitPostep,
} from '../shared/types';
import type { PlanExpected, ZebranieStatusRow } from '../shared/types';
import { Bank, Converter, AppSettings, ConversionHistory, ConversionSummary, Kontrahent, Adres, ApartmentMapping, ConversionReviewData, ReviewDecision, TransactionForReview, KontrahentTyp, KontoTyp, BackupCounts, OdczytyHistoryEntry, OdczytySkippedRow, ZgnJednostka, ZgnPelnomocnik, ZarzadOsoba, MailingPole, MailingPoleTyp, MailingSzablon, MailingHistoryEntry, MailingSmtpConfig, MailingSmtpStatus, MailingSendResult, MailingProgressEvent, AppUser, SpotkanieTyp, SpotkanieLokalizacja, Spotkanie, SpotkanieInput, KalendarzPdfRequest, SpotkanieMailing, SpotkanieTerminStatus, SpotkanieMaterialyStatus, SpotkanieMaterialyKrok, KsiegowaniePriorytet,
  KsiegowaniePrzypisanie, KsiegowanieUwaga, KsiegowaniePlik, ScanDecision, ScanProgress, ScanReport, Zadanie, ZadanieInput, ZadanieStatus, ZadanieZalacznik, ZadanieKomentarz, ZadanieKomentarzInput, ZadanieKomentarzPodsumowanie, ZadanieNotatka, MailingAdresaci, MailingTypDef, MailingKalendarzContext, MailingZebranieContext, MailingExportRequest, MailingExportResult, Zebranie, ZebranieInput, ZebranieDokumentKlucz, ZebranieWersja, ZebranieWersjaInput, SprawozdaniaImportResult, SprawozdanieExportRequest, PlanWlasny, PlanWlasnyExportRequest, PodatekNieruchomosci, PodatekNieruchomosciDane, PodatkiImportResult, PodatkiPdfWszystkieResult, PodatkiPodpisPostep, PodatkiPodpisWieleResult, PodatkiStawki, PodatkiStawkiDane, AdresIdentyfikacja, AdresPowierzchnie, AdresyZasilenieResult, PodatekCit, PodatekCitDane, PodatkiCitPlikiResult, PodatkiCitUpoResult, PodatkiCitUstawienia, CitAiPozycja, CitAiPrzyklad, CitAiWynik, PodpisKartaStan, PodpisSlad, PodpisWybor, PodpisPdfAnaliza, PodpisPdfWynik, PodpisHistoriaEntry, ZebraniePakietRequest, SprawozdanieZapisane, SprawozdanieWstepTekst, SprawozdanieLaczenie, SprawozdanieLaczeniePropozycja, SprawozdanieGrupowanie, SprawozdanieCel, PlanGospodarczy, PlanZaliczkaAiPropozycja, ZebraniaWspolnota, AdresUdzialy, ZebraniaUstawienia, ZebranieDokumentRequest } from '../shared/types';
import type { BackupSectionKey, ZadaniePatch } from '../shared/types';

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
  /** Lines no bank can be chosen for (none matches, or several do). */
  unroutedLines: { lineNumber: number; excerpt: string; reason: 'no-bank' | 'ambiguous' }[];
}

export interface HomebankingMergeFileInput {
  filePath: string;
  bankIds: number[];
  date: string | null;
  splitByAddress: boolean;
  /** Unrouted lines the user confirmed leaving out; the merge refuses more. */
  acknowledgedUnrouted?: number;
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
  /**
   * The output file was written, but its record (the dashboard's, or the history
   * log line) was not — the raw reason. The conversion still counts as done.
   */
  recordError?: string;
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
    bezZgn?: boolean,
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
    bezZgn?: boolean,
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
  detectAccountNumbers: (inputPath: string, bankId?: number | null) => Promise<string[]>;
  /** SHA-1 of a statement file — the `inputHash` its conversion records — or null when it cannot be read. */
  fileHash: (inputPath: string) => Promise<string | null>;
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
  /** Path of a dropped `File` (`webUtils.getPathForFile`); empty when it has no file on disk. */
  getPathForFile: (file: File) => string;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setOutputFolder: (folderPath: string) => Promise<boolean>;
  setImpexFolder: (folderPath: string) => Promise<boolean>;
  setSwrkFolder: (folderPath: string) => Promise<boolean>;
  setStatementsFolder: (folderPath: string) => Promise<boolean>;
  /** Podatki → Nieruchomości: where DN-1 files go ('' = Downloads). */
  setPodatkiFolder: (folderPath: string) => Promise<boolean>;
  setDarkMode: (enabled: boolean) => Promise<boolean>;
  setLanguage: (language: string) => Promise<boolean>;
  setSkipUserApproval: (enabled: boolean) => Promise<boolean>;
  setAlwaysUseAI: (enabled: boolean) => Promise<boolean>;
  setAiModel: (model: string) => Promise<boolean>;
  /** Switch the e-Deklaracje gateway of this computer ('test' / 'prod'); the value now in force. */
  setEDeklaracjeSrodowisko: (srodowisko: 'test' | 'prod') => Promise<'test' | 'prod'>;
  /** Switch ZUS's EWD service of this computer ('test' / 'prod'); the value now in force. */
  setZusSrodowisko: (srodowisko: ZusSrodowisko) => Promise<ZusSrodowisko>;
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
  /** `imported`: how many portable settings the file gave (folders, SMTP and the like never travel). */
  importSettings: () => Promise<{ success: boolean; error?: string; imported?: number }>;

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
  /** Discard a conversion as a duplicate (it stops counting as a file to post), or restore it. */
  setKsiegowanieDiscarded: (id: number, discarded: boolean) => Promise<{ success: boolean; error?: string }>;

  // Backup
  /** `skippedSections`: left out because their table does not exist yet (a migration not run). */
  backupExport: () => Promise<{
    success: boolean;
    filePath?: string;
    counts?: BackupCounts;
    skippedSections?: BackupSectionKey[];
    error?: string;
  }>;
  /**
   * `skippedSections`: what the restored FILE left out (those live rows were kept).
   * `missingSections`: the restore was stopped before touching anything, because
   * the safety copy of the current data would have lacked these sections.
   */
  backupRestore: () => Promise<{
    success: boolean;
    counts?: BackupCounts;
    createdAt?: string;
    skippedSections?: BackupSectionKey[];
    missingSections?: BackupSectionKey[];
    error?: string;
  }>;
  backupGetStatus: () => Promise<{ folder: string; lastAutoBackup: string | null; autoBackupCount: number }>;
  backupOpenFolder: () => Promise<{ success: boolean }>;
  
  // Zaliczki
  zaliczkiSelectPdfs: () => Promise<{ fileName: string; filePath: string }[]>;
  /** Reads with the model picked in Settings. `force` skips the per-page cache and re-asks the model. */
  zaliczkiExtractPdf: (filePath: string, force?: boolean) =>
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
  /** Replace a community's tax identification (NIP, full name, seat, office…) — the whole record. */
  setAdresIdentyfikacja: (id: number, identyfikacja: AdresIdentyfikacja) => Promise<boolean>;
  /** Replace a community's areas (total, the city's, the leased) — the whole record. */
  setAdresPowierzchnie: (id: number, powierzchnie: AdresPowierzchnie) => Promise<boolean>;
  /** One-time: fill empty identification fields from the DN-1 declarations; never overwrites. */
  zasilAdresyZDn1: () => Promise<AdresyZasilenieResult>;
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
    /** Mailing kind (`klucz`) the field is offered in; null = every kind. */
    typ: string | null,
  ) => Promise<MailingPole>;
  mailingUpdatePole: (
    id: number,
    nazwa: string,
    tekst: string,
    jednostka: string,
    typWartosci: MailingPoleTyp,
    typ: string | null,
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
    /** The meeting version's statement, plan and resolutions, when sent from Zebrania. */
    zebranie?: MailingZebranieContext | null;
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
  /**
   * Standalone entries only — a linked one is edited in the Kalendarz.
   * `expected`: the entry's fields as the form loaded them; changed since by
   * somebody else, the save is refused with the `concurrentEdit` AppError.
   */
  updateZebranie: (id: number, input: ZebranieInput, expected?: ZebranieInput | null) => Promise<boolean>;
  deleteZebranie: (id: number) => Promise<boolean>;
  /** A new revision (1.0 → 1.1), copied from the newest version; the meeting goes back to "to prepare". */
  addZebranieWersja: (zebranieId: number) => Promise<ZebranieWersja>;
  /** Delete one version; the only version of an entry cannot be deleted. */
  deleteZebranieWersja: (id: number) => Promise<boolean>;
  /**
   * `expectedUpdatedAt`: the version's `updatedAt` as loaded; a version saved
   * since by somebody else is then refused instead of overwritten.
   */
  updateZebranieWersja: (id: number, input: ZebranieWersjaInput, expectedUpdatedAt?: string | null) => Promise<boolean>;
  /** The newest version of a linked entry moves the meeting's materials status with it. */
  /** Mark one document of a version ready or not; the version's status is derived from all of them. */
  setZebranieDokumentGotowe: (id: number, dokument: ZebranieDokumentKlucz, gotowe: boolean) => Promise<boolean>;
  /** The statement library, without the statements themselves. */
  getSprawozdaniaLista: () => Promise<SprawozdanieZapisane[]>;
  getSprawozdanie: (id: number) => Promise<SprawozdanieZapisane | null>;
  /** Link a library statement to a version (the figures stay the library's). */
  attachZebranieSprawozdanie: (wersjaId: number, sprawozdanieId: number) => Promise<boolean>;
  removeZebranieSprawozdanie: (wersjaId: number) => Promise<boolean>;
  /** Save the edited introduction of a version's (or a module plan's) statement; null goes back to the computed one. */
  setSprawozdanieWstep: (cel: SprawozdanieCel, wstep: SprawozdanieWstepTekst | null) => Promise<boolean>;
  /** Save the merges, or the subcategories, of a version's (or a module plan's) statement — the whole list of that kind. */
  setSprawozdanieLaczenia: (
    cel: SprawozdanieCel,
    rodzaj: SprawozdanieGrupowanie,
    lista: SprawozdanieLaczenie[],
  ) => Promise<boolean>;
  /** Merges or subcategories the AI suggests for the statement — only suggestions, nothing is stored. */
  proponujLaczeniaSprawozdaniaAi: (
    cel: SprawozdanieCel,
    rodzaj: SprawozdanieGrupowanie,
  ) => Promise<SprawozdanieLaczeniePropozycja[]>;
  /** A draft of the statement introduction's paragraph, by the AI, with the user's guidance — nothing is stored. */
  napiszWstepSprawozdaniaAi: (cel: SprawozdanieCel, wskazowki: string) => Promise<string>;
  /** The AI's proposal of the advance "A" or "B" rate for a plan as on screen (unsaved edits too). */
  proponujZaliczkeAi: (
    plan: PlanGospodarczy,
    rodzaj: 'A' | 'B',
    wskazowki: string,
    dataZebrania: string | null
  ) => Promise<PlanZaliczkaAiPropozycja>;
  /**
   * Save (or with null remove) a version's budget plan. `expected`: the plan the
   * editor started from (`zmieniono`, null = none yet); a plan saved since by
   * somebody else is refused with the `concurrentEdit` AppError.
   */
  setZebranieWersjaPlan: (
    wersjaId: number,
    plan: PlanGospodarczy | null,
    expected?: PlanExpected | null,
  ) => Promise<boolean>;
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
   * Sprawozdania: pick a vDom "RozliczenieWsp" PDF and store every community's
   * statement — a newer print of a period replaces it, also in the meetings
   * linked to it; null when cancelled.
   */
  importSprawozdania: () => Promise<SprawozdaniaImportResult | null>;
  /** Remove a statement from the library; one a meeting is linked to is refused. */
  deleteSprawozdanie: (id: number) => Promise<boolean>;
  /** Write a library statement to Downloads as PDF or Excel; the path of the file. */
  exportSprawozdanie: (request: SprawozdanieExportRequest) => Promise<{ filePath: string }>;
  /** Write a version's materials as one PDF (cover + the parts asked for) to Downloads. */
  exportZebraniePakiet: (request: ZebraniePakietRequest) => Promise<{ filePath: string }>;
  /** Plans made in Plany gospodarcze (Zebrania's are read from the versions). */
  getPlanyWlasne: () => Promise<PlanWlasny[]>;
  /** Refused when Zebrania has a plan of this community (vDom number) and year. */
  addPlanWlasny: (nrWsp: number, nazwa: string, plan: PlanGospodarczy) => Promise<PlanWlasny>;
  /** Refused when the (changed) year is one Zebrania has a plan for. */
  /** `expected`: as for `setZebranieWersjaPlan`. */
  setPlanWlasny: (id: number, plan: PlanGospodarczy, expected?: PlanExpected | null) => Promise<boolean>;
  deletePlanWlasny: (id: number) => Promise<boolean>;
  /** Write a module plan to Downloads as PDF or Excel; the path of the file. */
  exportPlanWlasny: (request: PlanWlasnyExportRequest) => Promise<{ filePath: string }>;
  /** Every year's DN-1 data of the Podatki module. */
  getPodatkiNieruchomosci: () => Promise<PodatekNieruchomosci[]>;
  /** Refused when the community (NIP) already has a declaration that year. */
  addPodatekNieruchomosci: (nip: string, rok: number, dane: PodatekNieruchomosciDane) => Promise<PodatekNieruchomosci>;
  setPodatekNieruchomosci: (id: number, nip: string, dane: PodatekNieruchomosciDane) => Promise<PodatekNieruchomosci>;
  deletePodatekNieruchomosci: (id: number) => Promise<boolean>;
  /** Draft `naRok` from `zRoku` for the communities it lacks; how many were added. */
  przeniesPodatkiNaRok: (zRoku: number, naRok: number) => Promise<number>;
  /** Pick the office's spreadsheet and add the declarations it holds; null when cancelled. */
  importPodatkiXlsx: () => Promise<PodatkiImportResult | null>;
  /** Write one declaration as PDF — to the Settings folder's "DN-1 <rok>", else Downloads; the path of the file. */
  exportPodatekPdf: (id: number) => Promise<{ filePath: string }>;
  /** Every printable declaration of a year (or only `ids`), one PDF each, into one folder in Downloads. */
  exportPodatkiPdfWszystkie: (rok: number, ids?: number[]) => Promise<PodatkiPdfWszystkieResult>;
  /** Tick declarations as posted in DOM (or untick them); the rows as they now are. */
  setPodatkiDom: (ids: number[], booked: boolean) => Promise<PodatekNieruchomosci[]>;
  getPodatkiStawki: () => Promise<PodatkiStawki[]>;
  setPodatkiStawki: (rok: number, stawki: PodatkiStawkiDane) => Promise<PodatkiStawki>;
  /**
   * Sign one declaration with the card and write it to Downloads; the file and
   * who signed. A wrong PIN rejects with the card's message — never retried.
   */
  podpiszPodatekPdf: (id: number, wybor: PodpisWybor) => Promise<{ filePath: string; podpis: PodpisSlad }>;
  /**
   * Sign the ticked declarations of a year one by one with one PIN — into the
   * Settings folder's "DN-1 <rok>", else "DN-1 <rok> podpisane" in Downloads.
   * Rejects only when nothing got signed (wrong PIN, no card); otherwise
   * resolves with everything the summary shows.
   */
  podpiszPodatkiPdf: (rok: number, ids: number[], wybor: PodpisWybor) => Promise<PodatkiPodpisWieleResult>;
  /** Stop the signing run after the declaration in hand. */
  przerwijPodpisPodatkow: () => Promise<boolean>;
  /** Progress of the signing run; returns the unsubscribe. */
  onPodatkiPodpisPostep: (callback: (postep: PodatkiPodpisPostep) => void) => () => void;

  // Podpis kwalifikowany — any PDF or XML
  /** Native picker for PDFs and XMLs to sign; empty when cancelled. */
  podpisWybierzPdf: () => Promise<{ fileName: string; filePath: string }[]>;
  /** Size, pages and whether the file can be signed at all — see `PodpisPdfAnaliza.blokada`. */
  podpisAnalizujPdf: (filePath: string) => Promise<PodpisPdfAnaliza>;
  /**
   * Sign the given PDFs (PAdES) and XMLs (XAdES enveloped) one by one with one
   * PIN, each into "<name> (podpisany).<ext>" next to the original. Rejects only when nothing got signed (wrong PIN, no
   * card); otherwise resolves with everything the summary shows. The run is
   * written to the history.
   */
  podpisPodpiszPdf: (filePaths: string[], wybor: PodpisWybor) => Promise<PodpisPdfWynik>;
  /** Stop the run after the file in hand. */
  podpisPrzerwijPdf: () => Promise<boolean>;
  /** Progress of the run; returns the unsubscribe. */
  onPodpisPdfPostep: (callback: (postep: PodatkiPodpisPostep) => void) => () => void;
  podpisGetHistoria: () => Promise<PodpisHistoriaEntry[]>;
  podpisClearHistoria: () => Promise<boolean>;

  // Podatki — CIT-8
  /** Every year's CIT-8 data of the Podatki module. */
  getPodatkiCit: () => Promise<PodatekCit[]>;
  /** For the community of that name (`Adres.nazwa`); refused when it already has a return that year. */
  addPodatekCit: (adresNazwa: string, rok: number, dane: PodatekCitDane) => Promise<PodatekCit>;
  setPodatekCit: (id: number, dane: PodatekCitDane) => Promise<PodatekCit>;
  deletePodatekCit: (id: number) => Promise<boolean>;
  /** Draft `naRok` from `zRoku` for the communities it lacks; how many were added. */
  przeniesCitNaRok: (zRoku: number, naRok: number) => Promise<number>;
  /** Write one return as PDF (CIT-8, with the CIT-8/O when it has exempt income) — to the Settings folder's "CIT-8 <rok>", else Downloads. */
  exportPodatekCitPdf: (id: number) => Promise<{ filePath: string }>;
  /** Write one return as the e-Deklaracje XML (CIT-8, with the CIT-8/O when it has exempt income), unsigned — same folder as the PDF. */
  exportPodatekCitXml: (id: number) => Promise<{ filePath: string }>;
  /** Every return of a year (or only `ids`) as XML, PDF or both, into one folder; what could not be made, with the reason. */
  zapiszPodatkiCitPliki: (rok: number, ids: number[] | undefined, tryb: 'xml' | 'pdf' | 'oba') => Promise<PodatkiCitPlikiResult>;
  /** Tick returns as filed with the tax office (or untick them); the rows as they now are. */
  setPodatkiCitZlozone: (ids: number[], filed: boolean) => Promise<PodatekCit[]>;
  /**
   * Sign returns of a year one by one with one PIN: the XML with XAdES for e-Deklaracje, the PDF next to it —
   * with PAdES only when `pdfPodpisany`. One entry of `podpisane` per file. Rejects only when nothing got signed.
   */
  podpiszPodatkiCit: (
    rok: number,
    ids: number[],
    wybor: PodpisWybor,
    /** `potwierdzoneKorekty`: corrections the user confirmed sending although an earlier send holds them back. */
    opcje: { pdfPodpisany: boolean; wyslij: boolean; potwierdzoneKorekty?: number[] },
  ) => Promise<PodatkiPodpisWieleResult>;
  /** Ask the e-Deklaracje gateway for the UPO of every send of the year still waiting (or of `ids` only). */
  sprawdzUpoCit: (rok: number, ids?: number[]) => Promise<PodatkiCitUpoResult>;
  /** Write the UPO kept on a send into the year's folder (or find it there); its path. */
  pobierzUpoCit: (id: number, refId: string) => Promise<{ filePath: string }>;
  /** Settle a send by its `at`: an uncertain one did not / did reach the gateway, or a stuck one is given up; the return as it now is. */
  rozstrzygnijWysylkeCit: (id: number, at: string, jak: 'nie_dotarla' | 'dotarla' | 'porzucona') => Promise<PodatekCit>;
  /** What the 30-second UPO automat found changed (sends whose status moved); returns the unsubscribe. */
  onCitUpo: (callback: (wynik: PodatkiCitUpoResult) => void) => () => void;
  /** Stop the signing run after the return in hand. */
  przerwijPodpisCit: () => Promise<boolean>;
  /** Progress of the signing run; returns the unsubscribe. */
  onPodatkiCitPodpisPostep: (callback: (postep: PodatkiPodpisPostep) => void) => () => void;
  /** The CIT dictionary — the built-in one until someone saves changes. */
  getPodatkiCitUstawienia: () => Promise<PodatkiCitUstawienia>;
  setPodatkiCitUstawienia: (ustawienia: PodatkiCitUstawienia) => Promise<PodatkiCitUstawienia>;
  /** Ask the AI to sort statement rows; one suggestion per row it could place. Rejects when the AI is not set up. */
  /** `przyklady`: the dictionary the model follows — `[]` for none, the saved one when left out. */
  klasyfikujCitAi: (pozycje: CitAiPozycja[], przyklady?: CitAiPrzyklad[]) => Promise<CitAiWynik>;
  /** Every income and cost row name of the statement library, grouped — for the dictionary review. */
  przegladPozycjiCit: () => Promise<CitPrzegladPozycja[]>;

  // Podatki — PIT (PIT-11, PIT-4R)
  /** Every year's PIT data of the Podatki module — one row per community and year. */
  getPodatkiPit: () => Promise<PodatekPit[]>;
  /** Refused when the community (NIP) already has a PIT that year. */
  addPodatekPit: (nip: string, rok: number, dane: PitDane) => Promise<PodatekPit>;
  /** Save an edited community; what was filed and downloaded is kept from the stored row. */
  setPodatekPit: (id: number, nip: string, dane: PitDane) => Promise<PodatekPit>;
  deletePodatekPit: (id: number) => Promise<boolean>;
  /** Draft `naRok` from `zRoku` for the communities it lacks (same people, empty amounts); how many were added. */
  przeniesPitNaRok: (zRoku: number, naRok: number) => Promise<number>;
  /** Pick a folder of e-Deklaracje XML files (PIT-11, PIT-4R) and add what they say to the year; null when cancelled. */
  importPitXml: (rok: number) => Promise<PodatkiPitImportResult | null>;
  /** Save the year's Excel template (people, last year's amounts beside empty cells); the file, null when cancelled. */
  pitExcelSzablon: (rok: number) => Promise<{ filePath: string } | null>;
  /** Pick the filled Excel and write its amounts into the year; null when cancelled. */
  pitExcelWczytaj: (rok: number) => Promise<PodatkiPitExcelResult | null>;
  /** Write the XML and / or the PDF of the ticked documents (ids from `dokumentId`) into the year's folder. */
  pitPliki: (rok: number, ids: string[], tryb: 'xml' | 'pdf' | 'oba') => Promise<PodatkiPitPlikiResult>;
  /** Mark documents as filed with the tax office (with the gateway's reference number) or take it off; the rows as they now are. */
  setPitZlozone: (ids: string[], zlozone: boolean, numerRef: string) => Promise<PodatekPit[]>;
  /**
   * Sign the ticked documents' XML (XAdES) with one PIN, plus their PDFs (PAdES when `pdfPodpisany`); with
   * `wyslij` each signed XML then goes to the e-Deklaracje gateway. Rejects only when nothing got signed.
   */
  podpiszPit: (
    rok: number,
    ids: string[],
    wybor: PodpisWybor,
    opcje: { pdfPodpisany: boolean; wyslij?: boolean; potwierdzoneKorekty?: string[] },
  ) => Promise<PodatkiPitPlikiResult>;
  /** Stop the signing run after the document in hand. */
  przerwijPodpisPit: () => Promise<boolean>;
  /** Progress of the signing run; returns the unsubscribe. */
  onPodatkiPitPostep: (callback: (postep: PodatkiPitPostep) => void) => () => void;
  /** Ask the gateway about the year's waiting sends (or those of the rows of the given documents). */
  sprawdzUpoPit: (rok: number, ids?: string[]) => Promise<PodatkiPitUpoResult>;
  /** The UPO kept on a send, written next to the document's files; its path. */
  pobierzUpoPit: (dokumentId: string, refId: string) => Promise<{ filePath: string }>;
  /** A person settles a send the app could not; the row as it now is. */
  rozstrzygnijWysylkePit: (dokumentId: string, at: string, jak: 'nie_dotarla' | 'dotarla' | 'porzucona') => Promise<PodatekPit>;
  /** UPOs the background automat received. */
  onPitUpo: (callback: (wynik: PodatkiPitUpoResult) => void) => () => void;

  // Podatki — ZUS (register, registrations, DRA + RCA + RSA)
  /** The whole ZUS register, every monthly set and every send to ZUS. */
  getPodatkiZus: () => Promise<{ platnicy: PodatekZusPlatnik[]; rozliczenia: PodatekZusRozliczenie[]; wysylki: ZusWysylka[] }>;
  /** Refused when the NIP is already in the register. */
  addPodatekZus: (nip: string, dane: ZusPlatnikDane) => Promise<PodatekZusPlatnik>;
  /** Save an edited payer; the "sent" marks and downloads are kept from the stored row. */
  setPodatekZus: (id: number, dane: ZusPlatnikDane) => Promise<PodatekZusPlatnik>;
  /** The payer and all its monthly sets. */
  deletePodatekZus: (id: number) => Promise<boolean>;
  addZusRozliczenie: (nip: string, okres: string, identyfikator: number, dane: ZusRozliczenieDane) => Promise<PodatekZusRozliczenie>;
  /** Save an edited month; its "sent" mark and downloads are kept from the stored row. */
  setZusRozliczenie: (id: number, dane: ZusRozliczenieDane) => Promise<PodatekZusRozliczenie>;
  deleteZusRozliczenie: (id: number) => Promise<boolean>;
  /** A set for every payer (or the given NIPs) with a title in force in the month and none yet; how many were made. */
  przygotujZus: (okres: string, nips?: string[]) => Promise<number>;
  /** A correction (next identifier) of a sent set. */
  korektaZus: (rozliczenieId: number) => Promise<PodatekZusRozliczenie>;
  /** Pick Płatnik's KEDU files and merge them into the register; null when cancelled. */
  importZusKedu: () => Promise<PodatkiZusImportResult | null>;
  /** Write the KEDU and / or the printout of the ticked documents into the month's folder. */
  zusPliki: (okres: string, ids: string[], opcje: PodatkiZusPlikiOpcje) => Promise<PodatkiZusPlikiResult>;
  /** Mark documents as sent to ZUS or take it off; the rows as they now are. */
  setZusWyslane: (ids: string[], wyslane: boolean) => Promise<{ platnicy: PodatekZusPlatnik[]; rozliczenia: PodatekZusRozliczenie[] }>;
  /**
   * Sign the ticked documents with one PIN and send each to ZUS (EWD, the service of Settings → Administracja).
   * Rejects only when nothing was signed (wrong PIN, no card) — the window then asks again.
   */
  wyslijZus: (okres: string, ids: string[], wybor: PodpisWybor) => Promise<PodatkiZusWyslijResult>;
  /** Stop a send run after the document in hand. */
  przerwijWysylkeZus: () => Promise<boolean>;
  onZusPostep: (callback: (postep: PodatkiPodpisPostep) => void) => () => void;
  /** Ask ZUS for the confirmations of the given sends (or of every one waiting). */
  sprawdzPotwierdzeniaZus: (wysylkaIds?: number[]) => Promise<PodatkiZusPotwierdzeniaResult>;
  /** The confirmation kept on a send, written into the month's folder; its path. */
  pobierzPotwierdzenieZus: (wysylkaId: number) => Promise<{ filePath: string }>;
  /** A person settles a send the app could not; the send as it now is. */
  rozstrzygnijWysylkeZus: (wysylkaId: number, jak: 'nie_dotarla' | 'dotarla' | 'porzucona') => Promise<ZusWysylka>;
  /** Confirmations the background automat received. */
  onZusPotwierdzenie: (callback: (wynik: PodatkiZusPotwierdzeniaResult) => void) => () => void;
  /** CheckTransmision on the service of the switch; the service it reached. */
  sprawdzPolaczenieZus: () => Promise<ZusSrodowisko>;

  // Podpis kwalifikowany (karta Szafir)
  /** The signing library in use and every reader with its card and certificates — read fresh each call. */
  getPodpisKarta: () => Promise<PodpisKartaStan>;
  /** Pick the card's PKCS#11 library by hand; null when cancelled. */
  wskazPodpisBiblioteke: () => Promise<PodpisKartaStan | null>;
  /** Forget the picked library — look for it next to Szafir again. */
  resetPodpisBiblioteke: () => Promise<PodpisKartaStan>;
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
  /** `expectedUpdatedAt`: the meeting's `updatedAt` as loaded; a meeting saved since by somebody else is refused. */
  updateSpotkanie: (id: number, input: SpotkanieInput, expectedUpdatedAt?: string | null) => Promise<Spotkanie>;
  deleteSpotkanie: (id: number) => Promise<boolean>;
  /** "I have seen that this moved" — stops the meeting being marked as changed. */
  ackSpotkanieTermin: (id: number) => Promise<boolean>;
  setSpotkanieTerminStatus: (id: number, status: SpotkanieTerminStatus) => Promise<boolean>;
  /** Tick or untick "documents sent", with a note of what went out. */
  /** Move the materials status; who and when come from the session. */
  setSpotkanieMaterialy: (id: number, status: SpotkanieMaterialyStatus) => Promise<boolean>;
  /** Every Mailing send triggered from a meeting, newest first. */
  getSpotkaniaMailingi: () => Promise<SpotkanieMailing[]>;

  // Zadania — tablica Kanban
  getZadania: () => Promise<Zadanie[]>;
  /** `createdBy` is filled in by the main process from the session. */
  addZadanie: (input: ZadanieInput) => Promise<Zadanie>;
  /**
   * The form's full save. Refused with `ZADANIE_CONFLICT_MESSAGE` when the card
   * changed after `input.expectedUpdatedAt`; deletes from storage only the files
   * in `input.removedAttachments`. Returns the card as saved.
   */
  updateZadanie: (id: number, input: ZadanieInput) => Promise<Zadanie>;
  /** A quick edit on the board: writes only the fields given. Returns the card as it now is. */
  patchZadanie: (id: number, patch: ZadaniePatch) => Promise<Zadanie>;
  /**
   * Put a card in a column: its status, and the order of that whole column
   * (`orderedIds`, top first). Reordering touches neither `updatedAt` nor
   * `updatedBy`, so it never counts as a change to notify about. Returns the
   * card's new `updatedAt` when the column changed (null when only the order did).
   */
  moveZadanie: (id: number, status: ZadanieStatus, orderedIds: number[]) => Promise<string | null>;
  deleteZadanie: (id: number) => Promise<boolean>;
  /** Hide a card from the board (kept in the archive) or bring it back. Returns the card as it now is. */
  archiveZadanie: (id: number, archived: boolean) => Promise<Zadanie>;
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
  /**
   * Folder dialog, then every file of the card into it (an existing name gets a
   * suffix, nothing is overwritten). null = the dialog was cancelled.
   */
  zadaniaDownloadAllAttachments: (
    zalaczniki: { sciezka: string; nazwa: string }[],
  ) => Promise<{ folder: string; saved: number; failed: string[] } | null>;
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
  /** `mentions`: mailboxes tagged with @ in the note. */
  setKsiegowaniePriorytetNotatka: (id: number, notatka: string, mentions: string[]) => Promise<boolean>;
  removeKsiegowaniePriorytet: (id: number) => Promise<boolean>;
  /** Rewrite the month's queue to this order (ids of that month's priorities). */
  reorderKsiegowaniaPriorytety: (monthKey: string, orderedIds: number[]) => Promise<boolean>;
  /** Open and resolved alike; the callers split them. */
  getKsiegowaniaUwagi: () => Promise<KsiegowanieUwaga[]>;
  addKsiegowanieUwaga: (
    adresId: number | null,
    adresNazwa: string,
    tresc: string,
    mentions: string[],
  ) => Promise<KsiegowanieUwaga>;
  updateKsiegowanieUwaga: (id: number, tresc: string, mentions: string[]) => Promise<boolean>;
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
  /** The newest release's installer (.exe / .dmg) saved to Downloads — never installs it. */
  downloadInstaller: () => Promise<
    | { success: true; filePath: string; fileName: string; version: string; alreadyDownloaded: boolean }
    | { success: false; error: string; unsupported?: boolean }
  >;
  /** Whole percents of a running downloadInstaller(). */
  onInstallerDownloadProgress: (callback: (percent: number) => void) => () => void;
  openLogsFolder: () => Promise<{ success: boolean; logPath?: string }>;
  onUpdateAvailable: (callback: (info: any) => void) => () => void;
  onUpdateDownloaded: (callback: (info: any) => void) => () => void;
  onUpdateError: (callback: (error: string) => void) => () => void;
  onDownloadProgress: (callback: (progress: any) => void) => () => void;
  onConversionProgress: (callback: (progress: ConversionProgressEvent) => void) => () => void;
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
  onBackupCreated: (callback: (info: { filePath: string; date: string; upload: 'uploaded' | 'failed' | 'disabled'; trigger: 'startup' | 'scheduled' | 'quit' }) => void) => () => void;
  // E-perf
  /** One meeting, or null when it is gone. */
  getSpotkanie: (id: number) => Promise<Spotkanie | null>;
  /** Every Zebrania entry with its newest version's status and ready marks — no statement or plan JSON. */
  getZebraniaStatus: () => Promise<ZebranieStatusRow[]>;
  /** One Zebrania entry with its versions, read now (never cached) — or null when it is gone. */
  getZebranie: (id: number) => Promise<Zebranie | null>;
  /** One card, read now (never cached) — or null when it is gone. */
  getZadanie: (id: number) => Promise<Zadanie | null>;
  /**
   * Drop the main process's cached lists (meetings, entries, cards, people,
   * dictionaries), so the next reads fetch the tables as they are now. For a
   * refresh asked for by hand: other people's changes otherwise show within a
   * minute.
   */
  invalidateDataCache: () => Promise<boolean>;
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
