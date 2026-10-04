/**
 * The budget plan ("plan gospodarczy") and how it is drafted from a community's
 * financial statement — pure, so the renderer's editable preview and the main
 * process's Excel/PDF compute every total with the same code.
 *
 * How the office builds a plan (read off their own spreadsheets):
 *   • Saldo zaliczki "A" = the statement's "Wynik finansowy narastająco"
 *     (a loss is negative). A negative balance is moved over from the repair
 *     fund: it appears in part I as "przeksięgowanie na f. remontowy" and in
 *     part II as a cost of the fund.
 *   • Saldo zaliczki "B" = the repair fund's "Stan na dzień …".
 *   • Advance income = rate × area × months, in up to two stretches of the year
 *     (the old rate until the plan is adopted, the new one after).
 *   • Costs = last year's actual costs by plan line, scaled to a full year,
 *     raised by an optional index and rounded UP to a round sum.
 *   • "Remonty bieżące" closes the plan: costs equal inflows.
 */

import {
  AdresUdzialy,
  PlanGospodarczy,
  PlanKategoria,
  PlanKategoriaKosztu,
  PlanKategoriaPrzychodu,
  PlanOkresZaliczki,
  PlanRemontFR,
  PlanSlownikRegula,
  PlanZrodlo,
  Sprawozdanie,
  SprawozdanieSekcja,
  SprawozdanieWiersz,
  ZebraniaUstawienia,
} from './types';

/* ------------------------------- Categories ------------------------------- */

export const PLAN_KOSZTY: PlanKategoriaKosztu[] = [
  'remonty',
  'energia',
  'porzadek',
  'zarzadzanie',
  'zarzad',
  'ubezpieczenie',
  'pozostale',
];
export const PLAN_PRZYCHODY: PlanKategoriaPrzychodu[] = ['reklamy', 'pozytki', 'inne'];

/**
 * The plan's own wording — the lines of the form every community's plan uses.
 * Document text, so Polish whatever the UI language.
 */
export const PLAN_KATEGORIA_NAZWA: Record<PlanKategoria, string> = {
  remonty: 'Remonty bieżące, konserwacja, przeglądy i pomiary',
  energia: 'Energia elektr. pomieszczeń wspólnych, gaz, woda itp.',
  porzadek: 'Utrzymanie porządku i czystości',
  zarzadzanie: 'Koszty zarządzania i administrowania',
  zarzad: 'Koszty zarządu',
  ubezpieczenie: 'Ubezpieczenie budynku na wniosek Wspólnoty',
  pozostale: 'Pozostałe opłaty, prowizje',
  reklamy: 'Reklamy',
  pozytki: 'Pożytki z wynajmu pow. wspólnej',
  inne: 'Inne przychody',
  zaliczkaA: 'Zaliczka "A" (wpłaty właścicieli)',
  pomin: 'Pomiń — nie trafia do planu',
};

export function isKosztKategoria(k: PlanKategoria): k is PlanKategoriaKosztu {
  return (PLAN_KOSZTY as string[]).includes(k);
}
export function isPrzychodKategoria(k: PlanKategoria): k is PlanKategoriaPrzychodu {
  return (PLAN_PRZYCHODY as string[]).includes(k);
}

