/**
 * Corporate income tax (CIT-8) of a housing community — its return as data, and
 * the figures the form prints. Pure, so the renderer's live summary and the main
 * process's PDF compute every number with the same code.
 *
 * How a community is taxed (art. 17 ust. 1 pkt 44, art. 25 ust. 4a CIT):
 *   • Income from running the housing stock (owners' advances, the repair fund)
 *     is exempt, to the extent spent on keeping that stock up.
 *   • Everything else — renting out common parts, advertising on the building,
 *     bank interest — is taxed at 9% (a small taxpayer) or 19%.
 *
 * The CIT-8 asks for ALL income and costs in D.1/D.2 (poz. 53, 63) and takes the
 * exempt income off again in poz. 97, which is copied from poz. 77 of the CIT-8/O
 * attachment. So both forms are drawn from the same split of the statement.
 *
 * Costs: a cost row belongs to the taxed income, to the exempt income, or to
 * both. A shared cost is split by the share of taxed income in all income
 * (art. 15 ust. 2). Costs of the exempt side beyond the exempt income are not
 * deducted from anything — a loss on the exempt side must not shelter the taxed
 * income. The split is shown, never hidden: every figure below can be traced to
 * statement rows and the decision made on each.
 */

import {
  CitKategoria,
  CitKlasyfikacja,
  PodatekAdres,
  CitSlownikRegula,
  CitStrona,
  PodatekCit,
  PodatekCitDane,
  PodatekCitSprawozdanie,
  PodatkiCitUstawienia,
  Sprawozdanie,
  SprawozdanieSekcja,
  SprawozdanieZapisane,
} from './types';
import { czysc, doGroszy, doZlotych, nipPoprawny, normalizeAdres, pustyAdres, tylkoCyfry } from './podatki';
import { PIT11_URZEDY, PIT4R_URZEDY_DODATKOWE } from './pit-urzedy';
import { foldText } from './plan-gospodarczy';
import { normalizeSprawozdanieDane, sprawozdaniaDlaWspolnoty } from './sprawozdanie';
import { kluczNazwy } from './adres-identyfikacja';
import { normalizeWysylki } from './e-deklaracje';

/* ============================ The e-Deklaracje form ============================ */

/**
 * The XML form of a tax year: the CIT-8 and its CIT-8/O attachment as e-Deklaracje takes them. MF issues a new
 * variant when the law changes, so each year names its own; the schemas are in scripts/cit-xsd.
 */
export interface CitWzor {
  rok: number;
  /** False for a year after the last one checked against MF's pages — the last form is assumed, with a warning. */
  potwierdzony: boolean;
  cit8: { kodSystemowy: string; wariant: number; wersjaSchemy: string; ns: string; etdNs: string };
  cit8o: { kodSystemowy: string; wariant: number; wersjaSchemy: string; ns: string };
}

/** CIT-8 (34) with CIT-8/O (20): the form of tax years from 2025 (its schema refuses an earlier period). */
const WZOR_2025: Omit<CitWzor, 'rok' | 'potwierdzony'> = {
  cit8: {
    kodSystemowy: 'CIT-8 (34)',
    wariant: 34,
    wersjaSchemy: '1-0E',
    ns: 'http://crd.gov.pl/wzor/2026/01/07/14112/',
    // The shared types (the taxpayer's NIP and name) live in MF's "DefinicjeTypy" namespace.
    etdNs: 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/',
  },
  cit8o: {
    kodSystemowy: 'CIT8/O (20)',
    wariant: 20,
    wersjaSchemy: '1-0E',
    ns: 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2025/12/30/eD/CIT8O/',
  },
};

/** Years checked against MF's list of forms (2025: CIT-8 (34), published 2026-01-07). */
const CIT_WZORY_POTWIERDZONE = [2025];

/** The form of a tax year; later years reuse the last one, flagged. None before 2025. */
export function citWzor(rok: number): CitWzor | null {
  if (!Number.isInteger(rok) || rok < 2025) return null;
  return { rok, potwierdzony: CIT_WZORY_POTWIERDZONE.includes(rok), ...WZOR_2025 };
}

/** A tax office e-Deklaracje knows for a CIT-8 (the full list, as for the PIT-4R). */
export const kodUrzeduCit = (kod: string): boolean => kod in PIT11_URZEDY || kod in PIT4R_URZEDY_DODATKOWE;

/** The seat fields the XML's address cannot be without (`TAdresPolski1`). */
export const CIT_ADRES_WYMAGANY: (keyof PodatekAdres)[] = [
  'wojewodztwo',
  'powiat',
  'gmina',
  'nrDomu',
  'miejscowosc',
  'kodPocztowy',
];

/* ================================= Categories ================================= */

export const CIT_PRZYCHODY: CitKategoria[] = ['przychod_opodatkowany', 'przychod_zwolniony', 'pomin'];
export const CIT_KOSZTY: CitKategoria[] = ['koszt_wspolny', 'koszt_opodatkowany', 'koszt_zwolniony', 'niekoszt', 'pomin'];
export const CIT_KATEGORIE: CitKategoria[] = [
  'przychod_opodatkowany',
  'przychod_zwolniony',
  'koszt_wspolny',
  'koszt_opodatkowany',
  'koszt_zwolniony',
  'niekoszt',
  'pomin',
];

/** The categories a row of the given column may take. */
export const kategorieDlaStrony = (strona: CitStrona): CitKategoria[] =>
  strona === 'przychod' ? CIT_PRZYCHODY : CIT_KOSZTY;

