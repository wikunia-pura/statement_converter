import Store from 'electron-store';
import path from 'path';
import { app } from 'electron';
import { Bank, ConversionHistory, AppSettings, Kontrahent, Adres, KontrahentTyp, ApartmentMapping } from '../shared/types';
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
  };
}

const BANK_COLS = 'id, name, converterId:converter_id, accountPrefixes:account_prefixes, createdAt:created_at';
const KONTRAHENT_COLS =
  'id, nazwa, kontoKontrahenta:konto_kontrahenta, nip, typ, alternativeNames:alternative_names, createdAt:created_at';
const ADRES_COLS =
  'id, nazwa, alternativeNames:alternative_names, swrkIdentifiers:swrk_identifiers, accountNumbers:account_numbers, bankId:bank_id, apartmentMappings:apartment_mappings, createdAt:created_at';
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

class DatabaseService {
  private settingsStore: Store<SettingsStoreSchema>;

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
        },
      },
    });
  }

  // ------------------------------ Banks ------------------------------

  async getAllBanks(): Promise<Bank[]> {
    const rows = await fetchAllPaged<any>('getAllBanks', (from, to) =>
      getSupabase()
        .from('banks')
        .select(BANK_COLS)
        .order('name', { ascending: true })
        .range(from, to),
    );
    return rows.map(b => ({ ...b, accountPrefixes: b.accountPrefixes ?? [] })) as Bank[];
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
    return unwrap(data, error, 'addBank') as Bank;
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
  }

  async deleteBank(id: number): Promise<void> {
    const { error } = await getSupabase().from('banks').delete().eq('id', id);
    if (error) throw new Error(`deleteBank: ${error.message}`);
  }

  async deleteAllBanks(): Promise<void> {
    const { error } = await getSupabase().from('banks').delete().gt('id', 0);
    if (error) throw new Error(`deleteAllBanks: ${error.message}`);
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

  async importBanks(banks: Bank[]): Promise<void> {
    if (banks.length === 0) return;
    // Strip ids; let Postgres assign fresh ones (avoids collisions with rows already in the cloud).
    const payload = banks.map(b => ({
      name: b.name,
      converter_id: b.converterId,
      account_prefixes: b.accountPrefixes ?? [],
    }));
    const { error } = await getSupabase().from('banks').insert(payload);
    if (error) throw new Error(`importBanks: ${error.message}`);
  }

  // ---------------------------- Kontrahenci ----------------------------

  async getAllKontrahenci(): Promise<Kontrahent[]> {
    const rows = await fetchAllPaged<any>('getAllKontrahenci', (from, to) =>
      getSupabase()
        .from('kontrahenci')
        .select(KONTRAHENT_COLS)
        .order('nazwa', { ascending: true })
        .range(from, to),
    );
    return rows.map(k => ({
      ...k,
      typ: (k.typ as KontrahentTyp) || 'Kontrahent',
      alternativeNames: k.alternativeNames ?? [],
      nip: k.nip ?? undefined,
    })) as Kontrahent[];
  }

  async addKontrahent(
    nazwa: string,
    kontoKontrahenta: string,
    nip?: string,
    alternativeNames?: string[],
    typ?: KontrahentTyp,
  ): Promise<Kontrahent> {
    const { data, error } = await getSupabase()
      .from('kontrahenci')
      .insert({
        nazwa,
        konto_kontrahenta: kontoKontrahenta,
        nip: nip || null,
        typ: typ || 'Kontrahent',
        alternative_names: alternativeNames ?? [],
      })
      .select(KONTRAHENT_COLS)
      .single();
    const row = unwrap(data, error, 'addKontrahent') as Kontrahent;
    return { ...row, nip: row.nip ?? undefined };
  }

  async updateKontrahent(
    id: number,
    nazwa: string,
    kontoKontrahenta: string,
    nip?: string,
    alternativeNames?: string[],
    typ?: KontrahentTyp,
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      nazwa,
      konto_kontrahenta: kontoKontrahenta,
    };
    if (nip !== undefined) patch.nip = nip || null;
    if (typ !== undefined) patch.typ = typ;
    if (alternativeNames !== undefined) patch.alternative_names = alternativeNames;
    const { error } = await getSupabase().from('kontrahenci').update(patch).eq('id', id);
    if (error) throw new Error(`updateKontrahent: ${error.message}`);
  }

  async deleteKontrahent(id: number): Promise<void> {
    const { error } = await getSupabase().from('kontrahenci').delete().eq('id', id);
    if (error) throw new Error(`deleteKontrahent: ${error.message}`);
  }

  async deleteAllKontrahenci(): Promise<void> {
    const { error } = await getSupabase().from('kontrahenci').delete().gt('id', 0);
    if (error) throw new Error(`deleteAllKontrahenci: ${error.message}`);
  }

  async getKontrahentById(id: number): Promise<Kontrahent | undefined> {
    const { data, error } = await getSupabase()
      .from('kontrahenci')
      .select(KONTRAHENT_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getKontrahentById: ${error.message}`);
    if (!data) return undefined;
    return { ...(data as Kontrahent), nip: (data as Kontrahent).nip ?? undefined };
  }

  async importKontrahenci(kontrahenci: Kontrahent[]): Promise<void> {
    if (kontrahenci.length === 0) return;
    const payload = kontrahenci.map(k => ({
      nazwa: k.nazwa,
      konto_kontrahenta: k.kontoKontrahenta,
      nip: k.nip || null,
      typ: k.typ || 'Kontrahent',
      alternative_names: k.alternativeNames ?? [],
    }));
    const { error } = await getSupabase().from('kontrahenci').insert(payload);
    if (error) throw new Error(`importKontrahenci: ${error.message}`);
  }

  // ------------------------------ Adresy ------------------------------

  async getAllAdresy(): Promise<Adres[]> {
    const rows = await fetchAllPaged<any>('getAllAdresy', (from, to) =>
      getSupabase()
        .from('adresy')
        .select(ADRES_COLS)
        .order('nazwa', { ascending: true })
        .range(from, to),
    );
    return rows.map(a => ({
      ...a,
      alternativeNames: a.alternativeNames ?? [],
      swrkIdentifiers: a.swrkIdentifiers ?? [],
      accountNumbers: a.accountNumbers ?? [],
      bankId: a.bankId ?? null,
      apartmentMappings: a.apartmentMappings ?? [],
    })) as Adres[];
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

  async addAdres(
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
    accountNumbers?: string[],
    apartmentMappings?: ApartmentMapping[],
  ): Promise<Adres> {
    const accounts = await this.sanitizeAccountNumbers(accountNumbers);
    const { data, error } = await getSupabase()
      .from('adresy')
      .insert({
        nazwa,
        alternative_names: alternativeNames ?? [],
        swrk_identifiers: swrkIdentifiers ?? [],
        account_numbers: accounts,
        bank_id: bankId ?? null,
        apartment_mappings: this.sanitizeApartmentMappings(apartmentMappings),
      })
      .select(ADRES_COLS)
      .single();
    return unwrap(data, error, 'addAdres') as Adres;
  }

  async updateAdres(
    id: number,
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
    accountNumbers?: string[],
    apartmentMappings?: ApartmentMapping[],
  ): Promise<void> {
    const patch: Record<string, unknown> = { nazwa };
    if (alternativeNames !== undefined) patch.alternative_names = alternativeNames;
    if (swrkIdentifiers !== undefined) patch.swrk_identifiers = swrkIdentifiers;
    if (bankId !== undefined) patch.bank_id = bankId;
    if (accountNumbers !== undefined) {
      patch.account_numbers = await this.sanitizeAccountNumbers(accountNumbers, id);
    }
    if (apartmentMappings !== undefined) {
      patch.apartment_mappings = this.sanitizeApartmentMappings(apartmentMappings);
    }
    const { error } = await getSupabase().from('adresy').update(patch).eq('id', id);
    if (error) throw new Error(`updateAdres: ${error.message}`);
  }

  async deleteAdres(id: number): Promise<void> {
    const { error } = await getSupabase().from('adresy').delete().eq('id', id);
    if (error) throw new Error(`deleteAdres: ${error.message}`);
  }

  async deleteAllAdresy(): Promise<void> {
    const { error } = await getSupabase().from('adresy').delete().gt('id', 0);
    if (error) throw new Error(`deleteAllAdresy: ${error.message}`);
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

  async importAdresy(adresy: Adres[]): Promise<void> {
    if (adresy.length === 0) return;
    const payload = adresy.map(a => ({
      nazwa: a.nazwa,
      alternative_names: a.alternativeNames ?? [],
      swrk_identifiers: a.swrkIdentifiers ?? [],
      account_numbers: (a.accountNumbers ?? [])
        .map(normalizeAccount)
        .filter((x): x is string => !!x),
      bank_id: a.bankId ?? null,
      apartment_mappings: this.sanitizeApartmentMappings(a.apartmentMappings),
    }));
    const { error } = await getSupabase().from('adresy').insert(payload);
    if (error) throw new Error(`importAdresy: ${error.message}`);
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

  // Bulk import history (used by the local→cloud migrator).
  async importHistory(history: ConversionHistory[]): Promise<void> {
    if (history.length === 0) return;
    const payload = history.map(h => ({
      file_name: h.fileName,
      bank_name: h.bankName,
      converter_name: h.converterName,
      status: h.status,
      error_message: h.errorMessage || null,
      input_path: h.inputPath,
      output_path: h.outputPath,
      converted_at: h.convertedAt,
    }));
    const { error } = await getSupabase().from('history').insert(payload);
    if (error) throw new Error(`importHistory: ${error.message}`);
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

  close(): void {
    // Nothing to release; the Supabase client + electron-store don't need explicit closing.
  }
}

export default DatabaseService;
