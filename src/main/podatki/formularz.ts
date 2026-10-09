/**
 * What every printed tax form of the Podatki module is drawn with: one page of
 * an official blank, written onto in the coordinates its layout map uses (as
 * displayed, origin top-left). Shared by the DN-1 (dn1Pdf.ts) and the CIT-8
 * (cit8Pdf.ts) — one copy, so a fix to the shrink-to-fit or the grid logic
 * lands on every form.
 *
 * Bytes in, bytes out: no Electron here. Values are printed in capitals, as the
 * forms ask ("WYPEŁNIĆ DUŻYMI, DRUKOWANYMI LITERAMI"). A value that does not fit
 * its box even at the smallest size is an error naming the field — never clipped.
 */

import { PDFFont, PDFPage, degrees, rgb } from 'pdf-lib';
import { formatZl, zlGr } from '../../shared/podatki';

/** A text box: left edge, baseline, and the right edge the text must stay within. */
export interface Pole {
  x: number;
  y: number;
  prawa: number;
}

/**
 * A grid of character cells (`└────┴────┘`): its glyph run's left/right edges
 * and bottom. `segmenty` splits a date grid ("dd-mm-rrrr" = [2, 2, 4]).
 */
export interface Kratki {
  x0: number;
  x1: number;
  dol: number;
  segmenty: number[];
  /** Glyph width of this run, when it differs from the form's `znakKratki` (multi-segment grids only). */
  znak?: number;
}

/** A text box with the baselines of a second line, for values that may need two. */
export interface PoleWiersze extends Pole {
  /** Baselines of the first and the second line, when the value is broken. */
  dwa: [number, number];
  /** The largest size of a broken value, for a box too low for 8 pt lines. */
  rozmiarDwa?: number;
}

/** A tick box: the centre of its square. */
export interface Kwadrat {
  cx: number;
  cy: number;
}

/** An amount in a złoty/grosze box: right edges of each part, and the baseline. */
export interface Kwota {
  zl: number;
  gr: number;
  y: number;
}

/** An amount in a whole-złoty box: the right edge of the figure and its baseline. */
export interface KwotaZl {
  zl: number;
  y: number;
}

/** "Niebieskim kolorem" — dark enough to read as ink on a black-and-white copy. */
export const INK = rgb(0.05, 0.12, 0.4);
export const ROZMIAR = 9;
export const ROZMIAR_MIN = 6;
export const ROZMIAR_KRATKI = 10;

/**
 * Width of one `└`/`─`/`┴` glyph of the grids, in points. It is the form's own
 * typeface, so it differs from form to form — measured on the glyph runs of the
 * blank (see each layout map). Only a multi-segment grid (a date) needs it; a
 * single-segment one is spread over its measured edges.
 */
export const ZNAK_KRATKI_DN1 = 3.2479;

export const duze = (s: string) => s.toLocaleUpperCase('pl-PL');

/**
 * One page, drawn in the coordinates the layout map uses: as displayed, origin
 * top-left. The landscape ZDN-1 is a portrait page turned 90° clockwise, so a
 * displayed (x, y) is PDF (y, x) and the text is turned back by 90°.
 */
export class Strona {
  private readonly obrot: boolean;
  private readonly wysokosc: number;

  constructor(
    private readonly page: PDFPage,
    private readonly font: PDFFont,
    /** Width of one grid glyph on this form — see `ZNAK_KRATKI_DN1`. */
    private readonly znakKratki: number
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
    this.page.drawLine({
      start: this.pdf(x0, y0),
      end: this.pdf(x1, y1),
      thickness: grubosc,
      color: INK,
    });
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

  /**
   * A value in a text box that may hold two lines: one line at the normal size
   * while it fits, shrunk down to `minJedna` before it is broken; broken (after
   * a comma, else at the space nearest the middle) onto the baselines `p.dwa`
   * only then, each line shrinking to fit. Only a value too long for two lines
   * is an error.
   */
  poleWiersze(p: PoleWiersze, value: string, nazwa: string, size = ROZMIAR, minJedna = 7.5) {
    const text = duze(value);
    if (!text) return;
    const width = p.prawa - p.x - 1;
    if (this.szerokosc(text, minJedna) <= width || !/\s/.test(text)) {
      this.tekst(text, p.x + 1, p.y, this.rozmiar(text, width, nazwa, size, minJedna));
      return;
    }
    const lines = podziel(text);
    const s = Math.min(
      ...lines.map((line) => this.rozmiar(line, width, nazwa, Math.min(size, p.rozmiarDwa ?? 8)))
    );
    this.tekst(lines[0], p.x + 1, p.dwa[0], s);
    this.tekst(lines[1], p.x + 1, p.dwa[1], s);
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
  komorka(
    text: string,
    x0: number,
    x1: number,
    y: number,
    nazwa: string,
    align: 'left' | 'center'
  ) {
    if (!text) return;
    const width = x1 - x0 - 6;
    const place = (line: string, s: number, baseline: number) =>
      this.tekst(
        line,
        align === 'left' ? x0 + 3 : (x0 + x1 - this.szerokosc(line, s)) / 2,
        baseline,
        s
      );
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
    const w = single ? (k.x1 - k.x0) / glyphs : (k.znak ?? this.znakKratki);
    const dash = single ? 0 : (k.x1 - k.x0 - w * glyphs) / (k.segmenty.length - 1);
    let x = k.x0;
    k.segmenty.forEach((cells, s) => {
      const value = parts[s] ?? '';
      if (value.length > cells)
        throw new Error(`Pole „${nazwa}” ma więcej znaków niż kratek w formularzu.`);
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

  /** A whole-złoty amount, with spaces between thousands, right-aligned before the printed "zł". */
  kwotaZl(k: KwotaZl, value: number) {
    this.wPrawo(formatZl(value), k.zl, k.y);
  }

  kwota(k: Kwota, value: number) {
    const { zl, gr } = zlGr(value);
    this.wPrawo(zl, k.zl, k.y);
    this.wPrawo(gr, k.gr, k.y);
  }
}

/** Two lines: after the comma nearest the middle, else at the space nearest it. */
export function podziel(text: string): [string, string] {
  const mid = text.length / 2;
  const at = (re: RegExp) =>
    [...text.matchAll(re)]
      .map((m) => m.index! + m[0].length)
      .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  const cut = at(/,\s*/g) ?? at(/\s+/g) ?? Math.ceil(mid);
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}

/** "2027-01-31" → ["31", "01", "2027"] for a dd-mm-rrrr grid. */
export const dataNaKratki = (iso: string | null): string[] => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? [m[3], m[2], m[1]] : [];
};
