import Store from 'electron-store';
import path from 'path';
import { app } from 'electron';
import { Bank, ConversionHistory, AppSettings, Kontrahent, Adres, KontrahentTyp } from '../shared/types';
import { getSupabase } from './supabaseClient';

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
  };
}

const BANK_COLS = 'id, name, converterId:converter_id, accountPrefixes:account_prefixes, createdAt:created_at';
const KONTRAHENT_COLS =
  'id, nazwa, kontoKontrahenta:konto_kontrahenta, nip, typ, alternativeNames:alternative_names, createdAt:created_at';
const ADRES_COLS =
  'id, nazwa, alternativeNames:alternative_names, swrkIdentifiers:swrk_identifiers, bankId:bank_id, createdAt:created_at';
const HISTORY_COLS =
  'id, fileName:file_name, bankName:bank_name, converterName:converter_name, status, errorMessage:error_message, inputPath:input_path, outputPath:output_path, convertedAt:converted_at';

function unwrap<T>(data: T | null, error: { message: string } | null, context: string): T {
  if (error) throw new Error(`${context}: ${error.message}`);
  if (data === null) throw new Error(`${context}: no data returned`);
  return data;
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
        },
      },
    });
  }

  // ------------------------------ Banks ------------------------------

  async getAllBanks(): Promise<Bank[]> {
    const { data, error } = await getSupabase()
      .from('banks')
      .select(BANK_COLS)
      .order('name', { ascending: true });
    const rows = unwrap(data, error, 'getAllBanks');
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
    const { data, error } = await getSupabase()
      .from('kontrahenci')
      .select(KONTRAHENT_COLS)
      .order('nazwa', { ascending: true });
    const rows = unwrap(data, error, 'getAllKontrahenci');
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
    const { data, error } = await getSupabase()
      .from('adresy')
      .select(ADRES_COLS)
      .order('nazwa', { ascending: true });
    const rows = unwrap(data, error, 'getAllAdresy');
    return rows.map(a => ({
      ...a,
      alternativeNames: a.alternativeNames ?? [],
      swrkIdentifiers: a.swrkIdentifiers ?? [],
      bankId: a.bankId ?? null,
    })) as Adres[];
  }

  async addAdres(
    nazwa: string,
    alternativeNames?: string[],
    swrkIdentifiers?: string[],
    bankId?: number | null,
  ): Promise<Adres> {
    const { data, error } = await getSupabase()
      .from('adresy')
      .insert({
        nazwa,
        alternative_names: alternativeNames ?? [],
        swrk_identifiers: swrkIdentifiers ?? [],
        bank_id: bankId ?? null,
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
  ): Promise<void> {
    const patch: Record<string, unknown> = { nazwa };
    if (alternativeNames !== undefined) patch.alternative_names = alternativeNames;
    if (swrkIdentifiers !== undefined) patch.swrk_identifiers = swrkIdentifiers;
    if (bankId !== undefined) patch.bank_id = bankId;
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
      bank_id: a.bankId ?? null,
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
    const { data, error } = await getSupabase()
      .from('history')
      .select(HISTORY_COLS)
      .order('converted_at', { ascending: false });
    const rows = unwrap(data, error, 'getAllHistory');
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