/** The category's name as the app's messages and documents spell it. */
export const CIT_KATEGORIA_NAZWA: Record<CitKategoria, string> = {
  przychod_opodatkowany: 'Przychód opodatkowany',
  przychod_zwolniony: 'Przychód zwolniony (gospodarka zasobami mieszkaniowymi)',
  koszt_wspolny: 'Koszt wspólny (dzielony proporcjonalnie)',
  koszt_opodatkowany: 'Koszt przychodów opodatkowanych',
  koszt_zwolniony: 'Koszt przychodów zwolnionych',
  niekoszt: 'Nie jest kosztem uzyskania przychodów',
  pomin: 'Pomiń — nie jest przepływem roku',
};

export const czyKategoriaPasuje = (k: CitKategoria, strona: CitStrona): boolean =>
  kategorieDlaStrony(strona).includes(k);

/* ================================== Dictionary ================================= */

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * [phrase, column, category] — first match wins, so specific phrases come first.
 * Read off the vDom statements the office works with. The office's budget plans
 * already treat rents of common parts as "pożytki" and vDom itself prints the
 * line "Przychody (pożytki opodat.)", so those are taxed here too. Whatever
 * the dictionary does not know is left for the AI and the accountant.
 */
const DEFAULT_RULES: [string, CitStrona, CitKategoria][] = [
  // Not flows of the year.
  ['wynik roku', 'przychod', 'pomin'],
  ['wynik roku', 'koszt', 'pomin'],
  ['rozliczenie wyniku', 'przychod', 'pomin'],
  ['rozliczenie wyniku', 'koszt', 'pomin'],
  ['bilans otwarcia', 'przychod', 'pomin'],
  ['bilans otwarcia', 'koszt', 'pomin'],
  // Taxed income: what is not the owners' charge for the upkeep.
  ['pozytki opodat', 'przychod', 'przychod_opodatkowany'],
  ['pozytki zaliczka', 'przychod', 'przychod_opodatkowany'],
  ['pozytki', 'przychod', 'przychod_opodatkowany'],
  ['reklam', 'przychod', 'przychod_opodatkowany'],
  ['anten', 'przychod', 'przychod_opodatkowany'],
  ['telekomunik', 'przychod', 'przychod_opodatkowany'],
  ['bilboard', 'przychod', 'przychod_opodatkowany'],
  ['najem', 'przychod', 'przychod_opodatkowany'],
  ['najmu', 'przychod', 'przychod_opodatkowany'],
  ['wynajem', 'przychod', 'przychod_opodatkowany'],
  ['dzierzaw', 'przychod', 'przychod_opodatkowany'],
  ['pomieszcz', 'przychod', 'przychod_opodatkowany'],
  ['pom.', 'przychod', 'przychod_opodatkowany'],
  ['piwnic', 'przychod', 'przychod_opodatkowany'],
  ['garaz', 'przychod', 'przychod_opodatkowany'],
  ['miejsce postojowe', 'przychod', 'przychod_opodatkowany'],
  ['miejsca postojowe', 'przychod', 'przychod_opodatkowany'],
  ['strych', 'przychod', 'przychod_opodatkowany'],
  ['zabudowa', 'przychod', 'przychod_opodatkowany'],
  ['korytarz', 'przychod', 'przychod_opodatkowany'],
  ['odsetki', 'przychod', 'przychod_opodatkowany'],
  // Exempt income: the owners' charges and the repair fund.
  ['zaliczka a', 'przychod', 'przychod_zwolniony'],
  ['zaliczka', 'przychod', 'przychod_zwolniony'],
  ['eksploatacja podstawowa', 'przychod', 'przychod_zwolniony'],
  ['fundusz remontowy', 'przychod', 'przychod_zwolniony'],
  // Costs.
  ['koszty funduszu remontowego', 'koszt', 'koszt_zwolniony'],
  ['obowiazkowe odpisy', 'koszt', 'niekoszt'],
  ['odpisy z wyniku', 'koszt', 'niekoszt'],
  ['kary', 'koszt', 'niekoszt'],
  ['odsetki za zwloke', 'koszt', 'niekoszt'],
];

export function defaultCitSlownik(): CitSlownikRegula[] {
  return DEFAULT_RULES.map(([fraza, strona, kategoria]) => ({ id: newId(), fraza, strona, kategoria }));
}

const DEFAULT_KLUCZE = new Set(DEFAULT_RULES.map(([fraza, strona, kategoria]) => `${foldText(fraza)}|${strona}|${kategoria}`));

/** True for a rule exactly as the built-in dictionary ships it. */
export const czyRegulaDomyslna = (r: Pick<CitSlownikRegula, 'fraza' | 'strona' | 'kategoria'>): boolean =>
  DEFAULT_KLUCZE.has(`${foldText(r.fraza)}|${r.strona}|${r.kategoria}`);

/**
 * Stamps the author on every rule that is not built-in and is new or changed
 * since the stored dictionary — so the dictionary shows who put in each rule
 * the office added. An unchanged rule keeps its stamp, or its lack of one: a
 * rule from before the stamps stays without an author rather than taking the
 * name of whoever saves next.
 */
export function oznaczAutorowRegul(
  slownik: CitSlownikRegula[],
  poprzedni: CitSlownikRegula[],
  kto: string,
  teraz: string,
): CitSlownikRegula[] {
  const byly = new Map(poprzedni.map((r) => [r.id, r]));
  return slownik.map((r) => {
    if (czyRegulaDomyslna(r)) return r;
    const p = byly.get(r.id);
    const bez = p && p.fraza === r.fraza && p.strona === r.strona && p.kategoria === r.kategoria;
    if (bez) return p.dodano ? { ...r, dodal: p.dodal, dodano: p.dodano } : { id: r.id, fraza: r.fraza, strona: r.strona, kategoria: r.kategoria };
    return { ...r, dodal: kto, dodano: teraz };
  });
}

