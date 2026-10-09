/**
 * Personal income tax (PIT) of the housing communities as the payer — the PIT-11 of every person a community
 * paid (board members, caretakers, the one manager) and the community's yearly PIT-4R. As data, and the
 * figures the forms print. Pure, so the renderer's live summary, the XML and the PDF of the main process
 * compute every number with the same code.
 *
 * What the data says (read off the 2024 files of the office, forms PIT-11 (29) and PIT-4R (13)):
 *   • Board members (`zarzad`) go into part F only — a community that is not a payer (art. 42a) reports
 *     the income, withholds nothing. The e-Formularz also gets zeros in poz. 90/92/94.
 *   • Caretakers work on a mandate (`zlecenie`, row 6, poz. 58–61): costs 20% up to 3 000 zł a year (3 600 with
 *     the increased costs), the advance and the ZUS / health contributions come from the payroll.
 *   • Employment (`etat`, row 1, poz. 28–33) — same cost limit, the advance from the payroll.
 *   • One person (`art13`, row 5, poz. 54–57) is paid per community with art. 13 pkt 2, 4–9 income: costs 20%,
 *     advance 12% of the income rounded to whole złoty — all of it follows from the amount.
 *   • The PIT-4R sums the advances of the PIT-11s month by month, so it is entered by month (the PIT-11s
 *     hold only yearly sums) and checked against them — a PIT-4R that disagrees with its PIT-11s is what
 *     the office had to correct in 2026.
 */

import type { PodatekPobranie } from './types';
import { PIT11_URZEDY, PIT4R_URZEDY_DODATKOWE } from './pit-urzedy';
import { czysc, doGroszy, doZlotych, tylkoCyfry } from './podatki';

/* ================================ Form versions ================================ */

/**
 * The forms of one tax year as e-Deklaracje knows them. `potwierdzony: false` — the version is assumed
 * unchanged from the last one confirmed (MF had not published the form of that year when this was written);
 * the e-Deklaracje gateway checks the file against its schema anyway, so a wrong assumption costs a rejected
 * file, not a wrong filing.
 */
export interface PitWzor {
  rok: number;
  potwierdzony: boolean;
  pit11: { kodSystemowy: string; wariant: number; wersjaSchemy: string; ns: string; ordZuNs: string; ordZuWersja: string };
  pit4r: { kodSystemowy: string; wariant: number; wersjaSchemy: string; ns: string; ordZuNs: string; ordZuWersja: string };
}

const WZOR_2024: Omit<PitWzor, 'rok' | 'potwierdzony'> = {
  pit11: {
    kodSystemowy: 'PIT-11 (29)',
    wariant: 29,
    wersjaSchemy: '4-0E',
    ns: 'http://crd.gov.pl/wzor/2024/10/15/13535/',
    ordZuNs: 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2024/07/08/eD/ORDZU/',
    ordZuWersja: '11-0E',
  },
  pit4r: {
    kodSystemowy: 'PIT-4R (13)',
    wariant: 13,
    wersjaSchemy: '1-0E',
    ns: 'http://crd.gov.pl/wzor/2023/11/07/12978/',
    ordZuNs: 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/ORDZU/',
    ordZuWersja: '10-0E',
  },
};

/** Years confirmed against MF's pages (2024: the filed files; 2025: PIT-11 (29) and PIT-4R (13) unchanged). */
const PIT_WZORY_POTWIERDZONE = [2024, 2025];

/**
 * The form of a tax year. Years after the last confirmed one reuse its form, flagged; years before 2024 have
 * none (the 2023 income was reported on other variants) — null, and the module refuses to generate.
 */
export function pitWzor(rok: number): PitWzor | null {
  if (!Number.isInteger(rok) || rok < 2024) return null;
  return { rok, potwierdzony: PIT_WZORY_POTWIERDZONE.includes(rok), ...WZOR_2024 };
}

/* ================================== Types =================================== */

/** The title of the income — where on the PIT-11 it goes. */
export type PitTytul = 'zarzad' | 'zlecenie' | 'etat' | 'art13';

export const PIT_TYTULY: PitTytul[] = ['zarzad', 'zlecenie', 'etat', 'art13'];

export const PIT_TYTUL_OPIS: Record<PitTytul, string> = {
  zarzad: 'Zarząd (część F)',
  zlecenie: 'Umowa zlecenia (wiersz 6)',
  etat: 'Stosunek pracy (wiersz 1)',
  art13: 'Art. 13 pkt 2, 4–9 (wiersz 5)',
};

/** Poz. 14 of the PIT-11 — what the foreign number is (XSD `TRodzajId`). */
export const PIT_RODZAJE_NR_ID: { id: number; opis: string }[] = [
  { id: 1, opis: 'numer identyfikacyjny TIN' },
  { id: 2, opis: 'numer ubezpieczeniowy' },
  { id: 3, opis: 'paszport' },
  { id: 4, opis: 'urzędowy dokument stwierdzający tożsamość' },
  { id: 8, opis: 'inny' },
];

/** The taxpayer's address (poz. 19–27); the country is always Poland here. */
export interface PitAdres {
  wojewodztwo: string;
  powiat: string;
  ulica: string;
  nrDomu: string;
  nrLokalu: string;
  miejscowosc: string;
  kodPocztowy: string;
}

