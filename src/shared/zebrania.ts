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
  MailingPole,
  MailingSzablon,
  MailingTyp,
  MailingZebranieContext,
  MailingZebranieOpcja,
  PlanGospodarczy,
  PlanOkresZaliczki,
  Spotkanie,
  SpotkanieLokalizacja,
  SpotkanieMaterialyStatus,
  Zebranie,
  ZebranieMaterial,
  ZebranieMaterialRodzaj,
  ZEBRANIE_DOKUMENTY,
  ZebranieGotowe,
  ZebranieStatus,
  ZebranieWersja,
} from './types';
import {
  MailingRenderContext,
  buildKalendarzContext,
  formatPolishDate,
  missingFieldValues,
  renderPlain,
} from './mailing-template';
import { foldText, okresyLabels, planSumy, saldaZeSprawozdania } from './plan-gospodarczy';
import { formatKwota, sprawozdanieWersji } from './sprawozdanie';
import { nazwaInterEj } from './inter-ej';

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

/** The stored map, cleaned: only known documents, only `true` kept. */
export function normalizeGotowe(value: unknown): ZebranieGotowe {
  const out: ZebranieGotowe = {};
  if (!value || typeof value !== 'object') return out;
  for (const k of ZEBRANIE_DOKUMENTY) {
    if ((value as Record<string, unknown>)[k] === true) out[k] = true;
  }
  return out;
}

/** A version is prepared only when every one of its documents is marked ready. */
export function wersjaStatusFromGotowe(gotowe: ZebranieGotowe): ZebranieStatus {
  return ZEBRANIE_DOKUMENTY.every((k) => gotowe[k] === true) ? 'przygotowane' : 'w_przygotowaniu';
}

/**
 * The map a whole-version status stands for — when the meeting's card in the
 * Kalendarz says "prepared" every document is, and "back to preparing" none is.
 */
export function gotoweForStatus(status: ZebranieStatus): ZebranieGotowe {
  if (status !== 'przygotowane') return {};
  const out: ZebranieGotowe = {};
  for (const k of ZEBRANIE_DOKUMENTY) out[k] = true;
  return out;
}

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
 * A fresh document of `rodzaj`, its text copied from the template so that later
 * edits to the template never reach a document already prepared for a meeting.
 */
