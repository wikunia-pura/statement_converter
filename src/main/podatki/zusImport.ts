/**
 * Import of Płatnik's KEDU files into the ZUS module: the register (ZUA / ZZA open a title, ZWUA closes it,
 * ZCNA adds family members, ZPA gives the payer's short name and REGON) and the monthly sets (DRA with its RCA
 * and RSA). Every KEDU version the office's files span (KEDU_3 … KEDU_5_7) is read the same way — by the
 * elements' local names.
 *
 * Nothing is overwritten that the register already holds: a person met again only gains the titles and
 * family members it lacks, a title only gets its end date when it had none; a month the register already has
 * (same payer, month and identifier) is left as it is. What cannot be settled from the files — a person known
 * only from an RCA, contributions that do not add up to what the app works out — goes into the `przeglad`
 * list of the person / set, which blocks the documents until the clerk ticks it off. The import's own messages
 * (`ostrzezenia`) carry no names, PESELs or amounts.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { czysc, tylkoCyfry } from '../../shared/podatki';
import {
  PodatekZusPlatnik,
  PodatekZusRozliczenie,
  ZusAdres,
  ZusCzlonek,
  ZusPlatnikDane,
  ZusPozycja,
  ZusRozliczenieDane,
  ZusRsaWpis,
  ZusTytul,
  ZusUbezpieczony,
  dodajDni,
  kluczTozsamosci,
  normalizeDaneZusPlatnika,
  nowyKluczZus,
  obliczRozliczenie,
  pusteDaneRozliczenia,
  pusteDaneZusPlatnika,
  pustyAdresZus,
  pustyCzlonek,
  pustyTytul,
  pustyUbezpieczony,
  tytulPracowniczy,
} from '../../shared/podatki-zus';
import { XNode, dziecko, parsujXml, tekst } from './pitImport';

/* ================================== Result =================================== */

export interface ZusImportWynik {
  /** Payers new to the register, and the ones the import added people / titles to (whole data, merged). */
  nowiPlatnicy: { nip: string; dane: ZusPlatnikDane }[];
  zmienieniPlatnicy: { id: number; nip: string; dane: ZusPlatnikDane }[];
  /** Months the register lacks. */
  rozliczenia: { nip: string; okres: string; identyfikator: number; dane: ZusRozliczenieDane }[];
  /** Months the register already had — left alone. */
  istniejaceRozliczenia: number;
  plikow: number;
  dokumentow: number;
  pominiete: { plik: string; powod: string }[];
  ostrzezenia: string[];
}

/* ================================ Raw documents =============================== */