/** "Złożone w MF" — a statement of the user, with the reference number the e-Deklaracje gateway returned. */
export interface PitZlozone {
  at: string;
  by: string;
  numerRef: string;
}

export interface PitZarzad {
  /** Poz. 99 — what the money was for, as printed ("WYNAGRODZENIE CZŁONKA ZARZĄDU WSPÓLNOTY MIESZKANIOWEJ"). */
  opis: string;
  /** Poz. 100 / 105 — the year's amount. Null = not entered yet. */
  kwota: number | null;
}

export interface PitZlecenie {
  /** Poz. 58. */
  przychod: number | null;
  /** Poz. 59 — null = the rule (20%, up to the yearly limit). */
  koszty: number | null;
  /** Poz. 61 — whole złoty, from the payroll. */
  zaliczka: number | null;
}

export interface PitEtat {
  /** Poz. 29. */
  przychod: number | null;
  /** Poz. 30 — null = up to the yearly limit. */
  koszty: number | null;
  /** Poz. 33 — whole złoty, from the payroll. */
  zaliczka: number | null;
}

export interface PitArt13 {
  /** Poz. 54 — the only figure typed; costs, income and advance follow. */
  przychod: number | null;
  /** Poz. 57 — null = 12% of the income, rounded to whole złoty. */
  zaliczka: number | null;
}

/** One person paid by the community in the year — one PIT-11 (or its correction). */
export interface PitOsoba {
  /** Identifies the row inside the community's list; survives editing. */
  klucz: string;
  imie: string;
  nazwisko: string;
  /** "2024-10-31"; null = not known. */
  dataUrodzenia: string | null;
  /** Digits only. At least one of PESEL / NIP, or a foreign number, must be given. */
  pesel: string;
  nip: string;
  /** Poz. 13–15 — foreign number, its kind (`PIT_RODZAJE_NR_ID`) and the country that issued it. */
  nrId: string;
  rodzajNrId: number | null;
  krajWydania: string;
  adres: PitAdres;
  /** KodUrzedu of the PIT-11 — the taxpayer's tax office, not the community's. */
  urzad: string;
  zarzad: PitZarzad | null;
  zlecenie: PitZlecenie | null;
  etat: PitEtat | null;
  art13: PitArt13 | null;
  /** Poz. 95 — social security contributions deducted, as the payroll has them. */
  skladki: number | null;
  /** Poz. 122 — health insurance contributions withheld (up to 9%). */
  zdrowotna: number | null;
  /** The increased cost limit applies (3 600 zł instead of 3 000 zł a year). */
  kosztyPodwyzszone: boolean;
  /** Poz. 7 — 1 first filing, 2 correction. */
  cel: 1 | 2;
  /** ORD-ZU, poz. 13 — why the correction is filed. */
  przyczyna: string;
  /** Things the import found wrong in the source and fixed or left — blocks the filing until ticked off. */
  przeglad: string[];
  uwagi: string;
  zlozone: PitZlozone | null;
  /** Every XML / PDF made of this PIT-11, oldest first. */
  pobrania: PodatekPobranie[];
}

/** Twelve months, January first; null = nothing entered. */
export type PitMiesiace = (number | null)[];

/** The community's PIT-4R — advances by month. */
export interface PitPit4R {
  /** Poz. 6 — 1 first filing, 2 correction. */
  cel: 1 | 2;
  /** Poz. 7 — kind of correction: 1 = correction under art. 81 Ordynacji podatkowej (what the office files), 2 = the other kind, filed with a justification. */
  rodzajKorekty: 1 | 2;
  przyczyna: string;
  /** Row 1 — employees: how many taxpayers each month (poz. 10–15, 22–27) and the advances (poz. 16–21, 28–33). */
  etatLiczba: PitMiesiace;
  etatKwota: PitMiesiace;
  /** Row 3 — art. 41: the advances on rows 5 and 6 of the PIT-11s (poz. 46–57). */
  art41: PitMiesiace;
  /** Row 4 — other (poz. 58–69). */
  inne: PitMiesiace;
  /** Part D — reduction of the tax to pay by art. 26eb (poz. 159–170). Normally empty. */
  pomniejszenie: PitMiesiace;
  zlozone: PitZlozone | null;
  pobrania: PodatekPobranie[];
  przeglad: string[];
}

/** Everything one community's PIT says for one year. */
export interface PitDane {
  /** The payer's full name as printed (poz. 9) — uppercase in the files of the office. */
  nazwa: string;
  /** KodUrzedu of the PIT-4R — the community's own office. */
  urzadPlatnika: string;
  osoby: PitOsoba[];
  /** Null = no PIT-4R this year (nothing was withheld). */
  pit4r: PitPit4R | null;
}