/** What "Uzupełnij domyślne" would do to a dictionary. */
export interface CitUzupelnienie {
  slownik: CitSlownikRegula[];
  /** Built-in rules put back — their phrase was gone from the column altogether. */
  dodane: CitSlownikRegula[];
  /** Built-in phrases the office keeps under another category — left as they are. */
  zmienione: { fraza: string; strona: CitStrona; domyslna: CitKategoria; obecna: CitKategoria }[];
}

/**
 * Puts back the built-in rules whose phrase is missing from their column, each
 * right after the built-in rule before it, so the shipped order holds; the
 * office's own rules stay where they are. A built-in phrase kept under another
 * category is someone's decision and is only reported.
 */
export function uzupelnijDomyslne(slownik: CitSlownikRegula[]): CitUzupelnienie {
  const out = [...slownik];
  const dodane: CitSlownikRegula[] = [];
  const zmienione: CitUzupelnienie['zmienione'] = [];
  const klucz = (fraza: string, strona: CitStrona) => `${foldText(fraza)}|${strona}`;
  const domyslneKlucze = new Set(DEFAULT_RULES.map(([f, st]) => klucz(f, st)));
  let ostatni = -1;
  for (const [fraza, strona, kategoria] of DEFAULT_RULES) {
    const i = out.findIndex((r) => klucz(r.fraza, r.strona) === klucz(fraza, strona));
    if (i >= 0) {
      if (out[i].kategoria !== kategoria) zmienione.push({ fraza, strona, domyslna: kategoria, obecna: out[i].kategoria });
      ostatni = i;
      continue;
    }
    // Before any built-in rule is met, go in front of the first one there is — never above the office's own rules on top.
    let gdzie = ostatni + 1;
    if (ostatni < 0) {
      const pierwszy = out.findIndex((r) => domyslneKlucze.has(klucz(r.fraza, r.strona)));
      gdzie = pierwszy >= 0 ? pierwszy : out.length;
    }
    const regula: CitSlownikRegula = { id: newId(), fraza, strona, kategoria };
    out.splice(gdzie, 0, regula);
    dodane.push(regula);
    ostatni = gdzie;
  }
  return { slownik: out, dodane, zmienione };
}

export const defaultCitUstawienia = (): PodatkiCitUstawienia => ({ slownik: defaultCitSlownik() });

const isKategoria = (v: unknown): v is CitKategoria => CIT_KATEGORIE.includes(v as CitKategoria);
const isStrona = (v: unknown): v is CitStrona => v === 'przychod' || v === 'koszt';

/** Coerce stored settings — a missing or broken dictionary falls back to the defaults. */
export function normalizeCitUstawienia(value: unknown): PodatkiCitUstawienia {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (!Array.isArray(v.slownik)) return defaultCitUstawienia();
  const slownik = (v.slownik as Record<string, unknown>[])
    .filter(
      (r) =>
        r &&
        typeof r.fraza === 'string' &&
        isStrona(r.strona) &&
        isKategoria(r.kategoria) &&
        czyKategoriaPasuje(r.kategoria, r.strona as CitStrona),
    )
    .map((r) => ({
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      fraza: czysc(r.fraza),
      strona: r.strona as CitStrona,
      kategoria: r.kategoria as CitKategoria,
      ...(typeof r.dodano === 'string' && r.dodano ? { dodano: r.dodano, dodal: str(r.dodal) } : {}),
    }));
  return { slownik };
}

/* ============================= Reading the statement ============================ */

/** The two sections of a statement that carry income and costs of the year. */
export type CitSekcja = 'fundusz' | 'eksploatacja';

/** One statement row (all rows of one name added up) as the declaration sees it. */
export interface PozycjaCit {
  /** Stable key: section, column and the name folded — what the decision is stored under. */
  klucz: string;
  sekcja: CitSekcja;
  nazwa: string;
  strona: CitStrona;
  /** Sum of the amounts of every row of this name in this column. */
  kwota: number;
  /** How many printed rows the sum covers. */
  wierszy: number;
}

const kolumnaIdx = (sek: SprawozdanieSekcja, re: RegExp): number =>
  sek.kolumny.findIndex((k) => re.test(foldText(k)));

/** Rows that sum up or carry a balance forward, never a flow of their own. */
const WIERSZ_SUMUJACY = /^(razem|stan na dzien|wynik finansowy|lacznie)/;

/**
 * Income and cost rows of the statement: those of "Fundusz remontowy" and
 * "Koszty eksploatacji". Utility settlements ("Koszty świadczeń"), loans and
 * cash balances are pass-throughs and stock figures — no income or cost of the
 * community's own.
 */
export function pozycjeSprawozdania(spr: Sprawozdanie): PozycjaCit[] {
  const out = new Map<string, PozycjaCit>();
  const sekcje: [CitSekcja, RegExp][] = [
    ['fundusz', /fundusz remontowy/],
    ['eksploatacja', /koszty eksploatacji/],
  ];
  for (const [id, re] of sekcje) {
    const sek = spr.sekcje.find((s) => re.test(foldText(s.tytul)));
    if (!sek) continue;
    const kolumny: [CitStrona, number][] = [
      ['przychod', kolumnaIdx(sek, /przych/)],
      ['koszt', kolumnaIdx(sek, /koszt/)],
    ];
    for (const w of sek.wiersze) {
      const nazwa = czysc(w.nazwa);
      const folded = foldText(nazwa);
      if (!nazwa || w.podsumowanie || WIERSZ_SUMUJACY.test(folded)) continue;
      for (const [strona, col] of kolumny) {
        const kwota = col >= 0 ? w.kwoty[col] ?? null : null;
        if (kwota === null || Math.abs(kwota) < 0.005) continue;
        const klucz = `${id}|${strona}|${folded}`;
        const have = out.get(klucz);
        if (have) {
          have.kwota = doGroszy(have.kwota + kwota);
          have.wierszy += 1;
        } else {
          out.set(klucz, { klucz, sekcja: id, nazwa, strona, kwota, wierszy: 1 });
        }
      }
    }
  }
  return [...out.values()];
}

