// Shared types for the application

import type { NotificationPrefs } from './notifications';

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
  /**
   * Account symbol to book this apartment to, overriding the default
   * `prefix + zero-padded number` rule (e.g. "204-00017A" for apartment 17A).
   *
   * Required for lettered apartments: their numbering convention differs between
   * communities, so the app refuses to invent a symbol and books them only when
   * the user has stated one here or in the review screen.
   */
  kontoLokalu?: string;
  /**
   * Further apartments the same phrase may mean, beyond the primary one above.
   *
   * One payer often owns several apartments in the community and pays for all of
   * them from the same account with the same description, so the phrase alone
   * cannot say which one a given transfer is for. Listing them here keeps the
   * rule honest: the matcher stops guessing and the acceptance screen asks the
   * user to pick from exactly these apartments.
   *
   * Empty/absent ⇒ a single-apartment rule, matched and booked as before. Read
   * it through `mappingTargets()` (shared/apartment-mapping.ts) rather than
   * touching this field directly — the primary apartment is part of the list.
   */
  additionalApartments?: ApartmentMappingTarget[];
  /** Optional human-readable note. */
  note?: string;
}

/** One apartment an ApartmentMapping may point at, with its optional account. */
export interface ApartmentMappingTarget {
  apartmentNumber: string;
  /** Account symbol for this apartment; see ApartmentMapping.kontoLokalu. */
  kontoLokalu?: string;
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
  /** The community's board — added to a meeting when the community is picked there. */
  zarzad?: ZarzadOsoba[];
  createdAt: string;
}

/**
 * Who owns how much of a community — the budget plan's header. Only the city's
 * and the leased ("pożytki") areas are kept: the private part is the rest of
 * the total, which comes from the statement.
 */
export interface AdresUdzialy {
  /** m² owned by M.St. Warszawa. */
  miastoM2: number;
  /** m² of common property let out ("pożytki"). */
  pozytkiM2: number;
}

/**
 * What the Zebrania module remembers about a community, keyed by its NAME (like
 * the dashboard tables) so it survives a backup restore that renumbers `adresy`.
 */
export interface ZebraniaWspolnota {
  adresNazwa: string;
  /**
   * The community's number in vDom ("Nr wsp." on its statement) — how a
   * statement file is matched to it. Set the first time a statement is picked
   * by hand, then used for every later file.
   */
  vdomNr: number | null;
  /** Ownership split the budget plan needs and the statement does not carry. */
  udzialy: AdresUdzialy | null;
  updatedAt: string;
  updatedBy: string;
}

/** One member of a community's board (Adresy → Zarząd). */
export interface ZarzadOsoba {
  /** Stable within the list, so an edit or a delete hits the right person. */
  id: string;
  imieNazwisko: string;
  email: string;
}

/** A board member on a meeting — a snapshot, so it outlives a change to the board. */
export type SpotkanieZarzadOsoba = Pick<ZarzadOsoba, 'imieNazwisko' | 'email'>;

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

/** A person acting for one city unit — managed under that unit in Adresy. */
export interface ZgnPelnomocnik {
  id: number;
  jednostkaId: number;
  imieNazwisko: string;
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
    /** Explicit account symbol from the matching rule's "konto lokalu", when set. */
    accountOverride?: string | null;
    /**
     * True when the recognized apartment number carries a letter (17A) and no
     * account symbol is known for it — the transaction cannot be booked until the
     * user supplies one. Drives the review screen's warning.
     */
    needsAccount?: boolean;
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
  /**
   * Full account symbol typed by the user in the review screen ("Konto lokalu"),
   * used when action is 'manual' for income. Mutually exclusive with
   * manualRemainingIncomeId — it is the way to book a lettered apartment, whose
   * symbol the app must not derive on its own.
   *
   * The one case where it travels together with `manualApartmentNumber` is a pick
   * from a multi-apartment rule: the rule states both, so they cannot disagree —
   * the symbol decides where the money goes, the number keeps the record readable.
   * Typed by hand the two stay mutually exclusive (the UI disables the other field).
   */
  manualApartmentAccount?: string;
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
  /** The attached statement PDF itself, so the review screen can open it. */
  pdfPath?: string;
  /**
   * Apartment-account prefix resolved for this conversion ("204", "205"), taken
   * from the KontoTyp of the community account the file belongs to. The review
   * screen shows it as the fixed part of the "Konto lokalu" field, so the user
   * sees the exact symbol that will land in the accounting file.
   */
  apartmentPrefix?: string;
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
  /**
   * Community the statement was converted for. Recorded since the "Księgowania"
   * view; rows written before it carry null and are attributed from the output
   * filename instead (see shared/bookings.ts). A restore also nulls the id and
   * keeps only the name, so never treat the id as the only link.
   */
  adresId?: number | null;
  adresNazwa?: string | null;
  /**
   * The month the converted statement covers (`YYYY-MM`), read from its
   * transactions when it was converted. Only the dashboard's own records carry
   * it; absent on older rows, which then count in the month of conversion.
   */
  monthKey?: string | null;
  /**
   * SHA-1 of the converted input file — the hash the folder scan keeps in
   * `KsiegowaniePlik.fileHash` — so the conversion stays linked to its pinned
   * statement after the file is renamed or moved. Only the dashboard's own
   * records carry it; absent on older rows, which then link by file name.
   */
  inputHash?: string | null;
  /**
   * Whether the accounting file this conversion produced has been posted in the
   * external "DOM" program. The app cannot see into DOM, so this is the user's
   * own tick — set from the Księgowania view, shared across installs.
   */
  bookedInDom?: boolean;
  /** When the tick was set (ISO). Null whenever `bookedInDom` is false. */
  bookedInDomAt?: string | null;
  /** E-mail of the user who ticked it, so a shared team can tell who posted. */
  bookedInDomBy?: string | null;
  /**
   * Marked as posted without a conversion ("Oznacz jako zaksięgowane") — a
   * fallback for a statement posted some other way. Such a record has no
   * output file; undoing the mark deletes it. Dashboard records only.
   */
  manual?: boolean;
}

/**
 * A community flagged "do this first" on the Księgowania dashboard, for ONE
 * month. The queue is the month's rows ordered by `position`; the number shown
 * to the team (1st, 2nd, 3rd…) is the place in that order, not the stored
 * `position`, which may have gaps after a removal.
 *
 * Belongs to a month on purpose: a priority is a statement about this month's
 * work, and carried over it would pin communities that were finished weeks ago.
 * Like `ConversionHistory`, it keeps the community's NAME beside the id — a
 * restore renumbers the addresses and the name is what survives.
 */
