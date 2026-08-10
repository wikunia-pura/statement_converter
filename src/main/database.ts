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
  MailingSzablon,
  MailingHistoryEntry,
  MailingSmtpConfig,
} from '../shared/types';
import { getSupabase } from './supabaseClient';
import { normalizeAccount } from '../shared/account-extractor';

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
const MAILING_POLE_COLS = 'id, nazwa, tekst, createdAt:created_at';
const MAILING_SZABLON_COLS =
  'id, nazwa, typ, temat, tresc, attachPdf:attach_pdf, tableFields:table_fields, createdAt:created_at';
const MAILING_HISTORY_COLS =
  'id, typ, templateName:template_name, status, errorMessage:error_message, adresId:adres_id, adresNazwa:adres_nazwa, jednostkaNazwa:jednostka_nazwa, jednostkaEmail:jednostka_email, subject, bodyHtml:body_html, bodyText:body_text, fieldValues:field_values, attachments, sentFrom:sent_from, sentAt:sent_at';
const KONTO_TYP_COLS =
  'id, name, bankAccountSymbol:bank_account_symbol, apartmentPrefix:apartment_prefix, isDefault:is_default, createdAt:created_at';
const HISTORY_COLS =
  'id, fileName:file_name, bankName:bank_name, converterName:converter_name, status, errorMessage:error_message, inputPath:input_path, outputPath:output_path, convertedAt:converted_at';
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
   * fields. A mapping needs both matchText and apartmentNumber to be usable.
   */
  private sanitizeApartmentMappings(raw: ApartmentMapping[] | undefined): ApartmentMapping[] {
    if (!raw || raw.length === 0) return [];
    const out: ApartmentMapping[] = [];
    const seen = new Set<string>();
    for (const m of raw) {
      const matchText = (m.matchText ?? '').trim();
      const apartmentNumber = (m.apartmentNumber ?? '').trim();
      if (!matchText || !apartmentNumber) continue;
      // Guard against duplicate phrases (case-insensitive) within one address.
      const key = matchText.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: m.id || `${Date.now()}-${out.length}`,
        matchText,
        apartmentNumber,
        ...(m.note && m.note.trim() ? { note: m.note.trim() } : {}),
      });
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
  }): Promise<void> {
    const { error } = await getSupabase().from('history').insert({
      file_name: data.fileName,
      bank_name: data.bankName,
      converter_name: data.converterName,
      status: data.status,
      error_message: data.errorMessage || null,
      input_path: data.inputPath,
      output_path: data.outputPath,
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
    return rows.map(h => ({ ...h, errorMessage: h.errorMessage ?? undefined })) as ConversionHistory[];
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

  async addMailingPole(nazwa: string, tekst: string): Promise<MailingPole> {
    const { data, error } = await getSupabase()
      .from('mailing_pola')
      .insert({ nazwa: nazwa.trim(), tekst })
      .select(MAILING_POLE_COLS)
      .single();
    return unwrap(data, error, 'addMailingPole') as MailingPole;
  }

  async updateMailingPole(id: number, nazwa: string, tekst: string): Promise<void> {
    const { error } = await getSupabase()
      .from('mailing_pola')
      .update({ nazwa: nazwa.trim(), tekst })
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
        mailingPola.map(p => ({ nazwa: p.nazwa, tekst: p.tekst, created_at: p.createdAt })),
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