/** One community's PIT for one tax year. NIP and year tell rows apart. */
export interface PodatekPit {
  id: number;
  /** The payer's NIP, digits only. */
  nip: string;
  rok: number;
  dane: PitDane;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/* =============================== Normalizing ================================ */

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

const liczba = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v.replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const kwota = (v: unknown): number | null => {
  const n = liczba(v);
  return n === null || n < 0 ? null : doGroszy(n);
};

const zlote = (v: unknown): number | null => {
  const n = liczba(v);
  return n === null || n < 0 ? null : doZlotych(n);
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export const pustyAdresPit = (): PitAdres => ({
  wojewodztwo: '',
  powiat: '',
  ulica: '',
  nrDomu: '',
  nrLokalu: '',
  miejscowosc: '',
  kodPocztowy: '',
});

function normalizeAdresPit(raw: unknown): PitAdres {
  const r = obj(raw);
  const out = pustyAdresPit();
  for (const key of Object.keys(out) as (keyof PitAdres)[]) out[key] = czysc(r[key]);
  return out;
}

export const pusteMiesiace = (): PitMiesiace => Array.from({ length: 12 }, () => null);

function normalizeMiesiace(raw: unknown): PitMiesiace {
  const out = pusteMiesiace();
  if (Array.isArray(raw)) for (let i = 0; i < 12; i++) out[i] = zlote(raw[i]);
  return out;
}

/** A key unique inside one community's list. */
export const nowyKlucz = (): string => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const pustaOsoba = (): PitOsoba => ({
  klucz: nowyKlucz(),
  imie: '',
  nazwisko: '',
  dataUrodzenia: null,
  pesel: '',
  nip: '',
  nrId: '',
  rodzajNrId: null,
  krajWydania: '',
  adres: pustyAdresPit(),
  urzad: '',
  zarzad: null,
  zlecenie: null,
  etat: null,
  art13: null,
  skladki: null,
  zdrowotna: null,
  kosztyPodwyzszone: false,
  cel: 1,
  przyczyna: '',
  przeglad: [],
  uwagi: '',
  zlozone: null,
  pobrania: [],
});

export const OPIS_ZARZADU = 'WYNAGRODZENIE CZŁONKA ZARZĄDU WSPÓLNOTY MIESZKANIOWEJ';

function normalizePobrania(raw: unknown): PodatekPobranie[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const r = obj(p);
      const podpis = obj(r.podpis);
      return {
        at: str(r.at),
        by: str(r.by),
        plik: str(r.plik),
        ...(r.podpis
          ? { podpis: { podmiot: str(podpis.podmiot), wystawca: str(podpis.wystawca), numerSeryjny: str(podpis.numerSeryjny) } }
          : {}),
      };
    })
    .filter((p) => p.plik !== '');
}

function normalizeZlozone(raw: unknown): PitZlozone | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = obj(raw);
  return { at: str(r.at), by: str(r.by), numerRef: czysc(r.numerRef) };
}

export function normalizeOsoba(raw: unknown): PitOsoba {
  const r = obj(raw);
  const base = pustaOsoba();
  const z = obj(r.zarzad);
  const zl = obj(r.zlecenie);
  const et = obj(r.etat);
  const a13 = obj(r.art13);
  const data = str(r.dataUrodzenia).slice(0, 10);
  const rodzaj = liczba(r.rodzajNrId);
  return {
    klucz: str(r.klucz) || base.klucz,
    imie: czysc(r.imie),
    nazwisko: czysc(r.nazwisko),
    dataUrodzenia: ISO_DATE.test(data) ? data : null,
    pesel: tylkoCyfry(r.pesel),
    nip: tylkoCyfry(r.nip),
    nrId: czysc(r.nrId),
    rodzajNrId: rodzaj !== null && PIT_RODZAJE_NR_ID.some((x) => x.id === rodzaj) ? rodzaj : null,
    krajWydania: czysc(r.krajWydania).toUpperCase(),
    adres: normalizeAdresPit(r.adres),
    urzad: tylkoCyfry(r.urzad).slice(0, 4),
    zarzad: r.zarzad ? { opis: czysc(z.opis) || OPIS_ZARZADU, kwota: kwota(z.kwota) } : null,
    zlecenie: r.zlecenie ? { przychod: kwota(zl.przychod), koszty: kwota(zl.koszty), zaliczka: zlote(zl.zaliczka) } : null,
    etat: r.etat ? { przychod: kwota(et.przychod), koszty: kwota(et.koszty), zaliczka: zlote(et.zaliczka) } : null,
    art13: r.art13 ? { przychod: kwota(a13.przychod), zaliczka: zlote(a13.zaliczka) } : null,
    skladki: kwota(r.skladki),
    zdrowotna: kwota(r.zdrowotna),
    kosztyPodwyzszone: r.kosztyPodwyzszone === true,
    cel: r.cel === 2 ? 2 : 1,
    przyczyna: czysc(r.przyczyna),
    przeglad: Array.isArray(r.przeglad) ? r.przeglad.map(czysc).filter((s) => s !== '') : [],
    uwagi: str(r.uwagi).trim(),
    zlozone: normalizeZlozone(r.zlozone),
    pobrania: normalizePobrania(r.pobrania),
  };
}

export const pustePit4R = (): PitPit4R => ({
  cel: 1,
  rodzajKorekty: 1,
  przyczyna: '',
  etatLiczba: pusteMiesiace(),
  etatKwota: pusteMiesiace(),
  art41: pusteMiesiace(),
  inne: pusteMiesiace(),
  pomniejszenie: pusteMiesiace(),
  zlozone: null,
  pobrania: [],
  przeglad: [],
});