/** A statement row with its category — from the declaration's own decision, else the dictionary, else nothing. */
export interface PozycjaCitOcena extends PozycjaCit {
  /** Null = nobody has sorted this row yet. */
  kategoria: CitKategoria | null;
  /** `domyslna` = a cost no rule knew, taken as shared; it never blocks the PDF. */
  zrodlo: 'regula' | 'ai' | 'reczne' | 'domyslna' | null;
  /** False only for an AI suggestion nobody accepted. */
  potwierdzona: boolean;
  uzasadnienie: string;
  /** The return holds its own decision for the row (a pick, an AI answer, or a clearing) — "Przywróć" drops it. */
  wlasna: boolean;
}

/** The dictionary's category for a row, or null when no rule applies. */
export function kategoriaZeSlownika(
  nazwa: string,
  strona: CitStrona,
  slownik: CitSlownikRegula[],
): CitKategoria | null {
  return regulaDlaNazwy(nazwa, strona, slownik)?.kategoria ?? null;
}

export function ocenPozycje(
  pozycje: PozycjaCit[],
  slownik: CitSlownikRegula[],
  klasyfikacja: Record<string, CitKlasyfikacja>,
): PozycjaCitOcena[] {
  return pozycje.map((p) => {
    const own = klasyfikacja[p.klucz];
    if (own && own.kategoria === null) {
      return { ...p, kategoria: null, zrodlo: null, potwierdzona: false, uzasadnienie: '', wlasna: true };
    }
    if (own && own.kategoria && czyKategoriaPasuje(own.kategoria, p.strona)) {
      return {
        ...p,
        kategoria: own.kategoria,
        zrodlo: own.zrodlo,
        potwierdzona: own.potwierdzona,
        uzasadnienie: own.uzasadnienie ?? '',
        wlasna: true,
      };
    }
    const rule = kategoriaZeSlownika(p.nazwa, p.strona, slownik);
    if (rule) return { ...p, kategoria: rule, zrodlo: 'regula', potwierdzona: true, uzasadnienie: '', wlasna: false };
    // A cost no rule knows is taken as shared: the split by income share is the
    // cautious reading, and costs are far more numerous than the few that matter.
    if (p.strona === 'koszt') {
      return { ...p, kategoria: 'koszt_wspolny', zrodlo: 'domyslna', potwierdzona: true, uzasadnienie: '', wlasna: false };
    }
    return { ...p, kategoria: null, zrodlo: null, potwierdzona: false, uzasadnienie: '', wlasna: false };
  });
}

/* ============================ Reviewing the dictionary ========================== */

/**
 * One statement row name as the whole library has it: every statement and
 * every community where an income or cost row of that name (folded) stands in
 * that column. What the dictionary review lists and the AI is asked about.
 */
export interface CitPrzegladPozycja {
  /** Column and folded name — one entry per name per column across the library. */
  klucz: string;
  /** The spelling met most often. */
  nazwa: string;
  strona: CitStrona;
  /** The section it was met in most often — context for the AI. */
  sekcja: CitSekcja;
  /** Communities (by vDom number, else by name) whose statements carry it. */
  wspolnot: number;
  sprawozdan: number;
  /** Sum over every statement, for weighing what matters; never shown for an INTER-EJ name. */
  kwota: number;
  /** A few of the communities, for the tooltip. */
  przyklady: string[];
}

const PRZYKLADY = 5;

/** Every income and cost row name of the given statements, grouped by column and folded name. */
export function przegladPozycjiCit(sprawozdania: SprawozdanieZapisane[]): CitPrzegladPozycja[] {
  interface Zbior {
    pisownie: Map<string, number>;
    sekcje: Map<CitSekcja, number>;
    wspolnoty: Map<string, string>;
    sprawozdan: number;
    kwota: number;
    strona: CitStrona;
  }
  const out = new Map<string, Zbior>();
  for (const spr of sprawozdania) {
    if (!spr.dane) continue;
    const wspolnota = spr.nrWsp !== null ? `nr:${spr.nrWsp}` : `n:${foldText(spr.nazwa)}`;
    for (const p of pozycjeSprawozdania(spr.dane)) {
      const klucz = `${p.strona}|${foldText(p.nazwa)}`;
      let z = out.get(klucz);
      if (!z) {
        z = { pisownie: new Map(), sekcje: new Map(), wspolnoty: new Map(), sprawozdan: 0, kwota: 0, strona: p.strona };
        out.set(klucz, z);
      }
      z.pisownie.set(p.nazwa, (z.pisownie.get(p.nazwa) ?? 0) + 1);
      z.sekcje.set(p.sekcja, (z.sekcje.get(p.sekcja) ?? 0) + 1);
      if (!z.wspolnoty.has(wspolnota)) z.wspolnoty.set(wspolnota, spr.nazwa);
      z.sprawozdan += 1;
      z.kwota = doGroszy(z.kwota + p.kwota);
    }
  }
  const najczestszy = <K>(m: Map<K, number>): K => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return [...out.entries()]
    .map(([klucz, z]) => ({
      klucz,
      nazwa: najczestszy(z.pisownie),
      strona: z.strona,
      sekcja: najczestszy(z.sekcje),
      wspolnot: z.wspolnoty.size,
      sprawozdan: z.sprawozdan,
      kwota: z.kwota,
      przyklady: [...z.wspolnoty.values()].slice(0, PRZYKLADY),
    }))
    .sort((a, b) => b.wspolnot - a.wspolnot || Math.abs(b.kwota) - Math.abs(a.kwota));
}

