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

import { PDFDocument, PDFFont, PDFPage, degrees, rgb } from 'pdf-lib';
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
import { DN1, Kratki, Kwadrat, Kwota, Pole, ZDN1 } from './dn1Layout';

export interface DN1Wejscie {
  nip: string;
  rok: number;
  dane: PodatekNieruchomosciDane;
  stawki: PodatkiStawkiDane | null;
}

/** "Niebieskim kolorem" — dark enough to read as ink on a black-and-white copy. */
const INK = rgb(0.05, 0.12, 0.4);
const ROZMIAR = 9;
const ROZMIAR_MIN = 6;
const ROZMIAR_KRATKI = 10;
/** Width of one `└`/`─`/`┴` glyph of the grids — measured on the 11- and 14-cell runs. */
const ZNAK_KRATKI = 3.2479;

const duze = (s: string) => s.toLocaleUpperCase('pl-PL');

/**
 * One page, drawn in the coordinates the layout map uses: as displayed, origin
 * top-left. The landscape ZDN-1 is a portrait page turned 90° clockwise, so a
 * displayed (x, y) is PDF (y, x) and the text is turned back by 90°.
 */
class Strona {
  private readonly obrot: boolean;
  private readonly wysokosc: number;

  constructor(
    private readonly page: PDFPage,
    private readonly font: PDFFont,
  ) {
    this.obrot = page.getRotation().angle % 360 === 90;
    this.wysokosc = page.getHeight();
  }

  private pdf(x: number, y: number) {
    return this.obrot ? { x: y, y: x } : { x, y: this.wysokosc - y };
  }

  szerokosc(text: string, size: number): number {
    return this.font.widthOfTextAtSize(text, size);
  }

  tekst(text: string, x: number, y: number, size = ROZMIAR) {
    if (!text) return;
    this.page.drawText(text, {
      ...this.pdf(x, y),
      size,
      font: this.font,
      color: INK,
      ...(this.obrot ? { rotate: degrees(90) } : {}),
    });
  }

  linia(x0: number, y0: number, x1: number, y1: number, grubosc = 0.9) {
    this.page.drawLine({ start: this.pdf(x0, y0), end: this.pdf(x1, y1), thickness: grubosc, color: INK });
  }

  /** The largest size, down to the floor, at which `text` fits `width`. */
  rozmiar(text: string, width: number, nazwa: string, size = ROZMIAR, min = ROZMIAR_MIN): number {
    let s = size;
    while (s > min && this.szerokosc(text, s) > width) s -= 0.25;
    if (this.szerokosc(text, s) > width) {
      throw new Error(`Pole „${nazwa}” jest za długie, żeby zmieścić się w formularzu — skróć je.`);
    }
    return s;
  }

  /** A value in a text box, left-aligned; shrinks to fit, never clips. */
  pole(p: Pole, value: string, nazwa: string, size = ROZMIAR) {
    const text = duze(value);
    if (!text) return;
    const width = p.prawa - p.x - 1;
    this.tekst(text, p.x + 1, p.y, this.rozmiar(text, width, nazwa, size));
  }

  /** Right-aligned at `prawa` — amounts. */
  wPrawo(text: string, prawa: number, y: number, size = ROZMIAR) {
    if (!text) return;
    this.tekst(text, prawa - this.szerokosc(text, size), y, size);
  }

  /**
   * A ZDN-1 cell, [x0, x1] around baseline `y`: one line while it fits at a
   * readable size, else two — split after a comma (two land registers, two
   * plots) or at the space nearest the middle — and only then an error.
   */
  komorka(text: string, x0: number, x1: number, y: number, nazwa: string, align: 'left' | 'center') {
    if (!text) return;
    const width = x1 - x0 - 6;
    const place = (line: string, s: number, baseline: number) =>
      this.tekst(line, align === 'left' ? x0 + 3 : (x0 + x1 - this.szerokosc(line, s)) / 2, baseline, s);
    if (this.szerokosc(text, 6.5) <= width || !/\s/.test(text)) {
      place(text, this.rozmiar(text, width, nazwa, 8, 6.5), y);
      return;
    }
    const lines = podziel(text);
    const s = Math.min(...lines.map((line) => this.rozmiar(line, width, nazwa, 7.5, 5)));
    place(lines[0], s, y - 4.2);
    place(lines[1], s, y + 3.8);
  }