export function normalizePit4R(raw: unknown): PitPit4R | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = obj(raw);
  return {
    cel: r.cel === 2 ? 2 : 1,
    rodzajKorekty: r.rodzajKorekty === 2 ? 2 : 1,
    przyczyna: czysc(r.przyczyna),
    etatLiczba: normalizeMiesiace(r.etatLiczba),
    etatKwota: normalizeMiesiace(r.etatKwota),
    art41: normalizeMiesiace(r.art41),
    inne: normalizeMiesiace(r.inne),
    pomniejszenie: normalizeMiesiace(r.pomniejszenie),
    zlozone: normalizeZlozone(r.zlozone),
    pobrania: normalizePobrania(r.pobrania),
    przeglad: Array.isArray(r.przeglad) ? r.przeglad.map(czysc).filter((s) => s !== '') : [],
  };
}

export const URZAD_DOMYSLNY = '1433';

export const pusteDanePit = (): PitDane => ({ nazwa: '', urzadPlatnika: URZAD_DOMYSLNY, osoby: [], pit4r: null });

/** Stored or restored data made safe to read: every field present, every value of its type. */
export function normalizeDanePit(raw: unknown): PitDane {
  const r = obj(raw);
  return {
    nazwa: czysc(r.nazwa),
    urzadPlatnika: tylkoCyfry(r.urzadPlatnika).slice(0, 4) || URZAD_DOMYSLNY,
    osoby: Array.isArray(r.osoby) ? r.osoby.map(normalizeOsoba) : [],
    pit4r: normalizePit4R(r.pit4r),
  };
}

/* =============================== Identification ============================== */

const WAGI_PESEL = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
const WAGI_NIP = [6, 5, 7, 2, 3, 4, 5, 6, 7];

/** 11 digits and the check digit — the office's files held PESELs cut to 6–10 digits. */
export function peselPoprawny(p: string): boolean {
  if (!/^\d{11}$/.test(p)) return false;
  const suma = WAGI_PESEL.reduce((s, w, i) => s + w * Number(p[i]), 0);
  return (10 - (suma % 10)) % 10 === Number(p[10]);
}

export function nipPoprawny(n: string): boolean {
  if (!/^\d{10}$/.test(n)) return false;
  const suma = WAGI_NIP.reduce((s, w, i) => s + w * Number(n[i]), 0) % 11;
  return suma !== 10 && suma === Number(n[9]);
}

/** The birth date a PESEL encodes ("1985-06-17"), null for a PESEL that is not valid. */
export function dataZPesela(p: string): string | null {
  if (!peselPoprawny(p)) return null;
  const rr = Number(p.slice(0, 2));
  let mm = Number(p.slice(2, 4));
  const dd = p.slice(4, 6);
  const wiek = [1900, 2000, 2100, 2200, 1800][Math.floor(mm / 20)];
  mm %= 20;
  return `${wiek + rr}-${String(mm).padStart(2, '0')}-${dd}`;
}

const zlozFold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** The same person in another row or another year: by PESEL, else NIP, else name and birth date. */
export const kluczOsoby = (o: PitOsoba): string =>
  o.pesel ? `p${o.pesel}` : o.nip ? `n${o.nip}` : `x${zlozFold(o.nazwisko)}|${zlozFold(o.imie)}|${o.dataUrodzenia ?? ''}`;

export const nazwaOsoby = (o: Pick<PitOsoba, 'imie' | 'nazwisko'>): string => `${o.nazwisko} ${o.imie}`.trim();

/* ================================== Figures ================================== */

/** Yearly cost limit: 250 zł a month, 300 zł with the increased costs. */
export const limitKosztow = (podwyzszone: boolean): number => (podwyzszone ? 3600 : 3000);

export interface PitWiersz {
  przychod: number;
  koszty: number;
  dochod: number;
  /** Whole złoty. */
  zaliczka: number;
}

export interface PitKwoty {
  /** Poz. 105 — null when the person is not on the board. */
  zarzad: number | null;
  /** Poz. 29–33 (employment). */
  etat: PitWiersz | null;
  /** Poz. 54–57. */
  art13: PitWiersz | null;
  /** Poz. 58–61. */
  zlecenie: PitWiersz | null;
  /** Poz. 95 / 122, as entered. */
  skladki: number | null;
  zdrowotna: number | null;
}

/** Costs by rule: 20% of the income up to the limit, never above the income. */
export const kosztyZlecenia = (przychod: number, podwyzszone: boolean): number =>
  Math.min(doGroszy(przychod * 0.2), limitKosztow(podwyzszone), przychod);

export const kosztyEtatu = (przychod: number, podwyzszone: boolean): number =>
  Math.min(przychod, limitKosztow(podwyzszone));

/** Art. 13 pkt 2, 4–9: costs 20%, advance 12% of the income rounded to whole złoty. */
export const zaliczkaArt13 = (dochod: number): number => doZlotych(dochod * 0.12);

const dochodZ = (przychod: number, koszty: number) => Math.max(0, doGroszy(przychod - koszty));