/** The rule a row name falls under — the first match, as `kategoriaZeSlownika` takes it — or null. */
export function regulaDlaNazwy(nazwa: string, strona: CitStrona, slownik: CitSlownikRegula[]): CitSlownikRegula | null {
  const name = foldText(nazwa);
  for (const r of slownik) {
    const phrase = foldText(r.fraza);
    if (phrase && r.strona === strona && name.includes(phrase)) return r;
  }
  return null;
}

/* ================================== Normalizing ================================= */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

const liczba = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v.replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** A blank return — a community added by hand starts from this. */
export const pusteDaneCit = (): PodatekCitDane => ({
  nip: '',
  urzad: '',
  kodUrzedu: '',
  cel: 1,
  rodzajKorekty: null,
  nazwaPelna: '',
  siedziba: pustyAdres(),
  sprawozdanie: null,
  zaakceptowanyOkres: null,
  klasyfikacja: {},
  stawka: 9,
  zaliczkiKwartalne: false,
  zaliczki: Array(12).fill(null),
  reprezentant: { imie: '', nazwisko: '', dataWypelnienia: null },
  telefon: '',
  pobrania: [],
  wysylki: [],
  zlozone: null,
});

function normalizeKlasyfikacja(raw: unknown): Record<string, CitKlasyfikacja> {
  const out: Record<string, CitKlasyfikacja> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [klucz, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (r.kategoria === null) {
      out[klucz] = { kategoria: null, zrodlo: 'reczne', potwierdzona: true };
      continue;
    }
    if (!isKategoria(r.kategoria)) continue;
    const zrodlo = r.zrodlo === 'ai' ? 'ai' : r.zrodlo === 'regula' ? 'regula' : 'reczne';
    out[klucz] = {
      kategoria: r.kategoria,
      zrodlo,
      // An AI row stays a suggestion until accepted; a hand-made one is a decision.
      potwierdzona: zrodlo === 'ai' ? r.potwierdzona === true : true,
      ...(str(r.uzasadnienie) ? { uzasadnienie: str(r.uzasadnienie) } : {}),
    };
  }
  return out;
}

function normalizeCitSprawozdanie(raw: unknown): PodatekCitSprawozdanie | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const dane = normalizeSprawozdanieDane(r.dane);
  if (!dane) return null;
  return {
    zrodloId: liczba(r.zrodloId),
    dane,
    plikNazwa: str(r.plikNazwa),
    dodano: str(r.dodano),
    dodal: str(r.dodal),
  };
}

/** Stored or restored data made safe to read: every field present, every value of its type. */
export function normalizeDaneCit(raw: unknown): PodatekCitDane {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const base = pusteDaneCit();
  const rep = (r.reprezentant && typeof r.reprezentant === 'object' ? r.reprezentant : {}) as Record<string, unknown>;
  const data = str(rep.dataWypelnienia);
  const zlozone = (r.zlozone && typeof r.zlozone === 'object' ? r.zlozone : null) as Record<string, unknown> | null;
  const zaliczki = Array.isArray(r.zaliczki) ? r.zaliczki : [];
  const cel = r.cel === 2 ? 2 : 1;
  return {
    ...base,
    nip: tylkoCyfry(r.nip),
    urzad: czysc(r.urzad),
    kodUrzedu: tylkoCyfry(r.kodUrzedu).slice(0, 4),
    cel,
    rodzajKorekty: cel === 2 ? (r.rodzajKorekty === 2 ? 2 : 1) : null,
    nazwaPelna: czysc(r.nazwaPelna),
    siedziba: normalizeAdres(r.siedziba),
    sprawozdanie: normalizeCitSprawozdanie(r.sprawozdanie),
    zaakceptowanyOkres: /^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/.test(str(r.zaakceptowanyOkres))
      ? str(r.zaakceptowanyOkres)
      : null,
    klasyfikacja: normalizeKlasyfikacja(r.klasyfikacja),
    stawka: r.stawka === 19 ? 19 : 9,
    zaliczkiKwartalne: r.zaliczkiKwartalne === true,
    zaliczki: base.zaliczki.map((_, i) => {
      const n = liczba(zaliczki[i]);
      return n !== null && n >= 0 ? Math.round(n) : null;
    }),
    reprezentant: {
      imie: czysc(rep.imie),
      nazwisko: czysc(rep.nazwisko),
      dataWypelnienia: ISO_DATE.test(data) ? data : null,
    },
    telefon: czysc(r.telefon),
    pobrania: Array.isArray(r.pobrania)
      ? (r.pobrania as unknown[])
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map((p) => {
            const podpis = p.podpis && typeof p.podpis === 'object' ? (p.podpis as Record<string, unknown>) : null;
            return {
              at: str(p.at),
              by: str(p.by),
              plik: str(p.plik),
              ...(podpis && str(podpis.podmiot)
                ? {
                    podpis: {
                      podmiot: str(podpis.podmiot),
                      wystawca: str(podpis.wystawca),
                      numerSeryjny: str(podpis.numerSeryjny),
                    },
                  }
                : {}),
            };
          })
      : [],
    wysylki: normalizeWysylki(r.wysylki),
    zlozone: zlozone && str(zlozone.at) ? { at: str(zlozone.at), by: str(zlozone.by) } : null,
  };
}

/**
 * Next year's return, drafted from this one: the same community, office,
 * signer and contacts — but a fresh return, with no statement (it belongs to
 * the year it was drawn for), no decisions, no advances, no download record.
 */
