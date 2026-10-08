/**
 * Property tax (podatek od nieruchomości) — a community's DN-1, as data and as
 * the sums the form prints. Pure, so the renderer's live summary and the main
 * process's PDF compute every figure with the same code.
 *
 * Rules read off the DN-1(1) form and its notes (podatki.gov.pl, wzór z
 * rozporządzenia MF z 30.05.2019, Dz.U. poz. 1104):
 *   • D.1 tax of a kind of land = area × rate × months covered / 12, in grosze
 *     (note 5: "proporcjonalnie do liczby miesięcy, których dotyczy deklaracja").
 *   • Poz. 97 = sum of the D parts; poz. 98 = 0 for a first declaration (cel 1);
 *     poz. 99 = 97 + 98 rounded to whole złoty, 50 gr and up rounds up (note 7).
 *   • Rates (poz. 100–111): one per month, I due 31 January, the next on the 15th
 *     of each month; each rounded to złoty and the last one evens out to poz. 99.
 *     Up to 100 zł the whole tax is paid at once, as the first rate.
 */

import {
  GruntRodzaj,
  PodatekAdres,
  PodatekGrunt,
  PodatekNieruchomosci,
  PodatekNieruchomosciDane,
  PodatekPobranie,
  PodatkiStawkiDane,
} from './types';

/** The four kinds of land of part D.1, in the form's order (poz. 33, 36, 39, 42). */
export const GRUNT_RODZAJE: GruntRodzaj[] = ['dzialalnosc', 'wody', 'pozostale', 'rewitalizacja'];

/** The forms of holding the ZDN-1 accepts (its note 5), as the form spells them. */
export const FORMY_WLADANIA = [
  'własność',
  'użytkowanie wieczyste',
  'posiadanie samoistne',
  'posiadanie zależne',
  'posiadanie bez tytułu prawnego',
] as const;

/** Rows of one ZDN-1 page — a ninth plot starts a second attachment. */
export const ZDN1_WIERSZY = 8;

/** Land under water is declared in ha (to four decimals); every other kind in m². */
export const jednostkaGruntu = (rodzaj: GruntRodzaj): 'm2' | 'ha' => (rodzaj === 'wody' ? 'ha' : 'm2');

/* ================================ Normalizing ================================ */

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Collapse runs of spaces and trim — the source spreadsheets are full of doubled spaces. */
export const czysc = (v: unknown): string => str(v).replace(/\s+/g, ' ').trim();

const liczba = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v.replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** NIP / REGON as digits only ("123-456-32-18" → "1234563218"). */
export const tylkoCyfry = (v: unknown): string => str(v).replace(/\D/g, '');

export const pustyAdres = (): PodatekAdres => ({
  kraj: '',
  wojewodztwo: '',
  powiat: '',
  gmina: '',
  ulica: '',
  nrDomu: '',
  nrLokalu: '',
  miejscowosc: '',
  kodPocztowy: '',
});

function normalizeAdres(raw: unknown): PodatekAdres {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = pustyAdres();
  for (const key of Object.keys(out) as (keyof PodatekAdres)[]) out[key] = czysc(r[key]);
  return out;
}

export const czyAdresPusty = (a: PodatekAdres): boolean => Object.values(a).every((v) => v === '');

export const pustyGrunt = (rodzaj: GruntRodzaj = 'pozostale'): PodatekGrunt => ({
  rodzaj,
  polozenie: '',
  ksiegaWieczysta: '',
  obreb: '',
  dzialka: '',
  powierzchnia: null,
  formaWladania: '',
});

function normalizeGrunt(raw: unknown): PodatekGrunt {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rodzaj = GRUNT_RODZAJE.includes(r.rodzaj as GruntRodzaj) ? (r.rodzaj as GruntRodzaj) : 'pozostale';
  const pow = liczba(r.powierzchnia);
  return {
    rodzaj,
    polozenie: czysc(r.polozenie),
    ksiegaWieczysta: czysc(r.ksiegaWieczysta),
    obreb: czysc(r.obreb),
    dzialka: czysc(r.dzialka),
    powierzchnia: pow !== null && pow >= 0 ? pow : null,
    formaWladania: czysc(r.formaWladania),
  };
}

