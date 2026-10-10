/**
 * The budget plan ("plan gospodarczy") and how it is drafted from a community's
 * financial statement — pure, so the renderer's editable preview and the main
 * process's Excel/PDF compute every total with the same code.
 *
 * How the office builds a plan (read off their own spreadsheets):
 *   • Saldo zaliczki "A" = the statement's "Wynik finansowy narastająco"
 *     (a loss is negative). A negative balance is moved over from the repair
 *     fund: it appears in part I as "przeksięgowanie na f. remontowy" and in
 *     part II as a cost of the fund. A positive balance can be moved over to
 *     the fund too, on request: part I gives it up ("przeksięgowanie na
 *     f. remontowy"), part II takes it in.
 *   • Saldo zaliczki "B" = the repair fund's "Stan na dzień …".
 *   • Advance income = rate × area × months, in up to two stretches of the year
 *     (the old rate until the plan is adopted, the new one after).
 *   • Income and costs = a copy of the statement's "Koszty eksploatacji" items
 *     (after the meeting version's merges and subcategories), each with last
 *     year's amount scaled to a full year: costs raised by an optional index and
 *     rounded UP to a round sum, income rounded down to the złoty.
 *   • Two kinds of rows stay out of the plan, by their printed names: the
 *     year's result ("Wynik roku", "Rozliczenie wyniku") and the advance
 *     income the rate "A" is read from (`rodzajWiersza`).
 */

import {
  AdresUdzialy,
  PlanGospodarczy,
  PlanKategoria,
  PlanKategoriaKosztu,
  PlanKategoriaPrzychodu,
  PlanOkresZaliczki,
  PlanPozycja,
  PlanRemontFR,
  Sprawozdanie,
  SprawozdanieSekcja,
  SprawozdanieWiersz,
  ZebraniaUstawienia,
} from './types';

/* ---------------------------- Legacy categories ---------------------------- */
// The fixed lines of the form plans were drafted into before they became a copy
// of the statement — kept only to convert plans saved then (`pozycjeZLinii`).

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
};