/** The PIT-11's figures of one person; every row follows from the typed amounts and the rules above. */
export function obliczOsobe(o: PitOsoba): PitKwoty {
  let etat: PitWiersz | null = null;
  if (o.etat && o.etat.przychod !== null) {
    const przychod = o.etat.przychod;
    const koszty = Math.min(przychod, o.etat.koszty ?? kosztyEtatu(przychod, o.kosztyPodwyzszone));
    etat = { przychod, koszty, dochod: dochodZ(przychod, koszty), zaliczka: o.etat.zaliczka ?? 0 };
  }
  let zlecenie: PitWiersz | null = null;
  if (o.zlecenie && o.zlecenie.przychod !== null) {
    const przychod = o.zlecenie.przychod;
    const koszty = Math.min(przychod, o.zlecenie.koszty ?? kosztyZlecenia(przychod, o.kosztyPodwyzszone));
    zlecenie = { przychod, koszty, dochod: dochodZ(przychod, koszty), zaliczka: o.zlecenie.zaliczka ?? 0 };
  }
  let art13: PitWiersz | null = null;
  if (o.art13 && o.art13.przychod !== null) {
    const przychod = o.art13.przychod;
    const koszty = doGroszy(przychod * 0.2);
    const dochod = dochodZ(przychod, koszty);
    art13 = { przychod, koszty, dochod, zaliczka: o.art13.zaliczka ?? zaliczkaArt13(dochod) };
  }
  return {
    zarzad: o.zarzad && o.zarzad.kwota !== null ? o.zarzad.kwota : null,
    etat,
    art13,
    zlecenie,
    skladki: o.skladki,
    zdrowotna: o.zdrowotna,
  };
}

/** Does the person have anything to report — a PIT-11 with no figure at all is not filed. */
export const maKwoty = (k: PitKwoty): boolean => k.zarzad !== null || k.etat !== null || k.art13 !== null || k.zlecenie !== null;

/** Zaliczki of a person split the way the PIT-4R sums them: employment (row 1) and art. 41 (row 3). */
export function zaliczkiOsoby(o: PitOsoba): { etat: number; art41: number } {
  const k = obliczOsobe(o);
  return { etat: k.etat?.zaliczka ?? 0, art41: (k.art13?.zaliczka ?? 0) + (k.zlecenie?.zaliczka ?? 0) };
}

/** Sums of the advances over all the community's PIT-11s — what the PIT-4R must add up to. */
export function sumyZaliczek(osoby: PitOsoba[]): { etat: number; art41: number; razem: number } {
  let etat = 0;
  let art41 = 0;
  for (const o of osoby) {
    const z = zaliczkiOsoby(o);
    etat += z.etat;
    art41 += z.art41;
  }
  return { etat, art41, razem: etat + art41 };
}

const m = (v: number | null) => v ?? 0;
const sumaM = (a: PitMiesiace) => a.reduce<number>((s, v) => s + m(v), 0);

export interface PitPit4RKwoty {
  /** Row 1 (poz. 10–33). */
  etatLiczba: number[];
  etatKwota: number[];
  /** Row 3 (poz. 46–57). */
  art41: number[];
  /** Row 4 (poz. 58–69). */
  inne: number[];
  /** Row 5 (poz. 70–81) — rows 1–4 added. */
  suma: number[];
  /** Row 10 (poz. 122–133) and row 12 (poz. 146–157) — no rows 6–9 / 11 here, so both equal row 5. */
  doPrzekazania: number[];
  /** Part D (poz. 159–170). */
  pomniejszenie: number[];
  /** Part E (poz. 171–182) — row 12 less the reduction, never below zero. */
  doWplaty: number[];
  /** Yearly totals of row 1, row 3, row 5. */
  rokEtat: number;
  rokArt41: number;
  rokSuma: number;
}

/** Row by row, month by month — the PIT-4R's figures from the typed months. */
export function obliczPit4R(p: PitPit4R): PitPit4RKwoty {
  const mies = (a: PitMiesiace) => a.map(m);
  const etatKwota = mies(p.etatKwota);
  const art41 = mies(p.art41);
  const inne = mies(p.inne);
  const suma = etatKwota.map((v, i) => v + art41[i] + inne[i]);
  const pomniejszenie = mies(p.pomniejszenie);
  return {
    etatLiczba: mies(p.etatLiczba),
    etatKwota,
    art41,
    inne,
    suma,
    doPrzekazania: suma,
    pomniejszenie,
    doWplaty: suma.map((v, i) => Math.max(0, v - pomniejszenie[i])),
    rokEtat: sumaM(p.etatKwota),
    rokArt41: sumaM(p.art41),
    rokSuma: suma.reduce((s, v) => s + v, 0),
  };
}

/* ================================== Problems ================================= */

/** `blad` stops the XML / PDF / signature; `uwaga` is shown and lets the file through. */
export interface PitProblem {
  poziom: 'blad' | 'uwaga';
  tekst: string;
}

const blad = (tekst: string): PitProblem => ({ poziom: 'blad', tekst });
const uwaga = (tekst: string): PitProblem => ({ poziom: 'uwaga', tekst });

const kodUrzeduPit11 = (kod: string) => kod in PIT11_URZEDY;
const kodUrzeduPit4R = (kod: string) => kod in PIT11_URZEDY || kod in PIT4R_URZEDY_DODATKOWE;

const NIP_JAKO_PESEL = /^\d{10}$/;