function newMaterialFromSzablon(
  rodzaj: ZebranieMaterialRodzaj,
  szablon: MailingSzablon,
  adresaci: MailingAdresaci | undefined,
  who: string,
): ZebranieMaterial {
  return {
    id: newMaterialId(),
    rodzaj,
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

/** A fresh notice from a template. */
export function newZawiadomienieMaterial(
  szablon: MailingSzablon,
  adresaci: MailingAdresaci | undefined,
  who: string,
): ZebranieMaterial {
  return newMaterialFromSzablon('zawiadomienie', szablon, adresaci, who);
}

/**
 * A fresh resolution from a template. It is never mailed, so it keeps the default
 * recipients. A `{{Tabela pól}}` in it lists the template's whole shortlist — a
 * resolution has no send screen on which to tick rows.
 */
export function newUchwalaMaterial(szablon: MailingSzablon, who: string): ZebranieMaterial {
  return {
    ...newMaterialFromSzablon('uchwala', szablon, undefined, who),
    tableFields: [...(szablon.tableFields ?? [])],
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

/**
 * The template meeting's materials, for another community's meeting: a deep copy
 * like a revision's, but without what belongs to the template's own community —
 * its unticked mailboxes and the extra recipients typed for it.
 */
export function materialyZeSzablonu(materialy: ZebranieMaterial[], who: string): ZebranieMaterial[] {
  const at = new Date().toISOString();
  return copyMaterialyForRevision(materialy).map((m) => ({
    ...m,
    adresaci: { ...m.adresaci, wlasne: [] },
    wykluczeni: [],
    updatedAt: at,
    updatedBy: who,
  }));
}

/* --------------------------------- Template --------------------------------- */

/** Whether a version holds anything a template could pass on. */
export function wersjaMaMaterialy(wersja: Pick<ZebranieWersja, 'materialy' | 'plan'> | null): boolean {
  return !!wersja && (wersja.materialy.length > 0 || wersja.plan != null);
}

/** One of the template community's meetings, as the template draws on it. */
export interface ZebranieSzablonu {
  zebranie: Zebranie;
  dane: ZebranieDane;
  wersja: ZebranieWersja;
}

/**
 * The template ("Zebranie-szablon") as resolved. Each part comes from the
 * community's newest meeting that has it — the newest meeting may hold only a
 * notice while last year's holds the plan, and both are what the office means
 * by "do it like Bokserska". `zebranie`/`dane`/`wersja` name the newest of them.
 */
export interface ZrodloSzablonu extends ZebranieSzablonu {
  zawiadomienie: ZebranieMaterial | null;
  uchwaly: ZebranieMaterial[];
  plan: PlanGospodarczy | null;
  /** Where the plan was read from, when it is not the newest meeting. */
  planZ: ZebranieSzablonu | null;
}

/**
 * The template of community `adresNazwa`, read from its meetings newest first
 * (by date, then the latest added). Notice and resolutions come from a meeting's
 * current version; the plan from its newest version that has one. Null when
 * there is no template or none of the community's meetings holds anything.
 */
export function zrodloSzablonu(
  zebrania: Zebranie[],
  spotkania: Spotkanie[],
  lokalizacje: SpotkanieLokalizacja[],
  adresNazwa: string,
): ZrodloSzablonu | null {
  const nazwa = adresNazwa.trim();
  if (!nazwa) return null;
  const time = (d: ZebranieDane) => (d.startsAt ? new Date(d.startsAt).getTime() : NaN);
  const kandydaci = zebrania
    .map((zebranie) => ({ zebranie, dane: zebranieDane(zebranie, spotkania, lokalizacje), wersja: latestWersja(zebranie) }))
    .filter((r): r is ZebranieSzablonu => r.dane.adresNazwa.trim() === nazwa && r.wersja != null);
  kandydaci.sort((a, b) => {
    const ta = time(a.dane);
    const tb = time(b.dane);
    if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
    if (!Number.isNaN(ta) && ta !== tb) return tb - ta;
    return b.zebranie.id - a.zebranie.id;
  });
  const zZawiadomieniem = kandydaci.find((r) => zawiadomienieOf(r.wersja));
  const zUchwalami = kandydaci.find((r) => uchwalyOf(r.wersja).length > 0);
  let planZ: ZebranieSzablonu | null = null;
  for (const r of kandydaci) {
    const w = [...sortWersje(r.zebranie.wersje)].reverse().find((x) => x.plan);
    if (w) {
      planZ = { ...r, wersja: w };
      break;
    }
  }
  const najnowszy = kandydaci.find((r) => r === zZawiadomieniem || r === zUchwalami || r.zebranie === planZ?.zebranie);
  if (!najnowszy) return null;
  return {
    ...najnowszy,
    zawiadomienie: zZawiadomieniem ? zawiadomienieOf(zZawiadomieniem.wersja) ?? null : null,
    uchwaly: zUchwalami ? uchwalyOf(zUchwalami.wersja) : [],
    plan: planZ?.wersja.plan ?? null,
    planZ: planZ && planZ.zebranie !== najnowszy.zebranie ? planZ : null,
  };
}

/** The template's notice and resolutions, in the order a version keeps them. */
export function materialySzablonu(zrodlo: ZrodloSzablonu): ZebranieMaterial[] {
  return [...(zrodlo.zawiadomienie ? [zrodlo.zawiadomienie] : []), ...zrodlo.uchwaly];
}

/** The version's notice, when it has one. */
export function zawiadomienieOf(wersja: ZebranieWersja | null): ZebranieMaterial | undefined {
  return wersja?.materialy.find((m) => m.rodzaj === 'zawiadomienie');
}

/* -------------------------------- Resolutions -------------------------------- */

/** The version's resolutions, in the order they are kept (and printed). */
export function uchwalyOf(wersja: Pick<ZebranieWersja, 'materialy'> | null): ZebranieMaterial[] {
  return (wersja?.materialy ?? []).filter((m) => m.rodzaj === 'uchwala');
}

/**
 * `materialy` with its resolutions replaced by `uchwaly` — the notice and any
 * other material are left exactly as they are. The one place a resolution list
 * is written back, so no screen can drop the notice while saving a resolution.
 */
export function withUchwaly(
  materialy: ZebranieMaterial[],
  uchwaly: ZebranieMaterial[],
): ZebranieMaterial[] {
  return [...materialy.filter((m) => m.rodzaj !== 'uchwala'), ...uchwaly];
}

/** Move one resolution a place up (-1) or down (+1); the list as it was when it cannot move. */
export function moveUchwala(
  uchwaly: ZebranieMaterial[],
  id: string,
  delta: -1 | 1,
): ZebranieMaterial[] {
  const from = uchwaly.findIndex((u) => u.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= uchwaly.length) return uchwaly;
  const next = [...uchwaly];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Drag and drop: put resolution `id` right before (or after) resolution
 * `targetId`. Addressed by ids, not positions — the list the drop is applied to
 * is the one just re-read from the store, which may have changed while dragging.
 * Unchanged when either is gone or they are the same.
 */
export function moveUchwalaNextTo(
  uchwaly: ZebranieMaterial[],
  id: string,
  targetId: string,
  before: boolean,
): ZebranieMaterial[] {
  const moved = uchwaly.find((u) => u.id === id);
  if (!moved || id === targetId || !uchwaly.some((u) => u.id === targetId)) return uchwaly;
  const rest = uchwaly.filter((u) => u.id !== id);
  const at = rest.findIndex((u) => u.id === targetId) + (before ? 0 : 1);
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/**
 * What a resolution's fields resolve against: the meeting's data — read live, so
 * a moved date or place reaches a resolution prepared earlier — the version's
 * statement, plan and resolutions (`zebranie`, from `buildZebranieContext`), the
 * dictionary of dynamic fields and the values typed for this document. The same
 * context the editor, the preview, the PDF and the package use.
 */
export function uchwalaContext(
  uchwala: ZebranieMaterial,
  dane: ZebranieDane,
  pola: MailingPole[],
  zebranie: MailingZebranieContext | null = null,
  today: Date = new Date(),
): MailingRenderContext {
  return {
    adresNazwa: dane.adresNazwa,
    dateText: formatPolishDate(today),
    pola,
    values: uchwala.values,
    tableFields: uchwala.tableFields,
    kalendarz: buildKalendarzContext(dane),
    zebranie,
  };
}

/** Fields the document still has no value for — a download would print them as blanks. */
export function uchwalaMissing(
  uchwala: ZebranieMaterial,
  dane: ZebranieDane,
  pola: MailingPole[],
  zebranie: MailingZebranieContext | null = null,
): string[] {
  return missingFieldValues(uchwalaContext(uchwala, dane, pola, zebranie), uchwala.temat, uchwala.tresc);
}

/** The document's title as it reads in the list: its subject, rendered; the template's name when empty. */
export function uchwalaTytul(
  uchwala: ZebranieMaterial,
  dane: ZebranieDane,
  pola: MailingPole[],
  zebranie: MailingZebranieContext | null = null,
): string {
  const rendered = renderPlain(uchwala.temat, uchwalaContext(uchwala, dane, pola, zebranie)).trim();
  return rendered || uchwala.szablonNazwa || '—';
}

/* ------------------------- Zebrania fields of a letter ------------------------- */

const zl = (n: number) => `${formatKwota(n)} zł`;
const naM2 = (n: number) => `${formatKwota(n)} zł/m²`;

/** "Pokrycie straty", "strata" — the word itself, not "administratora". */
const STRATA_RE = /(^|[^a-z])strat/;

/**
 * The plan's lines that cover a loss. Part I's transfer from the repair fund
 * and part II's "Saldo zaliczki A (pokrycie straty)" are one and the same sum
 * booked on both sides, so they are one candidate; besides it, any position or
 * repair typed into the plan under a name speaking of a loss. INTER-EJ's lines
 * never — its amounts are not quoted in letters (shared/inter-ej).
 */
function pokrycieStratyOpcje(plan: PlanGospodarczy | null): MailingZebranieOpcja[] {
  if (!plan) return [];
  const opcje: MailingZebranieOpcja[] = [];
  const add = (etykieta: string, kwota: number) => {
    const name = etykieta.trim();
    if (!name || !(kwota > 0.005) || nazwaInterEj(name) || opcje.some((o) => o.klucz === name)) return;
    opcje.push({ klucz: name, etykieta: name, kwota: zl(kwota) });
  };
  add('Pokrycie straty z funduszu remontowego (saldo zaliczki „A”)', planSumy(plan).saldoAKoszt);
  for (const z of plan.pozycje) if (STRATA_RE.test(foldText(z.nazwa))) add(z.nazwa, z.kwota);
  for (const r of plan.remontyFR) if (STRATA_RE.test(foldText(r.opis))) add(r.opis, r.kwota);
  return opcje;
}

/** Each month's rate (January first) — the stretches laid out over the year. */
function stawkiMiesieczne(okresy: PlanOkresZaliczki[]): number[] {
  const out: number[] = [];
  for (const o of okresy) {
    for (let i = 0; i < Math.max(0, o.miesiace || 0) && out.length < 12; i++) out.push(o.stawka || 0);
  }
  while (out.length < 12) out.push(out.length > 0 ? out[out.length - 1] : 0);
  return out;
}

/**
 * Advances "A" and "B" month by month, the months at the same pair of rates
 * joined into one row ("I–III/2027"). The two advances change on their own
 * schedules, so a row ends wherever either of them changes.
 */
function zaliczkiPlanu(plan: PlanGospodarczy | null): MailingZebranieContext['zaliczki'] {
  if (!plan) return [];
  const a = stawkiMiesieczne(plan.zaliczkaA);
  const b = stawkiMiesieczne(plan.zaliczkaB);
  const rows: { miesiace: number; a: number; b: number }[] = [];
  for (let m = 0; m < 12; m++) {
    const last = rows[rows.length - 1];
    if (last && last.a === a[m] && last.b === b[m]) last.miesiace += 1;
    else rows.push({ miesiace: 1, a: a[m], b: b[m] });
  }
  const labels = okresyLabels(
    rows.map((r) => ({ miesiace: r.miesiace, stawka: 0 })),
    plan.rok,
  );
  return rows.map((r, i) => ({ okres: labels[i], zaliczkaA: naM2(r.a), zaliczkaB: naM2(r.b) }));
}

/**
 * What a letter made in Zebrania reads from its version: the linked statement's
 * repair-fund balance and advance "A"'s balance, the plan's loss coverage and
 * advances, and the version's resolutions by title. Built once per version and
 * handed to every render — the editor, the preview, the PDF and the send.
 */
export function buildZebranieContext(
  wersja: Pick<ZebranieWersja, 'sprawozdanie' | 'plan' | 'materialy'> | null,
  dane: ZebranieDane,
  pola: MailingPole[],
): MailingZebranieContext {
  const spr = wersja?.sprawozdanie ? sprawozdanieWersji(wersja.sprawozdanie) : null;
  const salda = spr ? saldaZeSprawozdania(spr) : { saldoA: null, saldoB: null };
  const plan = wersja?.plan ?? null;
  const bezUchwal: MailingZebranieContext = {
    wynikFunduszuRemontowego: salda.saldoB != null ? zl(salda.saldoB) : '',
    saldoZaliczkiA: salda.saldoA != null ? zl(salda.saldoA) : '',
    pokrycieStraty: pokrycieStratyOpcje(plan),
    zaliczki: zaliczkiPlanu(plan),
    uchwaly: [],
  };
  // A title may quote the version's figures too; it cannot quote the list it is in.
  return {
    ...bezUchwal,
    uchwaly: uchwalyOf(wersja).map((u) => uchwalaTytul(u, dane, pola, bezUchwal)),
  };
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
        rodzaj: (m.rodzaj === 'uchwala' ? 'uchwala' : 'zawiadomienie') as ZebranieMaterialRodzaj,
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
