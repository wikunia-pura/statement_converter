/**
 * ZUS documents as a KEDU 5.7 file (http://www.zus.pl/2026/KEDU_5_7, the schema of Płatnik 10.02.002 with the
 * 2026 dictionaries) — what Płatnik's "Import dokumentów z pliku KEDU" and ePłatnik's "Import KEDU" read. The
 * clerk imports the file, checks it there, signs and sends; nothing here talks to ZUS.
 *
 * Layout as the office's Płatnik exports have it: element order of the schema's sequences, ISO dates, amounts
 * with two decimals, names in capitals. Płatnik's own bookkeeping (identyfikacja.PL / UB, the status
 * attributes, cechy.KEDU) is left out — Płatnik fills it in on import. Validated against the schema by
 * scripts/zus-check.ts.
 */

import { Wezel, duze, el, gr, kwota2, zlozXml } from './eDeklaracjeXml';
import {
  ZusAdres,
  ZusCzlonek,
  ZusPlatnikDane,
  ZusRozliczenieDane,
  ZusTytul,
  ZusUbezpieczony,
  ZusWynik,
  dataWyrejestrowania,
  dniOkresu,
  kluczPozycji,
  tytulPracowniczy,
} from '../../shared/podatki-zus';

export const KEDU_NS = 'http://www.zus.pl/2026/KEDU_5_7';

export interface ProgramKedu {
  producent: string;
  symbol: string;
  wersja: string;
}

export interface PlatnikKedu {
  nip: string;
  dane: Pick<ZusPlatnikDane, 'regon' | 'nazwaSkrocona' | 'stopaWypadkowa' | 'terminDra'>;
}

/** One document before the file numbers it. */
export interface DokumentKedu {
  nazwa: 'ZUSDRA' | 'ZUSRCA' | 'ZUSRSA' | 'ZUSZUA' | 'ZUSZZA' | 'ZUSZWUA' | 'ZUSZCNA';
  bloki: Wezel[];
}

const k = (x: number) => kwota2(x);
const nn = (n: number) => String(n).padStart(2, '0');
const opt = (nazwa: string, v: string | null | undefined): Wezel[] => (v ? [el(nazwa, v)] : []);
/** Leave a block out when none of its fields is filled. */
const blok = (nazwa: string, dzieci: Wezel[], atr?: [string, string][]): Wezel[] => (dzieci.length > 0 ? [gr(nazwa, dzieci, atr)] : []);

/** Block II of every document: the payer. */
const blokPlatnika = (p: PlatnikKedu): Wezel => gr('II', [el('p1', p.nip), ...opt('p2', p.dane.regon), el('p6', duze(p.dane.nazwaSkrocona))]);

const kodTytulu = (nazwa: string, t: Pick<ZusTytul, 'kod' | 'emRent' | 'niepelnosprawnosc'>): Wezel =>
  gr(nazwa, [el('p1', t.kod), el('p2', t.emRent || '0'), el('p3', t.niepelnosprawnosc || '0')]);

/** Block III of ZUA / ZZA / ZWUA / ZCNA: the insured, by PESEL or by an identity document. */
const blokUbezpieczonego = (o: ZusUbezpieczony): Wezel =>
  gr('III', [
    ...opt('p1', o.pesel),
    ...opt('p2', o.nip),
    ...(o.pesel ? [] : [...opt('p3', o.rodzajDok), ...opt('p4', o.seriaNrDok)]),
    el('p5', duze(o.nazwisko)),
    el('p6', duze(o.imie)),
    ...opt('p7', o.dataUrodzenia),
  ]);

/** Address blocks with the p1–p7 layout (ZUA XI/XII, ZZA VIII/IX, ZCNA IV.B). */
const adres = (nazwa: string, a: ZusAdres): Wezel[] =>
  blok(nazwa, [
    ...opt('p1', a.kodPocztowy),
    ...opt('p2', duze(a.miejscowosc)),
    ...opt('p3', duze(a.gmina)),
    ...opt('p4', duze(a.ulica)),
    ...opt('p5', duze(a.nrDomu)),
    ...opt('p6', duze(a.nrLokalu)),
    ...opt('p7', a.telefon),
  ]);

