/**
 * A community's CIT-8 return, filled in: the official blank (cit8Wzory.ts)
 * with the values drawn onto it where the layout map (cit8Layout.ts) says, and
 * — when the community has income exempt under art. 17 ust. 1 pkt 44 — the
 * CIT-8/O attachment that carries that income. One file, so one signature later
 * covers the whole return.
 *
 * Same shape as dn1Pdf.ts, on the same drawing class (formularz.ts): bytes in,
 * bytes out, no Electron; values in capitals; a value that does not fit its box
 * even at the smallest size is an error naming the field — never clipped.
 * Everything the community does not own stays blank, as the form wants.
 */

import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { CitSlownikRegula, PodatekAdres, PodatekCitDane } from '../../shared/types';
import {
  obliczCIT8,
  opisProblemuCit,
  pozycjeZeSprawozdania,
  problemyCIT8,
} from '../../shared/podatki-cit';
import { CIT8_PDF_BASE64, CIT8O_PDF_BASE64 } from './cit8Wzory';
import { ARIMO_TTF_BASE64 } from './dn1Font';
import { CIT8, CIT8O, ZNAK_KRATKI_CIT8 } from './cit8Layout';
import { Pole, Strona, dataNaKratki } from './formularz';

export interface Cit8Wejscie {
  rok: number;
  dane: PodatekCitDane;
  slownik: CitSlownikRegula[];
}

function adres(s: Strona, map: Record<keyof PodatekAdres, Pole>, a: PodatekAdres, sekcja: string) {
  (Object.keys(map) as (keyof PodatekAdres)[]).forEach((key) =>
    s.pole(map[key], a[key], `${sekcja}: ${key}`)
  );
}

/** The first and last day of the tax year as dd-mm-rrrr grid parts. */
const odDo = (rok: number): { od: string[]; do: string[] } => ({
  od: ['01', '01', String(rok)],
  do: ['31', '12', String(rok)],
});