/** A blank declaration — a community added by hand starts from this. */
export const pusteDane = (): PodatekNieruchomosciDane => ({
  organ: '',
  cel: 1,
  okresOd: 1,
  rodzajPodmiotu: 1,
  rodzajPodatnika: 3,
  nazwaPelna: '',
  nazwaSkrocona: '',
  regon: '',
  siedziba: pustyAdres(),
  doreczenia: pustyAdres(),
  grunty: [],
  kwotaNieobjeta: null,
  telefon: '',
  email: '',
  inne: '',
  reprezentant: { imie: '', nazwisko: '', dataWypelnienia: null },
  pobrania: [],
  dom: null,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stored or restored data made safe to read: every field present, every value of its type. */
export function normalizeDane(raw: unknown): PodatekNieruchomosciDane {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const base = pusteDane();
  const okres = Math.round(liczba(r.okresOd) ?? 1);
  const rep = (r.reprezentant && typeof r.reprezentant === 'object' ? r.reprezentant : {}) as Record<
    string,
    unknown
  >;
  const data = str(rep.dataWypelnienia);
  const kwota98 = liczba(r.kwotaNieobjeta);
  const dom = (r.dom && typeof r.dom === 'object' ? r.dom : null) as Record<string, unknown> | null;
  return {
    ...base,
    organ: czysc(r.organ),
    cel: r.cel === 2 ? 2 : 1,
    okresOd: okres >= 1 && okres <= 12 ? okres : 1,
    rodzajPodmiotu: r.rodzajPodmiotu === 2 ? 2 : 1,
    rodzajPodatnika: r.rodzajPodatnika === 1 || r.rodzajPodatnika === 2 ? r.rodzajPodatnika : 3,
    nazwaPelna: czysc(r.nazwaPelna),
    nazwaSkrocona: czysc(r.nazwaSkrocona),
    regon: tylkoCyfry(r.regon),
    siedziba: normalizeAdres(r.siedziba),
    doreczenia: normalizeAdres(r.doreczenia),
    grunty: Array.isArray(r.grunty) ? r.grunty.map(normalizeGrunt) : [],
    kwotaNieobjeta: kwota98 !== null && kwota98 >= 0 ? kwota98 : null,
    telefon: czysc(r.telefon),
    email: czysc(r.email),
    inne: czysc(r.inne),
    reprezentant: {
      imie: czysc(rep.imie),
      nazwisko: czysc(rep.nazwisko),
      dataWypelnienia: ISO_DATE.test(data) ? data : null,
    },
    pobrania: Array.isArray(r.pobrania)
      ? (r.pobrania as unknown[])
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map((p): PodatekPobranie => {
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
    dom: dom && str(dom.at) ? { at: str(dom.at), by: str(dom.by) } : null,
  };
}

export const pusteStawki = (): PodatkiStawkiDane => ({
  dzialalnosc: null,
  wody: null,
  pozostale: null,
  rewitalizacja: null,
});

export function normalizeStawki(raw: unknown): PodatkiStawkiDane {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = pusteStawki();
  for (const rodzaj of GRUNT_RODZAJE) {
    const n = liczba(r[rodzaj]);
    out[rodzaj] = n !== null && n >= 0 ? n : null;
  }
  return out;
}

/**
 * Next year's declaration, drafted from this one: the same community, plots and
 * contacts — but a fresh declaration (cel 1, from January), no filling date
 * and no download record. The rates come with the year, not with the record.
 */
export function daneNaKolejnyRok(d: PodatekNieruchomosciDane): PodatekNieruchomosciDane {
  return {
    ...d,
    cel: 1,
    okresOd: 1,
    kwotaNieobjeta: null,
    grunty: d.grunty.map((g) => ({ ...g })),
    siedziba: { ...d.siedziba },
    doreczenia: { ...d.doreczenia },
    reprezentant: { ...d.reprezentant, dataWypelnienia: null },
    pobrania: [],
    dom: null,
  };
}

/* ================================ Arithmetic ================================ */

/** Half-up to grosze; the epsilon keeps 1.005 from landing on 1.00. */
export const doGroszy = (x: number): number => Math.sign(x) * (Math.round(Math.abs(x) * 100 + 1e-7) / 100);

/** Half-up to whole złoty (note 7: below 50 gr drops, 50 gr and more rounds up). */
export const doZlotych = (x: number): number => Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + 1e-9);

/** Areas are summed to four places — ha are declared to four decimals. */
const sumaPowierzchni = (values: number[]): number =>
  Math.round(values.reduce((s, v) => s + v, 0) * 10000) / 10000;

export interface PozycjaD1 {
  rodzaj: GruntRodzaj;
  powierzchnia: number;
  stawka: number | null;
  /** Null while the year has no rate for this kind. */
  kwota: number | null;
}

export interface ObliczenieDN1 {
  /** Months the declaration covers: from `okresOd` to December. */
  miesiace: number;
  /** One entry per kind of land that has plots, in the form's order. */
  d1: PozycjaD1[];
  /** Kinds with plots but no rate for the year — the PDF waits for them. */
  brakujaceStawki: GruntRodzaj[];
  /** Poz. 97; null while a rate is missing. */
  kwota97: number | null;
  /** Poz. 98. */
  kwota98: number;
  /** Poz. 99; null while a rate is missing. */
  kwota99: number | null;
  /** Poz. 100–111 by month (index 0 = I rata); null = left blank on the form. */
  raty: (number | null)[];
}

/** Spread `kwota` (whole złoty) over `ile` monthly rates; the last one evens out. */
function rozloz(kwota: number, ile: number): number[] {
  if (ile <= 0) return [];
  const rata = doZlotych(kwota / ile);
  const out = Array<number>(ile).fill(rata);
  out[ile - 1] = kwota - rata * (ile - 1);
  return out;
}

/** The DN-1's figures — part D.1 and part E — for one declaration and its year's rates. */
export function obliczDN1(d: PodatekNieruchomosciDane, stawki: PodatkiStawkiDane | null): ObliczenieDN1 {
  const miesiace = 13 - d.okresOd;
  const d1: PozycjaD1[] = [];
  const brakujaceStawki: GruntRodzaj[] = [];
  for (const rodzaj of GRUNT_RODZAJE) {
    const plots = d.grunty.filter((g) => g.rodzaj === rodzaj);
    if (plots.length === 0) continue;
    const powierzchnia = sumaPowierzchni(plots.map((g) => g.powierzchnia ?? 0));
    const stawka = stawki?.[rodzaj] ?? null;
    if (stawka === null) brakujaceStawki.push(rodzaj);
    d1.push({
      rodzaj,
      powierzchnia,
      stawka,
      kwota: stawka === null ? null : doGroszy((powierzchnia * stawka * miesiace) / 12),
    });
  }

  const kwota98 = d.cel === 2 ? doGroszy(d.kwotaNieobjeta ?? 0) : 0;
  const raty: (number | null)[] = Array(12).fill(null);
  if (brakujaceStawki.length > 0) {
    return { miesiace, d1, brakujaceStawki, kwota97: null, kwota98, kwota99: null, raty };
  }

  const kwota97 = doGroszy(d1.reduce((s, p) => s + (p.kwota ?? 0), 0));
  const kwota99 = doZlotych(kwota97 + kwota98);
  if (kwota99 > 0) {
    if (kwota99 <= 100) {
      // Paid at once, on the first rate's date: a correction keeps January's.
      raty[d.cel === 2 ? 0 : d.okresOd - 1] = kwota99;
    } else {
      // A correction leaves the months it does not cover as they were — what was
      // declared for them (poz. 98) — and spreads the rest over the months it does.
      const przed = d.cel === 2 && d.okresOd > 1 ? Math.min(doZlotych(kwota98), kwota99) : 0;
      rozloz(przed, d.okresOd - 1).forEach((r, i) => (raty[i] = przed > 0 ? r : null));
      rozloz(kwota99 - przed, miesiace).forEach((r, i) => (raty[d.okresOd - 1 + i] = r));
    }
  }
  return { miesiace, d1, brakujaceStawki, kwota97, kwota98, kwota99, raty };
}

/**
 * Where a declaration is in its year's work, one answer per row: posted in DOM
 * (done), held up by what is missing, its PDF made, or ready to make it.
 */
export type StanDeklaracji = 'dom' | 'braki' | 'pobrana' | 'gotowa';

export function stanDeklaracji(rek: Pick<PodatekNieruchomosci, 'nip' | 'dane'>, stawki: PodatkiStawkiDane | null): StanDeklaracji {
  if (rek.dane.dom) return 'dom';
  if (problemyDN1(rek, stawki).length > 0) return 'braki';
  return rek.dane.pobrania.length > 0 ? 'pobrana' : 'gotowa';
}

/** Number of ZDN-1 attachments the plots need (poz. 112). */
export const liczbaZdn1 = (d: PodatekNieruchomosciDane): number => Math.ceil(d.grunty.length / ZDN1_WIERSZY);

/* ================================= Checking ================================= */

/** What stops the PDF from being printed — the renderer and the main process name it in their words. */
export type ProblemDN1 =
  | { kod: 'nip' }
  | { kod: 'nazwa' }
  | { kod: 'organ' }
  | { kod: 'grunty' }
  | { kod: 'powierzchnia'; wiersz: number }
  | { kod: 'stawka'; rodzaj: GruntRodzaj };

/** A ten-digit NIP whose check digit adds up. */
export function nipPoprawny(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const suma = wagi.reduce((s, w, i) => s + w * Number(nip[i]), 0);
  return suma % 11 === Number(nip[9]);
}

export function problemyDN1(
  rek: Pick<PodatekNieruchomosci, 'nip' | 'dane'>,
  stawki: PodatkiStawkiDane | null,
): ProblemDN1[] {
  const out: ProblemDN1[] = [];
  const d = rek.dane;
  if (!/^\d{10}$/.test(rek.nip)) out.push({ kod: 'nip' });
  if (!d.nazwaPelna) out.push({ kod: 'nazwa' });
  if (!d.organ) out.push({ kod: 'organ' });
  if (d.grunty.length === 0) out.push({ kod: 'grunty' });
  d.grunty.forEach((g, i) => {
    if (g.powierzchnia === null || g.powierzchnia <= 0) out.push({ kod: 'powierzchnia', wiersz: i + 1 });
  });
  for (const rodzaj of obliczDN1(d, stawki).brakujaceStawki) out.push({ kod: 'stawka', rodzaj });
  return out;
}

export const NAZWA_RODZAJU: Record<GruntRodzaj, string> = {
  dzialalnosc: 'związane z działalnością gospodarczą',
  wody: 'pod wodami',
  pozostale: 'pozostałe',
  rewitalizacja: 'niezabudowane objęte obszarem rewitalizacji',
};

/** The problem in Polish — for the main process, whose errors reach the user as they are. */
export function opisProblemu(p: ProblemDN1, rok: number): string {
  switch (p.kod) {
    case 'nip':
      return 'brak poprawnego NIP-u (10 cyfr)';
    case 'nazwa':
      return 'brak pełnej nazwy wspólnoty';
    case 'organ':
      return 'brak organu podatkowego (poz. 4)';
    case 'grunty':
      return 'brak gruntów do opodatkowania';
    case 'powierzchnia':
      return `brak powierzchni gruntu w wierszu ${p.wiersz}`;
    case 'stawka':
      return `brak stawki na ${rok} r. dla gruntów: ${NAZWA_RODZAJU[p.rodzaj]}`;
  }
}

/* ============================== Before signing ============================== */

/**
 * What a declaration signed in the app should not leave to the pen. Warnings
 * the signing window names, never a block — the PDF itself needs only
 * `problemyDN1` to be empty.
 */
export type UwagaPodpisu =
  /** Poz. 121–122 empty: the PDF names nobody as signing for the community. */
  | { kod: 'reprezentant' }
  /** Poz. 121–122 name someone other than the certificate's holder. */
  | { kod: 'inny'; reprezentant: string }
  /** Poz. 123 empty — `zDataPodpisu` fills it with the signing day. */
  | { kod: 'data' }
  /** Signed in the app before: this makes another signed file. */
  | { kod: 'podpisana'; at: string };

const slowa = (s: string): string[] => s.toLocaleLowerCase('pl-PL').split(/[\s-]+/).filter(Boolean);

/** `podpisujacy` — the certificate holder's name, once a certificate is picked. */
export function uwagiPodpisu(d: PodatekNieruchomosciDane, podpisujacy: string | null): UwagaPodpisu[] {
  const out: UwagaPodpisu[] = [];
  const reprezentant = czysc(`${d.reprezentant.imie} ${d.reprezentant.nazwisko}`);
  if (!reprezentant) {
    out.push({ kod: 'reprezentant' });
  } else if (podpisujacy) {
    // Every word of the form's name in the certificate's — a second given name there is fine.
    const naCertyfikacie = new Set(slowa(podpisujacy));
    if (!slowa(reprezentant).every((w) => naCertyfikacie.has(w))) out.push({ kod: 'inny', reprezentant });
  }
  if (!d.reprezentant.dataWypelnienia) out.push({ kod: 'data' });
  const podpisana = [...d.pobrania].reverse().find((p) => p.podpis);
  if (podpisana) out.push({ kod: 'podpisana', at: podpisana.at });
  return out;
}

/** A declaration signed in the app is filled in on the day it is signed: an empty poz. 123 takes that date. */
export const zDataPodpisu = (d: PodatekNieruchomosciDane, dzis: string): PodatekNieruchomosciDane =>
  d.reprezentant.dataWypelnienia ? d : { ...d, reprezentant: { ...d.reprezentant, dataWypelnienia: dzis } };

/* ================================ Formatting ================================ */

const plNumber = (n: number, min: number, max: number) =>
  n.toLocaleString('pl-PL', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true })
    // Intl groups with a no-break space; documents use a plain one.
    .replace(/[  ]/g, ' ');

/** An area as the form prints it: m² to two places at most, ha always to four. */
export const formatPowierzchnia = (n: number, rodzaj: GruntRodzaj): string =>
  rodzaj === 'wody' ? plNumber(n, 4, 4) : plNumber(n, 0, 2);

/** A rate as typed in the resolution ("0,67", "6,13"). */
export const formatStawka = (n: number): string => plNumber(n, 2, 4);

/** An amount split into the form's złoty and grosze boxes: "1 234" + "05". */
export function zlGr(n: number): { zl: string; gr: string } {
  const grosze = Math.round(Math.abs(doGroszy(n)) * 100);
  return {
    zl: plNumber(Math.floor(grosze / 100), 0, 0),
    gr: String(grosze % 100).padStart(2, '0'),
  };
}

/** Whole złoty with spaces between thousands: "12 345". */
export const formatZl = (n: number): string => plNumber(n, 0, 0);

/** The street line of an address: "AL. LOTNIKÓW 20/4". */
export function ulicaZNumerem(a: PodatekAdres): string {
  const nr = [a.nrDomu, a.nrLokalu].filter(Boolean).join('/');
  return [a.ulica, nr].filter(Boolean).join(' ');
}