export function daneCitNaKolejnyRok(d: PodatekCitDane): PodatekCitDane {
  return {
    ...pusteDaneCit(),
    nip: d.nip,
    urzad: d.urzad,
    kodUrzedu: d.kodUrzedu,
    nazwaPelna: d.nazwaPelna,
    siedziba: { ...d.siedziba },
    stawka: d.stawka,
    zaliczkiKwartalne: d.zaliczkiKwartalne,
    reprezentant: { ...d.reprezentant, dataWypelnienia: null },
    telefon: d.telefon,
  };
}

/* ================================== Arithmetic ================================== */

export interface ObliczenieCIT8 {
  /** Statement rows split by category, in złoty and grosze. */
  przychodyOpodatkowane: number;
  przychodyZwolnione: number;
  /** Costs belonging to the taxed income: its own plus its share of the shared ones. */
  kosztyOpodatkowane: number;
  /** Costs of the exempt side, as far as the exempt income covers them — they are on the form. */
  kosztyZwolnione: number;
  /** Costs of the exempt side beyond its income — on no line of the form. */
  kosztyPonadZwolnione: number;
  /** Costs left out as not deductible. */
  kosztyNiezaliczone: number;
  /** The shared costs before the split. */
  kosztyWspolne: number;
  /** Taxed income's share in all income, 0–1. */
  udzialOpodatkowany: number;
  /** Exempt income (CIT-8 poz. 97, CIT-8/O poz. 38 and 77). */
  dochodZwolniony: number;
  /** Taxed income less its costs; negative = a loss on the taxed side. */
  dochodOpodatkowany: number;
  /** Whether the CIT-8/O attachment has anything to say. */
  cit8o: boolean;
  /**
   * The amounts the CIT-8 prints, by item number. Whole złoty where the form
   * asks for them (138–140, 148, 247–250, 259, 260), złoty and grosze otherwise.
   */
  poz: Record<number, number>;
  /** Tax due after deductions, whole złoty (poz. 148). */
  podatek: number;
  /** Advances paid, whole złoty (poz. 246). */
  zaliczkiZaplacone: number;
  /** Poz. 259 — zero when an advance covered it. */
  doZaplaty: number;
  /** Poz. 260. */
  nadplata: number;
  /** Poz. 115/141 — a loss of the taxed side. */
  strata: number;
}

const zero = (n: number) => (Math.abs(n) < 0.005 ? 0 : n);
const dodatnie = (n: number) => Math.max(0, n);

/** The CIT-8's figures for one return, from its classified statement rows. */
export function obliczCIT8(d: PodatekCitDane, pozycje: PozycjaCitOcena[]): ObliczenieCIT8 {
  let pO = 0;
  let pZ = 0;
  let kO = 0;
  let kZ = 0;
  let kW = 0;
  let kN = 0;
  for (const p of pozycje) {
    switch (p.kategoria) {
      case 'przychod_opodatkowany':
        pO += p.kwota;
        break;
      case 'przychod_zwolniony':
        pZ += p.kwota;
        break;
      case 'koszt_opodatkowany':
        kO += p.kwota;
        break;
      case 'koszt_zwolniony':
        kZ += p.kwota;
        break;
      case 'koszt_wspolny':
        kW += p.kwota;
        break;
      case 'niekoszt':
        kN += p.kwota;
        break;
      default:
        break;
    }
  }
  pO = doGroszy(pO);
  pZ = doGroszy(pZ);
  const razem = pO + pZ;
  const udzial = razem > 0 ? pO / razem : 0;
  const wspolneO = doGroszy(kW * udzial);
  const wspolneZ = doGroszy(kW - wspolneO);
  const kosztyO = doGroszy(kO + wspolneO);
  const kosztyZall = doGroszy(kZ + wspolneZ);
  // The exempt side's costs count only up to its income: a loss there is nobody's deduction.
  const kosztyZ = doGroszy(Math.min(kosztyZall, Math.max(0, pZ)));
  const ponad = doGroszy(kosztyZall - kosztyZ);
  const dochodZ = doGroszy(Math.max(0, pZ) - kosztyZ);

  const p53 = doGroszy(razem);
  const p63 = doGroszy(kosztyO + kosztyZ);
  const dochod79 = doGroszy(dodatnie(p53 - p63));
  const strata81 = doGroszy(dodatnie(p63 - p53));
  // D.3/D.4 hold nothing else for a community, so each step is the one before.
  const p95 = dochod79;
  const p91 = strata81;
  const p97 = dochodZ;
  const p99 = doGroszy(dodatnie(p95 - p97));
  const p113 = p97;
  // E.2 — the form's own formulas for poz. 114 and 115.
  const p114 = p95 > 0 ? doGroszy(dodatnie(p95 - p113)) : 0;
  const p115 = p91 > 0 ? doGroszy(p91 + p113 - p95) : 0;
  const p120 = p114;
  const p131 = p120;
  const p132 = p115;
  const p138 = p131 > 0 ? doZlotych(p131) : 0;
  const p139 = d.stawka === 19 ? p138 : 0;
  const p140 = d.stawka === 9 ? p138 : 0;
  const p141 = p131 > 0 ? 0 : doGroszy(p132);
  const p143 = doGroszy(p139 * 0.19);
  const p144 = doGroszy(p140 * 0.09);
  const p146 = doGroszy(p143 + p144);
  const p148 = doZlotych(p146);

  const zaliczki = d.zaliczki.map((z) => z ?? 0);
  const p246 = zaliczki.reduce((s, z) => s + z, 0);
  // The advance due is taken as the advance paid — the app has no other source for it.
  const p228 = p246;
  const p247 = doZlotych(dodatnie(p148 - p228));
  const p248 = doZlotych(dodatnie(p228 - p148));
  const p250 = p246;
  const p259 = doZlotych(dodatnie(p148 - p250));
  const p260 = doZlotych(dodatnie(p250 - p148));

  const poz: Record<number, number> = {
    53: p53,
    61: p53,
    63: p63,
    77: p63,
    79: dochod79,
    81: strata81,
    85: dochod79,
    87: strata81,
    91: p91,
    93: 0,
    95: p95,
    97: p97,
    99: p99,
    113: p113,
    114: p114,
    115: p115,
    120: p120,
    131: p131,
    132: p132,
    138: p138,
    139: p139,
    140: p140,
    141: p141,
    143: p143,
    144: p144,
    146: p146,
    148: p148,
    228: p228,
    246: p246,
    247: p247,
    248: p248,
    250: p250,
    259: p259,
    260: p260,
  };
  // Poz. 60 and 76 are the capital-gains twins of 61 and 77 — empty for a community.
  return {
    przychodyOpodatkowane: pO,
    przychodyZwolnione: pZ,
    kosztyOpodatkowane: kosztyO,
    kosztyZwolnione: kosztyZ,
    kosztyPonadZwolnione: ponad,
    kosztyNiezaliczone: doGroszy(kN),
    kosztyWspolne: doGroszy(kW),
    udzialOpodatkowany: udzial,
    dochodZwolniony: p97,
    dochodOpodatkowany: doGroszy(pO - kosztyO),
    cit8o: p97 > 0,
    poz,
    podatek: p148,
    zaliczkiZaplacone: p246,
    doZaplaty: p259,
    nadplata: p260,
    strata: zero(p115),
  };
}

