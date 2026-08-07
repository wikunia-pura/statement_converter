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

/**
 * A globally-configured "account type" that maps a community bank account to a
 * pair of accounting symbols used when generating the accounting file:
 *   - `bankAccountSymbol` — the community's own bank-account side (e.g. `131-1`,
 *     `142-2`), replacing the previously hardcoded `131-1`.
 *   - `apartmentPrefix` — the prefix for per-apartment accounts (e.g. `204` for
 *     `131-1`, `205` for `142-2`), replacing the previously hardcoded `204`.
 * Each account number added to an Adres references one KontoTyp; the type of the
 * account matched during conversion selects which symbols the exporter emits.
 */
export interface KontoTyp {
  id: number;
  name: string;
  bankAccountSymbol: string;
  apartmentPrefix: string;
  /** Exactly one KontoTyp is the default, used when an account has no explicit type. */
  isDefault: boolean;
  createdAt: string;
}

/** The accounting symbols an exporter needs for one conversion. */
export interface AccountConfig {
  bankAccountSymbol: string;
  apartmentPrefix: string;
}

/** Fallback symbols matching the historical hardcoded behavior (no configured types). */
export const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  bankAccountSymbol: '131-1',
  apartmentPrefix: '204',
};

export interface Kontrahent {
  id: number;
  nazwa: string;
  kontoKontrahenta: string;
  nip?: string;
  /**
   * One or more roles a contractor plays. A company can be several at once
   * (e.g. a `Kontrahent` we pay for electricity that also issues `Pozostałe
   * przychody` refunds). The matcher intersects these with the direction-allowed
   * types, so each transaction side (income/expense) draws only from the pool it
   * should. Never empty — defaults to `['Kontrahent']`.
   */
  typy: KontrahentTyp[];
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
  /** Maps a canonical account number (from `accountNumbers`) to a KontoTyp id. Missing entry ⇒ default type. */
  accountTypes?: Record<string, number>;
  /** Optional link to a Bank. When set, the converter only shows this address for files whose bank matches; null/undefined ⇒ address is available for all banks. */
  bankId?: number | null;
  /** User-defined rules mapping recurring "weird" payments to apartment numbers. */
  apartmentMappings?: ApartmentMapping[];
  /** City unit ("jednostka ZGN") notified by the Mailing module when this community's rates change. Null ⇒ the address can't be mailed until one is picked. */
  zgnJednostkaId?: number | null;
  createdAt: string;
}

/**
 * A city unit that must be told when a housing community changes its monthly-fee
 * rates. One unit serves many communities, so it lives in its own dictionary and
 * every Adres references at most one of them.
 */
