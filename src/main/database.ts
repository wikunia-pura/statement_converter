import Store from 'electron-store';
import path from 'path';
import { app } from 'electron';
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
  OdczytyHistoryEntry,
  ZgnJednostka,
  MailingPole,
  MailingPoleTyp,
  MailingSzablon,
  MailingHistoryEntry,
  MailingSmtpConfig,
  AppUser,
  AppUserName,
  SpotkanieTyp,
  SpotkanieLokalizacja,
  Spotkanie,
  SpotkanieInput,
  SpotkanieMailing,
  SpotkanieTerminStatus,
  SpotkanieUczestnik,
} from '../shared/types';
import { getSupabase } from './supabaseClient';
import { normalizeAccount } from '../shared/account-extractor';
import { buildApartmentMapping, mappingTargets } from '../shared/apartment-mapping';

// Settings remain machine-local: dark mode, folder paths, language, etc. are
// per-user-machine UI prefs that shouldn't sync across installs.
interface SettingsStoreSchema {
  settings: {
    outputFolder: string;
    impexFolder: string;
    swrkFolder: string;
    darkMode: boolean;
    language: 'pl' | 'en';
    aiConfidenceThreshold: number;
    alwaysUseAI: boolean;
    skipUserApproval: boolean;
    contractorSortOrder: 'name-asc' | 'name-desc' | 'account-asc' | 'account-desc';
    sidebarCollapsed: boolean;
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
  'id, nazwa, alternativeNames:alternative_names, swrkIdentifiers:swrk_identifiers, accountNumbers:account_numbers, accountTypes:account_types, bankId:bank_id, apartmentMappings:apartment_mappings, zgnJednostkaId:zgn_jednostka_id, createdAt:created_at';
const ZGN_COLS = 'id, nazwa, email, createdAt:created_at';
const MAILING_POLE_COLS =
  'id, nazwa, tekst, jednostka, typWartosci:typ_wartosci, createdAt:created_at';
const MAILING_SZABLON_COLS =
  'id, nazwa, typ, temat, tresc, attachPdf:attach_pdf, tableFields:table_fields, createdAt:created_at';
const MAILING_HISTORY_COLS =
  'id, typ, templateName:template_name, status, errorMessage:error_message, adresId:adres_id, adresNazwa:adres_nazwa, jednostkaNazwa:jednostka_nazwa, jednostkaEmail:jednostka_email, subject, bodyHtml:body_html, bodyText:body_text, fieldValues:field_values, attachments, sentFrom:sent_from, sentAt:sent_at, spotkanieId:spotkanie_id';
const KONTO_TYP_COLS =
  'id, name, bankAccountSymbol:bank_account_symbol, apartmentPrefix:apartment_prefix, isDefault:is_default, createdAt:created_at';
const HISTORY_COLS =
  'id, fileName:file_name, bankName:bank_name, converterName:converter_name, status, errorMessage:error_message, inputPath:input_path, outputPath:output_path, convertedAt:converted_at, adresId:adres_id, adresNazwa:adres_nazwa, bookedInDom:booked_in_dom, bookedInDomAt:booked_in_dom_at, bookedInDomBy:booked_in_dom_by';
const APP_USER_COLS =
  'id, email, displayName:display_name, firstName:first_name, lastName:last_name, createdAt:created_at';
const SPOTKANIE_TYP_COLS = 'id, nazwa, kolor, opis, createdAt:created_at';
const SPOTKANIE_LOKALIZACJA_COLS = 'id, nazwa, adres, opis, createdAt:created_at';
const SPOTKANIE_COLS =
  'id, nazwa, typId:typ_id, adresId:adres_id, adresNazwa:adres_nazwa, ' +
  'lokalizacjaId:lokalizacja_id, lokalizacjaNazwa:lokalizacja_nazwa, ' +
  'startsAt:starts_at, endsAt:ends_at, opis, uczestnicy, terminStatus:termin_status, ' +
  'terminZmienionyAt:termin_zmieniony_at, terminZmienionyZ:termin_zmieniony_z, ' +
  'terminZmienionyBy:termin_zmieniony_by, ' +
  'terminZmianaOdczytanaAt:termin_zmiana_odczytana_at, ' +
  'terminZmianaOdczytanaBy:termin_zmiana_odczytana_by, ' +
  'dokumentyWyslaneAt:dokumenty_wyslane_at, dokumentyWyslaneBy:dokumenty_wyslane_by, ' +
  'dokumentyOpis:dokumenty_opis, ' +
  'createdBy:created_by, createdAt:created_at, updatedAt:updated_at';
/** Slim projection of a mailing send, as a meeting shows it. */
const SPOTKANIE_MAILING_COLS =
  'id, spotkanieId:spotkanie_id, templateName:template_name, status, ' +
  'errorMessage:error_message, adresNazwa:adres_nazwa, jednostkaNazwa:jednostka_nazwa, ' +
  'jednostkaEmail:jednostka_email, subject, attachments, sentFrom:sent_from, sentAt:sent_at';
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
  private static readonly CACHE_TTL_MS = 60_000;
  private cache: {
    banks?: CacheEntry<Bank[]>;
    kontrahenci?: CacheEntry<Kontrahent[]>;
    adresy?: CacheEntry<Adres[]>;
    kontoTypy?: CacheEntry<KontoTyp[]>;
  } = {};

  private cacheGet<T>(entry: CacheEntry<T> | undefined): T | undefined {
    if (entry && entry.expires > Date.now()) return entry.data;
    return undefined;
  }

  private cacheSet<T>(data: T): CacheEntry<T> {
    return { data, expires: Date.now() + DatabaseService.CACHE_TTL_MS };
  }

  /** Drop cached reference data. Called after every local write so reads re-fetch. */
  private invalidateCache(key: keyof DatabaseService['cache']): void {
    this.cache[key] = undefined;
  }

  constructor() {
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
          darkMode: true,
          language: 'pl',
          aiConfidenceThreshold: 95,
          alwaysUseAI: true,
          skipUserApproval: false,
          contractorSortOrder: 'name-asc',
          sidebarCollapsed: true,
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
    if (error) throw new Error(`updateBank: ${error.message}`);
    this.invalidateCache('banks');
  }

  async deleteBank(id: number): Promise<void> {
    const { error } = await getSupabase().from('banks').delete().eq('id', id);
    if (error) throw new Error(`deleteBank: ${error.message}`);
    this.invalidateCache('banks');
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
    const adres = unwrap(data, error, 'addAdres') as Adres;
    this.invalidateCache('adresy');
    return adres;
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
  }): Promise<void> {
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
    const { error } = await getSupabase().from('history').insert({
      file_name: data.fileName,
      bank_name: data.bankName,
      converter_name: data.converterName,
      status: data.status,
      error_message: data.errorMessage || null,
      input_path: data.inputPath,
      output_path: data.outputPath,
      adres_id: data.adresId ?? null,
      adres_nazwa: adresNazwa,
    });
    if (error) throw new Error(`addConversionHistory: ${error.message}`);
  }