/* ================================ Monthly set ================================= */

export interface RozliczenieKedu {
  platnik: PlatnikKedu;
  okres: string;
  identyfikator: number;
  dane: ZusRozliczenieDane;
  wynik: ZusWynik;
  /** A correction: the RCA carries only these positions (kluczPozycji); undefined = everyone. */
  tylkoPozycje?: Set<string>;
  /** DRA XIII / RCA IV / RSA XI. */
  dataWypelnienia: string;
}

/** The identity part (A) of an RCA / RSA block. */
const blokA = (o: ZusUbezpieczony): Wezel =>
  gr('A', [
    el('p1', duze(o.nazwisko)),
    el('p2', duze(o.imie)),
    el('p3', o.pesel ? 'P' : o.rodzajDok || '1'),
    el('p4', o.pesel || o.seriaNrDok),
  ]);

/** DRA, RCA (one block per position — or the corrected ones) and RSA when the month has its lines. */
export function dokumentyRozliczenia(r: RozliczenieKedu): DokumentKedu[] {
  const { wynik, platnik } = r;
  const id = gr('p1', [el('p1', nn(r.identyfikator)), el('p2', r.okres)]);
  const d = wynik.dra;
  const iv = Array.from({ length: 37 }, (_, i) => el(`p${i + 1}`, k(d.iv[i + 1])));
  const dra: DokumentKedu = {
    nazwa: 'ZUSDRA',
    bloki: [
      gr('I', [el('p1', platnik.dane.terminDra || '6'), gr('p2', [el('p1', nn(r.identyfikator)), el('p2', r.okres)])]),
      blokPlatnika(platnik),
      gr('III', [el('p1', String(d.liczbaUbezpieczonych)), el('p3', (platnik.dane.stopaWypadkowa ?? 0).toFixed(2))]),
      gr('IV', iv),
      gr('V', [el('p1', k(0)), el('p2', k(0)), el('p3', k(0)), el('p4', k(0)), el('p5', k(0))]),
      gr('VI', Array.from({ length: 7 }, (_, i) => el(`p${i + 1}`, k(d.vi[i + 1])))),
      gr('VII', [el('p1', k(d.fp)), el('p2', k(d.fgsp)), el('p3', k(d.fp + d.fgsp))]),
      gr('VIII', [el('p1', '0'), el('p2', '0')]),
      gr('IX', [el('p1', k(0)), el('p2', k(d.doZaplaty))]),
      gr('XIII', [el('p1', r.dataWypelnienia)]),
    ],
  };

  const pozycje = wynik.pozycje.filter((w) => !r.tylkoPozycje || r.tylkoPozycje.has(kluczPozycji(w.pozycja)));
  const out: DokumentKedu[] = [dra];
  if (pozycje.length > 0) {
    out.push({
      nazwa: 'ZUSRCA',
      bloki: [
        gr('I', [id]),
        blokPlatnika(platnik),
        ...pozycje.map((w, i) => {
          const s = w.skladki;
          const b: Wezel[] = [kodTytulu('p1', w.tytul)];
          if (tytulPracowniczy(w.tytul.kod) && w.tytul.wymiarLicznik && w.tytul.wymiarMianownik) {
            b.push(gr('p3', [el('p1', String(w.tytul.wymiarLicznik).padStart(3, '0')), el('p2', String(w.tytul.wymiarMianownik).padStart(3, '0'))]));
          }
          const wartosci: [number, number][] = [
            [4, s.podstawaER],
            [5, s.podstawaCh],
            [6, s.podstawaWyp],
            [7, s.emU],
            [8, s.renU],
            [9, s.chU],
            [10, s.wypU],
            [11, s.emP],
            [12, s.renP],
            [13, s.chP],
            [14, s.wypP],
          ];
          for (const [p, v] of wartosci) b.push(el(`p${p}`, k(v)));
          for (let p = 15; p <= 26; p++) b.push(el(`p${p}`, k(0)));
          b.push(el('p29', k(s.razem)));
          return gr(
            'III',
            [
              blokA(w.osoba),
              gr('B', b),
              gr('C', [el('p1', k(s.podstawaZdr)), el('p2', k(0)), el('p3', k(0)), el('p4', k(s.zdrowotna)), el('p5', k(0))]),
              gr('D', [el('p4', k(0))]),
            ],
            [['id_bloku', String(i + 1)]],
          );
        }),
        gr('IV', [el('p1', r.dataWypelnienia)]),
      ],
    });
  }

  const osoby = new Map(wynik.pozycje.map((w) => [w.osoba.klucz, w.osoba]));
  const tytuly = new Map(wynik.pozycje.map((w) => [kluczPozycji(w.pozycja), w.tytul]));
  const rsa = r.dane.rsa.filter((s) => osoby.has(s.kluczOsoby) && tytuly.has(kluczPozycji(s)) && (!r.tylkoPozycje || r.tylkoPozycje.has(kluczPozycji(s))));
  if (rsa.length > 0) {
    out.push({
      nazwa: 'ZUSRSA',
      bloki: [
        gr('I', [id]),
        blokPlatnika(platnik),
        ...rsa.map((s, i) =>
          gr(
            'III',
            [
              blokA(osoby.get(s.kluczOsoby)!),
              gr('B', [
                kodTytulu('p1', tytuly.get(kluczPozycji(s))!),
                el('p2', s.kod),
                ...opt('p3', s.od),
                ...opt('p4', s.do),
                ...(s.dni !== null ? [el('p5', String(s.dni))] : s.od && s.do ? [el('p5', String(dniOkresu(s.od, s.do)))] : []),
                ...(s.kwota !== null ? [el('p6', k(s.kwota))] : []),
              ]),
            ],
            [['id_bloku', String(i + 1)]],
          ),
        ),
        gr('XI', [el('p1', r.dataWypelnienia)]),
      ],
    });
  }
  return out;
}

