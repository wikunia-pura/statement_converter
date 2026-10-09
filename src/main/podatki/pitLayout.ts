/**
 * Where every value goes on the PIT-11 (29) and PIT-4R (13) blanks (pitWzory.ts).
 *
 * Coordinates are points on the page AS DISPLAYED, origin top-left — the frame
 * `pdftotext -bbox` reports the form's own labels in, which is where every number
 * below was read from, together with the borders of the boxes (read from the
 * vector paths of the blank): a text box's value sits above its bottom border,
 * under the label; a digit grid is the `└────┴…┘` run printed in it (left/right
 * edge of the glyph run and its bottom); a tick box is the glyph the form prints
 * (Wingdings / Segoe UI Symbol "❑" with a shadow — its bbox is taller than the
 * visible square, so the centre is `yMin + offset`, not the middle of the bbox).
 * pitPdf.ts draws on them with the shared drawing class (formularz.ts).
 *
 * Money. Each amount cell of the PIT-11's part E carries a printed comma
 * (`,`) between the złoty and the grosze: the złoty part is right-aligned just
 * before it, the grosze part (two digits) starts just after it. Column "f"
 * (the advance) is whole złoty and has no comma — it is right-aligned under the
 * "zł" of its heading. Everywhere else (95–97, F, G) the cell reads
 * `<złoty> zł, <grosze> gr`: the digits go in front of each of the two words. The
 * PIT-4R's amounts of parts C are whole złoty, in front of the printed "zł"; its
 * parts D and E carry `zł, … gr` like the PIT-11's.
 */

import { Kratki, Kwadrat, Pole } from './formularz';

/**
 * One amount cell: `zl` is the right edge of the whole-złoty digits, `gr` the right
 * edge of the grosze digits (null = a whole-złoty cell), `y` the baseline and `od`
 * the left limit of the złoty digits (the cell's border plus padding), `grOd` the left
 * limit of the grosze digits (the printed comma or "zł," before them). The digits must
 * not cross a limit — they shrink to fit and, below the minimum size, are an error.
 */
export interface Komorka {
  zl: number;
  gr: number | null;
  y: number;
  od: number;
  grOd: number;
}

/** A cell with a printed comma: the grosze start 4.5 pt after the right edge of the złoty. */
const c = (zl: number, gr: number | null, y: number, od: number): Komorka => ({
  zl,
  gr,
  y,
  od,
  grOd: zl + 4.5,
});
/** A cell that reads `<złoty> zł, <grosze> gr`: the grosze start after the printed "zł,". */
const fg = (zl: number, gr: number, y: number, od: number): Komorka => ({
  zl,
  gr,
  y,
  od,
  grOd: zl + 8.5,
});

/** A text box: value starts at the label's left edge, `prawa` is the box's right border less padding. */
const pole = (x: number, y: number, prawa: number): Pole => ({ x, y, prawa });

/**
 * A tick box printed as the 12.5 × 15.5 glyph (PIT-11 part A / B / C, PIT-4R):
 * the square's centre is 6.0 below the glyph's top.
 */
const kw = (x0: number, x1: number, yMin: number): Kwadrat => ({ cx: (x0 + x1) / 2 + 0.4, cy: yMin + 6.0 });
/** A tick box printed as the taller 13.3 × 19.3 glyph (PIT-11 poz. 28, 118–121): centre 10.8 below the top. */
const kwWysoki = (x0: number, x1: number, yMin: number): Kwadrat => ({ cx: (x0 + x1) / 2 + 0.4, cy: yMin + 10.8 });

/** Width of one `└`/`─`/`┴` glyph of the PIT-11's grids; the date grid is the only multi-segment one. */
export const ZNAK_KRATKI_PIT11 = 3.2463;
/** The PIT-4R's grids are single-segment, so this is only the shared class's default. */
export const ZNAK_KRATKI_PIT4R = 3.2463;

/* =============================================================================
 *                                  PIT-11 (29)
 * ========================================================================== */