/* ================================== Checking ================================== */

/** What stops the PDF from being printed — the renderer and the main process name it in their words. */
export type ProblemCit8 =
  | { kod: 'nip' }
  | { kod: 'nazwa' }
  | { kod: 'urzad' }
  | { kod: 'sprawozdanie' }
  /** The statement does not span the tax year, 1 January to 31 December. */
  | { kod: 'okres'; od: string; do: string }
  /** Income rows nobody has sorted yet. */
  | { kod: 'nieposortowane'; ile: number }
  /** AI suggestions waiting for a decision. */
  | { kod: 'niepotwierdzone'; ile: number }
  | { kod: 'korekta' }
  /* What only the XML needs — the PDF prints without it. */
  /** No e-Deklaracje form for the year (before 2025). */
  | { kod: 'wzor' }
  /** The NIP fails its check digit or the schema's pattern. */
  | { kod: 'nipXml' }
  /** No office code, or one e-Deklaracje does not know. */
  | { kod: 'kodUrzedu'; kodUrz: string }
  /** Seat fields the XML requires, empty. */
  | { kod: 'adres'; pola: (keyof PodatekAdres)[] }
  /** A postcode not in the dd-ddd form. */
  | { kod: 'kodPocztowy' };

/** What an accepted partial period is remembered as. */
export const okresKlucz = (spr: Pick<Sprawozdanie, 'okresOd' | 'okresDo'>): string => `${spr.okresOd}|${spr.okresDo}`;

/** The statement spans the whole calendar year `rok`. */
export const okresPelny = (spr: Sprawozdanie, rok: number): boolean =>
  spr.okresOd === `${rok}-01-01` && spr.okresDo === `${rok}-12-31`;

/** The rows of a return's statement, each with its category. */
export const pozycjeZeSprawozdania = (d: PodatekCitDane, slownik: CitSlownikRegula[]): PozycjaCitOcena[] =>
  d.sprawozdanie ? ocenPozycje(pozycjeSprawozdania(d.sprawozdanie.dane), slownik, d.klasyfikacja) : [];

export function problemyCIT8(
  rek: Pick<PodatekCit, 'rok' | 'dane'>,
  slownik: CitSlownikRegula[],
): ProblemCit8[] {
  const out: ProblemCit8[] = [];
  const d = rek.dane;
  if (!/^\d{10}$/.test(d.nip)) out.push({ kod: 'nip' });
  if (!d.nazwaPelna) out.push({ kod: 'nazwa' });
  if (!d.urzad) out.push({ kod: 'urzad' });
  if (d.cel === 2 && d.rodzajKorekty === null) out.push({ kod: 'korekta' });
  if (!d.sprawozdanie) {
    out.push({ kod: 'sprawozdanie' });
    return out;
  }
  const spr = d.sprawozdanie.dane;
  if (!okresPelny(spr, rek.rok) && d.zaakceptowanyOkres !== okresKlucz(spr)) {
    out.push({ kod: 'okres', od: spr.okresOd, do: spr.okresDo });
  }
  const oceny = pozycjeZeSprawozdania(d, slownik);
  const bez = oceny.filter((p) => p.kategoria === null).length;
  if (bez > 0) out.push({ kod: 'nieposortowane', ile: bez });
  const ai = oceny.filter((p) => p.zrodlo === 'ai' && !p.potwierdzona).length;
  if (ai > 0) out.push({ kod: 'niepotwierdzone', ile: ai });
  return out;
}

/** The problems only the XML has — the PDF prints without these. */
const TYLKO_XML = new Set<ProblemCit8['kod']>(['wzor', 'nipXml', 'kodUrzedu', 'adres', 'kodPocztowy']);
export const problemTylkoXml = (p: ProblemCit8): boolean => TYLKO_XML.has(p.kod);

/** Polish postcodes as the XML wants them. */
const KOD_POCZTOWY = /^\d{2}-\d{3}$/;

/**
 * What stops the XML for e-Deklaracje — and with it the signing — on top of what stops the PDF: the office
 * code, a NIP the schema accepts, and a seat address with every part the schema requires.
 */
