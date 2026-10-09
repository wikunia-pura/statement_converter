/**
 * A community's PIT-11 (one person) and PIT-4R (the community's yearly return),
 * filled in: the official blank (pitWzory.ts) with the values drawn onto it where
 * the layout map (pitLayout.ts) says — the same technique as the DN-1 (dn1Pdf.ts),
 * on the same drawing class (formularz.ts).
 *
 * A correction (cel 2) gets one more, final page: the justification of the
 * correction (ORD-ZU, poz. 13). There is no flat official ORD-ZU to draw on, so it
 * is a plain page of our own, in the same font, that says what it is.
 *
 * Bytes in, bytes out: no Electron here, so the files can be made (and looked at)
 * without the app. Values are printed in capitals, as the forms ask ("WYPEŁNIAĆ
 * DUŻYMI, DRUKOWANYMI LITERAMI"). A value that does not fit its box even at the
 * smallest size is an error naming the field — never clipped. A figure that the
 * shared checks (`problemyOsoby` / `problemyPit4R`) call blocking is not printed
 * at all.
 */

import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  PIT_RODZAJE_NR_ID,
  PitDane,
  PitOsoba,
  PitPit4R,
  PitProblem,
  maBlad,
  nazwaOsoby,
  nipPoprawny,
  obliczOsobe,
  obliczPit4R,
  problemyOsoby,
  problemyPit4R,
} from '../../shared/podatki-pit';
import { nazwaUrzedu } from '../../shared/pit-urzedy';
import { doGroszy } from '../../shared/podatki';
import { PIT11_PDF_BASE64, PIT4R_PDF_BASE64 } from './pitWzory';
import { ARIMO_TTF_BASE64 } from './dn1Font';
import { Komorka, PIT11, PIT4R, ZNAK_KRATKI_PIT11, ZNAK_KRATKI_PIT4R, pit4rKomorka } from './pitLayout';
import { ROZMIAR, Strona, dataNaKratki, duze } from './formularz';

export interface Pit11Wejscie {
  rok: number;
  platnik: { nip: string; nazwa: string };
  osoba: PitOsoba;
}

export interface Pit4rWejscie {
  rok: number;
  platnik: { nip: string; nazwa: string };
  /** KodUrzedu of the PIT-4R — the community's own office. */
  urzadPlatnika: string;
  pit4r: PitPit4R;
}

/** The smallest size an amount is shrunk to before it is an error. */
const ROZMIAR_KWOTY_MIN = 6;
/** The grosze digits start at this size and shrink to the room the printed words leave them. */
const ROZMIAR_GROSZE = 9;

/* ------------------------------ shared helpers ------------------------------ */

const cyfry = (s: string): string => s.replace(/\D/g, '');

/** The office as the e-Formularz prints it: its code and name ("1433 URZĄD SKARBOWY WARSZAWA-MOKOTÓW"). */
const urzadDoDruku = (kod: string): string => `${kod} ${nazwaUrzedu(kod)}`.trim();

function sprawdzPlatnika(p: { nip: string; nazwa: string }): string {
  const nip = cyfry(p.nip);
  if (!nipPoprawny(nip)) {
    throw new Error(`NIP płatnika „${p.nip}” jest nieprawidłowy — formularza nie da się wydrukować.`);
  }
  if (!p.nazwa.trim()) throw new Error('Brak nazwy płatnika — formularza nie da się wydrukować.');
  return nip;
}

function odmowa(co: string, problemy: PitProblem[]): never {
  const bledy = problemy.filter((p) => p.poziom === 'blad').map((p) => p.tekst.replace(/[.\s]+$/, ''));
  throw new Error(`${co} nie da się jeszcze wydrukować: ${bledy.join('; ')}.`);
}