/** Part E, poz. 29–94 — amount cells by the position's number. */
const E: Record<number, Komorka> = {
  29: c(252.7, 267.2, 165.5, 213.8),
  30: c(322.1, 336.6, 165.5, 283.2),
  31: c(391.8, 406.3, 195.7, 352.7),
  32: c(461.2, 475.7, 195.7, 422.2),
  33: c(560.5, null, 195.7, 491.7),
  34: c(252.7, 267.2, 196.1, 213.8),
  35: c(322.1, 336.6, 196.1, 283.2),
  36: c(252.7, 267.2, 228.4, 213.8),
  37: c(322.1, 336.6, 228.4, 283.2),
  38: c(391.8, 406.3, 254.5, 352.7),
  39: c(461.2, 475.7, 254.5, 422.2),
  40: c(560.5, null, 254.5, 491.7),
  41: c(252.7, 267.2, 255.0, 213.8),
  42: c(322.1, 336.6, 255.0, 283.2),
  43: c(252.7, 267.2, 285.7, 213.8),
  44: c(322.1, 336.6, 285.7, 283.2),
  45: c(391.8, 406.3, 319.8, 352.7),
  46: c(461.2, 475.7, 319.8, 422.2),
  47: c(560.5, null, 319.8, 491.7),
  48: c(252.7, 267.2, 319.9, 213.8),
  49: c(322.1, 336.6, 319.9, 283.2),
  50: c(251.9, 266.5, 343.2, 213.8),
  51: c(390.8, 405.3, 343.2, 352.7),
  52: c(460.3, 474.9, 343.2, 422.2),
  53: c(560.5, null, 343.2, 491.7),
  54: c(252.7, 267.2, 391.5, 213.8),
  55: c(322.1, 336.6, 391.5, 283.2),
  56: c(391.8, 406.3, 391.5, 352.7),
  57: c(560.5, null, 391.5, 491.7),
  58: c(252.7, 267.2, 425.6, 213.8),
  59: c(322.1, 336.6, 425.6, 283.2),
  60: c(391.8, 406.3, 425.6, 352.7),
  61: c(560.5, null, 425.6, 491.7),
  62: c(252.7, 267.2, 452.7, 213.8),
  63: c(322.1, 336.6, 452.7, 283.2),
  64: c(391.8, 406.3, 452.7, 352.7),
  65: c(560.5, null, 452.7, 491.7),
  66: c(252.7, 267.2, 483.2, 213.8),
  67: c(322.1, 336.6, 483.2, 283.2),
  68: c(391.8, 406.3, 483.2, 352.7),
  69: c(560.5, null, 483.2, 491.7),
  70: c(251.9, 266.5, 507.5, 213.8),
  71: c(391.2, 406.0, 531.6, 352.7),
  72: c(560.5, null, 531.6, 491.7),
  73: c(251.9, 266.5, 531.6, 213.8),
  74: c(321.3, 335.9, 531.6, 283.2),
  75: c(252.7, 267.2, 557.8, 213.8),
  76: c(391.8, 406.3, 557.8, 352.7),
  77: c(560.5, null, 557.8, 491.7),
  78: c(252.7, 267.2, 585.1, 213.8),
  79: c(391.8, 406.3, 585.1, 352.7),
  80: c(560.5, null, 585.1, 491.7),
  81: c(252.3, 266.8, 612.8, 213.8),
  82: c(390.8, 405.3, 612.8, 352.7),
  83: c(560.5, null, 612.8, 491.7),
  84: c(252.7, 267.2, 640.5, 213.8),
  85: c(391.8, 406.3, 640.5, 352.7),
  86: c(560.5, null, 640.5, 491.7),
  87: c(252.7, 267.2, 668.2, 213.8),
  88: c(391.8, 406.3, 668.2, 352.7),
  89: c(560.5, null, 668.2, 491.7),
  90: c(252.7, 267.2, 696.0, 213.8),
  91: c(322.1, 336.6, 696.0, 283.2),
  92: c(391.8, 406.3, 696.0, 352.7),
  93: c(461.2, 475.7, 696.0, 422.2),
  94: c(560.5, null, 696.0, 491.7),
};

/** Poz. 95–97 (page 2) and parts F, G (page 3): `<złoty> zł, <grosze> gr`. */
const FG: Record<number, Komorka> = {
  95: fg(528.8, 556.0, 723.1, 422.2),
  96: fg(528.8, 556.0, 749.7, 422.2),
  97: fg(528.8, 556.0, 775.8, 422.2),
  98: fg(528.8, 556.0, 117.0, 421.5),
  100: fg(528.8, 556.0, 141.0, 421.5),
  102: fg(528.8, 556.0, 165.1, 421.5),
  104: fg(528.8, 556.0, 189.2, 421.5),
  105: fg(528.8, 556.0, 213.4, 421.5),
  106: fg(528.8, 556.0, 286.4, 421.5),
  107: fg(528.8, 556.0, 310.5, 421.5),
  108: fg(528.8, 556.0, 334.6, 421.5),
  109: fg(528.8, 556.0, 358.7, 421.5),
  110: fg(528.8, 556.0, 384.3, 421.5),
  111: fg(528.8, 556.0, 409.9, 421.5),
  112: fg(528.8, 556.0, 435.4, 421.5),
  113: fg(528.8, 556.0, 461.0, 421.5),
  114: fg(528.8, 556.0, 486.5, 421.5),
  115: fg(528.8, 556.0, 512.1, 421.5),
  116: fg(528.8, 556.0, 537.7, 421.5),
  117: fg(528.8, 556.0, 563.2, 421.5),
  122: fg(528.8, 556.0, 639.9, 421.5),
  123: fg(528.8, 556.0, 664.0, 421.5),
};

