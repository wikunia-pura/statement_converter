/**
 * ZUS of the housing communities as contribution payers — the register of the people a community insures
 * (caretakers on a contract of mandate, the odd employee), their registrations (ZUS ZUA / ZZA, ZWUA, ZCNA) and
 * the monthly settlement (ZUS DRA with the RCA and RSA reports). As data, and the figures the documents carry.
 * Pure, so the renderer's live table, the KEDU file and the PDF compute every grosz with the same code.
 *
 * What the office's files say (Płatnik 10.02.002 exports, KEDU 5.4–5.7):
 *   • Contributions are worked out per person and title, each rounded to the grosz on its own, then summed into
 *     the DRA: emerytalne 9.76% + 9.76%, rentowe 1.5% (insured) + 6.5% (payer), chorobowe 2.45% (insured),
 *     wypadkowe at the payer's rate (1.67% in every file), zdrowotna 9% of the base less the insured's social
 *     contributions. Rates from Płatnik's slU_StopaProcSkl (unchanged since 2022-02).
 *   • Fundusz Pracy is 2.45% only when the person's base reaches the minimum wage (none of the office's files
 *     has it — a half-time job and the mandates stay below); FGŚP is not paid by a community (it cannot go
 *     bankrupt), so it is a payer switch that starts off.
 *   • DRA block I p1 is "6" everywhere: the deadline of the "other payers" — the 20th of the next month.
 *   • A correction is a new set with the next identifier (02, 03…): the DRA with the right totals and an RCA
 *     only for the people whose figures change.
 */

import type { PodatekPobranie } from './types';
import { czysc, doGroszy, nipPoprawny, tylkoCyfry } from './podatki';
import { czescPliku, dataZPesela, peselPoprawny } from './podatki-pit';
import { foldText } from './text';
import { ZUS_NFZ, ZUS_TYTULY } from './zus-slowniki';

export { peselPoprawny, nipPoprawny, dataZPesela };

/* ================================== Rates ==================================== */

/** Contribution rates in hundredths of a per cent (976 = 9.76%) — integer arithmetic, no float drift. */
export const ZUS_STAWKI = {
  emerytalneUbezpieczony: 976,
  emerytalnePlatnik: 976,
  rentoweUbezpieczony: 150,
  rentowePlatnik: 650,
  chorobowe: 245,
  zdrowotna: 900,
  fp: 245,
  fgsp: 10,
} as const;

/** The default accident rate — the one in every file of the office (small payers' rate). */
export const STOPA_WYPADKOWA_DOMYSLNA = 1.67;

/**
 * Minimum wage (the FP threshold) and the yearly cap of the pension / disability base (30 × the forecast average
 * wage), from Płatnik's slU_ParametryWar. A year not listed reuses the last one and says so.
 */
const PARAMETRY: Record<number, { placaMinimalna: number | [number, number]; limitRoczny: number }> = {
  // 2024: 4242 zł in January–June, 4300 zł from July.
  2024: { placaMinimalna: [4242, 4300], limitRoczny: 234720 },
  2025: { placaMinimalna: 4666, limitRoczny: 260190 },
  2026: { placaMinimalna: 4806, limitRoczny: 282600 },
};

export interface ZusParametry {
  placaMinimalna: number;
  limitRoczny: number;
  /** False — the year is not in the table; the last known values are used. */
  potwierdzone: boolean;
}

export function zusParametry(okres: string): ZusParametry {
  const rok = Number(okres.slice(0, 4));
  const miesiac = Number(okres.slice(5, 7));
  const lata = Object.keys(PARAMETRY).map(Number);
  const znany = PARAMETRY[rok];
  const p = znany ?? PARAMETRY[rok < Math.min(...lata) ? Math.min(...lata) : Math.max(...lata)];
  const placa = Array.isArray(p.placaMinimalna) ? p.placaMinimalna[miesiac >= 7 ? 1 : 0] : p.placaMinimalna;
  return { placaMinimalna: placa, limitRoczny: p.limitRoczny, potwierdzone: !!znany };
}

/* ================================== Types ==================================== */

/** "Wysłane do ZUS" — the clerk's statement after sending the file from Płatnik / ePłatnik. */
export interface ZusZnak {
  at: string;
  by: string;
}

/** An address as ZUS documents print it (ZUA XI/XII, ZZA VIII/IX, ZCNA IV.B). Postal code: five digits. */
export interface ZusAdres {
  kodPocztowy: string;
  miejscowosc: string;
  /** Gmina / dzielnica. */
  gmina: string;
  ulica: string;
  nrDomu: string;
  nrLokalu: string;
  telefon: string;
}

/** Sickness insurance: compulsory (employment), voluntary (a mandate, on request) or none. */
export type ZusChorobowe = 'obowiazkowe' | 'dobrowolne' | 'brak';

/**
 * Social and health insurance (ZUS ZUA) or health only (ZUS ZZA — a mandate of a person insured elsewhere, the
 * "zlecenie samo zdrowotne" of the office's files: the RCA then has zero bases and only the health block).
 */
export type ZusSchemat = 'spoleczne' | 'zdrowotne';

/** One insurance title of a person at the community: the period, the code, what it covers. */
export interface ZusTytul {
  klucz: string;
  /** Four digits — 0110 employee, 0411 mandate (ZUS_TYTULY). */
  kod: string;
  /** 0 none, 1 old-age pension, 2 disability pension. */
  emRent: string;
  /** 0 none, 1 light, 2 moderate, 3 severe. */
  niepelnosprawnosc: string;
  schemat: ZusSchemat;
  emerytalne: boolean;
  rentowe: boolean;
  wypadkowe: boolean;
  chorobowe: ZusChorobowe;
  /** First day of insurance (ZUA VI p1 / VII p1). */
  od: string | null;
  /** Last day of insurance; the ZWUA "from" date is the day after. Null = still insured. */
  do: string | null;
  /** ZWUA IV p3 (ZUS_PRZYCZYNY_WYREJESTROWANIA). */
  przyczyna: string;
  /** Employment only: the fraction of full time (RCA B p3). */
  wymiarLicznik: number | null;
  wymiarMianownik: number | null;
  /** The usual monthly base — what a new month starts from when there is no earlier month. */
  podstawa: number | null;
  /** Exempt from Fundusz Pracy for another reason than age (after maternity, 50+ hired from unemployment). */
  bezFp: boolean;
  /** ZWUA block V — the end of an employment (0110…): the date, how it ended, the legal basis, who started it. */
  dataRozwiazania: string | null;
  kodWygasniecia: string;
  kodPodstawyPrawnej: string;
  podstawaPrawna: string;
  /** 1 the employer, 2 the employee. */
  stronaInicjujaca: string;
  /** The ZWUA is a correction of one sent before (ZWUA I p2). */
  korektaWyrejestrowania: boolean;
  zgloszenie: ZusZnak | null;
  wyrejestrowanie: ZusZnak | null;
  pobrania: PodatekPobranie[];
}

/** A family member reported for health insurance (ZUS ZCNA) — registered from `od`, deregistered from `do`. */
export interface ZusCzlonek {
  klucz: string;
  pesel: string;
  /** 1 ID card, 2 passport — only without a PESEL. */
  rodzajDok: string;
  seriaNrDok: string;
  nazwisko: string;
  imie: string;
  dataUrodzenia: string | null;
  /** ZUS_POKREWIENSTWO — "11" a child. */
  pokrewienstwo: string;
  wspolneGospodarstwo: boolean;
  niepelnosprawnosc: string;
  od: string | null;
  do: string | null;
  /** Null = the insured person's own address. */
  adres: ZusAdres | null;
  zgloszenie: ZusZnak | null;
  wyrejestrowanie: ZusZnak | null;
  pobrania: PodatekPobranie[];
}