/** What stops (or only warns about) the PIT-11 of one person. */
export function problemyOsoby(o: PitOsoba, rok: number): PitProblem[] {
  const out: PitProblem[] = [];
  if (!pitWzor(rok)) out.push(blad(`Dla roku ${rok} nie ma wzoru PIT-11 w aplikacji.`));
  if (o.przeglad.length > 0) out.push(blad(`Do przeglądu po imporcie: ${o.przeglad.join('; ')}`));
  if (!o.imie || !o.nazwisko) out.push(blad('Brak imienia lub nazwiska.'));
  if (!o.dataUrodzenia) out.push(blad('Brak daty urodzenia.'));
  if (!o.adres.miejscowosc) out.push(blad('Brak miejscowości w adresie (schemat jej wymaga).'));
  const maObcy = o.nrId !== '' && o.rodzajNrId !== null && o.krajWydania !== '';
  if (!o.pesel && !o.nip && !maObcy) out.push(blad('Brak PESEL-u, NIP-u albo zagranicznego numeru (z rodzajem i krajem wydania).'));
  if (o.pesel && !peselPoprawny(o.pesel)) out.push(blad(`PESEL „${o.pesel}” jest nieprawidłowy (11 cyfr i cyfra kontrolna).`));
  if (o.nip && !nipPoprawny(o.nip)) out.push(blad(`NIP „${o.nip}” jest nieprawidłowy.`));
  if (o.nrId !== '' && (o.rodzajNrId === null || o.krajWydania === '')) {
    out.push(blad('Numer zagraniczny wymaga rodzaju i kraju wydania.'));
  }
  if (o.krajWydania !== '' && !/^[A-Z]{2}$/.test(o.krajWydania)) out.push(blad('Kraj wydania to dwuliterowy kod (np. UA).'));
  if (!kodUrzeduPit11(o.urzad)) out.push(blad(o.urzad ? `Urząd skarbowy ${o.urzad} nie ma na liście MF.` : 'Brak urzędu skarbowego podatnika.'));
  if (o.cel === 2 && !o.przyczyna) out.push(blad('Korekta wymaga uzasadnienia przyczyn (ORD-ZU).'));
  if (o.przyczyna.length > 1000) out.push(blad('Uzasadnienie korekty jest za długie (limit 1000 znaków).'));

  const k = obliczOsobe(o);
  if (!maKwoty(k)) out.push(blad('Brak kwot — nie ma co wykazać w PIT-11.'));
  if (o.zarzad && o.zarzad.kwota === null) out.push(blad('Zarząd: brak kwoty rocznej.'));
  if (o.zlecenie && o.zlecenie.przychod === null) out.push(blad('Zlecenie: brak przychodu.'));
  if (o.etat && o.etat.przychod === null) out.push(blad('Stosunek pracy: brak przychodu.'));
  if (o.art13 && o.art13.przychod === null) out.push(blad('Art. 13: brak przychodu.'));
  if (o.zlecenie?.przychod != null && o.zlecenie.zaliczka === null) out.push(blad('Zlecenie: brak zaliczki (może być 0).'));
  if (o.etat?.przychod != null && o.etat.zaliczka === null) out.push(blad('Stosunek pracy: brak zaliczki (może być 0).'));
  if (o.zarzad && !o.zarzad.opis) out.push(blad('Zarząd: brak opisu przychodu (poz. 99).'));

  // Warnings: legal in the schema, but what the office had to correct or what is likely a slip.
  if (o.pesel && peselPoprawny(o.pesel) && o.dataUrodzenia && dataZPesela(o.pesel) !== o.dataUrodzenia) {
    out.push(uwaga(`Data urodzenia ${o.dataUrodzenia} nie zgadza się z PESEL-em (${dataZPesela(o.pesel)}).`));
  }
  if (!o.adres.ulica || !o.adres.kodPocztowy || !o.adres.miejscowosc) {
    out.push(uwaga('Brak pełnego adresu podatnika — urząd kazał dotąd poprawiać takie PIT-11 korektą („brak adresu”).'));
  }
  if (o.adres.kodPocztowy && !/^\d{2}-\d{3}$/.test(o.adres.kodPocztowy)) out.push(uwaga('Kod pocztowy w formacie 00-000.'));
  if (o.nip && NIP_JAKO_PESEL.test(o.pesel)) out.push(uwaga('PESEL ma 10 cyfr — to chyba NIP.'));
  if (k.zlecenie && o.zlecenie && o.zlecenie.przychod !== null && o.zlecenie.zaliczka !== null) {
    if (o.zlecenie.zaliczka > k.zlecenie.dochod) out.push(uwaga('Zlecenie: zaliczka większa od dochodu.'));
  }
  if (k.zlecenie && o.zlecenie?.koszty != null && o.zlecenie.przychod !== null) {
    const regula = kosztyZlecenia(o.zlecenie.przychod, o.kosztyPodwyzszone);
    if (Math.abs(o.zlecenie.koszty - regula) > 0.005) {
      out.push(uwaga(`Zlecenie: koszty ${o.zlecenie.koszty} zł zamiast ${regula} zł z reguły (20%, limit ${limitKosztow(o.kosztyPodwyzszone)} zł).`));
    }
  }
  if (o.skladki !== null && !o.zlecenie && !o.etat) out.push(uwaga('Składki ZUS bez zlecenia ani etatu — poz. 95 zostanie wykazana mimo to.'));
  return out;
}

