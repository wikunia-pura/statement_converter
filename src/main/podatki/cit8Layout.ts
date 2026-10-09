/**
 * Where every value goes on the CIT-8(34) and CIT-8/O(20) blanks (cit8Wzory.ts).
 *
 * Same conventions as dn1Layout.ts: coordinates are points on the page AS
 * DISPLAYED, origin top-left — the frame `pdftotext -bbox` reports the form's
 * own labels in, which is where every number below was read from. A field's
 * value sits under its printed label ("9. Nazwa pełna"), a digit grid is the
 * `└────┴…┘` run printed under it, a tick box is the `❑` glyph, an amount box
 * ends in the printed "zł," and "gr" (or just "zł" where the form wants whole
 * złoty) that the figures are right-aligned to. cit8Pdf.ts draws them.
 *
 * What differs from the DN-1:
 *  • Text boxes are 24 pt tall (the rows of B.2) or taller; the value's
 *    baseline is the label's top + 17. The two boxes that may hold a long value
 *    (poz. 6 and 9) also give the baselines of a second line.
 *  • The `❑` glyph is 13.27 × 19.33 pt at every tick of the CIT-8 and its
 *    square sits at a fixed offset from the glyph's top-left corner — read off a
 *    600 dpi raster of the blank, so a tick is placed from the glyph's bbox
 *    corner (`tick`), not from its centre as on the DN-1.
 *  • Date grids are drawn in one font whose glyph (3.216 pt) is narrower than
 *    the NIP grid's (3.249 pt), so each multi-segment grid carries its own
 *    `znak`.
 *  • Whole-złoty boxes (poz. 138–140, 148, 150, G, H, I…) print the amount
 *    right before the printed "zł".
 *
 * The CIT-8(34) is the form of tax year 2025; a new
 * version of the form needs a new layout map here, not just new bytes.
 */

import { Kratki, Kwota, KwotaZl, Kwadrat, Pole, PoleWiersze } from './formularz';

/** The glyph width a grid of this form is drawn with unless it carries its own `znak`. */
export const ZNAK_KRATKI_CIT8 = 3.216;

const BAZA = 17;
const pole = (x: number, etykieta: number, prawa: number): Pole => ({
  x,
  y: etykieta + BAZA,
  prawa,
});

/**
 * A tick box from the top-left corner of its `❑` glyph's bbox. The glyph's bbox
 * is 13.27 × 19.33 pt; its square (9 pt, plus a 1 pt shadow) starts 1.28 pt
 * right of and 5.63 pt below that corner.
 */
const tick = (x0: number, y0: number): Kwadrat => ({ cx: x0 + 5.78, cy: y0 + 10.13 });

/** The CIT-8's right border, less padding (the box edge is at 575.5). */
const P = 573;

/** Amounts: right edges of the złoty and grosze figures (2 pt before "zł,", 1.5 before "gr"), baseline of the label. */
const kw = (zl: number, gr: number, y: number): Kwota => ({ zl, gr, y });
const zl = (prawa: number, y: number): KwotaZl => ({ zl: prawa, y });

/** The usual columns: figures end at the "zł," at 545.62 and the "gr" at 566.04. */
const ZL = 543.62;
const GR = 564.54;
/** Whole-złoty boxes: the printed "zł" starts at 567.48. */
const ZL_CALE = 565.98;