/** A person the community insures. */
export interface ZusUbezpieczony {
  klucz: string;
  pesel: string;
  nip: string;
  /** Only without a PESEL: 1 ID card, 2 passport, with its number. */
  rodzajDok: string;
  seriaNrDok: string;
  nazwisko: string;
  imie: string;
  imieDrugie: string;
  nazwiskoRodowe: string;
  dataUrodzenia: string | null;
  obywatelstwo: string;
  /** K / M. */
  plec: string;
  /** Adres zameldowania na stałe. */
  adres: ZusAdres;
  /** Adres zamieszkania — null when it is the same. */
  adresZamieszkania: ZusAdres | null;
  /** "07R" — the NFZ branch (ZUS_NFZ). */
  kodNfz: string;
  /** Six digits (ZUS_ZAWODY) — "962902" caretaker. */
  kodZawodu: string;
  tytuly: ZusTytul[];
  czlonkowie: ZusCzlonek[];
  /** What the import found and could not settle — blocks the documents until ticked off. */
  przeglad: string[];
  uwagi: string;
}

/** A community as a payer, with everyone it insures. */
export interface ZusPlatnikDane {
  /** Nazwa skrócona — exactly as in Płatnik (31 characters at most). */
  nazwaSkrocona: string;
  regon: string;
  /** Stopa procentowa składki wypadkowej, e.g. 1.67. */
  stopaWypadkowa: number | null;
  /** DRA I p1 — the deadline code (slU_TerminDRA): 6 the 20th, 3 the 15th, 1 the 5th. */
  terminDra: string;
  /** Pays Fundusz Pracy (the threshold and age still apply). */
  fp: boolean;
  /** Pays FGŚP — a community does not; kept for the exception. */
  fgsp: boolean;
  /** The payer's contribution account (NRS), for the printout. */
  rachunek: string;
  ubezpieczeni: ZusUbezpieczony[];
  przeglad: string[];
  uwagi: string;
}

export interface PodatekZusPlatnik {
  id: number;
  /** Digits only. */
  nip: string;
  dane: ZusPlatnikDane;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** One person and title in a month: the base typed (gross subject to contributions) and the overrides. */
export interface ZusPozycja {
  kluczOsoby: string;
  kluczTytulu: string;
  /** Podstawa wymiaru (przychód oskładkowany); null = not entered yet. */
  podstawa: number | null;
  /**
   * Income subject to the health contribution only — sick pay (wynagrodzenie za czas choroby, RSA 331) is left
   * out of the social base but goes into the health base (RCA C p1). Null = none.
   */
  przychodZdrowotny: number | null;
  /** Health contribution typed by hand — null = 9% by the rule. */
  zdrowotna: number | null;
}

/** One RSA line: a sick leave, an unpaid leave… (ZUS_SWIADCZENIA_PRZERWY). */
export interface ZusRsaWpis {
  klucz: string;
  kluczOsoby: string;
  kluczTytulu: string;
  kod: string;
  od: string | null;
  do: string | null;
  /** Null = the days between `od` and `do`. */
  dni: number | null;
  kwota: number | null;
}

export interface ZusRozliczenieDane {
  pozycje: ZusPozycja[];
  rsa: ZusRsaWpis[];
  /**
   * DRA III p1 typed or taken from Płatnik's file — null = the people of the set. Płatnik does not always count
   * that way (one office file has 1 for two RCA blocks), so an imported set keeps the file's number.
   */
  liczbaUbezpieczonych: number | null;
  /** DRA XIII / RCA IV — when the documents were made out; null = the day the file is written. */
  dataWypelnienia: string | null;
  wyslane: ZusZnak | null;
  pobrania: PodatekPobranie[];
  /** The set came from Płatnik's files, not from the app. */
  zImportu: boolean;
  przeglad: string[];
  uwagi: string;
}

/** One month's set of one payer: DRA + RCA (+ RSA). Identifier 1 = "01", corrections 2, 3… */
export interface PodatekZusRozliczenie {
  id: number;
  nip: string;
  /** "2026-09". */
  okres: string;
  identyfikator: number;
  dane: ZusRozliczenieDane;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/* =============================== Normalizing ================================ */

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const OKRES = /^\d{4}-(0[1-9]|1[0-2])$/;

const data = (v: unknown): string | null => {
  const s = str(v).slice(0, 10);
  return ISO_DATE.test(s) ? s : null;
};

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

const calkowita = (v: unknown): number | null => {
  const n = liczba(v);
  return n === null || n < 0 ? null : Math.round(n);
};

const znak = (raw: unknown): ZusZnak | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = obj(raw);
  return { at: str(r.at), by: str(r.by) };
};

const lista = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map(czysc).filter((s) => s !== '') : []);

function pobrania(raw: unknown): PodatekPobranie[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const r = obj(p);
      return { at: str(r.at), by: str(r.by), plik: str(r.plik) };
    })
    .filter((p) => p.plik !== '');
}