export interface ZgnJednostka {
  id: number;
  nazwa: string;
  email: string;
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
  /** Chosen KontoTyp id for this file's conversion. Defaults from the matched detected account's type; falls back to the default type. */
  accountTypeId?: number | null;
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

/* ---------------- Odczyty liczników — operation history ---------------- */

export type OdczytySkipReason = 'no-device' | 'no-value' | 'no-wm' | 'no-date';

/** A source row that produced no reading, with everything needed to find it. */
export interface OdczytySkippedRow {
  /** Row number exactly as Excel shows it in the row gutter. */
  row: number;
  sheet: string;
  reason: OdczytySkipReason;
  /** Header of the column we read and found unusable, e.g. "30.06.2026". */
  column: string;
  deviceNumber: string;
  wm: string;
  context: { label: string; value: string }[];
  /** Newest older month that does hold a value, when there is one. */
  fallback?: { column: string; value: string };
}

/** One supplier workbook that fed an operation. */
export interface OdczytyHistorySource {
  fileName: string;
  filePath: string;
  supplierLabel: string | null;
  readingCount: number;
  skippedCount: number;
  skipped: OdczytySkippedRow[];
  error?: string;
}

/** One generated IMPEX file. */
export interface OdczytyHistoryOutput {
  wm: string;
  fileName: string;
  outputPath: string;
  date: string;
  readingCount: number;
}

/**
 * One "Konwertuj" click. A single operation may read several workbooks and emit
 * one file per housing community, so both sides are kept as lists.
 */
export interface OdczytyHistoryEntry {
  id: number;
  /** Supplier label, or "A + B" when one operation mixed several. */
  supplier: string;
  status: 'success' | 'error';
  errorMessage?: string;
  outputDir: string;
  sources: OdczytyHistorySource[];
  outputs: OdczytyHistoryOutput[];
  readingCount: number;
  skippedCount: number;
  convertedAt: string;
}

/* ----------------------- Mailing (rate-change mails) ----------------------- */

/**
 * Kind of mailing being sent. Drives which recipient the app resolves and which
 * templates it offers; only one kind exists so far.
 */
export type MailingTyp = 'zgn-zaliczki';

/**
 * A user-defined dynamic field usable in a subject or body as `{{nazwa}}`.
 * `tekst` is the fixed lead-in ("Zmianie uległa zaliczka na fundusz remontowy w
 * kwocie:"); the value completing it is typed once per send, so the same field
 * serves every month. Built-in fields (community address, today's date) are not
 * stored here — see `BUILTIN_MAILING_FIELDS` in shared/mailing-template.
 */
export interface MailingPole {
  id: number;
  nazwa: string;
  tekst: string;
  createdAt: string;
}

/** A reusable message: subject + body, both with `{{field}}` placeholders. */
export interface MailingSzablon {
  id: number;
  nazwa: string;
  typ: MailingTyp;
  temat: string;
  /** Body as HTML (authored in the rich-text editor). */
  tresc: string;
  /** Template default for "also attach the body as a PDF"; overridable per send. */
  attachPdf: boolean;
  createdAt: string;
}

/** One field as it was resolved for a send — kept verbatim in the history. */
export interface MailingFieldValue {
  nazwa: string;
  tekst: string;
  wartosc: string;
}

export interface MailingAttachment {
  fileName: string;
  filePath: string;
  /** 'pdf' = generated from the body; 'custom' = a file the user attached. */
  kind: 'pdf' | 'custom';
}

/**
 * One (send, community) pair. Every selected address produces its own mail — the
 * body carries that community's address — so it gets its own history row with
 * the subject and body exactly as they went out.
 */
export interface MailingHistoryEntry {
  id: number;
  typ: MailingTyp;
  templateName: string;
  status: 'success' | 'error';
  errorMessage?: string;
  adresId: number | null;
  adresNazwa: string;
  jednostkaNazwa: string;
  jednostkaEmail: string;
  subject: string;
  /**
   * The rendered body as HTML, without the document wrapper and without the
   * letterhead — the logo is ~50 kB of base64 and re-adding it when displaying
   * costs nothing, so it isn't duplicated onto every row.
   */
  bodyHtml: string;
  bodyText: string;
  fieldValues: MailingFieldValue[];
  attachments: MailingAttachment[];
  /** The mailbox the message was sent from. */
  sentFrom: string;
  sentAt: string;
}

/**
 * SMTP credentials for the mailbox the app sends from. Machine-local (never
 * synced, never written to a backup) — see AppSettings.
 */
export interface MailingSmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (port 465). False ⇒ STARTTLS (port 587). */
  secure: boolean;
  user: string;
  /** Display name in the From header; falls back to the user when empty. */
  fromName: string;
  /** Send a copy to the sending mailbox, so a record lands in the inbox. */
  bccSelf: boolean;
}

/** What the UI needs to know about the stored SMTP config (password excluded). */
export interface MailingSmtpStatus extends MailingSmtpConfig {
  /** True when a password is stored on this machine. Never the password itself. */
  passwordSet: boolean;
}

/** Per-community outcome of one send, returned to the UI. */
export interface MailingSendResult {
  adresId: number;
  adresNazwa: string;
  jednostkaNazwa: string;
  jednostkaEmail: string;
  status: 'success' | 'error';
  errorMessage?: string;
  subject: string;
  attachments: MailingAttachment[];
}

/** Progress of a send, streamed to the renderer per community. */
export interface MailingProgressEvent {
  done: number;
  total: number;
  adresNazwa: string;
}

/** Ordering of the contractor pick-lists in the transaction review screen. */
export type ContractorSortOrder = 'name-asc' | 'name-desc' | 'account-asc' | 'account-desc';