/** What the community's PIT-4R lacks, and how far it is from the PIT-11s it must add up to. */
export function problemyPit4R(dane: PitDane, rok: number): PitProblem[] {
  const out: PitProblem[] = [];
  const p = dane.pit4r;
  if (!p) return out;
  if (!pitWzor(rok)) out.push(blad(`Dla roku ${rok} nie ma wzoru PIT-4R w aplikacji.`));
  if (p.przeglad.length > 0) out.push(blad(`Do przeglądu po imporcie: ${p.przeglad.join('; ')}`));
  if (!dane.nazwa) out.push(blad('Brak nazwy płatnika.'));
  if (!kodUrzeduPit4R(dane.urzadPlatnika)) out.push(blad(`Urząd skarbowy płatnika ${dane.urzadPlatnika} nie ma na liście MF.`));
  if (p.cel === 2 && !p.przyczyna) out.push(blad('Korekta wymaga uzasadnienia przyczyn (ORD-ZU).'));
  if (p.przyczyna.length > 1000) out.push(blad('Uzasadnienie korekty jest za długie (limit 1000 znaków).'));
  const k = obliczPit4R(p);
  if (k.rokSuma <= 0) out.push(blad('PIT-4R bez żadnej zaliczki — nie składa się go, gdy nic nie pobrano.'));
  const sumy = sumyZaliczek(dane.osoby);
  if (k.rokEtat !== sumy.etat) {
    out.push(uwaga(`Wiersz 1 (etat): PIT-4R ${k.rokEtat} zł, a PIT-11 razem ${sumy.etat} zł.`));
  }
  if (k.rokArt41 !== sumy.art41) {
    out.push(uwaga(`Wiersz 3 (art. 41): PIT-4R ${k.rokArt41} zł, a PIT-11 razem ${sumy.art41} zł.`));
  }
  for (let i = 0; i < 12; i++) {
    if (m(p.etatKwota[i]) > 0 && m(p.etatLiczba[i]) === 0) {
      out.push(uwaga(`Wiersz 1: w ${i + 1}. miesiącu są zaliczki, ale liczba podatników to 0.`));
      break;
    }
  }
  return out;
}

export const maBlad = (problemy: PitProblem[]): boolean => problemy.some((p) => p.poziom === 'blad');

/* ================================== Documents ================================ */

/** One filing: a person's PIT-11 or the community's PIT-4R. The id is what the list ticks and IPC carries. */
export interface PitDokument {
  id: string;
  rodzaj: 'pit11' | 'pit4r';
  wierszId: number;
  /** Key of the person (PIT-11). */
  klucz: string | null;
}

export const dokumentId = (wierszId: number, klucz: string | null): string => (klucz ? `${wierszId}:${klucz}` : `${wierszId}:r`);

export function rozbijDokumentId(id: string): { wierszId: number; klucz: string | null } | null {
  const i = id.indexOf(':');
  if (i < 1) return null;
  const wierszId = Number(id.slice(0, i));
  const reszta = id.slice(i + 1);
  if (!Number.isInteger(wierszId) || reszta === '') return null;
  return { wierszId, klucz: reszta === 'r' ? null : reszta };
}

/** The documents of a community's row — one PIT-11 per person with something to report, plus the PIT-4R. */
export function dokumentyWiersza(w: PodatekPit): PitDokument[] {
  const out: PitDokument[] = w.dane.osoby.map((o) => ({ id: dokumentId(w.id, o.klucz), rodzaj: 'pit11', wierszId: w.id, klucz: o.klucz }));
  if (w.dane.pit4r) out.push({ id: dokumentId(w.id, null), rodzaj: 'pit4r', wierszId: w.id, klucz: null });
  return out;
}