export interface KsiegowaniePriorytet {
  id: number;
  /** `YYYY-MM`, the dashboard's month key. */
  monthKey: string;
  adresId: number | null;
  adresNazwa: string;
  position: number;
  /** Why this one before the others — written for whoever does the posting. */
  notatka: string;
  /**
   * Mailbox of whoever last wrote `notatka` — what lets the notifier skip a
   * note the signed-in person wrote themselves. Absent in backups written before
   * the notifications existed.
   */
  notatkaBy?: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Who posts one community in one month — the dashboard's person picker and its
 * "Kto" filter. No row for a month = unassigned that month.
 */
export interface KsiegowaniePrzypisanie {
  id: number;
  /** `YYYY-MM`, the dashboard's month key. */
  monthKey: string;
  adresId: number | null;
  adresNazwa: string;
  /** The assignee's mailbox. */
  email: string;
  assignedBy: string;
  assignedAt: string;
}

/**
 * A remark about posting one community ("poczekaj na korektę faktury"). Not tied
 * to a month or to a priority: it stays open until someone resolves it, and the
 * Converter warns about it when that community's statement is dropped in.
 */
export interface KsiegowanieUwaga {
  id: number;
  adresId: number | null;
  adresNazwa: string;
  tresc: string;
  createdBy: string;
  createdAt: string;
  /** Null while the matter is open. */
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/**
 * A file the folder scan ("Znajdź pliki księgowe") pinned to a community for
 * one month: a statement to convert, its PDF, or a statement that turned out to
 * be unreadable (`status: 'error'`).
 *
 * The month is the statement's own period, not the day it was found. The path
 * is relative to the statements folder and uses `/`, because the folder is
 * shared and mounted differently on every machine; each install joins it with
 * its own Settings → "Folder z wyciągami".
 *
 * Whether a statement has been converted is not stored: it is read from the
 * dashboard's conversion records (same community and the same content by
 * `fileHash`, or — for conversions that did not record it — the same file name,
 * converted after the file's last change; see `linkConversions`), so a
 * conversion made by dragging the file in by hand counts just the same.
 *
 * Like the other dashboard tables it keeps the community's NAME beside the id:
 * a restore renumbers the addresses and the name is what survives.
 */
export interface KsiegowaniePlik {
  id: number;
  /** `YYYY-MM` the statement covers. */
  monthKey: string;
  kind: 'statement' | 'pdf';
  status: 'ok' | 'error';
  /** What is wrong with an `error` row, written for the user. */
  errorMessage: string | null;
  adresId: number | null;
  adresNazwa: string;
  /** The community account the file is for, 26 digits. */
  accountNumber: string | null;
  /** Account type at the time of the scan ("Eksploatacja"), for display. */
  accountTypeName: string | null;
  /** Bank to convert with — statements only. */
  bankId: number | null;
  bankName: string | null;
  converterId: string | null;
  /** Relative to the statements folder, `/`-separated. */
  relPath: string;
  fileName: string;
  /** A renamed PDF's name as it was found. */
  originalName: string | null;
  fileSize: number;
  /** Last change of the file (ISO) — a conversion older than this is of an older version. */
  fileMtime: string;
  /** SHA-1 of the content: same hash = same file, wherever it lies. */
  fileHash: string;
  /**
   * Newer files the user chose NOT to swap in ("Zostaw obecny"), by hash — so
   * the next scan does not ask about the same file again.
   */
  ignoredHashes: string[];
  /** First and last day the file covers (`YYYY-MM-DD`). */
  periodFrom: string | null;
  periodTo: string | null;
  scannedAt: string;
  scannedBy: string | null;
}

/** A file the scan found, described for the report and the decision dialog. */
export interface ScanFoundFile {
  relPath: string;
  fileName: string;
  kind: 'statement' | 'pdf';
  adresNazwa: string;
  accountNumber: string | null;
  accountTypeName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  fileMtime: string;
  /** A PDF's name before the scan renamed it. */
  originalName?: string | null;
  /** What is wrong with a file pinned as an error. */
  errorMessage?: string | null;
}

/**
 * Why a file the scan looked at could not be pinned to a community. Codes, not
 * sentences, so the report speaks the user's language; `detail` carries what
 * the sentence needs (an account number, a converter, an error).
 */
export type ScanProblem =
  | 'unknown-account'
  | 'no-account'
  | 'ambiguous-account'
  | 'no-period'
  | 'unknown-bank'
  | 'no-bank-row'
  | 'unsupported-format'
  | 'parse-failed'
  | 'pdf-no-text'
  | 'read-failed';

export interface ScanUnrecognized {
  relPath: string;
  fileName: string;
  problem: ScanProblem;
  detail?: string;
  /** The community, when it was recognised and something else failed. */
  adresNazwa?: string;
}

/**
 * A found file that competes with one already pinned: the same account and
 * period (`version` — a newer copy of the same statement), or an overlapping
 * period (`overlap`). The user decides; nothing is replaced on its own.
 */
export interface ScanConflict {
  id: string;
  kind: 'version' | 'overlap';
  existing: KsiegowaniePlik;
  found: ScanFoundFile;
  /** The pinned statement was already converted (not yet ticked in DOM): replacing it outdates that accounting file. */
  existingConverted: boolean;
}

export type ScanDecision = 'replace' | 'keep' | 'add';

export interface ScanReport {
  monthKey: string;
  /** Files looked at (after skipping the ones too old to be this month's). */
  examined: number;
  added: ScanFoundFile[];
  /** Pinned before and unchanged. */
  unchanged: number;
  /** Same content as a pinned file, lying elsewhere — left alone. */
  duplicates: number;
  /** Newer files for statements already ticked in DOM — not offered. */
  skippedBooked: number;
  conflicts: ScanConflict[];
  /** Statements of a recognised community that could not be read — pinned as errors. */
  errors: ScanFoundFile[];
  unrecognized: ScanUnrecognized[];
  /** PDFs pinned under their old name because renaming failed. */
  renameFailures: { relPath: string; message: string }[];
}

export interface ScanProgress {
  phase: 'walk' | 'read';
  done: number;
  total: number;
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
 * Kind of mailing being sent — the stable `klucz` of a `MailingTypDef`. Drives
 * which templates are offered and who the mail goes to by default.
 *
 * A string rather than a union: the kinds are a dictionary the office defines
 * (Mailing → Typy mailingu). Templates and history rows store the key, not the
 * row id, so a restore — which renumbers every row — leaves them pointing at the
 * same kind, and renaming a kind never rewrites what a sent letter was filed as.
 */
export type MailingTyp = string;

/** The key every template and history row had before kinds were definable. */
export const MAILING_TYP_ZGN = 'zgn-zaliczki';
/**
 * The one built-in kind: a meeting notice. Fixed in code because the Kalendarz
 * and Zebrania flows look templates up by it — it cannot be deleted or renamed,
 * only its default recipients can be changed.
 */
export const MAILING_TYP_ZAWIADOMIENIE = 'zawiadomienie-o-zebraniu';
export const MAILING_TYP_ZAWIADOMIENIE_NAZWA = 'Zawiadomienie o zebraniu';

/**
 * Who a mailing goes to, per community. Every enabled group is resolved for each
 * community in the send and the addresses are merged (deduplicated by mailbox)
 * into one message:
 *
 *   `zgn`         — the community's city unit (the original and only recipient
 *                   before kinds existed),
 *   `pelnomocnik` — that unit's proxies; from a meeting, the proxy the meeting
 *                   names (or every proxy of the unit when it names none),
 *   `zarzad`      — the community's board members with a mailbox; from a
 *                   meeting, the board members on the meeting,
 *   `wlasne`      — fixed addresses typed by the user.
 *
 * The kind holds the default; the send screen can change it for one send.
 */
export interface MailingAdresaci {
  zgn: boolean;
  pelnomocnik: boolean;
  zarzad: boolean;
  wlasne: string[];
}

export const DEFAULT_MAILING_ADRESACI: MailingAdresaci = {
  zgn: true,
  pelnomocnik: false,
  zarzad: false,
  wlasne: [],
};

/** Which group a resolved recipient came from — kept on the history row. */
export type MailingOdbiorcaRodzaj = 'zgn' | 'pelnomocnik' | 'zarzad' | 'wlasne';

/** One resolved recipient of one community's mail. */
export interface MailingOdbiorca {
  rodzaj: MailingOdbiorcaRodzaj;
  /** Unit name, person's name — empty for a bare custom address. */
  nazwa: string;
  email: string;
}

/** A kind of mailing, as defined in Mailing → Typy mailingu. */
export interface MailingTypDef {
  id: number;
  /** Stable key stored on templates and history rows — never changes. */
  klucz: MailingTyp;
  nazwa: string;
  opis: string;
  /** True for the built-in meeting notice: not deletable, not renamable. */
  systemowy: boolean;
  adresaci: MailingAdresaci;
  createdAt: string;
}

/**
 * Kind of value a dynamic field takes. `tekst` is the original behaviour and the
 * default — anything typed goes out verbatim; `data` and `godzina` swap the
 * send screen's box for a picker and fix the spelling of what it produces.
 */
export type MailingPoleTyp = 'tekst' | 'data' | 'godzina';

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
  /**
   * How the value completing this field is entered and written out:
   * free text, a date (picked at send time, rendered dd.mm.rrrr) or a time
   * (rendered gg:mm). The dictionary decides it once, so a letter announcing a
   * meeting cannot go out with the date spelled three different ways.
   */
  typWartosci: MailingPoleTyp;
  /**
   * Unit written after the typed value ("zł/m²", "%", "zł") — the half of the
   * amount that never changes between sends, so it belongs to the field rather
   * than being retyped with every value. Empty ⇒ the value stands alone.
   *
   * Nothing to do with `ZgnJednostka`, the city unit a mail is addressed to.
   */
  jednostka: string;
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
  /**
   * Dynamic fields this template offers for its `{{Tabela pól}}` table, in row
   * order — the shortlist, not the choice. The dictionary can hold dozens of
   * fields while one letter concerns five of them; the send screen then ticks
   * which of these five actually go out and types their values.
   *
   * Names, not ids: a placeholder in the body already refers to a field by name,
   * and matching stays case- and whitespace-insensitive throughout.
   */
  tableFields: string[];
  createdAt: string;
}

/** One field as it was resolved for a send — kept verbatim in the history. */
export interface MailingFieldValue {
  nazwa: string;
  tekst: string;
  /** The typed value alone, without the unit — see `jednostka`. */
  wartosc: string;
  /**
   * The field's unit at send time. Absent in rows written before units existed,
   * and kept per row rather than read back from the dictionary: renaming a
   * field's unit must not rewrite what an already sent letter said.
   */
  jednostka?: string;
  /** The field's kind at send time — same reasoning as `jednostka`. */
  typWartosci?: MailingPoleTyp;
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
  /** The meeting this send was triggered from, when it was. */
  spotkanieId?: number | null;
  /**
   * Everyone this mail was addressed to. `jednostkaNazwa`/`jednostkaEmail` still
   * carry a readable summary (names / mailboxes joined with ", ") so old screens
   * and old rows read the same; absent in rows written before kinds had
   * recipients — those went to the unit in `jednostkaEmail` alone.
   */
  odbiorcy?: MailingOdbiorca[];
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
  odbiorcy?: MailingOdbiorca[];
}

/**
 * Values the Kalendarz hands a letter — what the "… z kalendarza" fields and
 * "Adres zebrania" resolve to. Already spelled for the letter (dd.mm.rrrr, gg:mm)
 * so the preview, the PDF, the .eml and the sent mail cannot disagree. Built by
 * `buildKalendarzContext` in shared/mailing-template; every part may be empty
 * (a meeting with no location), and an empty part is then typed by hand.
 */
export interface MailingKalendarzContext {
  dataText: string;
  godzinaText: string;
  adresWspolnoty: string;
  adresZebrania: string;
}

/** What a letter is rendered for, beyond its text and the typed values. */
export interface MailingRecipientSource {
  /** Community the letter is about; null for a letter about none (custom addresses only). */
  adresId: number | null;
  /** The meeting it came from — its proxy and board members replace the community's. */
  spotkanieId?: number | null;
}

/**
 * "Pobierz jako e-mail / PDF": render one letter and save it to the user's
 * Downloads folder. Same rendering as a send; nothing goes over SMTP and nothing
 * is written to the mailing history.
 */
export interface MailingExportRequest {
  typ: MailingTyp;
  /** For the file name; the text below is the authority, as in a send. */
  templateName: string;
  temat: string;
  tresc: string;
  values: Record<string, string>;
  tableFields?: string[];
  kalendarz?: MailingKalendarzContext | null;
  /** Community the letter is about — substitutes `{{Adres Wspólnoty}}` and picks recipients. */
  adresId: number | null;
  /** Used when `adresId` is null or no longer resolves (a standalone Zebranie). */
  adresNazwa?: string;
  spotkanieId?: number | null;
  adresaci: MailingAdresaci;
  /** Mailboxes (lower-cased) unticked for this letter. */
  wykluczeni?: string[];
  formats: ('pdf' | 'eml')[];
  /** Attach the letter as a PDF inside the .eml. Defaults to true. */
  attachPdf?: boolean;
}

export interface MailingExportResult {
  /** Absolute paths of the files written, in `formats` order. */
  files: { format: 'pdf' | 'eml'; filePath: string }[];
  /** Recipients written into the .eml's To header. */
  odbiorcy: MailingOdbiorca[];
}

/** Progress of a send, streamed to the renderer per community. */
export interface MailingProgressEvent {
  done: number;
  total: number;
  adresNazwa: string;
}

/* --------------------------- Kalendarz (spotkania) --------------------------- */

/**
 * An application account, as offered by the participant picker.
 *
 * Mirrored out of Supabase's `auth` schema into `public.app_users` by a trigger:
 * the publishable key cannot read `auth.users` (and must not be able to), so the
 * mirror is what the app sees — id, mailbox, display name, nothing else.
 */
export interface AppUser {
  id: string;
  email: string;
  /** From the account's metadata; most accounts are created without one. */
  displayName?: string | null;
  /**
   * The app's own name for the person, typed in Ustawienia → Użytkownicy.
   * Separate from `displayName` because the auth trigger owns that one and
   * overwrites it from the account metadata — see supabase/schema.sql.
   */
  firstName?: string | null;
  lastName?: string | null;
  /** `#rrggbb` chosen in Ustawienia → Użytkownicy; null = derived from the mailbox. */
  color?: string | null;
  createdAt: string;
}

/**
 * A person's name — and the colour chosen for them — as they travel in a backup:
 * keyed by mailbox, never by id.
 *
 * The rows of `app_users` themselves are not restorable — a trigger owns them,
 * mirroring the Supabase accounts — but the names ARE authored in this app and
 * cannot be rebuilt from anything. So a restore carries them across and applies
 * them to whichever live account has that mailbox.
 */
/**
 * One person's notification switches (Ustawienia → Powiadomienia), keyed by
 * mailbox like everything else that belongs to a person. Lives in the cloud, so
 * the choice follows the account to any machine.
 */
export interface NotificationPrefsRow {
  email: string;
  prefs: NotificationPrefs;
}

export interface AppUserName {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  /** The colour chosen for the person; absent in backups that predate colours. */
  color?: string | null;
}

/**
 * A kind of meeting, defined by the user inside the calendar module. The colour
 * is part of the type rather than of the meeting: it is what makes a month of
 * meetings scannable, so every type carries one.
 */
export interface SpotkanieTyp {
  id: number;
  nazwa: string;
  /** `#rrggbb`. */
  kolor: string;
  opis: string;
  /**
   * How many days before a meeting of this kind its documents have to be out.
   *
   * A property of the KIND, not of one meeting: a community's annual assembly
   * has a notice period, an internal catch-up has none. Null means this kind
   * has no such rule — the deadline warning, its counter and its filter then
   * do not apply to these meetings at all.
   */
  dniNaDokumenty: number | null;
  createdAt: string;
}

/**
 * One participant, snapshotted from `AppUser` when the meeting is saved — so the
 * attendee list of a past meeting stays readable after an account is removed.
 */
export interface SpotkanieUczestnik {
  userId: string;
  email: string;
  /**
   * The name the person went by when the meeting was saved — their first and
   * last name once someone has been named, the account's own display name
   * before that. A snapshot on purpose: renaming a person later must not
   * rewrite who a past meeting says was in the room.
   */
  displayName?: string | null;
}

/**
 * Where meetings happen — a dictionary the office owns, the same shape as
 * `SpotkanieTyp`. Somewhere a meeting is held is a property of this world (a
 * community's own building, the ZGN office, the accountant's room), not
 * something to retype on every meeting.
 */
export interface SpotkanieLokalizacja {
  id: number;
  nazwa: string;
  /** Street address or "how to get there". Optional; shown under the name. */
  adres: string;
  opis: string;
  createdAt: string;
}

/**
 * Whether the meeting's date is settled or still being agreed.
 *
 * Confirmed is the default: every meeting written before this existed meant a
 * real date, and a tentative one is the deliberate exception.
 */
export type SpotkanieTerminStatus = 'potwierdzony' | 'wstepny';

/**
 * Materials for a meeting, handled like its documents. `brak`: none needed (the
 * form's "materials needed" unticked). `potrzebne`: needed, nothing marked yet —
 * where a meeting created in the app starts. Then the three steps the card's
 * buttons mark, each announced to everyone: ready to be prepared, prepared, sent.
 */
export type SpotkanieMaterialyStatus =
  | 'brak'
  | 'potrzebne'
  | 'do_przygotowania'
  | 'przygotowane'
  | 'wyslane';
export const SPOTKANIE_MATERIALY_STATUSES: readonly SpotkanieMaterialyStatus[] = [
  'brak',
  'potrzebne',
  'do_przygotowania',
  'przygotowane',
  'wyslane',
];
/** The step before each one — what "Cofnij" on the card goes back to. */
export const SPOTKANIE_MATERIALY_POPRZEDNI: Partial<
  Record<SpotkanieMaterialyStatus, SpotkanieMaterialyStatus>
> = {
  do_przygotowania: 'potrzebne',
  przygotowane: 'do_przygotowania',
  wyslane: 'przygotowane',
};

/** The three steps that are marked on the card — and notified. */
export type SpotkanieMaterialyKrok = 'do_przygotowania' | 'przygotowane' | 'wyslane';
export const SPOTKANIE_MATERIALY_KROKI: readonly SpotkanieMaterialyKrok[] = [
  'do_przygotowania',
  'przygotowane',
  'wyslane',
];

export interface Spotkanie {
  id: number;
  nazwa: string;
  /** Null once the type has been deleted; the meeting itself survives. */
  typId: number | null;
  /** Null when no community is attached, or once it has been deleted. */
  adresId: number | null;
  /** Kept alongside the id: a restore renumbers `adresy`, the name does not. */
  adresNazwa: string;
  /** Null when no location is attached, or once it has been deleted. */
  lokalizacjaId: number | null;
  /** Same reason as `adresNazwa`: the name is what survives a restore. */
  lokalizacjaNazwa: string;
  /** ISO instant. Date and time are one value — a meeting has both. */
  startsAt: string;
  /** ISO instant, or null for a meeting with no stated end. */
  endsAt: string | null;
  opis: string;
  uczestnicy: SpotkanieUczestnik[];
  terminStatus: SpotkanieTerminStatus;
  /**
   * The trail a moved date leaves. Set by the server when an edit actually
   * changes the start or the end — a meeting whose date moves is the one thing
   * in this module somebody has to be TOLD about, because everyone has already
   * written the old date down.
   *
   * `terminZmianaOdczytanaAt` is the acknowledgement: once a person says they
   * have seen it, the meeting goes back to looking ordinary and the record
   * stays readable in its details. Null everywhere ⇒ the date has not moved
   * since the meeting was created.
   */
  terminZmienionyAt: string | null;
  /** The start the meeting had before the last move. */
  terminZmienionyZ: string | null;
  terminZmienionyBy: string | null;
  terminZmianaOdczytanaAt: string | null;
  terminZmianaOdczytanaBy: string | null;
  /** Set when someone ticks "documents sent" by hand. */
  dokumentyWyslaneAt: string | null;
  dokumentyWyslaneBy: string | null;
  /** What was sent, in the sender's own words. */
  dokumentyOpis: string;
  /**
   * The city unit the meeting is with, or — with `zgnPelnomocnikId` set too —
   * one of that unit's proxies. Null when none. `zgnNazwa` is what the meeting
   * shows ("Jan Kowalski (ZGN Wola)" for a proxy), kept so a deleted unit or a
   * restore leaves the meeting readable. All absent in older rows and backups.
   */
  zgnJednostkaId: number | null;
  zgnPelnomocnikId: number | null;
  zgnNazwa: string;
  /**
   * The community's board members the meeting is with, filled in from the
   * community when it is picked and editable in the form. Absent in older rows
   * and backups — read as none.
   */
  zarzad: SpotkanieZarzadOsoba[];
  /** Absent in rows and backups written before the column existed — read as `brak`. */
  materialyStatus: SpotkanieMaterialyStatus;
  /** Who last moved the materials status, and when; null until somebody does. */
  materialyZmienioneAt: string | null;
  materialyZmienioneBy: string | null;
  /** E-mail of whoever created the meeting. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the add/edit form submits: a meeting minus everything the server owns.
 *
 * The date-change trail and the documents fields are excluded on purpose — they
 * are recorded by the actions that cause them (an edit that moves the date, a
 * tick on the meeting), never typed into the form.
 */
export type SpotkanieInput = Omit<
  Spotkanie,
  | 'id'
  | 'createdBy'
  | 'createdAt'
  | 'updatedAt'
  | 'terminZmienionyAt'
  | 'terminZmienionyZ'
  | 'terminZmienionyBy'
  | 'terminZmianaOdczytanaAt'
  | 'terminZmianaOdczytanaBy'
  | 'dokumentyWyslaneAt'
  | 'dokumentyWyslaneBy'
  | 'dokumentyOpis'
  | 'materialyStatus'
  | 'materialyZmienioneAt'
  | 'materialyZmienioneBy'
>;

/**
 * One Mailing send recorded against a meeting — the slim projection the
 * calendar shows. The full row lives in `mailing_history`, which stays the
 * authority on what actually went out.
 */
export interface SpotkanieMailing {
  id: number;
  spotkanieId: number;
  templateName: string;
  status: 'success' | 'error';
  errorMessage?: string;
  adresNazwa: string;
  jednostkaNazwa: string;
  jednostkaEmail: string;
  subject: string;
  /** File names only — the paths are in the mailing history itself. */
  attachmentNames: string[];
  sentFrom: string;
  sentAt: string;
}

/* ------------------------------- Zebrania -------------------------------- */

/**
 * Status of one version of a meeting's materials. Mirrors the meeting's own
 * materials status (see `zebranieStatusFromMaterialy` / `materialyFromZebranieStatus`
 * in shared/zebrania): the newest version and the meeting always say the same.
 */
export type ZebranieStatus = 'w_przygotowaniu' | 'przygotowane';
export const ZEBRANIE_STATUSES: readonly ZebranieStatus[] = ['w_przygotowaniu', 'przygotowane'];

/** Kind of material a version holds. Only the meeting notice exists so far. */
export type ZebranieMaterialRodzaj = 'zawiadomienie';

/**
 * One prepared document — for now the meeting notice. Self-contained: the text
 * is copied from the template when the material is created and edited here, so
 * changing or deleting the template later never rewrites a prepared letter.
 */
export interface ZebranieMaterial {
  /** Stable within the version (uuid). */
  id: string;
  rodzaj: ZebranieMaterialRodzaj;
  typ: MailingTyp;
  /** Informational: the template the text started from. Null once it is gone. */
  szablonId: number | null;
  szablonNazwa: string;
  temat: string;
  /** Body HTML with `{{field}}` placeholders, as edited for this meeting. */
  tresc: string;
  /** Values typed in the visual editor, keyed by field name. */
  values: Record<string, string>;
  tableFields: string[];
  adresaci: MailingAdresaci;
  /** Mailboxes (lower-cased) unticked for this letter. */
  wykluczeni: string[];
  updatedAt: string;
  updatedBy: string;
  /** Downloads made from it, newest last — a record, not the files themselves. */
  pobrania: { at: string; by: string; pliki: string[] }[];
}

/**
 * One version of a meeting's materials — 1.0 first, then revisions 1.1, 1.2 …
 * after corrections. A new revision starts as a copy of the newest one. Every
 * version stays editable.
 */
export interface ZebranieWersja {
  id: number;
  zebranieId: number;
  major: number;
  minor: number;
  /** The revision's own name ("Po uwagach zarządu"); empty means just "Wersja 1.1". */
  nazwa: string;
  status: ZebranieStatus;
  /** What changed in this revision, in the author's words. */
  opis: string;
  materialy: ZebranieMaterial[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** The financial statement this version presents. */
  sprawozdanie: ZebranieSprawozdanie | null;
  /** The budget plan drafted from it. */
  plan: PlanGospodarczy | null;
}

/**
 * A meeting's materials being prepared ("Zebrania").
 *
 * Linked to a Kalendarz meeting (1:1) or standalone. When linked, the date,
 * community and location are READ FROM THE MEETING through `spotkanieId` — the
 * columns below are then only a fallback snapshot (refreshed when the meeting is
 * deleted, so the entry still says what it was about). When standalone, they
 * are the entry's own data, typed in the Zebrania module.
 */
export interface Zebranie {
  id: number;
  /** Null for a standalone entry, or once the meeting was deleted. */
  spotkanieId: number | null;
  nazwa: string;
  adresId: number | null;
  adresNazwa: string;
  lokalizacjaId: number | null;
  lokalizacjaNazwa: string;
  /** Location's street address, snapshotted alongside its name. */
  lokalizacjaAdres: string;
  startsAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Oldest first; the last one is the current version. Never empty for a saved entry. */
  wersje: ZebranieWersja[];
}

/** What the standalone form edits. A linked entry's data comes from its meeting. */
export type ZebranieInput = Pick<
  Zebranie,
  | 'nazwa'
  | 'adresId'
  | 'adresNazwa'
  | 'lokalizacjaId'
  | 'lokalizacjaNazwa'
  | 'lokalizacjaAdres'
  | 'startsAt'
>;

/** What a version's edit form submits. */
export interface ZebranieWersjaInput {
  opis: string;
  materialy: ZebranieMaterial[];
}

/* ---------------------- Sprawozdania i plany gospodarcze ---------------------- */

/**
 * One row of a statement section: its label and one amount per column (null
 * where the column is empty). `podsumowanie` marks the rows under the section's
 * closing rule — "Razem", "Stan na dzień …", "Wynik finansowy …".
 */
export interface SprawozdanieWiersz {
  nazwa: string;
  kwoty: (number | null)[];
  podsumowanie: boolean;
  /** Printed in bold in vDom — the figures the section ends on. */
  wyroznienie: boolean;
}

/** One numbered section of a statement ("1. Fundusz remontowy", "Informacja o kredytach" …). */
export interface SprawozdanieSekcja {
  tytul: string;
  /** Column headings, left to right ("Przychód", "Koszty"). */
  kolumny: string[];
  wiersze: SprawozdanieWiersz[];
  /** An amount printed on the heading line itself ("4. Środki pieniężne 98.472,96"). */
  kwotaNaglowka: number | null;
}

/**
 * A community's financial statement, read from a vDom "RozliczenieWsp" PDF.
 * Kept as the sections vDom printed rather than a fixed schema: the content
 * changes between communities and years, the layout does not.
 */
export interface Sprawozdanie {
  nrWsp: number | null;
  /** The title as printed: "Wspólnota Mieszkaniowa Kolberga 8". */
  nazwa: string;
  /** ISO dates (YYYY-MM-DD). */
  okresOd: string;
  okresDo: string;
  powierzchnia: number | null;
  powierzchniaCo: number | null;
  sredniaLiczbaOsob: number | null;
  sekcje: SprawozdanieSekcja[];
  /** vDom's print stamp ("2026.10.02 10:43"). */
  wydruk: string;
}

/** A statement in the shared library — every community of every uploaded file. */
export interface SprawozdanieZapisane {
  id: number;
  nrWsp: number | null;
  nazwa: string;
  okresOd: string;
  okresDo: string;
  plikNazwa: string;
  importedAt: string;
  importedBy: string;
  /** Where the row came from — see `SprawozdanieZrodlo`. */
  zrodlo: SprawozdanieZrodlo;
  /** Left out of the list; read one by id. */
  dane?: Sprawozdanie;
}

/**
 * Who put a statement in the library. A file uploaded in Zebrania is the source
 * of truth; the Sprawozdania module only adds what Zebrania does not have, and
 * a Zebrania upload of the same community and period takes such a row over.
 */
export type SprawozdanieZrodlo = 'zebrania' | 'sprawozdania';

/** What one upload did: how many communities it held, and the library rows they became. */
export interface SprawozdaniaImportResult {
  plikNazwa: string;
  zapisane: SprawozdanieZapisane[];
}

/** An upload in the Sprawozdania module: what it added, and what Zebrania already had. */
export interface SprawozdaniaWlasneImportResult extends SprawozdaniaImportResult {
  /** Statements of the file left out because Zebrania has that community and period. */
  pominiete: number;
}

/** "Pobierz PDF" / "Pobierz Excel" of a library statement, outside any meeting. */
export interface SprawozdanieExportRequest {
  sprawozdanieId: number;
  format: ZebranieDokumentFormat;
  /** The PDF opens with its introduction unless this is false. */
  wstep?: boolean;
}

/** A download made from a document — who, when, which files. */
export interface DokumentPobranie {
  at: string;
  by: string;
  pliki: string[];
}

/** The statement attached to one version of a meeting — a snapshot of the library row. */
export interface ZebranieSprawozdanie {
  dane: Sprawozdanie;
  plikNazwa: string;
  /** The library row it was taken from (informational — the row may be replaced later). */
  zrodloId: number | null;
  dodano: string;
  dodal: string;
  pobrania: DokumentPobranie[];
  /** The introduction as edited for this version; null = the one computed from the figures. */
  wstep: SprawozdanieWstepTekst | null;
}

/** The words of a statement's introduction, as someone edited them. The headline figures stay computed. */
export interface SprawozdanieWstepTekst {
  akapit: string;
  uwagi: string[];
}

/** Where a statement row goes in the budget plan. */
export type PlanKategoriaKosztu =
  | 'remonty'
  | 'energia'
  | 'porzadek'
  | 'zarzadzanie'
  | 'zarzad'
  | 'ubezpieczenie'
  | 'pozostale';
export type PlanKategoriaPrzychodu = 'reklamy' | 'pozytki' | 'inne';
/** `zaliczkaA` marks the advance-payment income the current rate is read from; `pomin` leaves a row out. */
export type PlanKategoria = PlanKategoriaKosztu | PlanKategoriaPrzychodu | 'zaliczkaA' | 'pomin';

/** "A statement row whose name contains `wzorzec` goes to `kategoria`." First match wins. */
export interface PlanSlownikRegula {
  id: string;
  wzorzec: string;
  kategoria: PlanKategoria;
}

/** Settings of the Zebrania module, shared by everyone. */
export interface ZebraniaUstawienia {
  slownik: PlanSlownikRegula[];
  /** Default number of the resolution adopting the plan; `{rok}` is the plan's year. */
  uchwalaPlanNr: string;
  /** Planned costs are rounded up to this (zł). */
  zaokraglenie: number;
}

/** One stretch of the year at one advance rate: "I–III at 2,50 zł/m²". */
export interface PlanOkresZaliczki {
  miesiace: number;
  stawka: number;
}

/** A repair paid from the repair fund, typed in by hand. */
export interface PlanRemontFR {
  id: string;
  opis: string;
  kwota: number;
}

/** One statement row that fed a plan category — shown so the number can be checked. */
export interface PlanZrodlo {
  kategoria: PlanKategoria;
  nazwa: string;
  /** The amount for a full year (scaled up when the statement covers less). */
  kwotaRoczna: number;
  /** True when no dictionary rule matched and the row fell to the default category. */
  bezReguly: boolean;
}

/**
 * The budget plan of one meeting version — generated from its statement, then
 * edited. Holds the inputs only; every total and per-m² figure is derived
 * (`planSumy` in shared/plan-gospodarczy), so an edit can never leave a stale sum.
 */
export interface PlanGospodarczy {
  rok: number;
  /** "ul. Kolberga 8 w Warszawie". */
  nieruchomosc: string;
  uchwalaNr: string;
  /** Date of the balances (the statement's end), ISO. */
  stanNaDzien: string;
  powierzchnia: number;
  miastoM2: number;
  pozytkiM2: number;
  /* Część I — zaliczka "A" */
  saldoA: number;
  zaliczkaA: PlanOkresZaliczki[];
  przychody: Record<PlanKategoriaPrzychodu, number>;
  koszty: Record<PlanKategoriaKosztu, number>;
  /** Fill "Remonty bieżące" with whatever balances part I — kept on until the user types a value. */
  remontyDomykaja: boolean;
  /* Część II — zaliczka "B" (fundusz remontowy) */
  saldoB: number;
  zaliczkaB: PlanOkresZaliczki[];
  inneWplywyB: number;
  kredyt: number;
  remontyFR: PlanRemontFR[];
  /* Provenance */
  zrodla: PlanZrodlo[];
  wskaznik: number;
  sprawozdanieOkres: { od: string; do: string };
  zmieniono: string;
  zmienil: string;
  pobrania: DokumentPobranie[];
}

/**
 * A budget plan of the Plany gospodarcze module — made outside any meeting,
 * from a library statement, for a community and year Zebrania has no plan for.
 */
export interface PlanWlasny {
  id: number;
  /** The community's vDom number — with `rok`, what tells plans apart. */
  nrWsp: number;
  /** The statement's printed name ("Wspólnota Mieszkaniowa Kolberga 8"). */
  nazwa: string;
  rok: number;
  plan: PlanGospodarczy;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** "Pobierz PDF" / "Pobierz Excel" of a plan of the Plany gospodarcze module. */
export interface PlanWlasnyExportRequest {
  planId: number;
  format: ZebranieDokumentFormat;
}

/** Which document to produce, in which format. */
export type ZebranieDokument = 'sprawozdanie' | 'plan';
export type ZebranieDokumentFormat = 'xlsx' | 'pdf';

/** Ask the main process for one document of one version. */
export interface ZebranieDokumentRequest {
  wersjaId: number;
  dokument: ZebranieDokument;
  format: ZebranieDokumentFormat;
  /** The meeting's date (ISO) — printed under the plan. */
  dataZebrania: string | null;
  /** The statement's PDF opens with its introduction unless this is false. */
  wstep?: boolean;
}

/**
 * "Pobierz PDF" in Kalendarz: a month or any period, as the user filtered it.
 * The meetings themselves are re-read by the main process; the renderer only
 * says which ones and which filters produced that selection, so the page can
 * say it is not everything in the period.
 */
export interface KalendarzPdfRequest {
  /** First day, `YYYY-MM-DD` — a whole month is its first to its last day. */
  okresOd: string;
  /** Last day, `YYYY-MM-DD`, inclusive. */
  okresDo: string;
  /** The period's meetings that pass the filters on screen. */
  spotkanieIds: number[];
  typId: number | null;
  stan: 'all' | 'changed' | 'tentative' | 'nodocs' | 'overdue';
  szukaj: string;
}

/* ------------------------- Notification inbox -------------------------- */

/** Where a click on a notification goes. */
export type NotificationTarget =
  | { view: 'zadania'; zadanieId?: number }
  | { view: 'ksiegowania' }
  | { view: 'kalendarz'; spotkanieId: number };

/** One entry of the bell's list in the sidebar. */
export interface InboxNotification {
  id: string;
  /** What kind it was (a `NotificationId`, or 'test'). */
  kind: string;
  title: string;
  body: string;
  target: NotificationTarget;
  createdAt: string;
  read: boolean;
}

/* ------------------------------- Zadania ------------------------------- */

/** The three Kanban columns, in the order they are shown. */
export const ZADANIE_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type ZadanieStatus = (typeof ZADANIE_STATUSES)[number];

/** How much a task matters, most urgent first. A new task is `normal`. */
export const ZADANIE_PRIORYTETY = ['high', 'normal', 'low'] as const;
export type ZadaniePriorytet = (typeof ZADANIE_PRIORYTETY)[number];
export const DEFAULT_ZADANIE_PRIORYTET: ZadaniePriorytet = 'normal';

/**
 * One card on the "Zadania" board.
 *
 * The assignee is stored as a MAILBOX, not an `app_users` id: the mailbox is the
 * key a backup already uses for people (`AppUserName`) and the one the session
 * carries, so "assigned to me" and a restore both resolve without a lookup. The
 * name shown is read from the live user list; a mailbox with no account behind
 * it any more is shown as the mailbox itself.
 */
export interface Zadanie {
  id: number;
  tytul: string;
  opis: string;
  status: ZadanieStatus;
  /** Absent in backups written before tasks had a priority — read as `normal`. */
  priorytet: ZadaniePriorytet;
  /**
   * Place in its column, lowest on top (see `compareZadaniaOrder`). Absent in
   * backups written before cards could be reordered — read as 0, which falls
   * back to "latest change on top".
   */
  pozycja: number;
  przypisanyEmail: string | null;
  /** Deadline as `YYYY-MM-DD` (a day, not an instant), or null for none. */
  termin: string | null;
  zalaczniki: ZadanieZalacznik[];
  /** Hidden from the board (and the notifier) but kept. Absent in older backups — read as false. */
  zarchiwizowane: boolean;
  /**
   * The meeting this task belongs to (Kalendarz), or null for a task of its
   * own. Absent in older backups — read as null. Deleting the meeting nulls it.
   */
  spotkanieId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Mailbox of whoever last changed the card — what lets the notifier skip a
   * change the signed-in person made themselves.
   */
  updatedBy: string;
}

/**
 * A file on a task. The bytes live in the Supabase Storage bucket
 * `zadania-zalaczniki` under `sciezka`; only this description sits in the row.
 * `sciezka` is minted by the main process (a uuid plus extension), never taken
 * from the file's own name.
 */
export interface ZadanieZalacznik {
  id: string;
  nazwa: string;
  rozmiar: number;
  sciezka: string;
  dodanyBy: string;
  dodanyAt: string;
}

/** What the add/edit form submits. */
export type ZadanieInput = Pick<
  Zadanie,
  | 'tytul'
  | 'opis'
  | 'status'
  | 'priorytet'
  | 'przypisanyEmail'
  | 'termin'
  | 'zalaczniki'
  | 'spotkanieId'
>;

/**
 * One comment in a task's conversation.
 *
 * The text keeps the readable "@Anna Nowak"; `mentions` carries the tagged
 * MAILBOXES, which is what the notifier reads — so renaming a person never
 * un-tags them, and a typed "@" with no pick behind it tags nobody.
 */
export interface ZadanieKomentarz {
  id: number;
  zadanieId: number;
  /** Mailbox of the author, taken from the session — never from the renderer. */
  autorEmail: string;
  tresc: string;
  mentions: string[];
  createdAt: string;
}

/** What the board shows on a card: how many comments it has, and the newest. */
export interface ZadanieKomentarzPodsumowanie {
  zadanieId: number;
  liczba: number;
  ostatni: ZadanieKomentarz;
}

/**
 * A note pinned to the Zadania view itself — a remark for the whole board, shown
 * under the filters, not tied to any card. Like a comment: a text, its author's
 * mailbox, and when it was written.
 */
export interface ZadanieNotatka {
  id: number;
  tresc: string;
  /** Mailbox of the author, taken from the session — never from the renderer. */
  autorEmail: string;
  createdAt: string;
}

/** Longest pinned note accepted; the form shows the same limit. */
export const ZADANIE_NOTATKA_MAX_LENGTH = 1000;

/** What the comment box submits. */
export type ZadanieKomentarzInput = Pick<ZadanieKomentarz, 'zadanieId' | 'tresc' | 'mentions'>;

/** Longest comment accepted; the box shows the same limit. */
export const ZADANIE_KOMENTARZ_MAX_LENGTH = 2000;

/** Ordering of the contractor pick-lists in the transaction review screen. */
export type ContractorSortOrder = 'name-asc' | 'name-desc' | 'account-asc' | 'account-desc';

export interface AppSettings {
  outputFolder: string;
  impexFolder: string;
  /** Default destination folder for "Scalanie wpłat" merged outputs. Empty string ⇒ ask the user during merge. */
  swrkFolder: string;
  /**
   * The parent folder "Znajdź pliki księgowe" scans, recursively, for statement
   * files and their PDFs. Machine-local: the shared folder is mounted under a
   * different path on every machine. Empty ⇒ the scan asks for it first.
   */
  statementsFolder: string;
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
  /** View ids in the order the person arranged the menu; null = the default order. */
  sidebarOrder?: string[] | null;
  /** Dashboard: the Księgowania area is folded down to its month banner (default: false). */
  bookingsCollapsed: boolean;
  /** Dashboard: the filter tiles in the order the person arranged them; null = the default. */
  bookingsTileOrder?: string[] | null;
  /**
   * The month the Pulpit / Księgowania view was last left on (`YYYY-MM`), so
   * coming back — or restarting the app — lands on it. '' ⇒ the current month.
   */
  bookingsMonth: string;
  /**
   * Kalendarz: show the instant hover card over a meeting in the month grid
   * (default: false). Off by default because a card that follows the cursor is
   * a matter of taste — with it off, the chip keeps a plain browser tooltip.
   */
  calendarHoverCard: boolean;
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
 * Out of scope on purpose: `app_config` (infrastructure, not user data), the
 * ROWS of `app_users` (a trigger-maintained mirror of the Supabase auth
 * accounts, so they are rebuilt rather than restored — and the participants on
 * each meeting carry their own snapshot of the people; their NAMES are a
 * different matter and travel as `appUserNames`, because this app authors them
 * and nothing can rebuild them), the
 * files of the Zadania board in the Supabase Storage bucket `zadania-zalaczniki`
 * (a backup carries each task's attachment DESCRIPTIONS, so after a restore the
 * links still point at the same objects — but the bytes are not in the JSON, and
 * a bucket that is lost is lost; 5 MB per file would turn the backup into
 * something that no longer fits in a request),
 * module files on disk (mailing PDFs, attachment copies) — history entries stay
 * readable without them — and `userData/zaliczki-cache` (the per-page OCR
 * results for "Podsumowanie zaliczek"). That cache is derived, not authored: its
 * keys are content hashes of pages inside the user's own PDFs, every entry can be
 * rebuilt from those PDFs, and it is invalidated wholesale whenever the
 * extraction prompt changes. Losing it costs one re-run's money and minutes,
 * never information — so it is excluded deliberately, not by omission.
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
    /** Proxies of the units above, by `jednostkaId`. Absent in backups written before they existed. */
    zgnPelnomocnicy?: ZgnPelnomocnik[];
    mailingPola?: MailingPole[];
    mailingSzablony?: MailingSzablon[];
    mailingHistory?: MailingHistoryEntry[];
    /** Absent in backups written before the Kalendarz module existed. */
    spotkaniaTypy?: SpotkanieTyp[];
    spotkania?: Spotkanie[];
    /** Absent in backups written before meetings had locations. */
    spotkaniaLokalizacje?: SpotkanieLokalizacja[];
    /** Absent in backups written before the Zadania board existed. */
    zadania?: Zadanie[];
    /**
     * Comments on the tasks above, tied to them by `zadanieId` (which a restore
     * remaps — tasks come back with fresh ids). Absent in backups written before
     * tasks had comments.
     */
    zadaniaKomentarze?: ZadanieKomentarz[];
    /** Notes pinned to the Zadania view. Absent in backups written before they existed. */
    zadaniaNotatki?: ZadanieNotatka[];
    /**
     * Names given to the accounts, keyed by mailbox. Only the names travel —
     * the accounts themselves belong to Supabase auth. Absent in backups
     * written before users could be named.
     */
    appUserNames?: AppUserName[];
    /** Absent in backups written before notifications could be switched per person. */
    notificationPrefs?: NotificationPrefsRow[];
    /** Absent in backups written before the dashboard had priorities and notes. */
    ksiegowaniaPriorytety?: KsiegowaniePriorytet[];
    ksiegowaniaUwagi?: KsiegowanieUwaga[];
    /** Who posts which community in which month. Absent in backups written before it existed. */
    ksiegowaniaPrzypisania?: KsiegowaniePrzypisanie[];
    /**
     * Files the folder scan pinned to communities. Only the records travel —
     * the files stay in the statements folder. Absent in backups written
     * before the scan existed.
     */
    ksiegowaniaPliki?: KsiegowaniePlik[];
    /**
     * The dashboard's own conversion records with the DOM ticks — the posting
     * state, kept apart from `history` (the log, which may be cleared). Absent
     * in backups written before the split; such a backup leaves the live
     * records alone.
     */
    ksiegowaniaKonwersje?: ConversionHistory[];
    /** Absent in backups written before mailing kinds were definable. */
    mailingTypy?: MailingTypDef[];
    /**
     * Zebrania entries, each carrying its versions in `wersje`. Re-pointed at the
     * restored meetings by `spotkanieId`. Absent in backups written before the
     * module existed.
     */
    zebrania?: Zebranie[];
    /**
     * The statement library (every community of every uploaded vDom file),
     * with the statements. Absent in backups written before it existed.
     */
    zebraniaSprawozdania?: SprawozdanieZapisane[];
    /** vDom numbers and ownership splits remembered per community, by name. */
    zebraniaWspolnoty?: ZebraniaWspolnota[];
    /** The module's settings; null when nobody has changed the defaults. */
    zebraniaUstawienia?: ZebraniaUstawienia | null;
    /** Plans made in Plany gospodarcze (not Zebrania's). Absent in backups written before it existed. */
    planyGospodarcze?: PlanWlasny[];
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
  zgnPelnomocnicy: number;
  mailingPola: number;
  mailingSzablony: number;
  mailingHistory: number;
  spotkaniaTypy: number;
  spotkania: number;
  spotkaniaLokalizacje: number;
  zadania: number;
  zadaniaKomentarze: number;
  zadaniaNotatki: number;
  appUserNames: number;
  notificationPrefs: number;
  ksiegowaniaPriorytety: number;
  ksiegowaniaUwagi: number;
  ksiegowaniaPrzypisania: number;
  ksiegowaniaPliki: number;
  ksiegowaniaKonwersje: number;
  mailingTypy: number;
  zebrania: number;
  zebraniaWersje: number;
  zebraniaSprawozdania: number;
  zebraniaWspolnoty: number;
  zebraniaUstawienia: number;
  planyGospodarcze: number;
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
    zgnPelnomocnicy: data.data.zgnPelnomocnicy?.length ?? 0,
    mailingPola: data.data.mailingPola?.length ?? 0,
    mailingSzablony: data.data.mailingSzablony?.length ?? 0,
    mailingHistory: data.data.mailingHistory?.length ?? 0,
    spotkaniaTypy: data.data.spotkaniaTypy?.length ?? 0,
    spotkania: data.data.spotkania?.length ?? 0,
    spotkaniaLokalizacje: data.data.spotkaniaLokalizacje?.length ?? 0,
    zadania: data.data.zadania?.length ?? 0,
    zadaniaKomentarze: data.data.zadaniaKomentarze?.length ?? 0,
    zadaniaNotatki: data.data.zadaniaNotatki?.length ?? 0,
    appUserNames: data.data.appUserNames?.length ?? 0,
    notificationPrefs: data.data.notificationPrefs?.length ?? 0,
    ksiegowaniaPriorytety: data.data.ksiegowaniaPriorytety?.length ?? 0,
    ksiegowaniaUwagi: data.data.ksiegowaniaUwagi?.length ?? 0,
    ksiegowaniaPrzypisania: data.data.ksiegowaniaPrzypisania?.length ?? 0,
    ksiegowaniaPliki: data.data.ksiegowaniaPliki?.length ?? 0,
    ksiegowaniaKonwersje: data.data.ksiegowaniaKonwersje?.length ?? 0,
    mailingTypy: data.data.mailingTypy?.length ?? 0,
    zebrania: data.data.zebrania?.length ?? 0,
    zebraniaWersje: (data.data.zebrania ?? []).reduce((n, z) => n + (z.wersje?.length ?? 0), 0),
    zebraniaSprawozdania: data.data.zebraniaSprawozdania?.length ?? 0,
    zebraniaWspolnoty: data.data.zebraniaWspolnoty?.length ?? 0,
    zebraniaUstawienia: data.data.zebraniaUstawienia ? 1 : 0,
    planyGospodarcze: data.data.planyGospodarcze?.length ?? 0,
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
  SET_ADRES_ZARZAD: 'db:set-adres-zarzad',
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
  CANCEL_CONVERSION: 'files:cancel-conversion',
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
  SET_STATEMENTS_FOLDER: 'settings:set-statements-folder',
  SET_DARK_MODE: 'settings:set-dark-mode',
  SET_LANGUAGE: 'settings:set-language',
  SET_SKIP_USER_APPROVAL: 'settings:set-skip-user-approval',
  SET_ALWAYS_USE_AI: 'settings:set-always-use-ai',
  SET_CONTRACTOR_SORT_ORDER: 'settings:set-contractor-sort-order',
  SET_SIDEBAR_COLLAPSED: 'settings:set-sidebar-collapsed',
  SET_SIDEBAR_ORDER: 'settings:set-sidebar-order',
  SET_BOOKINGS_COLLAPSED: 'settings:set-bookings-collapsed',
  SET_BOOKINGS_TILE_ORDER: 'settings:set-bookings-tile-order',
  SET_BOOKINGS_MONTH: 'settings:set-bookings-month',
  SET_CALENDAR_HOVER_CARD: 'settings:set-calendar-hover-card',
  GET_NOTIFICATION_PREFS: 'notifications:get-prefs',
  SET_NOTIFICATION_PREF: 'notifications:set-pref',
  SEND_TEST_NOTIFICATION: 'notifications:send-test',
  GET_INBOX: 'inbox:get',
  MARK_INBOX_READ: 'inbox:mark-read',
  DELETE_INBOX: 'inbox:delete',
  SET_LAST_SEEN_VERSION: 'settings:set-last-seen-version',
  EXPORT_SETTINGS: 'settings:export',
  IMPORT_SETTINGS: 'settings:import',
  
