/**
 * Where every value goes on the DN-1(1) and ZDN-1(1) blanks (dn1Wzory.ts).
 *
 * Coordinates are points on the page AS DISPLAYED, origin top-left — the frame
 * `pdftotext -bbox` reports the form's own labels in, which is where every
 * number below was read from: a field's value sits under its printed label
 * ("9. Nazwa pełna"), a digit grid is the `└────┴…┘` run printed under it, a
 * tick box is the `❑` glyph. dn1Pdf.ts turns them into PDF space, rotating for
 * the landscape ZDN-1.
 *
 * Text boxes on the DN-1 are 24.84 pt tall with the label in their top 7 pt,
 * so a value's baseline is the label's top + 17.5. Amount columns align the
 * złoty and the grosze to the "zł" / "gr" printed in the form.
 */

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

const BAZA = 17.5;
const pole = (x: number, etykieta: number, prawa: number): Pole => ({ x, y: etykieta + BAZA, prawa });
/** The `❑` glyph's bbox runs past the square; its centre and bottom are true. */
const kwadrat = (x0: number, x1: number, yMax: number): Kwadrat => ({ cx: (x0 + x1) / 2, cy: yMax - 6 });

/** Left edge of a value — just past the box's border, where the label starts. */
const L = 51.96;
/** The DN-1's right border, less padding. */
const P = 565;

export const DN1 = {
  /* ------------------------------- page 1 ------------------------------- */
  str1: {
    nip: { x0: 72.24, x1: 254.12, dol: 58.41, segmenty: [11] } as Kratki,
    /** "numer PESEL" in the label of poz. 1 — struck out, the number is a NIP. */
    skreslPesel: { x0: 135.0, x1: 180.77, y: 39.9 },
    rok: { x0: 257.16, x1: 325.52, dol: 131.84, segmenty: [4] } as Kratki,
    organ: pole(L, 300.4, P),
    cel: { 1: kwadrat(213.84, 228.83, 345.77), 2: kwadrat(321.84, 336.83, 345.77) } as Record<1 | 2, Kwadrat>,
    okres: { x0: 305.64, x1: 341.6, dol: 373.05, segmenty: [2] } as Kratki,
    podmiot: { 1: kwadrat(108.6, 123.59, 422.69), 2: kwadrat(287.28, 302.27, 422.69) } as Record<1 | 2, Kwadrat>,
    podatnik: {
      1: kwadrat(98.64, 113.63, 501.53),
      2: kwadrat(204.84, 219.83, 501.53),
      3: kwadrat(296.88, 311.87, 501.53),
    } as Record<1 | 2 | 3, Kwadrat>,
    nazwaPelna: pole(L, 505.72, 308),
    nazwaSkrocona: pole(311.16, 505.72, P),
    regon: { x0: 193.32, x1: 423.8, dol: 552.69, segmenty: [14] } as Kratki,
    /** C.2 (poz. 15–23) and C.3 (poz. 24–32) — the same grid of boxes. */
    siedziba: {
      kraj: pole(L, 626.44, 161),
      wojewodztwo: pole(163.32, 626.44, 391),
      powiat: pole(393.48, 626.44, P),
      gmina: pole(L, 651.28, 186),
      ulica: pole(188.52, 651.28, 452),
      nrDomu: pole(454.68, 651.28, 510),
      nrLokalu: pole(512.4, 651.28, P),
      miejscowosc: pole(L, 676.12, 308),
      kodPocztowy: pole(311.16, 676.12, P),
    },
    doreczenia: {
      kraj: pole(L, 724.48, 160.5),
      wojewodztwo: pole(162.96, 724.48, 390.5),
      powiat: pole(392.88, 724.48, P),
      gmina: pole(L, 749.32, 185.5),
      ulica: pole(188.16, 749.32, 451.5),
      nrDomu: pole(453.96, 749.32, 509.5),
      nrLokalu: pole(511.8, 749.32, P),
      miejscowosc: pole(L, 774.16, 308),
      kodPocztowy: pole(311.16, 774.16, P),
    },
  },

  /* ----------------------- page 2 — D.1 grunty ----------------------- */
  str2: {
    /** Baselines of the four D.1 rows (label top + 20; the rows are 31.2 pt tall). */
    wiersz: { dzialalnosc: 138.72, wody: 169.92, pozostale: 201.12, rewitalizacja: 232.32 },
    /** Area right-aligned in its column (poz. 33/36/39/42). */
    powierzchniaPrawa: 347.5,
    /** Rate and tax: right edges of the złoty and grosze parts, at the "zł" / "gr" headings. */
    stawka: { zl: 431.6, gr: 455.4 },
    kwota: { zl: 541.1, gr: 564.9 },
  },

  /* ------------------ page 4 — E, F, G (poz. 97–115) ------------------ */
  str4: {
    k97: { zl: 532.5, gr: 557.4, y: 452.1 } as Kwota,
    k98: { zl: 532.5, gr: 557.4, y: 476.8 } as Kwota,
    /** Poz. 99 and the rates are whole złoty, right before the printed "zł". */
    k99: { prawa: 558.4, y: 501.5 },
    /** Poz. 100–111, in pairs per row: odd rates left, even ones right. */
    raty: {
      prawaLewa: 298.9,
      prawaPrawa: 558.4,
      y: [553.0, 577.8, 602.6, 627.3, 652.0, 676.8],
    },
    zalacznikiZdn1: { x0: 152.76, x1: 204.92, dol: 733.05, segmenty: [3] } as Kratki,
    zalacznikiZdn2: { x0: 412.08, x1: 464.24, dol: 733.05, segmenty: [3] } as Kratki,
    /** Poz. 114–115 sit in a shorter, 20 pt box at the foot of the page. */
    telefon: { x: L, y: 777.64 + 15.5, prawa: 308 } as Pole,
    email: { x: 311.16, y: 777.64 + 15.5, prawa: P } as Pole,
  },

  /* ------------------------ page 5 — G, H ------------------------ */
  str5: {
    inne: pole(L, 36.4, P),
    imie: pole(L, 191.8, 308),
    nazwisko: pole(311.16, 191.8, P),
    data: { x0: 107.64, x1: 250.16, dol: 246.57, segmenty: [2, 2, 4] } as Kratki,
  },
};

/** ZDN-1, page 1 — displayed landscape (842 × 595). */
export const ZDN1 = {
  nip: { x0: 159.95, x1: 341.84, dol: 60.21, segmenty: [11] } as Kratki,
  skreslPesel: { x0: 148.8, x1: 194.56, y: 41.6 },
  nrZalacznika: { x0: 721.67, x1: 773.84, dol: 152.73, segmenty: [3] } as Kratki,
  nazwaPelna: { x: 66.95, y: 199.72 + 18, prawa: 431 } as Pole,
  nazwaSkrocona: { x: 434.75, y: 199.72 + 18, prawa: 796 } as Pole,
  /** Baseline of row 1 of B.1, and the step to the next (the "1"…"8" labels). */
  wiersz1: 323.4,
  wierszKrok: 23.45,
  /** Column edges a–g, read off the printed rules. */
  kolumny: {
    polozenie: [64.8, 360.0],
    ksiegaWieczysta: [360.0, 445.7],
    obreb: [445.7, 502.0],
    dzialka: [502.0, 558.3],
    powierzchnia: [558.3, 650.6],
    stawka: [650.6, 721.3],
    formaWladania: [721.3, 799.9],
  } as Record<string, [number, number]>,
};