export const PIT11 = {
  /* ------------------------------- page 1 — A–D ------------------------------- */
  str1: {
    /** Poz. 1 — the payer's NIP; the label "NIP / numer PESEL" has "numer PESEL" struck out. */
    nip: { x0: 92.66, x1: 274.45, dol: 65.98, segmenty: [11] } as Kratki,
    skreslPesel: { x0: 140.9, x1: 186.98, y: 47.4 },
    rok: { x0: 255.53, x1: 323.9, dol: 150.48, segmenty: [4] } as Kratki,
    /** A.6 — the office's code and name. */
    urzad: pole(53.1, 339.5, 565.3),
    cel: { 1: kw(210.05, 222.56, 351.15), 2: kw(323.11, 335.62, 351.15) } as Record<1 | 2, Kwadrat>,
    /** B.8 — 1 = payer that is not a natural person. */
    podmiot: { 1: kw(131.18, 143.69, 404.57), 2: kw(383.23, 395.74, 404.57) } as Record<1 | 2, Kwadrat>,
    nazwaPelna: pole(53.1, 442.0, 565.3),
    /** C.11 — 1 = unlimited tax liability (resident). */
    obowiazek: { 1: kw(95.18, 107.69, 508.61), 2: kw(347.23, 359.74, 508.61) } as Record<1 | 2, Kwadrat>,
    /** Poz. 12 — a PESEL or a NIP: the word that does not apply is struck out of the label. */
    id: { x0: 93.26, x1: 275.07, dol: 560.48, segmenty: [11] } as Kratki,
    skreslNip: { x0: 146.43, x1: 158.04, y: 528.7 },
    skreslNumerPesel: { x0: 163.83, x1: 209.9, y: 528.7 },
    nrId: pole(320.9, 556.5, 565.3),
    rodzajNrId: pole(53.1, 581.0, 315.6),
    /** Right of the second line of the label, which is short, so the value does not touch it. */
    krajWydania: pole(385.0, 582.5, 565.3),
    nazwisko: pole(53.7, 604.4, 351.0),
    imie: pole(354.6, 604.4, 565.3),
    dataUrodzenia: { x0: 54.24, x1: 196.55, dol: 631.76, segmenty: [2, 2, 4] } as Kratki,
    kraj: pole(245.9, 628.2, 424.4),
    wojewodztwo: pole(429.9, 628.2, 565.3),
    powiat: pole(53.1, 652.2, 351.0),
    gmina: pole(356.4, 652.2, 565.3),
    ulica: pole(53.1, 676.2, 426.8),
    nrDomu: pole(432.2, 676.2, 494.2),
    nrLokalu: pole(499.5, 676.2, 565.3),
    miejscowosc: pole(53.1, 702.0, 426.8),
    kodPocztowy: pole(432.2, 702.0, 565.3),
    /** D.28 — 1 one employment, 3 one employment with the increased costs (2 and 4: more than one). */
    koszty: {
      1: kwWysoki(54.12, 67.39, 742.7),
      2: kwWysoki(326.23, 339.5, 742.7),
      3: kwWysoki(54.0, 67.28, 758.29),
      4: kwWysoki(326.23, 339.5, 760.34),
    } as Record<1 | 2 | 3 | 4, Kwadrat>,
  },

  /* ------------------------- page 2 — E (poz. 29–97) ------------------------- */
  E,

  /* ----------------- page 3 — F, G (poz. 98–123); 95–97 on page 2 ----------------- */
  str3: {
    /** Poz. 99 — what the money was for (the first of the four lines of F). */
    rodzajPrzychodu: pole(56.5, 138.5, 417.0),
    /** G: the exempt income under art. 21 ust. 1 pkt 152–154 (poz. 118–120) — not used by this module. */
    zwolnienie: {
      118: kwWysoki(129.38, 142.66, 574.2),
      119: kwWysoki(261.89, 275.17, 574.2),
      120: kwWysoki(400.15, 413.43, 574.2),
    } as Record<118 | 119 | 120, Kwadrat>,
    /** Poz. 121 — is a PIT-R attached: 1 = tak, 2 = nie. */
    pitR: { 1: kwWysoki(246.89, 260.17, 599.75), 2: kwWysoki(337.03, 350.31, 599.75) } as Record<1 | 2, Kwadrat>,
  },
  FG,
};