export function problemyCIT8Xml(
  rek: Pick<PodatekCit, 'rok' | 'dane'>,
  slownik: CitSlownikRegula[],
): ProblemCit8[] {
  const out = problemyCIT8(rek, slownik);
  const d = rek.dane;
  if (!citWzor(rek.rok)) out.push({ kod: 'wzor' });
  if (/^\d{10}$/.test(d.nip) && !nipPoprawny(d.nip)) out.push({ kod: 'nipXml' });
  if (!kodUrzeduCit(d.kodUrzedu)) out.push({ kod: 'kodUrzedu', kodUrz: d.kodUrzedu });
  const pola = CIT_ADRES_WYMAGANY.filter((k) => !d.siedziba[k]);
  if (pola.length > 0) out.push({ kod: 'adres', pola });
  if (d.siedziba.kodPocztowy && !KOD_POCZTOWY.test(d.siedziba.kodPocztowy)) out.push({ kod: 'kodPocztowy' });
  return out;
}

const ADRES_POLE: Record<keyof PodatekAdres, string> = {
  kraj: 'kraj',
  wojewodztwo: 'województwo',
  powiat: 'powiat',
  gmina: 'gmina',
  ulica: 'ulica',
  nrDomu: 'nr domu',
  nrLokalu: 'nr lokalu',
  miejscowosc: 'miejscowość',
  kodPocztowy: 'kod pocztowy',
};

/** The problem in Polish — for the main process, whose errors reach the user as they are. */
export function opisProblemuCit(p: ProblemCit8, rok: number): string {
  switch (p.kod) {
    case 'nip':
      return 'brak poprawnego NIP-u (10 cyfr)';
    case 'nazwa':
      return 'brak pełnej nazwy wspólnoty';
    case 'urzad':
      return 'brak urzędu skarbowego (poz. 6)';
    case 'korekta':
      return 'brak rodzaju korekty (poz. 8)';
    case 'sprawozdanie':
      return `brak sprawozdania finansowego za ${rok} r.`;
    case 'okres':
      return `sprawozdanie obejmuje ${p.od} – ${p.do}, a zeznanie dotyczy całego ${rok} r.`;
    case 'nieposortowane':
      return `${p.ile} pozycji sprawozdania czeka na przypisanie do kategorii`;
    case 'niepotwierdzone':
      return `${p.ile} propozycji AI czeka na potwierdzenie`;
    case 'wzor':
      return `dla ${rok} r. nie ma wzoru XML CIT-8 (e-Deklaracje przyjmują CIT-8 (34) od 2025 r.)`;
    case 'nipXml':
      return 'NIP nie przechodzi kontroli cyfry kontrolnej';
    case 'kodUrzedu':
      return p.kodUrz ? `urzędu skarbowego o kodzie ${p.kodUrz} nie ma na liście MF` : 'brak kodu urzędu skarbowego';
    case 'adres':
      return `adres siedziby bez pól: ${p.pola.map((k) => ADRES_POLE[k]).join(', ')}`;
    case 'kodPocztowy':
      return 'kod pocztowy siedziby nie ma postaci 00-000';
  }
}

/**
 * Where a return is in its year's work, one answer per row: filed (done), held
 * up by what is missing, its PDF made, or ready to make it.
 */
export type StanCit = 'zlozone' | 'braki' | 'pobrana' | 'gotowa';

export function stanCit(rek: Pick<PodatekCit, 'rok' | 'dane'>, slownik: CitSlownikRegula[]): StanCit {
  if (rek.dane.zlozone) return 'zlozone';
  // Filed through e-Deklaracje: a return whose XML cannot be made yet is not ready, whatever its PDF.
  if (problemyCIT8Xml(rek, slownik).length > 0) return 'braki';
  return rek.dane.pobrania.length > 0 ? 'pobrana' : 'gotowa';
}

/**
 * The library statement a community's return for `rok` is drawn from: the one
 * covering the whole year (01.01–31.12), else the latest one that lies within
 * the year (a partial period — the return stays blocked until a person accepts
 * it). Matched by the community's vDom number when one is remembered, else by
 * name, and when neither finds anything by the name stripped of "Wspólnota
 * Mieszkaniowa", "Al.", dots and spaces — so "Al. Lotników 20" finds "Wspólnota
 * Mieszkaniowa AL.LOTNIKÓW 20". Newest import first when a period was uploaded
 * twice.
 */
export function sprawozdanieDlaRoku(
  lista: SprawozdanieZapisane[],
  vdomNr: number | null,
  nazwy: string[],
  rok: number,
): SprawozdanieZapisane | null {
  const wybierz = (kandydaci: SprawozdanieZapisane[]) => {
    const pelne = kandydaci.find((s) => s.okresOd === `${rok}-01-01` && s.okresDo === `${rok}-12-31`);
    if (pelne) return pelne;
    const wRoku = kandydaci
      .filter((s) => s.okresOd.startsWith(`${rok}-`) && s.okresDo.startsWith(`${rok}-`))
      .sort((a, b) => b.okresDo.localeCompare(a.okresDo) || b.importedAt.localeCompare(a.importedAt));
    return wRoku[0] ?? null;
  };
  const trafione = wybierz(sprawozdaniaDlaWspolnoty(lista, vdomNr, nazwy));
  if (trafione) return trafione;
  // A remembered number that finds nothing for this year may simply be wrong — the name still tells.
  const klucze = nazwy.map(kluczNazwy).filter(Boolean);
  return wybierz(lista.filter((s) => klucze.includes(kluczNazwy(s.nazwa))));
}

/** The return's deadline — the end of March of the year after (art. 27 ust. 1). */
export const terminCit = (rok: number): string => `${rok + 1}-03-31`;