  async getAllHistory(): Promise<ConversionHistory[]> {
    const rows = await fetchAllPaged<any>('getAllHistory', (from, to) =>
      getSupabase()
        .from('history')
        .select(HISTORY_COLS)
        .order('converted_at', { ascending: false })
        .range(from, to),
    );
    return rows.map(h => ({
      ...h,
      errorMessage: h.errorMessage ?? undefined,
      bookedInDom: h.bookedInDom === true,
    })) as ConversionHistory[];
  }

  /**
   * Tick / untick "posted in the DOM program" for whole batches of history rows
   * at once — the Księgowania view marks a single file, a community's month or
   * everything shown, and all three land here.
   */
  async setHistoryBookedInDom(ids: number[], booked: boolean, by?: string | null): Promise<void> {
    if (ids.length === 0) return;
    const patch = booked
      ? { booked_in_dom: true, booked_in_dom_at: new Date().toISOString(), booked_in_dom_by: by ?? null }
      : { booked_in_dom: false, booked_in_dom_at: null, booked_in_dom_by: null };
    for (const slice of DatabaseService.chunk(ids)) {
      const { error } = await getSupabase().from('history').update(patch).in('id', slice);
      if (error) throw new Error(`setHistoryBookedInDom: ${error.message}`);
    }
  }

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
        booked_in_dom: h.bookedInDom === true,
        booked_in_dom_at: h.bookedInDom ? h.bookedInDomAt ?? null : null,
        booked_in_dom_by: h.bookedInDom ? h.bookedInDomBy ?? null : null,
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
  ): Promise<MailingPole> {
    const { data, error } = await getSupabase()
      .from('mailing_pola')
      .insert({
        nazwa: nazwa.trim(),
        tekst,
        jednostka: jednostka.trim(),
        typ_wartosci: typWartosci,
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
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('mailing_pola')
      .update({
        nazwa: nazwa.trim(),
        tekst,
        jednostka: jednostka.trim(),
        typ_wartosci: typWartosci,
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
    });
    if (error) throw new Error(`addMailingHistory: ${error.message}`);
  }

  async getMailingHistory(): Promise<MailingHistoryEntry[]> {
    const rows = await fetchAllPaged<any>('getMailingHistory', (from, to) =>
      getSupabase()
        .from('mailing_history')
        .select(MAILING_HISTORY_COLS)
        .order('sent_at', { ascending: false })
        .range(from, to),
    );
    return rows.map(r => ({
      ...r,
      errorMessage: r.errorMessage ?? undefined,
      adresId: r.adresId ?? null,
      fieldValues: Array.isArray(r.fieldValues) ? r.fieldValues : [],
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
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
      pass: String(raw('smtpPass') || ''),
      fromName: String(raw('smtpFromName') || ''),
      bccSelf: bccSelf === true || bccSelf === 'true',
    };
  }

  /**
   * Persist the SMTP config. `pass` is optional on purpose: the renderer never
   * receives the stored password, so an edit that leaves the field untouched
   * passes `undefined` and must keep what's already there.
   */
  setMailingSmtp(config: MailingSmtpConfig & { pass?: string }): void {
    this.setSetting('smtpHost', config.host.trim());
    this.setSetting('smtpPort', String(config.port));
    this.setSetting('smtpSecure', String(config.secure));
    this.setSetting('smtpUser', config.user.trim());
    this.setSetting('smtpFromName', config.fromName);
    this.setSetting('smtpBccSelf', String(config.bccSelf));
    if (config.pass !== undefined) this.setSetting('smtpPass', config.pass);
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
    const { data, error } = await getSupabase()
      .from('app_users')
      .select(APP_USER_COLS)
      .order('email', { ascending: true });
    if (error) throw new Error(`getAppUsers: ${error.message}`);
    return (data ?? []) as AppUser[];
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

  async getSpotkaniaTypy(): Promise<SpotkanieTyp[]> {
    const { data, error } = await getSupabase()
      .from('spotkania_typy')
      .select(SPOTKANIE_TYP_COLS)
      .order('nazwa', { ascending: true });
    if (error) throw new Error(`getSpotkaniaTypy: ${error.message}`);
    return (data ?? []) as SpotkanieTyp[];
  }

  async addSpotkanieTyp(nazwa: string, kolor: string, opis: string): Promise<SpotkanieTyp> {
    const { data, error } = await getSupabase()
      .from('spotkania_typy')
      .insert({ nazwa: nazwa.trim(), kolor: kolor.trim(), opis })
      .select(SPOTKANIE_TYP_COLS)
      .single();
    return unwrap(data, error, 'addSpotkanieTyp') as SpotkanieTyp;
  }

  async updateSpotkanieTyp(
    id: number,
    nazwa: string,
    kolor: string,
    opis: string,
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('spotkania_typy')
      .update({ nazwa: nazwa.trim(), kolor: kolor.trim(), opis })
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

  /* ---------------------------- Meetings ---------------------------- */

  async getSpotkania(): Promise<Spotkanie[]> {
    const rows = await fetchAllPaged<any>('getSpotkania', (from, to) =>
      getSupabase()
        .from('spotkania')
        .select(SPOTKANIE_COLS)
        .order('starts_at', { ascending: false })
        .range(from, to),
    );
    return rows.map(r => ({
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
      terminZmienionyAt: r.terminZmienionyAt ?? null,
      terminZmienionyZ: r.terminZmienionyZ ?? null,
      terminZmienionyBy: r.terminZmienionyBy ?? null,
      terminZmianaOdczytanaAt: r.terminZmianaOdczytanaAt ?? null,
      terminZmianaOdczytanaBy: r.terminZmianaOdczytanaBy ?? null,
      dokumentyWyslaneAt: r.dokumentyWyslaneAt ?? null,
      dokumentyWyslaneBy: r.dokumentyWyslaneBy ?? null,
      dokumentyOpis: r.dokumentyOpis ?? '',
      createdBy: r.createdBy ?? '',
    })) as Spotkanie[];
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
    };
  }

  async addSpotkanie(input: SpotkanieInput, createdBy: string): Promise<Spotkanie> {
    const { data, error } = await getSupabase()
      .from('spotkania')
      .insert({ ...DatabaseService.spotkaniePayload(input), created_by: createdBy })
      .select(SPOTKANIE_COLS)
      .single();
    // Cast through unknown: SPOTKANIE_COLS is assembled from parts, so
    // postgrest-js cannot infer the row shape from a literal any more.
    return unwrap(data, error, 'addSpotkanie') as unknown as Spotkanie;
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
   */
  async updateSpotkanie(id: number, input: SpotkanieInput, changedBy: string): Promise<void> {
    const { data: before, error: readError } = await getSupabase()
      .from('spotkania')
      .select('starts_at, ends_at')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`updateSpotkanie (odczyt): ${readError.message}`);

    const payload: Record<string, unknown> = {
      ...DatabaseService.spotkaniePayload(input),
      updated_at: new Date().toISOString(),
    };

    if (before) {
      const previous = before as { starts_at: string; ends_at: string | null };
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
    }

    const { error } = await getSupabase().from('spotkania').update(payload).eq('id', id);
    if (error) throw new Error(`updateSpotkanie: ${error.message}`);
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
   * Tick (or untick) "documents sent", with a note of what went out.
   *
   * Unticking clears the note as well: keeping the description of a send that
   * has been withdrawn would leave the meeting claiming something happened.
   */
  async setSpotkanieDokumenty(
    id: number,
    sent: boolean,
    opis: string,
    who: string,
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('spotkania')
      .update(
        sent
          ? {
              dokumenty_wyslane_at: new Date().toISOString(),
              dokumenty_wyslane_by: who,
              dokumenty_opis: opis.trim(),
            }
          : {
              dokumenty_wyslane_at: null,
              dokumenty_wyslane_by: null,
              dokumenty_opis: '',
            },
      )
      .eq('id', id);
    if (error) throw new Error(`setSpotkanieDokumenty: ${error.message}`);
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
    const { error } = await getSupabase().from('spotkania').delete().eq('id', id);
    if (error) throw new Error(`deleteSpotkanie: ${error.message}`);
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

  setSetting(key: string, value: string): void {
    const settings = this.settingsStore.get('settings');
    this.settingsStore.set('settings', { ...settings, [key]: value });
  }

  /**
   * Settings as they may leave this machine — with the SMTP password blanked.
   * Backups are pushed to a remote repository, and a mailbox password has no
   * business travelling with them.
   */
  private settingsForExport(): AppSettings {
    return { ...this.getSettings(), smtpPass: '' };
  }

  exportSettings(): { settings: any } {
    return { settings: this.settingsForExport() };
  }

  importSettings(data: { settings?: any }): void {
    if (data.settings) {
      // Mirror of settingsForExport: an incoming blank password means "not in
      // this file", not "clear mine" — restoring a backup must not log the app
      // out of the mailbox.
      const incoming = { ...data.settings };
      if (!incoming.smtpPass) delete incoming.smtpPass;
      this.settingsStore.set('settings', {
        ...this.settingsStore.get('settings'),
        ...incoming,
      });
    }
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
    const [
      banks,
      kontrahenci,
      adresy,
      kontoTypy,
      history,
      odczytyHistory,
      zgnJednostki,
      mailingPola,
      mailingSzablony,
      mailingHistory,
      spotkaniaTypy,
      spotkania,
      spotkaniaLokalizacje,
      appUsers,
    ] = await Promise.all([
      this.getAllBanks(),
      this.getAllKontrahenci(),
      this.getAllAdresy(),
      this.getKontoTypy(),
      this.getAllHistory(),
      this.getOdczytyHistory(),
      this.getZgnJednostki(),
      this.getMailingPola(),
      this.getMailingSzablony(),
      this.getMailingHistory(),
      this.getSpotkaniaTypy(),
      this.getSpotkania(),
      this.getSpotkaniaLokalizacje(),
      this.getAppUsers(),
    ]);
    return {
      format: 'filefunky-backup',
      formatVersion: 1,
      appVersion,
      createdAt: new Date().toISOString(),
      data: {
        banks,
        kontrahenci,
        adresy,
        kontoTypy,
        history,
        odczytyHistory,
        zgnJednostki,
        mailingPola,
        mailingSzablony,
        mailingHistory,
        spotkaniaTypy,
        spotkania,
        spotkaniaLokalizacje,
        // The `app_users` ROWS are deliberately absent: they mirror the Supabase
        // auth accounts, rebuilt by a trigger, not data this app authors — and
        // the participants stored on each meeting carry their own snapshot. The
        // NAMES are the exception: someone typed them here, nothing can rebuild
        // them, so they travel keyed by mailbox. Accounts nobody has named carry
        // nothing worth restoring, hence the filter.
        appUserNames: appUsers
          .filter(u => (u.firstName ?? '') !== '' || (u.lastName ?? '') !== '')
          .map((u): AppUserName => ({
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
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

  /**
   * Replace all shared data with the backup's contents. Ordered so referential
   * integrity holds at every step: new banks/konto typy are inserted alongside
   * the old ones first (building id maps), adresy are swapped to point at the
   * new ids, and only then are the old bank/typ rows removed. A mid-restore
   * failure can leave duplicates but never loses rows that weren't replaced yet.
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
      mailingPola,
      mailingSzablony,
      mailingHistory,
      spotkaniaTypy,
      spotkania,
      spotkaniaLokalizacje,
      appUserNames,
      settings,
    } = backup.data;

    // Bypass the 60 s cache — the "rows to remove afterwards" list must reflect
    // the live table, including rows another instance wrote moments ago.
    this.invalidateCache('banks');
    this.invalidateCache('kontoTypy');
    const preexistingBankIds = (await this.getAllBanks()).map(b => b.id);
    const preexistingTypIds = (await this.getKontoTypy()).map(t => t.id);
    const preexistingZgnIds = (await this.getZgnJednostki()).map(z => z.id);

    const bankIdMap = await this.insertRemapped(
      'banks',
      'id',
      banks.map(b => b.id),
      banks.map(b => ({
        name: b.name,
        converter_id: b.converterId,
        account_prefixes: b.accountPrefixes ?? [],
        created_at: b.createdAt,
      })),
    );

    const typIdMap = await this.insertRemapped(
      'konto_typy',
      'id',
      kontoTypy.map(t => t.id),
      kontoTypy.map(t => ({
        name: t.name,
        bank_account_symbol: t.bankAccountSymbol,
        apartment_prefix: t.apartmentPrefix,
        is_default: t.isDefault,
        created_at: t.createdAt,
      })),
    );

    // Same alongside-then-swap dance as banks: adresy point at these rows, so
    // the new units must exist before the addresses are written and the old ones
    // can only go once nothing references them. Backups predating the Mailing
    // module carry no units — then the map stays empty and every address lands
    // with a null unit, exactly as it was.
    const zgnIdMap = await this.insertRemapped(
      'zgn_jednostki',
      'id',
      (zgnJednostki ?? []).map(z => z.id),
      (zgnJednostki ?? []).map(z => ({
        nazwa: z.nazwa,
        email: z.email,
        created_at: z.createdAt,
      })),
    );

    await this.deleteAllAdresy();
    await this.insertChunked(
      'adresy',
      adresy.map(a => {
        const accountTypes: Record<string, number> = {};
        for (const [account, typId] of Object.entries(a.accountTypes ?? {})) {
          const mapped = typIdMap.get(typId);
          if (mapped !== undefined) accountTypes[account] = mapped;
        }
        return {
          nazwa: a.nazwa,
          alternative_names: a.alternativeNames ?? [],
          swrk_identifiers: a.swrkIdentifiers ?? [],
          account_numbers: a.accountNumbers ?? [],
          account_types: accountTypes,
          bank_id: a.bankId != null ? bankIdMap.get(a.bankId) ?? null : null,
          apartment_mappings: a.apartmentMappings ?? [],
          zgn_jednostka_id:
            a.zgnJednostkaId != null ? zgnIdMap.get(a.zgnJednostkaId) ?? null : null,
          created_at: a.createdAt,
        };
      }),
    );

    await this.deleteByIds('banks', preexistingBankIds);
    await this.deleteByIds('konto_typy', preexistingTypIds);
    await this.deleteByIds('zgn_jednostki', preexistingZgnIds);

    await this.deleteAllKontrahenci();
    await this.insertChunked(
      'kontrahenci',
      kontrahenci.map(k => {
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

    // The addresses above were re-inserted with fresh ids, so the backup's
    // history rows point at numbers that no longer mean anything. The name is
    // what the Księgowania view actually resolves a community by, so re-point
    // the link through it and leave it null when the community is gone.
    this.invalidateCache('adresy');
    const adresIdByNazwa = new Map(
      (await this.getAllAdresy()).map(a => [a.nazwa.trim().toLowerCase(), a.id] as const),
    );

    await this.clearHistory();
    await this.insertChunked(
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
        adres_id: h.adresNazwa ? adresIdByNazwa.get(h.adresNazwa.trim().toLowerCase()) ?? null : null,
        adres_nazwa: h.adresNazwa ?? null,
        booked_in_dom: h.bookedInDom === true,
        booked_in_dom_at: h.bookedInDom ? h.bookedInDomAt ?? null : null,
        booked_in_dom_by: h.bookedInDom ? h.bookedInDomBy ?? null : null,
      })),
    );

    // Backups written before the meter-readings module carry no such key; leave
    // the existing rows alone rather than wiping them on an old restore.
    if (odczytyHistory) {
      await this.clearOdczytyHistory();
      await this.insertChunked(
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

    // Mailing dictionaries and history: each key is absent in backups written
    // before the module existed, so a missing key leaves the live rows alone
    // instead of wiping them.
    if (mailingPola) {
      const { error } = await getSupabase().from('mailing_pola').delete().gt('id', 0);
      if (error) throw new Error(`restore mailing_pola: ${error.message}`);
      await this.insertChunked(
        'mailing_pola',
        // `jednostka` and `typ_wartosci` default for backups written before
        // those columns existed — both are NOT NULL, so an undefined would fail
        // the whole restore.
        mailingPola.map(p => ({
          nazwa: p.nazwa,
          tekst: p.tekst,
          jednostka: p.jednostka ?? '',
          typ_wartosci: p.typWartosci ?? 'tekst',
          created_at: p.createdAt,
        })),
      );
    }

    if (mailingSzablony) {
      const { error } = await getSupabase().from('mailing_szablony').delete().gt('id', 0);
      if (error) throw new Error(`restore mailing_szablony: ${error.message}`);
      await this.insertChunked(
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

    if (mailingHistory) {
      await this.clearMailingHistory();
      await this.insertChunked(
        'mailing_history',
        mailingHistory.map(h => ({
          typ: h.typ,
          template_name: h.templateName,
          status: h.status,
          error_message: h.errorMessage || null,
          // The addresses were re-inserted with fresh ids and the backup's
          // history rows still carry the old ones; the name is what the history
          // actually displays, so drop the stale link rather than mis-point it.
          adres_id: null,
          // Same for the meeting link, and with no name to re-point it through:
          // the meetings are re-inserted further down with fresh ids, and a
          // mailing row has no natural key back to one. The row keeps every
          // detail of what was sent; only the meeting stops listing it.
          spotkanie_id: null,
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
        })),
      );
    }

    // Kalendarz. Gated on the meetings rather than on the types, because the two
    // keys are written together and the types only exist to be pointed at: a
    // backup with types but no meetings would replace the dictionary out from
    // under live meetings, nulling their type.
    if (spotkania) {
      const preexistingSpotkanieTypIds = (await this.getSpotkaniaTypy()).map(t => t.id);
      const preexistingLokalizacjaIds = (await this.getSpotkaniaLokalizacje()).map(l => l.id);
      // Same alongside-then-swap dance as banks: the new types must exist before
      // the meetings that reference them, and the old ones can only go once
      // nothing points at them any more.
      const spotkanieTypIdMap = await this.insertRemapped(
        'spotkania_typy',
        'id',
        (spotkaniaTypy ?? []).map(t => t.id),
        (spotkaniaTypy ?? []).map(t => ({
          nazwa: t.nazwa,
          kolor: t.kolor,
          opis: t.opis,
          created_at: t.createdAt,
        })),
      );

      // Locations ride the same dance, for the same reason.
      const lokalizacjaIdMap = await this.insertRemapped(
        'spotkania_lokalizacje',
        'id',
        (spotkaniaLokalizacje ?? []).map(l => l.id),
        (spotkaniaLokalizacje ?? []).map(l => ({
          nazwa: l.nazwa,
          adres: l.adres ?? '',
          opis: l.opis ?? '',
          created_at: l.createdAt,
        })),
      );

      const { error: wipeError } = await getSupabase().from('spotkania').delete().gt('id', 0);
      if (wipeError) throw new Error(`restore spotkania: ${wipeError.message}`);
      await this.insertChunked(
        'spotkania',
        spotkania.map(m => ({
          nazwa: m.nazwa,
          typ_id: m.typId != null ? spotkanieTypIdMap.get(m.typId) ?? null : null,
          // The addresses above were re-inserted with fresh ids, so the backup's
          // number means nothing now; the name is what survives a restore, and
          // it is also what the meeting displays.
          adres_id: m.adresNazwa
            ? adresIdByNazwa.get(m.adresNazwa.trim().toLowerCase()) ?? null
            : null,
          adres_nazwa: m.adresNazwa ?? '',
          // Re-pointed through the fresh dictionary ids; the name travels
          // regardless, which is what a meeting actually displays.
          lokalizacja_id:
            m.lokalizacjaId != null ? lokalizacjaIdMap.get(m.lokalizacjaId) ?? null : null,
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
          termin_zmieniony_at: m.terminZmienionyAt ?? null,
          termin_zmieniony_z: m.terminZmienionyZ ?? null,
          termin_zmieniony_by: m.terminZmienionyBy ?? null,
          termin_zmiana_odczytana_at: m.terminZmianaOdczytanaAt ?? null,
          termin_zmiana_odczytana_by: m.terminZmianaOdczytanaBy ?? null,
          dokumenty_wyslane_at: m.dokumentyWyslaneAt ?? null,
          dokumenty_wyslane_by: m.dokumentyWyslaneBy ?? null,
          dokumenty_opis: m.dokumentyOpis ?? '',
          created_by: m.createdBy ?? '',
          created_at: m.createdAt,
          updated_at: m.updatedAt,
        })),
      );

      await this.deleteByIds('spotkania_typy', preexistingSpotkanieTypIds);
      await this.deleteByIds('spotkania_lokalizacje', preexistingLokalizacjaIds);
    }

    // Names of the accounts. Applied one by one rather than wiped-and-inserted:
    // the rows belong to the auth trigger, so a restore can only ever say "this
    // mailbox is called X". A name for an account that no longer exists here
    // simply matches nothing — deliberately not an error, since a backup may
    // predate a person leaving.
    if (appUserNames && appUserNames.length > 0) {
      const idByEmail = new Map(
        (await this.getAppUsers()).map(u => [u.email.trim().toLowerCase(), u.id]),
      );
      for (const person of appUserNames) {
        const id = idByEmail.get(person.email.trim().toLowerCase());
        if (!id) continue;
        await this.setAppUserName(id, person.firstName ?? null, person.lastName ?? null);
      }
    }

    this.importSettings({ settings });

    this.invalidateCache('banks');
    this.invalidateCache('kontrahenci');
    this.invalidateCache('adresy');
    this.invalidateCache('kontoTypy');
  }

  close(): void {
    // Nothing to release; the Supabase client + electron-store don't need explicit closing.
  }
}

export default DatabaseService;