const t = (n: XNode | undefined, ...s: string[]) => tekst(n, ...s) ?? '';
const tak = (n: XNode | undefined, ...s: string[]) => t(n, ...s).toLowerCase() === 'true';
const liczba = (n: XNode | undefined, ...s: string[]): number => {
  const v = Number(t(n, ...s).replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};
const dataPola = (n: XNode | undefined, ...s: string[]): string | null => {
  const v = t(n, ...s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};

interface Platnik {
  nip: string;
  regon: string;
  nazwa: string;
}

const platnikZ = (ii: XNode | undefined, polaNazwy: string[] = ['p6', 'p3']): Platnik => ({
  nip: tylkoCyfry(t(ii, 'p1')),
  regon: tylkoCyfry(t(ii, 'p2')),
  nazwa: czysc(polaNazwy.map((p) => t(ii, p)).find((x) => x !== '') ?? ''),
});

/** Block III of ZUA / ZZA / ZWUA / ZCNA: the insured's identity. */
function tozsamoscZ(iii: XNode | undefined): Pick<ZusUbezpieczony, 'pesel' | 'nip' | 'rodzajDok' | 'seriaNrDok' | 'nazwisko' | 'imie' | 'dataUrodzenia'> {
  return {
    pesel: tylkoCyfry(t(iii, 'p1')),
    nip: tylkoCyfry(t(iii, 'p2')),
    rodzajDok: t(iii, 'p3') === '1' || t(iii, 'p3') === '2' ? t(iii, 'p3') : '',
    seriaNrDok: czysc(t(iii, 'p4')).replace(/\s/g, ''),
    nazwisko: czysc(t(iii, 'p5')),
    imie: czysc(t(iii, 'p6')),
    dataUrodzenia: dataPola(iii, 'p7'),
  };
}

/** Address blocks: ZUA XI/XII, ZZA VIII/IX, ZCNA IV.B — the same p1–p7 layout. */
function adresZ(n: XNode | undefined): ZusAdres | null {
  if (!n) return null;
  return {
    kodPocztowy: tylkoCyfry(t(n, 'p1')).slice(0, 5),
    miejscowosc: czysc(t(n, 'p2')),
    gmina: czysc(t(n, 'p3')),
    ulica: czysc(t(n, 'p4')),
    nrDomu: czysc(t(n, 'p5')),
    nrLokalu: czysc(t(n, 'p6')),
    telefon: czysc(t(n, 'p7')),
  };
}

/** Kod tytułu ubezpieczenia (three parts) of a block: `<p1><p1>0411</p1><p2>0</p2><p3>0</p3></p1>`. */
function kodZ(n: XNode | undefined): { kod: string; emRent: string; niepelnosprawnosc: string } {
  return { kod: t(n, 'p1'), emRent: t(n, 'p2') || '0', niepelnosprawnosc: t(n, 'p3') || '0' };
}

interface DokZgloszenie {
  rodzaj: 'zua' | 'zza';
  platnik: Platnik;
  osoba: ReturnType<typeof tozsamoscZ> & Pick<ZusUbezpieczony, 'imieDrugie' | 'nazwiskoRodowe' | 'obywatelstwo' | 'plec' | 'kodNfz' | 'kodZawodu'>;
  adres: ZusAdres | null;
  adresZamieszkania: ZusAdres | null;
  tytul: Pick<ZusTytul, 'kod' | 'emRent' | 'niepelnosprawnosc' | 'schemat' | 'emerytalne' | 'rentowe' | 'wypadkowe' | 'chorobowe' | 'od'>;
  data: string | null;
}

interface DokWyrejestrowanie {
  platnik: Platnik;
  osoba: ReturnType<typeof tozsamoscZ>;
  kod: { kod: string; emRent: string; niepelnosprawnosc: string };
  od: string | null;
  przyczyna: string;
  koniec: Pick<ZusTytul, 'dataRozwiazania' | 'kodWygasniecia' | 'kodPodstawyPrawnej' | 'podstawaPrawna' | 'stronaInicjujaca'>;
  korekta: boolean;
  data: string | null;
}

interface DokCzlonkowie {
  platnik: Platnik;
  osoba: ReturnType<typeof tozsamoscZ>;
  zdarzenia: { zdarzenie: 'z' | 'w'; czlonek: Omit<ZusCzlonek, 'klucz' | 'od' | 'do' | 'zgloszenie' | 'wyrejestrowanie' | 'pobrania'>; data: string | null }[];
  data: string | null;
}

interface BlokRca {
  nazwisko: string;
  imie: string;
  typ: string;
  identyfikator: string;
  kod: { kod: string; emRent: string; niepelnosprawnosc: string };
  wymiar: [number, number] | null;
  /** B p4…p29 by position; C p1…p5 as c[1..5]. */
  b: number[];
  c: number[];
}

interface BlokRsa {
  nazwisko: string;
  imie: string;
  typ: string;
  identyfikator: string;
  kod: { kod: string; emRent: string; niepelnosprawnosc: string };
  kodSwiadczenia: string;
  od: string | null;
  do: string | null;
  dni: number | null;
  kwota: number | null;
}

interface Zestaw {
  platnik: Platnik;
  okres: string;
  identyfikator: number;
  dra: { termin: string; stopa: number | null; liczba: number; iv37: number; vi7: number; ix2: number; vii3: number; data: string | null } | null;
  rca: BlokRca[];
  rsa: BlokRsa[];
}

const ID_OKRES = (n: XNode | undefined) => ({ identyfikator: Number(t(n, 'p1')) || 1, okres: t(n, 'p2').slice(0, 7) });

function bloki(dok: XNode, nazwa: string): XNode[] {
  return dok.kids.filter((k) => k.name === nazwa);
}

const pola = (n: XNode | undefined, ile: number): number[] => {
  const out = new Array<number>(ile + 1).fill(0);
  for (let i = 1; i <= ile; i++) out[i] = liczba(n, `p${i}`);
  return out;
};

/* =============================== Reading a file =============================== */

interface Odczyt {
  zgloszenia: DokZgloszenie[];
  wyrejestrowania: DokWyrejestrowanie[];
  czlonkowie: DokCzlonkowie[];
  zestawy: Zestaw[];
  platnicy: Platnik[];
  dokumentow: number;
}

/** Every document of one KEDU (also inside `zestaw` elements). Throws on a file that is not KEDU. */
export function czytajKedu(xml: string): Odczyt {
  const korzen = parsujXml(xml.replace(/^﻿/, ''));
  if (korzen.name !== 'KEDU') throw new Error('to nie jest plik KEDU');
  const dokumenty: XNode[] = [];
  for (const k of korzen.kids) {
    if (k.name === 'zestaw') dokumenty.push(...k.kids.filter((x) => x.name.startsWith('ZUS')));
    else if (k.name.startsWith('ZUS')) dokumenty.push(k);
  }
  const out: Odczyt = { zgloszenia: [], wyrejestrowania: [], czlonkowie: [], zestawy: [], platnicy: [], dokumentow: dokumenty.length };
  const zestawy = new Map<string, Zestaw>();
  const zestaw = (platnik: Platnik, okres: string, identyfikator: number): Zestaw => {
    const klucz = `${platnik.nip}|${okres}|${identyfikator}`;
    let z = zestawy.get(klucz);
    if (!z) {
      z = { platnik, okres, identyfikator, dra: null, rca: [], rsa: [] };
      zestawy.set(klucz, z);
    }
    return z;
  };

  for (const d of dokumenty) {
    switch (d.name) {
      case 'ZUSZPA':
        out.platnicy.push(platnikZ(dziecko(d, 'II'), ['p3', 'p6']));
        break;
      case 'ZUSZUA':
      case 'ZUSZZA': {
        const zza = d.name === 'ZUSZZA';
        const iv = dziecko(d, 'IV');
        const v = dziecko(d, 'V');
        const vi = dziecko(d, 'VI');
        const vii = dziecko(d, 'VII');
        const viii = dziecko(d, 'VIII');
        const kod = kodZ(dziecko(v, 'p1'));
        const chorobowe = !zza && tak(vi, 'p4') ? 'obowiazkowe' : !zza && tak(viii, 'p5') ? 'dobrowolne' : 'brak';
        out.zgloszenia.push({
          rodzaj: zza ? 'zza' : 'zua',
          platnik: platnikZ(dziecko(d, 'II')),
          osoba: {
            ...tozsamoscZ(dziecko(d, 'III')),
            imieDrugie: czysc(t(iv, 'p1')),
            nazwiskoRodowe: czysc(t(iv, 'p2')),
            obywatelstwo: czysc(t(iv, 'p3')),
            plec: t(iv, 'p4').toUpperCase(),
            kodNfz: (zza ? t(vi, 'p2') : t(vii, 'p2')).toUpperCase(),
            kodZawodu: tylkoCyfry(zza ? t(v, 'p2') : t(dziecko(d, 'X'), 'p1')),
          },
          adres: adresZ(dziecko(d, zza ? 'VIII' : 'XI')),
          adresZamieszkania: adresZ(dziecko(d, zza ? 'IX' : 'XII')),
          tytul: {
            ...kod,
            schemat: zza ? 'zdrowotne' : 'spoleczne',
            emerytalne: !zza && tak(vi, 'p2'),
            rentowe: !zza && tak(vi, 'p3'),
            wypadkowe: !zza && tak(vi, 'p5'),
            chorobowe,
            od: zza ? dataPola(vi, 'p1') : (dataPola(vi, 'p1') ?? dataPola(vii, 'p1')),
          },
          data: dataPola(dziecko(d, zza ? 'XI' : 'XIV'), 'p1'),
        });
        break;
      }
      case 'ZUSZWUA': {
        const iv = dziecko(d, 'IV');
        const v = dziecko(d, 'V');
        out.wyrejestrowania.push({
          platnik: platnikZ(dziecko(d, 'II')),
          osoba: tozsamoscZ(dziecko(d, 'III')),
          kod: kodZ(dziecko(iv, 'p1')),
          od: dataPola(iv, 'p2'),
          przyczyna: tylkoCyfry(t(iv, 'p3')),
          koniec: {
            dataRozwiazania: dataPola(v, 'p1'),
            kodWygasniecia: t(v, 'p2').toUpperCase(),
            kodPodstawyPrawnej: tylkoCyfry(t(v, 'p3')),
            podstawaPrawna: czysc(t(v, 'p4')),
            stronaInicjujaca: t(v, 'p5') === '1' || t(v, 'p5') === '2' ? t(v, 'p5') : '',
          },
          korekta: tak(dziecko(d, 'I'), 'p2'),
          data: dataPola(dziecko(d, 'VI'), 'p1'),
        });
        break;
      }
      case 'ZUSZCNA': {
        const zdarzenia: DokCzlonkowie['zdarzenia'] = [];
        for (const iv of bloki(d, 'IV')) {
          const a = dziecko(iv, 'A');
          const adres = adresZ(dziecko(iv, 'B'));
          zdarzenia.push({
            zdarzenie: t(a, 'p1') === '2' ? 'w' : 'z',
            data: dataPola(a, 'p2'),
            czlonek: {
              pesel: tylkoCyfry(t(a, 'p3')),
              rodzajDok: t(a, 'p5') === '1' || t(a, 'p5') === '2' ? t(a, 'p5') : '',
              seriaNrDok: czysc(t(a, 'p6')).replace(/\s/g, ''),
              nazwisko: czysc(t(a, 'p7')),
              imie: czysc(t(a, 'p8')),
              dataUrodzenia: dataPola(a, 'p9'),
              pokrewienstwo: tylkoCyfry(t(a, 'p10')),
              wspolneGospodarstwo: t(a, 'p11') === '' ? true : tak(a, 'p11'),
              niepelnosprawnosc: t(a, 'p12'),
              adres,
            },
          });
        }
        out.czlonkowie.push({ platnik: platnikZ(dziecko(d, 'II')), osoba: tozsamoscZ(dziecko(d, 'III')), zdarzenia, data: dataPola(dziecko(d, 'VI'), 'p1') });
        break;
      }
      case 'ZUSDRA': {
        const i = dziecko(d, 'I');
        const { identyfikator, okres } = ID_OKRES(dziecko(i, 'p2'));
        const z = zestaw(platnikZ(dziecko(d, 'II')), okres, identyfikator);
        const stopa = t(d, 'III', 'p3');
        z.dra = {
          termin: t(i, 'p1'),
          stopa: stopa === '' ? null : Number(stopa),
          liczba: liczba(d, 'III', 'p1'),
          iv37: liczba(d, 'IV', 'p37'),
          vi7: liczba(d, 'VI', 'p7'),
          vii3: liczba(d, 'VII', 'p3'),
          ix2: liczba(d, 'IX', 'p2'),
          data: dataPola(dziecko(d, 'XIII'), 'p1'),
        };
        break;
      }
      case 'ZUSRCA':
      case 'ZUSRSA': {
        const { identyfikator, okres } = ID_OKRES(dziecko(d, 'I', 'p1'));
        const z = zestaw(platnikZ(dziecko(d, 'II')), okres, identyfikator);
        for (const iii of bloki(d, 'III')) {
          const a = dziecko(iii, 'A');
          const b = dziecko(iii, 'B');
          const kto = { nazwisko: czysc(t(a, 'p1')), imie: czysc(t(a, 'p2')), typ: t(a, 'p3'), identyfikator: czysc(t(a, 'p4')) };
          if (d.name === 'ZUSRCA') {
            const w = dziecko(b, 'p3');
            z.rca.push({
              ...kto,
              kod: kodZ(dziecko(b, 'p1')),
              wymiar: w ? [liczba(w, 'p1'), liczba(w, 'p2')] : null,
              b: pola(b, 29),
              c: pola(dziecko(iii, 'C'), 5),
            });
          } else {
            const dni = t(b, 'p5');
            const kw = t(b, 'p6');
            z.rsa.push({
              ...kto,
              kod: kodZ(dziecko(b, 'p1')),
              kodSwiadczenia: t(b, 'p2'),
              od: dataPola(b, 'p3'),
              do: dataPola(b, 'p4'),
              dni: dni === '' ? null : Number(dni),
              kwota: kw === '' ? null : Number(kw),
            });
          }
        }
        break;
      }
      default:
        break;
    }
  }
  out.zestawy = [...zestawy.values()].filter((z) => /^\d{4}-\d{2}$/.test(z.okres));
  return out;
}

/* ================================ Building ==================================== */

const IMPORT = 'import z Płatnika';
const zImportu = (data: string | null) => ({ at: data ? `${data}T12:00:00.000Z` : new Date().toISOString(), by: IMPORT });

interface Rejestr {
  id: number | null;
  nip: string;
  dane: ZusPlatnikDane;
  zmieniony: boolean;
}

const zgodny = (t1: Pick<ZusTytul, 'kod' | 'emRent' | 'niepelnosprawnosc'>, k: { kod: string; emRent: string; niepelnosprawnosc: string }) =>
  t1.kod === k.kod && t1.emRent === k.emRent && t1.niepelnosprawnosc === k.niepelnosprawnosc;

/**
 * Reads the files and merges them into the register as it is (`istniejacy`, `istniejaceRozliczenia`). Files
 * are KEDU XML; anything else is listed as skipped.
 */
export async function importujKedu(
  pliki: string[],
  istniejacy: PodatekZusPlatnik[],
  istniejaceRozliczenia: PodatekZusRozliczenie[],
): Promise<ZusImportWynik> {
  const wynik: ZusImportWynik = {
    nowiPlatnicy: [],
    zmienieniPlatnicy: [],
    rozliczenia: [],
    istniejaceRozliczenia: 0,
    plikow: 0,
    dokumentow: 0,
    pominiete: [],
    ostrzezenia: [],
  };
  const odczyty: Odczyt[] = [];
  for (const plik of pliki) {
    try {
      const xml = await fs.readFile(plik, 'utf8');
      const o = czytajKedu(xml);
      wynik.plikow += 1;
      wynik.dokumentow += o.dokumentow;
      if (o.dokumentow === 0) wynik.pominiete.push({ plik: path.basename(plik), powod: 'brak dokumentów ZUS w pliku' });
      odczyty.push(o);
    } catch (error: unknown) {
      wynik.pominiete.push({ plik: path.basename(plik), powod: error instanceof Error ? error.message : String(error) });
    }
  }

  const rejestr = new Map<string, Rejestr>();
  for (const p of istniejacy) rejestr.set(p.nip, { id: p.id, nip: p.nip, dane: normalizeDaneZusPlatnika(p.dane), zmieniony: false });
  const platnik = (p: Platnik): Rejestr | null => {
    if (!/^\d{10}$/.test(p.nip)) return null;
    let r = rejestr.get(p.nip);
    if (!r) {
      r = { id: null, nip: p.nip, dane: { ...pusteDaneZusPlatnika(), nazwaSkrocona: p.nazwa.slice(0, 31), regon: p.regon }, zmieniony: true };
      rejestr.set(p.nip, r);
    }
    if (!r.dane.nazwaSkrocona && p.nazwa) {
      r.dane.nazwaSkrocona = p.nazwa.slice(0, 31);
      r.zmieniony = true;
    }
    if (!r.dane.regon && p.regon) {
      r.dane.regon = p.regon;
      r.zmieniony = true;
    }
    return r;
  };
  let bezNipu = 0;

  /** The person of the register by identity, created (from what the document says) when new. */
  const osoba = (r: Rejestr, kto: ReturnType<typeof tozsamoscZ>): ZusUbezpieczony => {
    const klucz = kluczTozsamosci(kto);
    let o = r.dane.ubezpieczeni.find((x) => kluczTozsamosci(x) === klucz);
    if (!o) {
      o = { ...pustyUbezpieczony(), ...kto, obywatelstwo: '', adres: pustyAdresZus(), kodNfz: '' };
      r.dane.ubezpieczeni.push(o);
      r.zmieniony = true;
    }
    return o;
  };

  // Registrations first, in date order, so a deregistration finds the title it closes.
  const zgloszenia = odczyty.flatMap((o) => o.zgloszenia).sort((a, b) => (a.tytul.od ?? '').localeCompare(b.tytul.od ?? ''));
  for (const z of zgloszenia) {
    const r = platnik(z.platnik);
    if (!r) {
      bezNipu += 1;
      continue;
    }
    const o = osoba(r, z.osoba);
    // The person's data: the import fills what is empty, never what the register holds.
    const uzupelnij = <K extends keyof ZusUbezpieczony>(k: K, v: ZusUbezpieczony[K]) => {
      if ((o[k] === '' || o[k] === null) && v !== '' && v !== null) {
        o[k] = v;
        r.zmieniony = true;
      }
    };
    for (const k of ['imieDrugie', 'nazwiskoRodowe', 'obywatelstwo', 'plec', 'kodNfz', 'kodZawodu', 'nip', 'dataUrodzenia'] as const) uzupelnij(k, z.osoba[k]);
    if (z.adres && Object.values(o.adres).every((v) => v === '')) {
      o.adres = z.adres;
      r.zmieniony = true;
    }
    if (z.adresZamieszkania && !o.adresZamieszkania) {
      o.adresZamieszkania = z.adresZamieszkania;
      r.zmieniony = true;
    }
    // The same title again (a change / correction ZUA, or a second import): the register keeps its own.
    if (o.tytuly.some((x) => zgodny(x, z.tytul) && x.od === z.tytul.od)) continue;
    const nowy: ZusTytul = {
      ...pustyTytul(z.tytul.kod),
      ...z.tytul,
      wymiarLicznik: null,
      wymiarMianownik: null,
      zgloszenie: zImportu(z.data),
    };
    o.tytuly.push(nowy);
    r.zmieniony = true;
  }

  for (const w of odczyty.flatMap((o) => o.wyrejestrowania).sort((a, b) => (a.od ?? '').localeCompare(b.od ?? ''))) {
    const r = platnik(w.platnik);
    if (!r) {
      bezNipu += 1;
      continue;
    }
    const o = osoba(r, w.osoba);
    const ostatni = w.od ? dodajDni(w.od, -1) : null;
    const kandydaci = o.tytuly
      .filter((x) => zgodny(x, w.kod) && (!w.od || !x.od || x.od <= w.od))
      .sort((a, b) => (b.od ?? '').localeCompare(a.od ?? ''));
    let tytul = kandydaci.find((x) => !x.do) ?? (w.korekta ? kandydaci[0] : undefined);
    if (!tytul) {
      if (kandydaci.some((x) => x.do === ostatni)) continue;
      tytul = { ...pustyTytul(w.kod.kod), ...w.kod, wymiarLicznik: null, wymiarMianownik: null };
      o.tytuly.push(tytul);
      o.przeglad = [...new Set([...o.przeglad, `Wyrejestrowanie (ZWUA) z tytułu ${w.kod.kod} bez zgłoszenia w importowanych plikach — uzupełnij początek ubezpieczenia i zakres.`])];
    }
    tytul.do = ostatni;
    tytul.przyczyna = w.przyczyna || '100';
    tytul.dataRozwiazania = w.koniec.dataRozwiazania;
    tytul.kodWygasniecia = w.koniec.kodWygasniecia;
    tytul.kodPodstawyPrawnej = w.koniec.kodPodstawyPrawnej;
    tytul.podstawaPrawna = w.koniec.podstawaPrawna;
    tytul.stronaInicjujaca = w.koniec.stronaInicjujaca;
    tytul.wyrejestrowanie = zImportu(w.data);
    r.zmieniony = true;
  }

  for (const c of odczyty.flatMap((o) => o.czlonkowie)) {
    const r = platnik(c.platnik);
    if (!r) {
      bezNipu += 1;
      continue;
    }
    const o = osoba(r, c.osoba);
    for (const z of c.zdarzenia) {
      const klucz = kluczTozsamosci(z.czlonek);
      let cz = o.czlonkowie.find((x) => kluczTozsamosci(x) === klucz);
      if (!cz) {
        cz = { ...pustyCzlonek(), ...z.czlonek };
        o.czlonkowie.push(cz);
        r.zmieniony = true;
      }
      if (z.zdarzenie === 'z' && !cz.od) {
        cz.od = z.data;
        cz.zgloszenie = zImportu(c.data);
        r.zmieniony = true;
      }
      if (z.zdarzenie === 'w' && !cz.do) {
        cz.do = z.data;
        cz.wyrejestrowanie = zImportu(c.data);
        r.zmieniony = true;
      }
    }
  }

  for (const p of odczyty.flatMap((o) => o.platnicy)) platnik(p);

  /* --------------------------------- monthly sets --------------------------------- */

  const istnieje = new Set(istniejaceRozliczenia.map((r) => `${r.nip}|${r.okres}|${r.identyfikator}`));
  const zestawy = odczyty.flatMap((o) => o.zestawy).sort((a, b) => a.okres.localeCompare(b.okres) || a.identyfikator - b.identyfikator);
  /** The sets built so far, for a correction's people who are not in its RCA. */
  const zbudowane = new Map<string, ZusRozliczenieDane>();
  for (const r of istniejaceRozliczenia) zbudowane.set(`${r.nip}|${r.okres}|${r.identyfikator}`, r.dane);

  for (const z of zestawy) {
    const r = platnik(z.platnik);
    if (!r) {
      bezNipu += 1;
      continue;
    }
    const klucz = `${r.nip}|${z.okres}|${z.identyfikator}`;
    if (istnieje.has(klucz) || zbudowane.has(klucz)) {
      wynik.istniejaceRozliczenia += 1;
      continue;
    }
    if (z.dra?.stopa != null && r.dane.stopaWypadkowa !== z.dra.stopa) {
      r.dane.stopaWypadkowa = z.dra.stopa;
      r.zmieniony = true;
    }
    if (z.dra?.termin && /^\d$/.test(z.dra.termin) && r.dane.terminDra !== z.dra.termin) {
      r.dane.terminDra = z.dra.termin;
      r.zmieniony = true;
    }
    const dane: ZusRozliczenieDane = { ...pusteDaneRozliczenia(), zImportu: true, wyslane: zImportu(z.dra?.data ?? null), dataWypelnienia: z.dra?.data ?? null };
    const notatki: string[] = [];

    const osobaRaportu = (b: { nazwisko: string; imie: string; typ: string; identyfikator: string }): ZusUbezpieczony => {
      const pesel = b.typ === 'P' ? tylkoCyfry(b.identyfikator) : '';
      const o = osoba(r, { pesel, nip: '', rodzajDok: b.typ === '1' || b.typ === '2' ? b.typ : '', seriaNrDok: pesel ? '' : b.identyfikator, nazwisko: b.nazwisko, imie: b.imie, dataUrodzenia: null });
      if (o.tytuly.length === 0 && !o.przeglad.some((x) => x.startsWith('Osoba znana tylko z raportu'))) {
        o.przeglad.push('Osoba znana tylko z raportu RCA / RSA — brak jej zgłoszenia w importowanych plikach: uzupełnij dane osobowe, adres i początek ubezpieczenia.');
      }
      return o;
    };

    /** The title a report block belongs to: in force in the month, else any of the code; created when none. */
    const tytulRaportu = (o: ZusUbezpieczony, k: BlokRca['kod'], blok?: BlokRca): ZusTytul => {
      const wMiesiacu = o.tytuly.filter((x) => zgodny(x, k) && (!x.od || x.od <= `${z.okres}-31`) && (!x.do || x.do >= `${z.okres}-01`));
      const tytul = wMiesiacu[0] ?? o.tytuly.find((x) => zgodny(x, k));
      if (tytul) return tytul;
      const nowy: ZusTytul = { ...pustyTytul(k.kod), ...k };
      if (blok) {
        const zero = blok.b.slice(4).every((v) => v === 0);
        nowy.schemat = zero && blok.c[1] > 0 ? 'zdrowotne' : 'spoleczne';
        nowy.emerytalne = blok.b[7] > 0;
        nowy.rentowe = blok.b[8] > 0;
        nowy.chorobowe = blok.b[9] > 0 ? (tytulPracowniczy(k.kod) ? 'obowiazkowe' : 'dobrowolne') : 'brak';
        nowy.wypadkowe = blok.b[14] > 0;
        if (blok.wymiar) [nowy.wymiarLicznik, nowy.wymiarMianownik] = blok.wymiar;
      }
      o.tytuly.push(nowy);
      r.zmieniony = true;
      return nowy;
    };

    for (const b of z.rca) {
      const o = osobaRaportu(b);
      const tytul = tytulRaportu(o, b.kod, b);
      if (b.wymiar && tytul.wymiarLicznik === null) {
        [tytul.wymiarLicznik, tytul.wymiarMianownik] = b.wymiar;
        r.zmieniony = true;
      }
      // A title known only from its registration says nothing of sickness insurance on a mandate: the RCA does.
      if (b.b[9] > 0 && tytul.chorobowe === 'brak' && tytul.schemat === 'spoleczne') {
        tytul.chorobowe = tytulPracowniczy(tytul.kod) ? 'obowiazkowe' : 'dobrowolne';
        r.zmieniony = true;
      }
      const podstawa = b.b[4] > 0 ? b.b[4] : b.c[1];
      const pozycja: ZusPozycja = { kluczOsoby: o.klucz, kluczTytulu: tytul.klucz, podstawa, przychodZdrowotny: null, zdrowotna: null };
      // A health base above what the social one leaves is income only the health contribution is due on —
      // sick pay in a month of sick leave.
      const przed = obliczRozliczenie(r.dane, { pozycje: [pozycja] }, z.okres).pozycje[0]?.skladki;
      if (przed && b.c[1] - przed.podstawaZdr >= 0.005) pozycja.przychodZdrowotny = Math.round((b.c[1] - przed.podstawaZdr) * 100) / 100;
      // The figures of the file against the app's, block by block.
      const policzone = obliczRozliczenie(r.dane, { pozycje: [pozycja] }, z.okres).pozycje[0]?.skladki;
      if (policzone) {
        if (Math.abs(policzone.zdrowotna - b.c[4]) >= 0.005) pozycja.zdrowotna = b.c[4];
        const rozne = (
          [
            ['p29', policzone.razem, b.b[29]],
            ['p7', policzone.emU, b.b[7]],
            ['p8', policzone.renU, b.b[8]],
            ['p9', policzone.chU, b.b[9]],
            ['p14', policzone.wypP, b.b[14]],
            ['C p1', policzone.podstawaZdr, b.c[1]],
          ] as [string, number, number][]
        ).filter(([, a, c]) => Math.abs(a - c) >= 0.005);
        if (rozne.length > 0) {
          notatki.push(
            `RCA ${z.okres}, ${b.nazwisko} ${b.imie}: składki z pliku różnią się od wyliczonych (${rozne.map(([p, a, c]) => `${p}: ${c.toFixed(2)} w pliku, ${a.toFixed(2)} wyliczone`).join(', ')}).`,
          );
        }
      }
      dane.pozycje.push(pozycja);
    }

    for (const b of z.rsa) {
      const o = osobaRaportu(b);
      const tytul = tytulRaportu(o, b.kod);
      const wpis: ZusRsaWpis = { klucz: nowyKluczZus('r'), kluczOsoby: o.klucz, kluczTytulu: tytul.klucz, kod: b.kodSwiadczenia, od: b.od, do: b.do, dni: b.dni, kwota: b.kwota };
      dane.rsa.push(wpis);
      if (!dane.pozycje.some((p) => p.kluczOsoby === o.klucz && p.kluczTytulu === tytul.klucz)) {
        dane.pozycje.push({ kluczOsoby: o.klucz, kluczTytulu: tytul.klucz, podstawa: 0, przychodZdrowotny: null, zdrowotna: null });
      }
    }

    // A correction's RCA carries only the people whose figures changed: the others come from the version before.
    if (z.identyfikator > 1) {
      let poprzednia: ZusRozliczenieDane | undefined;
      for (let i = z.identyfikator - 1; i >= 1 && !poprzednia; i--) poprzednia = zbudowane.get(`${r.nip}|${z.okres}|${i}`);
      if (poprzednia) {
        for (const p of poprzednia.pozycje) {
          if (!dane.pozycje.some((x) => x.kluczOsoby === p.kluczOsoby && x.kluczTytulu === p.kluczTytulu)) dane.pozycje.push({ ...p });
        }
      } else if (z.dra && z.dra.liczba > new Set(dane.pozycje.map((p) => p.kluczOsoby)).size) {
        notatki.push(`Korekta ${String(z.identyfikator).padStart(2, '0')} za ${z.okres} bez pierwotnego zestawu w importowanych plikach — brakuje osób, których korekta nie zmienia; dopisz je.`);
      }
    }

    if (z.dra) {
      const osobZestawu = new Set(dane.pozycje.map((p) => p.kluczOsoby)).size;
      if (z.dra.liczba > 0 && z.dra.liczba !== osobZestawu) dane.liczbaUbezpieczonych = z.dra.liczba;
      const policzone = obliczRozliczenie(r.dane, dane, z.okres).dra;
      const kompletne = !notatki.some((n) => n.startsWith('Korekta'));
      if (kompletne && (Math.abs(policzone.spoleczne - z.dra.iv37) >= 0.005 || Math.abs(policzone.zdrowotna - z.dra.vi7) >= 0.005)) {
        notatki.push(
          `DRA ${z.okres}: sumy z pliku (społeczne ${z.dra.iv37.toFixed(2)}, zdrowotna ${z.dra.vi7.toFixed(2)}) różnią się od wyliczonych (${policzone.spoleczne.toFixed(2)}, ${policzone.zdrowotna.toFixed(2)}).`,
        );
      }
      if (kompletne && Math.abs(policzone.fp + policzone.fgsp - z.dra.vii3) >= 0.005) {
        notatki.push(`DRA ${z.okres}: FP/FGŚP z pliku ${z.dra.vii3.toFixed(2)} zł, wyliczone ${(policzone.fp + policzone.fgsp).toFixed(2)} zł — sprawdź ustawienia FP płatnika i daty urodzenia.`);
      }
    } else {
      notatki.push(`Raporty za ${z.okres} bez deklaracji DRA w importowanych plikach.`);
    }
    dane.przeglad = notatki;
    zbudowane.set(klucz, dane);
    wynik.rozliczenia.push({ nip: r.nip, okres: z.okres, identyfikator: z.identyfikator, dane });
  }

  if (bezNipu > 0) wynik.ostrzezenia.push(`Dokumenty bez poprawnego NIP-u płatnika: ${bezNipu} — pominięte.`);
  for (const r of rejestr.values()) {
    if (!r.zmieniony) continue;
    if (r.id === null) wynik.nowiPlatnicy.push({ nip: r.nip, dane: r.dane });
    else wynik.zmienieniPlatnicy.push({ id: r.id, nip: r.nip, dane: r.dane });
  }
  return wynik;
}