export async function cit8Pdf(we: Cit8Wejscie): Promise<Uint8Array> {
  const { rok, dane: d, slownik } = we;
  const nip = d.nip;
  const problemy = problemyCIT8({ rok, dane: d }, slownik);
  if (problemy.length > 0) {
    throw new Error(
      `Zeznania nie da się jeszcze wydrukować: ${problemy.map((p) => opisProblemuCit(p, rok)).join('; ')}.`
    );
  }
  const wynik = obliczCIT8(d, pozycjeZeSprawozdania(d, slownik));
  const poz = (n: number): number => wynik.poz[n] ?? 0;
  const okres = odDo(rok);

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  // Not subset: pdf-lib's subsetting mis-maps glyphs of some fonts, and this one
  // is 22 kB whole.
  const font = await out.embedFont(Buffer.from(ARIMO_TTF_BASE64, 'base64'), { subset: false });
  const cit8 = await PDFDocument.load(Buffer.from(CIT8_PDF_BASE64, 'base64'));
  const strony = (await out.copyPages(cit8, cit8.getPageIndices())).map(
    (p) => new Strona(out.addPage(p), font, ZNAK_KRATKI_CIT8)
  );
  const [s1, s2, s3, s4, s5, s6, s7, s8] = strony;

  /* ---------------- page 1 — A, B ---------------- */
  const p1 = CIT8.str1;
  s1.kratki(p1.nip, [nip], 'NIP');
  s1.kratki(p1.od, okres.od, 'Okres od');
  s1.kratki(p1.do, okres.do, 'Okres do');
  s1.poleWiersze(p1.urzad, d.urzad, 'Urząd skarbowy');
  s1.zaznacz(p1.cel[d.cel]);
  if (d.cel === 2 && d.rodzajKorekty !== null) s1.zaznacz(p1.rodzajKorekty[d.rodzajKorekty]);
  s1.poleWiersze(p1.nazwaPelna, d.nazwaPelna, 'Nazwa pełna');
  adres(s1, p1.siedziba, d.siedziba, 'Adres siedziby');
  s1.zaznacz(p1.zwolnienie3Nie);
  if (d.zaliczkiKwartalne) s1.zaznacz(p1.zaliczkiKwartalne);

  /* ---------------- page 2 — B.3, C, D.1, D.2 ---------------- */
  s2.zaznacz(CIT8.str2.majatekZaGranica2Nie);
  if (wynik.cit8o) s2.kratki(CIT8.str2.zalacznikiCit8o, ['01'], 'Liczba załączników CIT-8/O');
  for (const [n, k] of Object.entries(CIT8.str2.kwoty)) s2.kwota(k, poz(Number(n)));

  /* ---------------- page 3 — D.3, D.4, E.1, E.2 ---------------- */
  for (const [n, k] of Object.entries(CIT8.str3.kwoty)) s3.kwota(k, poz(Number(n)));

  /* ---------------- page 4 — E.4, E.6 ---------------- */
  for (const [n, k] of Object.entries(CIT8.str4.kwoty)) s4.kwota(k, poz(Number(n)));

  /* ---------------- page 5 — E.8, F, G ---------------- */
  const p5 = CIT8.str5;
  for (const [n, k] of Object.entries(p5.kwoty)) s5.kwota(k, poz(Number(n)));
  for (const [n, k] of Object.entries(p5.kwotyCale)) s5.kwotaZl(k, poz(Number(n)));
  s5.zaznacz(p5.stawka[d.stawka]);
  // Section G: the advance due and the advance paid are the same figure in the
  // month it was paid (poz. 151–156 / 175–180 and 169–174 / 193–198). Quarterly
  // advances sit in the quarter-ending months (3, 6, 9, 12), which are columns
  // 3/1 Kwartał, 6/2 Kwartał… — so every month with an amount is printed in its
  // own column, and the totals (poz. 228, 246) always add up to what is shown.
  d.zaliczki.forEach((z, i) => {
    if (!z || z <= 0) return;
    const x = p5.zaliczki.prawe[i % 6];
    const wiersz = i < 6 ? 0 : 1;
    s5.kwotaZl({ zl: x, y: p5.zaliczki.nalezna[wiersz] }, z);
    s5.kwotaZl({ zl: x, y: p5.zaliczki.zaplacona[wiersz] }, z);
  });

  /* ---------------- page 6 — G (cont.), H, I ---------------- */
  for (const [n, k] of Object.entries(CIT8.str6.kwotyCale)) s6.kwotaZl(k, poz(Number(n)));

  /* ---------------- page 7 — L ---------------- */
  for (const q of Object.values(CIT8.str7.nie)) s7.zaznacz(q);

  /* ---------------- page 8 — M ---------------- */
  const p8 = CIT8.str8;
  const osoba = [d.reprezentant.imie, d.reprezentant.nazwisko].filter(Boolean).join(' ');
  s8.pole(p8.osoba, osoba, 'Imię i nazwisko osoby odpowiedzialnej');
  s8.kratki(p8.data, dataNaKratki(d.reprezentant.dataWypelnienia), 'Data wypełnienia');
  s8.pole(p8.telefon, d.telefon, 'Telefon');

  /* ---------------- CIT-8/O, when there is exempt income ---------------- */
  if (wynik.cit8o) {
    const cit8o = await PDFDocument.load(Buffer.from(CIT8O_PDF_BASE64, 'base64'));
    // Pages 3–5 of the attachment (deductions, the capital-gains columns) are carried blank.
    const [o1, o2] = (await out.copyPages(cit8o, cit8o.getPageIndices())).map(
      (p) => new Strona(out.addPage(p), font, ZNAK_KRATKI_CIT8)
    );
    const o = CIT8O.str1;
    o1.kratki(o.nip, [nip], 'NIP (CIT-8/O)');
    o1.kratki(o.od, okres.od, 'Okres od (CIT-8/O)');
    o1.kratki(o.do, okres.do, 'Okres do (CIT-8/O)');
    o1.poleWiersze(o.nazwaPelna, d.nazwaPelna, 'Nazwa pełna (CIT-8/O)');
    o1.kwota(o.kwoty[38], wynik.dochodZwolniony);
    o2.kwota(CIT8O.str2.kwoty[77], wynik.dochodZwolniony);
  }

  out.setTitle(`CIT-8 ${rok} — ${d.nazwaPelna}`);
  out.setSubject(
    'Zeznanie o wysokości osiągniętego dochodu (poniesionej straty) i należnego podatku dochodowego od osób prawnych'
  );
  out.setCreator('FileFunky');
  out.setProducer('FileFunky');
  out.setLanguage('pl-PL');
  return out.save();
}