  // History
  GET_HISTORY: 'history:get-all',
  CLEAR_HISTORY: 'history:clear',
  IMPORT_HISTORY_FROM_FILE: 'history:import-from-file',
  EXPORT_HISTORY_TO_FILE: 'history:export-to-file',
  SET_KS_BOOKED_IN_DOM: 'ksiegowania:set-booked-in-dom',
  GET_KS_KONWERSJE: 'ksiegowania:get-konwersje',
  MARK_KS_PLIK_BOOKED: 'ksiegowania:mark-plik-booked',
  UNDO_KS_MANUAL: 'ksiegowania:undo-manual',

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
  ZALICZKI_CACHE_STATS: 'zaliczki:cache-stats',
  ZALICZKI_CLEAR_CACHE: 'zaliczki:clear-cache',

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
  SET_ZGN_ADRESY: 'mailing:set-zgn-adresy',
  GET_ZGN_PELNOMOCNICY: 'zgn:get-pelnomocnicy',
  ADD_ZGN_PELNOMOCNIK: 'zgn:add-pelnomocnik',
  UPDATE_ZGN_PELNOMOCNIK: 'zgn:update-pelnomocnik',
  DELETE_ZGN_PELNOMOCNIK: 'zgn:delete-pelnomocnik',
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
  MAILING_GET_TYPY: 'mailing:get-typy',
  MAILING_ADD_TYP: 'mailing:add-typ',
  MAILING_UPDATE_TYP: 'mailing:update-typ',
  MAILING_DELETE_TYP: 'mailing:delete-typ',
  MAILING_EXPORT: 'mailing:export',
  MAILING_RESOLVE_ODBIORCY: 'mailing:resolve-odbiorcy',
  MAILING_SHOW_IN_FOLDER: 'mailing:show-in-folder',