/** Whole złoty and grosze as digits, no separators; negative amounts have no place in these forms. */
function zlGrCyfry(value: number, nazwa: string): { zl: string; gr: string } {
  const v = doGroszy(value);
  if (!(v >= 0)) throw new Error(`Pole „${nazwa}” ma wartość ujemną — formularz tego nie przewiduje.`);
  const grosze = Math.round(v * 100);
  return { zl: String(Math.floor(grosze / 100)), gr: String(grosze % 100).padStart(2, '0') };
}

/**
 * An amount in its cell: the złoty digits right-aligned at the cell's right edge, the grosze
 * (when the cell has them) after the printed comma. Both shrink to fit their room.
 */
function kwotaK(s: Strona, k: Komorka, value: number, nazwa: string) {
  const { zl, gr } = zlGrCyfry(value, nazwa);
  s.wPrawo(zl, k.zl, k.y, s.rozmiar(zl, k.zl - k.od, nazwa, ROZMIAR, ROZMIAR_KWOTY_MIN));
  if (k.gr === null) {
    if (gr !== '00') throw new Error(`Pole „${nazwa}” musi być w pełnych złotych.`);
    return;
  }
  s.wPrawo(gr, k.gr, k.y, s.rozmiar(gr, k.gr - k.grOd, `${nazwa} (grosze)`, ROZMIAR_GROSZE, ROZMIAR_KWOTY_MIN));
}