/* ------------------------------- Dictionary ------------------------------- */

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** [phrase, category] — first match wins, so the specific phrases come first. */
const DEFAULT_RULES: [string, PlanKategoria][] = [
  // Not part of the year's flows.
  ['wynik roku', 'pomin'],
  ['rozliczenie wyniku', 'pomin'],
  // Income.
  ['pożytki zaliczka', 'pozytki'],
  ['zaliczka a', 'zaliczkaA'],
  ['eksploatacja podstawowa', 'zaliczkaA'],
  ['reklam', 'reklamy'],
  ['pożytki', 'pozytki'],
  ['czynsz', 'pozytki'],
  ['najem', 'pozytki'],
  ['najmu', 'pozytki'],
  ['pomieszcz', 'pozytki'],
  ['pom.', 'pozytki'],
  ['piwnic', 'pozytki'],
  ['garaż', 'pozytki'],
  ['zabudowa', 'pozytki'],
  ['korytarz', 'pozytki'],
  ['miejsce postojowe', 'pozytki'],
  ['strych', 'pozytki'],
  ['odsetki bankowe', 'inne'],
  ['odszkodowani', 'inne'],
  ['światło', 'inne'],
  ['należne zaliczki', 'inne'],
  // Costs: repairs, upkeep, inspections — line 1.
  ['przegląd', 'remonty'],
  ['remont', 'remonty'],
  ['konserwacj', 'remonty'],
  ['winda', 'remonty'],
  ['dozór techniczny', 'remonty'],
  ['hydrofor', 'remonty'],
  ['piony', 'remonty'],
  // Energy and media — line 2.
  ['energia', 'energia'],
  ['woda gospodarcza', 'energia'],
  ['gaz', 'energia'],
  // Cleaning and order — line 3.
  ['sprzątanie', 'porzadek'],
  ['porządkowe', 'porzadek'],
  ['czystości', 'porzadek'],
  ['dozorcy', 'porzadek'],
  ['dezynsekcja', 'porzadek'],
  ['odśnieżanie', 'porzadek'],
  ['zieleni', 'porzadek'],
  // Management — line 4.
  ['administrowania', 'zarzadzanie'],
  ['inter-ej', 'zarzadzanie'],
  // Line 5.
  ['koszty zarządu', 'zarzad'],
  ['ubezpiecz', 'ubezpieczenie'],
  ['prowizj', 'pozostale'],
  ['podatki', 'pozostale'],
  ['drobne', 'pozostale'],
  ['pozostałe', 'pozostale'],
  ['prawne', 'pozostale'],
  ['sądowe', 'pozostale'],
  ['procesowego', 'pozostale'],
  ['telekomunikac', 'pozostale'],
  ['monitoring', 'pozostale'],
  ['odpisy', 'pozostale'],
  ['odsetki od kredytu', 'pozostale'],
  // Income rows that share a word with a cost rule above ("Energia elek. -
  // zaliczka" is re-billed electricity, not a cost).
  ['energia', 'inne'],
  ['koszty zarządu', 'inne'],
];

export function defaultSlownik(): PlanSlownikRegula[] {
  return DEFAULT_RULES.map(([wzorzec, kategoria]) => ({ id: newId(), wzorzec, kategoria }));
}

export const DEFAULT_UCHWALA_PLAN_NR = '3/{rok}';
export const DEFAULT_ZAOKRAGLENIE = 100;

export function defaultUstawienia(): ZebraniaUstawienia {
  return { slownik: defaultSlownik(), uchwalaPlanNr: DEFAULT_UCHWALA_PLAN_NR, zaokraglenie: DEFAULT_ZAOKRAGLENIE };
}

const ALL_KATEGORIE = Object.keys(PLAN_KATEGORIA_NAZWA) as PlanKategoria[];

/** Coerce stored settings — a missing or broken value falls back to the defaults. */
export function normalizeUstawienia(value: unknown): ZebraniaUstawienia {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const slownik = Array.isArray(v.slownik)
    ? (v.slownik as Record<string, unknown>[])
        .filter((r) => r && typeof r.wzorzec === 'string' && ALL_KATEGORIE.includes(r.kategoria as PlanKategoria))
        .map((r) => ({
          id: typeof r.id === 'string' && r.id ? r.id : newId(),
          wzorzec: String(r.wzorzec),
          kategoria: r.kategoria as PlanKategoria,
        }))
    : defaultSlownik();
  const zaokraglenie = Number(v.zaokraglenie);
  return {
    slownik,
    uchwalaPlanNr: typeof v.uchwalaPlanNr === 'string' ? v.uchwalaPlanNr : DEFAULT_UCHWALA_PLAN_NR,
    zaokraglenie: Number.isFinite(zaokraglenie) && zaokraglenie > 0 ? zaokraglenie : DEFAULT_ZAOKRAGLENIE,
  };
}

/** Lower-case, no Polish diacritics, single spaces — how names and phrases are compared. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The plan line a statement row goes to. Only rules for the row's own side are
 * considered — a "energia" rule for costs must not pull in an income row named
 * "Energia elek. - zaliczka". A row no rule matches falls to "Pozostałe" (a
 * cost) or "Inne" (an income), flagged so the preview can point at it.
 */
