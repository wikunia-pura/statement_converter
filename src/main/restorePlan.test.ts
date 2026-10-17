/**
 * The restore plan (DatabaseService.planRestore): which tables a backup
 * writes, with which ids and links. The SQL that applies it is
 * supabase/restore-transakcja.sql.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0' },
  safeStorage: { isEncryptionAvailable: () => false },
}));
vi.mock('electron-store', () => ({ default: class { get() { return undefined; } set() {} } }));
vi.mock('electron-log', () => ({ default: { info() {}, warn() {}, error() {}, debug() {} } }));

import DatabaseService, { RestoreLookups, RestorePlan } from './database';
import type { BackupData } from '../shared/types';

const T = '2026-01-01T00:00:00.000Z';
const NO_LOOKUPS: RestoreLookups = { now: T, sprawozdania: null, szablonIdByNazwa: null };

function backup(data: Record<string, unknown>): BackupData {
  return {
    format: 'filefunky-backup',
    formatVersion: 1,
    appVersion: '11.0.0',
    createdAt: T,
    data: { banks: [], kontrahenci: [], adresy: [], kontoTypy: [], history: [], settings: {}, ...data },
  } as unknown as BackupData;
}

const rows = (plan: RestorePlan, tabela: string) => plan.tables.find((t) => t.tabela === tabela)?.wiersze;
const tablesOf = (plan: RestorePlan) => plan.tables.map((t) => t.tabela).sort();

const adres = (id: number, nazwa: string, extra: Record<string, unknown> = {}) => ({ id, nazwa, createdAt: T, ...extra });
const statement = (nrWsp: number, rok: number) => ({
  nrWsp,
  nazwa: `Wsp ${nrWsp}`,
  okresOd: `${rok}-01-01`,
  okresDo: `${rok}-12-31`,
  sekcje: [],
});

describe('planRestore', () => {
  it('keeps the backup ids and links rows to communities by name', () => {
    const plan = DatabaseService.planRestore(
      backup({
        banks: [{ id: 4, name: 'PKO', converterId: 'pko_mt940', createdAt: T }],
        adresy: [adres(11, 'Lipowa 1', { bankId: 4 }), adres(12, 'Brzozowa 2', { bankId: 99 })],
        history: [
          { id: 7, fileName: 'a', bankName: 'PKO', converterName: 'x', status: 'success', inputPath: '/', outputPath: '/', convertedAt: T, adresNazwa: ' lipowa 1 ' },
          { id: 8, fileName: 'b', bankName: 'PKO', converterName: 'x', status: 'success', inputPath: '/', outputPath: '/', convertedAt: T, adresNazwa: 'Nie ma takiej' },
        ],
      }),
      NO_LOOKUPS,
    );
    expect(rows(plan, 'banks')!.map((r) => r.id)).toEqual([4]);
    expect(rows(plan, 'adresy')!.map((r) => [r.id, r.bank_id])).toEqual([
      [11, 4],
      // A bank the backup does not carry is no link.
      [12, null],
    ]);
    expect(rows(plan, 'history')!.map((r) => [r.id, r.adres_id])).toEqual([
      [7, 11],
      [8, null],
    ]);
    // Sections the backup does not have are not in the plan, so their tables are left alone.
    expect(tablesOf(plan)).toEqual(['adresy', 'banks', 'history', 'konto_typy', 'kontrahenci']);
    expect(plan.bezUsuwania).toEqual([]);
  });

  it('writes a unique name the backup holds twice once, and links follow the row kept', () => {
    const plan = DatabaseService.planRestore(
      backup({
        banks: [
          { id: 1, name: 'PKO', converterId: 'a', createdAt: T },
          { id: 2, name: ' pko ', converterId: 'b', createdAt: T },
        ],
        adresy: [adres(5, 'Lipowa 1', { bankId: 2 }), adres(6, 'LIPOWA 1', { bankId: 1 })],
        ksiegowaniaPliki: [
          { id: 1, monthKey: '2026-09', kind: 'statement', status: 'ok', adresNazwa: 'Lipowa 1', bankId: 2, relPath: 'a', fileName: 'a', fileMtime: T, fileHash: 'h', scannedAt: T },
        ],
      }),
      NO_LOOKUPS,
    );
    expect(rows(plan, 'banks')!.map((r) => r.id)).toEqual([1]);
    expect(rows(plan, 'adresy')!.map((r) => [r.id, r.bank_id])).toEqual([[5, 1]]);
    expect(rows(plan, 'ksiegowania_pliki')!.map((r) => [r.adres_id, r.bank_id])).toEqual([[5, 1]]);
  });

  it('drops a link the backup cannot back, and gives a meeting one entry at most', () => {
    const zadanie = { id: 3, tytul: 'x', status: 'todo', spotkanieId: 40, createdAt: T, updatedAt: T };
    const withoutMeetings = DatabaseService.planRestore(backup({ zadania: [zadanie] }), NO_LOOKUPS);
    expect(rows(withoutMeetings, 'zadania')![0].spotkanie_id).toBeNull();

    const plan = DatabaseService.planRestore(
      backup({
        spotkania: [{ id: 40, nazwa: 'Zebranie', startsAt: T, typId: 9, lokalizacjaId: 9, zgnJednostkaId: 9, createdAt: T, updatedAt: T }],
        zadania: [zadanie],
        zebrania: [
          { id: 1, spotkanieId: 40, nazwa: 'A', createdAt: T, wersje: [] },
          { id: 2, spotkanieId: 40, nazwa: 'B', createdAt: T, wersje: [] },
        ],
      }),
      NO_LOOKUPS,
    );
    expect(rows(plan, 'zadania')![0].spotkanie_id).toBe(40);
    expect(rows(plan, 'zebrania')!.map((r) => r.spotkanie_id)).toEqual([40, null]);
    // Kinds, places and units the backup does not carry: no link, and their tables untouched.
    expect(rows(plan, 'spotkania')![0]).toMatchObject({ typ_id: null, lokalizacja_id: null, zgn_jednostka_id: null });
    expect(tablesOf(plan)).not.toContain('spotkania_typy');
    expect(tablesOf(plan)).not.toContain('spotkania_lokalizacje');
  });

  it('moves meeting kinds and places only with the meetings', () => {
    const kinds = { spotkaniaTypy: [{ id: 1, nazwa: 'Zebranie', kolor: '#000000', opis: '', createdAt: T }] };
    expect(tablesOf(DatabaseService.planRestore(backup(kinds), NO_LOOKUPS))).not.toContain('spotkania_typy');
    expect(tablesOf(DatabaseService.planRestore(backup({ ...kinds, spotkania: [] }), NO_LOOKUPS))).toContain(
      'spotkania_typy',
    );
  });

  it('leaves the community link to city units alone when the backup has none', () => {
    const without = DatabaseService.planRestore(backup({ adresy: [adres(1, 'A', { zgnJednostkaId: 3 })] }), NO_LOOKUPS);
    expect(rows(without, 'adresy')![0]).not.toHaveProperty('zgn_jednostka_id');
    const withUnits = DatabaseService.planRestore(
      backup({ adresy: [adres(1, 'A', { zgnJednostkaId: 3 })], zgnJednostki: [{ id: 3, nazwa: 'ZGN', email: 'z@x.pl', createdAt: T }] }),
      NO_LOOKUPS,
    );
    expect(rows(withUnits, 'adresy')![0].zgn_jednostka_id).toBe(3);
  });

  it('links a version to its library statement, and brings back one only its copy has', () => {
    const kopia = (s: ReturnType<typeof statement>, sprawozdanieId?: number) => ({ dane: s, plikNazwa: 'p.pdf', sprawozdanieId, dodano: T, dodal: '' });
    const plan = DatabaseService.planRestore(
      backup({
        zebraniaSprawozdania: [{ id: 30, ...statement(1, 2025), dane: statement(1, 2025), plikNazwa: 'a.pdf', importedAt: T }],
        zebrania: [
          {
            id: 1,
            nazwa: 'Z',
            createdAt: T,
            wersje: [
              { id: 10, major: 1, minor: 0, createdAt: T, materialy: [], sprawozdanie: kopia(statement(1, 2025), 55) },
              // Only in the copy: back under its own id.
              { id: 11, major: 1, minor: 1, createdAt: T, materialy: [], sprawozdanie: kopia(statement(2, 2025), 31) },
              // Only in the copy, its id taken by another library row: a new one.
              { id: 12, major: 1, minor: 2, createdAt: T, materialy: [], sprawozdanie: kopia(statement(3, 2025), 30) },
            ],
          },
        ],
      }),
      NO_LOOKUPS,
    );
    expect(rows(plan, 'zebrania_wersje')!.map((r) => [r.id, r.sprawozdanie_id])).toEqual([
      [10, 30],
      [11, 31],
      [12, 32],
    ]);
    expect(rows(plan, 'zebrania_sprawozdania')!.map((r) => [r.id, r.nr_wsp])).toEqual([
      [30, 1],
      [31, 2],
      [32, 3],
    ]);
    expect(plan.bezUsuwania).toEqual([]);
  });

  it('adds to the live library, without replacing it, for a backup that has none of its own', () => {
    const plan = DatabaseService.planRestore(
      backup({
        zebrania: [
          {
            id: 1,
            nazwa: 'Z',
            createdAt: T,
            wersje: [
              { id: 10, major: 1, minor: 0, createdAt: T, materialy: [], sprawozdanie: { dane: statement(1, 2025), plikNazwa: '' } },
              { id: 11, major: 1, minor: 1, createdAt: T, materialy: [], sprawozdanie: { dane: statement(2, 2025), plikNazwa: '' } },
            ],
          },
        ],
      }),
      { now: T, szablonIdByNazwa: null, sprawozdania: { idByKey: new Map([['1|2025-01-01|2025-12-31', 400]]), maxId: 400 } },
    );
    expect(rows(plan, 'zebrania_wersje')!.map((r) => r.sprawozdanie_id)).toEqual([400, 401]);
    expect(rows(plan, 'zebrania_sprawozdania')!.map((r) => r.id)).toEqual([401]);
    expect(plan.bezUsuwania).toEqual(['zebrania_sprawozdania']);
  });

  it('gives every row of a table the same columns (a bulk insert would null a missing one)', () => {
    const plan = DatabaseService.planRestore(
      backup({
        banks: [{ id: 1, name: 'PKO', converterId: 'a', createdAt: T }],
        kontoTypy: [
          { id: 1, name: 'E', bankAccountSymbol: '131-1', apartmentPrefix: '204', isDefault: true, createdAt: T },
          { id: 2, name: 'F', bankAccountSymbol: '131-2', apartmentPrefix: '205', isDefault: true, createdAt: T },
        ],
        ksiegowaniaKonwersje: [
          { id: 1, fileName: 'a', bankName: 'b', converterName: 'c', status: 'success', inputPath: '/', outputPath: '/', convertedAt: T, manual: true },
          { id: 2, fileName: 'a', bankName: 'b', converterName: 'c', status: 'success', inputPath: '/', outputPath: '/', convertedAt: T },
        ],
        appUserNames: [
          { email: 'Anna@X.pl', firstName: ' Anna ', lastName: '', color: '#ABCDEF' },
          { email: 'jan@x.pl', firstName: 'Jan', lastName: null },
        ],
        zebraniaUstawienia: null,
      }),
      NO_LOOKUPS,
    );
    for (const { tabela, wiersze } of plan.tables) {
      if (tabela === 'app_users') continue;
      const shapes = new Set(wiersze.map((w) => Object.keys(w).sort().join(',')));
      expect(shapes.size, tabela).toBeLessThanOrEqual(1);
    }
    // One default only — the backup's first.
    expect(rows(plan, 'konto_typy')!.map((r) => r.is_default)).toEqual([true, false]);
    expect(rows(plan, 'ksiegowania_konwersje')!.map((r) => r.recznie)).toEqual([true, false]);
    // Names only; the colour only where the backup has one.
    expect(rows(plan, 'app_users')).toEqual([
      { email: 'anna@x.pl', first_name: 'Anna', last_name: null, color: '#abcdef' },
      { email: 'jan@x.pl', first_name: 'Jan', last_name: null },
    ]);
    // A section the backup carries as "none" empties its table.
    expect(rows(plan, 'zebrania_ustawienia')).toEqual([]);
  });

  it('gives a row an old backup wrote without an id the next one free', () => {
    const plan = DatabaseService.planRestore(
      backup({ kontrahenci: [{ id: 5, nazwa: 'A', kontoKontrahenta: '1' }, { nazwa: 'B', kontoKontrahenta: '2' }] }),
      NO_LOOKUPS,
    );
    expect(rows(plan, 'kontrahenci')!.map((r) => r.id)).toEqual([5, 6]);
  });
});
