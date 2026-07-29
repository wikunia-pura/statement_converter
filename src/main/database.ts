import Store from 'electron-store';
import path from 'path';
import { app } from 'electron';
import { Bank, ConversionHistory, AppSettings, Kontrahent, Adres, KontrahentTyp, ApartmentMapping, KontoTyp, BackupData } from '../shared/types';
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
    skipUserApproval: boolean;
    contractorSortOrder: 'name-asc' | 'name-desc' | 'account-asc' | 'account-desc';
    sidebarCollapsed: boolean;
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
  'id, nazwa, alternativeNames:alternative_names, swrkIdentifiers:swrk_identifiers, accountNumbers:account_numbers, accountTypes:account_types, bankId:bank_id, apartmentMappings:apartment_mappings, createdAt:created_at';
const KONTO_TYP_COLS =
  'id, name, bankAccountSymbol:bank_account_symbol, apartmentPrefix:apartment_prefix, isDefault:is_default, createdAt:created_at';
const HISTORY_COLS =
  'id, fileName:file_name, bankName:bank_name, converterName:converter_name, status, errorMessage:error_message, inputPath:input_path, outputPath:output_path, convertedAt:converted_at';

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
          skipUserApproval: false,
          contractorSortOrder: 'name-asc',
          sidebarCollapsed: true,
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
  ): Promise<void> {
    const patch: Record<string, unknown> = { nazwa };
    if (alternativeNames !== undefined) patch.alternative_names = alternativeNames;
    if (swrkIdentifiers !== undefined) patch.swrk_identifiers = swrkIdentifiers;
    if (bankId !== undefined) patch.bank_id = bankId;
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

  exportSettings(): { settings: any } {
    return { settings: this.settingsStore.get('settings') };
  }

  importSettings(data: { settings?: any }): void {
    if (data.settings) {
      this.settingsStore.set('settings', {
        ...this.settingsStore.get('settings'),
        ...data.settings,
      });
    }
  }

  // ------------------------------ Backup ------------------------------
  // Full snapshot of the shared Supabase data + this machine's settings.
  // Restore replaces the cloud data wholesale; because every install shares
  // one Supabase project, restoring affects all users — the UI double-confirms.

  async exportFullBackup(appVersion: string): Promise<BackupData> {
    const [banks, kontrahenci, adresy, kontoTypy, history] = await Promise.all([
      this.getAllBanks(),
      this.getAllKontrahenci(),
      this.getAllAdresy(),
      this.getKontoTypy(),
      this.getAllHistory(),
    ]);
    return {
      format: 'filefunky-backup',
      formatVersion: 1,
      appVersion,
      createdAt: new Date().toISOString(),
      data: { banks, kontrahenci, adresy, kontoTypy, history, settings: this.getSettings() },
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
    const { banks, kontrahenci, adresy, kontoTypy, history, settings } = backup.data;

    // Bypass the 60 s cache — the "rows to remove afterwards" list must reflect
    // the live table, including rows another instance wrote moments ago.
    this.invalidateCache('banks');
    this.invalidateCache('kontoTypy');
    const preexistingBankIds = (await this.getAllBanks()).map(b => b.id);
    const preexistingTypIds = (await this.getKontoTypy()).map(t => t.id);

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
          created_at: a.createdAt,
        };
      }),
    );

    await this.deleteByIds('banks', preexistingBankIds);
    await this.deleteByIds('konto_typy', preexistingTypIds);

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