export function kategoriaWiersza(
  nazwa: string,
  strona: 'przychod' | 'koszt',
  slownik: PlanSlownikRegula[],
): { kategoria: PlanKategoria; bezReguly: boolean } {
  const name = foldText(nazwa);
  for (const r of slownik) {
    const phrase = foldText(r.wzorzec);
    if (!phrase || !name.includes(phrase)) continue;
    const k = r.kategoria;
    if (k === 'pomin') return { kategoria: k, bezReguly: false };
    if (strona === 'przychod' && (isPrzychodKategoria(k) || k === 'zaliczkaA')) return { kategoria: k, bezReguly: false };
    if (strona === 'koszt' && isKosztKategoria(k)) return { kategoria: k, bezReguly: false };
  }
  return { kategoria: strona === 'przychod' ? 'inne' : 'pozostale', bezReguly: true };
}

/* ------------------------------ Statement bits ------------------------------ */

export function sekcja(spr: Sprawozdanie, re: RegExp): SprawozdanieSekcja | undefined {
  return spr.sekcje.find((s) => re.test(s.tytul));
}

function kolumna(sek: SprawozdanieSekcja, re: RegExp): number {
  return sek.kolumny.findIndex((k) => re.test(k));
}

/** A two-column (Przychód / Koszty) value as one signed number: income +, cost −. */
function signed(sek: SprawozdanieSekcja, w: SprawozdanieWiersz | undefined): number | null {
  if (!w) return null;
  const p = kolumna(sek, /przych/i);
  const k = kolumna(sek, /koszt/i);
  if (p >= 0 && w.kwoty[p] != null) return w.kwoty[p] as number;
  if (k >= 0 && w.kwoty[k] != null) return -(w.kwoty[k] as number);
  return null;
}

/** Months the statement covers, 1–12 (a full year when the dates are unreadable). */
export function miesiaceOkresu(od: string, doDnia: string): number {
  const a = /^(\d{4})-(\d{2})/.exec(od);
  const b = /^(\d{4})-(\d{2})/.exec(doDnia);
  if (!a || !b) return 12;
  const n = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) + 1;
  return n >= 1 && n <= 12 ? n : 12;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Up to the next multiple of `step` (costs are planned generously). */
export function roundUp(n: number, step: number): number {
  if (n <= 0) return 0;
  return Math.ceil(round2(n) / step) * step;
}
/** Down to a multiple of `step` (income is planned cautiously). */
export function roundDown(n: number, step: number): number {
  if (n <= 0) return 0;
  return Math.floor(round2(n) / step) * step;
}

