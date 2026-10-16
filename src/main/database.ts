import Store from 'electron-store';
import log from 'electron-log';
import path from 'path';
import { app } from 'electron';
import { openSecret, sealSecret } from './secretStorage';
import {
  Bank,
  ConversionHistory,
  AppSettings,
  Kontrahent,
  Adres,
  KontrahentTyp,
  ApartmentMapping,
  KontoTyp,
  BackupData,
  BackupSectionKey,
  PORTABLE_SETTINGS,
  PortableSettings,
  OdczytyHistoryEntry,
  PodpisHistoriaEntry,
  PodpisHistoriaPlik,
  ZgnJednostka,
  ZgnPelnomocnik,
  ZarzadOsoba,
  SpotkanieZarzadOsoba,
  MailingPole,
  MailingPoleTyp,
  MailingSzablon,
  MailingHistoryEntry,
  MailingSmtpConfig,
  AppUser,
  AppUserName,
  NotificationPrefsRow,
  SpotkanieTyp,
  SpotkanieLokalizacja,
  Spotkanie,
  SpotkanieInput,
  SpotkanieMailing,
  SpotkanieTerminStatus,
  SpotkanieMaterialyStatus,
  SPOTKANIE_MATERIALY_STATUSES,
  SpotkanieUczestnik,
  Zadanie,
  ZadanieInput,
  ZadaniePatch,
  ZADANIE_CONFLICT_MESSAGE,
  ZadanieStatus,
  ZadanieZalacznik,
  ZadanieKomentarz,
  ZadanieKomentarzInput,
  ZadanieNotatka,
  ZADANIE_NOTATKA_MAX_LENGTH,
  ZadanieKomentarzPodsumowanie,
  ZADANIE_STATUSES,
  ZADANIE_PRIORYTETY,
  DEFAULT_ZADANIE_PRIORYTET,
  ZadaniePriorytet,
  ZADANIE_KOMENTARZ_MAX_LENGTH,
  KsiegowaniePriorytet,
  KsiegowaniePrzypisanie,
  KsiegowanieUwaga,
  KsiegowaniePlik,
  MailingAdresaci,
  MailingOdbiorca,
  MailingTypDef,
  MAILING_TYP_ZAWIADOMIENIE,
  MAILING_TYP_ZAWIADOMIENIE_NAZWA,
  MAILING_TYP_UCHWALA,
  MAILING_TYP_UCHWALA_NAZWA,
  Zebranie,
  ZebranieInput,
  ZebranieStatus,
  ZEBRANIE_DOKUMENTY,
  ZebranieDokumentKlucz,
  ZebranieGotowe,
  ZebranieWersja,
  ZebranieWersjaInput,
  ZebranieMaterial,
  ZEBRANIE_STATUSES,
  PlanGospodarczy,
  PlanSprawozdanieMeta,
  PlanWlasny,
  PodatekNieruchomosci,
  PodatekNieruchomosciDane,
  PodatekPobranie,
  PodatkiStawki,
  PodatkiStawkiDane,
  AdresyZasilenieResult,
  PodatekCit,
  PodatekCitDane,
  PodatkiCitUstawienia,
  PodpisSlad,
  Sprawozdanie,
  SprawozdanieWstepTekst,
  SprawozdanieLaczenie,
  SprawozdanieGrupowanie,
  SprawozdanieZapisane,
  ZebraniaUstawienia,
  ZebraniaWspolnota,
  ZebranieDokument,
  ZebranieSprawozdanie,
} from '../shared/types';
import type { ZebranieStatusRow } from '../shared/types';
import { normalizePlan, normalizePobrania, normalizeUstawienia } from '../shared/plan-gospodarczy';
import { daneNaKolejnyRok, normalizeDane, normalizeStawki, tylkoCyfry } from '../shared/podatki';
import { daneCitNaKolejnyRok, normalizeCitUstawienia, normalizeDaneCit, oznaczAutorowRegul } from '../shared/podatki-cit';
import { normalizeIdentyfikacja, zasilZDn1 } from '../shared/adres-identyfikacja';
import {
  PitDane,
  PitOsoba,
  PitZlozone,
  PodatekPit,
  daneNaKolejnyRok as daneNaKolejnyRokPit,
  normalizeDanePit,
} from '../shared/podatki-pit';
import {
  SPRAWOZDANIE_ODLACZONE,
  isSprawozdanieOdlaczone,
  normalizeSprawozdanieDane,
  normalizeSprawozdanieMeta,
  normalizePlanSprawozdanieMeta,
  normalizeWstepTekst,
  sprawozdanieZKopii,
  normalizeLaczenia,
  zebranieSprawozdanie,
  ZebranieSprawozdanieMeta,
} from '../shared/sprawozdanie';
import {
  copyMaterialyForRevision,
  gotoweForStatus,
  latestWersja,
  materialyTargetForWersja,
  nextWersjaNumber,
  normalizeGotowe,
  normalizeMaterialy,
  sortWersje,
  wersjaStatusFromGotowe,
  ZEBRANIE_WERSJA_NAZWA_MAX,
  zebranieStatusFromMaterialy,
  materialyZeSzablonu,
  materialySzablonu,
  zrodloSzablonu,
} from '../shared/zebrania';
import { randomUUID } from 'crypto';
import { getSupabase, onTableWrite } from './supabaseClient';
import { removeAttachments } from './zadaniaStorage';
import { ZADANIE_ATTACHMENT_MAX_BYTES, ZADANIE_STORAGE_KEY, isValidDayKey } from '../shared/zadania';
import { NOTIFICATION_DEFS } from '../shared/notifications';
import type { NotificationId, NotificationPrefs } from '../shared/notifications';
import { normalizeAccount } from '../shared/account-extractor';
import { buildApartmentMapping, mappingTargets } from '../shared/apartment-mapping';
import { DEFAULT_AI_MODEL, resolveAiModel } from '../shared/ai-models';
import { EDeklaracjeSrodowisko, EDeklaracjeWysylka, normalizeSrodowisko } from '../shared/e-deklaracje';
import { WysylkaRozstrzygniecie, czekaNaUpo, niepewnaOtwarta } from '../shared/e-deklaracje';

// Settings remain machine-local: dark mode, folder paths, language, etc. are
// per-user-machine UI prefs that shouldn't sync across installs.
interface SettingsStoreSchema {
  settings: {
    outputFolder: string;
    impexFolder: string;
    swrkFolder: string;
    statementsFolder: string;
    darkMode: boolean;
    language: 'pl' | 'en';
    aiConfidenceThreshold: number;
    alwaysUseAI: boolean;
    /** Claude model for every AI call; see `getAiModel`. */
    aiModel: string;
    skipUserApproval: boolean;
    contractorSortOrder: 'name-asc' | 'name-desc' | 'account-asc' | 'account-desc';
    sidebarCollapsed: boolean;
    bookingsCollapsed: boolean;
    bookingsMonth: string;
    /** Kalendarz: instant hover card over a meeting in the month grid. */
    calendarHoverCard: boolean;
    /** Release-notes version already shown on this machine ('' = never). */
    lastSeenVersion: string;
    /** Mailing: SMTP of the mailbox we send from. Never leaves this machine. */
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPass: string;
    smtpFromName: string;
    smtpBccSelf: boolean;
    /** Podatki → Nieruchomości: where DN-1 files go ('' = Downloads). */
    podatkiFolder: string;
    /** Podpis kwalifikowany: the card's PKCS#11 library picked by hand ('' = next to Szafir). */
    podpisBiblioteka: string;
    /** The e-Deklaracje gateway signed returns go to ('test' unless switched in Administracja). */
    eDeklaracjeSrodowisko: EDeklaracjeSrodowisko;
  };
}

const BANK_COLS = 'id, name, converterId:converter_id, accountPrefixes:account_prefixes, createdAt:created_at';
const KONTRAHENT_COLS =
  'id, nazwa, kontoKontrahenta:konto_kontrahenta, nip, typ, typy, alternativeNames:alternative_names, createdAt:created_at';

// Coerce a raw Supabase row's type info into the non-empty `typy` array the app
// model guarantees. Prefers the multi-value `typy` column; falls back to the
// legacy scalar `typ` for rows written before the multi-type migration.
function normalizeTypy(row: { typy?: unknown; typ?: unknown }): KontrahentTyp[] {
  if (Array.isArray(row.typy) && row.typy.length > 0) return row.typy as KontrahentTyp[];
  return [((row.typ as KontrahentTyp) || 'Kontrahent')];
}
const ADRES_COLS =
  'id, nazwa, alternativeNames:alternative_names, swrkIdentifiers:swrk_identifiers, accountNumbers:account_numbers, accountTypes:account_types, bankId:bank_id, apartmentMappings:apartment_mappings, zgnJednostkaId:zgn_jednostka_id, zarzad, identyfikacja, createdAt:created_at';
const ZGN_COLS = 'id, nazwa, email, createdAt:created_at';
const ZGN_PELNOMOCNIK_COLS =
  'id, jednostkaId:jednostka_id, imieNazwisko:imie_nazwisko, email, createdAt:created_at';
const MAILING_POLE_COLS =
  'id, nazwa, tekst, jednostka, typWartosci:typ_wartosci, typ, createdAt:created_at';
const MAILING_SZABLON_COLS =
  'id, nazwa, typ, temat, tresc, attachPdf:attach_pdf, tableFields:table_fields, createdAt:created_at';
const MAILING_HISTORY_COLS =
  'id, typ, templateName:template_name, status, errorMessage:error_message, adresId:adres_id, adresNazwa:adres_nazwa, jednostkaNazwa:jednostka_nazwa, jednostkaEmail:jednostka_email, subject, bodyHtml:body_html, bodyText:body_text, fieldValues:field_values, attachments, sentFrom:sent_from, sentAt:sent_at, spotkanieId:spotkanie_id, odbiorcy';
const MAILING_TYP_COLS = 'id, klucz, nazwa, opis, systemowy, adresaci, createdAt:created_at';
const ZEBRANIE_COLS =
  'id, spotkanieId:spotkanie_id, nazwa, adresId:adres_id, adresNazwa:adres_nazwa, ' +
  'lokalizacjaId:lokalizacja_id, lokalizacjaNazwa:lokalizacja_nazwa, ' +
  'lokalizacjaAdres:lokalizacja_adres, startsAt:starts_at, ' +
  'createdBy:created_by, createdAt:created_at, updatedAt:updated_at';
const ZEBRANIE_WERSJA_COLS =
  'id, zebranieId:zebranie_id, major, minor, nazwa, status, opis, materialy, gotowe, sprawozdanie, sprawozdanie_id, plan, ' +
  'createdBy:created_by, createdAt:created_at, updatedAt:updated_at, updatedBy:updated_by';
const SPRAWOZDANIE_LISTA_COLS =
  'id, nr_wsp, nazwa, okres_od, okres_do, plik_nazwa, imported_at, imported_by';
const KONTO_TYP_COLS =
  'id, name, bankAccountSymbol:bank_account_symbol, apartmentPrefix:apartment_prefix, isDefault:is_default, createdAt:created_at';
const HISTORY_COLS =
  'id, fileName:file_name, bankName:bank_name, converterName:converter_name, status, errorMessage:error_message, inputPath:input_path, outputPath:output_path, convertedAt:converted_at, adresId:adres_id, adresNazwa:adres_nazwa, bookedInDom:booked_in_dom, bookedInDomAt:booked_in_dom_at, bookedInDomBy:booked_in_dom_by';
const APP_USER_COLS_BASE =
  'id, email, displayName:display_name, firstName:first_name, lastName:last_name, createdAt:created_at';
const APP_USER_COLS = `${APP_USER_COLS_BASE}, color`;
const SPOTKANIE_TYP_COLS =
  'id, nazwa, kolor, opis, dniNaDokumenty:dni_na_dokumenty, createdAt:created_at';
const SPOTKANIE_LOKALIZACJA_COLS = 'id, nazwa, adres, opis, createdAt:created_at';
const SPOTKANIE_COLS =
  'id, nazwa, typId:typ_id, adresId:adres_id, adresNazwa:adres_nazwa, ' +
  'lokalizacjaId:lokalizacja_id, lokalizacjaNazwa:lokalizacja_nazwa, ' +
  'startsAt:starts_at, endsAt:ends_at, opis, uczestnicy, terminStatus:termin_status, ' +
  'terminWysylki:termin_wysylki, ' +
  'terminZmienionyAt:termin_zmieniony_at, terminZmienionyZ:termin_zmieniony_z, ' +
  'terminZmienionyBy:termin_zmieniony_by, ' +
  'terminZmianaOdczytanaAt:termin_zmiana_odczytana_at, ' +
  'terminZmianaOdczytanaBy:termin_zmiana_odczytana_by, ' +
  'materialyStatus:materialy_status, materialyZmienioneAt:materialy_zmienione_at, ' +
  'materialyZmienioneBy:materialy_zmienione_by, ' +
  'zgnJednostkaId:zgn_jednostka_id, zgnPelnomocnikId:zgn_pelnomocnik_id, zgnNazwa:zgn_nazwa, ' +
  'zarzad, ' +
  'createdBy:created_by, createdAt:created_at, updatedAt:updated_at';
/** Slim projection of a mailing send, as a meeting shows it. */
const SPOTKANIE_MAILING_COLS =
  'id, spotkanieId:spotkanie_id, templateName:template_name, status, ' +
  'errorMessage:error_message, adresNazwa:adres_nazwa, jednostkaNazwa:jednostka_nazwa, ' +
  'jednostkaEmail:jednostka_email, subject, attachments, sentFrom:sent_from, sentAt:sent_at';
const KS_PRIORYTET_COLS =
  'id, monthKey:month_key, adresId:adres_id, adresNazwa:adres_nazwa, position, notatka, notatkaBy:notatka_by, mentions, createdBy:created_by, createdAt:created_at';
const KS_PRZYPISANIE_COLS =
  'id, monthKey:month_key, adresId:adres_id, adresNazwa:adres_nazwa, email, assignedBy:assigned_by, assignedAt:assigned_at';
const KS_PLIK_COLS =
  'id, monthKey:month_key, kind, status, errorMessage:error_message, adresId:adres_id, adresNazwa:adres_nazwa, ' +
  'accountNumber:account_number, accountTypeName:account_type_name, bankId:bank_id, bankName:bank_name, ' +
  'converterId:converter_id, relPath:rel_path, fileName:file_name, originalName:original_name, fileSize:file_size, ' +
  'fileMtime:file_mtime, fileHash:file_hash, ignoredHashes:ignored_hashes, periodFrom:period_from, periodTo:period_to, scannedAt:scanned_at, ' +
  'scannedBy:scanned_by';
const KS_UWAGA_COLS =
  'id, adresId:adres_id, adresNazwa:adres_nazwa, tresc, mentions, createdBy:created_by, createdAt:created_at, resolvedAt:resolved_at, resolvedBy:resolved_by';
const ZADANIE_COLS =
  'id, tytul, opis, status, priorytet, pozycja, przypisanyEmail:przypisany_email, termin, zalaczniki, zarchiwizowane, ' +
  'spotkanieId:spotkanie_id, ' +
  'createdBy:created_by, createdAt:created_at, updatedAt:updated_at, updatedBy:updated_by';
/** What the notifier needs of a card: no description, no files. */
const ZADANIE_NOTIFIER_COLS =
  'id, tytul, status, termin, zarchiwizowane, przypisanyEmail:przypisany_email, ' +
  'createdBy:created_by, createdAt:created_at, updatedAt:updated_at, updatedBy:updated_by';
const ZADANIE_KOMENTARZ_COLS =
  'id, zadanieId:zadanie_id, autorEmail:autor_email, tresc, mentions, createdAt:created_at';
const ZADANIE_NOTATKA_COLS = 'id, tresc, autorEmail:autor_email, createdAt:created_at';
const PODPIS_HISTORIA_COLS =
  'id, signedAt:signed_at, signedBy:signed_by, podmiot, wystawca, numerSeryjny:numer_seryjny, pliki, podpisanych, przerwano';
const ODCZYTY_HISTORY_COLS =
  'id, supplier, status, errorMessage:error_message, outputDir:output_dir, sources:source_files, outputs:output_files, readingCount:reading_count, skippedCount:skipped_count, convertedAt:converted_at';

function unwrap<T>(data: T | null, error: { message: string } | null, context: string): T {
  if (error) throw new Error(`${context}: ${error.message}`);
  if (data === null) throw new Error(`${context}: no data returned`);
  return data;
}