export interface AppSettings {
  outputFolder: string;
  impexFolder: string;
  /** Default destination folder for "Scalanie wpłat" merged outputs. Empty string ⇒ ask the user during merge. */
  swrkFolder: string;
  darkMode: boolean;
  language: 'pl' | 'en';
  aiConfidenceThreshold: number; // Minimum confidence to skip AI warning (default: 95)
  /**
   * Run every conversion with AI (default: true). AI only ever sees what the
   * income-contractor match, the extraction cache, regex and the user's mapping
   * rules did not resolve — i.e. exactly the rows that would otherwise land in
   * manual review — so leaving it on is both the cheaper and the faster default.
   * Turn it off only to convert without touching the API (offline, key down, or
   * a deliberately free run).
   */
  alwaysUseAI: boolean;
  skipUserApproval: boolean; // Skip transaction review and generate files directly
  contractorSortOrder: ContractorSortOrder; // Ordering of contractor pick-lists in review (default: name-asc)
  sidebarCollapsed: boolean; // Collapse the navigation sidebar to an icon-only rail (default: true)
  /**
   * Release-notes version this machine has already been shown ('' = never).
   * The "Co nowego" modal opens once whenever the notes are newer than this.
   */
  lastSeenVersion: string;

  /* --- Mailing: SMTP of the mailbox we send from (machine-local) --- */
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  /**
   * SMTP password. Deliberately excluded from backups and from every payload
   * sent to the renderer — `exportSettings`/`exportFullBackup` blank it out and
   * an import never overwrites the locally stored one with an empty value.
   */
  smtpPass: string;
  smtpFromName: string;
  smtpBccSelf: boolean;
}

/**
 * A full snapshot of everything the app persists: the shared Supabase tables
 * (banks, kontrahenci, adresy, konto typy, history) plus this machine's local
 * settings. Written as a single JSON file by manual export and by the daily
 * auto-backup; consumed by the restore flow, which replaces the cloud data
 * wholesale (remapping bank/konto-typ ids referenced from adresy).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ADDING PERSISTED DATA (do this in the SAME change that adds the table)
 * ────────────────────────────────────────────────────────────────────────────
 * A new Supabase table or a new `AppSettings` field is not "done" until it is
 * in the backup — an unbacked table is silently lost on restore, and restore
 * wipes the shared cloud data for EVERY install, so the gap only surfaces when
 * it is already too late. Touch all five places:
 *   1. `BackupData.data` here — new keys are OPTIONAL (`?`), so older backup
 *      files still validate; a missing key must mean "leave the live rows
 *      alone", never "wipe them".
 *   2. `BackupCounts` + `countBackup` below, so the summary names it.
 *   3. `DatabaseService.exportFullBackup` — read the rows.
 *   4. `DatabaseService.importFullBackup` — restore them, in an order that
 *      keeps foreign keys valid (see the insert/remap dance for adresy).
 *   5. `backupCounts` in renderer/translations.ts (pl + en).
 * `AppSettings` needs none of this — it is spread whole — but a secret added
 * there must be blanked in `settingsForExport`, like `smtpPass`.
 *
 * Out of scope on purpose: `app_config` (infrastructure, not user data) and the
 * module files on disk (mailing PDFs, attachment copies) — history entries stay
 * readable without them.
 */
export interface BackupData {
  format: 'filefunky-backup';
  formatVersion: 1;
  appVersion: string;
  createdAt: string;
  data: {
    banks: Bank[];
    kontrahenci: Kontrahent[];
    adresy: Adres[];
    kontoTypy: KontoTyp[];
    history: ConversionHistory[];
    /** Absent in backups written before the meter-readings module existed. */
    odczytyHistory?: OdczytyHistoryEntry[];
    /** Absent in backups written before the Mailing module existed. */
    zgnJednostki?: ZgnJednostka[];
    mailingPola?: MailingPole[];
    mailingSzablony?: MailingSzablon[];
    mailingHistory?: MailingHistoryEntry[];
    /** Never carries `smtpPass` — the SMTP password stays on the machine. */
    settings: AppSettings;
  };
}

/** Row counts of a backup / restore, for user-facing summaries. */
export interface BackupCounts {
  banks: number;
  kontrahenci: number;
  adresy: number;
  kontoTypy: number;
  history: number;
  odczytyHistory: number;
  zgnJednostki: number;
  mailingPola: number;
  mailingSzablony: number;
  mailingHistory: number;
}