/** A whole number (taxpayers, whole-złoty advances) in a cell that has no grosze. */
function calkowitaK(s: Strona, k: Komorka, value: number, nazwa: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Pole „${nazwa}” musi być nieujemną liczbą całkowitą.`);
  }
  const text = String(value);
  s.wPrawo(text, k.zl, k.y, s.rozmiar(text, k.zl - k.od, nazwa, ROZMIAR, ROZMIAR_KWOTY_MIN));
}

async function nowyDokument(): Promise<{ out: PDFDocument; font: PDFFont }> {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  // Not subset: pdf-lib's subsetting mis-maps glyphs of some fonts, and this one is 22 kB whole.
  const font = await out.embedFont(Buffer.from(ARIMO_TTF_BASE64, 'base64'), { subset: false });
  return { out, font };
}

async function stronyWzoru(
  out: PDFDocument,
  font: PDFFont,
  base64: string,
  znakKratki: number
): Promise<Strona[]> {
  const wzor = await PDFDocument.load(Buffer.from(base64, 'base64'));
  return (await out.copyPages(wzor, wzor.getPageIndices())).map(
    (p) => new Strona(out.addPage(p), font, znakKratki)
  );
}

/* ------------------------- the justification page (ORD-ZU) ------------------------- */

const MARGINES = 56;

/** Greedy word wrap by measured width; a word wider than the line is broken by characters. */
function zawin(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const akapit of text.replace(/[ \t\u00a0]+/g, ' ').split(/\r?\n/)) {
    let line = '';
    const push = () => {
      lines.push(line);
      line = '';
    };
    if (akapit.trim() === '') {
      lines.push('');
      continue;
    }
    for (const word of akapit.trim().split(' ')) {
      let rest = word;
      // A word that alone is wider than a line: cut it where the line is full.
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        if (line) push();
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      const probe = line ? `${line} ${rest}` : rest;
      if (font.widthOfTextAtSize(probe, size) <= width) line = probe;
      else {
        if (line) push();
        line = rest;
      }
    }
    if (line) push();
  }
  return lines;
}

/**
 * The final page of a correction: "UZASADNIENIE PRZYCZYN KOREKTY (ORD-ZU)" — what it belongs to
 * (form, year, payer with NIP, the taxpayer of a PIT-11) and the reason, wrapped. A plain page, in
 * black, with a line saying it is not the official form.
 */
function stronaUzasadnienia(
  out: PDFDocument,
  font: PDFFont,
  we: { dotyczy: string; rok: number; platnik: { nip: string; nazwa: string }; podatnik?: string; przyczyna: string }
) {
  const przyczyna = we.przyczyna.trim();
  if (!przyczyna) throw new Error('Korekta wymaga uzasadnienia przyczyn (ORD-ZU) — brak tekstu.');
  const page: PDFPage = out.addPage([595.44, 841.68]);
  const czarny = rgb(0, 0, 0);
  const szary = rgb(0.35, 0.35, 0.35);
  const width = page.getWidth() - 2 * MARGINES;
  const dol = MARGINES;
  let y = page.getHeight() - MARGINES;

  const linia = (text: string, size: number, kolor = czarny) => {
    if (y - size < dol) {
      throw new Error('Uzasadnienie korekty jest za długie, żeby zmieścić się na jednej stronie — skróć je.');
    }
    if (text) page.drawText(text, { x: MARGINES, y: y - size, size, font, color: kolor });
    y -= size * 1.45;
  };

  linia('UZASADNIENIE PRZYCZYN KOREKTY (ORD-ZU)', 15);
  page.drawLine({
    start: { x: MARGINES, y: y + 2 },
    end: { x: MARGINES + width, y: y + 2 },
    thickness: 0.8,
    color: czarny,
  });
  y -= 10;
  const fakty: [string, string][] = [
    ['Dotyczy:', `${we.dotyczy} za rok ${we.rok}`],
    ['Płatnik:', duze(we.platnik.nazwa)],
    ['NIP płatnika:', cyfry(we.platnik.nip)],
    ...(we.podatnik ? ([['Podatnik:', duze(we.podatnik)]] as [string, string][]) : []),
  ];
  const kolumna = MARGINES + 90;
  for (const [etykieta, wartosc] of fakty) {
    if (y - 11 < dol) throw new Error('Uzasadnienie korekty jest za długie, żeby zmieścić się na jednej stronie.');
    page.drawText(etykieta, { x: MARGINES, y: y - 11, size: 11, font, color: szary });
    const zawiniete = zawin(font, wartosc, 11, width - 90);
    zawiniete.forEach((l) => {
      page.drawText(l, { x: kolumna, y: y - 11, size: 11, font, color: czarny });
      y -= 11 * 1.45;
    });
  }
  y -= 12;
  linia('Przyczyny korekty:', 11, szary);
  y -= 2;
  for (const l of zawin(font, przyczyna, 11, width)) linia(l, 11);

  const nota =
    'Strona dołączona do korekty: ORD-ZU nie ma płaskiego wzoru do wypełnienia w tym pliku, więc uzasadnienie (poz. 13 ORD-ZU) podano na zwykłej stronie.';
  const linieNoty = zawin(font, nota, 8, width);
  let yn = MARGINES + linieNoty.length * 8 * 1.4;
  for (const l of linieNoty) {
    page.drawText(l, { x: MARGINES, y: yn - 8, size: 8, font, color: szary });
    yn -= 8 * 1.4;
  }
}

/* ===================================== PIT-11 ===================================== */

export async function pit11Pdf(we: Pit11Wejscie): Promise<Uint8Array> {
  const { rok, osoba: o } = we;
  const problemy = problemyOsoby(o, rok);
  if (maBlad(problemy)) odmowa('Informacji PIT-11', problemy);
  const nip = sprawdzPlatnika(we.platnik);
  const k = obliczOsobe(o);

  const { out, font } = await nowyDokument();
  const [s1, s2, s3] = await stronyWzoru(out, font, PIT11_PDF_BASE64, ZNAK_KRATKI_PIT11);

  /* ---------------- page 1 — A, B, C, D ---------------- */
  const p1 = PIT11.str1;
  s1.kratki(p1.nip, [nip], 'NIP składającego');
  s1.skresl(p1.skreslPesel);
  s1.kratki(p1.rok, [String(rok)], 'Rok');
  s1.pole(p1.urzad, urzadDoDruku(o.urzad), 'Urząd skarbowy');
  s1.zaznacz(p1.cel[o.cel]);
  s1.zaznacz(p1.podmiot[1]);
  s1.pole(p1.nazwaPelna, we.platnik.nazwa, 'Nazwa pełna składającego');

  s1.zaznacz(p1.obowiazek[1]);
  if (o.pesel) {
    s1.kratki(p1.id, [o.pesel], 'PESEL');
    s1.skresl(p1.skreslNip);
  } else if (o.nip) {
    s1.kratki(p1.id, [o.nip], 'NIP podatnika');
    s1.skresl(p1.skreslNumerPesel);
  }
  if (o.nrId) {
    s1.pole(p1.nrId, o.nrId, 'Zagraniczny numer identyfikacyjny');
    const rodzaj = PIT_RODZAJE_NR_ID.find((r) => r.id === o.rodzajNrId);
    if (rodzaj) s1.pole(p1.rodzajNrId, `${rodzaj.id} - ${rodzaj.opis}`, 'Rodzaj numeru identyfikacyjnego');
    s1.pole(p1.krajWydania, o.krajWydania, 'Kraj wydania numeru identyfikacyjnego');
  }
  s1.pole(p1.nazwisko, o.nazwisko, 'Nazwisko');
  s1.pole(p1.imie, o.imie, 'Pierwsze imię');
  s1.kratki(p1.dataUrodzenia, dataNaKratki(o.dataUrodzenia), 'Data urodzenia');
  s1.pole(p1.kraj, 'POLSKA', 'Kraj');
  s1.pole(p1.wojewodztwo, o.adres.wojewodztwo, 'Województwo');
  s1.pole(p1.powiat, o.adres.powiat, 'Powiat');
  s1.pole(p1.ulica, o.adres.ulica, 'Ulica');
  s1.pole(p1.nrDomu, o.adres.nrDomu, 'Nr domu');
  s1.pole(p1.nrLokalu, o.adres.nrLokalu, 'Nr lokalu');
  s1.pole(p1.miejscowosc, o.adres.miejscowosc, 'Miejscowość');
  s1.pole(p1.kodPocztowy, o.adres.kodPocztowy, 'Kod pocztowy');

  // D.28 — the costs of employment: 1 = one employment, 3 = one with the increased costs.
  if (k.etat) s1.zaznacz(p1.koszty[o.kosztyPodwyzszone ? 3 : 1]);

  /* ---------------- page 2 — E ---------------- */
  const E = PIT11.E;
  if (k.etat) {
    kwotaK(s2, E[29], k.etat.przychod, 'Przychód ze stosunku pracy (poz. 29)');
    kwotaK(s2, E[30], k.etat.koszty, 'Koszty ze stosunku pracy (poz. 30)');
    kwotaK(s2, E[31], k.etat.dochod, 'Dochód ze stosunku pracy (poz. 31)');
    kwotaK(s2, E[33], k.etat.zaliczka, 'Zaliczka ze stosunku pracy (poz. 33)');
  }
  if (k.art13) {
    kwotaK(s2, E[54], k.art13.przychod, 'Przychód z art. 13 (poz. 54)');
    kwotaK(s2, E[55], k.art13.koszty, 'Koszty z art. 13 (poz. 55)');
    kwotaK(s2, E[56], k.art13.dochod, 'Dochód z art. 13 (poz. 56)');
    kwotaK(s2, E[57], k.art13.zaliczka, 'Zaliczka z art. 13 (poz. 57)');
  }
  if (k.zlecenie) {
    kwotaK(s2, E[58], k.zlecenie.przychod, 'Przychód ze zlecenia (poz. 58)');
    kwotaK(s2, E[59], k.zlecenie.koszty, 'Koszty ze zlecenia (poz. 59)');
    kwotaK(s2, E[60], k.zlecenie.dochod, 'Dochód ze zlecenia (poz. 60)');
    kwotaK(s2, E[61], k.zlecenie.zaliczka, 'Zaliczka ze zlecenia (poz. 61)');
  }
  // A board member alone: part E has nothing to say, and the office's filed forms carry zeros in "inne źródła".
  if (k.zarzad !== null && !k.etat && !k.art13 && !k.zlecenie) {
    kwotaK(s2, E[90], 0, 'Inne źródła — przychód (poz. 90)');
    kwotaK(s2, E[92], 0, 'Inne źródła — dochód (poz. 92)');
    kwotaK(s2, E[94], 0, 'Inne źródła — zaliczka (poz. 94)');
  }
  if (k.skladki !== null) kwotaK(s2, PIT11.FG[95], k.skladki, 'Składki na ubezpieczenia społeczne (poz. 95)');

  /* ---------------- page 3 — F, G ---------------- */
  if (k.zarzad !== null && o.zarzad) {
    s3.pole(PIT11.str3.rodzajPrzychodu, o.zarzad.opis, 'Rodzaj przychodu (poz. 99)');
    kwotaK(s3, PIT11.FG[100], k.zarzad, 'Przychód — zarząd (poz. 100)');
    kwotaK(s3, PIT11.FG[105], k.zarzad, 'Razem przychody z art. 20 ust. 1 (poz. 105)');
  }
  s3.zaznacz(PIT11.str3.pitR[2]);
  if (k.zdrowotna !== null) kwotaK(s3, PIT11.FG[122], k.zdrowotna, 'Składki na ubezpieczenie zdrowotne (poz. 122)');

  if (o.cel === 2) {
    stronaUzasadnienia(out, font, {
      dotyczy: 'PIT-11 (29)',
      rok,
      platnik: { nip, nazwa: we.platnik.nazwa },
      podatnik: nazwaOsoby(o),
      przyczyna: o.przyczyna,
    });
  }

  out.setTitle(`PIT-11 ${rok} — ${we.platnik.nazwa}`);
  out.setSubject('Informacja o przychodach z innych źródeł oraz o dochodach i pobranych zaliczkach na podatek dochodowy');
  out.setCreator('FileFunky');
  out.setProducer('FileFunky');
  out.setLanguage('pl-PL');
  return out.save();
}

/* ===================================== PIT-4R ===================================== */

/** Position of month `m` (0 = January) in a row whose months I–VI start at `pierwszaI` and VII–XII at `pierwszaVII`. */
const poz = (m: number, pierwszaI: number, pierwszaVII: number): number =>
  m < 6 ? pierwszaI + m : pierwszaVII + (m - 6);

const MIESIACE = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export async function pit4rPdf(we: Pit4rWejscie): Promise<Uint8Array> {
  const { rok, pit4r: p } = we;
  const dane: PitDane = { nazwa: we.platnik.nazwa, urzadPlatnika: we.urzadPlatnika, osoby: [], pit4r: p };
  // The cross-check against the PIT-11s is the caller's (it only warns); the blocking checks are all here.
  const problemy = problemyPit4R(dane, rok);
  if (maBlad(problemy)) odmowa('Deklaracji PIT-4R', problemy);
  const nip = sprawdzPlatnika(we.platnik);
  const k = obliczPit4R(p);

  const { out, font } = await nowyDokument();
  const [s1, s2, s3] = await stronyWzoru(out, font, PIT4R_PDF_BASE64, ZNAK_KRATKI_PIT4R);
  /** The cell of a position, on whichever of the three pages it is. */
  const komorka = (n: number): { s: Strona; k: Komorka } => ({
    s: n <= 57 ? s1 : n <= 157 ? s2 : s3,
    k: pit4rKomorka(n),
  });

  /* ---------------- page 1 — A, B ---------------- */
  const p1 = PIT4R.str1;
  s1.kratki(p1.nip, [nip], 'NIP płatnika');
  s1.kratki(p1.rok, [String(rok)], 'Rok');
  s1.pole(p1.urzad, urzadDoDruku(we.urzadPlatnika), 'Urząd skarbowy');
  s1.zaznacz(p1.cel[p.cel]);
  if (p.cel === 2) s1.zaznacz(p1.rodzajKorekty[p.rodzajKorekty]);
  s1.zaznacz(p1.podmiot[1]);
  s1.pole(p1.nazwaPelna, we.platnik.nazwa, 'Nazwa pełna płatnika');

  /* ---------------- C — month by month ---------------- */
  for (let m = 0; m < 12; m++) {
    const mies = `miesiąc ${MIESIACE[m]}`;
    // Rows 1, 3, 4: only the months with something entered (as the e-Formularz files have them).
    const liczba = p.etatLiczba[m];
    if (liczba !== null) {
      const n = poz(m, 10, 22);
      const c = komorka(n);
      calkowitaK(c.s, c.k, liczba, `Wiersz 1: liczba podatników, ${mies} (poz. ${n})`);
    }
    const etat = p.etatKwota[m];
    if (etat !== null) {
      const n = poz(m, 16, 28);
      const c = komorka(n);
      kwotaK(c.s, c.k, etat, `Wiersz 1: zaliczki, ${mies} (poz. ${n})`);
    }
    const art41 = p.art41[m];
    if (art41 !== null) {
      const n = 46 + m;
      const c = komorka(n);
      kwotaK(c.s, c.k, art41, `Wiersz 3: zaliczki art. 41, ${mies} (poz. ${n})`);
    }
    const inne = p.inne[m];
    if (inne !== null) {
      const n = 58 + m;
      const c = komorka(n);
      kwotaK(c.s, c.k, inne, `Wiersz 4: inne zaliczki, ${mies} (poz. ${n})`);
    }
    // Rows 5, 10, 12 are sums and are printed for all twelve months, zeros included.
    for (const [start, wartosc, nazwa] of [
      [70, k.suma[m], 'Wiersz 5: suma zaliczek'],
      [122, k.doPrzekazania[m], 'Wiersz 10: pobrany podatek do przekazania'],
      [146, k.doPrzekazania[m], 'Wiersz 12: podatek podlegający przekazaniu'],
    ] as [number, number, string][]) {
      const n = start + m;
      const c = komorka(n);
      kwotaK(c.s, c.k, wartosc, `${nazwa}, ${mies} (poz. ${n})`);
    }
  }

  /* ---------------- D — the reduction of the advances (art. 26eb) ---------------- */
  const maPomniejszenie = p.pomniejszenie.some((v) => v !== null);
  s2.zaznacz(PIT4R.str2.pomniejszenie[maPomniejszenie ? 1 : 2]);
  if (maPomniejszenie) {
    p.pomniejszenie.forEach((v, m) => {
      if (v === null) return;
      const n = 159 + m;
      const c = komorka(n);
      kwotaK(c.s, c.k, v, `Pomniejszenie zaliczek, ${MIESIACE[m]} (poz. ${n})`);
    });
  }

  /* ---------------- E — the tax to pay in ---------------- */
  k.doWplaty.forEach((v, m) => {
    const n = 171 + m;
    const c = komorka(n);
    kwotaK(c.s, c.k, v, `Podatek do wpłaty, ${MIESIACE[m]} (poz. ${n})`);
  });

  if (p.cel === 2) {
    stronaUzasadnienia(out, font, {
      dotyczy: 'PIT-4R (13)',
      rok,
      platnik: { nip, nazwa: we.platnik.nazwa },
      przyczyna: p.przyczyna,
    });
  }

  out.setTitle(`PIT-4R ${rok} — ${we.platnik.nazwa}`);
  out.setSubject('Deklaracja roczna o zaliczkach na podatek dochodowy');
  out.setCreator('FileFunky');
  out.setProducer('FileFunky');
  out.setLanguage('pl-PL');
  return out.save();
}
