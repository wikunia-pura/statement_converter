import Store from 'electron-store';
import { Bank, Kontrahent, Adres, ConversionHistory } from '../shared/types';
import DatabaseService from './database';

// Reads the legacy electron-store (config.json) where Banks/Kontrahenci/Adresy/History
// lived before the Supabase migration, and pushes them up to the cloud.
//
// Idempotent: once `migration_done` is set true, the importer is a no-op.

interface LegacyStoreSchema {
  banks?: Bank[];
  kontrahenci?: Kontrahent[];
  adresy?: Adres[];
  history?: ConversionHistory[];
  migration_done?: boolean;
}

function getLegacyStore(): Store<LegacyStoreSchema> {
  return new Store<LegacyStoreSchema>({ defaults: {} });
}

export interface MigrationStatus {
  hasLocalData: boolean;
  migrated: boolean;
  counts: { banks: number; kontrahenci: number; adresy: number; history: number };
}

export function getMigrationStatus(): MigrationStatus {
  const store = getLegacyStore();
  const counts = {
    banks: (store.get('banks') ?? []).length,
    kontrahenci: (store.get('kontrahenci') ?? []).length,
    adresy: (store.get('adresy') ?? []).length,
    history: (store.get('history') ?? []).length,
  };
  const hasLocalData =
    counts.banks + counts.kontrahenci + counts.adresy + counts.history > 0;
  return { hasLocalData, migrated: store.get('migration_done') === true, counts };
}

export async function runMigration(
  database: DatabaseService,
): Promise<
  | { ok: true; counts: { banks: number; kontrahenci: number; adresy: number; history: number } }
  | { ok: false; error: string }
> {
  const store = getLegacyStore();
  if (store.get('migration_done') === true) {
    return { ok: true, counts: { banks: 0, kontrahenci: 0, adresy: 0, history: 0 } };
  }

  const banks = store.get('banks') ?? [];
  const kontrahenci = store.get('kontrahenci') ?? [];
  const adresy = store.get('adresy') ?? [];
  const history = store.get('history') ?? [];

  try {
    await database.importBanks(banks);
    await database.importKontrahenci(kontrahenci);
    await database.importAdresy(adresy);
    await database.importHistory(history);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }

  store.set('migration_done', true);
  return {
    ok: true,
    counts: {
      banks: banks.length,
      kontrahenci: kontrahenci.length,
      adresy: adresy.length,
      history: history.length,
    },
  };
}