/* =============================================================================
 *                                  PIT-4R (13)
 * ========================================================================== */

/**
 * The six month columns of parts C: left limit and right edge of the złoty digits
 * (in front of the printed "zł") — the same on every page. Months I–VI are the
 * first row of a position, VII–XII the second.
 */
const MIESIAC_OD = [158.4, 227.0, 295.7, 364.5, 433.1, 501.9];
const MIESIAC_ZL = [216.3, 285.1, 353.7, 422.5, 491.2, 559.9];
/** Parts D and E (page 3): the grosze digits sit between the printed "zł," and "gr". */
const MIESIAC_ZL_D = [199.2, 267.9, 336.5, 405.3, 474.1, 542.8];
const MIESIAC_GR_D = [214.9, 283.6, 352.2, 421.0, 489.8, 558.4];

/** Baseline of the amount (the printed "zł") of each six-cell row, by the first position of the row. */
const WIERSZ_Y: Record<number, number> = {
  // page 1 — row 1 is two lines of months, each a "liczba podatników" line (10, 22) over an amount
  // line (16, 28); then rows 2 and 3.
  10: 510.66,
  16: 534.66,
  22: 570.69,
  28: 594.69,
  34: 630.93,
  40: 667.05,
  46: 703.19,
  52: 739.31,
  // page 2 — rows 4 to 12 (row 8 has only the months I–IV).
  58: 76.57,
  64: 112.69,
  70: 148.81,
  76: 184.93,
  82: 221.05,
  88: 257.2,
  94: 293.2,
  100: 329.32,
  106: 365.44,
  110: 437.7,
  116: 473.82,
  122: 509.82,
  128: 545.97,
  134: 582.09,
  140: 618.21,
  146: 657.93,
  152: 696.81,
  // page 3 — D (159–170) and E (171–182).
  159: 91.77,
  165: 132.09,
  171: 200.49,
  177: 242.28,
};
const WIERSZE = Object.keys(WIERSZ_Y).map(Number);

/** The cell of one position of the PIT-4R's parts C, D, E (poz. 10–33 are the row-1 cells "liczba" + "kwota"). */
export function pit4rKomorka(poz: number): Komorka {
  const start = [...WIERSZE].reverse().find((s) => s <= poz);
  if (start === undefined || (poz > 157 && poz < 159) || poz > 182) {
    throw new Error(`Pozycja ${poz} PIT-4R nie ma komórki w układzie formularza.`);
  }
  const kol = poz - start;
  if (kol < 0 || kol > 5) throw new Error(`Pozycja ${poz} PIT-4R nie ma komórki w układzie formularza.`);
  const y = WIERSZ_Y[start];
  if (poz >= 159) return fg(MIESIAC_ZL_D[kol], MIESIAC_GR_D[kol], y, MIESIAC_OD[kol]);
  return { zl: MIESIAC_ZL[kol], gr: null, y, od: MIESIAC_OD[kol], grOd: 0 };
}

export const PIT4R = {
  /* ----------------------------- page 1 — A, B ----------------------------- */
  str1: {
    /** Poz. 1 of the PIT-4R is a 10-cell grid (a NIP), unlike the PIT-11's 11-cell PESEL grids. */
    nip: { x0: 74.06, x1: 239.76, dol: 66.34, segmenty: [10] } as Kratki,
    rok: { x0: 256.85, x1: 325.22, dol: 150.36, segmenty: [4] } as Kratki,
    /** A.5 — the office's code and name. */
    urzad: pole(52.3, 304.1, 565.4),
    cel: { 1: kw(210.17, 222.68, 316.11), 2: kw(323.23, 335.74, 316.11) } as Record<1 | 2, Kwadrat>,
    /** A.7 — 1 = correction under art. 81 Ordynacji podatkowej, 2 = art. 81b § 1a (filed with the justification). */
    rodzajKorekty: { 1: kw(59.3, 71.81, 341.43), 2: kw(265.25, 277.76, 341.43) } as Record<1 | 2, Kwadrat>,
    /** B.8 — 1 = payer that is not a natural person. */
    podmiot: { 1: kw(130.34, 142.85, 401.69), 2: kw(382.39, 394.9, 401.69) } as Record<1 | 2, Kwadrat>,
    nazwaPelna: pole(52.3, 439.5, 565.4),
  },
  /** Part D.158 — did the payer reduce the advances under art. 26eb: 1 = tak, 2 = nie. */
  str2: {
    pomniejszenie: { 1: kw(243.29, 255.8, 764.14), 2: kw(342.79, 355.3, 764.14) } as Record<1 | 2, Kwadrat>,
  },
};
