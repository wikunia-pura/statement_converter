/**
 * A community's DN-1, filled in: the official blank (dn1Wzory.ts) with the
 * values drawn onto it where the layout map (dn1Layout.ts) says, followed by
 * as many ZDN-1 attachments as the plots need — one file, so one signature
 * later covers the whole declaration.
 *
 * Bytes in, bytes out: no Electron here, so the file can be made (and looked
 * at) without the app. Values are printed in capitals, as the form asks
 * ("WYPEŁNIĆ DUŻYMI, DRUKOWANYMI LITERAMI"). A value that does not fit its box
 * even at the smallest size is an error naming the field — never clipped.
 */

import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  GruntRodzaj,
  PodatekAdres,
  PodatekNieruchomosciDane,
  PodatkiStawkiDane,
} from '../../shared/types';
import {
  ZDN1_WIERSZY,
  formatPowierzchnia,
  formatStawka,
  formatZl,
  liczbaZdn1,
  obliczDN1,
  opisProblemu,
  problemyDN1,
  zlGr,
} from '../../shared/podatki';
import { DN1_PDF_BASE64, ZDN1_PDF_BASE64 } from './dn1Wzory';
import { ARIMO_TTF_BASE64 } from './dn1Font';
import { DN1, ZDN1 } from './dn1Layout';
import { Pole, Strona, ZNAK_KRATKI_DN1, dataNaKratki, duze } from './formularz';

export interface DN1Wejscie {
  nip: string;
  rok: number;
  dane: PodatekNieruchomosciDane;
  stawki: PodatkiStawkiDane | null;
}

function adres(s: Strona, map: Record<keyof PodatekAdres, Pole>, a: PodatekAdres, sekcja: string) {
  (Object.keys(map) as (keyof PodatekAdres)[]).forEach((key) =>
    s.pole(map[key], a[key], `${sekcja}: ${key}`)
  );
}

