/**
 * "Zebrania" — the pure logic behind the module: version numbers, the status a
 * meeting and its materials share, and where an entry's data comes from.
 *
 * Shared by the main process (which keeps the meeting and the newest version in
 * step) and the renderer (which shows both), so the two can never map a status
 * differently.
 */

import {
  DEFAULT_MAILING_ADRESACI,
  MailingAdresaci,
  MailingSzablon,
  MailingTyp,
  Spotkanie,
  SpotkanieLokalizacja,
  SpotkanieMaterialyStatus,
  Zebranie,
  ZebranieMaterial,
  ZebranieStatus,
  ZebranieWersja,
} from './types';

/* ------------------------------ Version numbers ----------------------------- */

/** The longest revision name kept — a label on a tab, not a description. */
export const ZEBRANIE_WERSJA_NAZWA_MAX = 80;

/** "1.0", "1.1" … */
export function wersjaLabel(wersja: Pick<ZebranieWersja, 'major' | 'minor'>): string {
  return `${wersja.major}.${wersja.minor}`;
}

/** Oldest first — the order the module lists them in, and the order `wersje` is kept in. */
export function sortWersje(wersje: ZebranieWersja[]): ZebranieWersja[] {
  return [...wersje].sort((a, b) => a.major - b.major || a.minor - b.minor || a.id - b.id);
}