  // Zebrania (meeting materials, versioned)
  GET_ZEBRANIA: 'zebrania:get',
  ZEBRANIE_FROM_SPOTKANIE: 'zebrania:from-spotkanie',
  ZEBRANIE_ENSURE_FOR_SPOTKANIE: 'zebrania:ensure-for-spotkanie',
  ADD_ZEBRANIE: 'zebrania:add',
  UPDATE_ZEBRANIE: 'zebrania:update',
  DELETE_ZEBRANIE: 'zebrania:delete',
  ADD_ZEBRANIE_WERSJA: 'zebrania:add-wersja',
  UPDATE_ZEBRANIE_WERSJA: 'zebrania:update-wersja',
  SET_ZEBRANIE_WERSJA_STATUS: 'zebrania:set-wersja-status',
  SET_ZEBRANIE_WERSJA_NAZWA: 'zebrania:set-wersja-nazwa',
  ZEBRANIA_SPRAWOZDANIA_IMPORT: 'zebrania:sprawozdania-import',
  ZEBRANIA_SPRAWOZDANIA_LISTA: 'zebrania:sprawozdania-lista',
  ZEBRANIA_SPRAWOZDANIE_GET: 'zebrania:sprawozdanie-get',
  ZEBRANIE_WERSJA_ATTACH_SPRAWOZDANIE: 'zebrania:wersja-attach-sprawozdanie',
  ZEBRANIE_WERSJA_REMOVE_SPRAWOZDANIE: 'zebrania:wersja-remove-sprawozdanie',
  ZEBRANIE_WERSJA_SET_SPRAWOZDANIE_WSTEP: 'zebrania:wersja-set-sprawozdanie-wstep',
  ZEBRANIE_WERSJA_SET_PLAN: 'zebrania:wersja-set-plan',
  ZEBRANIA_WSPOLNOTY_GET: 'zebrania:wspolnoty-get',
  ZEBRANIA_WSPOLNOTA_SET: 'zebrania:wspolnota-set',
  ZEBRANIA_USTAWIENIA_GET: 'zebrania:ustawienia-get',
  ZEBRANIA_USTAWIENIA_SET: 'zebrania:ustawienia-set',
  ZEBRANIA_DOKUMENT_EXPORT: 'zebrania:dokument-export',
  SPRAWOZDANIA_IMPORT_WLASNE: 'sprawozdania:import-wlasne',
  SPRAWOZDANIE_DELETE_WLASNE: 'sprawozdania:delete-wlasne',
  SPRAWOZDANIE_EXPORT: 'sprawozdania:export',
  PLANY_WLASNE_GET: 'plany:get',
  PLAN_WLASNY_ADD: 'plany:add',
  PLAN_WLASNY_SET: 'plany:set',
  PLAN_WLASNY_DELETE: 'plany:delete',
  PLAN_WLASNY_EXPORT: 'plany:export',
  KALENDARZ_PDF_EXPORT: 'kalendarz:pdf-export',
  RECORD_ZEBRANIE_POBRANIE: 'zebrania:record-pobranie',