/** "Wspólnota Mieszkaniowa Gotarda 8" → "Gotarda 8"; all-caps names get ordinary capitals. */
export function nazwaNieruchomosci(nazwa: string): string {
  let rest = nazwa.replace(/^\s*wsp[oó]lnota\s+mieszkaniowa\s*/i, '').trim() || nazwa.trim();
  if (rest === rest.toUpperCase()) {
    rest = rest.toLowerCase().replace(/(^|[\s.\-/])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
  }
  return rest;
}

/* --------------------------------- Drafting --------------------------------- */

export interface PlanKontekst {
  /** The ownership split remembered on the community, if any. */
  udzialy: AdresUdzialy | null;
  /** How the property is named on the plan ("ul. Kolberga 8 w Warszawie"). */
  nieruchomosc: string;
  /** Raise every cost by this many percent. */
  wskaznik: number;
  who: string;
}

/** `3/{rok}` → `3/2027`. */
export function uchwalaNr(template: string, rok: number): string {
  return template.replace(/\{rok\}/gi, String(rok));
}

/**
 * Draft a plan from a statement. Everything the statement says is taken from
 * it; the rest (rates for next year, repairs from the fund) starts at the
 * current values and is the user's to change in the preview.
 */
export function planZeSprawozdania(
  spr: Sprawozdanie,
  ust: ZebraniaUstawienia,
  ctx: PlanKontekst,
): PlanGospodarczy {
  const months = miesiaceOkresu(spr.okresOd, spr.okresDo);
  const toYear = (n: number) => (n * 12) / months;
  const rok = Number((spr.okresDo || spr.okresOd).slice(0, 4)) + 1 || new Date().getFullYear() + 1;
  const area = spr.powierzchnia ?? 0;
  const step = ust.zaokraglenie;
  const factor = 1 + (ctx.wskaznik || 0) / 100;

  const zrodla: PlanZrodlo[] = [];
  const koszty = Object.fromEntries(PLAN_KOSZTY.map((k) => [k, 0])) as Record<PlanKategoriaKosztu, number>;
  const przychody = Object.fromEntries(PLAN_PRZYCHODY.map((k) => [k, 0])) as Record<PlanKategoriaPrzychodu, number>;
  let zaliczkaAWplywy = 0;

  // Part I — "2. Koszty eksploatacji".
  const eksp = sekcja(spr, /koszty eksploatacji/i);
  let saldoA = 0;
  if (eksp) {
    const p = kolumna(eksp, /przych/i);
    const k = kolumna(eksp, /koszt/i);
    for (const w of eksp.wiersze) {
      if (w.podsumowanie) continue;
      const sides: ['przychod' | 'koszt', number][] = [];
      if (p >= 0 && w.kwoty[p] != null) sides.push(['przychod', w.kwoty[p] as number]);
      if (k >= 0 && w.kwoty[k] != null) sides.push(['koszt', w.kwoty[k] as number]);
      for (const [strona, kwota] of sides) {
        const { kategoria, bezReguly } = kategoriaWiersza(w.nazwa, strona, ust.slownik);
        if (kategoria === 'pomin') continue;
        if (kategoria === 'zaliczkaA') {
          zaliczkaAWplywy += kwota;
          continue;
        }
        const kwotaRoczna = round2(toYear(kwota));
        zrodla.push({ kategoria, nazwa: w.nazwa, kwotaRoczna, bezReguly });
        if (isKosztKategoria(kategoria)) koszty[kategoria] += kwotaRoczna;
        else if (isPrzychodKategoria(kategoria)) przychody[kategoria] += kwotaRoczna;
      }
    }
    const wynik = eksp.wiersze.find((w) => w.podsumowanie && /narastaj/i.test(w.nazwa));
    saldoA = signed(eksp, wynik) ?? 0;
  }

  // Part II — "1. Fundusz remontowy" and the loans.
  const fr = sekcja(spr, /fundusz remontowy/i);
  let saldoB = 0;
  let zaliczkaBWplywy = 0;
  let odsetki = 0;
  if (fr) {
    const stan = fr.wiersze.find((w) => w.podsumowanie && /stan na/i.test(w.nazwa));
    saldoB = signed(fr, stan) ?? 0;
    const p = kolumna(fr, /przych/i);
    const k = kolumna(fr, /koszt/i);
    for (const w of fr.wiersze) {
      if (w.podsumowanie) continue;
      if (p >= 0 && w.kwoty[p] != null && /^fundusz remontowy/i.test(w.nazwa)) zaliczkaBWplywy += w.kwoty[p] as number;
      if (k >= 0 && w.kwoty[k] != null && /odsetki|kredyt/i.test(w.nazwa)) odsetki += w.kwoty[k] as number;
    }
  }
  let splaty = 0;
  const kredyty = sekcja(spr, /kredyt/i);
  if (kredyty) {
    const c = kolumna(kredyty, /spłac/i);
    const razem = kredyty.wiersze.find((w) => w.podsumowanie && /razem/i.test(w.nazwa));
    if (c >= 0 && razem?.kwoty[c] != null) splaty = razem.kwoty[c] as number;
  }

  const rate = (wplywy: number) => (area > 0 ? round2(wplywy / area / months) : 0);
  for (const kat of PLAN_KOSZTY) koszty[kat] = roundUp(koszty[kat] * factor, step);
  for (const kat of PLAN_PRZYCHODY) przychody[kat] = roundDown(przychody[kat], step);

  const plan: PlanGospodarczy = {
    rok,
    nieruchomosc: ctx.nieruchomosc || nazwaNieruchomosci(spr.nazwa),
    uchwalaNr: uchwalaNr(ust.uchwalaPlanNr, rok),
    stanNaDzien: spr.okresDo,
    powierzchnia: area,
    miastoM2: ctx.udzialy?.miastoM2 ?? 0,
    pozytkiM2: ctx.udzialy?.pozytkiM2 ?? 0,
    saldoA: round2(saldoA),
    zaliczkaA: [{ miesiace: 12, stawka: rate(zaliczkaAWplywy) }],
    przychody,
    koszty,
    remontyDomykaja: true,
    saldoB: round2(saldoB),
    zaliczkaB: [{ miesiace: 12, stawka: rate(zaliczkaBWplywy) }],
    inneWplywyB: 0,
    kredyt: roundUp(toYear(splaty + odsetki), step),
    remontyFR: [],
    zrodla,
    wskaznik: ctx.wskaznik || 0,
    sprawozdanieOkres: { od: spr.okresOd, do: spr.okresDo },
    zmieniono: new Date().toISOString(),
    zmienil: ctx.who,
    pobrania: [],
  };
  return domknijRemonty(plan);
}

/* --------------------------------- Totals --------------------------------- */

export interface PlanSumy {
  /** Area owned privately — the total less the city's share. */
  osobyFizyczneM2: number;
  udzialOsobFizycznych: number;
  udzialMiasta: number;
  /* Part I */
  zaliczkaA: number[];
  zaliczkaARazem: number;
  przychodyRazem: number;
  przeksiegowanie: number;
  wplywyA: number;
  kosztyA: number;
  /** Inflows less costs of part I — zero when the plan balances. */
  roznicaA: number;
  /** Per m² per month, by cost line. */
  kosztM2: Record<PlanKategoriaKosztu, number>;
  /* Part II */
  zaliczkaB: number[];
  zaliczkaBRazem: number;
  wplywyB: number;
  saldoAKoszt: number;
  remontyFR: number;
  kosztyB: number;
  /** What the fund holds after the year's planned costs. */
  saldoBKoniec: number;
  /** Advance months add up to a full year. */
  miesiaceA: number;
  miesiaceB: number;
}

function zaliczki(okresy: PlanOkresZaliczki[], area: number): number[] {
  return okresy.map((o) => round2((o.stawka || 0) * (o.miesiace || 0) * area));
}

export function planSumy(plan: PlanGospodarczy): PlanSumy {
  const area = plan.powierzchnia || 0;
  const zA = zaliczki(plan.zaliczkaA, area);
  const zB = zaliczki(plan.zaliczkaB, area);
  const zaliczkaARazem = round2(zA.reduce((a, b) => a + b, 0));
  const zaliczkaBRazem = round2(zB.reduce((a, b) => a + b, 0));
  const przychodyRazem = round2(PLAN_PRZYCHODY.reduce((n, k) => n + (plan.przychody[k] || 0), 0));
  const przeksiegowanie = plan.saldoA < 0 ? round2(-plan.saldoA) : 0;
  const wplywyA = round2(plan.saldoA + zaliczkaARazem + przychodyRazem + przeksiegowanie);
  const kosztyA = round2(PLAN_KOSZTY.reduce((n, k) => n + (plan.koszty[k] || 0), 0));
  const kosztM2 = Object.fromEntries(
    PLAN_KOSZTY.map((k) => [k, area > 0 ? round2((plan.koszty[k] || 0) / 12 / area) : 0]),
  ) as Record<PlanKategoriaKosztu, number>;
  const wplywyB = round2(plan.saldoB + zaliczkaBRazem + (plan.inneWplywyB || 0));
  const remontyFR = round2(plan.remontyFR.reduce((n, r) => n + (r.kwota || 0), 0));
  const kosztyB = round2((plan.kredyt || 0) + przeksiegowanie + remontyFR);
  const osobyFizyczneM2 = round2(Math.max(0, area - (plan.miastoM2 || 0)));
  const udzialMiasta = area > 0 ? Math.round(((plan.miastoM2 || 0) / area) * 100) : 0;
  return {
    osobyFizyczneM2,
    udzialOsobFizycznych: area > 0 ? 100 - udzialMiasta : 0,
    udzialMiasta,
    zaliczkaA: zA,
    zaliczkaARazem,
    przychodyRazem,
    przeksiegowanie,
    wplywyA,
    kosztyA,
    roznicaA: round2(wplywyA - kosztyA),
    kosztM2,
    zaliczkaB: zB,
    zaliczkaBRazem,
    wplywyB,
    saldoAKoszt: przeksiegowanie,
    remontyFR,
    kosztyB,
    saldoBKoniec: round2(wplywyB - kosztyB),
    miesiaceA: plan.zaliczkaA.reduce((n, o) => n + (o.miesiace || 0), 0),
    miesiaceB: plan.zaliczkaB.reduce((n, o) => n + (o.miesiace || 0), 0),
  };
}

/** Set "Remonty bieżące" to whatever makes part I balance (never below zero). */
export function domknijRemonty(plan: PlanGospodarczy): PlanGospodarczy {
  const withoutRemonty = { ...plan, koszty: { ...plan.koszty, remonty: 0 } };
  const s = planSumy(withoutRemonty);
  return { ...plan, koszty: { ...plan.koszty, remonty: Math.max(0, round2(s.wplywyA - s.kosztyA)) } };
}

/* ------------------------------ Month labels ------------------------------ */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** The stretches of the year as the form writes them: "I–III/2027", "IV–XII/2027". */
export function okresyLabels(okresy: PlanOkresZaliczki[], rok: number): string[] {
  let start = 1;
  return okresy.map((o) => {
    const end = Math.min(12, start + Math.max(1, o.miesiace) - 1);
    const label = start === end ? `${ROMAN[start - 1]}/${rok}` : `${ROMAN[start - 1]}–${ROMAN[end - 1]}/${rok}`;
    start = end + 1;
    return label;
  });
}

/* ------------------------------ Normalizing ------------------------------ */

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function okresy(v: unknown): PlanOkresZaliczki[] {
  const list = Array.isArray(v) ? v : [];
  const out = list
    .filter((o) => o && typeof o === 'object')
    .map((o) => ({ miesiace: num((o as PlanOkresZaliczki).miesiace), stawka: num((o as PlanOkresZaliczki).stawka) }));
  return out.length > 0 ? out : [{ miesiace: 12, stawka: 0 }];
}

/** Coerce a stored plan; null when there is none. */
export function normalizePlan(value: unknown): PlanGospodarczy | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const k = (v.koszty ?? {}) as Record<string, unknown>;
  const p = (v.przychody ?? {}) as Record<string, unknown>;
  const okres = (v.sprawozdanieOkres ?? {}) as Record<string, unknown>;
  return {
    rok: num(v.rok) || new Date().getFullYear(),
    nieruchomosc: String(v.nieruchomosc ?? ''),
    uchwalaNr: String(v.uchwalaNr ?? ''),
    stanNaDzien: String(v.stanNaDzien ?? ''),
    powierzchnia: num(v.powierzchnia),
    miastoM2: num(v.miastoM2),
    pozytkiM2: num(v.pozytkiM2),
    saldoA: num(v.saldoA),
    zaliczkaA: okresy(v.zaliczkaA),
    przychody: Object.fromEntries(PLAN_PRZYCHODY.map((c) => [c, num(p[c])])) as Record<PlanKategoriaPrzychodu, number>,
    koszty: Object.fromEntries(PLAN_KOSZTY.map((c) => [c, num(k[c])])) as Record<PlanKategoriaKosztu, number>,
    remontyDomykaja: v.remontyDomykaja !== false,
    saldoB: num(v.saldoB),
    zaliczkaB: okresy(v.zaliczkaB),
    inneWplywyB: num(v.inneWplywyB),
    kredyt: num(v.kredyt),
    remontyFR: (Array.isArray(v.remontyFR) ? v.remontyFR : [])
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({
        id: typeof (r as PlanRemontFR).id === 'string' ? (r as PlanRemontFR).id : newId(),
        opis: String((r as PlanRemontFR).opis ?? ''),
        kwota: num((r as PlanRemontFR).kwota),
      })),
    zrodla: (Array.isArray(v.zrodla) ? v.zrodla : [])
      .filter((z) => z && typeof z === 'object' && ALL_KATEGORIE.includes((z as PlanZrodlo).kategoria))
      .map((z) => ({
        kategoria: (z as PlanZrodlo).kategoria,
        nazwa: String((z as PlanZrodlo).nazwa ?? ''),
        kwotaRoczna: num((z as PlanZrodlo).kwotaRoczna),
        bezReguly: (z as PlanZrodlo).bezReguly === true,
      })),
    wskaznik: num(v.wskaznik),
    sprawozdanieOkres: { od: String(okres.od ?? ''), do: String(okres.do ?? '') },
    zmieniono: String(v.zmieniono ?? ''),
    zmienil: String(v.zmienil ?? ''),
    pobrania: normalizePobrania(v.pobrania),
  };
}

export function normalizePobrania(v: unknown): { at: string; by: string; pliki: string[] }[] {
  return (Array.isArray(v) ? v : []).map((p) => ({
    at: String((p as { at?: unknown })?.at ?? ''),
    by: String((p as { by?: unknown })?.by ?? ''),
    pliki: Array.isArray((p as { pliki?: unknown })?.pliki) ? ((p as { pliki: unknown[] }).pliki).map(String) : [],
  }));
}

export function newRemontFR(): PlanRemontFR {
  return { id: newId(), opis: '', kwota: 0 };
}