/** The current version: the highest number. Null only for an entry with none. */
export function latestWersja(zebranie: Pick<Zebranie, 'wersje'>): ZebranieWersja | null {
  const sorted = sortWersje(zebranie.wersje ?? []);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/**
 * Number of the next revision: the newest version's minor + 1, same major.
 * An entry with no version at all starts at 1.0.
 */
export function nextWersjaNumber(wersje: ZebranieWersja[]): { major: number; minor: number } {
  const sorted = sortWersje(wersje);
  const last = sorted[sorted.length - 1];
  if (!last) return { major: 1, minor: 0 };
  return { major: last.major, minor: last.minor + 1 };
}

/* ---------------------- The status a meeting and version share --------------------- */

/**
 * The meeting's materials status a version's status stands for. "Prepared" is
 * prepared; anything still being worked on is "to prepare".
 */
export function materialyFromZebranieStatus(status: ZebranieStatus): SpotkanieMaterialyStatus {
  return status === 'przygotowane' ? 'przygotowane' : 'do_przygotowania';
}

/**
 * The version status a meeting's materials status stands for — null when the
 * meeting's status says nothing about the version (no materials needed, or
 * needed but not yet asked for: going back there from the card must not undo
 * work in the Zebrania module). "Sent" implies prepared.
 */
export function zebranieStatusFromMaterialy(
  status: SpotkanieMaterialyStatus,
): ZebranieStatus | null {
  if (status === 'do_przygotowania') return 'w_przygotowaniu';
  if (status === 'przygotowane' || status === 'wyslane') return 'przygotowane';
  return null;
}

/**
 * Should a meeting at `current` be moved when its newest version becomes
 * `status`? A sent meeting stays sent when a version is marked prepared — that is
 * the same fact said again; everything else follows the version.
 *
 * A meeting marked "no materials needed" (`brak`) is never moved: somebody
 * decided on the card that this meeting tracks no materials, and preparing a
 * notice for it in Zebrania must not overrule that — nor announce a status
 * change to everyone.
 */
export function materialyTargetForWersja(
  current: SpotkanieMaterialyStatus,
  status: ZebranieStatus,
): SpotkanieMaterialyStatus | null {
  if (current === 'brak') return null;
  const target = materialyFromZebranieStatus(status);
  if (current === target) return null;
  if (current === 'wyslane' && target === 'przygotowane') return null;
  return target;
}

/* ------------------------------ Where data comes from ----------------------------- */

/**
 * What an entry shows as its date, community and place: the live meeting when it
 * is linked and the meeting is loaded, its own columns otherwise.
 */
export interface ZebranieDane {
  nazwa: string;
  startsAt: string | null;
  endsAt: string | null;
  adresId: number | null;
  adresNazwa: string;
  lokalizacjaId: number | null;
  lokalizacjaNazwa: string;
  lokalizacjaAdres: string;
  /** True when the values above were read from the meeting. */
  zKalendarza: boolean;
}

export function zebranieDane(
  zebranie: Zebranie,
  spotkania: Spotkanie[],
  lokalizacje: SpotkanieLokalizacja[],
): ZebranieDane {
  const spotkanie =
    zebranie.spotkanieId != null ? spotkania.find((s) => s.id === zebranie.spotkanieId) : undefined;
  if (spotkanie) {
    const lok =
      spotkanie.lokalizacjaId != null
        ? lokalizacje.find((l) => l.id === spotkanie.lokalizacjaId)
        : undefined;
    return {
      nazwa: spotkanie.nazwa,
      startsAt: spotkanie.startsAt,
      endsAt: spotkanie.endsAt,
      adresId: spotkanie.adresId,
      adresNazwa: spotkanie.adresNazwa,
      lokalizacjaId: spotkanie.lokalizacjaId,
      lokalizacjaNazwa: lok?.nazwa || spotkanie.lokalizacjaNazwa || '',
      lokalizacjaAdres: lok?.adres ?? '',
      zKalendarza: true,
    };
  }
  return {
    nazwa: zebranie.nazwa,
    startsAt: zebranie.startsAt,
    endsAt: null,
    adresId: zebranie.adresId,
    adresNazwa: zebranie.adresNazwa,
    lokalizacjaId: zebranie.lokalizacjaId,
    lokalizacjaNazwa: zebranie.lokalizacjaNazwa,
    lokalizacjaAdres: zebranie.lokalizacjaAdres,
    zKalendarza: false,
  };
}

/** The entry belonging to a meeting, if one was created for it. */
export function zebranieForSpotkanie(
  zebrania: Zebranie[],
  spotkanieId: number,
): Zebranie | undefined {
  return zebrania.find((z) => z.spotkanieId === spotkanieId);
}

/* ---------------------------------- Materials ---------------------------------- */

function newMaterialId(): string {
  // Both Node (main) and Chromium (renderer) have it; the fallback only matters
  // in an odd test runner.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A fresh notice, its text copied from the template so that later edits to the
 * template never reach a letter already prepared for a meeting.
 */
export function newZawiadomienieMaterial(
  szablon: MailingSzablon,
  adresaci: MailingAdresaci | undefined,
  who: string,
): ZebranieMaterial {
  return {
    id: newMaterialId(),
    rodzaj: 'zawiadomienie',
    typ: szablon.typ as MailingTyp,
    szablonId: szablon.id,
    szablonNazwa: szablon.nazwa,
    temat: szablon.temat,
    tresc: szablon.tresc,
    values: {},
    tableFields: [],
    adresaci: cloneAdresaci(adresaci ?? DEFAULT_MAILING_ADRESACI),
    wykluczeni: [],
    updatedAt: new Date().toISOString(),
    updatedBy: who,
    pobrania: [],
  };
}

export function cloneAdresaci(a: MailingAdresaci): MailingAdresaci {
  return { zgn: !!a.zgn, pelnomocnik: !!a.pelnomocnik, zarzad: !!a.zarzad, wlasne: [...(a.wlasne ?? [])] };
}

/**
 * Materials for a new revision: a deep copy of the version it starts from, with
 * the download record left behind — those downloads were of the old version.
 */
export function copyMaterialyForRevision(materialy: ZebranieMaterial[]): ZebranieMaterial[] {
  return materialy.map((m) => ({
    ...m,
    id: newMaterialId(),
    values: { ...m.values },
    tableFields: [...m.tableFields],
    adresaci: cloneAdresaci(m.adresaci),
    wykluczeni: [...m.wykluczeni],
    pobrania: [],
  }));
}

/** The version's notice, when it has one. */
export function zawiadomienieOf(wersja: ZebranieWersja | null): ZebranieMaterial | undefined {
  return wersja?.materialy.find((m) => m.rodzaj === 'zawiadomienie');
}

/**
 * Coerce whatever a jsonb column holds into materials — rows written by an older
 * build, or a hand-edited backup, must not take the module down.
 */
export function normalizeMaterialy(value: unknown): ZebranieMaterial[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => {
      const adresaci = (m.adresaci ?? {}) as Partial<MailingAdresaci>;
      return {
        id: typeof m.id === 'string' && m.id ? m.id : newMaterialId(),
        rodzaj: 'zawiadomienie' as const,
        typ: typeof m.typ === 'string' ? m.typ : '',
        szablonId: typeof m.szablonId === 'number' ? m.szablonId : null,
        szablonNazwa: typeof m.szablonNazwa === 'string' ? m.szablonNazwa : '',
        temat: typeof m.temat === 'string' ? m.temat : '',
        tresc: typeof m.tresc === 'string' ? m.tresc : '',
        values:
          m.values && typeof m.values === 'object'
            ? Object.fromEntries(
                Object.entries(m.values as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
              )
            : {},
        tableFields: Array.isArray(m.tableFields) ? m.tableFields.map(String) : [],
        adresaci: {
          zgn: adresaci.zgn === true,
          pelnomocnik: adresaci.pelnomocnik === true,
          zarzad: adresaci.zarzad === true,
          wlasne: Array.isArray(adresaci.wlasne) ? adresaci.wlasne.map(String) : [],
        },
        wykluczeni: Array.isArray(m.wykluczeni) ? m.wykluczeni.map(String) : [],
        updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : '',
        updatedBy: typeof m.updatedBy === 'string' ? m.updatedBy : '',
        pobrania: Array.isArray(m.pobrania)
          ? (m.pobrania as { at?: unknown; by?: unknown; pliki?: unknown }[]).map((p) => ({
              at: String(p?.at ?? ''),
              by: String(p?.by ?? ''),
              pliki: Array.isArray(p?.pliki) ? (p.pliki as unknown[]).map(String) : [],
            }))
          : [],
      };
    });
}