export const nowyKluczZus = (prefiks = 'u'): string => `${prefiks}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const pustyAdresZus = (): ZusAdres => ({ kodPocztowy: '', miejscowosc: '', gmina: '', ulica: '', nrDomu: '', nrLokalu: '', telefon: '' });

function normalizeAdresZus(raw: unknown): ZusAdres {
  const r = obj(raw);
  return {
    kodPocztowy: tylkoCyfry(r.kodPocztowy).slice(0, 5),
    miejscowosc: czysc(r.miejscowosc),
    gmina: czysc(r.gmina),
    ulica: czysc(r.ulica),
    nrDomu: czysc(r.nrDomu),
    nrLokalu: czysc(r.nrLokalu),
    telefon: czysc(r.telefon),
  };
}

export const czyAdresZusPusty = (a: ZusAdres): boolean => Object.values(a).every((v) => v === '');

/** A mandate (0411) by default: social insurance without sickness, the caretaker's case. */
export const pustyTytul = (kod = '0411'): ZusTytul => ({
  klucz: nowyKluczZus('t'),
  kod,
  emRent: '0',
  niepelnosprawnosc: '0',
  schemat: 'spoleczne',
  emerytalne: true,
  rentowe: true,
  wypadkowe: true,
  chorobowe: kod.startsWith('01') ? 'obowiazkowe' : 'brak',
  od: null,
  do: null,
  przyczyna: '100',
  wymiarLicznik: kod.startsWith('01') ? 1 : null,
  wymiarMianownik: kod.startsWith('01') ? 1 : null,
  podstawa: null,
  bezFp: false,
  dataRozwiazania: null,
  kodWygasniecia: '',
  kodPodstawyPrawnej: '',
  podstawaPrawna: '',
  stronaInicjujaca: '',
  korektaWyrejestrowania: false,
  zgloszenie: null,
  wyrejestrowanie: null,
  pobrania: [],
});

const CHOROBOWE: ZusChorobowe[] = ['obowiazkowe', 'dobrowolne', 'brak'];

export function normalizeTytul(raw: unknown): ZusTytul {
  const r = obj(raw);
  const base = pustyTytul();
  const kod = tylkoCyfry(r.kod).slice(0, 4) || base.kod;
  return {
    klucz: str(r.klucz) || base.klucz,
    kod,
    emRent: /^\d$/.test(str(r.emRent)) ? str(r.emRent) : '0',
    niepelnosprawnosc: /^\d$/.test(str(r.niepelnosprawnosc)) ? str(r.niepelnosprawnosc) : '0',
    schemat: r.schemat === 'zdrowotne' ? 'zdrowotne' : 'spoleczne',
    emerytalne: r.emerytalne !== false,
    rentowe: r.rentowe !== false,
    wypadkowe: r.wypadkowe !== false,
    chorobowe: CHOROBOWE.includes(r.chorobowe as ZusChorobowe) ? (r.chorobowe as ZusChorobowe) : base.chorobowe,
    od: data(r.od),
    do: data(r.do),
    przyczyna: tylkoCyfry(r.przyczyna).slice(0, 3) || '100',
    wymiarLicznik: calkowita(r.wymiarLicznik),
    wymiarMianownik: calkowita(r.wymiarMianownik),
    podstawa: kwota(r.podstawa),
    bezFp: r.bezFp === true,
    dataRozwiazania: data(r.dataRozwiazania),
    kodWygasniecia: czysc(r.kodWygasniecia).toUpperCase(),
    kodPodstawyPrawnej: tylkoCyfry(r.kodPodstawyPrawnej).slice(0, 3),
    podstawaPrawna: czysc(r.podstawaPrawna).slice(0, 72),
    stronaInicjujaca: r.stronaInicjujaca === '1' || r.stronaInicjujaca === '2' ? r.stronaInicjujaca : '',
    korektaWyrejestrowania: r.korektaWyrejestrowania === true,
    zgloszenie: znak(r.zgloszenie),
    wyrejestrowanie: znak(r.wyrejestrowanie),
    pobrania: pobrania(r.pobrania),
  };
}

export const pustyCzlonek = (): ZusCzlonek => ({
  klucz: nowyKluczZus('c'),
  pesel: '',
  rodzajDok: '',
  seriaNrDok: '',
  nazwisko: '',
  imie: '',
  dataUrodzenia: null,
  pokrewienstwo: '11',
  wspolneGospodarstwo: true,
  niepelnosprawnosc: '',
  od: null,
  do: null,
  adres: null,
  zgloszenie: null,
  wyrejestrowanie: null,
  pobrania: [],
});

export function normalizeCzlonek(raw: unknown): ZusCzlonek {
  const r = obj(raw);
  const base = pustyCzlonek();
  return {
    klucz: str(r.klucz) || base.klucz,
    pesel: tylkoCyfry(r.pesel).slice(0, 11),
    rodzajDok: r.rodzajDok === '1' || r.rodzajDok === '2' ? r.rodzajDok : '',
    seriaNrDok: czysc(r.seriaNrDok).toUpperCase().replace(/\s/g, ''),
    nazwisko: czysc(r.nazwisko),
    imie: czysc(r.imie),
    dataUrodzenia: data(r.dataUrodzenia),
    pokrewienstwo: tylkoCyfry(r.pokrewienstwo).slice(0, 2) || base.pokrewienstwo,
    wspolneGospodarstwo: r.wspolneGospodarstwo !== false,
    niepelnosprawnosc: /^\d$/.test(str(r.niepelnosprawnosc)) ? str(r.niepelnosprawnosc) : '',
    od: data(r.od),
    do: data(r.do),
    adres: r.adres ? normalizeAdresZus(r.adres) : null,
    zgloszenie: znak(r.zgloszenie),
    wyrejestrowanie: znak(r.wyrejestrowanie),
    pobrania: pobrania(r.pobrania),
  };
}

export const pustyUbezpieczony = (): ZusUbezpieczony => ({
  klucz: nowyKluczZus('u'),
  pesel: '',
  nip: '',
  rodzajDok: '',
  seriaNrDok: '',
  nazwisko: '',
  imie: '',
  imieDrugie: '',
  nazwiskoRodowe: '',
  dataUrodzenia: null,
  obywatelstwo: 'POLSKIE',
  plec: '',
  adres: { ...pustyAdresZus(), miejscowosc: 'WARSZAWA' },
  adresZamieszkania: null,
  kodNfz: '07R',
  kodZawodu: '',
  tytuly: [],
  czlonkowie: [],
  przeglad: [],
  uwagi: '',
});

export function normalizeUbezpieczony(raw: unknown): ZusUbezpieczony {
  const r = obj(raw);
  const base = pustyUbezpieczony();
  const plec = str(r.plec).toUpperCase();
  return {
    klucz: str(r.klucz) || base.klucz,
    pesel: tylkoCyfry(r.pesel).slice(0, 11),
    nip: tylkoCyfry(r.nip).slice(0, 10),
    rodzajDok: r.rodzajDok === '1' || r.rodzajDok === '2' ? r.rodzajDok : '',
    seriaNrDok: czysc(r.seriaNrDok).toUpperCase().replace(/\s/g, ''),
    nazwisko: czysc(r.nazwisko),
    imie: czysc(r.imie),
    imieDrugie: czysc(r.imieDrugie),
    nazwiskoRodowe: czysc(r.nazwiskoRodowe),
    dataUrodzenia: data(r.dataUrodzenia),
    obywatelstwo: czysc(r.obywatelstwo),
    plec: plec === 'K' || plec === 'M' ? plec : '',
    adres: normalizeAdresZus(r.adres),
    adresZamieszkania: r.adresZamieszkania ? normalizeAdresZus(r.adresZamieszkania) : null,
    kodNfz: czysc(r.kodNfz).toUpperCase().slice(0, 3),
    kodZawodu: tylkoCyfry(r.kodZawodu).slice(0, 6),
    tytuly: Array.isArray(r.tytuly) ? r.tytuly.map(normalizeTytul) : [],
    czlonkowie: Array.isArray(r.czlonkowie) ? r.czlonkowie.map(normalizeCzlonek) : [],
    przeglad: lista(r.przeglad),
    uwagi: str(r.uwagi).trim(),
  };
}

export const pusteDaneZusPlatnika = (): ZusPlatnikDane => ({
  nazwaSkrocona: '',
  regon: '',
  stopaWypadkowa: STOPA_WYPADKOWA_DOMYSLNA,
  terminDra: '6',
  fp: true,
  fgsp: false,
  rachunek: '',
  ubezpieczeni: [],
  przeglad: [],
  uwagi: '',
});

export function normalizeDaneZusPlatnika(raw: unknown): ZusPlatnikDane {
  const r = obj(raw);
  const stopa = liczba(r.stopaWypadkowa);
  return {
    nazwaSkrocona: czysc(r.nazwaSkrocona).slice(0, 31),
    regon: tylkoCyfry(r.regon).slice(0, 14),
    stopaWypadkowa: stopa === null || stopa < 0 ? null : Math.round(stopa * 100) / 100,
    terminDra: /^\d$/.test(str(r.terminDra)) ? str(r.terminDra) : '6',
    fp: r.fp !== false,
    fgsp: r.fgsp === true,
    rachunek: tylkoCyfry(r.rachunek).slice(0, 26),
    ubezpieczeni: Array.isArray(r.ubezpieczeni) ? r.ubezpieczeni.map(normalizeUbezpieczony) : [],
    przeglad: lista(r.przeglad),
    uwagi: str(r.uwagi).trim(),
  };
}

function normalizePozycja(raw: unknown): ZusPozycja {
  const r = obj(raw);
  return {
    kluczOsoby: str(r.kluczOsoby),
    kluczTytulu: str(r.kluczTytulu),
    podstawa: kwota(r.podstawa),
    przychodZdrowotny: kwota(r.przychodZdrowotny),
    zdrowotna: kwota(r.zdrowotna),
  };
}

export const pustyWpisRsa = (kluczOsoby: string, kluczTytulu: string): ZusRsaWpis => ({
  klucz: nowyKluczZus('r'),
  kluczOsoby,
  kluczTytulu,
  kod: '331',
  od: null,
  do: null,
  dni: null,
  kwota: null,
});

function normalizeRsa(raw: unknown): ZusRsaWpis {
  const r = obj(raw);
  return {
    klucz: str(r.klucz) || nowyKluczZus('r'),
    kluczOsoby: str(r.kluczOsoby),
    kluczTytulu: str(r.kluczTytulu),
    kod: tylkoCyfry(r.kod).slice(0, 3),
    od: data(r.od),
    do: data(r.do),
    dni: calkowita(r.dni),
    kwota: kwota(r.kwota),
  };
}

export const pusteDaneRozliczenia = (): ZusRozliczenieDane => ({
  pozycje: [],
  rsa: [],
  liczbaUbezpieczonych: null,
  dataWypelnienia: null,
  wyslane: null,
  pobrania: [],
  zImportu: false,
  przeglad: [],
  uwagi: '',
});

export function normalizeDaneRozliczenia(raw: unknown): ZusRozliczenieDane {
  const r = obj(raw);
  return {
    pozycje: Array.isArray(r.pozycje) ? r.pozycje.map(normalizePozycja).filter((p) => p.kluczOsoby && p.kluczTytulu) : [],
    rsa: Array.isArray(r.rsa) ? r.rsa.map(normalizeRsa) : [],
    liczbaUbezpieczonych: calkowita(r.liczbaUbezpieczonych),
    dataWypelnienia: data(r.dataWypelnienia),
    wyslane: znak(r.wyslane),
    pobrania: pobrania(r.pobrania),
    zImportu: r.zImportu === true,
    przeglad: lista(r.przeglad),
    uwagi: str(r.uwagi).trim(),
  };
}

/* ================================= Dates ===================================== */

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoZ = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const pierwszyDzien = (okres: string): string => `${okres}-01`;
export const ostatniDzien = (okres: string): string => {
  const [y, m] = okres.split('-').map(Number);
  return isoZ(new Date(Date.UTC(y, m, 0)));
};
export const dodajDni = (iso: string, n: number): string => {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoZ(d);
};
export const przesunOkres = (okres: string, delta: number): string => {
  const [y, m] = okres.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
};
export const okresZDaty = (iso: string): string => iso.slice(0, 7);
/** Days in `od`…`do`, both counted. */
export const dniOkresu = (od: string, doo: string): number => Math.round((utc(doo).getTime() - utc(od).getTime()) / 86400000) + 1;

/** Easter Sunday (Gregorian, anonymous algorithm). */
function wielkanoc(rok: number): string {
  const a = rok % 19;
  const b = Math.floor(rok / 100);
  const c = rok % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31);
  const dzien = ((h + l - 7 * m + 114) % 31) + 1;
  return `${rok}-${pad2(miesiac)}-${pad2(dzien)}`;
}

/** Polish public holidays of a year (Christmas Eve since 2025). */
export function swieta(rok: number): Set<string> {
  const w = wielkanoc(rok);
  const stale = ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26', ...(rok >= 2025 ? ['12-24'] : [])];
  return new Set([...stale.map((d) => `${rok}-${d}`), w, dodajDni(w, 1), dodajDni(w, 49), dodajDni(w, 60)]);
}

const DZIEN_TERMINU: Record<string, number> = { '1': 5, '2': 10, '3': 15, '4': 15, '6': 20 };

/** When the month's DRA and contributions are due: the code's day of the next month, moved past a Saturday, Sunday or holiday. */
export function terminRozliczenia(okres: string, kodTerminu: string): string {
  let d = `${przesunOkres(okres, 1)}-${pad2(DZIEN_TERMINU[kodTerminu] ?? 20)}`;
  for (let i = 0; i < 10; i++) {
    const dzien = utc(d).getUTCDay();
    if (dzien !== 0 && dzien !== 6 && !swieta(Number(d.slice(0, 4))).has(d)) break;
    d = dodajDni(d, 1);
  }
  return d;
}

/* ============================== Identification =============================== */

/** K / M from the PESEL's tenth digit (even = woman), '' for a PESEL that is not valid. */
export const plecZPesela = (p: string): string => (peselPoprawny(p) ? (Number(p[9]) % 2 === 0 ? 'K' : 'M') : '');

export const nazwaUbezpieczonego = (o: Pick<ZusUbezpieczony, 'imie' | 'nazwisko'>): string => `${o.nazwisko} ${o.imie}`.trim();

/** The same person in another community or after an import: by PESEL, else by name and birth date. */
export const kluczTozsamosci = (o: Pick<ZusUbezpieczony, 'pesel' | 'nazwisko' | 'imie' | 'dataUrodzenia'>): string =>
  o.pesel ? `p${o.pesel}` : `x${foldText(o.nazwisko)}|${foldText(o.imie)}|${o.dataUrodzenia ?? ''}`;

export const opisTytulu = (kod: string): string => ZUS_TYTULY.find(([k]) => k === kod)?.[1] ?? '';
export const kodTytuluZnany = (kod: string): boolean => ZUS_TYTULY.some(([k]) => k === kod);
export const kodNfzZnany = (kod: string): boolean => ZUS_NFZ.some(([k]) => k === kod);
/** An employee's title (0110, 0120…) — wymiar czasu pracy and the ZWUA block V belong to these. */
export const tytulPracowniczy = (kod: string): boolean => kod.startsWith('01');
/** "0411 0 0". */
export const kodPelny = (t: Pick<ZusTytul, 'kod' | 'emRent' | 'niepelnosprawnosc'>): string => `${t.kod} ${t.emRent} ${t.niepelnosprawnosc}`;

/** Is the title in force on any day of the month. */
export const tytulWOkresie = (t: Pick<ZusTytul, 'od' | 'do'>, okres: string): boolean =>
  !!t.od && t.od <= ostatniDzien(okres) && (!t.do || t.do >= pierwszyDzien(okres));

/** The ZWUA "wyrejestrowanie od dnia" — the day after the last day of insurance. */
export const dataWyrejestrowania = (t: Pick<ZusTytul, 'do'>): string | null => (t.do ? dodajDni(t.do, 1) : null);

/**
 * Exempt from FP for age: a woman from the month after she turns 55, a man after 60 (art. 104b ustawy o
 * promocji zatrudnienia). Unknown sex or birth date — not exempt (the safe side: FP is paid).
 */
export function wiekZwalniaZFp(o: Pick<ZusUbezpieczony, 'pesel' | 'plec' | 'dataUrodzenia'>, okres: string): boolean {
  const urodzenie = o.dataUrodzenia ?? dataZPesela(o.pesel);
  const plec = o.plec || plecZPesela(o.pesel);
  if (!urodzenie || !plec) return false;
  const lat = plec === 'K' ? 55 : 60;
  const okresUrodzin = `${Number(urodzenie.slice(0, 4)) + lat}-${urodzenie.slice(5, 7)}`;
  return okres > okresUrodzin;
}

/* ================================== Figures ================================== */

const gr = (zl: number) => Math.round(zl * 100 + (zl >= 0 ? 1e-7 : -1e-7));
/** A contribution in złoty: base × rate (hundredths of a per cent), rounded half up to the grosz. */
const skladka = (podstawaGr: number, stawka: number): number => Math.round((podstawaGr * stawka) / 10000) / 100;
const suma = (...x: number[]) => Math.round(x.reduce((s, v) => s + gr(v), 0)) / 100;

export interface ZusSkladki {
  /** RCA B p4 / p5 / p6. */
  podstawaER: number;
  podstawaCh: number;
  podstawaWyp: number;
  /** RCA B p7 / p8 / p9 / p10 — the insured's part. */
  emU: number;
  renU: number;
  chU: number;
  wypU: number;
  /** RCA B p11 / p12 / p13 / p14 — the payer's part. */
  emP: number;
  renP: number;
  chP: number;
  wypP: number;
  /** RCA B p29. */
  razem: number;
  /** The insured's social contributions (p7 + p8 + p9) — PIT-11 poz. 95. */
  spoleczneU: number;
  /** RCA C p1 / p4. */
  podstawaZdr: number;
  zdrowotna: number;
  /** The rule's health contribution (when a typed one replaces it). */
  zdrowotnaRegula: number;
}

/**
 * The contributions of one person and title for a month's base, at the payer's accident rate. `tylkoZdrowotny`:
 * income that only the health contribution is due on (sick pay), added to the health base.
 */
export function obliczSkladki(
  t: Pick<ZusTytul, 'schemat' | 'emerytalne' | 'rentowe' | 'wypadkowe' | 'chorobowe'>,
  podstawa: number,
  stopaWypadkowa: number,
  zdrowotnaRecznie: number | null = null,
  tylkoZdrowotny: number | null = null,
): ZusSkladki {
  const p = gr(Math.max(0, podstawa));
  const spoleczne = t.schemat === 'spoleczne';
  const er = spoleczne && (t.emerytalne || t.rentowe) ? p : 0;
  const ch = spoleczne && t.chorobowe !== 'brak' ? p : 0;
  const wyp = spoleczne && t.wypadkowe ? p : 0;
  const emU = spoleczne && t.emerytalne ? skladka(er, ZUS_STAWKI.emerytalneUbezpieczony) : 0;
  const emP = spoleczne && t.emerytalne ? skladka(er, ZUS_STAWKI.emerytalnePlatnik) : 0;
  const renU = spoleczne && t.rentowe ? skladka(er, ZUS_STAWKI.rentoweUbezpieczony) : 0;
  const renP = spoleczne && t.rentowe ? skladka(er, ZUS_STAWKI.rentowePlatnik) : 0;
  const chU = ch ? skladka(ch, ZUS_STAWKI.chorobowe) : 0;
  const wypP = wyp ? skladka(wyp, Math.round(stopaWypadkowa * 100)) : 0;
  const spoleczneU = suma(emU, renU, chU);
  const podstawaZdr = (Math.max(0, p - gr(spoleczneU)) + gr(Math.max(0, tylkoZdrowotny ?? 0))) / 100;
  const zdrowotnaRegula = skladka(gr(podstawaZdr), ZUS_STAWKI.zdrowotna);
  return {
    podstawaER: er / 100,
    podstawaCh: ch / 100,
    podstawaWyp: wyp / 100,
    emU,
    renU,
    chU,
    wypU: 0,
    emP,
    renP,
    chP: 0,
    wypP,
    razem: suma(emU, renU, chU, emP, renP, wypP),
    spoleczneU,
    podstawaZdr,
    zdrowotna: zdrowotnaRecznie ?? zdrowotnaRegula,
    zdrowotnaRegula,
  };
}

/** One RCA block: who, under which title, and the figures. */
export interface ZusWynikPozycji {
  osoba: ZusUbezpieczony;
  tytul: ZusTytul;
  pozycja: ZusPozycja;
  skladki: ZusSkladki;
}

/** The DRA's figures, by block and position. */
export interface ZusDra {
  /** Block III p1 — the set's override, else the people of the set. */
  liczbaUbezpieczonych: number;
  /** Block IV p1–p37. */
  iv: number[];
  /** Block VI p1–p7. */
  vi: number[];
  /** FP, FGŚP, their sum (block VII p1–p3). */
  fp: number;
  fgsp: number;
  /** Block IX p2 — what the payer transfers: social + health + FP / FGŚP. */
  doZaplaty: number;
  spoleczne: number;
  zdrowotna: number;
}

export interface ZusWynik {
  pozycje: ZusWynikPozycji[];
  /** Positions of the set that point at a person or title no longer in the register. */
  osierocone: ZusPozycja[];
  dra: ZusDra;
  /** FP per person key (0 where it is not due), for the screen. */
  fpOsoby: Map<string, number>;
}

/** Everything a month's set prints, from the register and the typed bases. */
export function obliczRozliczenie(
  platnik: ZusPlatnikDane,
  dane: Pick<ZusRozliczenieDane, 'pozycje'> & Partial<Pick<ZusRozliczenieDane, 'liczbaUbezpieczonych'>>,
  okres: string,
): ZusWynik {
  const osoby = new Map(platnik.ubezpieczeni.map((o) => [o.klucz, o]));
  const stopa = platnik.stopaWypadkowa ?? STOPA_WYPADKOWA_DOMYSLNA;
  const pozycje: ZusWynikPozycji[] = [];
  const osierocone: ZusPozycja[] = [];
  for (const p of dane.pozycje) {
    const osoba = osoby.get(p.kluczOsoby);
    const tytul = osoba?.tytuly.find((t) => t.klucz === p.kluczTytulu);
    if (!osoba || !tytul) {
      osierocone.push(p);
      continue;
    }
    pozycje.push({ osoba, tytul, pozycja: p, skladki: obliczSkladki(tytul, p.podstawa ?? 0, stopa, p.zdrowotna, p.przychodZdrowotny) });
  }

  // FP / FGŚP: per person, on the pension base of all their titles at this payer.
  const { placaMinimalna } = zusParametry(okres);
  const fpOsoby = new Map<string, number>();
  let fp = 0;
  let fgsp = 0;
  const poOsobie = new Map<string, ZusWynikPozycji[]>();
  for (const w of pozycje) poOsobie.set(w.osoba.klucz, [...(poOsobie.get(w.osoba.klucz) ?? []), w]);
  for (const [klucz, lista] of poOsobie) {
    const osoba = lista[0].osoba;
    const podstawaGr = lista.reduce((s, w) => s + gr(w.skladki.podstawaER), 0);
    const zwolniona = !platnik.fp || wiekZwalniaZFp(osoba, okres) || lista.some((w) => w.tytul.bezFp);
    const fpOsoby1 = !zwolniona && podstawaGr >= gr(placaMinimalna) ? skladka(podstawaGr, ZUS_STAWKI.fp) : 0;
    fpOsoby.set(klucz, fpOsoby1);
    fp = suma(fp, fpOsoby1);
    if (platnik.fgsp) fgsp = suma(fgsp, skladka(podstawaGr, ZUS_STAWKI.fgsp));
  }

  const S = (f: (s: ZusSkladki) => number) => suma(...pozycje.map((w) => f(w.skladki)));
  const emU = S((s) => s.emU);
  const emP = S((s) => s.emP);
  const renU = S((s) => s.renU);
  const renP = S((s) => s.renP);
  const chU = S((s) => s.chU);
  const chP = S((s) => s.chP);
  const wypU = S((s) => s.wypU);
  const wypP = S((s) => s.wypP);
  const iv = new Array<number>(38).fill(0);
  iv[1] = suma(emU, emP);
  iv[2] = suma(renU, renP);
  iv[3] = suma(iv[1], iv[2]);
  iv[4] = emU;
  iv[5] = renU;
  iv[6] = suma(emU, renU);
  iv[7] = emP;
  iv[8] = renP;
  iv[9] = suma(emP, renP);
  iv[19] = suma(chU, chP);
  iv[20] = suma(wypU, wypP);
  iv[21] = suma(iv[19], iv[20]);
  iv[22] = chU;
  iv[23] = wypU;
  iv[24] = suma(chU, wypU);
  iv[25] = chP;
  iv[26] = wypP;
  iv[27] = suma(chP, wypP);
  iv[37] = suma(iv[3], iv[21]);
  const zdrowotna = S((s) => s.zdrowotna);
  const vi = new Array<number>(8).fill(0);
  vi[2] = zdrowotna;
  vi[5] = suma(vi[1], vi[2], vi[3]);
  vi[7] = suma(vi[5], -vi[6]);
  return {
    pozycje,
    osierocone,
    fpOsoby,
    dra: {
      liczbaUbezpieczonych: dane.liczbaUbezpieczonych ?? poOsobie.size,
      iv,
      vi,
      fp,
      fgsp,
      spoleczne: iv[37],
      zdrowotna,
      doZaplaty: suma(iv[37], vi[7], fp, fgsp),
    },
  };
}

/** Did a block change between two versions of a month — what a correction's RCA must carry. */
export const pozycjaZmieniona = (a: ZusSkladki | undefined, b: ZusSkladki): boolean =>
  !a ||
  (['podstawaER', 'podstawaCh', 'podstawaWyp', 'emU', 'renU', 'chU', 'emP', 'renP', 'wypP', 'podstawaZdr', 'zdrowotna'] as const).some(
    (k) => gr(a[k]) !== gr(b[k]),
  );

export const kluczPozycji = (p: Pick<ZusPozycja, 'kluczOsoby' | 'kluczTytulu'>): string => `${p.kluczOsoby}|${p.kluczTytulu}`;

/* =============================== Month drafts ================================= */

/** The titles of the register in force in the month, with their person. */
export function tytulyWOkresie(platnik: ZusPlatnikDane, okres: string): { osoba: ZusUbezpieczony; tytul: ZusTytul }[] {
  const out: { osoba: ZusUbezpieczony; tytul: ZusTytul }[] = [];
  for (const osoba of platnik.ubezpieczeni) for (const tytul of osoba.tytuly) if (tytulWOkresie(tytul, okres)) out.push({ osoba, tytul });
  return out;
}

/** The payer's sets, newest version per month, oldest month first. */
export function biezaceRozliczenia(rozliczenia: PodatekZusRozliczenie[], nip: string): PodatekZusRozliczenie[] {
  const m = new Map<string, PodatekZusRozliczenie>();
  for (const r of rozliczenia) {
    if (r.nip !== nip) continue;
    const jest = m.get(r.okres);
    if (!jest || r.identyfikator > jest.identyfikator) m.set(r.okres, r);
  }
  return [...m.values()].sort((a, b) => a.okres.localeCompare(b.okres));
}

/**
 * A new month for a payer: one position per title in force, the base carried from the nearest earlier month
 * of the same title (caretakers are paid the same most months), else the title's usual base. Nothing is
 * invented: a title with neither stays empty and blocks the file until the base is typed.
 */
export function szkicRozliczenia(platnik: ZusPlatnikDane, okres: string, wczesniejsze: PodatekZusRozliczenie[]): ZusRozliczenieDane {
  const poprzednie = wczesniejsze.filter((r) => r.okres < okres).sort((a, b) => b.okres.localeCompare(a.okres) || b.identyfikator - a.identyfikator);
  const pozycje = tytulyWOkresie(platnik, okres).map(({ osoba, tytul }): ZusPozycja => {
    let podstawa: number | null = null;
    for (const r of poprzednie) {
      const p = r.dane.pozycje.find((x) => x.kluczOsoby === osoba.klucz && x.kluczTytulu === tytul.klucz);
      if (p && p.podstawa !== null) {
        podstawa = p.podstawa;
        break;
      }
    }
    return { kluczOsoby: osoba.klucz, kluczTytulu: tytul.klucz, podstawa: podstawa ?? tytul.podstawa, przychodZdrowotny: null, zdrowotna: null };
  });
  return { ...pusteDaneRozliczenia(), pozycje };
}

/** A correction of a sent set: the same figures to edit, nothing of the earlier filing. */
export const daneKorekty = (d: ZusRozliczenieDane): ZusRozliczenieDane => ({
  ...normalizeDaneRozliczenia(d),
  wyslane: null,
  pobrania: [],
  zImportu: false,
  przeglad: [],
  dataWypelnienia: null,
});

/* ================================== Problems ================================= */

export interface ZusProblem {
  poziom: 'blad' | 'uwaga';
  tekst: string;
  rodzaj?: 'przeglad';
}

const blad = (tekst: string): ZusProblem => ({ poziom: 'blad', tekst });
const uwaga = (tekst: string): ZusProblem => ({ poziom: 'uwaga', tekst });
const doPrzegladu = (notatki: string[]): ZusProblem => ({ poziom: 'blad', tekst: `Do przeglądu po imporcie: ${notatki.join('; ')}`, rodzaj: 'przeglad' });

export const maBladZus = (p: ZusProblem[]): boolean => p.some((x) => x.poziom === 'blad');

/** What every document of the payer needs: NIP, REGON, the short name. */
export function problemyPlatnika(nip: string, d: ZusPlatnikDane): ZusProblem[] {
  const out: ZusProblem[] = [];
  if (!nipPoprawny(nip)) out.push(blad('Brak poprawnego NIP-u płatnika (10 cyfr, cyfra kontrolna).'));
  if (!/^(\d{9}|\d{14})$/.test(d.regon)) out.push(blad('Brak REGON-u płatnika (9 albo 14 cyfr).'));
  if (!d.nazwaSkrocona) out.push(blad('Brak nazwy skróconej płatnika (tak jak w Płatniku).'));
  if (d.przeglad.length > 0) out.push(doPrzegladu(d.przeglad));
  return out;
}

/** Field limits of the schema — a value over one is an error, never cut (Płatnik would refuse the file). */
const LIMITY_ADRESU: [keyof ZusAdres, number, string][] = [
  ['miejscowosc', 26, 'miejscowość'],
  ['gmina', 26, 'gmina'],
  ['ulica', 30, 'ulica'],
  ['nrDomu', 7, 'numer domu'],
  ['nrLokalu', 7, 'numer lokalu'],
  ['telefon', 12, 'telefon'],
];

/** An address a document prints: postal code of five digits, the town and the house number, nothing too long. */
function problemyAdresu(a: ZusAdres, etykieta: string): ZusProblem[] {
  const out: ZusProblem[] = [];
  if (!/^\d{5}$/.test(a.kodPocztowy) || a.miejscowosc === '' || a.nrDomu === '') {
    out.push(blad(`${etykieta} niepełny (kod pocztowy 5 cyfr, miejscowość, numer domu).`));
  }
  for (const [k, max, nazwa] of LIMITY_ADRESU) if (a[k].length > max) out.push(blad(`${etykieta}: ${nazwa} dłuższa niż ${max} znaków.`));
  return out;
}

/** Who the person is — what every document about them carries. */
export function problemyTozsamosci(o: ZusUbezpieczony): ZusProblem[] {
  const out: ZusProblem[] = [];
  if (o.przeglad.length > 0) out.push(doPrzegladu(o.przeglad));
  if (!o.nazwisko || !o.imie) out.push(blad('Brak imienia lub nazwiska.'));
  if (o.pesel) {
    if (!peselPoprawny(o.pesel)) out.push(blad(`PESEL „${o.pesel}” jest nieprawidłowy.`));
  } else if (!o.rodzajDok || !o.seriaNrDok) {
    out.push(blad('Brak PESEL-u — wtedy rodzaj i numer dokumentu tożsamości.'));
  } else if (o.seriaNrDok.length > 9) {
    out.push(blad('Seria i numer dokumentu dłuższe niż 9 znaków.'));
  }
  if (!o.dataUrodzenia) out.push(blad('Brak daty urodzenia.'));
  if (o.pesel && peselPoprawny(o.pesel) && o.dataUrodzenia && dataZPesela(o.pesel) !== o.dataUrodzenia) {
    out.push(uwaga(`Data urodzenia ${o.dataUrodzenia} nie zgadza się z PESEL-em (${dataZPesela(o.pesel)}).`));
  }
  if (o.nazwisko.length > 31) out.push(blad('Nazwisko dłuższe niż 31 znaków — ZUS przyjmuje 31.'));
  if (o.imie.length > 22) out.push(blad('Imię dłuższe niż 22 znaki — ZUS przyjmuje 22.'));
  return out;
}

/** ZUA / ZZA of one title: the person's full registration data. */
export function problemyZgloszenia(o: ZusUbezpieczony, t: ZusTytul): ZusProblem[] {
  const out = problemyTozsamosci(o);
  if (!o.plec) out.push(blad('Brak płci.'));
  if (!o.obywatelstwo) out.push(blad('Brak obywatelstwa.'));
  out.push(...problemyAdresu(o.adres, 'Adres zameldowania'));
  if (o.adresZamieszkania) out.push(...problemyAdresu(o.adresZamieszkania, 'Adres zamieszkania'));
  if (o.obywatelstwo.length > 22) out.push(blad('Obywatelstwo dłuższe niż 22 znaki.'));
  if (o.imieDrugie.length > 22) out.push(blad('Drugie imię dłuższe niż 22 znaki.'));
  if (o.nazwiskoRodowe.length > 31) out.push(blad('Nazwisko rodowe dłuższe niż 31 znaków.'));
  if (!kodNfzZnany(o.kodNfz)) out.push(blad(o.kodNfz ? `Kod oddziału NFZ „${o.kodNfz}” nie istnieje.` : 'Brak oddziału NFZ.'));
  if (!/^\d{6}$/.test(o.kodZawodu)) out.push(blad('Brak kodu wykonywanego zawodu (6 cyfr).'));
  out.push(...problemyTytulu(t));
  if (!t.od) out.push(blad('Brak daty początku ubezpieczenia.'));
  return out;
}

/** The title itself — code, what it covers. */
export function problemyTytulu(t: ZusTytul): ZusProblem[] {
  const out: ZusProblem[] = [];
  if (!kodTytuluZnany(t.kod)) out.push(blad(`Kod tytułu ubezpieczenia ${t.kod} nie istnieje w słowniku ZUS.`));
  if (t.od && t.do && t.do < t.od) out.push(blad('Koniec ubezpieczenia przed jego początkiem.'));
  if (t.schemat === 'spoleczne' && !t.emerytalne && !t.rentowe && !t.wypadkowe && t.chorobowe === 'brak') {
    out.push(blad('Zgłoszenie do ubezpieczeń społecznych bez żadnego ubezpieczenia — to ZZA (tylko zdrowotne).'));
  }
  if (tytulPracowniczy(t.kod)) {
    if (t.schemat === 'spoleczne' && (!t.emerytalne || !t.rentowe || !t.wypadkowe || t.chorobowe !== 'obowiazkowe')) {
      out.push(uwaga('Pracownik podlega obowiązkowo wszystkim ubezpieczeniom społecznym.'));
    }
    if (!t.wymiarLicznik || !t.wymiarMianownik || t.wymiarLicznik > t.wymiarMianownik) out.push(blad('Brak wymiaru czasu pracy (np. 1/2).'));
  } else if (t.chorobowe === 'obowiazkowe') {
    out.push(uwaga('Chorobowe przy zleceniu jest dobrowolne — oznacz „dobrowolne”.'));
  }
  return out;
}

/** ZWUA of one title. */
export function problemyWyrejestrowania(o: ZusUbezpieczony, t: ZusTytul): ZusProblem[] {
  const out = [...problemyTozsamosci(o), ...problemyTytulu(t)];
  if (!t.do) out.push(blad('Brak ostatniego dnia ubezpieczenia.'));
  if (!t.przyczyna) out.push(blad('Brak kodu przyczyny wyrejestrowania.'));
  if (tytulPracowniczy(t.kod) && t.przyczyna === '100') {
    if (!t.kodWygasniecia || !t.kodPodstawyPrawnej || !t.stronaInicjujaca) {
      out.push(blad('Koniec umowy o pracę: podaj sposób rozwiązania, podstawę prawną i stronę, która je zainicjowała (ZWUA blok V).'));
    }
  }
  return out;
}

/** ZCNA of one family member (registration or deregistration). */
export function problemyCzlonka(o: ZusUbezpieczony, c: ZusCzlonek, rodzaj: 'z' | 'w'): ZusProblem[] {
  const out = problemyTozsamosci(o);
  if (!c.nazwisko || !c.imie) out.push(blad('Członek rodziny: brak imienia lub nazwiska.'));
  if (c.pesel ? !peselPoprawny(c.pesel) : !c.rodzajDok || !c.seriaNrDok) out.push(blad('Członek rodziny: brak poprawnego PESEL-u albo dokumentu.'));
  if (!c.dataUrodzenia) out.push(blad('Członek rodziny: brak daty urodzenia.'));
  if (!c.pokrewienstwo) out.push(blad('Członek rodziny: brak stopnia pokrewieństwa.'));
  if (rodzaj === 'z' && !c.od) out.push(blad('Członek rodziny: brak daty zgłoszenia.'));
  if (rodzaj === 'w' && !c.do) out.push(blad('Członek rodziny: brak daty wyrejestrowania.'));
  out.push(...problemyAdresu(c.adres ?? o.adres, 'Członek rodziny: adres'));
  if (c.nazwisko.length > 31 || c.imie.length > 22) out.push(blad('Członek rodziny: imię (22) lub nazwisko (31) za długie.'));
  return out;
}

/** The month's set: the payer, every position's person and title, the bases, the RSA lines. */
export function problemyRozliczenia(nip: string, platnik: ZusPlatnikDane, r: Pick<PodatekZusRozliczenie, 'okres' | 'identyfikator' | 'dane'>, wynik: ZusWynik): ZusProblem[] {
  const out = problemyPlatnika(nip, platnik);
  if (r.dane.przeglad.length > 0) out.push(doPrzegladu(r.dane.przeglad));
  if (platnik.stopaWypadkowa === null) out.push(blad('Brak stopy procentowej składki wypadkowej.'));
  if (r.identyfikator > 99) out.push(blad('Identyfikator ponad 99.'));
  if (wynik.pozycje.length === 0 && r.dane.rsa.length === 0) out.push(blad('Rozliczenie bez żadnej osoby — nie ma czego wysłać.'));
  if (wynik.osierocone.length > 0) out.push(blad(`Pozycje bez osoby lub tytułu w rejestrze: ${wynik.osierocone.length} — usuń je albo przywróć tytuł.`));
  const widziane = new Set<string>();
  for (const w of wynik.pozycje) {
    const nazwa = nazwaUbezpieczonego(w.osoba) || 'osoba bez nazwiska';
    const tozsamosc = problemyTozsamosci(w.osoba).filter((p) => p.poziom === 'blad' && p.rodzaj !== 'przeglad');
    if (!widziane.has(w.osoba.klucz) && tozsamosc.length > 0) out.push(blad(`${nazwa}: ${tozsamosc.map((p) => p.tekst).join(' ')}`));
    widziane.add(w.osoba.klucz);
    if (w.osoba.przeglad.length > 0) out.push(blad(`${nazwa}: dane do przeglądu po imporcie.`));
    if (!kodTytuluZnany(w.tytul.kod)) out.push(blad(`${nazwa}: kod tytułu ${w.tytul.kod} nie istnieje.`));
    if (w.pozycja.podstawa === null) out.push(blad(`${nazwa}: brak podstawy wymiaru za ${r.okres}.`));
    if (!tytulWOkresie(w.tytul, r.okres)) out.push(uwaga(`${nazwa}: tytuł ${w.tytul.kod} nie obowiązuje w ${r.okres}.`));
    if (tytulPracowniczy(w.tytul.kod) && (!w.tytul.wymiarLicznik || !w.tytul.wymiarMianownik)) out.push(blad(`${nazwa}: brak wymiaru czasu pracy.`));
    if (w.pozycja.zdrowotna !== null && Math.abs(w.pozycja.zdrowotna - w.skladki.zdrowotnaRegula) > 0.004) {
      out.push(uwaga(`${nazwa}: składka zdrowotna wpisana ręcznie (${w.pozycja.zdrowotna.toFixed(2)} zł zamiast ${w.skladki.zdrowotnaRegula.toFixed(2)} zł).`));
    }
    if (w.skladki.podstawaER > 99999999.99 || w.skladki.podstawaZdr > 99999999.99) out.push(blad(`${nazwa}: podstawa poza zakresem.`));
  }
  const pozycjeOsob = new Set(wynik.pozycje.map((w) => kluczPozycji(w.pozycja)));
  for (const s of r.dane.rsa) {
    if (!pozycjeOsob.has(kluczPozycji(s))) out.push(blad('RSA: wpis dla osoby lub tytułu spoza rozliczenia.'));
    if (!/^\d{3}$/.test(s.kod)) out.push(blad('RSA: brak kodu świadczenia / przerwy.'));
    if (!s.od || !s.do) out.push(blad('RSA: brak okresu od–do.'));
    else if (s.do < s.od) out.push(blad('RSA: koniec okresu przed początkiem.'));
  }
  const { potwierdzone } = zusParametry(r.okres);
  if (!potwierdzone) out.push(uwaga(`Płaca minimalna dla ${r.okres.slice(0, 4)} nie jest jeszcze w aplikacji — próg FP liczony z ostatniej znanej.`));
  return out;
}

/**
 * Pension / disability bases above the yearly cap: the year's sum per person over the sets given (newest version
 * of each month). Returned as warnings — the cap is far above anything a community pays, so it is not applied.
 */
export function uwagiLimitu(platnik: ZusPlatnikDane, rozliczeniaRoku: PodatekZusRozliczenie[], rok: number): ZusProblem[] {
  const sumy = new Map<string, number>();
  for (const r of rozliczeniaRoku) {
    if (!r.okres.startsWith(String(rok))) continue;
    for (const w of obliczRozliczenie(platnik, r.dane, r.okres).pozycje) sumy.set(w.osoba.klucz, (sumy.get(w.osoba.klucz) ?? 0) + w.skladki.podstawaER);
  }
  const { limitRoczny } = zusParametry(`${rok}-01`);
  const out: ZusProblem[] = [];
  for (const [klucz, s] of sumy) {
    if (s > limitRoczny) {
      const o = platnik.ubezpieczeni.find((x) => x.klucz === klucz);
      out.push(uwaga(`${o ? nazwaUbezpieczonego(o) : klucz}: podstawa emerytalno-rentowa w ${rok} przekracza roczny limit ${limitRoczny} zł.`));
    }
  }
  return out;
}

/* ================================== Documents ================================ */

export type ZusRodzajDokumentu = 'rozliczenie' | 'zua' | 'zza' | 'zwua' | 'zcna';

/**
 * One document the list ticks and IPC carries:
 *   r:<płatnik>:<okres>                     the month's DRA + RCA (+ RSA), newest version
 *   z:<płatnik>:<osoba>:<tytuł>             ZUA (or ZZA for a health-only title)
 *   w:<płatnik>:<osoba>:<tytuł>             ZWUA
 *   c:<płatnik>:<osoba>:<członek>:<z|w>     ZCNA — registration / deregistration of a family member
 */
export interface ZusDokumentId {
  typ: 'r' | 'z' | 'w' | 'c';
  platnikId: number;
  okres?: string;
  kluczOsoby?: string;
  kluczTytulu?: string;
  kluczCzlonka?: string;
  zdarzenie?: 'z' | 'w';
}

export const idRozliczenia = (platnikId: number, okres: string) => `r:${platnikId}:${okres}`;
export const idZgloszenia = (platnikId: number, osoba: string, tytul: string) => `z:${platnikId}:${osoba}:${tytul}`;
export const idWyrejestrowania = (platnikId: number, osoba: string, tytul: string) => `w:${platnikId}:${osoba}:${tytul}`;
export const idCzlonka = (platnikId: number, osoba: string, czlonek: string, zdarzenie: 'z' | 'w') => `c:${platnikId}:${osoba}:${czlonek}:${zdarzenie}`;

export function rozbijIdZus(id: string): ZusDokumentId | null {
  const c = id.split(':');
  const platnikId = Number(c[1]);
  if (!Number.isInteger(platnikId)) return null;
  if (c[0] === 'r' && c.length === 3 && OKRES.test(c[2])) return { typ: 'r', platnikId, okres: c[2] };
  if ((c[0] === 'z' || c[0] === 'w') && c.length === 4 && c[2] && c[3]) return { typ: c[0], platnikId, kluczOsoby: c[2], kluczTytulu: c[3] };
  if (c[0] === 'c' && c.length === 5 && (c[4] === 'z' || c[4] === 'w')) return { typ: 'c', platnikId, kluczOsoby: c[2], kluczCzlonka: c[3], zdarzenie: c[4] };
  return null;
}

/** The registration documents a month shows: those dated in it, and every one not sent yet that is due by its end. */
export interface ZusZgloszenieMiesiaca {
  id: string;
  rodzaj: Exclude<ZusRodzajDokumentu, 'rozliczenie'>;
  osoba: ZusUbezpieczony;
  tytul?: ZusTytul;
  czlonek?: ZusCzlonek;
  /** The date the document reports. */
  data: string;
  wyslane: ZusZnak | null;
}

export function zgloszeniaMiesiaca(platnikId: number, platnik: ZusPlatnikDane, okres: string): ZusZgloszenieMiesiaca[] {
  const koniec = ostatniDzien(okres);
  const pokaz = (dataDok: string, wyslane: ZusZnak | null) => okresZDaty(dataDok) === okres || (!wyslane && dataDok <= koniec);
  const out: ZusZgloszenieMiesiaca[] = [];
  for (const osoba of platnik.ubezpieczeni) {
    for (const tytul of osoba.tytuly) {
      if (tytul.od && pokaz(tytul.od, tytul.zgloszenie)) {
        out.push({
          id: idZgloszenia(platnikId, osoba.klucz, tytul.klucz),
          rodzaj: tytul.schemat === 'zdrowotne' ? 'zza' : 'zua',
          osoba,
          tytul,
          data: tytul.od,
          wyslane: tytul.zgloszenie,
        });
      }
      const wyr = dataWyrejestrowania(tytul);
      if (wyr && pokaz(wyr, tytul.wyrejestrowanie)) {
        out.push({ id: idWyrejestrowania(platnikId, osoba.klucz, tytul.klucz), rodzaj: 'zwua', osoba, tytul, data: wyr, wyslane: tytul.wyrejestrowanie });
      }
    }
    for (const czlonek of osoba.czlonkowie) {
      if (czlonek.od && pokaz(czlonek.od, czlonek.zgloszenie)) {
        out.push({ id: idCzlonka(platnikId, osoba.klucz, czlonek.klucz, 'z'), rodzaj: 'zcna', osoba, czlonek, data: czlonek.od, wyslane: czlonek.zgloszenie });
      }
      if (czlonek.do && pokaz(czlonek.do, czlonek.wyrejestrowanie)) {
        out.push({ id: idCzlonka(platnikId, osoba.klucz, czlonek.klucz, 'w'), rodzaj: 'zcna', osoba, czlonek, data: czlonek.do, wyslane: czlonek.wyrejestrowanie });
      }
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

export type ZusStan = 'wyslane' | 'blad' | 'uwagi' | 'gotowe' | 'brak';

export function stanZus(problemy: ZusProblem[], wyslane: ZusZnak | null): ZusStan {
  if (wyslane) return 'wyslane';
  if (maBladZus(problemy)) return 'blad';
  return problemy.length > 0 ? 'uwagi' : 'gotowe';
}

export const NAZWA_DOKUMENTU: Record<ZusRodzajDokumentu, string> = {
  rozliczenie: 'DRA + RCA',
  zua: 'ZUS ZUA',
  zza: 'ZUS ZZA',
  zwua: 'ZUS ZWUA',
  zcna: 'ZUS ZCNA',
};


/** A payer's name for folders and files: "WSPÓLNOTA MIESZK. LIPOWA 8" → "WM LIPOWA 8". */
export const nazwaPlatnikaPliku = (nazwa: string): string =>
  czescPliku(nazwa)
    .replace(/^wsp[oó]lnota\s+mieszk(aniowa|\.)?\s*/i, 'WM ')
    .replace(/\s+/g, ' ')
    .trim();

/** The default short name from an address: "Lipowa 8" → "WM LIPOWA 8" (31 characters at most). */
export const nazwaSkroconaZAdresu = (adres: string): string => `WM ${adres}`.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pl-PL').slice(0, 31);

/** The part of a name that tells a community apart, folded — "WSPÓLNOTA MIESZK. LIPOWA 8", "WM Lipowa 8", "Lipowa 8" → "lipowa8". */
export const rdzenPlatnika = (nazwa: string): string =>
  foldText(nazwa.replace(/^\s*wsp[oó]lnota\s+mieszk(aniowa|\.)?\s*/i, '').replace(/^\s*wm\s+/i, '').replace(/^\s*w\.\s*m\.\s*/i, '')).replace(/[\s.]+/g, '');

/* ================================== PIT link ================================= */

export interface ZusSkladkiRoczne {
  /** The insured's social contributions — PIT-11 poz. 95. */
  spoleczne: number;
  /** Health contributions — PIT-11 poz. 122. */
  zdrowotna: number;
  /** Months that went into the sums. */
  miesiace: string[];
}

/**
 * What a community's RCAs of a year withheld from each person (by PESEL) — the PIT-11's poz. 95 and 122. The
 * newest version of each month counts; a month without a set counts nothing.
 */
export function skladkiRoczneZus(platnik: PodatekZusPlatnik | undefined, rozliczenia: PodatekZusRozliczenie[], rok: number): Map<string, ZusSkladkiRoczne> {
  const out = new Map<string, ZusSkladkiRoczne>();
  if (!platnik) return out;
  for (const r of biezaceRozliczenia(rozliczenia, platnik.nip)) {
    if (!r.okres.startsWith(`${rok}-`)) continue;
    for (const w of obliczRozliczenie(platnik.dane, r.dane, r.okres).pozycje) {
      if (!w.osoba.pesel) continue;
      const jest = out.get(w.osoba.pesel) ?? { spoleczne: 0, zdrowotna: 0, miesiace: [] };
      jest.spoleczne = suma(jest.spoleczne, w.skladki.spoleczneU);
      jest.zdrowotna = suma(jest.zdrowotna, w.skladki.zdrowotna);
      if (!jest.miesiace.includes(r.okres)) jest.miesiace.push(r.okres);
      out.set(w.osoba.pesel, jest);
    }
  }
  return out;
}