/* ================================ Registrations =============================== */

/** ZUS ZUA (social and health insurance) or ZUS ZZA (health only) of one title. */
export function dokumentZgloszenia(platnik: PlatnikKedu, o: ZusUbezpieczony, t: ZusTytul, dataWypelnienia: string): DokumentKedu {
  const tozsamosc = gr('IV', [...opt('p1', duze(o.imieDrugie)), ...opt('p2', duze(o.nazwiskoRodowe)), el('p3', duze(o.obywatelstwo)), el('p4', o.plec)]);
  if (t.schemat === 'zdrowotne') {
    return {
      nazwa: 'ZUSZZA',
      bloki: [
        gr('I', [el('p1', 'true')]),
        blokPlatnika(platnik),
        blokUbezpieczonego(o),
        tozsamosc,
        gr('V', [kodTytulu('p1', t), ...opt('p2', o.kodZawodu)]),
        gr('VI', [el('p1', t.od ?? ''), el('p2', o.kodNfz)]),
        ...adres('VIII', o.adres),
        ...(o.adresZamieszkania ? adres('IX', o.adresZamieszkania) : []),
        gr('XI', [el('p1', dataWypelnienia)]),
      ],
    };
  }
  const od = t.od ?? '';
  return {
    nazwa: 'ZUSZUA',
    bloki: [
      gr('I', [el('p1', 'true')]),
      blokPlatnika(platnik),
      blokUbezpieczonego(o),
      tozsamosc,
      gr('V', [kodTytulu('p1', t)]),
      gr('VI', [
        el('p1', od),
        ...(t.emerytalne ? [el('p2', 'true')] : []),
        ...(t.rentowe ? [el('p3', 'true')] : []),
        ...(t.chorobowe === 'obowiazkowe' ? [el('p4', 'true')] : []),
        ...(t.wypadkowe ? [el('p5', 'true')] : []),
      ]),
      gr('VII', [el('p1', od), el('p2', o.kodNfz)]),
      ...(t.chorobowe === 'dobrowolne' ? [gr('VIII', [el('p5', 'true'), el('p6', od)])] : []),
      gr('X', [el('p1', o.kodZawodu)]),
      ...adres('XI', o.adres),
      ...(o.adresZamieszkania ? adres('XII', o.adresZamieszkania) : []),
      gr('XIV', [el('p1', dataWypelnienia)]),
    ],
  };
}