export const CIT8 = {
  /* ------------------------------- page 1 — A, B ------------------------------- */
  str1: {
    nip: { x0: 41.88, x1: 207.58, dol: 48.34, segmenty: [10] } as Kratki,
    /** Poz. 4 and 5: dd-mm-rrrr, the glyph width worked out from the run's width less its two hyphens. */
    od: { x0: 163.34, x1: 305.9, dol: 119.28, segmenty: [2, 2, 4], znak: 3.216 } as Kratki,
    do: { x0: 319.27, x1: 461.8, dol: 119.28, segmenty: [2, 2, 4], znak: 3.2155 } as Kratki,
    /** Poz. 6 — box 259 to 283, only 15 pt under the label: one line at the usual size, two at 6.5 pt. */
    urzad: {
      x: 25.8,
      y: 260.75 + 17.5,
      prawa: P,
      dwa: [273.4, 280.2],
      rozmiarDwa: 6.5,
    } as PoleWiersze,
    /** Poz. 7: 1 złożenie, 2 korekta. */
    cel: { 1: tick(82.34, 295.62), 2: tick(165.5, 295.62) } as Record<1 | 2, Kwadrat>,
    /** Poz. 8: 1 art. 81, 2 art. 81b § 1a. */
    rodzajKorekty: { 1: tick(307.37, 290.58), 2: tick(307.37, 304.62) } as Record<1 | 2, Kwadrat>,
    /** Poz. 9 — box 374 to 405.5. */
    nazwaPelna: { x: 24.6, y: 395, prawa: P, dwa: [392.2, 402] } as PoleWiersze,
    /** B.2 (poz. 10–18). */
    siedziba: {
      kraj: pole(25.8, 431.17, 172.2),
      wojewodztwo: pole(175.22, 431.17, 402.5),
      powiat: pole(405.55, 431.17, P),
      gmina: pole(25.8, 455.17, 197.4),
      ulica: pole(200.45, 455.17, 464),
      nrDomu: pole(467.02, 455.17, 521.6),
      nrLokalu: pole(524.62, 455.17, P),
      miejscowosc: pole(25.8, 479.17, 464),
      kodPocztowy: pole(467.02, 479.17, P),
    },
    /** Poz. 26: 1 zwolnienia, 2 utracił prawo, 3 nie. */
    zwolnienie3Nie: tick(436.75, 717.24),
    /** Poz. 28 — quarterly advances, "1. tak". */
    zaliczkiKwartalne: tick(144.5, 768.25),
  },

  /* --------------------------- page 2 — B.3, C, D.1, D.2 --------------------------- */
  str2: {
    /** Poz. 33: "2. nie". */
    majatekZaGranica2Nie: tick(326.83, 94.36),
    /** Poz. 40 — number of CIT-8/O attachments, a 2-cell grid under its label. */
    zalacznikiCit8o: { x0: 391.03, x1: 427.0, dol: 244.95, segmenty: [2] } as Kratki,
    kwoty: {
      53: kw(ZL, GR, 383.15),
      61: kw(ZL, GR, 490.81),
      63: kw(ZL, GR, 558.85),
      77: kw(ZL, GR, 753.06),
    } as Record<number, Kwota>,
  },

  /* ------------------------------ page 3 — D.3, D.4, E.1 ------------------------------ */
  str3: {
    kwoty: {
      79: kw(ZL, GR, 89.24),
      81: kw(ZL, GR, 114.8),
      85: kw(ZL, GR, 182.84),
      87: kw(542.9, 563.94, 215.84),
      91: kw(ZL, GR, 309.71),
      93: kw(ZL, GR, 335.15),
      95: kw(ZL, GR, 360.71),
      97: kw(ZL, GR, 462.85),
      99: kw(ZL, GR, 488.29),
      113: kw(ZL, GR, 687.04),
      /** E.2 — the boxes are a little narrower: "zł," at 544.06. */
      114: kw(542.06, 564.51, 747.06),
      115: kw(542.06, 564.51, 782.46),
    } as Record<number, Kwota>,
  },

  /* --------------------------------- page 4 — E.4, E.6 --------------------------------- */
  str4: {
    kwoty: {
      120: kw(542.06, 564.51, 207.2),
      131: kw(542.06, 564.62, 651.52),
      132: kw(542.06, 564.61, 676.48),
    } as Record<number, Kwota>,
  },

  /* ------------------------- page 5 — E.8, F, G (poz. 138–228) ------------------------- */
  str5: {
    /** Poz. 141 — złoty and grosze. */
    kwoty: {
      141: kw(542.06, 564.51, 183.92),
      143: kw(545.3, 564.63, 260.51),
      144: kw(545.3, 564.63, 285.83),
      146: kw(545.3, 564.66, 336.83),
    } as Record<number, Kwota>,
    /** Whole złoty: poz. 138–140, 148, and "Razem" of the advances due (228). */
    kwotyCale: {
      138: zl(ZL_CALE, 107.84),
      139: zl(ZL_CALE, 132.92),
      140: zl(ZL_CALE, 158.36),
      148: zl(ZL_CALE, 389.15),
      228: zl(ZL_CALE, 789.78),
    } as Record<number, KwotaZl>,
    /** Poz. 142: 1 = 19%, 2 = 9%. */
    stawka: { 19: tick(457.42, 217.72), 9: tick(507.1, 217.72) } as Record<19 | 9, Kwadrat>,
    /**
     * Section G, the first twelve of its 24 months, six to a row: right edges of
     * the figure in columns 1–6, and the baselines of the four rows.
     */
    zaliczki: {
      prawe: [175.64, 253.67, 331.69, 409.81, 487.84, 565.98],
      /** "Należna zaliczka" poz. 151–156 (months 1–6) and 175–180 (7–12). */
      nalezna: [473.41, 578.92],
      /** "Zaliczka zapłacona" poz. 169–174 (months 1–6) and 193–198 (7–12). */
      zaplacona: [545.77, 651.16],
    },
  },

  /* ------------------------- page 6 — G (cont.), H, I (poz. 246–260) ------------------------- */
  str6: {
    kwotyCale: {
      246: zl(ZL_CALE, 95.96),
      247: zl(ZL_CALE, 146.24),
      248: zl(ZL_CALE, 171.8),
      250: zl(ZL_CALE, 248.15),
      259: zl(ZL_CALE, 484.81),
      260: zl(ZL_CALE, 510.25),
    } as Record<number, KwotaZl>,
  },

  /* ----------------------------------- page 7 — L ----------------------------------- */
  str7: {
    /** The "2. nie" squares of poz. 315, 316, 317, 318, 320, 321. */
    nie: {
      315: tick(308.45, 286.26),
      316: tick(308.45, 317.82),
      317: tick(308.45, 349.02),
      318: tick(308.45, 380.23),
      320: tick(308.45, 437.0),
      321: tick(308.45, 464.49),
    } as Record<number, Kwadrat>,
  },

  /* --------------------------------- page 8 — M --------------------------------- */
  str8: {
    /** Poz. 325 — box 133 to 158.75. */
    osoba: pole(24.6, 135.08, P),
    /** Poz. 327: dd-mm-rrrr. */
    data: { x0: 63.74, x1: 206.27, dol: 218.88, segmenty: [2, 2, 4], znak: 3.2154 } as Kratki,
    /** Poz. 328 — the box (193 to 218) is for a signature too; the phone goes in its lower part. */
    telefon: { x: 250.85, y: 214.6, prawa: P } as Pole,
  },
};

/** CIT-8/O(20) — the attachment's two pages with figures. */
export const CIT8O = {
  str1: {
    nip: { x0: 69.98, x1: 235.68, dol: 67.78, segmenty: [10] } as Kratki,
    od: { x0: 166.1, x1: 308.66, dol: 144.72, segmenty: [2, 2, 4], znak: 3.2163 } as Kratki,
    do: { x0: 317.71, x1: 460.24, dol: 144.72, segmenty: [2, 2, 4], znak: 3.2159 } as Kratki,
    /** Poz. 6 — box 193.75 to 229.5. */
    nazwaPelna: { x: 30.6, y: 195.44 + 19, prawa: 565, dwa: [212, 222.5] } as PoleWiersze,
    /** B.1 poz. 38: income of housing cooperatives and communities — other sources, column 2. */
    kwoty: { 38: kw(536.78, 557.68, 744.42) } as Record<number, Kwota>,
  },
  str2: {
    /** Poz. 77: total of the exempt income of other sources. */
    kwoty: { 77: kw(536.78, 557.68, 510.25) } as Record<number, Kwota>,
  },
};