export async function dn1Pdf(we: DN1Wejscie): Promise<Uint8Array> {
  const { nip, rok, dane: d, stawki } = we;
  const problemy = problemyDN1({ nip, dane: d }, stawki);
  if (problemy.length > 0) {
    throw new Error(
      `Deklaracji nie da się jeszcze wydrukować: ${problemy.map((p) => opisProblemu(p, rok)).join('; ')}.`
    );
  }
  const wynik = obliczDN1(d, stawki);

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  // Not subset: pdf-lib's subsetting mis-maps glyphs of some fonts, and this one
  // is 22 kB whole.
  const font = await out.embedFont(Buffer.from(ARIMO_TTF_BASE64, 'base64'), { subset: false });
  const dn1 = await PDFDocument.load(Buffer.from(DN1_PDF_BASE64, 'base64'));
  const zdn1 = await PDFDocument.load(Buffer.from(ZDN1_PDF_BASE64, 'base64'));

  const strony = (await out.copyPages(dn1, dn1.getPageIndices())).map(
    (p) => new Strona(out.addPage(p), font, ZNAK_KRATKI_DN1)
  );
  const [s1, s2, , s4, s5] = strony;

  /* ---------------- page 1 — A, B, C ---------------- */
  s1.kratki(DN1.str1.nip, [nip], 'NIP');
  s1.skresl(DN1.str1.skreslPesel);
  s1.kratki(DN1.str1.rok, [String(rok)], 'Rok');
  s1.pole(DN1.str1.organ, d.organ, 'Nazwa i adres organu podatkowego');
  s1.zaznacz(DN1.str1.cel[d.cel]);
  s1.kratki(DN1.str1.okres, [String(d.okresOd).padStart(2, '0')], 'Okres');
  s1.zaznacz(DN1.str1.podmiot[d.rodzajPodmiotu]);
  s1.zaznacz(DN1.str1.podatnik[d.rodzajPodatnika]);
  s1.pole(DN1.str1.nazwaPelna, d.nazwaPelna, 'Nazwa pełna');
  s1.pole(DN1.str1.nazwaSkrocona, d.nazwaSkrocona, 'Nazwa skrócona');
  if (d.regon) s1.kratki(DN1.str1.regon, [d.regon], 'REGON');
  adres(s1, DN1.str1.siedziba, d.siedziba, 'Adres siedziby');
  adres(s1, DN1.str1.doreczenia, d.doreczenia, 'Adres do doręczeń');

  /* ---------------- page 2 — D.1 ---------------- */
  for (const p of wynik.d1) {
    const y = DN1.str2.wiersz[p.rodzaj as GruntRodzaj];
    s2.wPrawo(formatPowierzchnia(p.powierzchnia, p.rodzaj), DN1.str2.powierzchniaPrawa, y);
    if (p.stawka !== null) {
      const st = zlGr(p.stawka);
      // A rate with more than two decimals goes whole into the złoty box.
      if (Math.abs(p.stawka * 100 - Math.round(p.stawka * 100)) < 1e-9) {
        s2.wPrawo(st.zl, DN1.str2.stawka.zl, y);
        s2.wPrawo(st.gr, DN1.str2.stawka.gr, y);
      } else {
        s2.wPrawo(formatStawka(p.stawka), DN1.str2.stawka.gr, y);
      }
    }
    if (p.kwota !== null) {
      const k = zlGr(p.kwota);
      s2.wPrawo(k.zl, DN1.str2.kwota.zl, y);
      s2.wPrawo(k.gr, DN1.str2.kwota.gr, y);
    }
  }

  /* ---------------- page 4 — E, F, G ---------------- */
  s4.kwota(DN1.str4.k97, wynik.kwota97 ?? 0);
  s4.kwota(DN1.str4.k98, wynik.kwota98);
  s4.wPrawo(formatZl(wynik.kwota99 ?? 0), DN1.str4.k99.prawa, DN1.str4.k99.y);
  wynik.raty.forEach((rata, i) => {
    if (rata === null) return;
    const { prawaLewa, prawaPrawa, y } = DN1.str4.raty;
    s4.wPrawo(formatZl(rata), i % 2 === 0 ? prawaLewa : prawaPrawa, y[Math.floor(i / 2)]);
  });
  const ileZdn1 = liczbaZdn1(d);
  s4.kratkiWPrawo(DN1.str4.zalacznikiZdn1, ileZdn1, 'Liczba załączników ZDN-1');
  s4.kratkiWPrawo(DN1.str4.zalacznikiZdn2, 0, 'Liczba załączników ZDN-2');
  s4.pole(DN1.str4.telefon, d.telefon, 'Telefon');
  s4.pole(DN1.str4.email, d.email, 'E-mail');

  /* ---------------- page 5 — G, H.2 ---------------- */
  s5.pole(DN1.str5.inne, d.inne, 'Inne');
  s5.pole(DN1.str5.imie, d.reprezentant.imie, 'Imię osoby reprezentującej');
  s5.pole(DN1.str5.nazwisko, d.reprezentant.nazwisko, 'Nazwisko osoby reprezentującej');
  s5.kratki(DN1.str5.data, dataNaKratki(d.reprezentant.dataWypelnienia), 'Data wypełnienia');

  /* ---------------- ZDN-1, one per eight plots ---------------- */
  for (let n = 0; n < ileZdn1; n++) {
    const [a, b] = await out.copyPages(zdn1, zdn1.getPageIndices());
    const z = new Strona(out.addPage(a), font, ZNAK_KRATKI_DN1);
    out.addPage(b);
    z.kratki(ZDN1.nip, [nip], 'NIP (ZDN-1)');
    z.skresl(ZDN1.skreslPesel);
    z.kratkiWPrawo(ZDN1.nrZalacznika, n + 1, 'Nr załącznika');
    z.pole(ZDN1.nazwaPelna, d.nazwaPelna, 'Nazwa pełna (ZDN-1)');
    z.pole(ZDN1.nazwaSkrocona, d.nazwaSkrocona, 'Nazwa skrócona (ZDN-1)');
    d.grunty.slice(n * ZDN1_WIERSZY, (n + 1) * ZDN1_WIERSZY).forEach((g, i) => {
      const y = ZDN1.wiersz1 + i * ZDN1.wierszKrok;
      const lp = n * ZDN1_WIERSZY + i + 1;
      const k = ZDN1.kolumny;
      const stawka = stawki?.[g.rodzaj];
      const cell = (
        key: string,
        text: string,
        nazwa: string,
        align: 'left' | 'center' = 'center'
      ) => z.komorka(text, k[key][0], k[key][1], y, `${nazwa} (wiersz ${lp})`, align);
      cell('polozenie', duze(g.polozenie), 'Położenie', 'left');
      cell('ksiegaWieczysta', duze(g.ksiegaWieczysta), 'Nr księgi wieczystej');
      cell('obreb', duze(g.obreb), 'Nr obrębu');
      cell('dzialka', duze(g.dzialka), 'Nr działki');
      if (g.powierzchnia !== null)
        cell('powierzchnia', formatPowierzchnia(g.powierzchnia, g.rodzaj), 'Powierzchnia');
      if (stawka != null) cell('stawka', formatStawka(stawka), 'Stawka');
      cell('formaWladania', duze(g.formaWladania), 'Forma władania');
    });
  }

  out.setTitle(`DN-1 ${rok} — ${d.nazwaPelna}`);
  out.setSubject('Deklaracja na podatek od nieruchomości');
  out.setCreator('FileFunky');
  out.setProducer('FileFunky');
  out.setLanguage('pl-PL');
  return out.save();
}