// Fetches every row from a Supabase query in fixed-size pages. PostgREST's
// server-side `db-max-rows` (1000 on Supabase by default) caps a single
// `.range()` response, so we loop until we get a short page.
async function fetchAllPaged<T>(
  context: string,
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw new Error(`${context}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Columns of `ksiegowania_konwersje` added by later migrations. Until the SQL is
 * run they do not exist, and a query naming one fails as a whole — the reads
 * and writes below drop the missing one and retry, so the dashboard keeps its
 * own records instead of failing over to the history log.
 */
const KS_KONWERSJE_OPTIONAL: Record<string, string> = {
  month_key: 'monthKey:month_key',
  input_hash: 'inputHash:input_hash',
  recznie: 'manual:recznie',
  odrzucone_at: 'discardedAt:odrzucone_at',
  odrzucone_by: 'discardedBy:odrzucone_by',
};

/** Which of `names` a PostgREST "no such column" error is about, if any. */
function missingColumn(message: string, names: string[]): string | null {
  if (!/does not exist|Could not find the/.test(message)) return null;
  return names.find((name) => new RegExp(`\\b${name}\\b`).test(message)) ?? null;
}

/**
 * Whether an error is about a table or column the database does not have yet —
 * a migration not run — and nothing else. Narrower than "does not exist" on
 * purpose: an expired session can also report something that "does not exist",
 * and that must fail a backup, not quietly thin it.
 */
function isMissingRelationOrColumn(message: string): boolean {
  return /relation "?[\w.]+"? does not exist|column "?[\w.]+"? does not exist|Could not find the table|Could not find the '?\w+'? column/i.test(
    message,
  );
}

/** Two timestamps naming the same instant — Supabase writes `+00:00` where the app writes `Z`. */
function sameInstant(a: string, b: string): boolean {
  return a === b || Date.parse(a) === Date.parse(b);
}

/** How many times a write that lost a race re-reads and applies itself again (see `casUpdate`). */
const CAS_ATTEMPTS = 5;

/**
 * Why a save made from a form was refused: the row was saved by somebody else
 * after the form loaded it (the caller passed the `updatedAt` it loaded).
 */
const CONCURRENT_EDIT_MESSAGE =
  'Te dane zmieniły się w międzyczasie (ktoś inny je zapisał). Odśwież widok i wprowadź zmiany ponownie.';

/**
 * The `updated_at` of a write that only NOTES something — a download, a DOM
 * tick, a filing mark: one millisecond after the stored one. It still moves the
 * row's version (which is what makes two such writes unable to both land on the
 * same read), while the time the row shows as "last changed" stays its edit's.
 */
function notedStamp(stored: string): string {
  const t = Date.parse(stored);
  return new Date((Number.isFinite(t) ? t : Date.now()) + 1).toISOString();
}

/** The `updated_at` of an edit: now — but always later than the stored one, or the version would not move. */
function editedStamp(stored: string): string {
  const t = Date.parse(stored);
  return new Date(Math.max(Date.now(), (Number.isFinite(t) ? t : 0) + 1)).toISOString();
}

/**
 * `clean` — what this version's normalizer made of a stored jsonb object — laid
 * over the stored object itself: the keys this version knows come from
 * `clean`, and any other key (one a NEWER version of the app added) is kept as
 * stored, so saving from an older install never strips it. Only for
 * normalizers that always emit every key they know; one that omits a cleared
 * key would see the stored value come back.
 */
function keepUnknownKeys<T extends object>(raw: unknown, clean: T): T {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? ({ ...(raw as object), ...clean } as T) : clean;
}

/** `keepUnknownKeys` item by item for a stored jsonb list, matching items by `key`. */
function keepUnknownItems<T extends object>(raw: unknown, clean: T[], key: keyof T & string): T[] {
  const stored = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const k = item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined;
      if (typeof k === 'string' && k) stored.set(k, item as Record<string, unknown>);
    }
  }
  return clean.map((item) => {
    const s = stored.get(String(item[key]));
    return s ? ({ ...s, ...item } as T) : item;
  });
}

interface CacheEntry<T> {
  data: T;
  expires: number;
}

class DatabaseService {
  private settingsStore: Store<SettingsStoreSchema>;

  // In-memory cache for the reference tables that the conversion pipeline reads
  // repeatedly (multiple times per file, per batch). A short TTL keeps data fresh
  // enough when another instance edits the shared Supabase DB, while local writes
  // invalidate immediately so the user always sees their own edits. This removes
  // the dominant "full-table re-download on every operation" cost.
  //
  // The same holds for the lists the Kalendarz, Zebrania and Zadania screens
  // read whole on every visit and after every write (`spotkania`, `zebrania`,
  // `zadania`, `appUsers`). Those are invalidated by table rather than by
  // method: every REST write reports its table (`onTableWrite`), and
  // `CACHE_TABLES` says which entries a table feeds — `getZebrania` reads three
  // of them, and a statement edited in Sprawozdania must reach it too. Only the
  // whole-list reads are cached; a read of one row (`getSpotkanie`,
  // `getZebranie`) always goes to the database — it is what a screen asks for
  // when it wants the row as it is now.
  private static readonly CACHE_TTL_MS = 60_000;
  private cache: {
    banks?: CacheEntry<Bank[]>;
    kontrahenci?: CacheEntry<Kontrahent[]>;
    adresy?: CacheEntry<Adres[]>;
    kontoTypy?: CacheEntry<KontoTyp[]>;
    spotkania?: CacheEntry<Spotkanie[]>;
    zadania?: CacheEntry<Zadanie[]>;
    appUsers?: CacheEntry<AppUser[]>;
    zebrania?: CacheEntry<Zebranie[]>;
    zebraniaStatus?: CacheEntry<ZebranieStatusRow[]>;
  } = {};

  /**
   * Bumped on every invalidation. A read that started before a write and
   * answers after it carries the data from before the write; it is only kept
   * when its key was not invalidated in between (see `cacheRead`).
   */
  private cacheGeneration: Partial<Record<keyof DatabaseService['cache'], number>> = {};

  /** Which cache entries a write to a table makes stale. */
  private static readonly CACHE_TABLES: Record<string, (keyof DatabaseService['cache'])[]> = {
    banks: ['banks'],
    kontrahenci: ['kontrahenci'],
    adresy: ['adresy'],
    konto_typy: ['kontoTypy'],
    spotkania: ['spotkania'],
    zadania: ['zadania'],
    app_users: ['appUsers'],
    zebrania: ['zebrania', 'zebraniaStatus'],
    zebrania_wersje: ['zebrania', 'zebraniaStatus'],
    // A version shows its linked statement's figures (`zebranieWersjeRows`).
    zebrania_sprawozdania: ['zebrania'],
  };

  private cacheGet<T>(entry: CacheEntry<T> | undefined): T | undefined {
    if (entry && entry.expires > Date.now()) return entry.data;
    return undefined;
  }

  private cacheSet<T>(data: T): CacheEntry<T> {
    return { data, expires: Date.now() + DatabaseService.CACHE_TTL_MS };
  }

  /**
   * A whole-list read through the cache: served from memory while fresh,
   * otherwise loaded and kept — unless a write invalidated the key while the
   * load was out. Callers get their own copy of the array, so sorting it cannot
   * reorder the cache for everyone after them.
   */
  private async cacheRead<K extends 'spotkania' | 'zadania' | 'appUsers' | 'zebrania' | 'zebraniaStatus'>(
    key: K,
    load: () => Promise<NonNullable<DatabaseService['cache'][K]>['data']>,
  ): Promise<NonNullable<DatabaseService['cache'][K]>['data']> {
    type Rows = NonNullable<DatabaseService['cache'][K]>['data'];
    const cached = this.cacheGet(this.cache[key] as CacheEntry<Rows> | undefined);
    if (cached) return [...cached] as Rows;
    const generation = this.cacheGeneration[key] ?? 0;
    const data = await load();
    if ((this.cacheGeneration[key] ?? 0) === generation) {
      (this.cache as Record<K, CacheEntry<Rows> | undefined>)[key] = this.cacheSet(data);
    }
    return [...data] as Rows;
  }

  /** Drop cached reference data. Called after every local write so reads re-fetch. */
  private invalidateCache(key: keyof DatabaseService['cache']): void {
    this.cache[key] = undefined;
    this.cacheGeneration[key] = (this.cacheGeneration[key] ?? 0) + 1;
  }

  /** Drop what a write to `table` made stale. */
  private invalidateTable(table: string): void {
    for (const key of DatabaseService.CACHE_TABLES[table] ?? []) this.invalidateCache(key);
  }

  /**
   * Drop every cached list. For reads whose point is to see what other people
   * changed — a manual refresh, a notification opened — and for a restore,
   * which rewrites the tables underneath.
   */
  invalidateAllCaches(): void {
    // Every key, not only the filled ones: a load still out must not land either.
    for (const key of new Set(Object.values(DatabaseService.CACHE_TABLES).flat())) this.invalidateCache(key);
  }

  /**
   * Read-modify-write of one row under optimistic concurrency — for every write
   * that builds on what is stored: a download noted on a list, one mark flipped
   * among several, a form saved over fields the server keeps (downloads, ticks).
   *
   * `apply` gets the row as read (`columns` plus `updated_at`) and returns the
   * columns to write, or null for nothing to do. The write lands only while
   * `updated_at` is still the one read, and it always moves `updated_at` (an
   * edit to now, a note by a millisecond — `stamp`), so of two writers that read
   * the same version only one lands; the other re-reads and applies its change
   * again on top. With `expectedUpdatedAt` (what a form loaded) a newer row is
   * not merged into but refused with `CONCURRENT_EDIT_MESSAGE`.
   *
   * Returns the row the landed write was built on and, with `returning`, the
   * written row; null when the row does not exist.
   */
  private async casUpdate<R extends { updated_at: string }>(
    table: string,
    id: number,
    columns: string,
    op: string,
    apply: (row: R) => Record<string, unknown> | null,
    options: {
      stamp?: 'edit' | 'note';
      expectedUpdatedAt?: string | null;
      /** The row already read (bulk), used for the first attempt. */
      initial?: R;
      /** Columns of the written row to return. */
      returning?: string;
      mapError?: (error: { code?: string; message: string }) => Error;
    } = {},
  ): Promise<{ row: R; written: any | null } | null> {
    let row: R | null = options.initial ?? null;
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      if (!row) {
        const { data, error } = await getSupabase()
          .from(table)
          .select(columns === '*' ? '*' : `${columns}, updated_at`)
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(`${op} (odczyt): ${error.message}`);
        if (!data) {
          // Gone — deleted elsewhere; a cached list still has it.
          this.invalidateTable(table);
          return null;
        }
        row = data as unknown as R;
      }
      if (options.expectedUpdatedAt && !sameInstant(options.expectedUpdatedAt, row.updated_at)) {
        // Refused before any write, so nothing reported the table: somebody
        // else's save is exactly what the cached list is missing.
        this.invalidateTable(table);
        throw new Error(CONCURRENT_EDIT_MESSAGE);
      }
      const patch = apply(row);
      if (!patch) return { row, written: null };
      const updatedAt = options.stamp === 'note' ? notedStamp(row.updated_at) : editedStamp(row.updated_at);
      const { data: written, error } = await getSupabase()
        .from(table)
        .update({ ...patch, updated_at: updatedAt })
        .eq('id', id)
        .eq('updated_at', row.updated_at)
        .select(options.returning ?? 'id');
      if (error) throw options.mapError ? options.mapError(error) : new Error(`${op}: ${error.message}`);
      if (written && written.length > 0) return { row, written: written[0] };
      // Written by somebody else since the read: read again, apply again on top.
      row = null;
    }
    throw new Error(`${op}: zapis się nie udał — te dane zmieniały się w tym czasie kilka razy z rzędu. Spróbuj ponownie.`);
  }

  constructor() {
    onTableWrite((table) => this.invalidateTable(table));
    // Keep the default store file ('config.json' in userData) so existing
    // settings (dark mode, folder paths, language) are preserved across the migration.
    // Legacy keys (banks, kontrahenci, adresy, history, nextBankId, …) are left in
    // place — the importer reads them later, then they can be cleared.
    this.settingsStore = new Store<SettingsStoreSchema>({
      defaults: {
        settings: {
          outputFolder: path.join(app.getPath('documents'), 'StatementConverter'),
          impexFolder: '',
          swrkFolder: '',
          statementsFolder: '',
          darkMode: true,
          language: 'pl',
          aiConfidenceThreshold: 95,
          alwaysUseAI: true,
          aiModel: DEFAULT_AI_MODEL,
          skipUserApproval: false,
          contractorSortOrder: 'name-asc',
          sidebarCollapsed: true,
          bookingsCollapsed: false,
          bookingsMonth: '',
          calendarHoverCard: false,
          lastSeenVersion: '',
          // home.pl defaults — the mailbox this is built for. Overridable in Settings.
          smtpHost: 'poczta.home.pl',
          smtpPort: 465,
          smtpSecure: true,
          smtpUser: '',
          smtpPass: '',
          smtpFromName: '',
          smtpBccSelf: false,
          podatkiFolder: '',
          podpisBiblioteka: '',
          eDeklaracjeSrodowisko: 'test',
        },
      },
    });
  }

  // ------------------------------ Banks ------------------------------

  async getAllBanks(): Promise<Bank[]> {
    const cached = this.cacheGet(this.cache.banks);
    if (cached) return cached;
    const rows = await fetchAllPaged<any>('getAllBanks', (from, to) =>
      getSupabase()
        .from('banks')
        .select(BANK_COLS)
        .order('name', { ascending: true })
        // A name is not unique (yet): the id keeps the pages from overlapping.
        .order('id', { ascending: true })
        .range(from, to),
    );
    const data = rows.map(b => ({ ...b, accountPrefixes: b.accountPrefixes ?? [] })) as Bank[];
    this.cache.banks = this.cacheSet(data);
    return data;
  }

  async addBank(name: string, converterId: string, accountPrefixes?: string[]): Promise<Bank> {
    const { data, error } = await getSupabase()
      .from('banks')
      .insert({
        name,
        converter_id: converterId,
        account_prefixes: accountPrefixes ?? [],
      })
      .select(BANK_COLS)
      .single();
    if ((error as { code?: string } | null)?.code === '23505') throw new Error(DatabaseService.BANK_TAKEN);
    const bank = unwrap(data, error, 'addBank') as Bank;
    this.invalidateCache('banks');
    return bank;
  }

  async updateBank(
    id: number,
    name: string,
    converterId: string,
    accountPrefixes?: string[],
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('banks')
      .update({
        name,
        converter_id: converterId,
        account_prefixes: accountPrefixes ?? [],
      })
      .eq('id', id);
    if ((error as { code?: string } | null)?.code === '23505') throw new Error(DatabaseService.BANK_TAKEN);
    if (error) throw new Error(`updateBank: ${error.message}`);
    this.invalidateCache('banks');
  }

  /** What a second bank (or community, below) of one name hits once unikalne-nazwy.sql has run. */
  private static readonly BANK_TAKEN = 'Bank o tej nazwie już istnieje.';
  private static readonly ADRES_TAKEN = 'Wspólnota o tej nazwie już istnieje.';

  async deleteBank(id: number): Promise<void> {
    const { error } = await getSupabase().from('banks').delete().eq('id', id);
    if (error) throw new Error(`deleteBank: ${error.message}`);
    this.invalidateCache('banks');
    // The communities that used it lost their bank (ON DELETE SET NULL).
    this.invalidateCache('adresy');
  }

  async deleteAllBanks(): Promise<void> {
    const { error } = await getSupabase().from('banks').delete().gt('id', 0);
    if (error) throw new Error(`deleteAllBanks: ${error.message}`);
    this.invalidateCache('banks');
  }

  async getBankById(id: number): Promise<Bank | undefined> {
    const { data, error } = await getSupabase()
      .from('banks')
      .select(BANK_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getBankById: ${error.message}`);
    return (data ?? undefined) as Bank | undefined;
  }

  /**
   * Upsert by bank name (case-insensitive): re-importing the same file updates
   * rows in place instead of piling up duplicates. New rows keep the file's
   * createdAt; ids are always assigned by Postgres.
   */
  async importBanks(banks: Bank[]): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    if (banks.length === 0) return { added, updated };
    this.invalidateCache('banks');
    const byName = new Map((await this.getAllBanks()).map(b => [b.name.trim().toLowerCase(), b]));
    for (const b of banks) {
      const existing = byName.get(b.name.trim().toLowerCase());
      if (existing) {
        await this.updateBank(existing.id, b.name.trim(), b.converterId, b.accountPrefixes ?? []);
        updated++;
      } else {
        const { error } = await getSupabase().from('banks').insert({
          name: b.name.trim(),
          converter_id: b.converterId,
          account_prefixes: b.accountPrefixes ?? [],
          ...(b.createdAt ? { created_at: b.createdAt } : {}),
        });
        if (error) throw new Error(`importBanks: ${error.message}`);
        added++;
      }
    }
    this.invalidateCache('banks');
    return { added, updated };
  }

  // ---------------------------- Kontrahenci ----------------------------

  async getAllKontrahenci(): Promise<Kontrahent[]> {
    const cached = this.cacheGet(this.cache.kontrahenci);
    if (cached) return cached;
    const rows = await fetchAllPaged<any>('getAllKontrahenci', (from, to) =>
      getSupabase()
        .from('kontrahenci')
        .select(KONTRAHENT_COLS)
        .order('nazwa', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    const data = rows.map(k => ({
      ...k,
      typy: normalizeTypy(k),
      alternativeNames: k.alternativeNames ?? [],
      nip: k.nip ?? undefined,
    })) as Kontrahent[];
    this.cache.kontrahenci = this.cacheSet(data);
    return data;
  }

  async addKontrahent(
    nazwa: string,
    kontoKontrahenta: string,
    nip?: string,
    alternativeNames?: string[],
    typy?: KontrahentTyp[],
  ): Promise<Kontrahent> {
    const finalTypy: KontrahentTyp[] = typy && typy.length > 0 ? typy : ['Kontrahent'];
    const { data, error } = await getSupabase()
      .from('kontrahenci')
      .insert({
        nazwa,
        konto_kontrahenta: kontoKontrahenta,
        nip: nip || null,
        // `typ` (scalar, legacy) mirrors the primary role; `typy` is the full set.
        typ: finalTypy[0],
        typy: finalTypy,
        alternative_names: alternativeNames ?? [],
      })
      .select(KONTRAHENT_COLS)
      .single();
    const row = unwrap(data, error, 'addKontrahent') as any;
    this.invalidateCache('kontrahenci');
    return { ...row, typy: normalizeTypy(row), nip: row.nip ?? undefined } as Kontrahent;
  }

  async updateKontrahent(
    id: number,
    nazwa: string,
    kontoKontrahenta: string,
    nip?: string,
    alternativeNames?: string[],
    typy?: KontrahentTyp[],
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      nazwa,
      konto_kontrahenta: kontoKontrahenta,
    };
    if (nip !== undefined) patch.nip = nip || null;
    if (typy !== undefined) {
      const finalTypy: KontrahentTyp[] = typy.length > 0 ? typy : ['Kontrahent'];
      patch.typy = finalTypy;
      patch.typ = finalTypy[0]; // keep legacy scalar in sync with the primary role
    }
    if (alternativeNames !== undefined) patch.alternative_names = alternativeNames;
    const { error } = await getSupabase().from('kontrahenci').update(patch).eq('id', id);
    if (error) throw new Error(`updateKontrahent: ${error.message}`);
    this.invalidateCache('kontrahenci');
  }

  async deleteKontrahent(id: number): Promise<void> {
    const { error } = await getSupabase().from('kontrahenci').delete().eq('id', id);
    if (error) throw new Error(`deleteKontrahent: ${error.message}`);
    this.invalidateCache('kontrahenci');
  }

  async deleteAllKontrahenci(): Promise<void> {
    const { error } = await getSupabase().from('kontrahenci').delete().gt('id', 0);
    if (error) throw new Error(`deleteAllKontrahenci: ${error.message}`);
    this.invalidateCache('kontrahenci');
  }

  async getKontrahentById(id: number): Promise<Kontrahent | undefined> {
    const { data, error } = await getSupabase()
      .from('kontrahenci')
      .select(KONTRAHENT_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getKontrahentById: ${error.message}`);
    if (!data) return undefined;
    return { ...(data as any), typy: normalizeTypy(data as any), nip: (data as Kontrahent).nip ?? undefined } as Kontrahent;
  }

  // ------------------------------ Adresy ------------------------------

  async getAllAdresy(): Promise<Adres[]> {
    const cached = this.cacheGet(this.cache.adresy);
    if (cached) return cached;
    const rows = await fetchAllPaged<any>('getAllAdresy', (from, to) =>
      getSupabase()
        .from('adresy')
        .select(ADRES_COLS)
        .order('nazwa', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    const data = rows.map(a => ({
      ...a,
      alternativeNames: a.alternativeNames ?? [],
      swrkIdentifiers: a.swrkIdentifiers ?? [],
      accountNumbers: a.accountNumbers ?? [],
      accountTypes: a.accountTypes ?? {},
      bankId: a.bankId ?? null,
      apartmentMappings: a.apartmentMappings ?? [],
      zgnJednostkaId: a.zgnJednostkaId ?? null,
      zarzad: DatabaseService.zarzadList(a.zarzad),
      identyfikacja: normalizeIdentyfikacja(a.identyfikacja),
    })) as Adres[];
    this.cache.adresy = this.cacheSet(data);
    return data;
  }

  /**
   * Canonicalize an account-numbers input list and assert that none of them
   * is already attached to a different Adres. Throws a user-readable error on
   * conflict — caller (IPC handler) propagates it back to the renderer.
   */
  private async sanitizeAccountNumbers(
    raw: string[] | undefined,
    excludeAdresId?: number,
  ): Promise<string[]> {
    if (!raw || raw.length === 0) return [];
    const canonical: string[] = [];
    for (const value of raw) {
      const norm = normalizeAccount(value);
      if (!norm) throw new Error(`Nieprawidłowy numer konta: "${value}" (oczekiwano 26 cyfr).`);
      if (!canonical.includes(norm)) canonical.push(norm);
    }

    const existing = await this.getAllAdresy();
    for (const acc of canonical) {
      const owner = existing.find(
        a => a.id !== excludeAdresId && (a.accountNumbers ?? []).some(x => normalizeAccount(x) === acc),
      );
      if (owner) {
        throw new Error(
          `Numer konta ${acc} jest już przypisany do adresu „${owner.nazwa}". Jedno konto może należeć tylko do jednego adresu.`,
        );
      }
    }
    return canonical;
  }

  /**
   * Drop blank entries and ensure every mapping has a stable id and trimmed
   * fields. A mapping needs a matchText and at least one apartment to be usable.
   *
   * The apartment list (one or many) is normalized by buildApartmentMapping: it
   * trims, deduplicates and keeps only real account symbols — a bare "17A" in the
   * account field would name the apartment while claiming to be its account, and
   * the exporters would have no way to tell the difference.
   */
  private sanitizeApartmentMappings(raw: ApartmentMapping[] | undefined): ApartmentMapping[] {
    if (!raw || raw.length === 0) return [];
    const out: ApartmentMapping[] = [];
    const seen = new Set<string>();
    for (const m of raw) {
      const matchText = (m.matchText ?? '').trim();
      if (!matchText) continue;
      // Guard against duplicate phrases (case-insensitive) within one address.
      const key = matchText.toLowerCase();
      if (seen.has(key)) continue;
      const mapping = buildApartmentMapping(
        { id: m.id || `${Date.now()}-${out.length}`, matchText, note: m.note },
        mappingTargets(m),
      );
      if (!mapping) continue;
      seen.add(key);
      out.push(mapping);
    }
    return out;
  }

  /**
   * Keep only account→type entries whose key is one of the (canonicalized)
   * account numbers and whose value is an existing KontoTyp id. Guards against
   * stale mappings after an account is removed or a type is deleted.
   */
  private async sanitizeAccountTypes(
    raw: Record<string, number> | undefined,
    accountNumbers: string[],
  ): Promise<Record<string, number>> {
    if (!raw) return {};
    const allowedAccounts = new Set(
      accountNumbers.map(normalizeAccount).filter((x): x is string => !!x),
    );
    const validTypeIds = new Set((await this.getKontoTypy()).map(t => t.id));
    const out: Record<string, number> = {};
    for (const [account, typeId] of Object.entries(raw)) {
      const norm = normalizeAccount(account);
      if (norm && allowedAccounts.has(norm) && validTypeIds.has(typeId)) {
        out[norm] = typeId;
      }
    }
    return out;
  }

  async addAdres(
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
    accountNumbers?: string[],
    apartmentMappings?: ApartmentMapping[],
    accountTypes?: Record<string, number>,
    zgnJednostkaId?: number | null,
  ): Promise<Adres> {
    const accounts = await this.sanitizeAccountNumbers(accountNumbers);
    const { data, error } = await getSupabase()
      .from('adresy')
      .insert({
        nazwa,
        alternative_names: alternativeNames ?? [],
        swrk_identifiers: swrkIdentifiers ?? [],
        account_numbers: accounts,
        account_types: await this.sanitizeAccountTypes(accountTypes, accounts),
        bank_id: bankId ?? null,
        apartment_mappings: this.sanitizeApartmentMappings(apartmentMappings),
        zgn_jednostka_id: zgnJednostkaId ?? null,
      })
      .select(ADRES_COLS)
      .single();
    if ((error as { code?: string } | null)?.code === '23505') throw new Error(DatabaseService.ADRES_TAKEN);
    const adres = unwrap(data, error, 'addAdres') as Adres;
    this.invalidateCache('adresy');
    return adres;
  }

  /**
   * A board as stored: people with a name, mailboxes trimmed, an id each. Reads
   * the same from a row, a backup or the renderer, so a hand-edited value never
   * reaches the table half-formed.
   */
  private static zarzadList(value: unknown): ZarzadOsoba[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw, i): ZarzadOsoba[] => {
      const p = (raw ?? {}) as Partial<ZarzadOsoba>;
      const imieNazwisko = String(p.imieNazwisko ?? '').trim();
      if (!imieNazwisko) return [];
      return [
        {
          id: String(p.id ?? '').trim() || `z${Date.now().toString(36)}${i}`,
          imieNazwisko,
          email: String(p.email ?? '').trim(),
        },
      ];
    });
  }

  /** A meeting's board members: the same people, without the list's ids. */
  private static spotkanieZarzad(value: unknown): SpotkanieZarzadOsoba[] {
    return DatabaseService.zarzadList(value).map(({ imieNazwisko, email }) => ({
      imieNazwisko,
      email,
    }));
  }

  async setAdresZarzad(id: number, zarzad: unknown): Promise<void> {
    const { error } = await getSupabase()
      .from('adresy')
      .update({ zarzad: DatabaseService.zarzadList(zarzad) })
      .eq('id', id);
    if (error) throw new Error(`setAdresZarzad: ${error.message}`);
    this.invalidateCache('adresy');
  }

  /** Replace a community's tax identification (NIP, full name, seat…) — the whole record, as the form holds it. */
  async setAdresIdentyfikacja(id: number, identyfikacja: unknown): Promise<void> {
    const { error } = await getSupabase()
      .from('adresy')
      .update({ identyfikacja: normalizeIdentyfikacja(identyfikacja) })
      .eq('id', id);
    if (error) throw new Error(`setAdresIdentyfikacja: ${error.message}`);
    this.invalidateCache('adresy');
  }

  /**
   * One-time fill of the tax identification from the DN-1 declarations: only
   * empty fields, only for communities the DN-1 names match. Afterwards the
   * data is kept by hand in Adresy.
   */
  async zasilAdresyZDn1(): Promise<AdresyZasilenieResult> {
    const [adresy, dn1] = await Promise.all([this.getAllAdresy(), this.getPodatkiNieruchomosci()]);
    const { patche, wynik } = zasilZDn1(adresy, dn1);
    for (const slice of DatabaseService.chunk(patche, 10)) {
      await Promise.all(slice.map((p) => this.setAdresIdentyfikacja(p.adresId, p.identyfikacja)));
    }
    return wynik;
  }

  async updateAdres(
    id: number,
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
    accountNumbers?: string[],
    apartmentMappings?: ApartmentMapping[],
    accountTypes?: Record<string, number>,
    zgnJednostkaId?: number | null,
  ): Promise<void> {
    const patch: Record<string, unknown> = { nazwa };
    if (alternativeNames !== undefined) patch.alternative_names = alternativeNames;
    if (swrkIdentifiers !== undefined) patch.swrk_identifiers = swrkIdentifiers;
    if (bankId !== undefined) patch.bank_id = bankId;
    if (zgnJednostkaId !== undefined) patch.zgn_jednostka_id = zgnJednostkaId;
    let sanitizedAccounts: string[] | undefined;
    if (accountNumbers !== undefined) {
      sanitizedAccounts = await this.sanitizeAccountNumbers(accountNumbers, id);
      patch.account_numbers = sanitizedAccounts;
    }
    if (accountTypes !== undefined) {
      // Constrain against the accounts being written (or, if accounts weren't
      // part of this update, the ones already stored).
      const accounts =
        sanitizedAccounts ?? (await this.getAdresById(id))?.accountNumbers ?? [];
      patch.account_types = await this.sanitizeAccountTypes(accountTypes, accounts);
    }
    if (apartmentMappings !== undefined) {
      patch.apartment_mappings = this.sanitizeApartmentMappings(apartmentMappings);
    }
    const { error } = await getSupabase().from('adresy').update(patch).eq('id', id);
    if ((error as { code?: string } | null)?.code === '23505') throw new Error(DatabaseService.ADRES_TAKEN);
    if (error) throw new Error(`updateAdres: ${error.message}`);
    this.invalidateCache('adresy');
  }

  async deleteAdres(id: number): Promise<void> {
    const { error } = await getSupabase().from('adresy').delete().eq('id', id);
    if (error) throw new Error(`deleteAdres: ${error.message}`);
    this.invalidateCache('adresy');
  }

  async deleteAllAdresy(): Promise<void> {
    const { error } = await getSupabase().from('adresy').delete().gt('id', 0);
    if (error) throw new Error(`deleteAllAdresy: ${error.message}`);
    this.invalidateCache('adresy');
  }

  async getAdresById(id: number): Promise<Adres | undefined> {
    const { data, error } = await getSupabase()
      .from('adresy')
      .select(ADRES_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getAdresById: ${error.message}`);
    return (data ?? undefined) as Adres | undefined;
  }

  // ---------------------------- Konto typy ----------------------------

  async getKontoTypy(): Promise<KontoTyp[]> {
    const cached = this.cacheGet(this.cache.kontoTypy);
    if (cached) return cached;
    const { data, error } = await getSupabase()
      .from('konto_typy')
      .select(KONTO_TYP_COLS)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`getKontoTypy: ${error.message}`);
    const rows = (data ?? []) as KontoTyp[];
    this.cache.kontoTypy = this.cacheSet(rows);
    return rows;
  }

  /** Clear is_default on every other row so exactly one type stays default. */
  private async clearDefaultKontoTyp(exceptId?: number): Promise<void> {
    let query = getSupabase().from('konto_typy').update({ is_default: false }).eq('is_default', true);
    if (exceptId !== undefined) query = query.neq('id', exceptId);
    const { error } = await query;
    if (error) throw new Error(`clearDefaultKontoTyp: ${error.message}`);
  }

  async addKontoTyp(
    name: string,
    bankAccountSymbol: string,
    apartmentPrefix: string,
    isDefault: boolean,
  ): Promise<KontoTyp> {
    if (isDefault) await this.clearDefaultKontoTyp();
    const { data, error } = await getSupabase()
      .from('konto_typy')
      .insert({
        name,
        bank_account_symbol: bankAccountSymbol,
        apartment_prefix: apartmentPrefix,
        is_default: isDefault,
      })
      .select(KONTO_TYP_COLS)
      .single();
    const kontoTyp = unwrap(data, error, 'addKontoTyp') as KontoTyp;
    this.invalidateCache('kontoTypy');
    return kontoTyp;
  }

  async updateKontoTyp(
    id: number,
    name: string,
    bankAccountSymbol: string,
    apartmentPrefix: string,
    isDefault: boolean,
  ): Promise<void> {
    if (isDefault) await this.clearDefaultKontoTyp(id);
    const { error } = await getSupabase()
      .from('konto_typy')
      .update({
        name,
        bank_account_symbol: bankAccountSymbol,
        apartment_prefix: apartmentPrefix,
        is_default: isDefault,
      })
      .eq('id', id);
    if (error) throw new Error(`updateKontoTyp: ${error.message}`);
    this.invalidateCache('kontoTypy');
  }

  async deleteKontoTyp(id: number): Promise<void> {
    const { error } = await getSupabase().from('konto_typy').delete().eq('id', id);
    if (error) throw new Error(`deleteKontoTyp: ${error.message}`);
    this.invalidateCache('kontoTypy');
  }

  /**
   * Upsert by type name (case-insensitive). add/update already enforce the
   * single-default invariant, so an imported default demotes the current one.
   */
  async importKontoTypy(rows: KontoTyp[]): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    if (rows.length === 0) return { added, updated };
    this.invalidateCache('kontoTypy');
    const byName = new Map((await this.getKontoTypy()).map(t => [t.name.trim().toLowerCase(), t]));
    for (const r of rows) {
      const existing = byName.get(r.name.trim().toLowerCase());
      if (existing) {
        await this.updateKontoTyp(existing.id, r.name.trim(), r.bankAccountSymbol, r.apartmentPrefix, r.isDefault);
        updated++;
      } else {
        await this.addKontoTyp(r.name.trim(), r.bankAccountSymbol, r.apartmentPrefix, r.isDefault);
        added++;
      }
    }
    return { added, updated };
  }

  // ----------------------------- History -----------------------------

  async addConversionHistory(data: {
    fileName: string;
    bankName: string;
    converterName: string;
    status: 'success' | 'error';
    errorMessage?: string;
    inputPath: string;
    outputPath: string;
    /** Community the file was converted for — powers the "Księgowania" view. */
    adresId?: number | null;
    /** The month the statement covers (`YYYY-MM`), when it could be read. */
    monthKey?: string | null;
    /** SHA-1 of the input file, when it could be read. */
    inputHash?: string | null;
  }): Promise<{ error: string | null }> {
    // The name is stored next to the id on purpose: a restore renumbers the
    // addresses, and the name is what the Księgowania view falls back to.
    let adresNazwa: string | null = null;
    if (data.adresId != null) {
      try {
        adresNazwa = (await this.getAdresById(data.adresId))?.nazwa ?? null;
      } catch {
        adresNazwa = null; // best-effort label; never fail a conversion over it
      }
    }
    const row = {
      file_name: data.fileName,
      bank_name: data.bankName,
      converter_name: data.converterName,
      status: data.status,
      error_message: data.errorMessage || null,
      input_path: data.inputPath,
      output_path: data.outputPath,
      // One instant for both rows, so the record and its log line say the same
      // time — two separate `now()`s made them unmatchable.
      converted_at: new Date().toISOString(),
      adres_id: data.adresId ?? null,
      adres_nazwa: adresNazwa,
    };
    // Twice, on purpose: `ksiegowania_konwersje` is the dashboard's own record
    // with the DOM tick — what the Pulpit, the folder scan and the "already
    // processed" warning read — so it goes first; `history` is the log (the
    // Historia module, free to clear). Both are attempted whatever the other
    // did, and neither throws: by now the output file exists, so a failed write
    // must not turn a finished conversion into a failed one — the caller tells
    // the user instead.
    const { error: bookingError } = await this.insertKsKonwersja({
      ...row,
      month_key: data.monthKey ?? null,
      input_hash: data.inputHash ?? null,
    });
    if (bookingError) log.error(`[KSIEGOWANIA] conversion record not saved: ${bookingError.message}`);
    const { error: historyError } = await getSupabase().from('history').insert(row);
    if (historyError) log.error(`[HISTORY] conversion log entry not saved: ${historyError.message}`);
    const problems = [
      bookingError ? `ksiegowania_konwersje: ${bookingError.message}` : null,
      historyError ? `history: ${historyError.message}` : null,
    ].filter((p): p is string => p !== null);
    return { error: problems.length > 0 ? problems.join('; ') : null };
  }

  async getAllHistory(): Promise<ConversionHistory[]> {
    const rows = await fetchAllPaged<any>('getAllHistory', (from, to) =>
      getSupabase()
        .from('history')
        .select(HISTORY_COLS)
        .order('converted_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
    return rows.map(h => ({
      ...h,
      errorMessage: h.errorMessage ?? undefined,
      bookedInDom: h.bookedInDom === true,
    })) as ConversionHistory[];
  }

  /**
   * The dashboard's own record of conversions (Pulpit → Księgowania), with the
   * DOM tick. Same shape as the history, but its own table: clearing the
   * history log leaves it — and the team's posting state — untouched.
   */
  async getKsiegowaniaKonwersje(): Promise<ConversionHistory[]> {
    const read = (cols: string) =>
      fetchAllPaged<any>('getKsiegowaniaKonwersje', (from, to) =>
        getSupabase()
          .from('ksiegowania_konwersje')
          .select(cols)
          .order('converted_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      );
    // A column a migration has not added yet is left out, not the whole read:
    // the records still load, just without that fact (month, hash, manual mark).
    const optional = { ...KS_KONWERSJE_OPTIONAL };
    let rows: any[];
    for (;;) {
      try {
        rows = await read([HISTORY_COLS, ...Object.values(optional)].join(', '));
        break;
      } catch (error: unknown) {
        const missing = missingColumn(error instanceof Error ? error.message : String(error), Object.keys(optional));
        if (!missing) throw error;
        log.warn(`[KSIEGOWANIA] column ksiegowania_konwersje.${missing} is missing — run its migration`);
        delete optional[missing];
      }
    }
    return rows.map(h => ({
      ...h,
      errorMessage: h.errorMessage ?? undefined,
      bookedInDom: h.bookedInDom === true,
      manual: h.manual === true,
      discardedAt: h.discardedAt ?? null,
      discardedBy: h.discardedBy ?? null,
    })) as ConversionHistory[];
  }

  /**
   * "Oznacz jako zaksięgowane": a pinned statement posted without converting it.
   * Writes a dashboard record tied to the statement (its name and hash, its
   * month and community) with no output file, already ticked in DOM.
   */
  async markKsiegowaniePlikBooked(plikId: number, by: string | null): Promise<void> {
    const { data, error } = await getSupabase()
      .from('ksiegowania_pliki')
      .select(KS_PLIK_COLS)
      .eq('id', plikId)
      .maybeSingle();
    if (error) throw new Error(`markKsiegowaniePlikBooked: ${error.message}`);
    const plik = data as unknown as KsiegowaniePlik | null;
    if (!plik) throw new Error('markKsiegowaniePlikBooked: the file is no longer pinned');
    if (plik.kind !== 'statement' || plik.status !== 'ok') {
      throw new Error('markKsiegowaniePlikBooked: only a readable statement can be marked');
    }
    const now = new Date().toISOString();
    const { error: insertError } = await this.insertKsKonwersja({
        file_name: plik.fileName,
        bank_name: plik.bankName ?? '',
        converter_name: '',
        status: 'success',
        error_message: null,
        input_path: plik.relPath,
        output_path: '',
        converted_at: now,
        adres_id: plik.adresId,
        adres_nazwa: plik.adresNazwa,
        booked_in_dom: true,
        booked_in_dom_at: now,
        booked_in_dom_by: by,
        month_key: plik.monthKey,
        input_hash: plik.fileHash,
        recznie: true,
      }, ['recznie']);
    if (insertError) throw new Error(`markKsiegowaniePlikBooked: ${insertError.message}`);
  }

  /**
   * Insert one dashboard record, leaving out an optional column the database
   * does not have yet (see `KS_KONWERSJE_OPTIONAL`) — except those in
   * `required`, without which the record would mean something else.
   */
  private async insertKsKonwersja(
    row: Record<string, unknown>,
    required: string[] = [],
  ): Promise<{ error: { message: string } | null }> {
    const values = { ...row };
    for (;;) {
      const { error } = await getSupabase().from('ksiegowania_konwersje').insert(values);
      if (!error) return { error: null };
      const droppable = Object.keys(KS_KONWERSJE_OPTIONAL).filter((c) => c in values && !required.includes(c));
      const missing = missingColumn(error.message, droppable);
      if (!missing) return { error };
      log.warn(`[KSIEGOWANIA] column ksiegowania_konwersje.${missing} is missing — run its migration`);
      delete values[missing];
    }
  }

  /** Undo a manual mark. Guarded by the flag: a real conversion is never deleted here. */
  async undoKsiegowanieManual(id: number): Promise<void> {
    const { error } = await getSupabase()
      .from('ksiegowania_konwersje')
      .delete()
      .eq('id', id)
      .eq('recznie', true);
    if (error) throw new Error(`undoKsiegowanieManual: ${error.message}`);
  }

  /**
   * "Odrzuć — duplikat" / "Przywróć". Only a real conversion not yet ticked in
   * DOM can be discarded: a posted file is not a duplicate to throw away, and a
   * manual mark has its own undo. Restoring is always allowed.
   */
  async setKsiegowanieDiscarded(id: number, discarded: boolean, by: string | null): Promise<void> {
    let query = getSupabase()
      .from('ksiegowania_konwersje')
      .update(
        discarded
          ? { odrzucone_at: new Date().toISOString(), odrzucone_by: by }
          : { odrzucone_at: null, odrzucone_by: null },
      )
      .eq('id', id);
    if (discarded) query = query.eq('booked_in_dom', false).eq('status', 'success');
    const { data, error } = await query.select('id');
    if (error) {
      if (missingColumn(error.message, ['odrzucone_at', 'odrzucone_by'])) {
        throw new Error('Brak kolumny odrzucone_at — uruchom supabase/ksiegowania-odrzucone.sql');
      }
      throw new Error(`setKsiegowanieDiscarded: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new Error('setKsiegowanieDiscarded: the conversion is gone or already posted in DOM');
    }
  }

  /**
   * Record what an older conversion did not: the statement month and the input
   * file's hash, read from its source file afterwards. Only the given fields change.
   */
  async setKsiegowanieSourceFacts(
    id: number,
    facts: { monthKey?: string; inputHash?: string },
  ): Promise<void> {
    const patch: Record<string, string> = {};
    if (facts.monthKey) patch.month_key = facts.monthKey;
    if (facts.inputHash) patch.input_hash = facts.inputHash;
    if (Object.keys(patch).length === 0) return;
    const { error } = await getSupabase().from('ksiegowania_konwersje').update(patch).eq('id', id);
    if (error) throw new Error(`setKsiegowanieSourceFacts: ${error.message}`);
  }

  /**
   * Tick / untick "posted in the DOM program" for whole batches of the
   * dashboard's conversion records at once — the Księgowania view marks a
   * single file, a community's month or everything shown, and all three land here.
   */
  async setKsiegowanieBookedInDom(ids: number[], booked: boolean, by?: string | null): Promise<void> {
    if (ids.length === 0) return;
    const patch = booked
      ? { booked_in_dom: true, booked_in_dom_at: new Date().toISOString(), booked_in_dom_by: by ?? null }
      : { booked_in_dom: false, booked_in_dom_at: null, booked_in_dom_by: null };
    for (const slice of DatabaseService.chunk(ids)) {
      const { error } = await getSupabase().from('ksiegowania_konwersje').update(patch).in('id', slice);
      if (error) throw new Error(`setKsiegowanieBookedInDom: ${error.message}`);
    }
  }

  /** Clears the LOG only. The dashboard's records (`ksiegowania_konwersje`) stay. */
  async clearHistory(): Promise<void> {
    const { error } = await getSupabase().from('history').delete().gt('id', 0);
    if (error) throw new Error(`clearHistory: ${error.message}`);
  }

  /**
   * Merge-import: only entries whose (convertedAt, fileName) pair isn't already
   * present are inserted, so re-importing the same file is a no-op.
   */
  async importHistory(rows: ConversionHistory[]): Promise<{ added: number; skipped: number }> {
    const seen = new Set((await this.getAllHistory()).map(h => `${h.convertedAt}|${h.fileName}`));
    const fresh = rows.filter(h => !seen.has(`${h.convertedAt}|${h.fileName}`));
    await this.insertChunked(
      'history',
      fresh.map(h => ({
        file_name: h.fileName,
        bank_name: h.bankName,
        converter_name: h.converterName,
        status: h.status,
        error_message: h.errorMessage || null,
        input_path: h.inputPath,
        output_path: h.outputPath,
        converted_at: h.convertedAt,
        // Ids come from whichever install wrote the file, so only the name is
        // trustworthy here; the view resolves the community from it.
        adres_id: null,
        adres_nazwa: h.adresNazwa ?? null,
        // No DOM tick: the posting state lives in `ksiegowania_konwersje`, and
        // a tick in the log would be a second, clearable copy of it.
      })),
    );
    return { added: fresh.length, skipped: rows.length - fresh.length };
  }

  // ------------------- Odczyty liczników — history -------------------

  async addOdczytyHistory(data: Omit<OdczytyHistoryEntry, 'id' | 'convertedAt'>): Promise<void> {
    const { error } = await getSupabase().from('odczyty_history').insert({
      supplier: data.supplier,
      status: data.status,
      error_message: data.errorMessage || null,
      output_dir: data.outputDir,
      source_files: data.sources,
      output_files: data.outputs,
      reading_count: data.readingCount,
      skipped_count: data.skippedCount,
    });
    if (error) throw new Error(`addOdczytyHistory: ${error.message}`);
  }

  async getOdczytyHistory(): Promise<OdczytyHistoryEntry[]> {
    const rows = await fetchAllPaged<any>('getOdczytyHistory', (from, to) =>
      getSupabase()
        .from('odczyty_history')
        .select(ODCZYTY_HISTORY_COLS)
        .order('converted_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
    return rows.map(r => ({
      ...r,
      errorMessage: r.errorMessage ?? undefined,
      sources: Array.isArray(r.sources) ? r.sources : [],
      outputs: Array.isArray(r.outputs) ? r.outputs : [],
    })) as OdczytyHistoryEntry[];
  }

  async clearOdczytyHistory(): Promise<void> {
    const { error } = await getSupabase().from('odczyty_history').delete().gt('id', 0);
    if (error) throw new Error(`clearOdczytyHistory: ${error.message}`);
  }

  /** Merge-import keyed on (convertedAt, supplier), mirroring importHistory. */
  async importOdczytyHistory(
    rows: OdczytyHistoryEntry[],
  ): Promise<{ added: number; skipped: number }> {
    const key = (h: OdczytyHistoryEntry) => `${h.convertedAt}|${h.supplier}`;
    const seen = new Set((await this.getOdczytyHistory()).map(key));
    const fresh = rows.filter(h => !seen.has(key(h)));
    await this.insertChunked(
      'odczyty_history',
      fresh.map(h => ({
        supplier: h.supplier,
        status: h.status,
        error_message: h.errorMessage || null,
        output_dir: h.outputDir,
        source_files: h.sources,
        output_files: h.outputs,
        reading_count: h.readingCount,
        skipped_count: h.skippedCount,
        converted_at: h.convertedAt,
      })),
    );
    return { added: fresh.length, skipped: rows.length - fresh.length };
  }

  // ------------------- Podpis kwalifikowany — history -------------------

  /** One run of the Podpis module: a single PIN, one certificate, the files it handled. */
  async addPodpisHistoria(data: {
    signedBy: string;
    podpis: PodpisSlad | null;
    pliki: PodpisHistoriaPlik[];
    przerwano: string | null;
  }): Promise<void> {
    const { error } = await getSupabase().from('podpisy_historia').insert({
      signed_by: data.signedBy,
      podmiot: data.podpis?.podmiot ?? '',
      wystawca: data.podpis?.wystawca ?? '',
      numer_seryjny: data.podpis?.numerSeryjny ?? '',
      pliki: data.pliki,
      podpisanych: data.pliki.filter(p => p.status === 'podpisany').length,
      przerwano: data.przerwano,
    });
    if (error) throw new Error(`addPodpisHistoria: ${error.message}`);
  }

  async getPodpisHistoria(): Promise<PodpisHistoriaEntry[]> {
    const rows = await fetchAllPaged<any>('getPodpisHistoria', (from, to) =>
      getSupabase()
        .from('podpisy_historia')
        .select(PODPIS_HISTORIA_COLS)
        .order('signed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
    return rows.map(r => ({
      id: r.id,
      signedAt: r.signedAt,
      signedBy: r.signedBy ?? '',
      podpis: r.podmiot ? { podmiot: r.podmiot, wystawca: r.wystawca ?? '', numerSeryjny: r.numerSeryjny ?? '' } : null,
      pliki: Array.isArray(r.pliki) ? r.pliki : [],
      podpisanych: r.podpisanych ?? 0,
      przerwano: r.przerwano ?? null,
    }));
  }

  async clearPodpisHistoria(): Promise<void> {
    const { error } = await getSupabase().from('podpisy_historia').delete().gt('id', 0);
    if (error) throw new Error(`clearPodpisHistoria: ${error.message}`);
  }

  // ------------------------ Mailing — jednostki ZGN ------------------------

  async getZgnJednostki(): Promise<ZgnJednostka[]> {
    const { data, error } = await getSupabase()
      .from('zgn_jednostki')
      .select(ZGN_COLS)
      .order('nazwa', { ascending: true });
    if (error) throw new Error(`getZgnJednostki: ${error.message}`);
    return (data ?? []) as ZgnJednostka[];
  }

  async addZgnJednostka(nazwa: string, email: string): Promise<ZgnJednostka> {
    const { data, error } = await getSupabase()
      .from('zgn_jednostki')
      .insert({ nazwa: nazwa.trim(), email: email.trim() })
      .select(ZGN_COLS)
      .single();
    return unwrap(data, error, 'addZgnJednostka') as ZgnJednostka;
  }

  async updateZgnJednostka(id: number, nazwa: string, email: string): Promise<void> {
    const { error } = await getSupabase()
      .from('zgn_jednostki')
      .update({ nazwa: nazwa.trim(), email: email.trim() })
      .eq('id', id);
    if (error) throw new Error(`updateZgnJednostka: ${error.message}`);
  }

  /**
   * Delete a unit. `adresy.zgn_jednostka_id` is ON DELETE SET NULL, so the
   * addresses survive — they simply stop being mailable until a unit is picked
   * again. The caller warns about how many addresses that affects.
   */
  async deleteZgnJednostka(id: number): Promise<void> {
    const { error } = await getSupabase().from('zgn_jednostki').delete().eq('id', id);
    if (error) throw new Error(`deleteZgnJednostka: ${error.message}`);
    this.invalidateCache('adresy');
  }

  /**
   * Make a unit serve exactly `adresIds`: those addresses point at it (taking it
   * over from whichever unit they had), and the ones that pointed at it but are
   * no longer listed lose their unit. Lets the unit form assign its communities
   * in one go instead of editing every address.
   */
  async setZgnJednostkaAdresy(jednostkaId: number, adresIds: number[]): Promise<void> {
    const ids = [...new Set(adresIds.filter((id) => Number.isInteger(id) && id > 0))];
    let release = getSupabase()
      .from('adresy')
      .update({ zgn_jednostka_id: null })
      .eq('zgn_jednostka_id', jednostkaId);
    if (ids.length > 0) release = release.not('id', 'in', `(${ids.join(',')})`);
    const { error: releaseError } = await release;
    if (releaseError) throw new Error(`setZgnJednostkaAdresy: ${releaseError.message}`);
    if (ids.length > 0) {
      const { error } = await getSupabase()
        .from('adresy')
        .update({ zgn_jednostka_id: jednostkaId })
        .in('id', ids);
      if (error) throw new Error(`setZgnJednostkaAdresy: ${error.message}`);
    }
    this.invalidateCache('adresy');
  }

  // ------------------------- Jednostki ZGN — pełnomocnicy -------------------------

  async getZgnPelnomocnicy(): Promise<ZgnPelnomocnik[]> {
    const { data, error } = await getSupabase()
      .from('zgn_pelnomocnicy')
      .select(ZGN_PELNOMOCNIK_COLS)
      .order('imie_nazwisko', { ascending: true });
    if (error) throw new Error(`getZgnPelnomocnicy: ${error.message}`);
    return (data ?? []) as unknown as ZgnPelnomocnik[];
  }

  async addZgnPelnomocnik(
    jednostkaId: number,
    imieNazwisko: string,
    email: string,
  ): Promise<ZgnPelnomocnik> {
    const name = (imieNazwisko ?? '').trim();
    if (!name) throw new Error('Pełnomocnik musi mieć imię i nazwisko.');
    const { data, error } = await getSupabase()
      .from('zgn_pelnomocnicy')
      .insert({ jednostka_id: jednostkaId, imie_nazwisko: name, email: (email ?? '').trim() })
      .select(ZGN_PELNOMOCNIK_COLS)
      .single();
    return unwrap(data, error, 'addZgnPelnomocnik') as unknown as ZgnPelnomocnik;
  }

  async updateZgnPelnomocnik(id: number, imieNazwisko: string, email: string): Promise<void> {
    const name = (imieNazwisko ?? '').trim();
    if (!name) throw new Error('Pełnomocnik musi mieć imię i nazwisko.');
    const { error } = await getSupabase()
      .from('zgn_pelnomocnicy')
      .update({ imie_nazwisko: name, email: (email ?? '').trim() })
      .eq('id', id);
    if (error) throw new Error(`updateZgnPelnomocnik: ${error.message}`);
  }

  /** Meetings that named this proxy keep their `zgn_nazwa`; only the link goes. */
  async deleteZgnPelnomocnik(id: number): Promise<void> {
    const { error } = await getSupabase().from('zgn_pelnomocnicy').delete().eq('id', id);
    if (error) throw new Error(`deleteZgnPelnomocnik: ${error.message}`);
  }

  // ------------------------- Mailing — typy mailingu -------------------------

  /** A stored recipient config, made whole: unknown shapes read as "the city unit". */
  static mailingAdresaci(value: unknown): MailingAdresaci {
    const a = (value && typeof value === 'object' ? value : {}) as Partial<MailingAdresaci>;
    const wlasne = Array.isArray(a.wlasne)
      ? [...new Set(a.wlasne.map(e => String(e ?? '').trim()).filter(Boolean))]
      : [];
    if (!value || typeof value !== 'object') {
      return { zgn: true, pelnomocnik: false, zarzad: false, wlasne: [] };
    }
    return {
      zgn: a.zgn === true,
      pelnomocnik: a.pelnomocnik === true,
      zarzad: a.zarzad === true,
      wlasne,
    };
  }

  private static mailingTypRow(r: any): MailingTypDef {
    return {
      id: r.id,
      klucz: r.klucz,
      nazwa: r.nazwa ?? '',
      opis: r.opis ?? '',
      systemowy: r.systemowy === true,
      adresaci: DatabaseService.mailingAdresaci(r.adresaci),
      createdAt: r.createdAt,
    };
  }

  /**
   * The built-in kinds, as they are created when missing: the Kalendarz and
   * Zebrania flows look templates up by these keys, so they can never be absent
   * (the SQL that seeds them may have been run before they existed).
   */
  private static readonly BUILTIN_MAILING_TYPY: {
    klucz: string;
    nazwa: string;
    opis: string;
    adresaci: MailingAdresaci;
  }[] = [
    {
      klucz: MAILING_TYP_ZAWIADOMIENIE,
      nazwa: MAILING_TYP_ZAWIADOMIENIE_NAZWA,
      opis: 'Zawiadomienie o zebraniu wspólnoty — tworzone ze spotkania w Kalendarzu lub z modułu Zebrania.',
      adresaci: { zgn: false, pelnomocnik: false, zarzad: true, wlasne: [] },
    },
    {
      klucz: MAILING_TYP_UCHWALA,
      nazwa: MAILING_TYP_UCHWALA_NAZWA,
      opis: 'Uchwały wspólnoty — dodawane do zebrania w zakładce „Uchwały” modułu Zebrania.',
      adresaci: { zgn: false, pelnomocnik: false, zarzad: false, wlasne: [] },
    },
  ];

  /** The fixed name of a built-in kind (a trigger refuses any other); null for an ordinary kind. */
  private static builtinMailingTypNazwa(klucz: string): string | null {
    return DatabaseService.BUILTIN_MAILING_TYPY.find(t => t.klucz === klucz)?.nazwa ?? null;
  }

  /**
   * Every kind, the built-in ones first. A built-in row that is missing is
   * created here, so the dictionary can never lack it.
   */
  async getMailingTypy(): Promise<MailingTypDef[]> {
    const read = async () => {
      const { data, error } = await getSupabase()
        .from('mailing_typy')
        .select(MAILING_TYP_COLS)
        .order('nazwa', { ascending: true });
      if (error) throw new Error(`getMailingTypy: ${error.message}`);
      return (data ?? []).map(DatabaseService.mailingTypRow);
    };
    let typy = await read();
    const missing = DatabaseService.BUILTIN_MAILING_TYPY.filter(b => !typy.some(t => t.klucz === b.klucz));
    if (missing.length > 0) {
      const { error } = await getSupabase()
        .from('mailing_typy')
        .upsert(
          missing.map(b => ({ klucz: b.klucz, nazwa: b.nazwa, opis: b.opis, systemowy: true, adresaci: b.adresaci })),
          { onConflict: 'klucz', ignoreDuplicates: true },
        );
      if (error) throw new Error(`getMailingTypy (typ wbudowany): ${error.message}`);
      typy = await read();
    }
    return [...typy.filter(t => t.systemowy), ...typy.filter(t => !t.systemowy)];
  }

  /** A key for a new kind: readable, and unique without a round trip. */
  private static mailingTypKlucz(nazwa: string): string {
    const slug = nazwa
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `${slug || 'typ'}-${randomUUID().slice(0, 8)}`;
  }

  async addMailingTyp(nazwa: string, opis: string, adresaci: MailingAdresaci): Promise<MailingTypDef> {
    const name = (nazwa ?? '').trim();
    if (!name) throw new Error('Typ mailingu musi mieć nazwę.');
    const { data, error } = await getSupabase()
      .from('mailing_typy')
      .insert({
        klucz: DatabaseService.mailingTypKlucz(name),
        nazwa: name,
        opis: (opis ?? '').trim(),
        systemowy: false,
        adresaci: DatabaseService.mailingAdresaci(adresaci),
      })
      .select(MAILING_TYP_COLS)
      .single();
    return DatabaseService.mailingTypRow(unwrap(data, error, 'addMailingTyp'));
  }

  /**
   * Save a kind. The built-in one keeps its name whatever is sent — only its
   * description and default recipients are the office's to change.
   */
  async updateMailingTyp(
    id: number,
    nazwa: string,
    opis: string,
    adresaci: MailingAdresaci,
  ): Promise<void> {
    const { data: before, error: readError } = await getSupabase()
      .from('mailing_typy')
      .select('systemowy')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`updateMailingTyp (odczyt): ${readError.message}`);
    const systemowy = (before as { systemowy?: boolean } | null)?.systemowy === true;
    const name = (nazwa ?? '').trim();
    if (!systemowy && !name) throw new Error('Typ mailingu musi mieć nazwę.');
    const { error } = await getSupabase()
      .from('mailing_typy')
      .update({
        ...(systemowy ? {} : { nazwa: name }),
        opis: (opis ?? '').trim(),
        adresaci: DatabaseService.mailingAdresaci(adresaci),
      })
      .eq('id', id);
    if (error) throw new Error(`updateMailingTyp: ${error.message}`);
  }

  /**
   * Delete a kind. Refused for the built-in one, and while templates still use
   * it: a template of a kind that no longer exists would vanish from every
   * picker without anyone having decided to delete it.
   */
  async deleteMailingTyp(id: number): Promise<void> {
    const { data: row, error: readError } = await getSupabase()
      .from('mailing_typy')
      .select('klucz, nazwa, systemowy')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`deleteMailingTyp (odczyt): ${readError.message}`);
    if (!row) return;
    const typ = row as { klucz: string; nazwa: string; systemowy: boolean };
    if (typ.systemowy) {
      throw new Error(`Typ „${typ.nazwa}” jest wbudowany i nie może zostać usunięty.`);
    }
    const { count, error: countError } = await getSupabase()
      .from('mailing_szablony')
      .select('id', { count: 'exact', head: true })
      .eq('typ', typ.klucz);
    if (countError) throw new Error(`deleteMailingTyp (szablony): ${countError.message}`);
    if ((count ?? 0) > 0) {
      throw new Error(
        `Typ „${typ.nazwa}” ma przypisane szablony (${count}). Przenieś je do innego typu albo usuń, zanim usuniesz typ.`,
      );
    }
    // Fields bound to the kind go back to "every kind" rather than staying bound
    // to a key no template can carry — they would be offered nowhere.
    const { error: polaError } = await getSupabase()
      .from('mailing_pola')
      .update({ typ: null })
      .eq('typ', typ.klucz);
    if (polaError) throw new Error(`deleteMailingTyp (pola): ${polaError.message}`);
    const { error } = await getSupabase().from('mailing_typy').delete().eq('id', id);
    if (error) throw new Error(`deleteMailingTyp: ${error.message}`);
  }

  // ------------------------ Mailing — pola dynamiczne ------------------------

  async getMailingPola(): Promise<MailingPole[]> {
    const { data, error } = await getSupabase()
      .from('mailing_pola')
      .select(MAILING_POLE_COLS)
      .order('nazwa', { ascending: true });
    if (error) throw new Error(`getMailingPola: ${error.message}`);
    return (data ?? []) as MailingPole[];
  }

  async addMailingPole(
    nazwa: string,
    tekst: string,
    jednostka: string,
    typWartosci: MailingPoleTyp,
    typ: string | null,
  ): Promise<MailingPole> {
    const { data, error } = await getSupabase()
      .from('mailing_pola')
      .insert({
        nazwa: nazwa.trim(),
        tekst,
        jednostka: jednostka.trim(),
        typ_wartosci: typWartosci,
        typ: typ || null,
      })
      .select(MAILING_POLE_COLS)
      .single();
    return unwrap(data, error, 'addMailingPole') as MailingPole;
  }

  async updateMailingPole(
    id: number,
    nazwa: string,
    tekst: string,
    jednostka: string,
    typWartosci: MailingPoleTyp,
    typ: string | null,
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('mailing_pola')
      .update({
        nazwa: nazwa.trim(),
        tekst,
        jednostka: jednostka.trim(),
        typ_wartosci: typWartosci,
        typ: typ || null,
      })
      .eq('id', id);
    if (error) throw new Error(`updateMailingPole: ${error.message}`);
  }

  async deleteMailingPole(id: number): Promise<void> {
    const { error } = await getSupabase().from('mailing_pola').delete().eq('id', id);
    if (error) throw new Error(`deleteMailingPole: ${error.message}`);
  }

  // -------------------------- Mailing — szablony --------------------------

  async getMailingSzablony(): Promise<MailingSzablon[]> {
    const { data, error } = await getSupabase()
      .from('mailing_szablony')
      .select(MAILING_SZABLON_COLS)
      .order('nazwa', { ascending: true });
    if (error) throw new Error(`getMailingSzablony: ${error.message}`);
    return (data ?? []) as MailingSzablon[];
  }

  async addMailingSzablon(
    data: Omit<MailingSzablon, 'id' | 'createdAt'>,
  ): Promise<MailingSzablon> {
    const { data: row, error } = await getSupabase()
      .from('mailing_szablony')
      .insert({
        nazwa: data.nazwa.trim(),
        typ: data.typ,
        temat: data.temat,
        tresc: data.tresc,
        attach_pdf: data.attachPdf,
        table_fields: data.tableFields ?? [],
      })
      .select(MAILING_SZABLON_COLS)
      .single();
    return unwrap(row, error, 'addMailingSzablon') as MailingSzablon;
  }

  async updateMailingSzablon(
    id: number,
    data: Omit<MailingSzablon, 'id' | 'createdAt'>,
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('mailing_szablony')
      .update({
        nazwa: data.nazwa.trim(),
        typ: data.typ,
        temat: data.temat,
        tresc: data.tresc,
        attach_pdf: data.attachPdf,
        table_fields: data.tableFields ?? [],
      })
      .eq('id', id);
    if (error) throw new Error(`updateMailingSzablon: ${error.message}`);
  }

  async deleteMailingSzablon(id: number): Promise<void> {
    const { error } = await getSupabase().from('mailing_szablony').delete().eq('id', id);
    if (error) throw new Error(`deleteMailingSzablon: ${error.message}`);
  }

  // --------------------------- Mailing — historia ---------------------------

  async addMailingHistory(entry: Omit<MailingHistoryEntry, 'id' | 'sentAt'>): Promise<void> {
    const { error } = await getSupabase().from('mailing_history').insert({
      typ: entry.typ,
      template_name: entry.templateName,
      status: entry.status,
      error_message: entry.errorMessage || null,
      adres_id: entry.adresId,
      adres_nazwa: entry.adresNazwa,
      jednostka_nazwa: entry.jednostkaNazwa,
      jednostka_email: entry.jednostkaEmail,
      subject: entry.subject,
      body_html: entry.bodyHtml,
      body_text: entry.bodyText,
      field_values: entry.fieldValues,
      attachments: entry.attachments,
      sent_from: entry.sentFrom,
      spotkanie_id: entry.spotkanieId ?? null,
      odbiorcy: entry.odbiorcy ?? [],
    });
    if (error) throw new Error(`addMailingHistory: ${error.message}`);
  }

  async getMailingHistory(): Promise<MailingHistoryEntry[]> {
    const rows = await fetchAllPaged<any>('getMailingHistory', (from, to) =>
      getSupabase()
        .from('mailing_history')
        .select(MAILING_HISTORY_COLS)
        .order('sent_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
    return rows.map(r => ({
      ...r,
      errorMessage: r.errorMessage ?? undefined,
      adresId: r.adresId ?? null,
      fieldValues: Array.isArray(r.fieldValues) ? r.fieldValues : [],
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      odbiorcy: Array.isArray(r.odbiorcy) ? (r.odbiorcy as MailingOdbiorca[]) : [],
    })) as MailingHistoryEntry[];
  }

  async clearMailingHistory(): Promise<void> {
    const { error } = await getSupabase().from('mailing_history').delete().gt('id', 0);
    if (error) throw new Error(`clearMailingHistory: ${error.message}`);
  }

  // ------------------------- Mailing — SMTP config -------------------------
  // Machine-local, like every other setting: the password to a real mailbox
  // must not travel through the shared Supabase project or into a backup file.

  getMailingSmtp(): MailingSmtpConfig & { pass: string } {
    // Booleans and numbers may be stored natively (store defaults) or as strings
    // (written through setSetting), so accept both — the same tolerance the
    // GET_SETTINGS handler applies to darkMode and friends.
    const raw = (key: string): unknown => this.getSetting(key) as unknown;
    const port = Number(raw('smtpPort'));
    const secure = raw('smtpSecure');
    const bccSelf = raw('smtpBccSelf');
    return {
      host: String(raw('smtpHost') || 'poczta.home.pl').trim(),
      port: Number.isFinite(port) && port > 0 ? port : 465,
      // Undefined ⇒ never configured; implicit TLS (465) is the safe default.
      secure: secure === true || secure === 'true' || secure === undefined,
      user: String(raw('smtpUser') || '').trim(),
      // Sealed on Windows (secretStorage); unreadable ⇒ none stored, the user re-enters it.
      pass: openSecret(String(raw('smtpPass') || ''), (sealed) => this.setSetting('smtpPass', sealed)) ?? '',
      fromName: String(raw('smtpFromName') || ''),
      bccSelf: bccSelf === true || bccSelf === 'true',
    };
  }

  /**
   * Persist the SMTP config. `pass` is optional on purpose: the renderer never
   * receives the stored password, so an edit that leaves the field untouched
   * passes `undefined` and must keep what's already there — but only for the
   * same server and the same login. A stored password goes with its account:
   * a new host or user without a new password clears it, or the next send would
   * hand this mailbox's password to whatever server the host now names.
   */
  setMailingSmtp(config: MailingSmtpConfig & { pass?: string }): void {
    const before = this.getMailingSmtp();
    const accountChanged =
      config.host.trim().toLowerCase() !== before.host.trim().toLowerCase() ||
      config.user.trim().toLowerCase() !== before.user.trim().toLowerCase();
    if (config.pass === undefined && accountChanged) this.setSetting('smtpPass', '');
    this.setSetting('smtpHost', config.host.trim());
    this.setSetting('smtpPort', String(config.port));
    this.setSetting('smtpSecure', String(config.secure));
    this.setSetting('smtpUser', config.user.trim());
    this.setSetting('smtpFromName', config.fromName);
    this.setSetting('smtpBccSelf', String(config.bccSelf));
    if (config.pass !== undefined) this.setSetting('smtpPass', sealSecret(config.pass));
  }

  // ------------------------------ Kalendarz ------------------------------

  /**
   * The application's accounts, as the participant picker offers them.
   *
   * Read from `public.app_users`, the trigger-maintained mirror of `auth.users`
   * — the publishable key cannot query the auth schema, and giving it that
   * reach would hand every client the whole user table. See supabase/kalendarz.sql.
   */
  async getAppUsers(): Promise<AppUser[]> {
    return this.cacheRead('appUsers', () => this.readAppUsers());
  }

  private async readAppUsers(): Promise<AppUser[]> {
    const read = (cols: string) =>
      getSupabase().from('app_users').select(cols).order('email', { ascending: true });
    let { data, error } = await read(APP_USER_COLS);
    // The colour column arrives with a SQL script run in Supabase. Until it has
    // been run, asking for it would fail — and with it EVERY list of people in the
    // app (the picker, the cards, the greeting) — so read without it instead.
    if (error && /color/i.test(error.message)) {
      ({ data, error } = await read(APP_USER_COLS_BASE));
    }
    if (error) throw new Error(`getAppUsers: ${error.message}`);
    return (data ?? []) as unknown as AppUser[];
  }

  /**
   * Name an account, or clear its name (empty strings are stored as NULL, so
   * "no name" is one value rather than two).
   *
   * Only these two columns are writable by a signed-in client — the mailbox and
   * the id belong to the auth trigger, enforced by a column grant in Supabase
   * rather than by this method being polite about it.
   */
  async setAppUserName(
    id: string,
    firstName: string | null,
    lastName: string | null,
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('app_users')
      .update({
        first_name: firstName?.trim() || null,
        last_name: lastName?.trim() || null,
      })
      .eq('id', id);
    if (error) throw new Error(`setAppUserName: ${error.message}`);
  }

  /**
   * Choose a person's colour, or hand it back to the app (null = automatic).
   * Anything that is not `#rrggbb` is stored as null rather than refused: a
   * colour that cannot be drawn is the same as no colour, and the column's own
   * check would reject it anyway.
   */
  async setAppUserColor(id: string, color: string | null): Promise<void> {
    const hex = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
    const { error } = await getSupabase().from('app_users').update({ color: hex }).eq('id', id);
    if (error) throw new Error(`setAppUserColor: ${error.message}`);
  }

  async getSpotkaniaTypy(): Promise<SpotkanieTyp[]> {
    const { data, error } = await getSupabase()
      .from('spotkania_typy')
      .select(SPOTKANIE_TYP_COLS)
      .order('nazwa', { ascending: true });
    if (error) throw new Error(`getSpotkaniaTypy: ${error.message}`);
    return (data ?? []).map((r: any) => ({
      ...r,
      // Null means "this kind has no notice period", which is a real answer —
      // not a missing one, so it is never defaulted to a number.
      dniNaDokumenty: r.dniNaDokumenty ?? null,
    })) as SpotkanieTyp[];
  }

  /**
   * Days-before-the-meeting, as the column wants it: a whole number in range,
   * or null. Zero, a negative or a stray decimal all mean "no rule" rather
   * than a deadline nobody could satisfy.
   */
  private static noticeDays(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const days = Math.round(value);
    if (!Number.isFinite(days) || days < 1 || days > 365) return null;
    return days;
  }

  async addSpotkanieTyp(
    nazwa: string,
    kolor: string,
    opis: string,
    dniNaDokumenty: number | null = null,
  ): Promise<SpotkanieTyp> {
    const { data, error } = await getSupabase()
      .from('spotkania_typy')
      .insert({
        nazwa: nazwa.trim(),
        kolor: kolor.trim(),
        opis,
        dni_na_dokumenty: DatabaseService.noticeDays(dniNaDokumenty),
      })
      .select(SPOTKANIE_TYP_COLS)
      .single();
    return unwrap(data, error, 'addSpotkanieTyp') as unknown as SpotkanieTyp;
  }

  async updateSpotkanieTyp(
    id: number,
    nazwa: string,
    kolor: string,
    opis: string,
    dniNaDokumenty: number | null = null,
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('spotkania_typy')
      .update({
        nazwa: nazwa.trim(),
        kolor: kolor.trim(),
        opis,
        dni_na_dokumenty: DatabaseService.noticeDays(dniNaDokumenty),
      })
      .eq('id', id);
    if (error) throw new Error(`updateSpotkanieTyp: ${error.message}`);
  }

  /**
   * Delete a type. `spotkania.typ_id` is ON DELETE SET NULL, so the meetings
   * survive as untyped rather than disappearing with the dictionary entry — the
   * caller warns about how many that affects.
   */
  async deleteSpotkanieTyp(id: number): Promise<void> {
    const { error } = await getSupabase().from('spotkania_typy').delete().eq('id', id);
    if (error) throw new Error(`deleteSpotkanieTyp: ${error.message}`);
  }

  /* --------------------------- Locations --------------------------- */

  async getSpotkaniaLokalizacje(): Promise<SpotkanieLokalizacja[]> {
    const { data, error } = await getSupabase()
      .from('spotkania_lokalizacje')
      .select(SPOTKANIE_LOKALIZACJA_COLS)
      .order('nazwa', { ascending: true });
    if (error) throw new Error(`getSpotkaniaLokalizacje: ${error.message}`);
    return (data ?? []).map((r: any) => ({
      ...r,
      adres: r.adres ?? '',
      opis: r.opis ?? '',
    })) as SpotkanieLokalizacja[];
  }

  async addSpotkanieLokalizacja(
    nazwa: string,
    adres: string,
    opis: string,
  ): Promise<SpotkanieLokalizacja> {
    const { data, error } = await getSupabase()
      .from('spotkania_lokalizacje')
      .insert({ nazwa: nazwa.trim(), adres: adres.trim(), opis })
      .select(SPOTKANIE_LOKALIZACJA_COLS)
      .single();
    return unwrap(data, error, 'addSpotkanieLokalizacja') as SpotkanieLokalizacja;
  }

  /**
   * Rename or re-address a location. The name is copied onto every meeting that
   * points at it, so a rename here follows through to the meetings rather than
   * leaving them displaying the old one — the snapshot exists to survive a
   * restore, not to freeze a typo.
   */
  async updateSpotkanieLokalizacja(
    id: number,
    nazwa: string,
    adres: string,
    opis: string,
  ): Promise<void> {
    const trimmed = nazwa.trim();
    const { error } = await getSupabase()
      .from('spotkania_lokalizacje')
      .update({ nazwa: trimmed, adres: adres.trim(), opis })
      .eq('id', id);
    if (error) throw new Error(`updateSpotkanieLokalizacja: ${error.message}`);

    const { error: syncError } = await getSupabase()
      .from('spotkania')
      .update({ lokalizacja_nazwa: trimmed })
      .eq('lokalizacja_id', id);
    if (syncError) {
      throw new Error(`updateSpotkanieLokalizacja (nazwa w spotkaniach): ${syncError.message}`);
    }
  }

  /**
   * Delete a location. `spotkania.lokalizacja_id` is ON DELETE SET NULL, so the
   * meetings survive — and because each one kept the name, they go on saying
   * where they were held. The caller warns how many that affects.
   */
  async deleteSpotkanieLokalizacja(id: number): Promise<void> {
    const { error } = await getSupabase().from('spotkania_lokalizacje').delete().eq('id', id);
    if (error) throw new Error(`deleteSpotkanieLokalizacja: ${error.message}`);
  }

  /* ----------------------------- Zadania (Kanban) ----------------------------- */

  /** An unknown status is a bug upstream; refusing it beats filing a card nowhere. */
  private static zadanieStatus(status: string): ZadanieStatus {
    if (!(ZADANIE_STATUSES as readonly string[]).includes(status)) {
      throw new Error(`Nieznany status zadania: ${status}`);
    }
    return status as ZadanieStatus;
  }

  /** Absent (an old backup, an older renderer) means `normal`; anything else unknown is refused. */
  private static zadaniePriorytet(value: string | null | undefined): ZadaniePriorytet {
    if (value == null || value === '') return DEFAULT_ZADANIE_PRIORYTET;
    if (!(ZADANIE_PRIORYTETY as readonly string[]).includes(value)) {
      throw new Error(`Nieznany priorytet zadania: ${value}`);
    }
    return value as ZadaniePriorytet;
  }

  private static zadanieTermin(value: string | null | undefined): string | null {
    const termin = (value ?? '').trim();
    if (!termin) return null;
    if (!isValidDayKey(termin)) throw new Error(`Nieprawidłowy termin zadania: ${termin}`);
    return termin;
  }

  /**
   * The attachment descriptions the renderer sends back, checked field by field.
   * The paths are keys this app minted, so anything else is refused outright —
   * a card must never be made to point at some other object in the bucket.
   */
  private static zadanieZalaczniki(value: unknown): ZadanieZalacznik[] {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new Error('Nieprawidłowe załączniki zadania.');
    return value.map((raw): ZadanieZalacznik => {
      const z = (raw ?? {}) as Partial<ZadanieZalacznik>;
      const rozmiar = Number(z.rozmiar);
      if (
        typeof z.id !== 'string' ||
        typeof z.sciezka !== 'string' ||
        !ZADANIE_STORAGE_KEY.test(z.sciezka) ||
        !Number.isInteger(rozmiar) ||
        rozmiar < 0 ||
        rozmiar > ZADANIE_ATTACHMENT_MAX_BYTES
      ) {
        throw new Error('Nieprawidłowy załącznik zadania.');
      }
      return {
        id: z.id,
        nazwa: String(z.nazwa ?? '').trim().slice(0, 255) || z.sciezka,
        rozmiar,
        sciezka: z.sciezka,
        dodanyBy: String(z.dodanyBy ?? ''),
        dodanyAt: String(z.dodanyAt ?? new Date().toISOString()),
      };
    });
  }

  private static zadaniePayload(input: ZadanieInput): Record<string, unknown> {
    const tytul = (input.tytul ?? '').trim();
    if (!tytul) throw new Error('Zadanie musi mieć tytuł.');
    return {
      tytul,
      opis: (input.opis ?? '').trim(),
      status: DatabaseService.zadanieStatus(input.status),
      priorytet: DatabaseService.zadaniePriorytet(input.priorytet),
      przypisany_email: (input.przypisanyEmail ?? '').trim() || null,
      termin: DatabaseService.zadanieTermin(input.termin),
      zalaczniki: DatabaseService.zadanieZalaczniki(input.zalaczniki),
      spotkanie_id: DatabaseService.zadanieSpotkanieId(input.spotkanieId),
    };
  }

  /** A meeting id, or null — anything else would be a broken link, not a task. */
  private static zadanieSpotkanieId(value: unknown): number | null {
    if (value == null) return null;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`Nieprawidłowe spotkanie zadania: ${value}`);
    return id;
  }

  /** Fill what a row written before a column existed leaves null. */
  private static zadanieFromRow(r: any): Zadanie {
    return {
      ...r,
      opis: r.opis ?? '',
      priorytet: DatabaseService.zadaniePriorytet(r.priorytet),
      pozycja: Number(r.pozycja ?? 0),
      przypisanyEmail: r.przypisanyEmail ?? null,
      termin: r.termin ?? null,
      zalaczniki: Array.isArray(r.zalaczniki) ? (r.zalaczniki as ZadanieZalacznik[]) : [],
      zarchiwizowane: r.zarchiwizowane === true,
      spotkanieId: r.spotkanieId != null ? Number(r.spotkanieId) : null,
      createdBy: r.createdBy ?? '',
      updatedBy: r.updatedBy ?? '',
    } as Zadanie;
  }

  async getZadania(): Promise<Zadanie[]> {
    return this.cacheRead('zadania', () => this.readZadania());
  }

  private async readZadania(): Promise<Zadanie[]> {
    const rows = await fetchAllPaged<any>('getZadania', (from, to) =>
      getSupabase()
        .from('zadania')
        .select(ZADANIE_COLS)
        .order('updated_at', { ascending: false })
        // `updated_at` moves while the pages are read; the id keeps the paging stable.
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.zadanieFromRow);
  }

  /** One card as it is now — or null when it is gone. Never from the cache. */
  async getZadanie(id: number): Promise<Zadanie | null> {
    const { data, error } = await getSupabase().from('zadania').select(ZADANIE_COLS).eq('id', id).maybeSingle();
    if (error) throw new Error(`getZadanie: ${error.message}`);
    return data ? DatabaseService.zadanieFromRow(data) : null;
  }

  /**
   * The cards assigned to one mailbox, without their description and files —
   * what the notifier compares every minute, instead of the whole board.
   */
  async getZadaniaPrzypisane(email: string): Promise<Zadanie[]> {
    const mailbox = email.trim();
    if (!mailbox) return [];
    // Case-insensitive like the app's own matching; LIKE's wildcards in the
    // mailbox itself are escaped, and the notifier re-checks the match anyway.
    const pattern = mailbox.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await fetchAllPaged<any>('getZadaniaPrzypisane', (from, to) =>
      getSupabase()
        .from('zadania')
        .select(ZADANIE_NOTIFIER_COLS)
        .ilike('przypisany_email', pattern)
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.zadanieFromRow);
  }

  /** Some cards by id, without their description and files — for the notifier's comment check. */
  async getZadaniaByIds(ids: number[]): Promise<Zadanie[]> {
    const out: Zadanie[] = [];
    for (const slice of DatabaseService.chunk([...new Set(ids)], 100)) {
      const { data, error } = await getSupabase().from('zadania').select(ZADANIE_NOTIFIER_COLS).in('id', slice);
      if (error) throw new Error(`getZadaniaByIds: ${error.message}`);
      out.push(...(data ?? []).map(DatabaseService.zadanieFromRow));
    }
    return out;
  }

  /** The place just above the top card of a column — where a card arriving there goes. */
  private async zadanieTopPozycja(status: ZadanieStatus): Promise<number> {
    const { data, error } = await getSupabase()
      .from('zadania')
      .select('pozycja')
      .eq('status', status)
      .order('pozycja', { ascending: true })
      .limit(1);
    if (error) throw new Error(`zadanieTopPozycja: ${error.message}`);
    return ((data?.[0] as { pozycja: number } | undefined)?.pozycja ?? 1) - 1;
  }

  async addZadanie(input: ZadanieInput, createdBy: string): Promise<Zadanie> {
    const payload = DatabaseService.zadaniePayload(input);
    const { data, error } = await getSupabase()
      .from('zadania')
      .insert({
        ...payload,
        pozycja: await this.zadanieTopPozycja(payload.status as ZadanieStatus),
        created_by: createdBy,
        updated_by: createdBy,
      })
      .select(ZADANIE_COLS)
      .single();
    return DatabaseService.zadanieFromRow(unwrap(data, error, 'addZadanie'));
  }

  /** A card that is gone by the time it is written to. */
  private static readonly ZADANIE_GONE = 'Tego zadania już nie ma — mogło zostać usunięte.';

  /**
   * The form's full save of a card.
   *
   * Guarded twice against overwriting what somebody else saved meanwhile: the
   * card must still be at the `updatedAt` the form was opened on (when the form
   * says so), and the write itself only lands while the row is still the one
   * just read. Either failing refuses the save with `ZADANIE_CONFLICT_MESSAGE`.
   *
   * Files are deleted from the bucket only when the person removed them in this
   * edit (`removedAttachments`) — and only if the card really had them and the
   * save really dropped them. Diffing against a list that may be stale is what
   * once deleted files a colleague had just attached.
   */
  async updateZadanie(id: number, input: ZadanieInput, changedBy: string): Promise<Zadanie> {
    const payload = DatabaseService.zadaniePayload(input);
    const { data: before, error: readError } = await getSupabase()
      .from('zadania')
      .select('zalaczniki, status, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`updateZadanie (odczyt): ${readError.message}`);
    // Both refusals below come before any write, so nothing has reported the
    // table: the board's cached list is the one missing somebody else's change.
    if (!before) {
      this.invalidateTable('zadania');
      throw new Error(DatabaseService.ZADANIE_GONE);
    }
    const stored = before as { zalaczniki: unknown; status: string; updated_at: string };
    if (input.expectedUpdatedAt && !sameInstant(input.expectedUpdatedAt, stored.updated_at)) {
      this.invalidateTable('zadania');
      throw new Error(ZADANIE_CONFLICT_MESSAGE);
    }

    // A card the form sends to another column lands on top of it, like one moved
    // there by hand; an edit that keeps the column keeps the place.
    const pozycja =
      stored.status !== payload.status
        ? { pozycja: await this.zadanieTopPozycja(payload.status as ZadanieStatus) }
        : {};
    const { data: written, error } = await getSupabase()
      .from('zadania')
      .update({ ...payload, ...pozycja, updated_at: new Date().toISOString(), updated_by: changedBy })
      .eq('id', id)
      .eq('updated_at', stored.updated_at)
      .select(ZADANIE_COLS);
    if (error) throw new Error(`updateZadanie: ${error.message}`);
    if (!written || written.length === 0) {
      // Saved by somebody else between the read and the write — or deleted.
      throw new Error((await this.zadanieExists(id)) ? ZADANIE_CONFLICT_MESSAGE : DatabaseService.ZADANIE_GONE);
    }

    // Only once the row no longer points at them: a file dropped from the form
    // is deleted after the save that dropped it, never before.
    const kept = new Set((payload.zalaczniki as ZadanieZalacznik[]).map(z => z.sciezka));
    const had = new Set(DatabaseService.zalacznikPaths(stored.zalaczniki));
    const removed = (Array.isArray(input.removedAttachments) ? input.removedAttachments : [])
      .map(String)
      .filter(p => had.has(p) && !kept.has(p));
    await removeAttachments(removed);
    return DatabaseService.zadanieFromRow(written[0]);
  }

  /**
   * A quick edit from the board — a new title, assignee, deadline or priority.
   * Only the fields given are written, so it can never carry the rest of a card
   * the board loaded minutes ago over what somebody saved since (the old way
   * resent the description, the status and the files). It is an edit of the
   * card, so `updated_at`/`updated_by` move. Returns the card as it now is.
   */
  async patchZadanie(id: number, patch: ZadaniePatch, changedBy: string): Promise<Zadanie> {
    const values: Record<string, unknown> = {};
    if (patch.tytul !== undefined) {
      const tytul = String(patch.tytul ?? '').trim();
      if (!tytul) throw new Error('Zadanie musi mieć tytuł.');
      values.tytul = tytul;
    }
    if (patch.przypisanyEmail !== undefined) {
      values.przypisany_email = String(patch.przypisanyEmail ?? '').trim() || null;
    }
    if (patch.termin !== undefined) values.termin = DatabaseService.zadanieTermin(patch.termin);
    if (patch.priorytet !== undefined) values.priorytet = DatabaseService.zadaniePriorytet(patch.priorytet);
    if (Object.keys(values).length === 0) throw new Error('patchZadanie: nothing to change');
    const { data, error } = await getSupabase()
      .from('zadania')
      .update({ ...values, updated_at: new Date().toISOString(), updated_by: changedBy })
      .eq('id', id)
      .select(ZADANIE_COLS)
      .maybeSingle();
    if (error) throw new Error(`patchZadanie: ${error.message}`);
    if (!data) throw new Error(DatabaseService.ZADANIE_GONE);
    return DatabaseService.zadanieFromRow(data);
  }

  private async zadanieExists(id: number): Promise<boolean> {
    const { data, error } = await getSupabase().from('zadania').select('id').eq('id', id).maybeSingle();
    if (error) throw new Error(`zadanieExists: ${error.message}`);
    return !!data;
  }

  /** The storage paths a stored `zalaczniki` value points at, read leniently (it only decides deletions). */
  private static zalacznikPaths(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map(z => (z && typeof z === 'object' ? (z as { sciezka?: unknown }).sciezka : null))
      .filter((p): p is string => typeof p === 'string' && ZADANIE_STORAGE_KEY.test(p));
  }

  /**
   * Put a card in a column and set the order of that column. `orderedIds` is the
   * whole column, top first, with the card already in its place: it is numbered
   * 1..n. Only a change of column is an edit of the card (and so touches
   * `updated_at` / `updated_by`, which the notifier reads); reordering is not —
   * moving a card up must not tell its assignee it "changed".
   */
  async moveZadanie(
    id: number,
    status: ZadanieStatus,
    orderedIds: number[],
    changedBy: string,
  ): Promise<string | null> {
    const target = DatabaseService.zadanieStatus(status);
    const ids = [...new Set(orderedIds.filter((n) => Number.isInteger(n)))];
    if (!ids.includes(id)) throw new Error('Przenoszona karta musi być w nowej kolejności.');

    const { data: current, error: readError } = await getSupabase()
      .from('zadania')
      .select('status')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`moveZadanie (odczyt): ${readError.message}`);
    if (!current) {
      this.invalidateTable('zadania');
      throw new Error(DatabaseService.ZADANIE_GONE);
    }
    // The card's new `updated_at` when the column changed, so the board can keep
    // its copy current — a form opened on it later must not look stale.
    let updatedAt: string | null = null;
    if (current.status !== target) {
      const { data, error } = await getSupabase()
        .from('zadania')
        .update({ status: target, updated_at: new Date().toISOString(), updated_by: changedBy })
        .eq('id', id)
        .select('updated_at')
        .maybeSingle();
      if (error) throw new Error(`moveZadanie (status): ${error.message}`);
      updatedAt = (data as { updated_at: string } | null)?.updated_at ?? null;
    }

    // One small write per card — a position is all that changes, and an upsert
    // would have to carry whole rows (or insert a ghost card for an id deleted
    // meanwhile) — a few at a time rather than the whole column at once.
    const places = ids.map((cardId, i) => ({ cardId, pozycja: i + 1 }));
    for (const slice of DatabaseService.chunk(places, 10)) {
      const results = await Promise.all(
        slice.map(({ cardId, pozycja }) =>
          getSupabase().from('zadania').update({ pozycja }).eq('id', cardId),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(`moveZadanie (kolejność): ${failed.error.message}`);
    }
    return updatedAt;
  }

  /**
   * Archive a card or bring it back. It is an edit of the card (so `updated_by`
   * is set and a person's own archiving is not notified back to them), and it
   * leaves the place in its column alone.
   */
  /** Returns the card as it now is — its `updatedAt` moved, and a form open on it must know. */
  async setZadanieArchived(id: number, archived: boolean, changedBy: string): Promise<Zadanie> {
    const { data, error } = await getSupabase()
      .from('zadania')
      .update({
        zarchiwizowane: archived,
        updated_at: new Date().toISOString(),
        updated_by: changedBy,
      })
      .eq('id', id)
      .select(ZADANIE_COLS)
      .maybeSingle();
    if (error) throw new Error(`setZadanieArchived: ${error.message}`);
    if (!data) throw new Error(DatabaseService.ZADANIE_GONE);
    return DatabaseService.zadanieFromRow(data);
  }

  async deleteZadanie(id: number): Promise<void> {
    // Read first, and a failed read stops the delete: the files are found
    // through the row, and once it is gone nothing else knows them.
    const { data: before, error: readError } = await getSupabase()
      .from('zadania')
      .select('zalaczniki')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`deleteZadanie (odczyt): ${readError.message}`);
    const { error } = await getSupabase().from('zadania').delete().eq('id', id);
    if (error) throw new Error(`deleteZadanie: ${error.message}`);
    await removeAttachments(DatabaseService.zalacznikPaths(before?.zalaczniki));
  }

  /**
   * Remove uploads that never made it onto a card (the form was cancelled).
   * Anything a card still points at is left alone, so a renderer that asked for
   * the wrong path can delete nothing that is in use.
   */
  async discardZadanieZalaczniki(paths: string[]): Promise<void> {
    // Read live: a file somebody attached a moment ago is in use, cached list or not.
    const inUse = new Set(
      (await this.readZadania()).flatMap(z => z.zalaczniki.map(a => a.sciezka)),
    );
    await removeAttachments(paths.filter(p => !inUse.has(p)));
  }

  /* ------------------------- Zadania: komentarze ------------------------- */

  /**
   * The tagged mailboxes of a comment, checked: lower-cased, de-duplicated, and
   * only things that look like a mailbox — the notifier matches them literally,
   * so a stray value must not become a tag nobody can ever see.
   */
  /** Tagged mailboxes as stored — task comments and the dashboard's notes alike. */
  static komentarzMentions(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const raw of value) {
      const email = String(raw ?? '').trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+$/.test(email)) seen.add(email);
    }
    return [...seen];
  }

  private static komentarzFromRow(r: any): ZadanieKomentarz {
    return {
      ...r,
      autorEmail: r.autorEmail ?? '',
      mentions: Array.isArray(r.mentions) ? (r.mentions as string[]) : [],
    } as ZadanieKomentarz;
  }

  /** One task's conversation, oldest first. */
  async getZadanieKomentarze(zadanieId: number): Promise<ZadanieKomentarz[]> {
    const rows = await fetchAllPaged<any>('getZadanieKomentarze', (from, to) =>
      getSupabase()
        .from('zadania_komentarze')
        .select(ZADANIE_KOMENTARZ_COLS)
        .eq('zadanie_id', zadanieId)
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.komentarzFromRow);
  }

  /** Count and newest comment of every card that has any — what the board's cards show. */
  async getZadaniaKomentarzePodsumowanie(): Promise<ZadanieKomentarzPodsumowanie[]> {
    try {
      const rows = await fetchAllPaged<any>('getZadaniaKomentarzePodsumowanie', (from, to) =>
        getSupabase()
          .from('zadania_komentarze_podsumowanie')
          .select(`${ZADANIE_KOMENTARZ_COLS}, liczba`)
          .order('zadanie_id', { ascending: true })
          .range(from, to),
      );
      return rows.map(({ liczba, ...komentarz }) => ({
        zadanieId: komentarz.zadanieId as number,
        liczba: Number(liczba),
        ostatni: DatabaseService.komentarzFromRow(komentarz),
      }));
    } catch (error) {
      // The view is only a shortcut (see zadania-komentarze.sql). Without it —
      // the SQL not re-run yet — the same answer is worked out from the comments
      // themselves: slower for a very long history, identical in result, and the
      // board never loses its comment strips over a missing view.
      log.warn(
        '[ZADANIA] comment summary view unavailable, reading the comments instead:',
        error instanceof Error ? error.message : error,
      );
      const byCard = new Map<number, ZadanieKomentarzPodsumowanie>();
      // Oldest first, so the last one written for a card is the one that stays.
      for (const k of await this.getZadaniaKomentarze()) {
        byCard.set(k.zadanieId, {
          zadanieId: k.zadanieId,
          liczba: (byCard.get(k.zadanieId)?.liczba ?? 0) + 1,
          ostatni: k,
        });
      }
      return [...byCard.values()];
    }
  }

  /** Every comment — for the backup, which is the only reader that needs them all. */
  async getZadaniaKomentarze(): Promise<ZadanieKomentarz[]> {
    const rows = await fetchAllPaged<any>('getZadaniaKomentarze', (from, to) =>
      getSupabase()
        .from('zadania_komentarze')
        .select(ZADANIE_KOMENTARZ_COLS)
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.komentarzFromRow);
  }

  /**
   * Comments newer than `afterId`, oldest first — the notifier's cursor. Ids only
   * grow, so "greater than the last one seen" is the whole query.
   */
  async getZadaniaKomentarzeAfter(afterId: number): Promise<ZadanieKomentarz[]> {
    const rows = await fetchAllPaged<any>('getZadaniaKomentarzeAfter', (from, to) =>
      getSupabase()
        .from('zadania_komentarze')
        .select(ZADANIE_KOMENTARZ_COLS)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.komentarzFromRow);
  }

  /** Id of the newest comment, or 0 when there is none — where a first poll starts from. */
  async getLatestZadanieKomentarzId(): Promise<number> {
    const { data, error } = await getSupabase()
      .from('zadania_komentarze')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw new Error(`getLatestZadanieKomentarzId: ${error.message}`);
    return (data?.[0] as { id: number } | undefined)?.id ?? 0;
  }

  async addZadanieKomentarz(
    input: ZadanieKomentarzInput,
    autorEmail: string,
  ): Promise<ZadanieKomentarz> {
    const tresc = (input.tresc ?? '').trim();
    if (!tresc) throw new Error('Komentarz nie może być pusty.');
    if (tresc.length > ZADANIE_KOMENTARZ_MAX_LENGTH) throw new Error('Komentarz jest za długi.');
    if (!autorEmail) throw new Error('Brak zalogowanego użytkownika.');
    const { data, error } = await getSupabase()
      .from('zadania_komentarze')
      .insert({
        zadanie_id: input.zadanieId,
        autor_email: autorEmail,
        tresc,
        mentions: DatabaseService.komentarzMentions(input.mentions),
      })
      .select(ZADANIE_KOMENTARZ_COLS)
      .single();
    return DatabaseService.komentarzFromRow(unwrap(data, error, 'addZadanieKomentarz'));
  }

  /**
   * Only the author's own comment: the filter is the rule, not a courtesy of the
   * UI — and a filter that matched nothing is said out loud, not reported as done.
   */
  async deleteZadanieKomentarz(id: number, autorEmail: string): Promise<void> {
    const { data, error } = await getSupabase()
      .from('zadania_komentarze')
      .delete()
      .eq('id', id)
      .eq('autor_email', autorEmail)
      .select('id');
    if (error) throw new Error(`deleteZadanieKomentarz: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error('Tego komentarza nie można usunąć — już go nie ma albo nie jest Twój.');
    }
  }

  /* --------------------- Zadania: przypięte notatki --------------------- */

  /** Notes pinned to the board, newest first. */
  async getZadaniaNotatki(): Promise<ZadanieNotatka[]> {
    const rows = await fetchAllPaged<any>('getZadaniaNotatki', (from, to) =>
      getSupabase()
        .from('zadania_notatki')
        .select(ZADANIE_NOTATKA_COLS)
        .order('id', { ascending: false })
        .range(from, to),
    );
    return rows.map(r => ({ ...r, autorEmail: r.autorEmail ?? '' })) as ZadanieNotatka[];
  }

  async addZadanieNotatka(tresc: string, autorEmail: string): Promise<ZadanieNotatka> {
    const text = tresc.trim();
    if (!text) throw new Error('Notatka nie może być pusta.');
    if (text.length > ZADANIE_NOTATKA_MAX_LENGTH) throw new Error('Notatka jest za długa.');
    if (!autorEmail) throw new Error('Brak zalogowanego użytkownika.');
    const { data, error } = await getSupabase()
      .from('zadania_notatki')
      .insert({ tresc: text, autor_email: autorEmail })
      .select(ZADANIE_NOTATKA_COLS)
      .single();
    return unwrap(data, error, 'addZadanieNotatka') as unknown as ZadanieNotatka;
  }

  /** Only the author's own note: the filter is the rule, not a courtesy of the UI. */
  async updateZadanieNotatka(id: number, tresc: string, autorEmail: string): Promise<void> {
    const text = tresc.trim();
    if (!text) throw new Error('Notatka nie może być pusta.');
    if (text.length > ZADANIE_NOTATKA_MAX_LENGTH) throw new Error('Notatka jest za długa.');
    const { data, error } = await getSupabase()
      .from('zadania_notatki')
      .update({ tresc: text })
      .eq('id', id)
      .eq('autor_email', autorEmail)
      .select('id');
    if (error) throw new Error(`updateZadanieNotatka: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error('Tej notatki nie można zmienić — już jej nie ma albo nie jest Twoja.');
    }
  }

  /** Only the author's own note: the filter is the rule, not a courtesy of the UI. */
  async deleteZadanieNotatka(id: number, autorEmail: string): Promise<void> {
    const { data, error } = await getSupabase()
      .from('zadania_notatki')
      .delete()
      .eq('id', id)
      .eq('autor_email', autorEmail)
      .select('id');
    if (error) throw new Error(`deleteZadanieNotatka: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error('Tej notatki nie można usunąć — już jej nie ma albo nie jest Twoja.');
    }
  }

  /* ---------------------------- Meetings ---------------------------- */

  /**
   * Every meeting, newest first — or only those starting at `fromIso` or later
   * (the notifier's window), or the one `id`. Only the whole list is cached:
   * the window and the single row are read to see the table as it is now.
   */
  async getSpotkania(fromIso?: string, id?: number): Promise<Spotkanie[]> {
    if (fromIso === undefined && id === undefined) {
      return this.cacheRead('spotkania', () => this.readSpotkania());
    }
    return this.readSpotkania(fromIso, id);
  }

  private async readSpotkania(fromIso?: string, id?: number): Promise<Spotkanie[]> {
    const rows = await fetchAllPaged<any>('getSpotkania', (from, to) => {
      let query = getSupabase().from('spotkania').select(SPOTKANIE_COLS);
      if (fromIso) query = query.gte('starts_at', fromIso);
      if (id !== undefined) query = query.eq('id', id);
      return query.order('starts_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
    });
    return rows.map(DatabaseService.spotkanieRow);
  }

  /** A `SPOTKANIE_COLS` row as a meeting — the one shape the list and every returned row share. */
  private static spotkanieRow(r: any): Spotkanie {
    return {
      ...r,
      typId: r.typId ?? null,
      adresId: r.adresId ?? null,
      adresNazwa: r.adresNazwa ?? '',
      lokalizacjaId: r.lokalizacjaId ?? null,
      lokalizacjaNazwa: r.lokalizacjaNazwa ?? '',
      endsAt: r.endsAt ?? null,
      opis: r.opis ?? '',
      uczestnicy: Array.isArray(r.uczestnicy) ? (r.uczestnicy as SpotkanieUczestnik[]) : [],
      // Rows written before the column existed carry no status; they meant a
      // real date, so that is what they keep meaning.
      terminStatus: (r.terminStatus ?? 'potwierdzony') as SpotkanieTerminStatus,
      terminWysylki: DatabaseService.dayKeyOrNull(r.terminWysylki),
      terminZmienionyAt: r.terminZmienionyAt ?? null,
      terminZmienionyZ: r.terminZmienionyZ ?? null,
      terminZmienionyBy: r.terminZmienionyBy ?? null,
      terminZmianaOdczytanaAt: r.terminZmianaOdczytanaAt ?? null,
      terminZmianaOdczytanaBy: r.terminZmianaOdczytanaBy ?? null,
      zgnJednostkaId: r.zgnJednostkaId != null ? Number(r.zgnJednostkaId) : null,
      zgnPelnomocnikId: r.zgnPelnomocnikId != null ? Number(r.zgnPelnomocnikId) : null,
      zgnNazwa: r.zgnNazwa ?? '',
      zarzad: DatabaseService.spotkanieZarzad(r.zarzad),
      materialyStatus: DatabaseService.materialyStatus(r.materialyStatus),
      materialyZmienioneAt: r.materialyZmienioneAt ?? null,
      materialyZmienioneBy: r.materialyZmienioneBy ?? null,
      createdBy: r.createdBy ?? '',
    } as Spotkanie;
  }

  /** One meeting, shaped exactly as the list shapes it — or null when it is gone. */
  async getSpotkanie(id: number): Promise<Spotkanie | null> {
    return (await this.getSpotkania(undefined, id))[0] ?? null;
  }

  /**
   * Shape one meeting for the table. Shared by insert and update so the two can
   * never disagree, and the one invariant lives in a single place: an end before
   * its start would silently reorder the day, so it is rejected rather than
   * stored or quietly dropped.
   */
  private static spotkaniePayload(input: SpotkanieInput): Record<string, unknown> {
    const nazwa = input.nazwa.trim();
    if (!nazwa) throw new Error('Spotkanie musi mieć nazwę.');
    if (!input.startsAt) throw new Error('Spotkanie musi mieć datę i godzinę.');
    if (
      input.endsAt &&
      new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()
    ) {
      throw new Error('Godzina zakończenia musi być późniejsza niż godzina rozpoczęcia.');
    }
    return {
      nazwa,
      typ_id: input.typId,
      adres_id: input.adresId,
      adres_nazwa: input.adresNazwa.trim(),
      lokalizacja_id: input.lokalizacjaId,
      lokalizacja_nazwa: input.lokalizacjaNazwa.trim(),
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      opis: input.opis,
      uczestnicy: input.uczestnicy,
      termin_status: input.terminStatus === 'wstepny' ? 'wstepny' : 'potwierdzony',
      termin_wysylki: DatabaseService.dayKeyOrNull(input.terminWysylki),
      // A proxy always comes with its own unit; no unit means no proxy either.
      zgn_jednostka_id: input.zgnJednostkaId ?? null,
      zgn_pelnomocnik_id: input.zgnJednostkaId != null ? input.zgnPelnomocnikId ?? null : null,
      zgn_nazwa: input.zgnJednostkaId != null ? (input.zgnNazwa ?? '').trim() : '',
      zarzad: DatabaseService.spotkanieZarzad(input.zarzad),
    };
  }

  async addSpotkanie(input: SpotkanieInput, createdBy: string): Promise<Spotkanie> {
    const { data, error } = await getSupabase()
      .from('spotkania')
      .insert({ ...DatabaseService.spotkaniePayload(input), created_by: createdBy })
      .select(SPOTKANIE_COLS)
      .single();
    return DatabaseService.spotkanieRow(unwrap(data, error, 'addSpotkanie'));
  }

  /**
   * Save an edit, and notice when the edit moved the date.
   *
   * Read-then-write rather than a trigger: the comparison is on instants, and
   * the app is the only writer here. Instants are compared numerically, never
   * as strings — Supabase renders `timestamptz` with a `+00:00` offset while
   * the values the app builds end in `Z`, and the two only agree as numbers.
   *
   * A move resets the acknowledgement: whoever had seen the previous date has
   * not seen this one. `terminZmienionyZ` keeps the start the meeting had
   * before THIS move, which is the one thing a reader needs ("było 14:00").
   *
   * Under `casUpdate`: the move is judged against the date the row has when the
   * write lands, never against one somebody changed in between. With
   * `expectedUpdatedAt` (what the form loaded) a meeting saved meanwhile by
   * somebody else is refused instead.
   *
   * Returns the meeting as saved — with its new `updatedAt` — so the screen can
   * put it in place of the old one instead of reading the calendar again.
   */
  async updateSpotkanie(
    id: number,
    input: SpotkanieInput,
    changedBy: string,
    expectedUpdatedAt?: string | null,
  ): Promise<Spotkanie> {
    const base = DatabaseService.spotkaniePayload(input);
    const result = await this.casUpdate<{ starts_at: string; ends_at: string | null; updated_at: string }>(
      'spotkania',
      id,
      'starts_at, ends_at',
      'updateSpotkanie',
      (previous) => {
        const payload: Record<string, unknown> = { ...base };
        const instant = (value: string | null | undefined): number | null =>
          value ? new Date(value).getTime() : null;
        const moved =
          instant(previous.starts_at) !== instant(input.startsAt) ||
          instant(previous.ends_at) !== instant(input.endsAt);
        if (moved) {
          payload.termin_zmieniony_at = new Date().toISOString();
          payload.termin_zmieniony_z = previous.starts_at;
          payload.termin_zmieniony_by = changedBy;
          payload.termin_zmiana_odczytana_at = null;
          payload.termin_zmiana_odczytana_by = null;
        }
        return payload;
      },
      { expectedUpdatedAt, returning: SPOTKANIE_COLS },
    );
    if (!result) throw new Error('Tego spotkania już nie ma — mogło zostać usunięte.');
    return DatabaseService.spotkanieRow(result.written);
  }

  /**
   * "I have seen that this moved." Records who said so and stops the meeting
   * being marked — the record of the move itself stays, so its details still
   * read "termin zmieniony z 14:00".
   */
  async ackSpotkanieTermin(id: number, who: string): Promise<void> {
    const { error } = await getSupabase()
      .from('spotkania')
      .update({
        termin_zmiana_odczytana_at: new Date().toISOString(),
        termin_zmiana_odczytana_by: who,
      })
      .eq('id', id);
    if (error) throw new Error(`ackSpotkanieTermin: ${error.message}`);
  }

  /**
   * A stored materials status; anything unknown (or absent) reads as none
   * needed. `gotowe` is the earlier draft's name for `przygotowane`.
   */
  private static materialyStatus(value: unknown): SpotkanieMaterialyStatus {
    if (value === 'gotowe') return 'przygotowane';
    return SPOTKANIE_MATERIALY_STATUSES.includes(value as SpotkanieMaterialyStatus)
      ? (value as SpotkanieMaterialyStatus)
      : 'brak';
  }

  /**
   * Move the materials status, recording who did it — the notifier reads that.
   *
   * The meeting's Zebranie follows: its newest version takes the status this one
   * stands for (see `zebranieStatusFromMaterialy`), so the card and the module
   * can never say two different things.
   */
  async setSpotkanieMaterialy(
    id: number,
    status: SpotkanieMaterialyStatus,
    who: string,
  ): Promise<void> {
    await this.writeSpotkanieMaterialy(id, status, who);
    const target = zebranieStatusFromMaterialy(status);
    if (!target) return;
    // The meeting's own status is already saved — that is what the user clicked.
    // A failed follow-up must not report the click itself as failed; it is
    // logged, and the next status change brings the two back in step.
    try {
      const zebranie = await this.getZebranieBySpotkanie(id);
      const latest = zebranie ? latestWersja(zebranie) : null;
      if (latest && latest.status !== target) {
        await this.writeZebranieWersjaGotowe(latest.id, gotoweForStatus(target), who);
      }
    } catch (error: unknown) {
      log.error(
        '[ZEBRANIA] status sync from meeting failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** The bare write — no Zebranie sync, so the two syncs cannot call each other forever. */
  private async writeSpotkanieMaterialy(
    id: number,
    status: SpotkanieMaterialyStatus,
    who: string,
  ): Promise<void> {
    if (!SPOTKANIE_MATERIALY_STATUSES.includes(status)) {
      throw new Error(`Nieznany status materiałów: ${status}`);
    }
    const now = new Date().toISOString();
    const { error } = await getSupabase()
      .from('spotkania')
      .update({
        materialy_status: status,
        materialy_zmienione_at: now,
        materialy_zmienione_by: who,
        updated_at: now,
      })
      .eq('id', id);
    if (error) throw new Error(`setSpotkanieMaterialy: ${error.message}`);
  }

  /** Settle a tentative date, or put a settled one back to tentative. */
  async setSpotkanieTerminStatus(id: number, status: SpotkanieTerminStatus): Promise<void> {
    const { error } = await getSupabase()
      .from('spotkania')
      .update({
        termin_status: status === 'wstepny' ? 'wstepny' : 'potwierdzony',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(`setSpotkanieTerminStatus: ${error.message}`);
  }

  /**
   * Every Mailing send that was triggered from a meeting, newest first.
   *
   * One query for all of them rather than one per meeting: the calendar shows a
   * month of meetings at a time, and the rows carrying a `spotkanie_id` are a
   * small slice of the mailing history.
   */
  async getSpotkaniaMailingi(): Promise<SpotkanieMailing[]> {
    const rows = await fetchAllPaged<any>('getSpotkaniaMailingi', (from, to) =>
      getSupabase()
        .from('mailing_history')
        .select(SPOTKANIE_MAILING_COLS)
        .not('spotkanie_id', 'is', null)
        .order('sent_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
    return rows.map(r => ({
      id: r.id,
      spotkanieId: r.spotkanieId,
      templateName: r.templateName ?? '',
      status: r.status,
      errorMessage: r.errorMessage ?? undefined,
      adresNazwa: r.adresNazwa ?? '',
      jednostkaNazwa: r.jednostkaNazwa ?? '',
      jednostkaEmail: r.jednostkaEmail ?? '',
      subject: r.subject ?? '',
      attachmentNames: Array.isArray(r.attachments)
        ? (r.attachments as { fileName?: string }[]).map(a => a.fileName ?? '').filter(Boolean)
        : [],
      sentFrom: r.sentFrom ?? '',
      sentAt: r.sentAt,
    }));
  }

  async deleteSpotkanie(id: number): Promise<void> {
    // The meeting's Zebrania entry goes with it: the entry is that meeting's
    // materials, and left behind it would turn into a stray "niezależne" entry
    // for a meeting that no longer exists (the delete confirmation says so).
    // Its versions go with it (ON DELETE CASCADE).
    const { error: zebError } = await getSupabase().from('zebrania').delete().eq('spotkanie_id', id);
    if (zebError) throw new Error(`deleteSpotkanie (zebranie): ${zebError.message}`);
    const { error } = await getSupabase().from('spotkania').delete().eq('id', id);
    if (error) throw new Error(`deleteSpotkanie: ${error.message}`);
  }

  /* ----------------------------- Zebrania ----------------------------- */

  /** A `YYYY-MM-DD` day, or null for anything else (absent, empty, malformed). */
  private static dayKeyOrNull(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const day = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  }

  private static zebranieStatus(value: unknown): ZebranieStatus {
    return ZEBRANIE_STATUSES.includes(value as ZebranieStatus)
      ? (value as ZebranieStatus)
      : 'w_przygotowaniu';
  }

  /** A version row; `biblioteka` holds the library rows its statement may link (with their figures). */
  private static zebranieWersjaRow(r: any, biblioteka: Map<number, SprawozdanieZapisane>): ZebranieWersja {
    return {
      id: r.id,
      zebranieId: r.zebranieId,
      major: Number(r.major ?? 1),
      minor: Number(r.minor ?? 0),
      nazwa: r.nazwa ?? '',
      status: DatabaseService.zebranieStatus(r.status),
      opis: r.opis ?? '',
      materialy: normalizeMaterialy(r.materialy),
      gotowe: normalizeGotowe(r.gotowe),
      createdBy: r.createdBy ?? '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt ?? r.createdAt,
      updatedBy: r.updatedBy ?? '',
      sprawozdanie:
        r.sprawozdanie_id != null
          ? zebranieSprawozdanie(r.sprawozdanie, biblioteka.get(Number(r.sprawozdanie_id)))
          : null,
      sprawozdanieOdlaczone: r.sprawozdanie_id == null && isSprawozdanieOdlaczone(r.sprawozdanie),
      plan: normalizePlan(r.plan),
    };
  }

  private static zebranieRow(r: any, wersje: ZebranieWersja[]): Zebranie {
    return {
      id: r.id,
      spotkanieId: r.spotkanieId != null ? Number(r.spotkanieId) : null,
      nazwa: r.nazwa ?? '',
      adresId: r.adresId != null ? Number(r.adresId) : null,
      adresNazwa: r.adresNazwa ?? '',
      lokalizacjaId: r.lokalizacjaId != null ? Number(r.lokalizacjaId) : null,
      lokalizacjaNazwa: r.lokalizacjaNazwa ?? '',
      lokalizacjaAdres: r.lokalizacjaAdres ?? '',
      startsAt: r.startsAt ?? null,
      createdBy: r.createdBy ?? '',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt ?? r.createdAt,
      wersje: sortWersje(wersje.filter(w => w.zebranieId === r.id)),
    };
  }

  /**
   * Version rows as versions: the statements they link are read from the
   * library — figures included — in one query, not once per version.
   */
  private async zebranieWersjeRows(rows: any[]): Promise<ZebranieWersja[]> {
    const ids = [...new Set(rows.map(r => r.sprawozdanie_id).filter((id): id is number => id != null))];
    const biblioteka = new Map<number, SprawozdanieZapisane>();
    for (const slice of DatabaseService.chunk(ids, 100)) {
      const { data, error } = await getSupabase()
        .from('zebrania_sprawozdania')
        .select(`${SPRAWOZDANIE_LISTA_COLS}, dane`)
        .in('id', slice);
      if (error) throw new Error(`zebranieWersjeRows (sprawozdania): ${error.message}`);
      for (const r of data ?? []) biblioteka.set(Number(r.id), DatabaseService.sprawozdanieZapisaneRow(r));
    }
    return rows.map(r => DatabaseService.zebranieWersjaRow(r, biblioteka));
  }

  /** Every entry with its versions, newest entry first. Two queries, joined here. */
  async getZebrania(): Promise<Zebranie[]> {
    return this.cacheRead('zebrania', () => this.readZebrania());
  }

  private async readZebrania(): Promise<Zebranie[]> {
    const [rows, wersje] = await Promise.all([
      fetchAllPaged<any>('getZebrania', (from, to) =>
        getSupabase()
          .from('zebrania')
          .select(ZEBRANIE_COLS)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      ),
      fetchAllPaged<any>('getZebraniaWersje', (from, to) =>
        getSupabase()
          .from('zebrania_wersje')
          .select(ZEBRANIE_WERSJA_COLS)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ]);
    const versions = await this.zebranieWersjeRows(wersje);
    return rows.map(r => DatabaseService.zebranieRow(r, versions));
  }

  /**
   * Every entry with only what the calendar shows of it: the meeting it belongs
   * to and its newest version's status and ready marks. Two narrow selects — no
   * statement, plan or materials JSON, and no lookup of linked statements.
   */
  async getZebraniaStatus(): Promise<ZebranieStatusRow[]> {
    return this.cacheRead('zebraniaStatus', () => this.readZebraniaStatus());
  }

  private async readZebraniaStatus(): Promise<ZebranieStatusRow[]> {
    const [rows, wersje] = await Promise.all([
      fetchAllPaged<any>('getZebraniaStatus', (from, to) =>
        getSupabase()
          .from('zebrania')
          .select('id, spotkanieId:spotkanie_id')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      ),
      fetchAllPaged<any>('getZebraniaStatusWersje', (from, to) =>
        getSupabase()
          .from('zebrania_wersje')
          .select('id, zebranieId:zebranie_id, major, minor, status, gotowe')
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ]);
    // The newest version per entry, by the same order `sortWersje` keeps.
    const newest = new Map<number, NonNullable<ZebranieStatusRow['wersja']>>();
    for (const r of wersje) {
      const w = {
        id: Number(r.id),
        major: Number(r.major ?? 1),
        minor: Number(r.minor ?? 0),
        status: DatabaseService.zebranieStatus(r.status),
        gotowe: normalizeGotowe(r.gotowe),
      };
      const have = newest.get(Number(r.zebranieId));
      if (!have || (w.major - have.major || w.minor - have.minor || w.id - have.id) > 0) {
        newest.set(Number(r.zebranieId), w);
      }
    }
    return rows.map(r => ({
      id: Number(r.id),
      spotkanieId: r.spotkanieId != null ? Number(r.spotkanieId) : null,
      wersja: newest.get(Number(r.id)) ?? null,
    }));
  }

  private async getZebranieWhere(column: 'id' | 'spotkanie_id', value: number): Promise<Zebranie | null> {
    const { data, error } = await getSupabase()
      .from('zebrania')
      .select(ZEBRANIE_COLS)
      .eq(column, value)
      .maybeSingle();
    if (error) throw new Error(`getZebranie: ${error.message}`);
    if (!data) return null;
    const row = data as any;
    const { data: wersje, error: wError } = await getSupabase()
      .from('zebrania_wersje')
      .select(ZEBRANIE_WERSJA_COLS)
      .eq('zebranie_id', row.id)
      .order('id', { ascending: true });
    if (wError) throw new Error(`getZebranie (wersje): ${wError.message}`);
    return DatabaseService.zebranieRow(row, await this.zebranieWersjeRows(wersje ?? []));
  }

  async getZebranie(id: number): Promise<Zebranie | null> {
    return this.getZebranieWhere('id', id);
  }

  async getZebranieBySpotkanie(spotkanieId: number): Promise<Zebranie | null> {
    return this.getZebranieWhere('spotkanie_id', spotkanieId);
  }

  /** The meeting's data as an entry's snapshot columns. */
  private async spotkanieSnapshot(spotkanieId: number): Promise<Record<string, unknown> | null> {
    const { data, error } = await getSupabase()
      .from('spotkania')
      .select('nazwa, adres_id, adres_nazwa, lokalizacja_id, lokalizacja_nazwa, starts_at, materialy_status')
      .eq('id', spotkanieId)
      .maybeSingle();
    if (error) throw new Error(`spotkanieSnapshot: ${error.message}`);
    if (!data) return null;
    const m = data as any;
    let lokalizacjaAdres = '';
    if (m.lokalizacja_id != null) {
      // A failed read is an error, not an empty address: the snapshot would keep
      // the blank for good.
      const { data: lok, error: lokError } = await getSupabase()
        .from('spotkania_lokalizacje')
        .select('nazwa, adres')
        .eq('id', m.lokalizacja_id)
        .maybeSingle();
      if (lokError) throw new Error(`spotkanieSnapshot (lokalizacja): ${lokError.message}`);
      lokalizacjaAdres = ((lok as any)?.adres ?? '').trim();
    }
    return {
      nazwa: m.nazwa ?? '',
      adres_id: m.adres_id ?? null,
      adres_nazwa: m.adres_nazwa ?? '',
      lokalizacja_id: m.lokalizacja_id ?? null,
      lokalizacja_nazwa: m.lokalizacja_nazwa ?? '',
      lokalizacja_adres: lokalizacjaAdres,
      starts_at: m.starts_at ?? null,
      materialy_status: m.materialy_status ?? 'brak',
    };
  }

  /**
   * The template meeting's notice and resolutions, for a new meeting's first
   * version (see `ZebraniaUstawienia.szablonAdresNazwa`). A template that cannot
   * be read leaves the meeting empty rather than failing its creation.
   */
  private async materialySzablonu(who: string): Promise<ZebranieMaterial[]> {
    try {
      const { szablonAdresNazwa } = await this.getZebraniaUstawienia();
      if (!szablonAdresNazwa) return [];
      const [zebrania, spotkania] = await Promise.all([this.getZebrania(), this.getSpotkania()]);
      const zrodlo = zrodloSzablonu(zebrania, spotkania, [], szablonAdresNazwa);
      return zrodlo ? materialyZeSzablonu(materialySzablonu(zrodlo), who) : [];
    } catch (err) {
      console.warn('[Zebrania] template materials not applied:', err);
      return [];
    }
  }

  private async insertFirstWersja(zebranieId: number, who: string): Promise<void> {
    const materialy = await this.materialySzablonu(who);
    const { error } = await getSupabase().from('zebrania_wersje').insert({
      zebranie_id: zebranieId,
      major: 1,
      minor: 0,
      status: 'w_przygotowaniu',
      opis: '',
      materialy,
      created_by: who,
      updated_by: who,
    });
    if (error) throw new Error(`addZebranie (wersja 1.0): ${error.message}`);
  }

  /**
   * "Przygotuj materiały" on a meeting: its entry, created on the first click and
   * opened on every later one — one entry per meeting. Creating it puts the
   * meeting's materials at "to prepare" when they were needed but not yet asked
   * for, since preparing them is what just started. A meeting marked "no
   * materials needed" keeps that (see `materialyTargetForWersja`).
   */
  async createZebranieFromSpotkanie(spotkanieId: number, who: string): Promise<Zebranie> {
    return this.zebranieForSpotkanieOrNew(spotkanieId, who, true);
  }

  /**
   * The meeting form saved a meeting that needs materials: make sure it has its
   * Zebranie, without touching the meeting's materials status. Saving a meeting
   * is not "start preparing" — moving it to "to prepare" here would announce a
   * status change to everyone for every meeting typed into the calendar.
   */
  async ensureZebranieForSpotkanie(spotkanieId: number, who: string): Promise<Zebranie> {
    return this.zebranieForSpotkanieOrNew(spotkanieId, who, false);
  }

  private async zebranieForSpotkanieOrNew(
    spotkanieId: number,
    who: string,
    advanceMaterialy: boolean,
  ): Promise<Zebranie> {
    const existing = await this.getZebranieBySpotkanie(spotkanieId);
    if (existing) return existing;
    const snapshot = await this.spotkanieSnapshot(spotkanieId);
    if (!snapshot) throw new Error('Spotkanie nie istnieje — mogło zostać usunięte.');
    const { materialy_status: materialyStatus, ...columns } = snapshot;

    const { data, error } = await getSupabase()
      .from('zebrania')
      .insert({ ...columns, spotkanie_id: spotkanieId, created_by: who })
      .select('id')
      .single();
    if (error) {
      // Somebody else clicked at the same moment: the unique link means theirs won.
      if ((error as { code?: string }).code === '23505') {
        const raced = await this.getZebranieBySpotkanie(spotkanieId);
        if (raced) return raced;
      }
      throw new Error(`createZebranieFromSpotkanie: ${error.message}`);
    }
    const id = (data as { id: number }).id;
    await this.insertFirstWersja(id, who);
    if (advanceMaterialy && materialyStatus === 'potrzebne') {
      await this.writeSpotkanieMaterialy(spotkanieId, 'do_przygotowania', who);
    }
    const created = await this.getZebranie(id);
    if (!created) throw new Error('createZebranieFromSpotkanie: no data returned');
    return created;
  }

  private static zebraniePayload(input: ZebranieInput): Record<string, unknown> {
    const nazwa = (input.nazwa ?? '').trim();
    if (!nazwa) throw new Error('Zebranie musi mieć nazwę.');
    return {
      nazwa,
      adres_id: input.adresId ?? null,
      adres_nazwa: (input.adresNazwa ?? '').trim(),
      lokalizacja_id: input.lokalizacjaId ?? null,
      lokalizacja_nazwa: (input.lokalizacjaNazwa ?? '').trim(),
      lokalizacja_adres: (input.lokalizacjaAdres ?? '').trim(),
      starts_at: input.startsAt || null,
    };
  }

  /** A standalone entry — not linked to any meeting — starting at version 1.0. */
  async addZebranie(input: ZebranieInput, who: string): Promise<Zebranie> {
    const { data, error } = await getSupabase()
      .from('zebrania')
      .insert({ ...DatabaseService.zebraniePayload(input), spotkanie_id: null, created_by: who })
      .select('id')
      .single();
    const id = (unwrap(data, error, 'addZebranie') as { id: number }).id;
    await this.insertFirstWersja(id, who);
    const created = await this.getZebranie(id);
    if (!created) throw new Error('addZebranie: no data returned');
    return created;
  }

  /**
   * Edit a standalone entry's own data. A linked entry has none of its own — its
   * date and place are the meeting's, edited in the Kalendarz — so it is refused
   * rather than given a second copy that would silently disagree.
   */
  async updateZebranie(id: number, input: ZebranieInput): Promise<void> {
    const { data: before, error: readError } = await getSupabase()
      .from('zebrania')
      .select('spotkanie_id')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`updateZebranie (odczyt): ${readError.message}`);
    if ((before as { spotkanie_id?: number | null } | null)?.spotkanie_id != null) {
      throw new Error('To zebranie jest powiązane ze spotkaniem — termin i miejsce zmienia się w Kalendarzu.');
    }
    const { error } = await getSupabase()
      .from('zebrania')
      .update({ ...DatabaseService.zebraniePayload(input), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`updateZebranie: ${error.message}`);
  }

  /** Delete an entry and its versions (ON DELETE CASCADE). The meeting is left as it is. */
  async deleteZebranie(id: number): Promise<void> {
    const { error } = await getSupabase().from('zebrania').delete().eq('id', id);
    if (error) throw new Error(`deleteZebranie: ${error.message}`);
  }

  /**
   * Delete one version. The only version is refused — an entry without one has
   * nothing to show; delete the whole entry instead. When the newest version
   * goes, the one before becomes current and a linked meeting follows its status.
   */
  async deleteZebranieWersja(id: number, who: string): Promise<void> {
    const { data, error } = await getSupabase()
      .from('zebrania_wersje')
      .select('zebranie_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`deleteZebranieWersja (odczyt): ${error.message}`);
    if (!data) return;
    const zebranieId = (data as { zebranie_id: number }).zebranie_id;
    const before = await this.getZebranie(zebranieId);
    if (!before) return;
    if (before.wersje.length <= 1) {
      throw new Error('To jedyna wersja tego zebrania — usuń całe zebranie zamiast niej.');
    }
    const { error: delError } = await getSupabase().from('zebrania_wersje').delete().eq('id', id);
    if (delError) throw new Error(`deleteZebranieWersja: ${delError.message}`);
    await this.touchZebranie(zebranieId);
    if (latestWersja(before)?.id === id) {
      const after = await this.getZebranie(zebranieId);
      const newest = after ? latestWersja(after) : null;
      if (after && newest) await this.syncSpotkanieFromWersja(after.spotkanieId, newest.status, who);
    }
  }

  private async touchZebranie(zebranieId: number): Promise<void> {
    const { error } = await getSupabase()
      .from('zebrania')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', zebranieId);
    if (error) throw new Error(`touchZebranie: ${error.message}`);
  }

  /**
   * A new revision (1.0 → 1.1): a copy of the newest version's materials, being
   * prepared again. It becomes the current version, so a linked meeting goes
   * back to "to prepare" — corrections are materials not yet ready.
   */
  async addZebranieWersja(zebranieId: number, who: string): Promise<ZebranieWersja> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const zebranie = await this.getZebranie(zebranieId);
      if (!zebranie) throw new Error('Zebranie nie istnieje — mogło zostać usunięte.');
      const from = latestWersja(zebranie);
      const { major, minor } = nextWersjaNumber(zebranie.wersje);
      const { data, error } = await getSupabase()
        .from('zebrania_wersje')
        .insert({
          zebranie_id: zebranieId,
          major,
          minor,
          status: 'w_przygotowaniu',
          // A revision is corrections still to make — every document starts not ready.
          gotowe: {},
          opis: '',
          materialy: copyMaterialyForRevision(from?.materialy ?? []),
          // The statement and the plan come along too; their downloads were of
          // the old version and stay behind with it. The statement stays the
          // same library row; a hand-made unlink carries over as well.
          sprawozdanie_id: from?.sprawozdanie?.sprawozdanieId ?? null,
          sprawozdanie: from?.sprawozdanie
            ? DatabaseService.sprawozdanieMetaRow({ ...from.sprawozdanie, pobrania: [] })
            : from?.sprawozdanieOdlaczone
              ? SPRAWOZDANIE_ODLACZONE
              : null,
          plan: from?.plan ? { ...from.plan, pobrania: [] } : null,
          created_by: who,
          updated_by: who,
        })
        .select(ZEBRANIE_WERSJA_COLS)
        .single();
      if (error) {
        // Two people added a revision at once and took the same number: re-read and take the next.
        if ((error as { code?: string }).code === '23505' && attempt === 0) continue;
        throw new Error(`addZebranieWersja: ${error.message}`);
      }
      await this.touchZebranie(zebranieId);
      await this.syncSpotkanieFromWersja(zebranie.spotkanieId, 'w_przygotowaniu', who);
      return (await this.zebranieWersjeRows([data]))[0];
    }
    throw new Error('addZebranieWersja: nie udało się nadać numeru wersji.');
  }

  /**
   * Save a version's description and materials. Any version, not only the newest.
   * Each material's download record is the server's, kept from the stored row —
   * a download noted while the form was open is not undone by its save — and a
   * material's fields this version does not know are kept as stored.
   */
  async updateZebranieWersja(
    id: number,
    input: ZebranieWersjaInput,
    who: string,
    expectedUpdatedAt?: string | null,
  ): Promise<void> {
    const result = await this.casUpdate<{ zebranie_id: number; materialy: unknown; updated_at: string }>(
      'zebrania_wersje',
      id,
      'zebranie_id, materialy',
      'updateZebranieWersja',
      (row) => {
        const stored = new Map(normalizeMaterialy(row.materialy).map((m) => [m.id, m] as const));
        const materialy = normalizeMaterialy(input.materialy).map((m) => {
          const before = stored.get(m.id);
          return before ? { ...m, pobrania: before.pobrania } : m;
        });
        return {
          opis: (input.opis ?? '').trim(),
          materialy: keepUnknownItems(row.materialy, materialy, 'id'),
          updated_by: who,
        };
      },
      { expectedUpdatedAt },
    );
    if (!result) throw new Error('Tej wersji już nie ma — mogła zostać usunięta.');
    await this.touchZebranie(result.row.zebranie_id);
  }

  /**
   * Rename a revision. Only the name is written, so a rename cannot overwrite a
   * notice or a note saved meanwhile.
   */
  async setZebranieWersjaNazwa(id: number, nazwa: string, who: string): Promise<void> {
    const { data, error } = await getSupabase()
      .from('zebrania_wersje')
      .update({
        nazwa: (nazwa ?? '').trim().slice(0, ZEBRANIE_WERSJA_NAZWA_MAX),
        updated_at: new Date().toISOString(),
        updated_by: who,
      })
      .eq('id', id)
      .select('zebranie_id')
      .maybeSingle();
    if (error) throw new Error(`setZebranieWersjaNazwa: ${error.message}`);
    if (!data) throw new Error('Tej wersji już nie ma — mogła zostać usunięta.');
    await this.touchZebranie((data as { zebranie_id: number }).zebranie_id);
  }

  /** The documents' ready marks and the status they add up to — always written together. */
  private async writeZebranieWersjaGotowe(id: number, gotowe: ZebranieGotowe, who: string): Promise<ZebranieStatus> {
    const clean = normalizeGotowe(gotowe);
    const status = wersjaStatusFromGotowe(clean);
    const { error } = await getSupabase()
      .from('zebrania_wersje')
      .update({ gotowe: clean, status, updated_at: new Date().toISOString(), updated_by: who })
      .eq('id', id);
    if (error) throw new Error(`setZebranieDokumentGotowe: ${error.message}`);
    return status;
  }

  /** Move a linked meeting's materials to what its newest version now says. */
  private async syncSpotkanieFromWersja(
    spotkanieId: number | null,
    status: ZebranieStatus,
    who: string,
  ): Promise<void> {
    if (spotkanieId == null) return;
    const { data, error } = await getSupabase()
      .from('spotkania')
      .select('materialy_status')
      .eq('id', spotkanieId)
      .maybeSingle();
    if (error) throw new Error(`syncSpotkanieFromWersja: ${error.message}`);
    if (!data) return;
    const current = DatabaseService.materialyStatus((data as any).materialy_status);
    const target = materialyTargetForWersja(current, status);
    if (target) await this.writeSpotkanieMaterialy(spotkanieId, target, who);
  }

  /**
   * Mark one document of a version ready (or not). The version's status follows
   * — prepared only when every document is — and when it is the newest version
   * of a linked entry, the meeting's materials status follows that.
   */
  async setZebranieDokumentGotowe(
    id: number,
    dokument: ZebranieDokumentKlucz,
    gotowe: boolean,
    who: string,
  ): Promise<void> {
    if (!ZEBRANIE_DOKUMENTY.includes(dokument)) throw new Error(`Nieznany dokument zebrania: ${dokument}`);
    // One mark among several: applied to the marks as they are when the write
    // lands, so two people marking two documents at once both count.
    let status: ZebranieStatus = 'w_przygotowaniu';
    const result = await this.casUpdate<{ zebranie_id: number; gotowe: unknown; updated_at: string }>(
      'zebrania_wersje',
      id,
      'zebranie_id, gotowe',
      'setZebranieDokumentGotowe',
      (row) => {
        const clean = normalizeGotowe({ ...normalizeGotowe(row.gotowe), [dokument]: gotowe });
        status = wersjaStatusFromGotowe(clean);
        return { gotowe: clean, status, updated_by: who };
      },
    );
    if (!result) throw new Error('Wersja nie istnieje — mogła zostać usunięta.');
    const zebranie = await this.getZebranie(result.row.zebranie_id);
    if (!zebranie) return;
    await this.touchZebranie(zebranie.id);
    if (latestWersja(zebranie)?.id === id) {
      await this.syncSpotkanieFromWersja(zebranie.spotkanieId, status, who);
    }
  }

  /** Note a download on the material it was made from — who, when, which files. */
  async recordZebraniePobranie(
    wersjaId: number,
    materialId: string,
    pliki: string[],
    who: string,
  ): Promise<void> {
    // Appended to the list as it is when the write lands (see casUpdate): a form
    // saved, or another download noted, at the same moment loses nothing.
    const entry = { at: new Date().toISOString(), by: who, pliki };
    await this.casUpdate<{ materialy: unknown; updated_at: string }>(
      'zebrania_wersje',
      wersjaId,
      'materialy',
      'recordZebraniePobranie',
      (row) => {
        const materialy = normalizeMaterialy(row.materialy).map((m) =>
          m.id === materialId ? { ...m, pobrania: [...m.pobrania, entry] } : m,
        );
        return { materialy: keepUnknownItems(row.materialy, materialy, 'id') };
      },
      { stamp: 'note' },
    );
  }

  // ---------------- Zebrania: statements, plans, settings ----------------

  async getZebranieWersja(id: number): Promise<ZebranieWersja | null> {
    const { data, error } = await getSupabase()
      .from('zebrania_wersje')
      .select(ZEBRANIE_WERSJA_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getZebranieWersja: ${error.message}`);
    return data ? (await this.zebranieWersjeRows([data]))[0] : null;
  }

  /** The version's own part of its statement, as stored. */
  private static sprawozdanieMetaRow(meta: ZebranieSprawozdanieMeta): ZebranieSprawozdanieMeta {
    const m = normalizeSprawozdanieMeta(meta);
    return { dodano: m.dodano, dodal: m.dodal, pobrania: m.pobrania, wstep: m.wstep, laczenia: m.laczenia, podkategorie: m.podkategorie };
  }

  /**
   * Link a library statement to a version. The figures stay the library's: a
   * newer print uploaded in Sprawozdania shows in the meeting at once.
   */
  async attachZebranieSprawozdanie(wersjaId: number, sprawozdanieId: number, who: string): Promise<void> {
    const { data: row, error: rowError } = await getSupabase()
      .from('zebrania_sprawozdania')
      .select('id')
      .eq('id', sprawozdanieId)
      .maybeSingle();
    if (rowError) throw new Error(`attachZebranieSprawozdanie (odczyt): ${rowError.message}`);
    if (!row) throw new Error('Tego sprawozdania nie ma już w module Sprawozdania — mogło zostać usunięte.');
    await this.writeZebranieWersjaSprawozdanie(
      wersjaId,
      sprawozdanieId,
      // Another statement means other figures: an introduction edited for the old one, and its merges, do not carry over.
      DatabaseService.sprawozdanieMetaRow({
        dodano: new Date().toISOString(),
        dodal: who,
        pobrania: [],
        wstep: null,
        laczenia: [],
        podkategorie: [],
      }),
      who,
    );
  }

  /**
   * Unlink a version's statement. The library row stays; the version is marked
   * so the tab does not link one again by itself.
   */
  async unlinkZebranieSprawozdanie(wersjaId: number, who: string): Promise<void> {
    await this.writeZebranieWersjaSprawozdanie(wersjaId, null, SPRAWOZDANIE_ODLACZONE, who);
  }

  private async writeZebranieWersjaSprawozdanie(
    wersjaId: number,
    sprawozdanieId: number | null,
    stored: object,
    who: string,
  ): Promise<void> {
    const { data, error } = await getSupabase()
      .from('zebrania_wersje')
      .update({
        sprawozdanie_id: sprawozdanieId,
        sprawozdanie: stored,
        updated_at: new Date().toISOString(),
        updated_by: who,
      })
      .eq('id', wersjaId)
      .select('zebranie_id')
      .maybeSingle();
    if (error) throw new Error(`writeZebranieWersjaSprawozdanie: ${error.message}`);
    if (!data) throw new Error('Tej wersji już nie ma — mogła zostać usunięta.');
    await this.touchZebranie((data as { zebranie_id: number }).zebranie_id);
  }

  /**
   * Save the edited introduction of a version's statement (null = back to the
   * computed one). Written into the version's own part, so the download record
   * is kept as it is.
   */
  async setZebranieSprawozdanieWstep(
    wersjaId: number,
    wstep: SprawozdanieWstepTekst | null,
    who: string,
  ): Promise<void> {
    await this.patchZebranieSprawozdanieMeta(wersjaId, { wstep: normalizeWstepTekst(wstep) }, who, 'setZebranieSprawozdanieWstep');
  }

  /** Save the rows merged, or the subcategories, of a version's statement (an empty list = none). */
  async setZebranieSprawozdanieLaczenia(
    wersjaId: number,
    rodzaj: SprawozdanieGrupowanie,
    lista: SprawozdanieLaczenie[],
    who: string,
  ): Promise<void> {
    await this.patchZebranieSprawozdanieMeta(
      wersjaId,
      rodzaj === 'podkategorie' ? { podkategorie: normalizeLaczenia(lista) } : { laczenia: normalizeLaczenia(lista) },
      who,
      'setZebranieSprawozdanieLaczenia',
    );
  }

  /** Rewrite part of a version's own statement data, keeping the rest — the download record too — as stored. */
  private async patchZebranieSprawozdanieMeta(
    wersjaId: number,
    patch: Partial<ZebranieSprawozdanieMeta>,
    who: string,
    op: string,
  ): Promise<void> {
    const result = await this.casUpdate<{
      zebranie_id: number;
      sprawozdanie: unknown;
      sprawozdanie_id: number | null;
      updated_at: string;
    }>('zebrania_wersje', wersjaId, 'zebranie_id, sprawozdanie, sprawozdanie_id', op, (row) => {
      if (row.sprawozdanie_id == null) throw new Error('Ta wersja nie ma już sprawozdania.');
      return {
        sprawozdanie: DatabaseService.sprawozdanieMetaRow({ ...normalizeSprawozdanieMeta(row.sprawozdanie), ...patch }),
        updated_by: who,
      };
    });
    if (!result) throw new Error('Tej wersji już nie ma — mogła zostać usunięta.');
    await this.touchZebranie(result.row.zebranie_id);
  }

  /**
   * Save a version's plan (or remove it with null). The download record is
   * kept from the stored row, so saving an edit cannot drop a download noted
   * meanwhile.
   */
  async setZebranieWersjaPlan(
    wersjaId: number,
    value: PlanGospodarczy | null,
    who: string,
    expectedUpdatedAt?: string | null,
  ): Promise<void> {
    const normalized = value ? normalizePlan(value) : null;
    const zmieniono = new Date().toISOString();
    const result = await this.casUpdate<{ zebranie_id: number; plan: unknown; updated_at: string }>(
      'zebrania_wersje',
      wersjaId,
      'zebranie_id, plan',
      'setZebranieWersjaPlan',
      (row) => ({
        plan: normalized
          ? { ...normalized, zmieniono, zmienil: who, pobrania: normalizePlan(row.plan)?.pobrania ?? [] }
          : null,
        updated_by: who,
      }),
      { expectedUpdatedAt },
    );
    if (!result) throw new Error('Tej wersji już nie ma — mogła zostać usunięta.');
    await this.touchZebranie(result.row.zebranie_id);
  }

  /** Note a download of a version's statement or plan. */
  async recordZebranieDokumentPobranie(
    wersjaId: number,
    dokument: ZebranieDokument,
    pliki: string[],
    who: string,
  ): Promise<void> {
    const entry = { at: new Date().toISOString(), by: who, pliki };
    await this.casUpdate<Record<string, unknown> & { updated_at: string }>(
      'zebrania_wersje',
      wersjaId,
      dokument,
      'recordZebranieDokumentPobranie',
      (row) => {
        const stored = row[dokument];
        if (!stored || typeof stored !== 'object') return null;
        const doc = stored as Record<string, unknown>;
        return { [dokument]: { ...doc, pobrania: [...normalizePobrania(doc.pobrania), entry] } };
      },
      { stamp: 'note' },
    );
  }

  private static sprawozdanieZapisaneRow(r: any): SprawozdanieZapisane {
    return {
      id: r.id,
      nrWsp: r.nr_wsp ?? null,
      nazwa: r.nazwa ?? '',
      okresOd: r.okres_od ?? '',
      okresDo: r.okres_do ?? '',
      plikNazwa: r.plik_nazwa ?? '',
      importedAt: r.imported_at ?? '',
      importedBy: r.imported_by ?? '',
      ...(r.dane !== undefined ? { dane: normalizeSprawozdanieDane(r.dane) ?? undefined } : {}),
    };
  }

  /**
   * Store every statement of an uploaded file — the Sprawozdania module is the
   * one place they are uploaded, and the source of truth. A statement of a
   * period already in the library replaces it in place (a newer print of the
   * same figures, same row), so every meeting linked to it shows the new print.
   * A statement without a community number or a period cannot be matched and
   * is skipped.
   */
  async importSprawozdania(lista: Sprawozdanie[], plikNazwa: string, who: string): Promise<SprawozdanieZapisane[]> {
    const rows = lista
      .filter((s) => s.nrWsp != null && s.okresOd && s.okresDo)
      .map((s) => ({
        nr_wsp: s.nrWsp,
        nazwa: s.nazwa,
        okres_od: s.okresOd,
        okres_do: s.okresDo,
        dane: s,
        plik_nazwa: plikNazwa,
        imported_at: new Date().toISOString(),
        imported_by: who,
      }));
    const out: SprawozdanieZapisane[] = [];
    for (const slice of DatabaseService.chunk(rows, 100)) {
      const { data, error } = await getSupabase()
        .from('zebrania_sprawozdania')
        .upsert(slice, { onConflict: 'nr_wsp,okres_od,okres_do' })
        .select(SPRAWOZDANIE_LISTA_COLS);
      if (error) throw new Error(`importSprawozdania: ${error.message}`);
      out.push(...(data ?? []).map(DatabaseService.sprawozdanieZapisaneRow));
    }
    return out;
  }

  /**
   * Remove a statement from the library. One a meeting's version links is
   * refused — unlink it in Zebrania first, so no meeting loses its statement
   * without anyone deciding so.
   */
  async deleteSprawozdanie(id: number): Promise<void> {
    const { count, error: linkError } = await getSupabase()
      .from('zebrania_wersje')
      .select('id', { count: 'exact', head: true })
      .eq('sprawozdanie_id', id);
    if (linkError) throw new Error(`deleteSprawozdanie (powiązania): ${linkError.message}`);
    if ((count ?? 0) > 0) {
      throw new Error('To sprawozdanie jest powiązane z zebraniem — odłącz je najpierw w Zebraniach.');
    }
    const { data, error } = await getSupabase().from('zebrania_sprawozdania').delete().eq('id', id).select('id');
    if (error) throw new Error(`deleteSprawozdanie: ${error.message}`);
    if (!data || data.length === 0) throw new Error('Tego sprawozdania już nie ma — mogło zostać usunięte.');
  }

  /** The library, without the statements themselves — newest period first. */
  async getSprawozdaniaLista(): Promise<SprawozdanieZapisane[]> {
    const rows = await fetchAllPaged<any>('getSprawozdaniaLista', (from, to) =>
      getSupabase()
        .from('zebrania_sprawozdania')
        .select(SPRAWOZDANIE_LISTA_COLS)
        .order('okres_do', { ascending: false })
        .order('nazwa', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.sprawozdanieZapisaneRow);
  }

  /** The library statement of a community and period, figures included — what a module plan was drafted from. */
  async getSprawozdanieOkresu(nrWsp: number, od: string, doDnia: string): Promise<SprawozdanieZapisane | null> {
    const { data, error } = await getSupabase()
      .from('zebrania_sprawozdania')
      .select(`${SPRAWOZDANIE_LISTA_COLS}, dane`)
      .eq('nr_wsp', nrWsp)
      .eq('okres_od', od)
      .eq('okres_do', doDnia)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`getSprawozdanieOkresu: ${error.message}`);
    return data ? DatabaseService.sprawozdanieZapisaneRow(data) : null;
  }

  async getSprawozdanie(id: number): Promise<SprawozdanieZapisane | null> {
    const { data, error } = await getSupabase()
      .from('zebrania_sprawozdania')
      .select(`${SPRAWOZDANIE_LISTA_COLS}, dane`)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getSprawozdanie: ${error.message}`);
    return data ? DatabaseService.sprawozdanieZapisaneRow(data) : null;
  }

  /* ---------------------- Plany gospodarcze (own plans) ---------------------- */

  private static planWlasnyRow(r: any): PlanWlasny | null {
    const plan = normalizePlan(r.plan);
    if (!plan || r.nr_wsp == null) return null;
    return {
      id: r.id,
      nrWsp: r.nr_wsp,
      nazwa: r.nazwa ?? '',
      rok: r.rok ?? plan.rok,
      plan,
      // Absent before plany-gospodarcze-sprawozdanie.sql: nothing regrouped yet.
      sprawozdanie: normalizePlanSprawozdanieMeta(r.sprawozdanie),
      createdAt: r.created_at ?? '',
      createdBy: r.created_by ?? '',
      updatedAt: r.updated_at ?? '',
      updatedBy: r.updated_by ?? '',
    };
  }

  /** A second plan of one community and year — the unique key says no. */
  private static planWlasnyError(op: string, error: { code?: string; message: string }): Error {
    return error.code === '23505'
      ? new Error('Plan tej wspólnoty na ten rok już jest w Planach gospodarczych — otwórz go zamiast tworzyć drugi.')
      : new Error(`${op}: ${error.message}`);
  }

  /** Plans made in the Plany gospodarcze module — newest year first. */
  async getPlanyWlasne(): Promise<PlanWlasny[]> {
    const rows = await fetchAllPaged<any>('getPlanyWlasne', (from, to) =>
      getSupabase()
        .from('plany_gospodarcze')
        .select('*')
        .order('rok', { ascending: false })
        .order('nazwa', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.planWlasnyRow).filter((p): p is PlanWlasny => p !== null);
  }

  async getPlanWlasny(id: number): Promise<PlanWlasny | null> {
    const { data, error } = await getSupabase().from('plany_gospodarcze').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getPlanWlasny: ${error.message}`);
    return data ? DatabaseService.planWlasnyRow(data) : null;
  }

  async addPlanWlasny(nrWsp: number, nazwa: string, value: PlanGospodarczy, who: string): Promise<PlanWlasny> {
    const plan = normalizePlan(value);
    if (!plan) throw new Error('Nie ma czego zapisać — plan jest pusty.');
    const now = new Date().toISOString();
    const { data, error } = await getSupabase()
      .from('plany_gospodarcze')
      .insert({
        nr_wsp: nrWsp,
        nazwa,
        rok: plan.rok,
        plan: { ...plan, zmieniono: now, zmienil: who, pobrania: [] },
        created_at: now,
        created_by: who,
        updated_at: now,
        updated_by: who,
      })
      .select('*')
      .single();
    if (error) throw DatabaseService.planWlasnyError('addPlanWlasny', error);
    const row = DatabaseService.planWlasnyRow(data);
    if (!row) throw new Error('addPlanWlasny: zapisany plan jest nieczytelny.');
    return row;
  }

  /**
   * Save an edited plan. The year follows the plan's own, and the download
   * record is kept from the stored row, like a version's plan — the row as it is
   * when the write lands (see casUpdate).
   */
  async setPlanWlasny(
    id: number,
    value: PlanGospodarczy,
    who: string,
    expectedUpdatedAt?: string | null,
  ): Promise<void> {
    const normalized = normalizePlan(value);
    if (!normalized) throw new Error('Nie ma czego zapisać — plan jest pusty.');
    const now = new Date().toISOString();
    const result = await this.casUpdate<any>(
      'plany_gospodarcze',
      id,
      '*',
      'setPlanWlasny',
      (row) => ({
        rok: normalized.rok,
        plan: {
          ...normalized,
          zmieniono: now,
          zmienil: who,
          pobrania: DatabaseService.planWlasnyRow(row)?.plan.pobrania ?? [],
        },
        updated_by: who,
      }),
      { expectedUpdatedAt, mapError: (error) => DatabaseService.planWlasnyError('setPlanWlasny', error) },
    );
    if (!result) throw new Error('Tego planu już nie ma — mógł zostać usunięty.');
  }

  async deletePlanWlasny(id: number): Promise<void> {
    const { error } = await getSupabase().from('plany_gospodarcze').delete().eq('id', id);
    if (error) throw new Error(`deletePlanWlasny: ${error.message}`);
  }

  /** Note a download of a module plan, or of its statement. */
  async recordPlanWlasnyPobranie(
    id: number,
    dokument: 'plan' | 'sprawozdanie',
    pliki: string[],
    who: string,
  ): Promise<void> {
    const entry = { at: new Date().toISOString(), by: who, pliki };
    // `*`, not named columns: `sprawozdanie` arrives with a migration that may not have run.
    await this.casUpdate<any>(
      'plany_gospodarcze',
      id,
      '*',
      'recordPlanWlasnyPobranie',
      (row) => {
        const stored = DatabaseService.planWlasnyRow(row);
        if (!stored) return null;
        return dokument === 'sprawozdanie'
          ? { sprawozdanie: { ...stored.sprawozdanie, pobrania: [...stored.sprawozdanie.pobrania, entry] } }
          : { plan: { ...stored.plan, pobrania: [...stored.plan.pobrania, entry] } };
      },
      { stamp: 'note' },
    );
  }

  /**
   * Rewrite part of a module plan's own statement data (merges, subcategories,
   * the introduction), keeping the rest as stored.
   */
  async patchPlanWlasnySprawozdanie(
    id: number,
    patch: Partial<Omit<PlanSprawozdanieMeta, 'pobrania'>>,
    who: string,
  ): Promise<void> {
    const result = await this.casUpdate<any>(
      'plany_gospodarcze',
      id,
      '*',
      'patchPlanWlasnySprawozdanie',
      (row) => {
        const stored = DatabaseService.planWlasnyRow(row);
        if (!stored) throw new Error('Tego planu już nie ma — mógł zostać usunięty.');
        return {
          sprawozdanie: normalizePlanSprawozdanieMeta({ ...stored.sprawozdanie, ...patch }),
          updated_by: who,
        };
      },
      {
        mapError: (error) =>
          new Error(
            /sprawozdanie/.test(error.message)
              ? 'Baza nie ma jeszcze miejsca na sprawozdanie planu — uruchom w Supabase plik plany-gospodarcze-sprawozdanie.sql.'
              : `patchPlanWlasnySprawozdanie: ${error.message}`,
          ),
      },
    );
    if (!result) throw new Error('Tego planu już nie ma — mógł zostać usunięty.');
  }

  /* ------------------------ Podatki — nieruchomości (DN-1) ------------------------ */

  private static podatekRow(r: any): PodatekNieruchomosci {
    return {
      id: r.id,
      nip: r.nip ?? '',
      rok: r.rok,
      dane: normalizeDane(r.dane),
      createdAt: r.created_at ?? '',
      createdBy: r.created_by ?? '',
      updatedAt: r.updated_at ?? '',
      updatedBy: r.updated_by ?? '',
    };
  }

  /** A second declaration of one community and year — the unique key says no. */
  private static podatekError(op: string, error: { code?: string; message: string }): Error {
    return error.code === '23505'
      ? new Error('Ta wspólnota (ten NIP) ma już deklarację na ten rok — otwórz ją zamiast dodawać drugą.')
      : new Error(`${op}: ${error.message}`);
  }

  /** Every year's declarations — newest year first, then by name. */
  async getPodatkiNieruchomosci(): Promise<PodatekNieruchomosci[]> {
    const rows = await fetchAllPaged<any>('getPodatkiNieruchomosci', (from, to) =>
      getSupabase()
        .from('podatki_nieruchomosci')
        .select('*')
        .order('rok', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.podatekRow);
  }

  async getPodatekNieruchomosci(id: number): Promise<PodatekNieruchomosci | null> {
    const { data, error } = await getSupabase().from('podatki_nieruchomosci').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getPodatekNieruchomosci: ${error.message}`);
    return data ? DatabaseService.podatekRow(data) : null;
  }

  async addPodatekNieruchomosci(
    nip: string,
    rok: number,
    value: PodatekNieruchomosciDane,
    who: string,
  ): Promise<PodatekNieruchomosci> {
    const now = new Date().toISOString();
    const { data, error } = await getSupabase()
      .from('podatki_nieruchomosci')
      .insert({
        nip: tylkoCyfry(nip),
        rok,
        dane: { ...normalizeDane(value), pobrania: [], dom: null },
        created_at: now,
        created_by: who,
        updated_at: now,
        updated_by: who,
      })
      .select('*')
      .single();
    if (error) throw DatabaseService.podatekError('addPodatekNieruchomosci', error);
    return DatabaseService.podatekRow(data);
  }

  /**
   * Save an edited declaration; the download record and the DOM tick are kept
   * from the stored row — as it is when the write lands (see casUpdate) — and so
   * are the fields of `dane` this version of the app does not know.
   */
  async setPodatekNieruchomosci(
    id: number,
    nip: string,
    value: PodatekNieruchomosciDane,
    who: string,
  ): Promise<PodatekNieruchomosci> {
    const result = await this.casUpdate<{ dane: unknown; updated_at: string }>(
      'podatki_nieruchomosci',
      id,
      'dane',
      'setPodatekNieruchomosci',
      (row) => {
        const stored = normalizeDane(row.dane);
        return {
          nip: tylkoCyfry(nip),
          dane: keepUnknownKeys(row.dane, { ...normalizeDane(value), pobrania: stored.pobrania, dom: stored.dom }),
          updated_by: who,
        };
      },
      { returning: '*', mapError: (error) => DatabaseService.podatekError('setPodatekNieruchomosci', error) },
    );
    if (!result?.written) throw new Error('Tej deklaracji już nie ma — mogła zostać usunięta.');
    return DatabaseService.podatekRow(result.written);
  }

  async deletePodatekNieruchomosci(id: number): Promise<void> {
    const { error } = await getSupabase().from('podatki_nieruchomosci').delete().eq('id', id);
    if (error) throw new Error(`deletePodatekNieruchomosci: ${error.message}`);
  }

  /** Note a downloaded PDF of a declaration — appended to the list as it is when the write lands. */
  async recordPodatekPobranie(id: number, plik: string, who: string, podpis?: PodpisSlad): Promise<void> {
    const entry: PodatekPobranie = { at: new Date().toISOString(), by: who, plik, ...(podpis ? { podpis } : {}) };
    await this.casUpdate<{ dane: unknown; updated_at: string }>(
      'podatki_nieruchomosci',
      id,
      'dane',
      'recordPodatekPobranie',
      (row) => {
        const dane = normalizeDane(row.dane);
        return { dane: keepUnknownKeys(row.dane, { ...dane, pobrania: [...dane.pobrania, entry] }) };
      },
      { stamp: 'note' },
    );
  }

  /** Rows by id, read in slices so a long selection never makes an over-long request. */
  private async readByIds(table: string, ids: number[], op: string): Promise<any[]> {
    const out: any[] = [];
    for (const slice of DatabaseService.chunk([...new Set(ids)], 100)) {
      const { data, error } = await getSupabase().from(table).select('*').in('id', slice);
      if (error) throw new Error(`${op}: ${error.message}`);
      out.push(...(data ?? []));
    }
    return out;
  }

  /**
   * Tick declarations as posted in DOM, or take the tick off. A row already
   * ticked keeps who ticked it and when. Returns the rows as they now are.
   * Read in one go; each row is then written under casUpdate, so a download
   * noted on it meanwhile is kept rather than overwritten.
   */
  async setPodatkiDom(ids: number[], booked: boolean, who: string): Promise<PodatekNieruchomosci[]> {
    if (ids.length === 0) return [];
    const rows = await this.readByIds('podatki_nieruchomosci', ids, 'setPodatkiDom');
    const stamp = { at: new Date().toISOString(), by: who };
    const out: PodatekNieruchomosci[] = [];
    for (const slice of DatabaseService.chunk(rows, 10)) {
      const results = await Promise.all(
        slice.map((initial) =>
          this.casUpdate<any>(
            'podatki_nieruchomosci',
            initial.id,
            '*',
            'setPodatkiDom',
            (row) => {
              const dane = normalizeDane(row.dane);
              const dom = booked ? dane.dom ?? stamp : null;
              // Already as asked: nothing to write.
              if ((dom === null) === (dane.dom === null)) return null;
              return { dane: keepUnknownKeys(row.dane, { ...dane, dom }) };
            },
            { stamp: 'note', initial, returning: '*' },
          ),
        ),
      );
      for (const result of results) {
        if (result) out.push(DatabaseService.podatekRow(result.written ?? result.row));
      }
    }
    return out;
  }

  /**
   * Add declarations a year does not have yet. A community (NIP) the year
   * already holds is left as it is — never overwritten. Returns how many were
   * added and how many skipped.
   */
  async addPodatkiNieruchomosciBrakujace(
    rekordy: { nip: string; rok: number; dane: PodatekNieruchomosciDane }[],
    who: string,
  ): Promise<{ dodane: number; istniejace: number }> {
    const existing = new Set((await this.getPodatkiNieruchomosci()).map((p) => `${p.nip}|${p.rok}`));
    const now = new Date().toISOString();
    const nowe = rekordy
      .map((r) => ({ ...r, nip: tylkoCyfry(r.nip) }))
      .filter((r) => !existing.has(`${r.nip}|${r.rok}`));
    await this.insertChunked(
      'podatki_nieruchomosci',
      nowe.map((r) => ({
        nip: r.nip,
        rok: r.rok,
        dane: { ...normalizeDane(r.dane), pobrania: [], dom: null },
        created_at: now,
        created_by: who,
        updated_at: now,
        updated_by: who,
      })),
    );
    return { dodane: nowe.length, istniejace: rekordy.length - nowe.length };
  }

  /**
   * Start year `naRok` from `zRoku`: every community of `zRoku` the new year
   * does not have yet gets next year's draft of its declaration. The rates
   * come along too when the new year has none — marked unconfirmed, as they
   * are last year's until somebody checks the new resolution.
   */
  async przeniesPodatkiNaRok(zRoku: number, naRok: number, who: string): Promise<number> {
    const all = await this.getPodatkiNieruchomosci();
    const zrodlo = all.filter((p) => p.rok === zRoku);
    const { dodane } = await this.addPodatkiNieruchomosciBrakujace(
      zrodlo.map((p) => ({ nip: p.nip, rok: naRok, dane: daneNaKolejnyRok(p.dane) })),
      who,
    );
    const stawki = await this.getPodatkiStawki();
    const stare = stawki.find((s) => s.rok === zRoku);
    if (stare && !stawki.some((s) => s.rok === naRok)) {
      const { error } = await getSupabase().from('podatki_stawki').insert({
        rok: naRok,
        stawki: stare.stawki,
        potwierdzone: false,
        updated_at: new Date().toISOString(),
        updated_by: who,
      });
      if (error && error.code !== '23505') throw new Error(`przeniesPodatkiNaRok: ${error.message}`);
    }
    return dodane;
  }

  private static stawkiRow(r: any): PodatkiStawki {
    return {
      rok: r.rok,
      stawki: normalizeStawki(r.stawki),
      potwierdzone: r.potwierdzone === true,
      updatedAt: r.updated_at ?? '',
      updatedBy: r.updated_by ?? '',
    };
  }

  async getPodatkiStawki(): Promise<PodatkiStawki[]> {
    const { data, error } = await getSupabase()
      .from('podatki_stawki')
      .select('*')
      .order('rok', { ascending: false });
    if (error) throw new Error(`getPodatkiStawki: ${error.message}`);
    return (data ?? []).map(DatabaseService.stawkiRow);
  }

  /** Save a year's rates — saving them is what confirms them. */
  async setPodatkiStawki(rok: number, stawki: PodatkiStawkiDane, who: string): Promise<PodatkiStawki> {
    const { data, error } = await getSupabase()
      .from('podatki_stawki')
      .upsert(
        {
          rok,
          stawki: normalizeStawki(stawki),
          potwierdzone: true,
          updated_at: new Date().toISOString(),
          updated_by: who,
        },
        { onConflict: 'rok' },
      )
      .select('*')
      .single();
    if (error) throw new Error(`setPodatkiStawki: ${error.message}`);
    return DatabaseService.stawkiRow(data);
  }

  /* ------------------------------- Podatki — PIT ------------------------------- */

  private static pitRow(r: any): PodatekPit {
    return {
      id: r.id,
      nip: r.nip ?? '',
      rok: r.rok,
      dane: normalizeDanePit(r.dane),
      createdAt: r.created_at ?? '',
      createdBy: r.created_by ?? '',
      updatedAt: r.updated_at ?? '',
      updatedBy: r.updated_by ?? '',
    };
  }

  /** A second PIT of one community and year — the unique key says no. */
  private static pitError(op: string, error: { code?: string; message: string }): Error {
    return error.code === '23505'
      ? new Error('Ta wspólnota (ten NIP) ma już PIT na ten rok — otwórz go zamiast dodawać drugi.')
      : new Error(`${op}: ${error.message}`);
  }

  /** Every year's PIT rows — newest year first, then in the order they were added. */
  async getPodatkiPit(): Promise<PodatekPit[]> {
    const rows = await fetchAllPaged<any>('getPodatkiPit', (from, to) =>
      getSupabase()
        .from('podatki_pit')
        .select('*')
        .order('rok', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.pitRow);
  }

  async getPodatekPit(id: number): Promise<PodatekPit | null> {
    const { data, error } = await getSupabase().from('podatki_pit').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getPodatekPit: ${error.message}`);
    return data ? DatabaseService.pitRow(data) : null;
  }

  /** What a save from the screen must not overwrite: what was filed and downloaded, kept per person. */
  private static pitZachowaj(nowe: PitDane, zapisane: PitDane): PitDane {
    const stare = new Map(zapisane.osoby.map(o => [o.klucz, o]));
    const osoby = nowe.osoby.map((o): PitOsoba => {
      const poprzednia = stare.get(o.klucz);
      return poprzednia ? { ...o, zlozone: poprzednia.zlozone, pobrania: poprzednia.pobrania } : { ...o, zlozone: null, pobrania: [] };
    });
    const pit4r =
      nowe.pit4r && zapisane.pit4r
        ? { ...nowe.pit4r, zlozone: zapisane.pit4r.zlozone, pobrania: zapisane.pit4r.pobrania }
        : nowe.pit4r
          ? { ...nowe.pit4r, zlozone: null, pobrania: [] }
          : null;
    return { ...nowe, osoby, pit4r };
  }

  async addPodatekPit(nip: string, rok: number, value: PitDane, who: string): Promise<PodatekPit> {
    const now = new Date().toISOString();
    const { data, error } = await getSupabase()
      .from('podatki_pit')
      .insert({
        nip: tylkoCyfry(nip),
        rok,
        dane: DatabaseService.pitZachowaj(normalizeDanePit(value), normalizeDanePit(null)),
        created_at: now,
        created_by: who,
        updated_at: now,
        updated_by: who,
      })
      .select('*')
      .single();
    if (error) throw DatabaseService.pitError('addPodatekPit', error);
    return DatabaseService.pitRow(data);
  }

  /**
   * Save an edited community; the filed marks and the download records are kept
   * from the stored row — as it is when the write lands (see casUpdate) — and so
   * are the fields this version of the app does not know.
   */
  async setPodatekPit(id: number, nip: string, value: PitDane, who: string): Promise<PodatekPit> {
    const result = await this.casUpdate<{ dane: unknown; updated_at: string }>(
      'podatki_pit',
      id,
      'dane',
      'setPodatekPit',
      (row) => ({
        nip: tylkoCyfry(nip),
        dane: DatabaseService.pitKeepUnknown(
          row.dane,
          DatabaseService.pitZachowaj(normalizeDanePit(value), normalizeDanePit(row.dane)),
        ),
        updated_by: who,
      }),
      { returning: '*', mapError: (error) => DatabaseService.pitError('setPodatekPit', error) },
    );
    if (!result?.written) throw new Error('Tego PIT-u już nie ma — mógł zostać usunięty.');
    return DatabaseService.pitRow(result.written);
  }

  /** PIT data over the stored object: unknown keys kept at the top, on each person (by `klucz`) and on the PIT-4R. */
  private static pitKeepUnknown(raw: unknown, dane: PitDane): PitDane {
    const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return keepUnknownKeys(raw, {
      ...dane,
      osoby: keepUnknownItems(stored.osoby, dane.osoby, 'klucz'),
      pit4r: dane.pit4r ? keepUnknownKeys(stored.pit4r, dane.pit4r) : null,
    });
  }

  /** Store data the app itself worked out (Excel read back) — as given, nothing kept from the stored row. */
  async zapiszDanePit(id: number, dane: PitDane, who: string): Promise<PodatekPit> {
    const { data, error } = await getSupabase()
      .from('podatki_pit')
      .update({ dane: normalizeDanePit(dane), updated_at: new Date().toISOString(), updated_by: who })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw DatabaseService.pitError('zapiszDanePit', error);
    return DatabaseService.pitRow(data);
  }

  async deletePodatekPit(id: number): Promise<void> {
    const { error } = await getSupabase().from('podatki_pit').delete().eq('id', id);
    if (error) throw new Error(`deletePodatekPit: ${error.message}`);
  }

  /**
   * Note the files made of documents of one row: the entries go on the person's list (`klucz`) or on the
   * PIT-4R's (`klucz` null).
   */
  async recordPitPliki(
    id: number,
    wpisy: { klucz: string | null; entry: PodatekPobranie }[],
  ): Promise<void> {
    if (wpisy.length === 0) return;
    // Appended to the lists as they are when the write lands (see casUpdate).
    await this.casUpdate<{ dane: unknown; updated_at: string }>(
      'podatki_pit',
      id,
      'dane',
      'recordPitPliki',
      (row) => {
        const stored = normalizeDanePit(row.dane);
        const dane: PitDane = {
          ...stored,
          osoby: stored.osoby.map(o => {
            const moje = wpisy.filter(w => w.klucz === o.klucz).map(w => w.entry);
            return moje.length > 0 ? { ...o, pobrania: [...o.pobrania, ...moje] } : o;
          }),
          pit4r: stored.pit4r
            ? {
                ...stored.pit4r,
                pobrania: [...stored.pit4r.pobrania, ...wpisy.filter(w => w.klucz === null).map(w => w.entry)],
              }
            : null,
        };
        return { dane: DatabaseService.pitKeepUnknown(row.dane, dane) };
      },
      { stamp: 'note' },
    );
  }

  /**
   * Mark documents as filed with the tax office (`zlozone` set) or take the mark off (null). Documents are
   * (row, person key | null for the PIT-4R). Returns the rows as they now are.
   */
  async setPitZlozone(
    dokumenty: { wierszId: number; klucz: string | null }[],
    zlozone: PitZlozone | null,
  ): Promise<PodatekPit[]> {
    const ids = [...new Set(dokumenty.map(d => d.wierszId))];
    if (ids.length === 0) return [];
    // Read in one go; each row is then written under casUpdate, so a download
    // noted on it meanwhile is kept rather than overwritten.
    const rows = await this.readByIds('podatki_pit', ids, 'setPitZlozone');
    const out: PodatekPit[] = [];
    for (const slice of DatabaseService.chunk(rows, 10)) {
      const results = await Promise.all(
        slice.map(initial =>
          this.casUpdate<any>(
            'podatki_pit',
            initial.id,
            '*',
            'setPitZlozone',
            row => {
              const stored = normalizeDanePit(row.dane);
              const moje = dokumenty.filter(d => d.wierszId === row.id);
              const dane: PitDane = {
                ...stored,
                osoby: stored.osoby.map(o => (moje.some(d => d.klucz === o.klucz) ? { ...o, zlozone } : o)),
                pit4r:
                  stored.pit4r && moje.some(d => d.klucz === null) ? { ...stored.pit4r, zlozone } : stored.pit4r,
              };
              return { dane: DatabaseService.pitKeepUnknown(row.dane, dane) };
            },
            { stamp: 'note', initial, returning: '*' },
          ),
        ),
      );
      for (const result of results) {
        if (result) out.push(DatabaseService.pitRow(result.written ?? result.row));
      }
    }
    return out;
  }

  /**
   * Add communities a year does not have yet (import). A community (NIP) the year already holds is left
   * as it is — never overwritten. Returns how many were added and how many skipped.
   */
  async addPodatkiPitBrakujace(
    rekordy: { nip: string; rok: number; dane: PitDane }[],
    who: string,
  ): Promise<{ dodane: number; istniejace: number }> {
    const existing = new Set((await this.getPodatkiPit()).map(p => `${p.nip}|${p.rok}`));
    const now = new Date().toISOString();
    const nowe = rekordy.map(r => ({ ...r, nip: tylkoCyfry(r.nip) })).filter(r => !existing.has(`${r.nip}|${r.rok}`));
    await this.insertChunked(
      'podatki_pit',
      nowe.map(r => ({
        nip: r.nip,
        rok: r.rok,
        dane: normalizeDanePit(r.dane),
        created_at: now,
        created_by: who,
        updated_at: now,
        updated_by: who,
      })),
    );
    return { dodane: nowe.length, istniejace: rekordy.length - nowe.length };
  }

  /** Start year `naRok` from `zRoku`: every community of `zRoku` the new year lacks gets a draft with the same people. */
  async przeniesPitNaRok(zRoku: number, naRok: number, who: string): Promise<number> {
    const zrodlo = (await this.getPodatkiPit()).filter(p => p.rok === zRoku);
    const { dodane } = await this.addPodatkiPitBrakujace(
      zrodlo.map(p => ({ nip: p.nip, rok: naRok, dane: daneNaKolejnyRokPit(p.dane) })),
      who,
    );
    return dodane;
  }

  /* ------------------------------ Podatki — CIT-8 ------------------------------ */

  private static citRow(r: any): PodatekCit {
    return {
      id: r.id,
      adresNazwa: r.adres_nazwa ?? '',
      rok: r.rok,
      dane: normalizeDaneCit(r.dane),
      createdAt: r.created_at ?? '',
      createdBy: r.created_by ?? '',
      updatedAt: r.updated_at ?? '',
      updatedBy: r.updated_by ?? '',
    };
  }

  /** A second return of one community and year — the unique key says no. */
  private static citError(op: string, error: { code?: string; message: string }): Error {
    return error.code === '23505'
      ? new Error('Ta wspólnota ma już zeznanie CIT-8 na ten rok — otwórz je zamiast dodawać drugie.')
      : new Error(`${op}: ${error.message}`);
  }

  /** Every year's returns — newest year first, then in the order they were added. */
  async getPodatkiCit(): Promise<PodatekCit[]> {
    const rows = await fetchAllPaged<any>('getPodatkiCit', (from, to) =>
      getSupabase()
        .from('podatki_cit')
        .select('*')
        .order('rok', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.citRow);
  }

  async getPodatekCit(id: number): Promise<PodatekCit | null> {
    const { data, error } = await getSupabase().from('podatki_cit').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getPodatekCit: ${error.message}`);
    return data ? DatabaseService.citRow(data) : null;
  }

  async addPodatekCit(adresNazwa: string, rok: number, value: PodatekCitDane, who: string): Promise<PodatekCit> {
    const now = new Date().toISOString();
    const { data, error } = await getSupabase()
      .from('podatki_cit')
      .insert({
        adres_nazwa: adresNazwa,
        rok,
        dane: { ...normalizeDaneCit(value), pobrania: [], zlozone: null },
        created_at: now,
        created_by: who,
        updated_at: now,
        updated_by: who,
      })
      .select('*')
      .single();
    if (error) throw DatabaseService.citError('addPodatekCit', error);
    return DatabaseService.citRow(data);
  }

  /** Tries of a read-modify-write of a return before giving up on a row that keeps changing under it. */
  private static readonly CIT_PROBY = 5;

  /**
   * Every change of a return's `dane` goes through here — the form's save, a download, a send and its
   * answer, the UPO automat (which runs on every computer), the filed tick: read the row, apply `zmiana` to
   * what is stored NOW, and write only if nobody wrote in between (`updated_at` as read — every write here
   * moves it). Lost the race: read again and apply the change again. Writing back a whole JSON read
   * seconds earlier let one computer's save wipe another's send record — and with it the refId, the UPO and
   * the guard against a second filing. `zmiana` returns null when there is nothing to write; the result is
   * the row as written (or as found), null when the row is gone. `kto` also stamps `updated_by` — only the
   * form's save does, the rest is the app's own bookkeeping.
   */
  private async zmienDaneCit(
    id: number,
    op: string,
    zmiana: (stored: PodatekCit) => PodatekCitDane | null,
    kto?: string,
  ): Promise<PodatekCit | null> {
    for (let proba = 0; proba < DatabaseService.CIT_PROBY; proba += 1) {
      const stored = await this.getPodatekCit(id);
      if (!stored) return null;
      const dane = zmiana(stored);
      if (!dane) return stored;
      // A new stamp, never the one read — two writes under one stamp would both pass the check.
      let teraz = new Date().toISOString();
      const byl = Date.parse(stored.updatedAt);
      if (Number.isFinite(byl) && Date.parse(teraz) <= byl) teraz = new Date(byl + 1).toISOString();
      const { data, error } = await getSupabase()
        .from('podatki_cit')
        .update({ dane, updated_at: teraz, ...(kto !== undefined ? { updated_by: kto } : {}) })
        .eq('id', id)
        // The stamp exactly as Postgres gave it (microseconds and all), never re-serialized.
        .eq('updated_at', stored.updatedAt)
        .select('*');
      if (error) throw DatabaseService.citError(op, error);
      if (data && data.length > 0) return DatabaseService.citRow(data[0]);
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 150 * (proba + 1)));
    }
    throw new Error(`${op}: zeznanie zmieniało się w tym samym czasie na innym komputerze — spróbuj ponownie.`);
  }

  /** Save an edited return; the download record, the sends and the "filed" tick are kept from the stored row. */
  async setPodatekCit(id: number, value: PodatekCitDane, who: string): Promise<PodatekCit> {
    const dane = normalizeDaneCit(value);
    const po = await this.zmienDaneCit(
      id,
      'setPodatekCit',
      // What the main process records (files, sends, the filed tick) is never the form's to overwrite —
      // taken from the row as it is at the moment of writing, so a send made meanwhile stays.
      (stored) => ({ ...dane, pobrania: stored.dane.pobrania, wysylki: stored.dane.wysylki, zlozone: stored.dane.zlozone }),
      who,
    );
    if (!po) throw new Error('Tego zeznania już nie ma — mogło zostać usunięte.');
    return po;
  }

  async deletePodatekCit(id: number): Promise<void> {
    const { error } = await getSupabase().from('podatki_cit').delete().eq('id', id);
    if (error) throw new Error(`deletePodatekCit: ${error.message}`);
  }

  /** Note a downloaded PDF of a return. */
  async recordPodatekCitPobranie(id: number, plik: string, who: string, podpis?: PodpisSlad): Promise<void> {
    const entry: PodatekPobranie = { at: new Date().toISOString(), by: who, plik, ...(podpis ? { podpis } : {}) };
    await this.zmienDaneCit(id, 'recordPodatekCitPobranie', (stored) => ({
      ...stored.dane,
      pobrania: [...stored.dane.pobrania, entry],
    }));
  }

  /**
   * Record a send BEFORE it goes to the gateway, if `blokada` — asked about the row as it is at the moment
   * of writing — lets it: the record is both the lock against a second computer sending the same return
   * (it finds this one, `niepewna`, and holds back) and the trace of a send the app may not live to see
   * answered. Null `rek` = the return is gone; a `powod` = held back, nothing written.
   */
  async rezerwujPodatekCitWysylke(
    id: number,
    wysylka: EDeklaracjeWysylka,
    blokada: (stored: PodatekCit) => string | null,
  ): Promise<{ rek: PodatekCit | null; powod: string | null }> {
    const stan: { powod: string | null } = { powod: null };
    const rek = await this.zmienDaneCit(id, 'rezerwujPodatekCitWysylke', (stored) => {
      stan.powod = blokada(stored);
      return stan.powod ? null : { ...stored.dane, wysylki: [...stored.dane.wysylki, wysylka] };
    });
    return { rek, powod: stan.powod };
  }

  /** The gateway's answer to a send recorded by `rezerwujPodatekCitWysylke` (found by its `at`). */
  async zakonczPodatekCitWysylke(
    id: number,
    at: string,
    wynik: Pick<EDeklaracjeWysylka, 'refId' | 'status' | 'opis' | 'niepewna'>,
  ): Promise<PodatekCit | null> {
    return this.zmienDaneCit(id, 'zakonczPodatekCitWysylke', (stored) => {
      if (!stored.dane.wysylki.some((w) => w.at === at)) return null;
      const wysylki = stored.dane.wysylki.map((w) => {
        if (w.at !== at) return w;
        const po: EDeklaracjeWysylka = { ...w, refId: wynik.refId, status: wynik.status, opis: wynik.opis };
        // An answer settles what a person may have guessed meanwhile; still none keeps the send uncertain.
        if (wynik.niepewna) return po;
        delete po.niepewna;
        delete po.rozstrzygnieta;
        return po;
      });
      return { ...stored.dane, wysylki };
    });
  }

  /**
   * The gateway's later answer about a send (found by its refId): status, and the UPO once there is one. A
   * production UPO also ticks the return as filed — the office has it, by the gateway's own receipt; a 200
   * that came without the UPO itself ticks nothing.
   */
  async updatePodatekCitWysylka(
    id: number,
    refId: string,
    zmiana: Pick<EDeklaracjeWysylka, 'status' | 'opis' | 'sprawdzono' | 'upo'>,
    who: string,
  ): Promise<PodatekCit | null> {
    return this.zmienDaneCit(id, 'updatePodatekCitWysylka', (stored) => {
      const wyslana = stored.dane.wysylki.find((w) => w.refId === refId);
      if (!wyslana) return null;
      const wysylki = stored.dane.wysylki.map((w) => (w.refId === refId ? { ...w, ...zmiana } : w));
      const zlozone =
        wyslana.srodowisko === 'prod' && zmiana.status === 200 && zmiana.upo?.tresc && !stored.dane.zlozone
          ? { at: new Date().toISOString(), by: who }
          : stored.dane.zlozone;
      return { ...stored.dane, wysylki, zlozone };
    });
  }

  /**
   * A person settles a send (found by its `at`): an uncertain one did not reach the gateway (`nie_dotarla`
   * — it stops blocking) or did (`dotarla` — on production that ticks the return as filed, like a UPO); a
   * send stuck in progress is no longer waited for (`porzucona`). Anything else is refused: the send was
   * answered meanwhile, or settled by someone else.
   */
  async rozstrzygnijPodatekCitWysylke(
    id: number,
    at: string,
    jak: WysylkaRozstrzygniecie['jak'],
    who: string,
  ): Promise<PodatekCit> {
    const stan: { odmowa: string | null } = { odmowa: null };
    const po = await this.zmienDaneCit(id, 'rozstrzygnijPodatekCitWysylke', (stored) => {
      stan.odmowa = null;
      const w = stored.dane.wysylki.find((x) => x.at === at);
      if (!w) {
        stan.odmowa = 'Tej wysyłki już nie ma na liście — odśwież zeznanie.';
        return null;
      }
      if (!(jak === 'porzucona' ? czekaNaUpo(w) : niepewnaOtwarta(w))) {
        stan.odmowa = 'Ta wysyłka ma już odpowiedź bramki albo została rozstrzygnięta — odśwież zeznanie.';
        return null;
      }
      const stamp = { at: new Date().toISOString(), by: who };
      const wysylki = stored.dane.wysylki.map((x) => (x.at === at ? { ...x, rozstrzygnieta: { ...stamp, jak } } : x));
      const zlozone = jak === 'dotarla' && w.srodowisko === 'prod' ? stored.dane.zlozone ?? stamp : stored.dane.zlozone;
      return { ...stored.dane, wysylki, zlozone };
    });
    if (!po) throw new Error('Tego zeznania już nie ma — mogło zostać usunięte.');
    if (stan.odmowa) throw new Error(stan.odmowa);
    return po;
  }

  /**
   * Tick returns as filed with the tax office, or take the tick off. A row
   * already ticked keeps who ticked it and when. Returns the rows as they now are.
   */
  async setPodatkiCitZlozone(ids: number[], filed: boolean, who: string): Promise<PodatekCit[]> {
    if (ids.length === 0) return [];
    const stamp = { at: new Date().toISOString(), by: who };
    const out: PodatekCit[] = [];
    for (const slice of DatabaseService.chunk(ids, 10)) {
      const rows = await Promise.all(
        slice.map((id) =>
          this.zmienDaneCit(id, 'setPodatkiCitZlozone', (rek) =>
            !!rek.dane.zlozone === filed ? null : { ...rek.dane, zlozone: filed ? stamp : null },
          ),
        ),
      );
      for (const row of rows) if (row) out.push(row);
    }
    return out;
  }

  /**
   * Start year `naRok` from `zRoku`: every community of `zRoku` the new year
   * does not have yet gets a draft of its return — identification and signer
   * carried over, statement and decisions left to the new year.
   */
  async przeniesCitNaRok(zRoku: number, naRok: number, who: string): Promise<number> {
    const all = await this.getPodatkiCit();
    const have = new Set(all.filter((p) => p.rok === naRok).map((p) => p.adresNazwa));
    const now = new Date().toISOString();
    const nowe = all
      .filter((p) => p.rok === zRoku && !have.has(p.adresNazwa))
      .map((p) => ({
        adres_nazwa: p.adresNazwa,
        rok: naRok,
        dane: daneCitNaKolejnyRok(p.dane),
        created_at: now,
        created_by: who,
        updated_at: now,
        updated_by: who,
      }));
    await this.insertChunked('podatki_cit', nowe);
    return nowe.length;
  }

  /** The stored dictionary row, or null while the defaults are in use — for the backup. */
  private async getPodatkiCitUstawieniaRow(): Promise<PodatkiCitUstawienia | null> {
    const { data, error } = await getSupabase()
      .from('podatki_cit_ustawienia')
      .select('dane')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw new Error(`getPodatkiCitUstawieniaRow: ${error.message}`);
    return data ? normalizeCitUstawienia((data as { dane?: unknown }).dane) : null;
  }

  /** The CIT dictionary; the built-in one until someone saves changes. */
  async getPodatkiCitUstawienia(): Promise<PodatkiCitUstawienia> {
    return (await this.getPodatkiCitUstawieniaRow()) ?? normalizeCitUstawienia(null);
  }

  async setPodatkiCitUstawienia(value: PodatkiCitUstawienia, who: string): Promise<PodatkiCitUstawienia> {
    const dane = normalizeCitUstawienia(value);
    const poprzedni = (await this.getPodatkiCitUstawieniaRow())?.slownik ?? [];
    dane.slownik = oznaczAutorowRegul(dane.slownik, poprzedni, who, new Date().toISOString());
    const { error } = await getSupabase()
      .from('podatki_cit_ustawienia')
      .upsert({ id: 1, dane, updated_at: new Date().toISOString(), updated_by: who });
    if (error) throw new Error(`setPodatkiCitUstawienia: ${error.message}`);
    return dane;
  }

  /** Every library row with its statement — for the backup and the CIT dictionary review. */
  async getSprawozdaniaFull(): Promise<SprawozdanieZapisane[]> {
    const rows = await fetchAllPaged<any>('getSprawozdaniaFull', (from, to) =>
      getSupabase()
        .from('zebrania_sprawozdania')
        .select(`${SPRAWOZDANIE_LISTA_COLS}, dane`)
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(DatabaseService.sprawozdanieZapisaneRow);
  }

  private static zebraniaWspolnotaRow(r: any): ZebraniaWspolnota {
    const u = r.udzialy && typeof r.udzialy === 'object' ? r.udzialy : null;
    return {
      adresNazwa: r.adres_nazwa ?? '',
      vdomNr: r.vdom_nr ?? null,
      udzialy: u ? { miastoM2: Number(u.miastoM2) || 0, pozytkiM2: Number(u.pozytkiM2) || 0 } : null,
      updatedAt: r.updated_at ?? '',
      updatedBy: r.updated_by ?? '',
    };
  }

  async getZebraniaWspolnoty(): Promise<ZebraniaWspolnota[]> {
    const rows = await fetchAllPaged<any>('getZebraniaWspolnoty', (from, to) =>
      getSupabase().from('zebrania_wspolnoty').select('*').order('adres_nazwa').range(from, to),
    );
    return rows.map(DatabaseService.zebraniaWspolnotaRow);
  }

  /**
   * Remember a community's vDom number and/or ownership split. Only the fields
   * passed are written, so saving the split never forgets the number.
   */
  async setZebraniaWspolnota(
    adresNazwa: string,
    patch: { vdomNr?: number | null; udzialy?: ZebraniaWspolnota['udzialy'] },
    who: string,
  ): Promise<void> {
    const nazwa = adresNazwa.trim();
    if (!nazwa) throw new Error('Zebranie nie ma wybranej wspólnoty.');
    const row: Record<string, unknown> = { adres_nazwa: nazwa, updated_at: new Date().toISOString(), updated_by: who };
    if (patch.vdomNr !== undefined) row.vdom_nr = patch.vdomNr;
    if (patch.udzialy !== undefined) {
      row.udzialy = patch.udzialy
        ? { miastoM2: Number(patch.udzialy.miastoM2) || 0, pozytkiM2: Number(patch.udzialy.pozytkiM2) || 0 }
        : null;
    }
    const { error } = await getSupabase().from('zebrania_wspolnoty').upsert(row, { onConflict: 'adres_nazwa' });
    if (error) throw new Error(`setZebraniaWspolnota: ${error.message}`);
  }

  /** The stored settings row, or null while the defaults are in use — for the backup. */
  private async getZebraniaUstawieniaRow(): Promise<ZebraniaUstawienia | null> {
    const { data, error } = await getSupabase()
      .from('zebrania_ustawienia')
      .select('dane')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw new Error(`getZebraniaUstawieniaRow: ${error.message}`);
    return data ? normalizeUstawienia((data as { dane?: unknown }).dane) : null;
  }

  /** The module's settings; the built-in defaults until someone saves them. */
  async getZebraniaUstawienia(): Promise<ZebraniaUstawienia> {
    const { data, error } = await getSupabase()
      .from('zebrania_ustawienia')
      .select('dane')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw new Error(`getZebraniaUstawienia: ${error.message}`);
    return normalizeUstawienia((data as { dane?: unknown } | null)?.dane ?? null);
  }

  async setZebraniaUstawienia(value: ZebraniaUstawienia, who: string): Promise<void> {
    const { error } = await getSupabase()
      .from('zebrania_ustawienia')
      .upsert({ id: 1, dane: normalizeUstawienia(value), updated_at: new Date().toISOString(), updated_by: who });
    if (error) throw new Error(`setZebraniaUstawienia: ${error.message}`);
  }

  // ------------------ Księgowania: priorities and notes ------------------

  /** Every priority — or only those of `fromMonthKey` (`YYYY-MM`) and later (the notifier's window). */
  async getKsiegowaniaPriorytety(fromMonthKey?: string): Promise<KsiegowaniePriorytet[]> {
    const rows = await fetchAllPaged<any>('getKsiegowaniaPriorytety', (from, to) => {
      let query = getSupabase().from('ksiegowania_priorytety').select(KS_PRIORYTET_COLS);
      if (fromMonthKey) query = query.gte('month_key', fromMonthKey);
      return query
        .order('month_key', { ascending: false })
        .order('position', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to);
    });
    return rows.map(r => ({
      ...r,
      adresId: r.adresId ?? null,
      notatka: r.notatka ?? '',
      notatkaBy: r.notatkaBy ?? '',
      mentions: DatabaseService.komentarzMentions(r.mentions),
      createdBy: r.createdBy ?? '',
    })) as KsiegowaniePriorytet[];
  }

  async getKsiegowaniaPrzypisania(): Promise<KsiegowaniePrzypisanie[]> {
    const rows = await fetchAllPaged<any>('getKsiegowaniaPrzypisania', (from, to) =>
      getSupabase()
        .from('ksiegowania_przypisania')
        .select(KS_PRZYPISANIE_COLS)
        .order('month_key', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map(r => ({
      ...r,
      adresId: r.adresId ?? null,
      assignedBy: r.assignedBy ?? '',
    })) as KsiegowaniePrzypisanie[];
  }

  /**
   * Who posts this community in this month. One row per (month, community):
   * a new person replaces the old one, and `email: null` removes the row —
   * the community is unassigned again.
   */
  async setKsiegowaniePrzypisanie(
    monthKey: string,
    adresId: number | null,
    adresNazwa: string,
    email: string | null,
    assignedBy: string,
  ): Promise<KsiegowaniePrzypisanie | null> {
    const nazwa = adresNazwa.trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error('Nieprawidłowy miesiąc.');
    if (!nazwa) throw new Error('Przypisanie musi dotyczyć wspólnoty.');
    const mailbox = email?.trim() ?? '';
    if (!mailbox) {
      const { error } = await getSupabase()
        .from('ksiegowania_przypisania')
        .delete()
        .eq('month_key', monthKey)
        .eq('adres_nazwa', nazwa);
      if (error) throw new Error(`setKsiegowaniePrzypisanie: ${error.message}`);
      return null;
    }
    const { data, error } = await getSupabase()
      .from('ksiegowania_przypisania')
      .upsert(
        {
          month_key: monthKey,
          adres_id: adresId,
          adres_nazwa: nazwa,
          email: mailbox,
          assigned_by: assignedBy,
          assigned_at: new Date().toISOString(),
        },
        { onConflict: 'month_key,adres_nazwa' },
      )
      .select(KS_PRZYPISANIE_COLS)
      .single();
    return unwrap(data, error, 'setKsiegowaniePrzypisanie') as unknown as KsiegowaniePrzypisanie;
  }

  /**
   * Flag a community for a month. It joins the END of that month's queue — the
   * first one flagged is first, the next is second — which is the whole rule the
   * team asked for; moving it is the reorder dialog's job.
   *
   * Flagging twice is a no-op that returns the existing row: the table is unique
   * per (month, community), and two people clicking the flag at once should not
   * turn into an error for the second of them.
   */
  async addKsiegowaniePriorytet(
    monthKey: string,
    adresId: number | null,
    adresNazwa: string,
    notatka: string,
    createdBy: string,
  ): Promise<KsiegowaniePriorytet> {
    const nazwa = adresNazwa.trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error('Nieprawidłowy miesiąc.');
    if (!nazwa) throw new Error('Priorytet musi dotyczyć wspólnoty.');

    const { data: existing, error: readError } = await getSupabase()
      .from('ksiegowania_priorytety')
      .select(KS_PRIORYTET_COLS)
      .eq('month_key', monthKey)
      .eq('adres_nazwa', nazwa)
      .maybeSingle();
    if (readError) throw new Error(`addKsiegowaniePriorytet (odczyt): ${readError.message}`);
    if (existing) return existing as unknown as KsiegowaniePriorytet;

    const { data: last, error: lastError } = await getSupabase()
      .from('ksiegowania_priorytety')
      .select('position')
      .eq('month_key', monthKey)
      .order('position', { ascending: false })
      .limit(1);
    if (lastError) throw new Error(`addKsiegowaniePriorytet (pozycja): ${lastError.message}`);
    const position = ((last?.[0] as { position: number } | undefined)?.position ?? 0) + 1;

    const { data, error } = await getSupabase()
      .from('ksiegowania_priorytety')
      .insert({
        month_key: monthKey,
        adres_id: adresId,
        adres_nazwa: nazwa,
        position,
        notatka: notatka.trim(),
        // The note is written by whoever flags it, so the notifier has an author
        // for it from the first moment.
        notatka_by: createdBy,
        created_by: createdBy,
      })
      .select(KS_PRIORYTET_COLS)
      .single();
    if (error && (error as { code?: string }).code === '23505') {
      // Somebody flagged it between the read above and this insert: theirs stands.
      const { data: raced, error: racedError } = await getSupabase()
        .from('ksiegowania_priorytety')
        .select(KS_PRIORYTET_COLS)
        .eq('month_key', monthKey)
        .eq('adres_nazwa', nazwa)
        .maybeSingle();
      if (racedError) throw new Error(`addKsiegowaniePriorytet (odczyt): ${racedError.message}`);
      if (raced) return raced as unknown as KsiegowaniePriorytet;
    }
    return unwrap(data, error, 'addKsiegowaniePriorytet') as unknown as KsiegowaniePriorytet;
  }

  /**
   * `by` is the mailbox of whoever wrote the note: the notifier skips a note its
   * own author wrote. `updated_at` is not enough for that — a reorder bumps it too.
   */
  async setKsiegowaniePriorytetNotatka(
    id: number,
    notatka: string,
    mentions: string[],
    by: string,
  ): Promise<void> {
    const text = notatka.trim();
    const { error } = await getSupabase()
      .from('ksiegowania_priorytety')
      .update({
        notatka: text,
        // An emptied note tags nobody.
        mentions: text ? DatabaseService.komentarzMentions(mentions) : [],
        notatka_by: by,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(`setKsiegowaniePriorytetNotatka: ${error.message}`);
  }

  async removeKsiegowaniePriorytet(id: number): Promise<void> {
    const { error } = await getSupabase().from('ksiegowania_priorytety').delete().eq('id', id);
    if (error) throw new Error(`removeKsiegowaniePriorytet: ${error.message}`);
  }

  /**
   * Rewrite a month's queue to the given order: the first id becomes position 1,
   * and so on. Ids that do not belong to the month are ignored by the filter, so
   * a stale dialog cannot move another month's rows; a priority added by someone
   * else while the dialog was open is not in the list and keeps its own place,
   * which sorts it after the ones just numbered.
   */
  async reorderKsiegowaniaPriorytety(monthKey: string, orderedIds: number[]): Promise<void> {
    // A few writes at a time instead of one round trip after another. Not an
    // upsert: the ids are generated always, and a position is all that changes.
    const now = new Date().toISOString();
    const places = orderedIds.map((id, i) => ({ id, position: i + 1 }));
    for (const slice of DatabaseService.chunk(places, 10)) {
      const results = await Promise.all(
        slice.map(({ id, position }) =>
          getSupabase()
            .from('ksiegowania_priorytety')
            .update({ position, updated_at: now })
            .eq('id', id)
            .eq('month_key', monthKey),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(`reorderKsiegowaniaPriorytety: ${failed.error.message}`);
    }
  }

  async getKsiegowaniaUwagi(): Promise<KsiegowanieUwaga[]> {
    return this.readKsiegowaniaUwagi('getKsiegowaniaUwagi', (q) => q);
  }

  /** Notes newer than `afterId`, oldest first — the notifier's cursor (ids only grow). */
  async getKsiegowaniaUwagiAfter(afterId: number): Promise<KsiegowanieUwaga[]> {
    return this.readKsiegowaniaUwagi('getKsiegowaniaUwagiAfter', (q) => q.gt('id', afterId), true);
  }

  /** Notes that tag this mailbox — mentions are stored lower-cased, so the match is exact. */
  async getKsiegowaniaUwagiTagging(email: string): Promise<KsiegowanieUwaga[]> {
    const mailbox = email.trim().toLowerCase();
    if (!mailbox) return [];
    return this.readKsiegowaniaUwagi('getKsiegowaniaUwagiTagging', (q) => q.contains('mentions', [mailbox]));
  }

  /** Id of the newest note, or 0 — where the notifier's first poll starts from. */
  async getLatestKsiegowanieUwagaId(): Promise<number> {
    const { data, error } = await getSupabase()
      .from('ksiegowania_uwagi')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    if (error) throw new Error(`getLatestKsiegowanieUwagaId: ${error.message}`);
    return (data?.[0] as { id: number } | undefined)?.id ?? 0;
  }

  private async readKsiegowaniaUwagi(
    context: string,
    filter: (query: any) => any,
    oldestFirst = false,
  ): Promise<KsiegowanieUwaga[]> {
    const rows = await fetchAllPaged<any>(context, (from, to) => {
      const query = filter(getSupabase().from('ksiegowania_uwagi').select(KS_UWAGA_COLS));
      return (oldestFirst
        ? query.order('id', { ascending: true })
        : query.order('created_at', { ascending: false }).order('id', { ascending: false })
      ).range(from, to);
    });
    return rows.map(r => ({
      ...r,
      adresId: r.adresId ?? null,
      mentions: DatabaseService.komentarzMentions(r.mentions),
      createdBy: r.createdBy ?? '',
      resolvedAt: r.resolvedAt ?? null,
      resolvedBy: r.resolvedBy ?? null,
    })) as KsiegowanieUwaga[];
  }

  async addKsiegowanieUwaga(
    adresId: number | null,
    adresNazwa: string,
    tresc: string,
    mentions: string[],
    createdBy: string,
  ): Promise<KsiegowanieUwaga> {
    const nazwa = adresNazwa.trim();
    const text = tresc.trim();
    if (!nazwa) throw new Error('Uwaga musi dotyczyć wspólnoty.');
    if (!text) throw new Error('Uwaga nie może być pusta.');
    const { data, error } = await getSupabase()
      .from('ksiegowania_uwagi')
      .insert({
        adres_id: adresId,
        adres_nazwa: nazwa,
        tresc: text,
        mentions: DatabaseService.komentarzMentions(mentions),
        created_by: createdBy,
      })
      .select(KS_UWAGA_COLS)
      .single();
    const row = unwrap(data, error, 'addKsiegowanieUwaga') as any;
    return { ...row, mentions: DatabaseService.komentarzMentions(row.mentions) } as KsiegowanieUwaga;
  }

  async updateKsiegowanieUwaga(id: number, tresc: string, mentions: string[]): Promise<void> {
    const text = tresc.trim();
    if (!text) throw new Error('Uwaga nie może być pusta.');
    const { error } = await getSupabase()
      .from('ksiegowania_uwagi')
      .update({ tresc: text, mentions: DatabaseService.komentarzMentions(mentions) })
      .eq('id', id);
    if (error) throw new Error(`updateKsiegowanieUwaga: ${error.message}`);
  }

  /** "Sprawa rozwiązana" — or back to open, which clears who resolved it. */
  async setKsiegowanieUwagaResolved(id: number, resolved: boolean, by: string): Promise<void> {
    const { error } = await getSupabase()
      .from('ksiegowania_uwagi')
      .update(
        resolved
          ? { resolved_at: new Date().toISOString(), resolved_by: by }
          : { resolved_at: null, resolved_by: null },
      )
      .eq('id', id);
    if (error) throw new Error(`setKsiegowanieUwagaResolved: ${error.message}`);
  }

  async deleteKsiegowanieUwaga(id: number): Promise<void> {
    const { error } = await getSupabase().from('ksiegowania_uwagi').delete().eq('id', id);
    if (error) throw new Error(`deleteKsiegowanieUwaga: ${error.message}`);
  }

  // ------------- Księgowania: files pinned by the folder scan -------------

  private static ksPlik(r: any): KsiegowaniePlik {
    return {
      ...r,
      errorMessage: r.errorMessage ?? null,
      adresId: r.adresId ?? null,
      accountNumber: r.accountNumber ?? null,
      accountTypeName: r.accountTypeName ?? null,
      bankId: r.bankId ?? null,
      bankName: r.bankName ?? null,
      converterId: r.converterId ?? null,
      originalName: r.originalName ?? null,
      fileSize: Number(r.fileSize ?? 0),
      periodFrom: r.periodFrom ?? null,
      periodTo: r.periodTo ?? null,
      ignoredHashes: Array.isArray(r.ignoredHashes) ? r.ignoredHashes : [],
      scannedBy: r.scannedBy ?? null,
    } as KsiegowaniePlik;
  }

  /** Every pinned file, or one month's (`YYYY-MM`) when given. */
  async getKsiegowaniaPliki(monthKey?: string): Promise<KsiegowaniePlik[]> {
    const rows = await fetchAllPaged<any>('getKsiegowaniaPliki', (from, to) => {
      let query = getSupabase().from('ksiegowania_pliki').select(KS_PLIK_COLS);
      if (monthKey) query = query.eq('month_key', monthKey);
      return query.order('month_key', { ascending: false }).order('id', { ascending: true }).range(from, to);
    });
    return rows.map(DatabaseService.ksPlik);
  }

  private static ksPlikRow(p: Omit<KsiegowaniePlik, 'id' | 'scannedAt'>): Record<string, unknown> {
    return {
      month_key: p.monthKey,
      kind: p.kind,
      status: p.status,
      error_message: p.errorMessage,
      adres_id: p.adresId,
      adres_nazwa: p.adresNazwa,
      account_number: p.accountNumber,
      account_type_name: p.accountTypeName,
      bank_id: p.bankId,
      bank_name: p.bankName,
      converter_id: p.converterId,
      rel_path: p.relPath,
      file_name: p.fileName,
      original_name: p.originalName,
      file_size: p.fileSize,
      file_mtime: p.fileMtime,
      file_hash: p.fileHash,
      ignored_hashes: p.ignoredHashes,
      period_from: p.periodFrom,
      period_to: p.periodTo,
      scanned_by: p.scannedBy,
    };
  }

  async addKsiegowaniePlik(p: Omit<KsiegowaniePlik, 'id' | 'scannedAt'>): Promise<KsiegowaniePlik> {
    const { data, error } = await getSupabase()
      .from('ksiegowania_pliki')
      .insert(DatabaseService.ksPlikRow(p))
      .select(KS_PLIK_COLS)
      .single();
    return DatabaseService.ksPlik(unwrap(data, error, 'addKsiegowaniePlik'));
  }

  /** Point a pinned row at another file (a newer version, a moved file) — the whole record is rewritten. */
  async replaceKsiegowaniePlik(id: number, p: Omit<KsiegowaniePlik, 'id' | 'scannedAt'>): Promise<KsiegowaniePlik> {
    const { data, error } = await getSupabase()
      .from('ksiegowania_pliki')
      .update({ ...DatabaseService.ksPlikRow(p), scanned_at: new Date().toISOString() })
      .eq('id', id)
      .select(KS_PLIK_COLS)
      .single();
    return DatabaseService.ksPlik(unwrap(data, error, 'replaceKsiegowaniePlik'));
  }

  /** Remember newer files the user chose not to swap in, so the scan stops offering them. */
  async setKsiegowaniePlikIgnored(id: number, hashes: string[]): Promise<void> {
    const { error } = await getSupabase()
      .from('ksiegowania_pliki')
      .update({ ignored_hashes: hashes })
      .eq('id', id);
    if (error) throw new Error(`setKsiegowaniePlikIgnored: ${error.message}`);
  }

  /** "Odepnij" — the record goes, the file stays where it is. */
  async deleteKsiegowaniePlik(id: number): Promise<void> {
    const { error } = await getSupabase().from('ksiegowania_pliki').delete().eq('id', id);
    if (error) throw new Error(`deleteKsiegowaniePlik: ${error.message}`);
  }

  // ------------------------ Notification switches ------------------------
  // One row per person (mailbox), in the cloud: the choice belongs to the
  // account, so it is the same on every machine the person signs in on.

  /** Only known notifications with a true/false — whatever else was sent is dropped. */
  private static notificationPrefsClean(value: unknown): NotificationPrefs {
    const out: NotificationPrefs = {};
    if (value && typeof value === 'object') {
      for (const def of NOTIFICATION_DEFS) {
        const v = (value as Record<string, unknown>)[def.id];
        if (typeof v === 'boolean') out[def.id] = v;
      }
    }
    return out;
  }

  /** What this person has flipped; nobody who never opened the list has a row. */
  async getNotificationPrefs(email: string): Promise<NotificationPrefs> {
    const { data, error } = await getSupabase()
      .from('notification_prefs')
      .select('prefs')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();
    if (error) throw new Error(`getNotificationPrefs: ${error.message}`);
    return DatabaseService.notificationPrefsClean(data?.prefs);
  }

  async getAllNotificationPrefs(): Promise<NotificationPrefsRow[]> {
    const { data, error } = await getSupabase()
      .from('notification_prefs')
      .select('email, prefs')
      .order('email', { ascending: true });
    if (error) throw new Error(`getAllNotificationPrefs: ${error.message}`);
    return (data ?? []).map(r => ({
      email: r.email as string,
      prefs: DatabaseService.notificationPrefsClean(r.prefs),
    }));
  }

  /** Flip one switch, keeping the person's others. */
  async setNotificationPref(email: string, id: NotificationId, enabled: boolean): Promise<void> {
    const key = email.trim().toLowerCase();
    if (!key) throw new Error('Brak zalogowanego użytkownika.');
    const prefs = { ...(await this.getNotificationPrefs(key)), [id]: enabled };
    const { error } = await getSupabase()
      .from('notification_prefs')
      .upsert({ email: key, prefs, updated_at: new Date().toISOString() });
    if (error) throw new Error(`setNotificationPref: ${error.message}`);
  }

  // ---------------------------- App config ----------------------------
  // Shared secrets/config living in Supabase (`app_config`, authenticated
  // read-only). Keeps API keys out of the publicly downloadable binaries.

  async getAppConfigValue(key: string): Promise<string | null> {
    const { data, error } = await getSupabase()
      .from('app_config')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(`getAppConfigValue(${key}): ${error.message}`);
    return (data as { value: string } | null)?.value ?? null;
  }

  // ----------------------------- Settings -----------------------------
  // Stay local to the machine — these are UI prefs, not shared data.

  getSetting(key: string): string | undefined {
    const settings = this.settingsStore.get('settings');
    return (settings as any)[key];
  }

  getSettings(): AppSettings {
    return this.settingsStore.get('settings');
  }

  /**
   * The Claude model to call, read at the call so a change in Settings applies
   * to the next request. Installs that predate the setting, or a value no build
   * serves any more, get the default.
   */
  getAiModel(): string {
    return resolveAiModel(this.getSetting('aiModel'));
  }

  /** The gateway to send to — an install that predates the setting, or any odd value, is on test. */
  getEDeklaracjeSrodowisko(): EDeklaracjeSrodowisko {
    return normalizeSrodowisko(this.getSetting('eDeklaracjeSrodowisko'));
  }

  setSetting(key: string, value: string): void {
    const settings = this.settingsStore.get('settings');
    this.settingsStore.set('settings', { ...settings, [key]: value });
  }

  /**
   * Settings as they may leave this machine: the `PORTABLE_SETTINGS` only (see
   * there for what stays and why). Backups are pushed to a remote repository and
   * restored on other computers — paths, the SMTP account and the e-Deklaracje
   * gateway have no business travelling with them.
   */
  private settingsForExport(): PortableSettings {
    const all = this.getSettings() as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of PORTABLE_SETTINGS) {
      if (all[key] !== undefined) out[key] = all[key];
    }
    return out as PortableSettings;
  }

  exportSettings(): { settings: PortableSettings } {
    return { settings: this.settingsForExport() };
  }

  /**
   * Take the portable settings from a settings file or a backup. Anything else
   * the file carries is ignored — older files hold every setting, the
   * machine-local ones too. Values are copied as stored (the order lists are
   * JSON strings); only plain values are accepted, never objects.
   */
  /** Take the portable settings a file carries; answers how many it took (0 = nothing usable in it). */
  importSettings(data: { settings?: unknown }): number {
    const incoming = data.settings;
    if (!incoming || typeof incoming !== 'object') return 0;
    const picked: Record<string, unknown> = {};
    for (const key of PORTABLE_SETTINGS) {
      const value = (incoming as Record<string, unknown>)[key];
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) picked[key] = value;
    }
    if (Object.keys(picked).length === 0) return 0;
    this.settingsStore.set('settings', {
      ...this.settingsStore.get('settings'),
      ...picked,
    });
    return Object.keys(picked).length;
  }

  // ------------------------------ Backup ------------------------------
  // Full snapshot of the shared Supabase data + this machine's settings.
  // Restore replaces the cloud data wholesale; because every install shares
  // one Supabase project, restoring affects all users — the UI double-confirms.
  //
  // EVERY new persisted table belongs in both methods below, in the same change
  // that creates it: a table missing here is silently dropped by the next
  // restore, on all installs at once. The full checklist is on `BackupData` in
  // shared/types.ts.

  async exportFullBackup(appVersion: string): Promise<BackupData> {
    // A copy of the tables as they are, not as this computer last read them.
    this.invalidateAllCaches();
    // Tables added by a migration that may not have run yet: a missing one is
    // left out of the backup (its key absent = "leave live rows alone" on
    // restore) and named in `meta.skippedSections`, so the summary says so.
    // Anything else — a dropped connection, an expired session, a timeout —
    // fails the whole backup: a copy with a silent hole in it is worse than no
    // copy, and the same method takes the safety copy before a restore.
    const skippedSections: BackupSectionKey[] = [];
    const optionalSection = async <T>(key: BackupSectionKey, read: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await read();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isMissingRelationOrColumn(message)) throw error;
        log.warn(`[BACKUP] section ${key} left out — its table is missing (run its migration): ${message}`);
        skippedSections.push(key);
        return undefined;
      }
    };
    const [
      banks,
      kontrahenci,
      adresy,
      kontoTypy,
      history,
      odczytyHistory,
      zgnJednostki,
      zgnPelnomocnicy,
      mailingPola,
      mailingSzablony,
      mailingHistory,
      spotkaniaTypy,
      spotkania,
      spotkaniaLokalizacje,
      zadania,
      zadaniaKomentarze,
      zadaniaNotatki,
      appUsers,
      ksiegowaniaPriorytety,
      ksiegowaniaUwagi,
      ksiegowaniaPliki,
      ksiegowaniaKonwersje,
      notificationPrefs,
      mailingTypy,
      zebrania,
      ksiegowaniaPrzypisania,
      zebraniaSprawozdania,
      zebraniaWspolnoty,
      zebraniaUstawienia,
      planyGospodarcze,
      podatkiNieruchomosci,
      podatkiStawki,
      podatkiCit,
      podatkiPit,
      podatkiCitUstawienia,
      podpisHistoria,
    ] = await Promise.all([
      this.getAllBanks(),
      this.getAllKontrahenci(),
      this.getAllAdresy(),
      this.getKontoTypy(),
      this.getAllHistory(),
      this.getOdczytyHistory(),
      this.getZgnJednostki(),
      this.getZgnPelnomocnicy(),
      this.getMailingPola(),
      this.getMailingSzablony(),
      this.getMailingHistory(),
      this.getSpotkaniaTypy(),
      this.getSpotkania(),
      this.getSpotkaniaLokalizacje(),
      this.getZadania(),
      this.getZadaniaKomentarze(),
      this.getZadaniaNotatki(),
      this.getAppUsers(),
      this.getKsiegowaniaPriorytety(),
      this.getKsiegowaniaUwagi(),
      optionalSection('ksiegowaniaPliki', () => this.getKsiegowaniaPliki()),
      optionalSection('ksiegowaniaKonwersje', () => this.getKsiegowaniaKonwersje()),
      this.getAllNotificationPrefs(),
      this.getMailingTypy(),
      this.getZebrania(),
      optionalSection('ksiegowaniaPrzypisania', () => this.getKsiegowaniaPrzypisania()),
      optionalSection('zebraniaSprawozdania', () => this.getSprawozdaniaFull()),
      optionalSection('zebraniaWspolnoty', () => this.getZebraniaWspolnoty()),
      optionalSection('zebraniaUstawienia', () => this.getZebraniaUstawieniaRow()),
      optionalSection('planyGospodarcze', () => this.getPlanyWlasne()),
      optionalSection('podatkiNieruchomosci', () => this.getPodatkiNieruchomosci()),
      optionalSection('podatkiStawki', () => this.getPodatkiStawki()),
      optionalSection('podatkiCit', () => this.getPodatkiCit()),
      optionalSection('podatkiPit', () => this.getPodatkiPit()),
      optionalSection('podatkiCitUstawienia', () => this.getPodatkiCitUstawieniaRow()),
      optionalSection('podpisHistoria', () => this.getPodpisHistoria()),
    ]);
    return {
      format: 'filefunky-backup',
      formatVersion: 1,
      appVersion,
      createdAt: new Date().toISOString(),
      meta: { skippedSections },
      data: {
        banks,
        kontrahenci,
        adresy,
        kontoTypy,
        history,
        odczytyHistory,
        zgnJednostki,
        zgnPelnomocnicy,
        mailingPola,
        mailingSzablony,
        mailingHistory,
        spotkaniaTypy,
        spotkania,
        spotkaniaLokalizacje,
        zadania,
        zadaniaKomentarze,
        zadaniaNotatki,
        ksiegowaniaPriorytety,
        ksiegowaniaUwagi,
        ksiegowaniaPrzypisania,
        ksiegowaniaPliki,
        ksiegowaniaKonwersje,
        notificationPrefs,
        mailingTypy,
        zebrania,
        zebraniaSprawozdania,
        zebraniaWspolnoty,
        zebraniaUstawienia,
        planyGospodarcze,
        podatkiNieruchomosci,
        podatkiStawki,
        podatkiCit,
        podatkiPit,
        podatkiCitUstawienia,
        podpisHistoria,
        // The `app_users` ROWS are deliberately absent: they mirror the Supabase
        // auth accounts, rebuilt by a trigger, not data this app authors — and
        // the participants stored on each meeting carry their own snapshot. The
        // NAMES are the exception: someone typed them here, nothing can rebuild
        // them, so they travel keyed by mailbox. Accounts nobody has named carry
        // nothing worth restoring, hence the filter.
        appUserNames: appUsers
          .filter(u => (u.firstName ?? '') !== '' || (u.lastName ?? '') !== '' || !!u.color)
          .map((u): AppUserName => ({
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            color: u.color ?? null,
          })),
        settings: this.settingsForExport(),
      },
    };
  }

  /** PostgREST rejects huge payloads; insert big tables in slices. */
  private static chunk<T>(rows: T[], size = 500): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
  }

  private async insertChunked(table: string, rows: Record<string, unknown>[]): Promise<void> {
    for (const slice of DatabaseService.chunk(rows)) {
      const { error } = await getSupabase().from(table).insert(slice);
      if (error) throw new Error(`restore ${table}: ${error.message}`);
    }
  }

  private async deleteByIds(table: string, ids: number[]): Promise<void> {
    for (const slice of DatabaseService.chunk(ids)) {
      const { error } = await getSupabase().from(table).delete().in('id', slice);
      if (error) throw new Error(`restore cleanup ${table}: ${error.message}`);
    }
  }

  /**
   * Insert the backup's rows into a referenced table while the old rows still
   * exist, returning oldId → newId. Postgres assigns fresh ids, so rows that
   * point at this table (adresy.bank_id, adresy.account_types values) are
   * rewritten through this map before they're inserted.
   */
  private async insertRemapped(
    table: string,
    select: string,
    oldIds: number[],
    payload: Record<string, unknown>[],
  ): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (payload.length === 0) return map;
    const { data, error } = await getSupabase().from(table).insert(payload).select(select);
    if (error || !data) throw new Error(`restore ${table}: ${error?.message ?? 'no data returned'}`);
    // PostgREST returns inserted rows in payload order.
    (data as unknown as { id: number }[]).forEach((row, i) => map.set(oldIds[i], row.id));
    return map;
  }

  /** Every id a table holds now — the rows a restore is about to replace. */
  private async liveIds(table: string): Promise<number[]> {
    const rows = await fetchAllPaged<{ id: number }>(`restore ${table} (id)`, (from, to) =>
      getSupabase().from(table).select('id').order('id', { ascending: true }).range(from, to),
    );
    return rows.map((r) => Number(r.id));
  }

  /**
   * Swap a table's rows for the backup's without a moment of emptiness: the
   * ids of the rows there now are noted, the backup's rows inserted, and only
   * then the old ones deleted. A failure part-way leaves the old rows in place
   * (beside some new ones) — never an empty table. For tables that no other
   * table points at by id and that have no unique key a second copy would hit.
   */
  private async replaceRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
    const old = await this.liveIds(table);
    await this.insertChunked(table, rows);
    await this.deleteByIds(table, old);
  }

  /**
   * The same for a table with a natural unique key (`onConflict`: a community
   * and month, a NIP and year…), where a second copy cannot even be inserted:
   * the backup's rows are upserted on that key — a row that exists keeps its id,
   * so whatever points at it stays pointed — and the live rows whose key the
   * backup does not have are returned (`idColumn` values), for the caller to
   * delete once nothing it still restores needs them.
   */
  private async upsertByKey(
    table: string,
    rows: Record<string, unknown>[],
    onConflict: string,
    options: { idColumn?: string; chunkSize?: number } = {},
  ): Promise<{ stale: unknown[]; keys: Set<string> }> {
    const idColumn = options.idColumn ?? 'id';
    const keyColumns = onConflict.split(',').map((c) => c.trim());
    const keyOf = (r: Record<string, unknown>) => keyColumns.map((c) => String(r[c] ?? '')).join('|');
    // One row per key: an upsert that meets its own key twice is refused by Postgres.
    const unique = [...new Map(rows.map((r) => [keyOf(r), r] as const)).values()];
    for (const slice of DatabaseService.chunk(unique, options.chunkSize ?? 500)) {
      const { error } = await getSupabase().from(table).upsert(slice, { onConflict });
      if (error) throw new Error(`restore ${table}: ${error.message}`);
    }
    const keys = new Set(unique.map(keyOf));
    const columns = [...new Set([idColumn, ...keyColumns])].join(', ');
    const live = await fetchAllPaged<any>(`restore ${table} (klucze)`, (from, to) =>
      getSupabase().from(table).select(columns).order(idColumn, { ascending: true }).range(from, to),
    );
    return { stale: live.filter((r) => !keys.has(keyOf(r))).map((r) => r[idColumn]), keys };
  }

  /**
   * Delete rows by the values of one column, in slices. A text value with a
   * double quote or a backslash goes one by one through `eq`: postgrest-js
   * quotes `in(...)` values but does not escape those two, so a community named
   * `WM "Pod Lipą"` would break the whole filter.
   */
  private async deleteWhereIn(table: string, column: string, values: unknown[]): Promise<void> {
    const awkward = values.filter((v) => typeof v === 'string' && /["\\]/.test(v));
    for (const value of awkward) {
      const { error } = await getSupabase().from(table).delete().eq(column, value as string);
      if (error) throw new Error(`restore cleanup ${table}: ${error.message}`);
    }
    const plain = values.filter((v) => !awkward.includes(v));
    for (const slice of DatabaseService.chunk(plain, 200)) {
      const { error } = await getSupabase().from(table).delete().in(column, slice as (string | number)[]);
      if (error) throw new Error(`restore cleanup ${table}: ${error.message}`);
    }
  }

  /**
   * Bring a dictionary in line with the backup while keeping the ids of the rows
   * the two share: each backup row is matched to a live row by its key (a name,
   * trimmed and case-insensitive) and written over it in place; a row with no
   * match is inserted. Returns backup id → live id, and the live ids no backup
   * row matched — deleted by the caller at the very end, once nothing restored
   * points at them.
   *
   * In place rather than re-inserted: what points at these rows from sections
   * the backup does not carry keeps pointing at them (ON DELETE SET NULL would
   * cut it), and a unique name never meets its own old copy.
   */
  private async mergeByKey(
    table: string,
    liveColumns: string,
    liveKey: (row: any) => string,
    backupRows: { id: number; key: string; values: Record<string, unknown> }[],
  ): Promise<{ idMap: Map<number, number>; stale: number[] }> {
    const live = await fetchAllPaged<any>(`restore ${table} (odczyt)`, (from, to) =>
      getSupabase().from(table).select(liveColumns).order('id', { ascending: true }).range(from, to),
    );
    const byKey = new Map<string, number[]>();
    for (const r of live) byKey.set(liveKey(r), [...(byKey.get(liveKey(r)) ?? []), Number(r.id)]);
    const idMap = new Map<number, number>();
    const updates: Record<string, unknown>[] = [];
    const inserts: { oldId: number; values: Record<string, unknown> }[] = [];
    // A backup taken before names became unique (unikalne-nazwy.sql) may hold the
    // same name twice. Each live row is still matched once; a duplicate with no
    // live row left to take is folded into the first row of its name instead of
    // inserted — a second insert would hit the unique index and stop the restore
    // half-way.
    const firstOfKey = new Map<string, number>();
    const folded: { id: number; into: number }[] = [];
    for (const b of backupRows) {
      const liveId = byKey.get(b.key)?.shift();
      const first = firstOfKey.get(b.key);
      if (first === undefined) firstOfKey.set(b.key, b.id);
      if (liveId !== undefined) {
        updates.push({ id: liveId, ...b.values });
        idMap.set(b.id, liveId);
      } else if (first !== undefined) {
        folded.push({ id: b.id, into: first });
      } else {
        inserts.push({ oldId: b.id, values: b.values });
      }
    }
    // An upsert on the primary key of rows that exist is an update of each, in one request per slice.
    for (const slice of DatabaseService.chunk(updates)) {
      const { error } = await getSupabase().from(table).upsert(slice, { onConflict: 'id' });
      if (error) throw new Error(`restore ${table}: ${error.message}`);
    }
    for (const slice of DatabaseService.chunk(inserts)) {
      const sliceMap = await this.insertRemapped(
        table,
        'id',
        slice.map((r) => r.oldId),
        slice.map((r) => r.values),
      );
      sliceMap.forEach((newId, oldId) => idMap.set(oldId, newId));
    }
    for (const f of folded) {
      const target = idMap.get(f.into);
      if (target !== undefined) idMap.set(f.id, target);
    }
    const matched = new Set(idMap.values());
    return { idMap, stale: live.map((r) => Number(r.id)).filter((id) => !matched.has(id)) };
  }

  /**
   * Replace the shared data with the backup's contents — as non-destructively
   * as the database allows without a transaction:
   *   - dictionaries others point at (banks, account types, city units and
   *     their proxies, communities, meeting kinds and places) are merged in
   *     place by name, so their ids — and every link to them — survive;
   *   - tables with a natural unique key are upserted on it;
   *   - the rest get their new rows inserted before the old ones are deleted;
   *   - what the backup does not have is deleted last, once nothing restored
   *     points at it.
   * A failure part-way therefore leaves the old data in place (with some new
   * rows beside it) rather than empty tables, and a section the backup does not
   * carry is never touched. What it cannot give is all-or-nothing across tables:
   * a failure leaves some sections restored and others not — the safety copy
   * taken just before (main.ts) is the way back.
   */
  async importFullBackup(backup: BackupData): Promise<void> {
    const {
      banks,
      kontrahenci,
      adresy,
      kontoTypy,
      history,
      odczytyHistory,
      zgnJednostki,
      zgnPelnomocnicy,
      mailingPola,
      mailingSzablony,
      mailingHistory,
      spotkaniaTypy,
      spotkania,
      spotkaniaLokalizacje,
      zadania,
      zadaniaKomentarze,
      zadaniaNotatki,
      appUserNames,
      ksiegowaniaPriorytety,
      ksiegowaniaUwagi,
      ksiegowaniaPrzypisania,
      ksiegowaniaPliki,
      ksiegowaniaKonwersje,
      notificationPrefs,
      mailingTypy,
      zebrania,
      zebraniaSprawozdania,
      zebraniaWspolnoty,
      zebraniaUstawienia,
      planyGospodarcze,
      podatkiNieruchomosci,
      podatkiStawki,
      podatkiCit,
      podatkiPit,
      podatkiCitUstawienia,
      podpisHistoria,
      settings,
    } = backup.data;

    const nameKey = (value: unknown) => String(value ?? '').trim().toLowerCase();
    // Ids the backup does not have, deleted at the very end (see the doc above).
    const staleAtEnd: { table: string; ids: number[] }[] = [];

    // Bypass the 60 s cache — every read below must see the live tables.
    this.invalidateAllCaches();

    // ---------------- Dictionaries, merged in place by name ----------------
    // Each is required in a backup (validateBackup) except the city units, and
    // a missing one is left alone: its column is then also left out of the
    // communities written below, so their live links stay.
    let bankIdMap: Map<number, number> | null = null;
    if (banks) {
      const merged = await this.mergeByKey(
        'banks',
        'id, name',
        (r) => nameKey(r.name),
        banks.map((b) => ({
          id: b.id,
          key: nameKey(b.name),
          values: {
            name: b.name,
            converter_id: b.converterId,
            account_prefixes: b.accountPrefixes ?? [],
            created_at: b.createdAt,
          },
        })),
      );
      bankIdMap = merged.idMap;
      staleAtEnd.push({ table: 'banks', ids: merged.stale });
    }

    let typIdMap: Map<number, number> | null = null;
    if (kontoTypy) {
      // Exactly one default: the backup's first, and the live one stood down
      // before it is written (a unique index allows only one at a time).
      const defaultId = kontoTypy.find((t) => t.isDefault)?.id;
      if (defaultId !== undefined) await this.clearDefaultKontoTyp();
      const merged = await this.mergeByKey(
        'konto_typy',
        'id, name',
        (r) => nameKey(r.name),
        kontoTypy.map((t) => ({
          id: t.id,
          key: nameKey(t.name),
          values: {
            name: t.name,
            bank_account_symbol: t.bankAccountSymbol,
            apartment_prefix: t.apartmentPrefix,
            is_default: t.id === defaultId,
            created_at: t.createdAt,
          },
        })),
      );
      typIdMap = merged.idMap;
      staleAtEnd.push({ table: 'konto_typy', ids: merged.stale });
    }

    // City units and their proxies (Mailing). Backups predating the module carry
    // no units: then the live ones stay, and so do the communities' links to them.
    let zgnIdMap: Map<number, number> | null = null;
    const zgnPelnomocnikIdMap = new Map<number, number>();
    if (zgnJednostki) {
      const merged = await this.mergeByKey(
        'zgn_jednostki',
        'id, nazwa',
        (r) => nameKey(r.nazwa),
        zgnJednostki.map((z) => ({
          id: z.id,
          key: nameKey(z.nazwa),
          values: { nazwa: z.nazwa, email: z.email, created_at: z.createdAt },
        })),
      );
      zgnIdMap = merged.idMap;
      // A proxy acts for one unit: matched within it by name. A backup written
      // before proxies existed says nothing about them — the live ones stay
      // (those of units the backup drops go with the unit, ON DELETE CASCADE).
      if (zgnPelnomocnicy) {
        const units = merged.idMap;
        const proxies = await this.mergeByKey(
          'zgn_pelnomocnicy',
          'id, jednostka_id, imie_nazwisko',
          (r) => `${r.jednostka_id}|${nameKey(r.imie_nazwisko)}`,
          zgnPelnomocnicy
            .filter((p) => units.has(p.jednostkaId))
            .map((p) => {
              const unitId = units.get(p.jednostkaId)!;
              return {
                id: p.id,
                key: `${unitId}|${nameKey(p.imieNazwisko)}`,
                values: {
                  jednostka_id: unitId,
                  imie_nazwisko: p.imieNazwisko,
                  email: p.email ?? '',
                  created_at: p.createdAt,
                },
              };
            }),
        );
        proxies.idMap.forEach((newId, oldId) => zgnPelnomocnikIdMap.set(oldId, newId));
        staleAtEnd.push({ table: 'zgn_pelnomocnicy', ids: proxies.stale });
      }
      // After the communities and proxies: a stale unit takes its proxies with it.
      staleAtEnd.push({ table: 'zgn_jednostki', ids: merged.stale });
    }

    if (adresy) {
      const merged = await this.mergeByKey(
        'adresy',
        'id, nazwa',
        (r) => nameKey(r.nazwa),
        adresy.map((a) => {
          const values: Record<string, unknown> = {
            nazwa: a.nazwa,
            alternative_names: a.alternativeNames ?? [],
            swrk_identifiers: a.swrkIdentifiers ?? [],
            account_numbers: a.accountNumbers ?? [],
            apartment_mappings: a.apartmentMappings ?? [],
            // Absent in backups written before communities had a board.
            zarzad: DatabaseService.zarzadList(a.zarzad),
            // Absent in backups written before communities had a tax identification.
            identyfikacja: normalizeIdentyfikacja(a.identyfikacja),
            created_at: a.createdAt,
          };
          // Links into a dictionary the backup carries are re-pointed through
          // its map; one it does not carry is left as the live row has it.
          if (bankIdMap) values.bank_id = a.bankId != null ? bankIdMap.get(a.bankId) ?? null : null;
          if (typIdMap) {
            const accountTypes: Record<string, number> = {};
            for (const [account, typId] of Object.entries(a.accountTypes ?? {})) {
              const mapped = typIdMap.get(typId);
              if (mapped !== undefined) accountTypes[account] = mapped;
            }
            values.account_types = accountTypes;
          }
          if (zgnIdMap) {
            values.zgn_jednostka_id = a.zgnJednostkaId != null ? zgnIdMap.get(a.zgnJednostkaId) ?? null : null;
          }
          return { id: a.id, key: nameKey(a.nazwa), values };
        }),
      );
      // First of the stale dictionaries to go: communities point at the others.
      staleAtEnd.unshift({ table: 'adresy', ids: merged.stale });
    }

    // Nothing points at contractors: new rows in, then the old ones out.
    if (kontrahenci) {
      await this.replaceRows(
        'kontrahenci',
        kontrahenci.map((k) => {
          const typy: KontrahentTyp[] = k.typy && k.typy.length > 0 ? k.typy : ['Kontrahent'];
          return {
            nazwa: k.nazwa,
            konto_kontrahenta: k.kontoKontrahenta,
            nip: k.nip || null,
            typ: typy[0],
            typy,
            alternative_names: k.alternativeNames ?? [],
            created_at: k.createdAt,
          };
        }),
      );
    }

    // Rows elsewhere keep a community's NAME next to its id, and the name is what
    // the restored rows are re-pointed through (the backup's ids may be another
    // database's). Read after the merge: a community the backup has resolves to
    // its live row.
    this.invalidateCache('adresy');
    const adresIdByNazwa = new Map(
      (await this.getAllAdresy()).map(a => [nameKey(a.nazwa), a.id] as const),
    );
    const adresIdOf = (nazwa: string | null | undefined) => (nazwa ? adresIdByNazwa.get(nameKey(nazwa)) ?? null : null);

    // The conversion log. No DOM tick here: the posting state lives in
    // `ksiegowania_konwersje` (restored below), never in the clearable log.
    if (history) {
      await this.replaceRows(
        'history',
        history.map(h => ({
          file_name: h.fileName,
          bank_name: h.bankName,
          converter_name: h.converterName,
          status: h.status,
          error_message: h.errorMessage || null,
          input_path: h.inputPath,
          output_path: h.outputPath,
          converted_at: h.convertedAt,
          adres_id: adresIdOf(h.adresNazwa),
          adres_nazwa: h.adresNazwa ?? null,
        })),
      );
    }

    // Backups written before the meter-readings module carry no such key; leave
    // the existing rows alone rather than wiping them on an old restore.
    if (odczytyHistory) {
      await this.replaceRows(
        'odczyty_history',
        odczytyHistory.map(h => ({
          supplier: h.supplier,
          status: h.status,
          error_message: h.errorMessage || null,
          output_dir: h.outputDir,
          source_files: h.sources,
          output_files: h.outputs,
          reading_count: h.readingCount,
          skipped_count: h.skippedCount,
          converted_at: h.convertedAt,
        })),
      );
    }

    // Mailing kinds. Upserted by key rather than wiped: the built-in kind is
    // protected by a trigger against deletion, and templates and history point at
    // kinds by key, which survives this untouched. Kinds the backup does not know
    // go — except the built-in one, which always exists.
    if (mailingTypy) {
      const rows = mailingTypy.map(typ => ({
        klucz: typ.klucz,
        // The built-in kind's name is fixed (a trigger refuses any other).
        nazwa: typ.systemowy ? DatabaseService.builtinMailingTypNazwa(typ.klucz) ?? typ.nazwa : typ.nazwa,
        systemowy: typ.systemowy === true,
        opis: typ.opis ?? '',
        adresaci: DatabaseService.mailingAdresaci(typ.adresaci),
        created_at: typ.createdAt,
      }));
      for (const slice of DatabaseService.chunk(rows)) {
        const { error } = await getSupabase().from('mailing_typy').upsert(slice, { onConflict: 'klucz' });
        if (error) throw new Error(`restore mailing_typy: ${error.message}`);
      }
      const keep = new Set(mailingTypy.map(t => t.klucz));
      const stale = (await this.getMailingTypy()).filter(t => !t.systemowy && !keep.has(t.klucz));
      await this.deleteByIds('mailing_typy', stale.map(t => t.id));
    }

    // Mailing dictionaries: each key is absent in backups written before the
    // module existed, so a missing key leaves the live rows alone.
    if (mailingPola) {
      await this.replaceRows(
        'mailing_pola',
        // `jednostka` and `typ_wartosci` default for backups written before
        // those columns existed — both are NOT NULL, so an undefined would fail
        // the whole restore. `typ` is absent in backups written before fields
        // could be bound to a kind: null keeps them offered everywhere.
        mailingPola.map(p => ({
          nazwa: p.nazwa,
          tekst: p.tekst,
          jednostka: p.jednostka ?? '',
          typ_wartosci: p.typWartosci ?? 'tekst',
          typ: p.typ ?? null,
          created_at: p.createdAt,
        })),
      );
    }

    // Before Zebrania, whose notices find their template by name among these.
    if (mailingSzablony) {
      await this.replaceRows(
        'mailing_szablony',
        mailingSzablony.map(s => ({
          nazwa: s.nazwa,
          typ: s.typ,
          temat: s.temat,
          tresc: s.tresc,
          attach_pdf: s.attachPdf,
          // Absent in backups written before the field table existed.
          table_fields: s.tableFields ?? [],
          created_at: s.createdAt,
        })),
      );
    }

    // Old meeting id → new one, filled by the meetings' restore below and read by
    // the tasks', the Zebrania entries' and the mailing history's — their link to
    // a meeting is re-pointed through it. Empty when the backup carries no
    // meetings: the live meetings then keep ids the backup cannot be trusted to
    // know, so such a link is dropped rather than guessed.
    const spotkanieIdMap = new Map<number, number>();
    // Same for locations — the Zebrania entries below point at them too.
    let restoredLokalizacjaIdMap = new Map<number, number>();
    // The meetings being replaced — deleted at the end, once the tasks, entries
    // and mails that pointed at them have been replaced too.
    let oldSpotkanieIds: number[] = [];

    // Kalendarz. Gated on the meetings rather than on the types, because the two
    // keys are written together and the types only exist to be pointed at: a
    // backup with types but no meetings would replace the dictionary out from
    // under live meetings, nulling their type.
    if (spotkania) {
      // Kinds and places merged by name, like the other dictionaries.
      const typy = await this.mergeByKey(
        'spotkania_typy',
        'id, nazwa',
        (r) => nameKey(r.nazwa),
        (spotkaniaTypy ?? []).map(t => ({
          id: t.id,
          key: nameKey(t.nazwa),
          values: {
            nazwa: t.nazwa,
            kolor: t.kolor,
            opis: t.opis,
            // Absent in backups written before types had a notice period.
            dni_na_dokumenty: DatabaseService.noticeDays(t.dniNaDokumenty),
            created_at: t.createdAt,
          },
        })),
      );
      const lokalizacje = await this.mergeByKey(
        'spotkania_lokalizacje',
        'id, nazwa',
        (r) => nameKey(r.nazwa),
        (spotkaniaLokalizacje ?? []).map(l => ({
          id: l.id,
          key: nameKey(l.nazwa),
          values: { nazwa: l.nazwa, adres: l.adres ?? '', opis: l.opis ?? '', created_at: l.createdAt },
        })),
      );

      oldSpotkanieIds = await this.liveIds('spotkania');
      // Chunked, and remapped per chunk: the tasks restored further down point at
      // these meetings by id, and Postgres hands every one of them a fresh id.
      for (const slice of DatabaseService.chunk(spotkania)) {
        const sliceMap = await this.insertRemapped(
          'spotkania',
          'id',
          slice.map(m => m.id),
          slice.map(m => ({
            nazwa: m.nazwa,
            typ_id: m.typId != null ? typy.idMap.get(m.typId) ?? null : null,
            // The backup's community number may be another database's; the
            // name is what survives a restore, and what the meeting displays.
            adres_id: adresIdOf(m.adresNazwa),
            adres_nazwa: m.adresNazwa ?? '',
            // Re-pointed through the merged dictionary; the name travels
            // regardless, which is what a meeting actually displays.
            lokalizacja_id: m.lokalizacjaId != null ? lokalizacje.idMap.get(m.lokalizacjaId) ?? null : null,
            lokalizacja_nazwa: m.lokalizacjaNazwa ?? '',
            starts_at: m.startsAt,
            ends_at: m.endsAt ?? null,
            opis: m.opis ?? '',
            // The participants are a snapshot of accounts, whose ids are auth
            // uuids — stable across a restore, so they travel verbatim.
            uczestnicy: m.uczestnicy ?? [],
            // Absent in backups written before these columns existed: a meeting
            // from back then meant a real date and no paperwork trail.
            termin_status: m.terminStatus === 'wstepny' ? 'wstepny' : 'potwierdzony',
            termin_wysylki: DatabaseService.dayKeyOrNull(m.terminWysylki),
            termin_zmieniony_at: m.terminZmienionyAt ?? null,
            termin_zmieniony_z: m.terminZmienionyZ ?? null,
            termin_zmieniony_by: m.terminZmienionyBy ?? null,
            termin_zmiana_odczytana_at: m.terminZmianaOdczytanaAt ?? null,
            termin_zmiana_odczytana_by: m.terminZmianaOdczytanaBy ?? null,
            // Re-pointed through the units and proxies merged above; the name
            // travels regardless. All absent in backups written before meetings
            // could be assigned a city unit. Without units in the backup the
            // backup's ids mean nothing here, so the link is dropped.
            zgn_jednostka_id:
              m.zgnJednostkaId != null ? zgnIdMap?.get(m.zgnJednostkaId) ?? null : null,
            zgn_pelnomocnik_id:
              m.zgnPelnomocnikId != null ? zgnPelnomocnikIdMap.get(m.zgnPelnomocnikId) ?? null : null,
            zgn_nazwa: m.zgnNazwa ?? '',
            // Absent in backups written before meetings carried board members.
            zarzad: DatabaseService.spotkanieZarzad(m.zarzad),
            // Absent in backups written before meetings had a materials status.
            materialy_status: DatabaseService.materialyStatus(m.materialyStatus),
            materialy_zmienione_at: m.materialyZmienioneAt ?? null,
            materialy_zmienione_by: m.materialyZmienioneBy ?? null,
            created_by: m.createdBy ?? '',
            created_at: m.createdAt,
            updated_at: m.updatedAt,
          })),
        );
        sliceMap.forEach((newId, oldId) => spotkanieIdMap.set(oldId, newId));
      }
      restoredLokalizacjaIdMap = lokalizacje.idMap;
      // Kinds and places the backup does not have go after the old meetings —
      // and only when the backup says anything about them at all.
      if (spotkaniaTypy) staleAtEnd.push({ table: 'spotkania_typy', ids: typy.stale });
      if (spotkaniaLokalizacje) staleAtEnd.push({ table: 'spotkania_lokalizacje', ids: lokalizacje.stale });
    }

    // The statement library — ahead of Zebrania, whose versions link its rows.
    // Absent in backups written before it existed: a missing key leaves the
    // live rows alone. Upserted on community and period, so a row both have
    // keeps its id — and every live version linking it stays linked. Small
    // slices: each row carries a whole statement.
    const sprawozdanieKey = (nr: number | null, od: string, doDnia: string) => `${nr}|${od}|${doDnia}`;
    const sprawozdanieIdByKey = new Map<string, number>();
    // The library keys the restore keeps; the rest is deleted after Zebrania.
    let sprawozdaniaKeep: Set<string> | null = null;
    const readSprawozdaniaIds = async () => {
      sprawozdanieIdByKey.clear();
      for (const r of await this.getSprawozdaniaLista()) {
        const key = sprawozdanieKey(r.nrWsp, r.okresOd, r.okresDo);
        if (!sprawozdaniaKeep || sprawozdaniaKeep.has(key)) sprawozdanieIdByKey.set(key, r.id);
      }
    };
    if (zebraniaSprawozdania) {
      const rows = zebraniaSprawozdania
        .filter(s => s.nrWsp != null && s.okresOd && s.okresDo && s.dane)
        .map(s => ({
          nr_wsp: s.nrWsp,
          nazwa: s.nazwa ?? '',
          okres_od: s.okresOd,
          okres_do: s.okresDo,
          dane: normalizeSprawozdanieDane(s.dane),
          plik_nazwa: s.plikNazwa ?? '',
          imported_at: s.importedAt,
          imported_by: s.importedBy ?? '',
        }));
      const { keys } = await this.upsertByKey('zebrania_sprawozdania', rows, 'nr_wsp,okres_od,okres_do', {
        chunkSize: 100,
      });
      // Same `nr|od|do` shape as `sprawozdanieKey`.
      sprawozdaniaKeep = keys;
    }
    if (zebraniaSprawozdania || zebrania) await readSprawozdaniaIds();

    // Zebrania, with their versions: new entries in, then the old ones out (the
    // versions go with them, ON DELETE CASCADE), re-pointing every link: the
    // meeting through the meetings restored above, the community through its
    // name, the location through the merged dictionary, and each version at its
    // entry's new id. A notice's template id is re-pointed by the template's
    // name — the templates were re-inserted with fresh ids too. Gated on the
    // key: a backup written before the module existed leaves the live entries alone.
    if (zebrania) {
      const oldZebranieIds = await this.liveIds('zebrania');
      const szablonIdByNazwa = new Map(
        (await this.getMailingSzablony()).map(t => [nameKey(t.nazwa), t.id] as const),
      );
      // A version's statement links a library row; one the library does not
      // hold (an older backup's copy of a print replaced since) goes back in
      // from the copy the backup carries.
      const kopiaKey = (k: { dane: Sprawozdanie }) => sprawozdanieKey(k.dane.nrWsp, k.dane.okresOd, k.dane.okresDo);
      const brakujace = new Map<string, NonNullable<ReturnType<typeof sprawozdanieZKopii>>>();
      for (const z of zebrania) {
        for (const w of z.wersje ?? []) {
          const kopia = sprawozdanieZKopii(w.sprawozdanie);
          if (!kopia || kopia.dane.nrWsp == null || !kopia.dane.okresOd || !kopia.dane.okresDo) continue;
          if (!sprawozdanieIdByKey.has(kopiaKey(kopia))) brakujace.set(kopiaKey(kopia), kopia);
        }
      }
      if (brakujace.size > 0) {
        await this.importSprawozdania(
          [...brakujace.values()].map(k => k.dane),
          [...brakujace.values()][0].plikNazwa,
          'kopia zapasowa',
        );
        if (sprawozdaniaKeep) for (const key of brakujace.keys()) sprawozdaniaKeep.add(key);
        await readSprawozdaniaIds();
      }
      for (const slice of DatabaseService.chunk(zebrania)) {
        const idMap = await this.insertRemapped(
          'zebrania',
          'id',
          slice.map(z => z.id),
          slice.map(z => ({
            spotkanie_id:
              z.spotkanieId != null ? spotkanieIdMap.get(z.spotkanieId) ?? null : null,
            nazwa: z.nazwa ?? '',
            adres_id: adresIdOf(z.adresNazwa),
            adres_nazwa: z.adresNazwa ?? '',
            lokalizacja_id:
              z.lokalizacjaId != null ? restoredLokalizacjaIdMap.get(z.lokalizacjaId) ?? null : null,
            lokalizacja_nazwa: z.lokalizacjaNazwa ?? '',
            lokalizacja_adres: z.lokalizacjaAdres ?? '',
            starts_at: z.startsAt ?? null,
            created_by: z.createdBy ?? '',
            created_at: z.createdAt,
            updated_at: z.updatedAt ?? z.createdAt,
          })),
        );
        await this.insertChunked(
          'zebrania_wersje',
          slice.flatMap(z => {
            const zebranieId = idMap.get(z.id);
            if (zebranieId === undefined) return [];
            return (z.wersje ?? []).map(w => ({
              zebranie_id: zebranieId,
              major: w.major ?? 1,
              minor: w.minor ?? 0,
              nazwa: w.nazwa ?? '',
              // Older backups have no marks: a prepared version then counts every document ready.
              ...(() => {
                const gotowe = w.gotowe
                  ? normalizeGotowe(w.gotowe)
                  : gotoweForStatus(DatabaseService.zebranieStatus(w.status));
                return { gotowe, status: wersjaStatusFromGotowe(gotowe) };
              })(),
              opis: w.opis ?? '',
              materialy: normalizeMaterialy(w.materialy).map(m => ({
                ...m,
                szablonId: m.szablonNazwa ? szablonIdByNazwa.get(nameKey(m.szablonNazwa)) ?? null : null,
              })),
              // Absent in backups written before versions carried a statement and a plan.
              ...(() => {
                const kopia = sprawozdanieZKopii(w.sprawozdanie);
                const id = kopia ? sprawozdanieIdByKey.get(kopiaKey(kopia)) : undefined;
                return kopia && id !== undefined
                  ? { sprawozdanie_id: id, sprawozdanie: DatabaseService.sprawozdanieMetaRow(kopia.meta) }
                  : { sprawozdanie_id: null, sprawozdanie: w.sprawozdanieOdlaczone ? SPRAWOZDANIE_ODLACZONE : null };
              })(),
              plan: normalizePlan(w.plan),
              created_by: w.createdBy ?? '',
              created_at: w.createdAt,
              updated_at: w.updatedAt ?? w.createdAt,
              updated_by: w.updatedBy ?? '',
            }));
          }),
        );
      }
      await this.deleteByIds('zebrania', oldZebranieIds);
    }
    // Library rows the backup does not have — only now, once no restored
    // version can still need them.
    if (sprawozdaniaKeep) {
      const keep = sprawozdaniaKeep;
      const stale = (await this.getSprawozdaniaLista()).filter(
        r => !keep.has(sprawozdanieKey(r.nrWsp, r.okresOd, r.okresDo)),
      );
      await this.deleteByIds('zebrania_sprawozdania', stale.map(r => r.id));
    }

    // The per-community data and the module settings. Each key is absent in
    // backups written before it existed, so a missing key leaves the live rows
    // alone. Communities are keyed by name, so no restored id is involved.
    if (zebraniaWspolnoty) {
      const { stale } = await this.upsertByKey(
        'zebrania_wspolnoty',
        zebraniaWspolnoty
          .filter(w => w.adresNazwa)
          .map(w => ({
            adres_nazwa: w.adresNazwa,
            vdom_nr: w.vdomNr ?? null,
            udzialy: w.udzialy ?? null,
            updated_at: w.updatedAt || new Date().toISOString(),
            updated_by: w.updatedBy ?? '',
          })),
        'adres_nazwa',
        { idColumn: 'adres_nazwa' },
      );
      await this.deleteWhereIn('zebrania_wspolnoty', 'adres_nazwa', stale);
    }
    if (zebraniaUstawienia !== undefined) {
      const { error } = zebraniaUstawienia
        ? await getSupabase()
            .from('zebrania_ustawienia')
            .upsert({ id: 1, dane: normalizeUstawienia(zebraniaUstawienia) })
        : await getSupabase().from('zebrania_ustawienia').delete().eq('id', 1);
      if (error) throw new Error(`restore zebrania_ustawienia: ${error.message}`);
    }
    // Plans of the Plany gospodarcze module — keyed by vDom number and year,
    // nothing a restore renumbers.
    if (planyGospodarcze) {
      const { stale } = await this.upsertByKey(
        'plany_gospodarcze',
        planyGospodarcze
          .map(p => ({ p, plan: normalizePlan(p.plan) }))
          .filter(({ p, plan }) => p.nrWsp != null && plan)
          .map(({ p, plan }) => ({
            nr_wsp: p.nrWsp,
            nazwa: p.nazwa ?? '',
            rok: plan!.rok,
            plan,
            sprawozdanie: normalizePlanSprawozdanieMeta(p.sprawozdanie),
            created_at: p.createdAt || new Date().toISOString(),
            created_by: p.createdBy ?? '',
            updated_at: p.updatedAt || new Date().toISOString(),
            updated_by: p.updatedBy ?? '',
          })),
        'nr_wsp,rok',
      );
      await this.deleteByIds('plany_gospodarcze', stale as number[]);
    }
    // The Podatki module: declarations keyed by NIP and year, rates by year —
    // nothing a restore renumbers.
    if (podatkiNieruchomosci) {
      const { stale } = await this.upsertByKey(
        'podatki_nieruchomosci',
        podatkiNieruchomosci
          .filter(p => p.nip && Number.isInteger(p.rok))
          .map(p => ({
            nip: tylkoCyfry(p.nip),
            rok: p.rok,
            dane: normalizeDane(p.dane),
            created_at: p.createdAt || new Date().toISOString(),
            created_by: p.createdBy ?? '',
            updated_at: p.updatedAt || new Date().toISOString(),
            updated_by: p.updatedBy ?? '',
          })),
        'nip,rok',
      );
      await this.deleteByIds('podatki_nieruchomosci', stale as number[]);
    }
    if (podatkiStawki) {
      const { stale } = await this.upsertByKey(
        'podatki_stawki',
        podatkiStawki
          .filter(s => Number.isInteger(s.rok))
          .map(s => ({
            rok: s.rok,
            stawki: normalizeStawki(s.stawki),
            potwierdzone: s.potwierdzone === true,
            updated_at: s.updatedAt || new Date().toISOString(),
            updated_by: s.updatedBy ?? '',
          })),
        'rok',
        { idColumn: 'rok' },
      );
      await this.deleteWhereIn('podatki_stawki', 'rok', stale);
    }

    // CIT-8 returns: keyed by the community's name and the year, and the dictionary is one row.
    if (podatkiCit) {
      const { stale } = await this.upsertByKey(
        'podatki_cit',
        podatkiCit
          .filter(p => p.adresNazwa && Number.isInteger(p.rok))
          .map(p => ({
            adres_nazwa: p.adresNazwa,
            rok: p.rok,
            dane: normalizeDaneCit(p.dane),
            created_at: p.createdAt || new Date().toISOString(),
            created_by: p.createdBy ?? '',
            updated_at: p.updatedAt || new Date().toISOString(),
            updated_by: p.updatedBy ?? '',
          })),
        'adres_nazwa,rok',
      );
      await this.deleteByIds('podatki_cit', stale as number[]);
    }
    // PIT: one row per community and year, the people and the PIT-4R inside `dane`.
    if (podatkiPit) {
      const { stale } = await this.upsertByKey(
        'podatki_pit',
        podatkiPit
          .filter(p => p.nip && Number.isInteger(p.rok))
          .map(p => ({
            nip: tylkoCyfry(p.nip),
            rok: p.rok,
            dane: normalizeDanePit(p.dane),
            created_at: p.createdAt || new Date().toISOString(),
            created_by: p.createdBy ?? '',
            updated_at: p.updatedAt || new Date().toISOString(),
            updated_by: p.updatedBy ?? '',
          })),
        'nip,rok',
      );
      await this.deleteByIds('podatki_pit', stale as number[]);
    }
    if (podatkiCitUstawienia !== undefined) {
      const { error } = podatkiCitUstawienia
        ? await getSupabase()
            .from('podatki_cit_ustawienia')
            .upsert({ id: 1, dane: normalizeCitUstawienia(podatkiCitUstawienia) })
        : await getSupabase().from('podatki_cit_ustawienia').delete().eq('id', 1);
      if (error) throw new Error(`restore podatki_cit_ustawienia: ${error.message}`);
    }
    // The Podpis module's runs: one row per run, nothing that points elsewhere.
    if (podpisHistoria) {
      await this.replaceRows(
        'podpisy_historia',
        podpisHistoria.map(h => ({
          signed_at: h.signedAt || new Date().toISOString(),
          signed_by: h.signedBy ?? '',
          podmiot: h.podpis?.podmiot ?? '',
          wystawca: h.podpis?.wystawca ?? '',
          numer_seryjny: h.podpis?.numerSeryjny ?? '',
          pliki: Array.isArray(h.pliki) ? h.pliki : [],
          podpisanych: h.podpisanych ?? 0,
          przerwano: h.przerwano ?? null,
        })),
      );
    }

    // Księgowania priorities and notes. Each key is absent in backups written
    // before they existed, so a missing key leaves the live rows alone. The
    // community link is re-pointed through the name, like history and meetings.
    if (ksiegowaniaPriorytety) {
      const { stale } = await this.upsertByKey(
        'ksiegowania_priorytety',
        ksiegowaniaPriorytety.map(p => ({
          month_key: p.monthKey,
          adres_id: adresIdOf(p.adresNazwa),
          adres_nazwa: p.adresNazwa,
          position: p.position,
          notatka: p.notatka ?? '',
          // Absent in backups written before notes had an author.
          notatka_by: p.notatkaBy || null,
          // Absent in backups written before notes could tag people.
          mentions: DatabaseService.komentarzMentions(p.mentions),
          created_by: p.createdBy ?? '',
          created_at: p.createdAt,
        })),
        'month_key,adres_nazwa',
      );
      await this.deleteByIds('ksiegowania_priorytety', stale as number[]);
    }

    // Who posts which community in which month — re-pointed through the name.
    if (ksiegowaniaPrzypisania) {
      const { stale } = await this.upsertByKey(
        'ksiegowania_przypisania',
        ksiegowaniaPrzypisania.map(p => ({
          month_key: p.monthKey,
          adres_id: adresIdOf(p.adresNazwa),
          adres_nazwa: p.adresNazwa,
          email: p.email,
          assigned_by: p.assignedBy || null,
          assigned_at: p.assignedAt,
        })),
        'month_key,adres_nazwa',
      );
      await this.deleteByIds('ksiegowania_przypisania', stale as number[]);
    }

    if (ksiegowaniaUwagi) {
      await this.replaceRows(
        'ksiegowania_uwagi',
        ksiegowaniaUwagi.map(u => ({
          adres_id: adresIdOf(u.adresNazwa),
          adres_nazwa: u.adresNazwa,
          tresc: u.tresc,
          mentions: DatabaseService.komentarzMentions(u.mentions),
          created_by: u.createdBy ?? '',
          created_at: u.createdAt,
          resolved_at: u.resolvedAt ?? null,
          resolved_by: u.resolvedAt ? u.resolvedBy ?? null : null,
        })),
      );
    }

    // The dashboard's conversion records — the posting state with its DOM ticks.
    // Absent in backups written before it had its own table: then the live
    // records stay as they are (the history above is only the log).
    if (ksiegowaniaKonwersje) {
      // The manual flag goes on every row or on none: a bulk insert gives a
      // column some rows lack NULL, not its default, and `recznie` is NOT NULL.
      // None when the backup has no manual mark, so it still restores into a
      // database that has not had ksiegowania-recznie.sql run yet.
      const anyManual = ksiegowaniaKonwersje.some(h => h.manual === true);
      // The same for discarded duplicates and ksiegowania-odrzucone.sql.
      const anyDiscarded = ksiegowaniaKonwersje.some(h => !!h.discardedAt);
      await this.replaceRows(
        'ksiegowania_konwersje',
        ksiegowaniaKonwersje.map(h => ({
          file_name: h.fileName,
          bank_name: h.bankName,
          converter_name: h.converterName,
          status: h.status,
          error_message: h.errorMessage ?? null,
          input_path: h.inputPath,
          output_path: h.outputPath,
          converted_at: h.convertedAt,
          adres_id: adresIdOf(h.adresNazwa),
          adres_nazwa: h.adresNazwa ?? null,
          booked_in_dom: h.bookedInDom === true,
          booked_in_dom_at: h.bookedInDom ? h.bookedInDomAt ?? null : null,
          booked_in_dom_by: h.bookedInDom ? h.bookedInDomBy ?? null : null,
          month_key: h.monthKey ?? null,
          input_hash: h.inputHash ?? null,
          ...(anyManual ? { recznie: h.manual === true } : {}),
          ...(anyDiscarded
            ? { odrzucone_at: h.discardedAt ?? null, odrzucone_by: h.discardedAt ? h.discardedBy ?? null : null }
            : {}),
        })),
      );
    }

    // Files pinned by the folder scan — records only; the files themselves stay
    // in the statements folder. Upserted on (kind, path), the table's own key.
    // The community is re-pointed through its name and the bank through the
    // merged dictionary (or left out when the backup has no banks).
    if (ksiegowaniaPliki) {
      const { stale } = await this.upsertByKey(
        'ksiegowania_pliki',
        ksiegowaniaPliki.map(p => ({
          month_key: p.monthKey,
          kind: p.kind,
          status: p.status,
          error_message: p.errorMessage ?? null,
          adres_id: adresIdOf(p.adresNazwa),
          adres_nazwa: p.adresNazwa,
          account_number: p.accountNumber ?? null,
          account_type_name: p.accountTypeName ?? null,
          bank_id: p.bankId != null ? bankIdMap?.get(p.bankId) ?? null : null,
          bank_name: p.bankName ?? null,
          converter_id: p.converterId ?? null,
          rel_path: p.relPath,
          file_name: p.fileName,
          original_name: p.originalName ?? null,
          file_size: p.fileSize ?? 0,
          file_mtime: p.fileMtime,
          file_hash: p.fileHash,
          ignored_hashes: p.ignoredHashes ?? [],
          period_from: p.periodFrom ?? null,
          period_to: p.periodTo ?? null,
          scanned_at: p.scannedAt,
          scanned_by: p.scannedBy ?? null,
        })),
        'kind,rel_path',
      );
      await this.deleteByIds('ksiegowania_pliki', stale as number[]);
    }

    // Zadania: the new cards in, their comments re-pointed at them through an
    // old id → new id map, then the old cards out (their comments with them, ON
    // DELETE CASCADE). The attachment files are not touched: the restored cards
    // describe the same objects in the bucket. Gated on the key: a backup
    // written before the board existed must leave live cards alone. A backup
    // that has cards but no comments (written before comments existed)
    // restores the board with empty conversations.
    if (zadania) {
      const oldZadanieIds = await this.liveIds('zadania');
      const zadanieIdMap = new Map<number, number>();
      for (const slice of DatabaseService.chunk(zadania)) {
        const sliceMap = await this.insertRemapped(
          'zadania',
          'id',
          slice.map(z => z.id),
          slice.map(z => ({
            tytul: z.tytul,
            opis: z.opis ?? '',
            status: DatabaseService.zadanieStatus(z.status),
            // Absent in backups written before tasks had a priority.
            priorytet: DatabaseService.zadaniePriorytet(z.priorytet),
            // Absent in backups written before cards could be reordered.
            pozycja: Number.isFinite(z.pozycja) ? z.pozycja : 0,
            przypisany_email: z.przypisanyEmail ?? null,
            // Absent in backups written before tasks had a deadline and files.
            termin: DatabaseService.zadanieTermin(z.termin),
            zalaczniki: DatabaseService.zadanieZalaczniki(z.zalaczniki),
            // Absent in backups written before tasks could be archived.
            zarchiwizowane: z.zarchiwizowane === true,
            // Re-pointed through the meetings restored above. Absent in backups
            // written before tasks could belong to a meeting.
            spotkanie_id:
              z.spotkanieId != null ? spotkanieIdMap.get(z.spotkanieId) ?? null : null,
            created_by: z.createdBy ?? '',
            created_at: z.createdAt,
            updated_at: z.updatedAt,
            updated_by: z.updatedBy ?? '',
          })),
        );
        sliceMap.forEach((newId, oldId) => zadanieIdMap.set(oldId, newId));
      }
      await this.insertChunked(
        'zadania_komentarze',
        (zadaniaKomentarze ?? []).flatMap(k => {
          const zadanieId = zadanieIdMap.get(k.zadanieId);
          // A comment whose card is not in the backup has nowhere to live.
          if (zadanieId === undefined) return [];
          return [
            {
              zadanie_id: zadanieId,
              autor_email: k.autorEmail ?? '',
              tresc: k.tresc,
              mentions: DatabaseService.komentarzMentions(k.mentions),
              created_at: k.createdAt,
            },
          ];
        }),
      );
      await this.deleteByIds('zadania', oldZadanieIds);
    }

    // Notes pinned to the board. Pointed at by nothing; gated on the key, so a
    // backup from before they existed leaves the live notes alone.
    if (zadaniaNotatki) {
      await this.replaceRows(
        'zadania_notatki',
        zadaniaNotatki.map(n => ({
          tresc: n.tresc,
          autor_email: n.autorEmail ?? '',
          created_at: n.createdAt,
        })),
      );
    }

    // Each person's notification switches, keyed by mailbox. Gated on the key —
    // a backup from before the switches existed must not reset everybody's choices.
    if (notificationPrefs) {
      const { stale } = await this.upsertByKey(
        'notification_prefs',
        notificationPrefs.map(r => ({
          email: r.email.trim().toLowerCase(),
          prefs: DatabaseService.notificationPrefsClean(r.prefs),
        })),
        'email',
        { idColumn: 'email' },
      );
      await this.deleteWhereIn('notification_prefs', 'email', stale);
    }

    // The mailing history — after the meetings, so a mail sent from a meeting
    // is re-pointed at the meeting's new id (and its community through the
    // name). Without meetings in the backup the backup's meeting ids mean
    // nothing here, and the link is dropped; the row keeps every detail of
    // what was sent.
    if (mailingHistory) {
      await this.replaceRows(
        'mailing_history',
        mailingHistory.map(h => ({
          typ: h.typ,
          template_name: h.templateName,
          status: h.status,
          error_message: h.errorMessage || null,
          adres_id: adresIdOf(h.adresNazwa),
          spotkanie_id: h.spotkanieId != null ? spotkanieIdMap.get(h.spotkanieId) ?? null : null,
          adres_nazwa: h.adresNazwa,
          jednostka_nazwa: h.jednostkaNazwa,
          jednostka_email: h.jednostkaEmail,
          subject: h.subject,
          body_html: h.bodyHtml,
          body_text: h.bodyText,
          field_values: h.fieldValues,
          attachments: h.attachments,
          sent_from: h.sentFrom,
          sent_at: h.sentAt,
          // Absent in rows written before kinds had recipients.
          odbiorcy: Array.isArray(h.odbiorcy) ? h.odbiorcy : [],
        })),
      );
    }

    // Names of the accounts. Applied one by one rather than replaced: the rows
    // belong to the auth trigger, so a restore can only ever say "this mailbox
    // is called X" (and only these columns may be written). A name for an
    // account that no longer exists here simply matches nothing — deliberately
    // not an error, since a backup may predate a person leaving.
    if (appUserNames && appUserNames.length > 0) {
      const idByEmail = new Map(
        (await this.getAppUsers()).map(u => [u.email.trim().toLowerCase(), u.id]),
      );
      const known = appUserNames.filter(person => idByEmail.has(person.email.trim().toLowerCase()));
      for (const slice of DatabaseService.chunk(known, 10)) {
        await Promise.all(
          slice.map(async person => {
            const id = idByEmail.get(person.email.trim().toLowerCase())!;
            await this.setAppUserName(id, person.firstName ?? null, person.lastName ?? null);
            // Only when the backup says something about it: one written before
            // colours existed must leave a colour chosen since untouched.
            if (person.color !== undefined) await this.setAppUserColor(id, person.color ?? null);
          }),
        );
      }
    }

    // Last: what the backup does not have. The old meetings first (everything
    // restored now points at the new ones), then the dictionaries' leftovers —
    // communities before the banks, types and units they point at.
    await this.deleteByIds('spotkania', oldSpotkanieIds);
    for (const { table, ids } of staleAtEnd) await this.deleteByIds(table, ids);

    this.importSettings({ settings });

    this.invalidateAllCaches();
  }

  close(): void {
    // Nothing to release; the Supabase client + electron-store don't need explicit closing.
  }
}

export default DatabaseService;