  // Kalendarz (meetings, their user-defined types, and the account list the
  // participant picker reads)
  GET_APP_USERS: 'kalendarz:get-app-users',
  SET_APP_USER_NAME: 'users:set-name',
  SET_APP_USER_COLOR: 'users:set-color',
  GET_SPOTKANIA_TYPY: 'kalendarz:get-typy',
  ADD_SPOTKANIE_TYP: 'kalendarz:add-typ',
  UPDATE_SPOTKANIE_TYP: 'kalendarz:update-typ',
  DELETE_SPOTKANIE_TYP: 'kalendarz:delete-typ',
  GET_SPOTKANIA_LOKALIZACJE: 'kalendarz:get-lokalizacje',
  ADD_SPOTKANIE_LOKALIZACJA: 'kalendarz:add-lokalizacja',
  UPDATE_SPOTKANIE_LOKALIZACJA: 'kalendarz:update-lokalizacja',
  DELETE_SPOTKANIE_LOKALIZACJA: 'kalendarz:delete-lokalizacja',
  GET_SPOTKANIA: 'kalendarz:get-spotkania',
  ADD_SPOTKANIE: 'kalendarz:add-spotkanie',
  UPDATE_SPOTKANIE: 'kalendarz:update-spotkanie',
  DELETE_SPOTKANIE: 'kalendarz:delete-spotkanie',
  ACK_SPOTKANIE_TERMIN: 'kalendarz:ack-termin',
  SET_SPOTKANIE_TERMIN_STATUS: 'kalendarz:set-termin-status',
  SET_SPOTKANIE_DOKUMENTY: 'kalendarz:set-dokumenty',
  SET_SPOTKANIE_MATERIALY: 'kalendarz:set-materialy',
  SEND_TEST_MATERIALY_NOTIFICATION: 'notifications:send-test-materialy',
  GET_SPOTKANIA_MAILINGI: 'kalendarz:get-mailingi',