export function countBackup(data: BackupData): BackupCounts {
  return {
    banks: data.data.banks.length,
    kontrahenci: data.data.kontrahenci.length,
    adresy: data.data.adresy.length,
    kontoTypy: data.data.kontoTypy.length,
    history: data.data.history.length,
    odczytyHistory: data.data.odczytyHistory?.length ?? 0,
    zgnJednostki: data.data.zgnJednostki?.length ?? 0,
    mailingPola: data.data.mailingPola?.length ?? 0,
    mailingSzablony: data.data.mailingSzablony?.length ?? 0,
    mailingHistory: data.data.mailingHistory?.length ?? 0,
  };
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

  // Konto typy operations (global account-type configuration)
  GET_KONTO_TYPY: 'db:get-konto-typy',
  ADD_KONTO_TYP: 'db:add-konto-typ',
  UPDATE_KONTO_TYP: 'db:update-konto-typ',
  DELETE_KONTO_TYP: 'db:delete-konto-typ',
  IMPORT_KONTO_TYPY_FROM_FILE: 'db:import-konto-typy-from-file',
  EXPORT_KONTO_TYPY_TO_FILE: 'db:export-konto-typy-to-file',

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
  RERUN_EXPENSE_AI: 'files:rerun-expense-ai',
  TOUCH_CONVERSION: 'files:touch-conversion',
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
  SET_ALWAYS_USE_AI: 'settings:set-always-use-ai',
  SET_CONTRACTOR_SORT_ORDER: 'settings:set-contractor-sort-order',
  SET_SIDEBAR_COLLAPSED: 'settings:set-sidebar-collapsed',
  SET_LAST_SEEN_VERSION: 'settings:set-last-seen-version',
  EXPORT_SETTINGS: 'settings:export',
  IMPORT_SETTINGS: 'settings:import',
  
  // History
  GET_HISTORY: 'history:get-all',
  CLEAR_HISTORY: 'history:clear',
  IMPORT_HISTORY_FROM_FILE: 'history:import-from-file',
  EXPORT_HISTORY_TO_FILE: 'history:export-to-file',

  // Backup (full snapshot: Supabase tables + local settings)
  BACKUP_EXPORT: 'backup:export',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_GET_STATUS: 'backup:get-status',
  BACKUP_OPEN_FOLDER: 'backup:open-folder',

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

  // Odczyty liczników (supplier meter-reading workbooks → IMPEX txt)
  ODCZYTY_SELECT_FILES: 'odczyty:select-files',
  ODCZYTY_ANALYZE_FILE: 'odczyty:analyze-file',
  ODCZYTY_SELECT_OUTPUT_DIR: 'odczyty:select-output-dir',
  ODCZYTY_CONVERT: 'odczyty:convert',
  ODCZYTY_GET_HISTORY: 'odczyty:get-history',
  ODCZYTY_CLEAR_HISTORY: 'odczyty:clear-history',

  // Mailing (rate-change notifications to city units)
  MAILING_GET_ZGN: 'mailing:get-zgn',
  MAILING_ADD_ZGN: 'mailing:add-zgn',
  MAILING_UPDATE_ZGN: 'mailing:update-zgn',
  MAILING_DELETE_ZGN: 'mailing:delete-zgn',
  MAILING_GET_POLA: 'mailing:get-pola',
  MAILING_ADD_POLE: 'mailing:add-pole',
  MAILING_UPDATE_POLE: 'mailing:update-pole',
  MAILING_DELETE_POLE: 'mailing:delete-pole',
  MAILING_GET_SZABLONY: 'mailing:get-szablony',
  MAILING_ADD_SZABLON: 'mailing:add-szablon',
  MAILING_UPDATE_SZABLON: 'mailing:update-szablon',
  MAILING_DELETE_SZABLON: 'mailing:delete-szablon',
  MAILING_SELECT_ATTACHMENTS: 'mailing:select-attachments',
  MAILING_SEND: 'mailing:send',
  MAILING_GET_HISTORY: 'mailing:get-history',
  MAILING_CLEAR_HISTORY: 'mailing:clear-history',
  MAILING_GET_FILES_INFO: 'mailing:get-files-info',
  MAILING_CLEANUP_FILES: 'mailing:cleanup-files',
  MAILING_GET_SMTP: 'mailing:get-smtp',
  MAILING_SET_SMTP: 'mailing:set-smtp',
  MAILING_TEST_SMTP: 'mailing:test-smtp',

  // Auth (Supabase-backed)
  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',
  AUTH_GET_SESSION: 'auth:get-session',
} as const;