export function isKosztKategoria(k: PlanKategoria): k is PlanKategoriaKosztu {
  return (PLAN_KOSZTY as string[]).includes(k);
}
export function isPrzychodKategoria(k: PlanKategoria): k is PlanKategoriaPrzychodu {
  return (PLAN_PRZYCHODY as string[]).includes(k);
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const DEFAULT_UCHWALA_PLAN_NR = '3/{rok}';
export const DEFAULT_ZAOKRAGLENIE = 100;

export function defaultUstawienia(): ZebraniaUstawienia {
  return {
    uchwalaPlanNr: DEFAULT_UCHWALA_PLAN_NR,
    zaokraglenie: DEFAULT_ZAOKRAGLENIE,
    szablonAdresNazwa: '',
  };
}

/** Coerce stored settings — a missing or broken value falls back to the defaults. */
export function normalizeUstawienia(value: unknown): ZebraniaUstawienia {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const zaokraglenie = Number(v.zaokraglenie);
  return {
    uchwalaPlanNr: typeof v.uchwalaPlanNr === 'string' ? v.uchwalaPlanNr : DEFAULT_UCHWALA_PLAN_NR,
    zaokraglenie: Number.isFinite(zaokraglenie) && zaokraglenie > 0 ? zaokraglenie : DEFAULT_ZAOKRAGLENIE,
    szablonAdresNazwa: typeof v.szablonAdresNazwa === 'string' ? v.szablonAdresNazwa.trim() : '',
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
 * The rows the plan does not copy, by their printed names: the year's result,
 * which is no flow of the year, and the advance income — what the rate "A" is
 * read from, planned as the advance itself. Re-billed advances of other kinds
 * ("Pożytki zaliczka", "Energia elek. - zaliczka") are ordinary income.
 */
export function rodzajWiersza(nazwa: string, strona: 'przychod' | 'koszt'): 'pomin' | 'zaliczkaA' | null {
  const name = foldText(nazwa);
  if (name.includes('wynik roku') || name.includes('rozliczenie wyniku')) return 'pomin';
  if (strona === 'przychod' && !name.includes('pozytki zaliczka')) {
    if (name.includes('zaliczka a') || name.includes('eksploatacja podstawowa')) return 'zaliczkaA';
  }
  return null;
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
  /**
   * The statement as the meeting version shows it — merges and subcategories
   * applied. The plan's positions copy its items; every balance and rate is
   * still read off the printed statement. Absent = the printed rows.
   */
  pogrupowane?: Sprawozdanie | null;
}

/** `3/{rok}` → `3/2027`. */
export function uchwalaNr(template: string, rok: number): string {
  return template.replace(/\{rok\}/gi, String(rok));
}

type Strona = PlanPozycja['strona'];

/** A printed item row of "Koszty eksploatacji" on one side. */
interface WierszPlanu {
  nazwa: string;
  /** Left out of the plan, or the advance income — see `rodzajWiersza`. */
  pomin: boolean;
  zaliczkaA: boolean;
  /** For a full year. */
  roczna: number;
}

const rowKey = (strona: Strona, nazwa: string) => `${strona}\u0000${nazwa}`;

/** Every printed item row of "Koszty eksploatacji", per side. */
function wierszeEksploatacji(spr: Sprawozdanie): Map<string, WierszPlanu> {
  const out = new Map<string, WierszPlanu>();
  const eksp = sekcja(spr, /koszty eksploatacji/i);
  if (!eksp) return out;
  const months = miesiaceOkresu(spr.okresOd, spr.okresDo);
  const p = kolumna(eksp, /przych/i);
  const k = kolumna(eksp, /koszt/i);
  for (const w of eksp.wiersze) {
    if (w.podsumowanie) continue;
    const sides: [Strona, number][] = [];
    if (p >= 0 && w.kwoty[p] != null) sides.push(['przychod', w.kwoty[p] as number]);
    if (k >= 0 && w.kwoty[k] != null) sides.push(['koszt', w.kwoty[k] as number]);
    for (const [strona, kwota] of sides) {
      const rodzaj = rodzajWiersza(w.nazwa, strona);
      const key = rowKey(strona, w.nazwa);
      const prev = out.get(key);
      const roczna = round2((kwota * 12) / months);
      out.set(
        key,
        prev
          ? { ...prev, roczna: round2(prev.roczna + roczna) }
          : { nazwa: w.nazwa, pomin: rodzaj === 'pomin', zaliczkaA: rodzaj === 'zaliczkaA', roczna },
      );
    }
  }
  return out;
}

export type PozycjaZeSprawozdania = Omit<PlanPozycja, 'id' | 'kwota'>;

/**
 * The plan's positions copied from the statement, without planned amounts yet:
 * one per item of the grouped "Koszty eksploatacji" and side, in its order — a
 * merge is one position, a subcategory's items keep its name as their group.
 * The year's result and the advance income stay out (`rodzajWiersza`).
 */
export function pozycjePlanu(
  spr: Sprawozdanie,
  pogrupowane: Sprawozdanie | null | undefined,
): PozycjaZeSprawozdania[] {
  const rows = wierszeEksploatacji(spr);
  const eksp = sekcja(pogrupowane ?? spr, /koszty eksploatacji/i);
  if (!eksp) return [];
  const out: PozycjaZeSprawozdania[] = [];
  // A printed name met twice (rows of one name are summed) goes to one position only.
  const used = new Set<string>();
  let grupa = '';
  for (const w of eksp.wiersze) {
    if (w.podsumowanie) continue;
    if (w.podkategoria === 'naglowek') {
      grupa = w.nazwa;
      continue;
    }
    if (w.podkategoria !== 'pozycja') grupa = '';
    const names = w.polaczone ?? [w.nazwa];
    for (const strona of ['przychod', 'koszt'] as Strona[]) {
      const parts = names
        .filter((n) => !used.has(rowKey(strona, n)))
        .map((n) => rows.get(rowKey(strona, n)))
        .filter((r): r is WierszPlanu => !!r && !r.pomin && !r.zaliczkaA);
      if (parts.length === 0) continue;
      parts.forEach((r) => used.add(rowKey(strona, r.nazwa)));
      out.push({
        strona,
        nazwa: w.nazwa,
        wiersze: parts.map((r) => r.nazwa),
        grupa,
        kwotaRoczna: round2(parts.reduce((n, r) => n + r.roczna, 0)),
      });
    }
  }
  return out;
}

/**
 * A position's drafted amount: a cost raised by the index and rounded up to
 * the step, income rounded down to the złoty (to the step, a small income
 * would fall to nothing). A negative figure (a refund) plans as zero.
 */
function kwotaPozycji(z: PozycjaZeSprawozdania, wskaznik: number, step: number): number {
  return z.strona === 'koszt'
    ? roundUp(z.kwotaRoczna * (1 + (wskaznik || 0) / 100), step)
    : roundDown(z.kwotaRoczna, 1);
}

/** A cost copied from the statement — what the index drafts. */
const kosztZeSprawozdania = (z: Pick<PlanPozycja, 'strona' | 'wiersze'>) => z.strona === 'koszt' && z.wiersze.length > 0;

/** Which position is "the same" across layouts, for its own growth: its side and printed rows. */
const kluczWzrostu = (z: Pick<PlanPozycja, 'strona' | 'wiersze'>) => `${z.strona}|${[...z.wiersze].sort().join('\u0001')}`;

/** Last year's figure a cost grows from — a refund (negative) counts as nothing. */
const baza = (z: Pick<PlanPozycja, 'kwotaRoczna'>) => Math.max(0, z.kwotaRoczna);

/**
 * The growth (%) of the statement's costs that have none of their own. The
 * plan's index is what the costs rise by IN TOTAL: a position with its own
 * growth rises by that, and the others share what is left — so with 10% in
 * total and one position at 5%, the others rise a little over 10%. Null when
 * every cost has its own growth (or the others had nothing last year), so the
 * total cannot be steered.
 */
export function wzrostPozostalych(
  pozycje: Pick<PlanPozycja, 'strona' | 'wiersze' | 'kwotaRoczna' | 'wzrost'>[],
  wskaznik: number,
): number | null {
  const koszty = pozycje.filter(kosztZeSprawozdania);
  const wlasne = koszty.filter((z) => z.wzrost != null);
  if (wlasne.length === 0) return wskaznik || 0;
  const reszta = koszty.filter((z) => z.wzrost == null).reduce((n, z) => n + baza(z), 0);
  if (reszta <= 0) return null;
  const cel = koszty.reduce((n, z) => n + baza(z), 0) * (1 + (wskaznik || 0) / 100);
  const stale = wlasne.reduce((n, z) => n + baza(z) * (1 + (z.wzrost ?? 0) / 100), 0);
  return ((cel - stale) / reszta - 1) * 100;
}

/** Every statement cost drafted again from last year's figure, by its own growth or the others' share of the index. */
function kosztyWedlugWzrostu(pozycje: PlanPozycja[], wskaznik: number, step: number): PlanPozycja[] {
  const pozostale = wzrostPozostalych(pozycje, wskaznik) ?? 0;
  return pozycje.map((z) =>
    kosztZeSprawozdania(z) ? { ...z, kwota: kwotaPozycji(z, z.wzrost ?? pozostale, step) } : z,
  );
}

/**
 * What each position is drafted at, by its index in `plan.pozycje`: a statement
 * cost by its own growth or the others' share of the index, statement income
 * from last year's figure. Null for a position typed in by hand — it has none.
 */
export function kwotyWyliczone(plan: PlanGospodarczy, step: number): (number | null)[] {
  const drafted = kosztyWedlugWzrostu(plan.pozycje, plan.wskaznik, step);
  return plan.pozycje.map((z, i) =>
    z.wiersze.length === 0 ? null : z.strona === 'koszt' ? drafted[i].kwota : kwotaPozycji(z, 0, step),
  );
}

/** Costs from the statement whose amount is no longer the one the plan's growth drafts — typed over by hand. */
export function kosztyPoprawione(plan: PlanGospodarczy, step: number): string[] {
  const drafted = kwotyWyliczone(plan, step);
  return plan.pozycje.filter((z, i) => kosztZeSprawozdania(z) && z.kwota !== drafted[i]).map((z) => z.nazwa);
}

/** What a drafted plan is recomputed with: the index, the ownership split and each position's own growth. */
export interface PlanZalozeniaPrzeliczenia {
  wskaznik: number;
  miastoM2: number;
  pozytkiM2: number;
  /** Position id → its own growth (%); a statement cost not listed follows the index. */
  wzrosty: Record<string, number>;
}

/** Each statement cost's own growth, by position id — the plan's side of `PlanZalozeniaPrzeliczenia.wzrosty`. */
export function wzrostyPlanu(plan: PlanGospodarczy): Record<string, number> {
  const out: Record<string, number> = {};
  for (const z of plan.pozycje) if (kosztZeSprawozdania(z) && z.wzrost != null) out[z.id] = z.wzrost;
  return out;
}

const sameWzrosty = (a: Record<string, number>, b: Record<string, number>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
};

/**
 * The plan with new assumptions, after it was drafted: the ownership split as
 * given and, when the index or a position's own growth changes, every cost
 * from the statement drafted again from last year's figure. Income and
 * positions typed in by hand keep their amounts.
 */
export function przeliczZalozenia(plan: PlanGospodarczy, z: PlanZalozeniaPrzeliczenia, step: number): PlanGospodarczy {
  const wskaznik = z.wskaznik || 0;
  const out = { ...plan, wskaznik, miastoM2: z.miastoM2, pozytkiM2: z.pozytkiM2 };
  if (wskaznik === plan.wskaznik && sameWzrosty(z.wzrosty, wzrostyPlanu(plan))) return out;
  const pozycje = plan.pozycje.map((p) => {
    if (!kosztZeSprawozdania(p)) return p;
    const { wzrost: _w, ...rest } = p;
    return p.id in z.wzrosty ? { ...rest, wzrost: z.wzrosty[p.id] } : rest;
  });
  return { ...out, pozycje: kosztyWedlugWzrostu(pozycje, wskaznik, step) };
}

/**
 * Carry the own growth of positions over to positions laid out anew — onto the
 * one over exactly the same printed rows — and draft the costs again by it.
 */
export function zachowajWzrosty(plan: PlanGospodarczy, dawne: PlanPozycja[], step: number): PlanGospodarczy {
  const wzrosty = new Map(dawne.filter((z) => kosztZeSprawozdania(z) && z.wzrost != null).map((z) => [kluczWzrostu(z), z.wzrost!]));
  if (wzrosty.size === 0) return plan;
  const pozycje = plan.pozycje.map((z) => {
    const w = kosztZeSprawozdania(z) ? wzrosty.get(kluczWzrostu(z)) : undefined;
    return w != null ? { ...z, wzrost: w } : z;
  });
  return { ...plan, pozycje: kosztyWedlugWzrostu(pozycje, plan.wskaznik, step) };
}

/**
 * The template meeting's assumptions put on another community's plan: its cost
 * rise, and each cost's own growth moved onto the position over the same printed
 * rows (rows of no template position follow the index). Every cost from the
 * statement is drafted again; income, hand-typed positions, rates, balances
 * and the ownership split stay the plan's own.
 */
export function planZeSzablonu(plan: PlanGospodarczy, wzor: PlanGospodarczy, step: number): PlanGospodarczy {
  const wzrosty = new Map(
    wzor.pozycje.filter((z) => kosztZeSprawozdania(z) && z.wzrost != null).map((z) => [kluczWzrostu(z), z.wzrost!]),
  );
  const naPlanie: Record<string, number> = {};
  for (const z of plan.pozycje) {
    const w = kosztZeSprawozdania(z) ? wzrosty.get(kluczWzrostu(z)) : undefined;
    if (w != null) naPlanie[z.id] = w;
  }
  return przeliczZalozenia(
    plan,
    { wskaznik: wzor.wskaznik, miastoM2: plan.miastoM2, pozytkiM2: plan.pozytkiM2, wzrosty: naPlanie },
    step,
  );
}

/** How many costs of a plan grow by their own rate rather than the index. */
export function liczbaWlasnychWzrostow(plan: PlanGospodarczy): number {
  return Object.keys(wzrostyPlanu(plan)).length;
}

export function newPozycja(strona: Strona): PlanPozycja {
  return { id: newId(), strona, nazwa: '', wiersze: [], grupa: '', kwotaRoczna: 0, kwota: 0 };
}

/** What tells one layout of positions from another: sides, names, groups and the printed rows behind them. */
export function ukladPozycji(pozycje: Pick<PlanPozycja, 'strona' | 'nazwa' | 'wiersze' | 'grupa'>[]): string {
  return pozycje
    .filter((z) => z.wiersze.length > 0)
    .map((z) => `${z.strona}|${z.grupa}|${z.nazwa}|${[...z.wiersze].sort().join('\u0001')}`)
    .sort()
    .join('\n');
}

export interface PrzegenerowanePozycje {
  plan: PlanGospodarczy;
  /** Positions that cover no row of the old layout — their amounts are drafted. */
  nowe: string[];
  /** Old positions none of whose rows is in the new layout — their amounts are gone. */
  usuniete: string[];
}

/**
 * New positions from the statement, keeping the planned amounts: a position
 * over the same rows keeps its amount, a merge of old positions gets their sum,
 * a position split up shares its amount by last year's figures (evenly when
 * those are zero) — so the totals stay. Only rows new to the statement get a
 * drafted amount; positions whose rows are gone are reported. Positions typed
 * in by hand stay as they are, after the statement's.
 */
export function przegenerujPozycje(
  plan: PlanGospodarczy,
  spr: Sprawozdanie,
  pogrupowane: Sprawozdanie | null | undefined,
  ust: ZebraniaUstawienia,
): PrzegenerowanePozycje {
  const fresh = pozycjePlanu(spr, pogrupowane);
  const rows = wierszeEksploatacji(spr);
  const kwoty = fresh.map(() => 0);
  const covered = fresh.map(() => false);
  const usuniete: string[] = [];

  for (const old of plan.pozycje) {
    if (old.wiersze.length === 0) continue;
    // The new positions on the same side that take some of its rows, weighted by those rows.
    const targets: { i: number; waga: number; n: number }[] = [];
    fresh.forEach((f, i) => {
      if (f.strona !== old.strona) return;
      const shared = f.wiersze.filter((n) => old.wiersze.includes(n));
      if (shared.length === 0) return;
      const waga = shared.reduce((s, n) => s + Math.abs(rows.get(rowKey(old.strona, n))?.roczna ?? 0), 0);
      targets.push({ i, waga, n: shared.length });
    });
    if (targets.length === 0) {
      usuniete.push(old.nazwa);
      continue;
    }
    const total = targets.reduce((s, x) => s + x.waga, 0);
    const count = targets.reduce((s, x) => s + x.n, 0);
    let left = old.kwota;
    targets.forEach((x, j) => {
      const part =
        j === targets.length - 1 ? round2(left) : round2(old.kwota * (total > 0 ? x.waga / total : x.n / count));
      left -= part;
      kwoty[x.i] = round2(kwoty[x.i] + part);
      covered[x.i] = true;
    });
  }

  // A position new to the statement has no growth of its own: it rises as the others do.
  const pozostale = wzrostPozostalych(plan.pozycje, plan.wskaznik) ?? plan.wskaznik;
  const nowe: string[] = [];
  // A position over exactly the rows of an old one keeps its own growth.
  const wzrosty = new Map(
    plan.pozycje.filter((z) => z.wiersze.length > 0 && z.wzrost != null).map((z) => [kluczWzrostu(z), z.wzrost!]),
  );
  const zeSprawozdania: PlanPozycja[] = fresh.map((f, i) => {
    const w = wzrosty.get(kluczWzrostu(f));
    if (covered[i]) return { ...f, id: newId(), kwota: kwoty[i], ...(w != null ? { wzrost: w } : {}) };
    nowe.push(f.nazwa);
    return { ...f, id: newId(), kwota: kwotaPozycji(f, pozostale, ust.zaokraglenie) };
  });
  const reczne = plan.pozycje.filter((z) => z.wiersze.length === 0);
  return { plan: { ...plan, pozycje: [...zeSprawozdania, ...reczne] }, nowe, usuniete };
}

/**
 * The two balances a plan opens with, as the statement prints them (null where
 * it does not): advance "A" — the running costs' "Wynik finansowy narastająco",
 * a loss negative — and advance "B" — the repair fund's "Stan na dzień …". The
 * one reading of them, shared by the plan and the letters that quote them.
 */
export function saldaZeSprawozdania(spr: Sprawozdanie): { saldoA: number | null; saldoB: number | null } {
  const eksp = sekcja(spr, /koszty eksploatacji/i);
  const fr = sekcja(spr, /fundusz remontowy/i);
  const wynik = eksp?.wiersze.find((w) => w.podsumowanie && /narastaj/i.test(w.nazwa));
  const stan = fr?.wiersze.find((w) => w.podsumowanie && /stan na/i.test(w.nazwa));
  return {
    saldoA: eksp ? signed(eksp, wynik) : null,
    saldoB: fr ? signed(fr, stan) : null,
  };
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

  // Part I — "2. Koszty eksploatacji": positions from the grouped items, the advance from the printed rows.
  const pozycje: PlanPozycja[] = pozycjePlanu(spr, ctx.pogrupowane).map((z) => ({
    ...z,
    id: newId(),
    kwota: kwotaPozycji(z, ctx.wskaznik, step),
  }));
  let zaliczkaAWplywy = 0;
  for (const [key, r] of wierszeEksploatacji(spr)) {
    if (r.zaliczkaA && key.startsWith('przychod')) zaliczkaAWplywy += (r.roczna * months) / 12;
  }
  const salda = saldaZeSprawozdania(spr);
  const saldoA = salda.saldoA ?? 0;
  const saldoB = salda.saldoB ?? 0;

  // Part II — "1. Fundusz remontowy" and the loans.
  const fr = sekcja(spr, /fundusz remontowy/i);
  let zaliczkaBWplywy = 0;
  let odsetki = 0;
  if (fr) {
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
  return {
    rok,
    nieruchomosc: ctx.nieruchomosc || nazwaNieruchomosci(spr.nazwa),
    uchwalaNr: uchwalaNr(ust.uchwalaPlanNr, rok),
    stanNaDzien: spr.okresDo,
    powierzchnia: area,
    miastoM2: ctx.udzialy?.miastoM2 ?? 0,
    pozytkiM2: ctx.udzialy?.pozytkiM2 ?? 0,
    saldoA: round2(saldoA),
    zaliczkaA: [{ miesiace: 12, stawka: rate(zaliczkaAWplywy) }],
    pozycje,
    saldoB: round2(saldoB),
    zaliczkaB: [{ miesiace: 12, stawka: rate(zaliczkaBWplywy) }],
    inneWplywyB: 0,
    kredyt: roundUp(toYear(splaty + odsetki), step),
    remontyFR: [],
    wskaznik: ctx.wskaznik || 0,
    sprawozdanieOkres: { od: spr.okresOd, do: spr.okresDo },
    zmieniono: new Date().toISOString(),
    zmienil: ctx.who,
    pobrania: [],
  };
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
  /**
   * Part I's line 4: the repair fund covering a loss (+), or a positive balance
   * moved over to the fund (−).
   */
  przeksiegowanie: number;
  wplywyA: number;
  kosztyA: number;
  /** Inflows less costs of part I — zero when the plan balances. */
  roznicaA: number;
  /* Part II */
  zaliczkaB: number[];
  zaliczkaBRazem: number;
  wplywyB: number;
  /** A positive balance of advance "A" the fund takes in. */
  saldoANaFundusz: number;
  /** A loss of part I the fund covers. */
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

/** A yearly cost per m² per month. */
export function naM2(plan: PlanGospodarczy, kwota: number): number {
  return plan.powierzchnia > 0 ? round2(kwota / 12 / plan.powierzchnia) : 0;
}

export function planSumy(plan: PlanGospodarczy): PlanSumy {
  const area = plan.powierzchnia || 0;
  const zA = zaliczki(plan.zaliczkaA, area);
  const zB = zaliczki(plan.zaliczkaB, area);
  const zaliczkaARazem = round2(zA.reduce((a, b) => a + b, 0));
  const zaliczkaBRazem = round2(zB.reduce((a, b) => a + b, 0));
  const suma = (strona: Strona) =>
    round2(plan.pozycje.filter((z) => z.strona === strona).reduce((n, z) => n + (z.kwota || 0), 0));
  const przychodyRazem = suma('przychod');
  // A loss is always covered by the fund; a positive balance goes over to it only when asked.
  const saldoAKoszt = plan.saldoA < 0 ? round2(-plan.saldoA) : 0;
  const saldoANaFundusz = plan.saldoANaFundusz && plan.saldoA > 0 ? round2(plan.saldoA) : 0;
  const przeksiegowanie = round2(saldoAKoszt - saldoANaFundusz);
  const wplywyA = round2(plan.saldoA + zaliczkaARazem + przychodyRazem + przeksiegowanie);
  const kosztyA = suma('koszt');
  const wplywyB = round2(plan.saldoB + zaliczkaBRazem + saldoANaFundusz + (plan.inneWplywyB || 0));
  const remontyFR = round2(plan.remontyFR.reduce((n, r) => n + (r.kwota || 0), 0));
  const kosztyB = round2((plan.kredyt || 0) + saldoAKoszt + remontyFR);
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
    zaliczkaB: zB,
    zaliczkaBRazem,
    wplywyB,
    saldoANaFundusz,
    saldoAKoszt,
    remontyFR,
    kosztyB,
    saldoBKoniec: round2(wplywyB - kosztyB),
    miesiaceA: plan.zaliczkaA.reduce((n, o) => n + (o.miesiace || 0), 0),
    miesiaceB: plan.zaliczkaB.reduce((n, o) => n + (o.miesiace || 0), 0),
  };
}

/** Which advance: "A" for the running costs (part I), "B" for the repair fund (part II). */
export type ZaliczkaRodzaj = 'A' | 'B';

export interface ZaliczkaBilans {
  /**
   * What the advance must bring for its part to cover the planned costs — the
   * costs less every other inflow (for "B": the fund ending the year at zero);
   * zero when they cover it.
   */
  potrzebne: number;
  /**
   * The rate of the year's last stretch that brings it, the stretches before it
   * keeping their rates — with one stretch, the rate for the whole year. Rounded
   * up to the grosz.
   */
  stawka: number;
  /** What the stretches before the last bring at their rates (0 with one stretch). */
  wczesniej: number;
  /** The advance's stretches with the last at that rate — what "Ustaw tę stawkę" puts in. */
  okresy: PlanOkresZaliczki[];
  /** The whole of `potrzebne` as one rate for 12 months — the rate with no change during the year. */
  stawkaRoczna: number;
}

/** Up to the grosz; the epsilon keeps a rate that is a whole grosz from being rounded a grosz up. */
const stawkaWGore = (kwota: number, area: number, miesiace: number) =>
  area > 0 && miesiace > 0 ? Math.max(0, Math.ceil((kwota / area / miesiace) * 100 - 1e-9) / 100) : 0;

/**
 * The advance that balances its part of the plan. A year split into stretches
 * stays split: the stretches before the last keep their rates (the old rate
 * until the plan is adopted) and the last one makes up the rest.
 */
export function zaliczkaBilansujaca(plan: PlanGospodarczy, x: ZaliczkaRodzaj): ZaliczkaBilans {
  const s = planSumy(plan);
  const potrzebne = Math.max(
    0,
    x === 'A' ? round2(s.kosztyA - (s.wplywyA - s.zaliczkaARazem)) : round2(s.kosztyB - (s.wplywyB - s.zaliczkaBRazem)),
  );
  const area = plan.powierzchnia || 0;
  const okresy = x === 'A' ? plan.zaliczkaA : plan.zaliczkaB;
  const kwoty = x === 'A' ? s.zaliczkaA : s.zaliczkaB;
  const last = okresy.length - 1;
  const wczesniej = round2(kwoty.slice(0, last).reduce((n, k) => n + k, 0));
  const stawka = stawkaWGore(potrzebne - wczesniej, area, okresy[last]?.miesiace ?? 12);
  return {
    potrzebne,
    stawka,
    wczesniej,
    okresy: okresy.map((o, i) => (i === last ? { ...o, stawka } : o)),
    stawkaRoczna: stawkaWGore(potrzebne, area, 12),
  };
}

/** One row of a side as the plan prints it: a position, or a subcategory's heading with its sum. */
export type PlanWierszWidoku =
  | { typ: 'grupa'; nazwa: string; kwota: number }
  | { typ: 'pozycja'; pozycja: PlanPozycja; index: number; wGrupie: boolean };

/** The positions of one side in order, a subcategory's heading before its first position. */
export function wierszePlanu(plan: PlanGospodarczy, strona: Strona): PlanWierszWidoku[] {
  const out: PlanWierszWidoku[] = [];
  let grupa = '';
  plan.pozycje.forEach((z, index) => {
    if (z.strona !== strona) return;
    if (z.grupa && z.grupa !== grupa) {
      const kwota = round2(
        plan.pozycje.filter((x) => x.strona === strona && x.grupa === z.grupa).reduce((n, x) => n + x.kwota, 0),
      );
      out.push({ typ: 'grupa', nazwa: z.grupa, kwota });
    }
    grupa = z.grupa;
    out.push({ typ: 'pozycja', pozycja: z, index, wGrupie: !!z.grupa });
  });
  return out;
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

/** The month (1–12) each stretch of the year starts in — the first in January. */
export function poczatkiOkresow(okresy: PlanOkresZaliczki[]): number[] {
  let start = 1;
  return okresy.map((o) => {
    const own = Math.min(12, start);
    start = own + Math.max(1, o.miesiace || 0);
    return own;
  });
}

/** Stretches from their starting months (rising, the first ignored as January) and rates; they always make 12 months. */
export function okresyZPoczatkow(poczatki: number[], stawki: number[]): PlanOkresZaliczki[] {
  const starts = [1, ...poczatki.slice(1)];
  return starts.map((p, i) => ({ miesiace: (i + 1 < starts.length ? starts[i + 1] : 13) - p, stawka: stawki[i] ?? 0 }));
}

/** Months (2–12) a new rate could start in — those no stretch starts in yet. */
export function wolneMiesiaceZmiany(okresy: PlanOkresZaliczki[]): number[] {
  const starts = new Set(poczatkiOkresow(okresy));
  return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((m) => !starts.has(m));
}

/**
 * The month a new rate is offered from: the one after the meeting that adopts
 * the plan, when that is in the plan's year; otherwise the middle of the
 * longest stretch. Null when every month starts a stretch already.
 */
export function domyslnyMiesiacZmiany(okresy: PlanOkresZaliczki[], rok: number, dataZebrania: string | null): number | null {
  const wolne = wolneMiesiaceZmiany(okresy);
  if (wolne.length === 0) return null;
  const m = /^(\d{4})-(\d{2})/.exec(dataZebrania ?? '');
  if (m && Number(m[1]) === rok && wolne.includes(Number(m[2]) + 1)) return Number(m[2]) + 1;
  const starts = poczatkiOkresow(okresy);
  const lens = okresyZPoczatkow(starts, []).map((o) => o.miesiace);
  let i = 0;
  lens.forEach((n, j) => {
    if (n >= lens[i]) i = j;
  });
  const srodek = starts[i] + Math.ceil(lens[i] / 2);
  return wolne.includes(srodek) ? srodek : wolne[0];
}

/** A new rate from the given month: the stretch it falls in is cut there, the new part at first keeping its rate. */
export function dodajZmianeStawki(okresy: PlanOkresZaliczki[], miesiac: number): PlanOkresZaliczki[] {
  const starts = poczatkiOkresow(okresy);
  if (miesiac < 2 || miesiac > 12 || starts.includes(miesiac)) return okresy;
  const i = starts.filter((p) => p < miesiac).length - 1;
  const stawki = okresy.map((o) => o.stawka);
  return okresyZPoczatkow(
    [...starts.slice(0, i + 1), miesiac, ...starts.slice(i + 1)],
    [...stawki.slice(0, i + 1), stawki[i] ?? 0, ...stawki.slice(i + 1)],
  );
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
    ...(v.saldoANaFundusz === true ? { saldoANaFundusz: true } : {}),
    zaliczkaA: okresy(v.zaliczkaA),
    pozycje: Array.isArray(v.pozycje) ? normalizePozycje(v.pozycje) : pozycjeZLinii(v),
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
    wskaznik: num(v.wskaznik),
    sprawozdanieOkres: { od: String(okres.od ?? ''), do: String(okres.do ?? '') },
    zmieniono: String(v.zmieniono ?? ''),
    zmienil: String(v.zmienil ?? ''),
    pobrania: normalizePobrania(v.pobrania),
  };
}

function normalizePozycje(list: unknown[]): PlanPozycja[] {
  return list
    .filter((z): z is Record<string, unknown> => !!z && typeof z === 'object')
    .map((z) => ({
      id: typeof z.id === 'string' && z.id ? z.id : newId(),
      strona: z.strona === 'przychod' ? 'przychod' : 'koszt',
      nazwa: String(z.nazwa ?? ''),
      wiersze: Array.isArray(z.wiersze) ? z.wiersze.map(String) : [],
      grupa: String(z.grupa ?? ''),
      kwotaRoczna: num(z.kwotaRoczna),
      kwota: num(z.kwota),
      ...(typeof z.wzrost === 'number' && Number.isFinite(z.wzrost) ? { wzrost: z.wzrost } : {}),
    }));
}

/**
 * A plan saved with the form's fixed lines ("Remonty bieżące", "Reklamy" …):
 * each line becomes the statement rows it was drawn from, its amount shared
 * among them by last year's figures — no total changes. A line with an amount
 * and no rows becomes one position typed in by hand, named after the line.
 */
function pozycjeZLinii(v: Record<string, unknown>): PlanPozycja[] {
  const k = (v.koszty ?? {}) as Record<string, unknown>;
  const p = (v.przychody ?? {}) as Record<string, unknown>;
  const zrodla = (Array.isArray(v.zrodla) ? v.zrodla : []).filter(
    (z): z is Record<string, unknown> => !!z && typeof z === 'object',
  );
  const out: PlanPozycja[] = [];
  for (const kat of [...PLAN_PRZYCHODY, ...PLAN_KOSZTY] as PlanKategoria[]) {
    const strona: Strona = isKosztKategoria(kat) ? 'koszt' : 'przychod';
    const linia = num(isKosztKategoria(kat) ? k[kat] : p[kat]);
    const own = zrodla.filter((z) => z.kategoria === kat);
    const waga = own.reduce((n, z) => n + Math.abs(num(z.kwotaRoczna)), 0);
    let left = linia;
    own.forEach((z, i) => {
      const kwota =
        i === own.length - 1 ? round2(left) : round2(linia * (waga > 0 ? Math.abs(num(z.kwotaRoczna)) / waga : 1 / own.length));
      left -= kwota;
      out.push({
        id: newId(),
        strona,
        nazwa: String(z.nazwa ?? ''),
        wiersze: Array.isArray(z.wiersze) ? z.wiersze.map(String) : [String(z.nazwa ?? '')],
        grupa: '',
        kwotaRoczna: num(z.kwotaRoczna),
        kwota,
      });
    });
    if (own.length === 0 && Math.abs(linia) >= 0.01) {
      out.push({ ...newPozycja(strona), nazwa: PLAN_KATEGORIA_NAZWA[kat], kwota: linia });
    }
  }
  return out;
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