const BEZ_ZNAKOW_PLIKU = /[\\/:*?"<>|\u0000-\u001f]/g;

/** A file name part — no characters a file system refuses, no doubled spaces. */
export const czescPliku = (s: string): string => s.replace(BEZ_ZNAKOW_PLIKU, '').replace(/\s+/g, ' ').trim();

/** "PIT-11 2026 - Wspólnota Testowa 1 - Nowak Jan" — never the PESEL. */
export function nazwaPlikuPit(rok: number, rodzaj: 'pit11' | 'pit4r', platnik: string, osoba?: PitOsoba): string {
  const wsp = czescPliku(platnik).replace(/^wspólnota mieszkaniowa\s+/i, 'WM ');
  const baza = rodzaj === 'pit4r' ? `PIT-4R ${rok} - ${wsp}` : `PIT-11 ${rok} - ${wsp} - ${czescPliku(osoba ? nazwaOsoby(osoba) : '')}`;
  return czescPliku(baza).slice(0, 150);
}

/* ================================= Next year ================================= */

const pustyMiesiace = (n: PitMiesiace) => n.every((v) => v === null);

/**
 * A community's draft for a later year: everything of the earlier one carried over — people, titles, amounts,
 * the PIT-4R's months. The amounts are knowingly last-known ones (the wages of caretakers and boards change
 * little, and there is no fresher source), to be corrected by hand; the earlier year stays beside the fields as
 * the hint. What belongs to the earlier filing does not travel: filed marks, downloads, a correction's reason,
 * the import's review flags.
 */
export function daneNaKolejnyRok(d: PitDane): PitDane {
  return {
    nazwa: d.nazwa,
    urzadPlatnika: d.urzadPlatnika,
    osoby: d.osoby.map((o) => ({
      ...normalizeOsoba(o),
      cel: 1,
      przyczyna: '',
      przeglad: [],
      zlozone: null,
      pobrania: [],
    })),
    pit4r: d.pit4r ? { ...normalizePit4R(d.pit4r)!, cel: 1, rodzajKorekty: 1, przyczyna: '', zlozone: null, pobrania: [], przeglad: [] } : null,
  };
}

/**
 * The part of a community's name that tells it apart, folded: "WSPÓLNOTA MIESZKANIOWA ŚNIARDWY 6", "WM Śniardwy 6"
 * and the address "Śniardwy 6" all give "sniardwy6".
 */
export const rdzenWspolnoty = (nazwa: string): string =>
  zlozFold(nazwa.replace(/^\s*wsp[oó]lnota\s+mieszkaniowa\s+/i, '').replace(/^\s*wm\s+/i, '')).replace(/\s+/g, '');

/** The payer's name as the declarations print it: "Gotarda 8" → "WSPÓLNOTA MIESZKANIOWA GOTARDA 8". */
export const nazwaPlatnikaZAdresu = (nazwaAdresu: string): string => {
  const n = nazwaAdresu.replace(/\s+/g, ' ').trim();
  return (/^wsp[oó]lnota\s+mieszkaniowa\b/i.test(n) ? n : `Wspólnota Mieszkaniowa ${n}`).toLocaleUpperCase('pl-PL');
};

/** The same person in the nearest earlier year of the same community — for the "last year" hints. */
export function poprzedniaOsoba(
  wszystkie: PodatekPit[],
  wiersz: PodatekPit,
  o: PitOsoba,
): { rok: number; osoba: PitOsoba } | null {
  const klucz = kluczOsoby(o);
  const wczesniejsze = wszystkie
    .filter((w) => w.nip === wiersz.nip && w.rok < wiersz.rok)
    .sort((a, b) => b.rok - a.rok);
  for (const w of wczesniejsze) {
    const znaleziona = w.dane.osoby.find((x) => kluczOsoby(x) === klucz);
    if (znaleziona) return { rok: w.rok, osoba: znaleziona };
  }
  return null;
}

/** The community's PIT-4R of the nearest earlier year that had one. */
export function poprzedniePit4R(wszystkie: PodatekPit[], wiersz: PodatekPit): { rok: number; pit4r: PitPit4R } | null {
  const w = wszystkie
    .filter((x) => x.nip === wiersz.nip && x.rok < wiersz.rok && x.dane.pit4r)
    .sort((a, b) => b.rok - a.rok)[0];
  return w && w.dane.pit4r ? { rok: w.rok, pit4r: w.dane.pit4r } : null;
}

/**
 * People of the year's other communities, one entry each (identity, address, office), for picking a person
 * who is paid by several communities instead of typing the data again.
 */
export function osobyRoku(wszystkie: PodatekPit[], rok: number, bezWiersza?: number): PitOsoba[] {
  const widziani = new Map<string, PitOsoba>();
  for (const w of wszystkie) {
    if (w.rok !== rok || w.id === bezWiersza) continue;
    for (const o of w.dane.osoby) if (!widziani.has(kluczOsoby(o))) widziani.set(kluczOsoby(o), o);
  }
  return [...widziani.values()].sort((a, b) => nazwaOsoby(a).localeCompare(nazwaOsoby(b), 'pl'));
}

/** What identifies a person and where to reach them — copied between communities, never the amounts. */
export const tozsamoscOsoby = (o: PitOsoba): Pick<PitOsoba, 'imie' | 'nazwisko' | 'dataUrodzenia' | 'pesel' | 'nip' | 'nrId' | 'rodzajNrId' | 'krajWydania' | 'adres' | 'urzad' | 'kosztyPodwyzszone'> => ({
  imie: o.imie,
  nazwisko: o.nazwisko,
  dataUrodzenia: o.dataUrodzenia,
  pesel: o.pesel,
  nip: o.nip,
  nrId: o.nrId,
  rodzajNrId: o.rodzajNrId,
  krajWydania: o.krajWydania,
  adres: { ...o.adres },
  urzad: o.urzad,
  kosztyPodwyzszone: o.kosztyPodwyzszone,
});

/** Does the PIT-4R hold anything the "next year" draft should keep as a structure? */
export const pit4RPusty = (p: PitPit4R): boolean =>
  pustyMiesiace(p.etatLiczba) && pustyMiesiace(p.etatKwota) && pustyMiesiace(p.art41) && pustyMiesiace(p.inne);

/* ================================== Status =================================== */

export type PitStan = 'zlozone' | 'blad' | 'uwagi' | 'gotowe';

/** Where a document stands: filed, held back by an error, ready with warnings, ready. */
export function stanDokumentu(problemy: PitProblem[], zlozone: PitZlozone | null): PitStan {
  if (zlozone) return 'zlozone';
  if (maBlad(problemy)) return 'blad';
  return problemy.length > 0 ? 'uwagi' : 'gotowe';
}

export const MIESIACE_SKROT = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