  // Zadania (Kanban)
  GET_ZADANIA: 'zadania:get',
  ADD_ZADANIE: 'zadania:add',
  UPDATE_ZADANIE: 'zadania:update',
  MOVE_ZADANIE: 'zadania:move',
  DELETE_ZADANIE: 'zadania:delete',
  ARCHIVE_ZADANIE: 'zadania:archive',
  ZADANIA_PICK_ATTACHMENT: 'zadania:pick-attachment',
  ZADANIA_UPLOAD_ATTACHMENT: 'zadania:upload-attachment',
  ZADANIA_DOWNLOAD_ATTACHMENT: 'zadania:download-attachment',
  ZADANIA_DISCARD_ATTACHMENTS: 'zadania:discard-attachments',
  GET_ZADANIE_KOMENTARZE: 'zadania:get-komentarze',
  GET_ZADANIA_NOTATKI: 'zadania:get-notatki',
  ADD_ZADANIE_NOTATKA: 'zadania:add-notatka',
  DELETE_ZADANIE_NOTATKA: 'zadania:delete-notatka',
  UPDATE_ZADANIE_NOTATKA: 'zadania:update-notatka',
  GET_ZADANIA_KOMENTARZE_PODSUMOWANIE: 'zadania:get-komentarze-podsumowanie',
  ADD_ZADANIE_KOMENTARZ: 'zadania:add-komentarz',
  DELETE_ZADANIE_KOMENTARZ: 'zadania:delete-komentarz',