/** ZUS ZWUA of one title — with block V when an employment ends. */
export function dokumentWyrejestrowania(platnik: PlatnikKedu, o: ZusUbezpieczony, t: ZusTytul, dataWypelnienia: string): DokumentKedu {
  const koniec =
    tytulPracowniczy(t.kod) && (t.kodWygasniecia || t.kodPodstawyPrawnej)
      ? [
          gr('V', [
            el('p1', t.dataRozwiazania ?? t.do ?? ''),
            ...opt('p2', t.kodWygasniecia),
            ...opt('p3', t.kodPodstawyPrawnej),
            ...opt('p4', t.podstawaPrawna),
            ...opt('p5', t.stronaInicjujaca),
          ]),
        ]
      : [];
  return {
    nazwa: 'ZUSZWUA',
    bloki: [
      gr('I', [t.korektaWyrejestrowania ? el('p2', 'true') : el('p1', 'true')]),
      blokPlatnika(platnik),
      blokUbezpieczonego(o),
      gr('IV', [kodTytulu('p1', t), el('p2', dataWyrejestrowania(t) ?? ''), el('p3', t.przyczyna)]),
      ...koniec,
      gr('VI', [el('p1', dataWypelnienia)]),
    ],
  };
}

/** ZUS ZCNA — one family member registered (z) or deregistered (w). */
export function dokumentCzlonka(platnik: PlatnikKedu, o: ZusUbezpieczony, c: ZusCzlonek, zdarzenie: 'z' | 'w', dataWypelnienia: string): DokumentKedu {
  const a: Wezel[] = [
    el('p1', zdarzenie === 'z' ? '1' : '2'),
    el('p2', (zdarzenie === 'z' ? c.od : c.do) ?? ''),
    ...opt('p3', c.pesel),
    ...(c.pesel ? [] : [...opt('p5', c.rodzajDok), ...opt('p6', c.seriaNrDok)]),
    el('p7', duze(c.nazwisko)),
    el('p8', duze(c.imie)),
    ...opt('p9', c.dataUrodzenia),
    el('p10', c.pokrewienstwo),
    ...(zdarzenie === 'z' ? [el('p11', c.wspolneGospodarstwo ? 'true' : 'false'), ...opt('p12', c.niepelnosprawnosc)] : []),
  ];
  return {
    nazwa: 'ZUSZCNA',
    bloki: [blokPlatnika(platnik), blokUbezpieczonego(o), gr('IV', [gr('A', a), ...adres('B', c.adres ?? o.adres)], [['id_bloku', '1']]), gr('VI', [el('p1', dataWypelnienia)])],
  };
}

/* ==================================== File ==================================== */

/** The whole KEDU file: the header, the documents numbered 1, 2, 3… in the order given. */
export function plikKedu(dokumenty: DokumentKedu[], program: ProgramKedu, dataUtworzenia: string): string {
  const korzen = gr('KEDU', [
    gr('naglowek.KEDU', [
      gr('program', [el('producent', program.producent.slice(0, 64)), el('symbol', program.symbol.slice(0, 64)), el('wersja', program.wersja.slice(0, 32))]),
      el('data_utworzenia_KEDU', dataUtworzenia),
    ]),
    ...dokumenty.map((d, i) => gr(d.nazwa, d.bloki, [['id_dokumentu', String(i + 1)]])),
  ]);
  return zlozXml(
    korzen,
    ` wersja_schematu="1" xmlns="${KEDU_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${KEDU_NS} kedu_5_7.xsd"`,
  );
}