  /** One character per cell of a `└────┴…┘` grid, segment by segment. */
  kratki(k: Kratki, parts: string[], nazwa: string) {
    const glyphs = k.segmenty.reduce((n, cells) => n + 1 + 5 * cells, 0);
    const single = k.segmenty.length === 1;
    const w = single ? (k.x1 - k.x0) / glyphs : ZNAK_KRATKI;
    const dash = single ? 0 : (k.x1 - k.x0 - w * glyphs) / (k.segmenty.length - 1);
    let x = k.x0;
    k.segmenty.forEach((cells, s) => {
      const value = parts[s] ?? '';
      if (value.length > cells) throw new Error(`Pole „${nazwa}” ma więcej znaków niż kratek w formularzu.`);
      [...value].forEach((ch, i) => {
        if (ch === ' ') return;
        const cx = x + 3 * w + 5 * w * i;
        this.tekst(ch, cx - this.szerokosc(ch, ROZMIAR_KRATKI) / 2, k.dol - 3.6, ROZMIAR_KRATKI);
      });
      x += w * (1 + 5 * cells) + dash;
    });
  }

  /** A number right-aligned in a grid (the attachment counts). */
  kratkiWPrawo(k: Kratki, value: number, nazwa: string) {
    const cells = k.segmenty[0];
    this.kratki(k, [String(value).padStart(cells, ' ').slice(-cells)], nazwa);
  }

  /** An X across a tick box. */
  zaznacz(q: Kwadrat) {
    const r = 3;
    this.linia(q.cx - r, q.cy - r, q.cx + r, q.cy + r, 1.1);
    this.linia(q.cx - r, q.cy + r, q.cx + r, q.cy - r, 1.1);
  }

  /** "numer PESEL" struck out of the label of poz. 1. */
  skresl(s: { x0: number; x1: number; y: number }) {
    this.linia(s.x0, s.y, s.x1, s.y, 0.8);
  }

  kwota(k: Kwota, value: number) {
    const { zl, gr } = zlGr(value);
    this.wPrawo(zl, k.zl, k.y);
    this.wPrawo(gr, k.gr, k.y);
  }
}

/** Two lines: after the comma nearest the middle, else at the space nearest it. */
function podziel(text: string): [string, string] {
  const mid = text.length / 2;
  const at = (re: RegExp) =>
    [...text.matchAll(re)].map((m) => m.index! + m[0].length).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  const cut = at(/,\s*/g) ?? at(/\s+/g) ?? Math.ceil(mid);
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}

function adres(s: Strona, map: Record<keyof PodatekAdres, Pole>, a: PodatekAdres, sekcja: string) {
  (Object.keys(map) as (keyof PodatekAdres)[]).forEach((key) => s.pole(map[key], a[key], `${sekcja}: ${key}`));
}

/** "2027-01-31" → ["31", "01", "2027"] for a dd-mm-rrrr grid. */
const dataNaKratki = (iso: string | null): string[] => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? [m[3], m[2], m[1]] : [];
};

export async function dn1Pdf(we: DN1Wejscie): Promise<Uint8Array> {
  const { nip, rok, dane: d, stawki } = we;
  const problemy = problemyDN1({ nip, dane: d }, stawki);
  if (problemy.length > 0) {
    throw new Error(`Deklaracji nie da się jeszcze wydrukować: ${problemy.map((p) => opisProblemu(p, rok)).join('; ')}.`);
  }
  const wynik = obliczDN1(d, stawki);

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  // Not subset: pdf-lib's subsetting mis-maps glyphs of some fonts, and this one
  // is 22 kB whole.
  const font = await out.embedFont(Buffer.from(ARIMO_TTF_BASE64, 'base64'), { subset: false });
  const dn1 = await PDFDocument.load(Buffer.from(DN1_PDF_BASE64, 'base64'));
  const zdn1 = await PDFDocument.load(Buffer.from(ZDN1_PDF_BASE64, 'base64'));

  const strony = (await out.copyPages(dn1, dn1.getPageIndices())).map((p) => new Strona(out.addPage(p), font));
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
    const z = new Strona(out.addPage(a), font);
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
      const cell = (key: string, text: string, nazwa: string, align: 'left' | 'center' = 'center') =>
        z.komorka(text, k[key][0], k[key][1], y, `${nazwa} (wiersz ${lp})`, align);
      cell('polozenie', duze(g.polozenie), 'Położenie', 'left');
      cell('ksiegaWieczysta', duze(g.ksiegaWieczysta), 'Nr księgi wieczystej');
      cell('obreb', duze(g.obreb), 'Nr obrębu');
      cell('dzialka', duze(g.dzialka), 'Nr działki');
      if (g.powierzchnia !== null) cell('powierzchnia', formatPowierzchnia(g.powierzchnia, g.rodzaj), 'Powierzchnia');
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