  // Księgowania: priorities with a note, and notes on a community
  GET_KS_PRIORYTETY: 'ksiegowania:get-priorytety',
  GET_KS_PRZYPISANIA: 'ksiegowania:get-przypisania',
  SET_KS_PRZYPISANIE: 'ksiegowania:set-przypisanie',
  ADD_KS_PRIORYTET: 'ksiegowania:add-priorytet',
  SET_KS_PRIORYTET_NOTATKA: 'ksiegowania:set-priorytet-notatka',
  REMOVE_KS_PRIORYTET: 'ksiegowania:remove-priorytet',
  REORDER_KS_PRIORYTETY: 'ksiegowania:reorder-priorytety',
  GET_KS_UWAGI: 'ksiegowania:get-uwagi',
  ADD_KS_UWAGA: 'ksiegowania:add-uwaga',
  UPDATE_KS_UWAGA: 'ksiegowania:update-uwaga',
  SET_KS_UWAGA_RESOLVED: 'ksiegowania:set-uwaga-resolved',
  DELETE_KS_UWAGA: 'ksiegowania:delete-uwaga',
  GET_KS_PLIKI: 'ksiegowania:get-pliki',
  SCAN_KS_PLIKI: 'ksiegowania:scan-pliki',
  RESOLVE_KS_SCAN: 'ksiegowania:resolve-scan',
  DELETE_KS_PLIK: 'ksiegowania:delete-plik',
  PREVIEW_PDF: 'files:preview-pdf',

  // Auth (Supabase-backed)
  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',
  AUTH_GET_SESSION: 'auth:get-session',
  AUTH_CONSUME_EXPIRY_NOTICE: 'auth:consume-expiry-notice',
} as const;
