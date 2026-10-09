/**
 * The yearly Excel exchange of the PIT module: the app writes a workbook with every community's people and the
 * previous year's amounts next to empty cells for the new year, the accountant fills it in, the app reads it back.
 *
 *   zbudujSzablonPit()   rows + year  → .xlsx   (sheets "Kwoty", "PIT-4R", "Instrukcja")
 *   wczytajPit()         .xlsx + rows → patches (never writes anything itself)
 *   zastosujZmianyPit()  data + patches → new data (pure; the integrator saves it)
 *
 * Rules the reader keeps:
 *   • Rows are matched by community NIP + person key (the grey "Identyfikator" column); when that cell is empty
 *     or the column is gone, by the person's name inside the community. The sheet never creates a person or a
 *     community — people are added in the app.
 *   • Only cells that differ from what the app already holds produce a change, so a template read back without
 *     edits changes nothing. An empty cell never clears an amount — except the two "empty = by rule" inputs
 *     (costs of a mandate / employment, the art. 13 advance), where empty is a statement: null, the rule.
 *   • Columns of a title the person does not have are ignored, a value in them is reported.
 *   • Anything unreadable (text, negative, more than two decimals, grosze in an advance) is skipped and listed,
 *     never rounded or guessed.
 */

import ExcelJS from 'exceljs';
import {
  MIESIACE_SKROT,
  PitArt13,
  PitEtat,
  PitMiesiace,
  PitOsoba,
  PitPit4R,
  PitDane,
  PitTytul,
  PitZlecenie,
  PitZarzad,
  PodatekPit,
  kluczOsoby,
  kosztyEtatu,
  kosztyZlecenia,
  nazwaOsoby,
  obliczOsobe,
  poprzedniaOsoba,
  poprzedniePit4R,
  pustePit4R,
  sumyZaliczek,
} from '../../shared/podatki-pit';
import { doGroszy } from '../../shared/podatki';

/* ================================== Contract ================================== */

/** What the reader found different for one person; only keys that changed are present. */
export interface PitOsobaPatch {
  zarzad?: Partial<Pick<PitZarzad, 'kwota'>>;
  zlecenie?: Partial<PitZlecenie>;
  etat?: Partial<PitEtat>;
  art13?: Partial<PitArt13>;
  skladki?: number | null;
  zdrowotna?: number | null;
}

/** Month index (0 = January … 11 = December) → whole-złoty value. Months absent from the map stay as they are. */
export type PitMiesiaceZmiany = Record<number, number>;

/** What the reader found different for the community's PIT-4R. */
export interface PitPit4RPatch {
  etatLiczba?: PitMiesiaceZmiany;
  etatKwota?: PitMiesiaceZmiany;
  art41?: PitMiesiaceZmiany;
  inne?: PitMiesiaceZmiany;
}

/** One change set: a person's amounts (`klucz` = the person's key) or the community's PIT-4R (`klucz` = null). */
export type PitZmiana =
  | { wierszId: number; klucz: string; pola: PitOsobaPatch }
  | { wierszId: number; klucz: null; pola: PitPit4RPatch };

export interface PitExcelPominiety {
  arkusz: 'Kwoty' | 'PIT-4R';
  /** 1-based row of the sheet. */
  wiersz: number;
  powod: string;
}

export interface PitExcelWynik {
  zmiany: PitZmiana[];
  ostrzezenia: string[];
  pominiete: PitExcelPominiety[];
  statystyki: {
    /** Rows of the "Kwoty" sheet that held a person. */
    wierszeOsob: number;
    /** … of which matched a person of the app. */
    dopasowaneOsoby: number;
    osobyZeZmianami: number;
    wspolnotyPit4rZeZmianami: number;
  };
}

/* ================================ Column layout ================================ */

type PoleId =
  | 'zarzad.kwota'
  | 'zlecenie.przychod'
  | 'zlecenie.koszty'
  | 'zlecenie.zaliczka'
  | 'etat.przychod'
  | 'etat.koszty'
  | 'etat.zaliczka'
  | 'art13.przychod'
  | 'art13.zaliczka'
  | 'skladki'
  | 'zdrowotna';

interface PoleKwot {
  id: PoleId;
  naglowek: string;
  /** The title a person must have for the column to count; null = always. */
  tytul: PitTytul | null;
  /** Whole złoty (advances). */
  zlote: boolean;
  /** An empty cell means "by rule" (null), not "unchanged". */
  regula: boolean;
  szer: number;
  uwaga?: string;
}

const POLA: PoleKwot[] = [
  { id: 'zarzad.kwota', naglowek: 'Zarząd – kwota roczna', tytul: 'zarzad', zlote: false, regula: false, szer: 15 },
  { id: 'zlecenie.przychod', naglowek: 'Zlecenie – przychód', tytul: 'zlecenie', zlote: false, regula: false, szer: 15 },
  {
    id: 'zlecenie.koszty',
    naglowek: 'Zlecenie – koszty',
    tytul: 'zlecenie',
    zlote: false,
    regula: true,
    szer: 15,
    uwaga: 'Puste = koszty z reguły (20% przychodu, nie więcej niż limit roczny). Wpisz kwotę tylko gdy są inne.',
  },
  { id: 'zlecenie.zaliczka', naglowek: 'Zlecenie – zaliczka', tytul: 'zlecenie', zlote: true, regula: false, szer: 13, uwaga: 'Pełne złote, z listy płac.' },
  { id: 'etat.przychod', naglowek: 'Etat – przychód', tytul: 'etat', zlote: false, regula: false, szer: 15 },
  {
    id: 'etat.koszty',
    naglowek: 'Etat – koszty',
    tytul: 'etat',
    zlote: false,
    regula: true,
    szer: 15,
    uwaga: 'Puste = koszty do rocznego limitu (3 000 zł, 3 600 zł przy podwyższonych).',
  },
  { id: 'etat.zaliczka', naglowek: 'Etat – zaliczka', tytul: 'etat', zlote: true, regula: false, szer: 13, uwaga: 'Pełne złote, z listy płac.' },
  { id: 'art13.przychod', naglowek: 'Art. 13 – przychód', tytul: 'art13', zlote: false, regula: false, szer: 15 },
  {
    id: 'art13.zaliczka',
    naglowek: 'Art. 13 – zaliczka',
    tytul: 'art13',
    zlote: true,
    regula: true,
    szer: 13,
    uwaga: 'Puste = zaliczka wyliczona (12% dochodu, pełne złote).',
  },
  { id: 'skladki', naglowek: 'Składki ZUS (poz. 95)', tytul: null, zlote: false, regula: false, szer: 15 },
  { id: 'zdrowotna', naglowek: 'Zdrowotna (poz. 122)', tytul: null, zlote: false, regula: false, szer: 15 },
];

const NAGL_NIP = 'NIP wspólnoty';
const NAGL_WSP = 'Wspólnota';
const NAGL_OSOBA = 'Osoba (Nazwisko Imię)';
const NAGL_ID = 'Identyfikator';
const NAGL_POPRZ_ROK = 'Poprz. – rok danych';
const PREFIKS_POPRZ = 'Poprz. – ';

/** Wholly-numbered columns of the "Kwoty" sheet. */
const KOL_NIP = 1;
const KOL_WSP = 2;
const KOL_OSOBA = 3;
const KOL_ID = 4;
const KOL_POLA = 5; // first input column
const KOL_SPACER = KOL_POLA + POLA.length; // 16
const KOL_POPRZ_ROK = KOL_SPACER + 1;
const KOL_POPRZ = KOL_POPRZ_ROK + 1;

const WIERSZE_PIT4R = [
  { kod: 'etatLiczba', naglowek: 'Wiersz 1 – liczba podatników', klucz: 'etatLiczba' },
  { kod: 'etatKwota', naglowek: 'Wiersz 1 – zaliczki (etat)', klucz: 'etatKwota' },
  { kod: 'art41', naglowek: 'Wiersz 3 – art. 41 (zlecenia, art. 13)', klucz: 'art41' },
  { kod: 'inne', naglowek: 'Wiersz 4 – inne', klucz: 'inne' },
] as const;

type KodPit4R = (typeof WIERSZE_PIT4R)[number]['kod'];

const NAGL_4R_NIP = 'NIP wspólnoty';
const NAGL_4R_WSP = 'Wspólnota';
const NAGL_4R_ROK = 'Rok';
const NAGL_4R_WIERSZ = 'Wiersz';
const NAGL_4R_KOD = 'Kod wiersza';
const NAGL_4R_RAZEM = 'Razem';
const NAGL_4R_KONTROLA = 'Suma z PIT-11 (kontrola)';
const NAGL_4R_ROZNICA = 'Różnica (PIT-4R − PIT-11)';

const K4_NIP = 1;
const K4_WSP = 2;
const K4_ROK = 3;
const K4_WIERSZ = 4;
const K4_KOD = 5;
const K4_MIES = 6; // January; December = 17
const K4_RAZEM = K4_MIES + 12; // 18
const K4_KONTROLA = K4_RAZEM + 1;
const K4_ROZNICA = K4_KONTROLA + 1;

const ARKUSZ_KWOTY = 'Kwoty';
const ARKUSZ_PIT4R = 'PIT-4R';
const ARKUSZ_INSTRUKCJA = 'Instrukcja';

/** Stored in the workbook's "subject" so a file made for another year is recognised. */
const ZNACZNIK_ROKU = 'PIT rok ';

/* ================================== Helpers ================================== */

const NUM_KWOTA = '#,##0.00';
const NUM_ZLOTE = '0';

const KOLOR = {
  naglowek: 'FF1F3A5F',
  naglowekTekst: 'FFFFFFFF',
  grupaWpisz: 'FF2E7D32',
  grupaPoprz: 'FF757575',
  wpis: 'FFFFFBE6',
  szary: 'FFD9D9D9',
  poprz: 'FFF2F2F2',
  szaryTekst: 'FF808080',
  ramka: 'FFBFBFBF',
};

const ramka = (): Partial<ExcelJS.Borders> => {
  const k = { style: 'thin' as const, color: { argb: KOLOR.ramka } };
  return { top: k, left: k, bottom: k, right: k };
};

const wypelnienie = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/** For matching headings and names: no diacritics, no case, one kind of dash, single spaces. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[–—−]/g, '-')
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .trim();
}

const tylkoCyfry = (s: string): string => s.replace(/\D/g, '');

/** A cell's content as a primitive; formulas give their cached result, rich text its plain text. */
function wartoscKomorki(cell: ExcelJS.Cell): string | number | boolean | Date | null {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if (o.error !== undefined) return String(o.error);
    if (o.result !== undefined) {
      const r = o.result;
      if (typeof r === 'string' || typeof r === 'number' || typeof r === 'boolean' || r instanceof Date) return r;
      return null;
    }
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('');
    if (typeof o.text === 'string') return o.text;
  }
  return null;
}

function tekstKomorki(cell: ExcelJS.Cell): string {
  const v = wartoscKomorki(cell);
  if (v === null) return '';
  if (v instanceof Date) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/[\s ]+/g, ' ').trim();
}

type Odczyt = { rodzaj: 'puste' } | { rodzaj: 'blad'; powod: string } | { rodzaj: 'liczba'; wartosc: number };

/** "1 234,50", "1.234,50", "12,5 zł", 1234.5 → number; anything else → a reason. */
function odczytajLiczbe(cell: ExcelJS.Cell): Odczyt {
  const v = wartoscKomorki(cell);
  if (v === null) return { rodzaj: 'puste' };
  if (typeof v === 'number') return Number.isFinite(v) ? { rodzaj: 'liczba', wartosc: v } : { rodzaj: 'blad', powod: 'to nie jest liczba' };
  if (typeof v === 'boolean') return { rodzaj: 'blad', powod: 'wartość logiczna zamiast liczby' };
  if (v instanceof Date) return { rodzaj: 'blad', powod: 'data zamiast liczby' };
  const surowy = v.replace(/[\s ]+/g, ' ').trim();
  if (surowy === '') return { rodzaj: 'puste' };
  // Drop spaces (thousands), a trailing currency, then settle which of "." / "," is the decimal one.
  let t = surowy.replace(/\s*(zł|pln)\s*$/i, '').replace(/[\s ]/g, '');
  const kropka = t.lastIndexOf('.');
  const przecinek = t.lastIndexOf(',');
  if (kropka >= 0 && przecinek >= 0) {
    const dziesietny = kropka > przecinek ? '.' : ',';
    const tysiace = dziesietny === '.' ? ',' : '.';
    t = t.split(tysiace).join('').replace(dziesietny, '.');
  } else if (przecinek >= 0) {
    t = t.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { rodzaj: 'blad', powod: `tekst zamiast liczby („${surowy.slice(0, 30)}”)` };
  const n = Number(t);
  return Number.isFinite(n) ? { rodzaj: 'liczba', wartosc: n } : { rodzaj: 'blad', powod: 'to nie jest liczba' };
}

const maGrosze = (n: number): boolean => Math.abs(n * 100 - Math.round(n * 100)) > 1e-6;
const jestCalkowita = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-9;

/** Empty or the same (to the grosz) = nothing to change. */
const innaWartosc = (obecna: number | null, nowa: number | null): boolean => {
  if (obecna === null || nowa === null) return obecna !== nowa;
  return Math.abs(obecna - nowa) > 0.004;
};

const nazwaWsp = (w: PodatekPit): string => w.dane.nazwa || `NIP ${w.nip}`;

/** Current typed value of one input, as the template pre-fills it. */
function wartoscPola(o: PitOsoba, id: PoleId): number | null {
  switch (id) {
    case 'zarzad.kwota':
      return o.zarzad?.kwota ?? null;
    case 'zlecenie.przychod':
      return o.zlecenie?.przychod ?? null;
    case 'zlecenie.koszty':
      return o.zlecenie?.koszty ?? null;
    case 'zlecenie.zaliczka':
      return o.zlecenie?.zaliczka ?? null;
    case 'etat.przychod':
      return o.etat?.przychod ?? null;
    case 'etat.koszty':
      return o.etat?.koszty ?? null;
    case 'etat.zaliczka':
      return o.etat?.zaliczka ?? null;
    case 'art13.przychod':
      return o.art13?.przychod ?? null;
    case 'art13.zaliczka':
      return o.art13?.zaliczka ?? null;
    case 'skladki':
      return o.skladki;
    case 'zdrowotna':
      return o.zdrowotna;
  }
}

/** The previous year's value for comparison: what was typed, and for the "by rule" inputs what the rule gave. */
function wartoscPoprzednia(o: PitOsoba, id: PoleId): number | null {
  const wpisana = wartoscPola(o, id);
  if (wpisana !== null) return wpisana;
  if (id === 'zlecenie.koszty' && o.zlecenie && o.zlecenie.przychod !== null) {
    return Math.min(o.zlecenie.przychod, kosztyZlecenia(o.zlecenie.przychod, o.kosztyPodwyzszone));
  }
  if (id === 'etat.koszty' && o.etat && o.etat.przychod !== null) {
    return Math.min(o.etat.przychod, kosztyEtatu(o.etat.przychod, o.kosztyPodwyzszone));
  }
  if (id === 'art13.zaliczka' && o.art13 && o.art13.przychod !== null) {
    return obliczOsobe(o).art13?.zaliczka ?? null;
  }
  return null;
}

const maTytul = (o: PitOsoba, t: PitTytul | null): boolean => t === null || o[t] !== null;

const plSort = (a: string, b: string): number => a.localeCompare(b, 'pl');

/* ================================== Template ================================== */

export async function zbudujSzablonPit(wiersze: PodatekPit[], rok: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Statement Converter';
  wb.created = new Date();
  wb.subject = `${ZNACZNIK_ROKU}${rok}`;
  wb.title = `PIT – kwoty za rok ${rok}`;

  const doRoku = wiersze
    .filter((w) => w.rok === rok)
    .sort((a, b) => plSort(nazwaWsp(a), nazwaWsp(b)) || a.nip.localeCompare(b.nip));

  zbudujArkuszKwot(wb, wiersze, doRoku, rok);
  zbudujArkuszPit4R(wb, wiersze, doRoku, rok);
  zbudujInstrukcje(wb, rok);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function zbudujArkuszKwot(wb: ExcelJS.Workbook, wszystkie: PodatekPit[], doRoku: PodatekPit[], rok: number): void {
  const ws = wb.addWorksheet(ARKUSZ_KWOTY, { properties: { tabColor: { argb: KOLOR.grupaWpisz } } });
  const ostatniaKol = KOL_POPRZ + POLA.length - 1;

  // Everything known about the previous year first, so the group heading can name the year.
  interface Wiersz {
    w: PodatekPit;
    o: PitOsoba;
    poprz: { rok: number; osoba: PitOsoba } | null;
  }
  const lista: Wiersz[] = [];
  for (const w of doRoku) {
    const osoby = [...w.dane.osoby].sort((a, b) => plSort(nazwaOsoby(a), nazwaOsoby(b)));
    for (const o of osoby) lista.push({ w, o, poprz: poprzedniaOsoba(wszystkie, w, o) });
  }
  const lataPoprz = [...new Set(lista.map((x) => x.poprz?.rok).filter((r): r is number => r !== undefined))];
  const etykietaPoprz = lataPoprz.length === 1 ? `Rok ${lataPoprz[0]}` : 'Poprzedni rok';

  // Row 1: group headings. Row 2: column headings.
  ws.mergeCells(1, KOL_NIP, 1, KOL_ID);
  ws.getCell(1, KOL_NIP).value = `PIT za rok ${rok} – osoby`;
  ws.mergeCells(1, KOL_POLA, 1, KOL_POLA + POLA.length - 1);
  ws.getCell(1, KOL_POLA).value = `Rok ${rok} – do wpisania (żółte pola)`;
  ws.mergeCells(1, KOL_POPRZ_ROK, 1, ostatniaKol);
  ws.getCell(1, KOL_POPRZ_ROK).value = `${etykietaPoprz} – tylko do porównania, nie jest wczytywany`;
  for (const [kol, argb] of [
    [KOL_NIP, KOLOR.naglowek],
    [KOL_POLA, KOLOR.grupaWpisz],
    [KOL_POPRZ_ROK, KOLOR.grupaPoprz],
  ] as const) {
    const c = ws.getCell(1, kol);
    c.fill = wypelnienie(argb);
    c.font = { bold: true, color: { argb: KOLOR.naglowekTekst }, size: 12 };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.getRow(1).height = 22;

  const naglowki: [number, string, number][] = [
    [KOL_NIP, NAGL_NIP, 14],
    [KOL_WSP, NAGL_WSP, 34],
    [KOL_OSOBA, NAGL_OSOBA, 28],
    [KOL_ID, NAGL_ID, 16],
  ];
  POLA.forEach((p, i) => naglowki.push([KOL_POLA + i, p.naglowek, p.szer]));
  naglowki.push([KOL_SPACER, '', 3], [KOL_POPRZ_ROK, NAGL_POPRZ_ROK, 11]);
  POLA.forEach((p, i) => naglowki.push([KOL_POPRZ + i, `${PREFIKS_POPRZ}${p.naglowek}`, p.szer]));
  for (const [kol, tekst, szer] of naglowki) {
    ws.getColumn(kol).width = szer;
    if (kol === KOL_SPACER) continue;
    const c = ws.getCell(2, kol);
    c.value = tekst;
    const poprz = kol >= KOL_POPRZ_ROK;
    c.fill = wypelnienie(poprz ? KOLOR.grupaPoprz : kol >= KOL_POLA ? KOLOR.grupaWpisz : KOLOR.naglowek);
    c.font = { bold: true, color: { argb: KOLOR.naglowekTekst } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = ramka();
    const pole = kol >= KOL_POLA && kol < KOL_SPACER ? POLA[kol - KOL_POLA] : kol >= KOL_POPRZ ? POLA[kol - KOL_POPRZ] : null;
    if (pole?.uwaga) c.note = pole.uwaga;
  }
  ws.getCell(2, KOL_ID).note = 'Nie zmieniaj ani nie usuwaj — po tej kolumnie aplikacja rozpoznaje osobę.';
  ws.getRow(2).height = 36;

  let r = 3;
  for (const { w, o, poprz } of lista) {
    ws.getCell(r, KOL_NIP).value = w.nip;
    ws.getCell(r, KOL_NIP).numFmt = '@';
    ws.getCell(r, KOL_WSP).value = nazwaWsp(w);
    ws.getCell(r, KOL_OSOBA).value = nazwaOsoby(o);
    const id = ws.getCell(r, KOL_ID);
    id.value = o.klucz;
    id.font = { color: { argb: KOLOR.szaryTekst }, size: 9 };
    for (let k = KOL_NIP; k <= KOL_ID; k++) ws.getCell(r, k).border = ramka();

    POLA.forEach((p, i) => {
      const c = ws.getCell(r, KOL_POLA + i);
      c.border = ramka();
      c.numFmt = p.zlote ? NUM_ZLOTE : NUM_KWOTA;
      if (!maTytul(o, p.tytul)) {
        c.fill = wypelnienie(KOLOR.szary);
        return;
      }
      c.fill = wypelnienie(KOLOR.wpis);
      const wartosc = wartoscPola(o, p.id);
      if (wartosc !== null) c.value = wartosc;
      c.dataValidation = {
        type: p.zlote ? 'whole' : 'decimal',
        operator: 'greaterThanOrEqual',
        formulae: [0],
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'Kwota',
        error: p.zlote ? 'Zaliczka to pełne złote, nie mniej niż 0.' : 'Kwota nie może być ujemna.',
      };
    });

    ws.getCell(r, KOL_POPRZ_ROK).value = poprz ? poprz.rok : null;
    ws.getCell(r, KOL_POPRZ_ROK).alignment = { horizontal: 'center' };
    ws.getCell(r, KOL_POPRZ_ROK).fill = wypelnienie(KOLOR.poprz);
    ws.getCell(r, KOL_POPRZ_ROK).font = { color: { argb: KOLOR.szaryTekst } };
    ws.getCell(r, KOL_POPRZ_ROK).border = ramka();
    POLA.forEach((p, i) => {
      const c = ws.getCell(r, KOL_POPRZ + i);
      c.fill = wypelnienie(KOLOR.poprz);
      c.font = { color: { argb: KOLOR.szaryTekst } };
      c.border = ramka();
      c.numFmt = p.zlote ? NUM_ZLOTE : NUM_KWOTA;
      const wartosc = poprz ? wartoscPoprzednia(poprz.osoba, p.id) : null;
      if (wartosc !== null) c.value = wartosc;
    });
    r += 1;
  }

  ws.views = [{ state: 'frozen', xSplit: KOL_OSOBA, ySplit: 2, activeCell: 'E3' }];
  ws.autoFilter = { from: { row: 2, column: KOL_NIP }, to: { row: Math.max(2, r - 1), column: ostatniaKol } };
}

/** Communities with a PIT-4R this year, or that had one before. */
function zbudujArkuszPit4R(wb: ExcelJS.Workbook, wszystkie: PodatekPit[], doRoku: PodatekPit[], rok: number): void {
  const ws = wb.addWorksheet(ARKUSZ_PIT4R, { properties: { tabColor: { argb: KOLOR.naglowek } } });
  const naglowki: [number, string, number][] = [
    [K4_NIP, NAGL_4R_NIP, 14],
    [K4_WSP, NAGL_4R_WSP, 34],
    [K4_ROK, NAGL_4R_ROK, 7],
    [K4_WIERSZ, NAGL_4R_WIERSZ, 34],
    [K4_KOD, NAGL_4R_KOD, 12],
  ];
  MIESIACE_SKROT.forEach((m, i) => naglowki.push([K4_MIES + i, m, 8]));
  naglowki.push([K4_RAZEM, NAGL_4R_RAZEM, 11], [K4_KONTROLA, NAGL_4R_KONTROLA, 16], [K4_ROZNICA, NAGL_4R_ROZNICA, 16]);
  for (const [kol, tekst, szer] of naglowki) {
    ws.getColumn(kol).width = szer;
    const c = ws.getCell(1, kol);
    c.value = tekst;
    const miesiac = kol >= K4_MIES && kol < K4_RAZEM;
    c.fill = wypelnienie(miesiac ? KOLOR.grupaWpisz : KOLOR.naglowek);
    c.font = { bold: true, color: { argb: KOLOR.naglowekTekst } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = ramka();
  }
  ws.getCell(1, K4_KOD).note = 'Nie zmieniaj — po tej kolumnie aplikacja rozpoznaje wiersz.';
  ws.getRow(1).height = 36;

  let r = 2;
  for (const w of doRoku) {
    const poprz = poprzedniePit4R(wszystkie, w);
    if (!w.dane.pit4r && !poprz) continue;
    const biezace = w.dane.pit4r;
    const sumy = sumyZaliczek(w.dane.osoby);
    for (const linia of WIERSZE_PIT4R) {
      zapiszWierszPit4R(ws, r, w, rok, linia, biezace ? biezace[linia.klucz] : null, false, sumy);
      r += 1;
    }
    if (poprz) {
      for (const linia of WIERSZE_PIT4R) {
        zapiszWierszPit4R(ws, r, w, poprz.rok, linia, poprz.pit4r[linia.klucz], true, sumy);
        r += 1;
      }
    }
  }

  ws.views = [{ state: 'frozen', xSplit: K4_KOD, ySplit: 1, activeCell: 'F2' }];
  ws.autoFilter = { from: { row: 1, column: K4_NIP }, to: { row: Math.max(1, r - 1), column: K4_ROZNICA } };
  if (r > 2) {
    ws.addConditionalFormatting({
      ref: `${kolLitera(K4_ROZNICA)}2:${kolLitera(K4_ROZNICA)}${r - 1}`,
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: [`AND(ISNUMBER($${kolLitera(K4_ROZNICA)}2),$${kolLitera(K4_ROZNICA)}2<>0)`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } }, font: { color: { argb: 'FF9C0006' } } },
        },
      ],
    });
  }
}

function kolLitera(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function zapiszWierszPit4R(
  ws: ExcelJS.Worksheet,
  r: number,
  w: PodatekPit,
  rok: number,
  linia: (typeof WIERSZE_PIT4R)[number],
  miesiace: PitMiesiace | null,
  poprzedni: boolean,
  sumy: { etat: number; art41: number },
): void {
  const szary = (c: ExcelJS.Cell) => {
    c.fill = wypelnienie(KOLOR.poprz);
    c.font = { color: { argb: KOLOR.szaryTekst } };
  };
  const stale: [number, string | number][] = [
    [K4_NIP, w.nip],
    [K4_WSP, nazwaWsp(w)],
    [K4_ROK, rok],
    [K4_WIERSZ, poprzedni ? `${linia.naglowek} (poprz.)` : linia.naglowek],
    [K4_KOD, linia.kod],
  ];
  for (const [kol, v] of stale) {
    const c = ws.getCell(r, kol);
    c.value = v;
    c.border = ramka();
    if (kol === K4_NIP) c.numFmt = '@';
    if (kol === K4_KOD || poprzedni) szary(c);
  }
  let razem = 0;
  for (let i = 0; i < 12; i++) {
    const c = ws.getCell(r, K4_MIES + i);
    c.border = ramka();
    c.numFmt = NUM_ZLOTE;
    const v = miesiace ? miesiace[i] : null;
    if (v !== null) {
      c.value = v;
      razem += v;
    }
    if (poprzedni) szary(c);
    else {
      c.fill = wypelnienie(KOLOR.wpis);
      c.dataValidation = {
        type: 'whole',
        operator: 'greaterThanOrEqual',
        formulae: [0],
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'PIT-4R',
        error: 'Pełne złote (lub liczba osób), nie mniej niż 0.',
      };
    }
  }
  const pierwsza = kolLitera(K4_MIES);
  const ostatnia = kolLitera(K4_MIES + 11);
  const cRazem = ws.getCell(r, K4_RAZEM);
  cRazem.value = linia.kod === 'etatLiczba' ? null : { formula: `SUM(${pierwsza}${r}:${ostatnia}${r})`, result: razem };
  cRazem.numFmt = NUM_ZLOTE;
  cRazem.font = { bold: true, color: poprzedni ? { argb: KOLOR.szaryTekst } : undefined };
  cRazem.border = ramka();
  if (poprzedni) szary(cRazem);

  const kontrola = ws.getCell(r, K4_KONTROLA);
  const roznica = ws.getCell(r, K4_ROZNICA);
  for (const c of [kontrola, roznica]) {
    c.border = ramka();
    c.numFmt = NUM_ZLOTE;
    c.fill = wypelnienie(KOLOR.poprz);
    c.font = { color: { argb: KOLOR.szaryTekst } };
  }
  if (!poprzedni && (linia.kod === 'etatKwota' || linia.kod === 'art41')) {
    const suma = linia.kod === 'etatKwota' ? sumy.etat : sumy.art41;
    kontrola.value = suma;
    roznica.value = { formula: `${kolLitera(K4_RAZEM)}${r}-${kolLitera(K4_KONTROLA)}${r}`, result: razem - suma };
  }
}

function zbudujInstrukcje(wb: ExcelJS.Workbook, rok: number): void {
  const ws = wb.addWorksheet(ARKUSZ_INSTRUKCJA);
  ws.getColumn(1).width = 130;
  const linie: [string, boolean][] = [
    [`PIT za rok ${rok} – arkusz do wpisania kwot`, true],
    ['', false],
    ['Jak wypełniać', true],
    ['1. Arkusz „Kwoty”: jeden wiersz to jedna osoba w jednej wspólnocie. Wpisuj tylko w żółte pola.', false],
    ['2. Szare pola w kolumnach tytułów, których osoba nie ma (np. „Zlecenie” u członka zarządu), są pomijane przy wczytaniu. Tytuły nadaje się w aplikacji, nie tutaj.', false],
    ['3. Kolumny „Poprz. – …” po prawej to dane z poprzedniego roku, tylko do porównania. Nie są wczytywane.', false],
    ['4. Kolumna „Identyfikator” (szary, drobny tekst) łączy wiersz z osobą w aplikacji. Nie zmieniaj jej i nie usuwaj wierszy w środku — wystarczy zostawić puste komórki.', false],
    ['5. Nowych osób ani nowych wspólnot nie dopisuje się w arkuszu — wiersze, których aplikacja nie rozpozna, zostaną pominięte i wypisane po wczytaniu.', false],
    ['', false],
    ['Co zostawić puste', true],
    ['• „Zlecenie – koszty” i „Etat – koszty”: puste = koszty według reguły (20% przychodu, nie więcej niż 3 000 zł w roku, 3 600 zł przy podwyższonych). Wpisz kwotę tylko wtedy, gdy koszty są inne.', false],
    ['• „Art. 13 – zaliczka”: puste = zaliczka wyliczona (12% dochodu, pełne złote). Wpisz kwotę tylko wtedy, gdy zaliczka była inna.', false],
    ['• Wyczyszczenie takiej komórki, gdy była wypełniona, przywraca regułę. Puste pole z kwotą (np. przychód) niczego nie kasuje — kwota w aplikacji zostaje.', false],
    ['', false],
    ['Zasady liczb', true],
    ['• Kwoty: do 2 miejsc po przecinku, bez wartości ujemnych. Można pisać z przecinkiem i spacją tysięcy („1 234,50”).', false],
    ['• Zaliczki (zlecenie, etat, art. 13) i wszystko w arkuszu „PIT-4R”: pełne złote, bez groszy.', false],
    ['• Komórka z tekstem zamiast liczby, kwotą ujemną albo z groszami w zaliczce jest pomijana i wypisana jako problem do poprawy.', false],
    ['', false],
    ['Arkusz „PIT-4R”', true],
    ['• Jeden wiersz to jedna linia PIT-4R wspólnoty, miesiące I–XII w kolumnach: liczba podatników i zaliczki z etatu (wiersz 1), zaliczki z art. 41 (wiersz 3), inne (wiersz 4).', false],
    ['• Pod bieżącym rokiem stoją szare wiersze z poprzedniego roku (do porównania, nie są wczytywane).', false],
    ['• „Suma z PIT-11 (kontrola)” to suma zaliczek z PIT-11 według stanu w aplikacji z chwili eksportu; „Różnica” podświetla się, gdy PIT-4R się z nimi nie zgadza. Kwoty z tego arkusza nie są wczytywane.', false],
    ['• Puste miesiące zostawiają dotychczasową wartość w aplikacji.', false],
  ];
  linie.forEach(([tekst, tytul], i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = tekst;
    c.alignment = { wrapText: true, vertical: 'top' };
    if (tytul) c.font = { bold: true, size: i === 0 ? 14 : 12 };
  });
}

/* ================================== Reading ================================== */

function znajdzArkusz(wb: ExcelJS.Workbook, nazwa: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((s) => fold(s.name) === fold(nazwa));
}

/** The first of the top rows that holds at least `min` of the wanted headings → their columns. */
function znajdzNaglowki(ws: ExcelJS.Worksheet, oczekiwane: string[], min: number): { wiersz: number; kolumny: Map<string, number> } | null {
  const wanted = new Set(oczekiwane.map(fold));
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const kolumny = new Map<string, number>();
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, kol) => {
      const f = fold(tekstKomorki(cell));
      if (wanted.has(f) && !kolumny.has(f)) kolumny.set(f, kol);
    });
    if (kolumny.size >= min) return { wiersz: r, kolumny };
  }
  return null;
}

export async function wczytajPit(buf: Buffer, wiersze: PodatekPit[], rok: number): Promise<PitExcelWynik> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error('Nie udało się otworzyć pliku — to nie jest prawidłowy skoroszyt Excela (.xlsx).');
  }
  const wynik: PitExcelWynik = {
    zmiany: [],
    ostrzezenia: [],
    pominiete: [],
    statystyki: { wierszeOsob: 0, dopasowaneOsoby: 0, osobyZeZmianami: 0, wspolnotyPit4rZeZmianami: 0 },
  };

  const wKwoty = znajdzArkusz(wb, ARKUSZ_KWOTY);
  const wPit4R = znajdzArkusz(wb, ARKUSZ_PIT4R);
  if (!wKwoty && !wPit4R) {
    throw new Error('W pliku nie ma arkuszy „Kwoty” ani „PIT-4R” — wczytaj szablon wyeksportowany z aplikacji.');
  }

  const znacznik = (wb.subject ?? '').trim();
  const mRok = /^PIT rok (\d{4})$/.exec(znacznik);
  if (mRok && Number(mRok[1]) !== rok) {
    wynik.ostrzezenia.push(`Plik jest szablonem na rok ${mRok[1]}, a wczytujesz go do roku ${rok}.`);
  }

  const zRoku = wiersze.filter((w) => w.rok === rok);
  const poNip = new Map<string, PodatekPit>();
  for (const w of zRoku) if (!poNip.has(w.nip)) poNip.set(w.nip, w);

  if (wKwoty) czytajKwoty(wKwoty, poNip, rok, wynik);
  if (wPit4R) czytajPit4R(wPit4R, poNip, rok, wynik);

  wynik.statystyki.osobyZeZmianami = wynik.zmiany.filter((z) => z.klucz !== null).length;
  wynik.statystyki.wspolnotyPit4rZeZmianami = wynik.zmiany.filter((z) => z.klucz === null).length;
  return wynik;
}

function czytajKwoty(ws: ExcelJS.Worksheet, poNip: Map<string, PodatekPit>, rok: number, wynik: PitExcelWynik): void {
  const pominiecie = (wiersz: number, powod: string) => wynik.pominiete.push({ arkusz: 'Kwoty', wiersz, powod });
  const naglowki = znajdzNaglowki(ws, [NAGL_NIP, NAGL_OSOBA, NAGL_ID, ...POLA.map((p) => p.naglowek)], 3);
  if (!naglowki) throw new Error('Arkusz „Kwoty” nie ma wiersza nagłówków szablonu — wczytaj plik wyeksportowany z aplikacji.');
  const kol = (n: string) => naglowki.kolumny.get(fold(n));
  const kNip = kol(NAGL_NIP);
  const kOsoba = kol(NAGL_OSOBA);
  const kId = kol(NAGL_ID);
  if (kNip === undefined) throw new Error('Arkusz „Kwoty” nie ma kolumny „NIP wspólnoty”.');
  if (kOsoba === undefined && kId === undefined) throw new Error('Arkusz „Kwoty” nie ma kolumny „Identyfikator” ani „Osoba (Nazwisko Imię)”.');
  const kolumnyPol = POLA.map((p) => ({ pole: p, kol: kol(p.naglowek) })).filter((x): x is { pole: PoleKwot; kol: number } => x.kol !== undefined);
  if (kolumnyPol.length === 0) throw new Error('Arkusz „Kwoty” nie ma żadnej kolumny z kwotami.');

  const widziane = new Set<string>();

  for (let r = naglowki.wiersz + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nipTekst = kNip !== undefined ? tekstKomorki(row.getCell(kNip)) : '';
    const idTekst = kId !== undefined ? tekstKomorki(row.getCell(kId)) : '';
    const osobaTekst = kOsoba !== undefined ? tekstKomorki(row.getCell(kOsoba)) : '';
    if (!nipTekst && !idTekst && !osobaTekst) continue;
    wynik.statystyki.wierszeOsob += 1;

    const nip = tylkoCyfry(nipTekst);
    const wiersz = nip ? poNip.get(nip) : undefined;
    if (!wiersz) {
      pominiecie(r, nip ? `Wspólnota o NIP ${nip} nie ma w aplikacji danych PIT za rok ${rok}.` : 'Brak NIP-u wspólnoty.');
      continue;
    }

    const trafienie = znajdzOsobe(wiersz, idTekst, osobaTekst);
    if (trafienie.rodzaj === 'brak') {
      pominiecie(r, `${nazwaWsp(wiersz)}: ${trafienie.powod}`);
      continue;
    }
    const osoba = trafienie.osoba;
    const unikat = `${wiersz.id}:${osoba.klucz}`;
    if (widziane.has(unikat)) {
      pominiecie(r, `${nazwaWsp(wiersz)}, ${nazwaOsoby(osoba)}: ta osoba występuje w arkuszu drugi raz — wczytano pierwszy wiersz.`);
      continue;
    }
    widziane.add(unikat);
    wynik.statystyki.dopasowaneOsoby += 1;
    if (trafienie.rodzaj === 'nazwa') {
      wynik.ostrzezenia.push(`Wiersz ${r}: osobę „${nazwaOsoby(osoba)}” (${nazwaWsp(wiersz)}) dopasowano po nazwisku — brak identyfikatora.`);
    }

    const patch: PitOsobaPatch = {};
    const brakTytulu = new Set<PitTytul>();
    for (const { pole, kol: k } of kolumnyPol) {
      const cell = row.getCell(k);
      const opis = `komórka ${cell.address} (${pole.naglowek})`;
      if (!maTytul(osoba, pole.tytul)) {
        if (pole.tytul && !brakTytulu.has(pole.tytul) && tekstKomorki(cell) !== '') {
          brakTytulu.add(pole.tytul);
          pominiecie(r, `${nazwaOsoby(osoba)}: osoba nie ma tytułu „${pole.tytul}” w aplikacji — ${opis} pominięta (tytuły dodaje się w aplikacji).`);
        }
        continue;
      }
      const odczyt = odczytajLiczbe(cell);
      const obecna = wartoscPola(osoba, pole.id);
      if (odczyt.rodzaj === 'puste') {
        if (pole.regula && obecna !== null) wpiszPole(patch, pole.id, null);
        continue;
      }
      if (odczyt.rodzaj === 'blad') {
        pominiecie(r, `${nazwaOsoby(osoba)}: ${opis}: ${odczyt.powod}.`);
        continue;
      }
      const n = odczyt.wartosc;
      if (n < 0) {
        pominiecie(r, `${nazwaOsoby(osoba)}: ${opis}: kwota ujemna.`);
        continue;
      }
      if (maGrosze(n)) {
        pominiecie(r, `${nazwaOsoby(osoba)}: ${opis}: więcej niż 2 miejsca po przecinku.`);
        continue;
      }
      if (pole.zlote && !jestCalkowita(n)) {
        pominiecie(r, `${nazwaOsoby(osoba)}: ${opis}: zaliczka musi być w pełnych złotych (bez groszy).`);
        continue;
      }
      const wartosc = pole.zlote ? Math.round(n) : doGroszy(n);
      if (innaWartosc(obecna, wartosc)) wpiszPole(patch, pole.id, wartosc);
    }

    if (Object.keys(patch).length === 0) continue;
    wynik.zmiany.push({ wierszId: wiersz.id, klucz: osoba.klucz, pola: patch });
    ostrzezeniaOsoby(wiersz, osoba, patch, r, wynik);
  }
}

type Trafienie =
  | { rodzaj: 'klucz' | 'nazwa'; osoba: PitOsoba }
  | { rodzaj: 'brak'; powod: string };

/** By the identifier when the cell has one (key, or the PESEL-based key, or a bare PESEL); else by name. */
function znajdzOsobe(w: PodatekPit, id: string, nazwa: string): Trafienie {
  const osoby = w.dane.osoby;
  if (id) {
    const wprost = osoby.find((o) => o.klucz === id);
    if (wprost) return { rodzaj: 'klucz', osoba: wprost };
    const cyfry = tylkoCyfry(id);
    const inne = osoby.filter((o) => kluczOsoby(o) === id || (cyfry.length === 11 && o.pesel === cyfry) || (cyfry.length === 10 && !o.pesel && o.nip === cyfry));
    if (inne.length === 1) return { rodzaj: 'klucz', osoba: inne[0] };
    return {
      rodzaj: 'brak',
      powod: inne.length > 1 ? `identyfikator „${id}” pasuje do kilku osób.` : `identyfikator „${id}” nie pasuje do żadnej osoby tej wspólnoty.`,
    };
  }
  if (!nazwa) return { rodzaj: 'brak', powod: 'brak identyfikatora i nazwiska osoby.' };
  const f = fold(nazwa);
  const pasuje = osoby.filter((o) => fold(nazwaOsoby(o)) === f);
  if (pasuje.length === 1) return { rodzaj: 'nazwa', osoba: pasuje[0] };
  return { rodzaj: 'brak', powod: pasuje.length > 1 ? `nazwisko „${nazwa}” jest niejednoznaczne (kilka osób) — brak identyfikatora.` : `nie ma w tej wspólnocie osoby „${nazwa}”.` };
}

function wpiszPole(p: PitOsobaPatch, id: PoleId, v: number | null): void {
  switch (id) {
    case 'zarzad.kwota':
      p.zarzad = { ...p.zarzad, kwota: v };
      break;
    case 'zlecenie.przychod':
      p.zlecenie = { ...p.zlecenie, przychod: v };
      break;
    case 'zlecenie.koszty':
      p.zlecenie = { ...p.zlecenie, koszty: v };
      break;
    case 'zlecenie.zaliczka':
      p.zlecenie = { ...p.zlecenie, zaliczka: v };
      break;
    case 'etat.przychod':
      p.etat = { ...p.etat, przychod: v };
      break;
    case 'etat.koszty':
      p.etat = { ...p.etat, koszty: v };
      break;
    case 'etat.zaliczka':
      p.etat = { ...p.etat, zaliczka: v };
      break;
    case 'art13.przychod':
      p.art13 = { ...p.art13, przychod: v };
      break;
    case 'art13.zaliczka':
      p.art13 = { ...p.art13, zaliczka: v };
      break;
    case 'skladki':
      p.skladki = v;
      break;
    case 'zdrowotna':
      p.zdrowotna = v;
      break;
  }
}

/** Warnings about a person whose amounts are about to change: filed PIT-11, figures that cannot be right. */
function ostrzezeniaOsoby(w: PodatekPit, o: PitOsoba, patch: PitOsobaPatch, wiersz: number, wynik: PitExcelWynik): void {
  const kto = `${nazwaWsp(w)}, ${nazwaOsoby(o)}`;
  if (o.zlozone) {
    wynik.ostrzezenia.push(`${kto}: PIT-11 jest oznaczony jako złożony — zmiana kwot po złożeniu oznacza korektę.`);
  }
  const po = zastosujOsobe(o, patch);
  for (const t of ['zlecenie', 'etat'] as const) {
    const x = po[t];
    if (!x || x.przychod === null) continue;
    if (x.koszty !== null && x.koszty > x.przychod) wynik.ostrzezenia.push(`Wiersz ${wiersz}: ${kto}: koszty (${t}) większe od przychodu.`);
    if (x.zaliczka !== null && x.zaliczka > x.przychod) wynik.ostrzezenia.push(`Wiersz ${wiersz}: ${kto}: zaliczka (${t}) większa od przychodu.`);
  }
  if (po.art13 && po.art13.przychod !== null && po.art13.zaliczka !== null && po.art13.zaliczka > po.art13.przychod) {
    wynik.ostrzezenia.push(`Wiersz ${wiersz}: ${kto}: zaliczka (art. 13) większa od przychodu.`);
  }
}

function czytajPit4R(ws: ExcelJS.Worksheet, poNip: Map<string, PodatekPit>, rok: number, wynik: PitExcelWynik): void {
  const pominiecie = (wiersz: number, powod: string) => wynik.pominiete.push({ arkusz: 'PIT-4R', wiersz, powod });
  const naglowki = znajdzNaglowki(ws, [NAGL_4R_NIP, NAGL_4R_KOD, NAGL_4R_ROK, ...MIESIACE_SKROT], 4);
  if (!naglowki) {
    wynik.ostrzezenia.push('Arkusz „PIT-4R” nie ma wiersza nagłówków szablonu — pominięto go.');
    return;
  }
  const kol = (n: string) => naglowki.kolumny.get(fold(n));
  const kNip = kol(NAGL_4R_NIP);
  const kKod = kol(NAGL_4R_KOD);
  const kRok = kol(NAGL_4R_ROK);
  const kMies = MIESIACE_SKROT.map((m) => kol(m));
  if (kNip === undefined || kKod === undefined || kMies.every((k) => k === undefined)) {
    wynik.ostrzezenia.push('Arkusz „PIT-4R” nie ma kolumn „NIP wspólnoty”, „Kod wiersza” i miesięcy — pominięto go.');
    return;
  }

  const poprawneKody = new Set<string>(WIERSZE_PIT4R.map((l) => l.kod));
  const patche = new Map<number, PitPit4RPatch>();
  const widziane = new Set<string>();

  for (let r = naglowki.wiersz + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nipTekst = tekstKomorki(row.getCell(kNip));
    const kodTekst = tekstKomorki(row.getCell(kKod));
    if (!nipTekst && !kodTekst) continue;
    // Previous years' rows are context, not input.
    if (kRok !== undefined) {
      const rr = odczytajLiczbe(row.getCell(kRok));
      if (rr.rodzaj === 'liczba' && Math.round(rr.wartosc) !== rok) continue;
    }
    const kod = [...poprawneKody].find((k) => fold(k) === fold(kodTekst));
    if (!kod) {
      if (kodTekst) pominiecie(r, `Nieznany kod wiersza „${kodTekst}”.`);
      continue;
    }
    const nip = tylkoCyfry(nipTekst);
    const w = nip ? poNip.get(nip) : undefined;
    if (!w) {
      pominiecie(r, nip ? `Wspólnota o NIP ${nip} nie ma w aplikacji danych PIT za rok ${rok}.` : 'Brak NIP-u wspólnoty.');
      continue;
    }
    const unikat = `${w.id}:${kod}`;
    if (widziane.has(unikat)) {
      pominiecie(r, `${nazwaWsp(w)}: wiersz „${kod}” występuje drugi raz — wczytano pierwszy.`);
      continue;
    }
    widziane.add(unikat);

    const obecne = w.dane.pit4r ? w.dane.pit4r[kod as KodPit4R] : null;
    const zmiany: PitMiesiaceZmiany = {};
    kMies.forEach((k, i) => {
      if (k === undefined) return;
      const cell = row.getCell(k);
      const odczyt = odczytajLiczbe(cell);
      if (odczyt.rodzaj === 'puste') return;
      const opis = `komórka ${cell.address} (${MIESIACE_SKROT[i]}, ${nazwaWsp(w)}, ${kod})`;
      if (odczyt.rodzaj === 'blad') {
        pominiecie(r, `${opis}: ${odczyt.powod}.`);
        return;
      }
      const n = odczyt.wartosc;
      if (n < 0) {
        pominiecie(r, `${opis}: wartość ujemna.`);
        return;
      }
      if (!jestCalkowita(n)) {
        pominiecie(r, `${opis}: w PIT-4R tylko pełne złote (liczba podatników — liczba całkowita).`);
        return;
      }
      const wartosc = Math.round(n);
      if (innaWartosc(obecne ? obecne[i] : null, wartosc)) zmiany[i] = wartosc;
    });
    if (Object.keys(zmiany).length === 0) continue;
    const patch = patche.get(w.id) ?? {};
    patch[kod as KodPit4R] = zmiany;
    patche.set(w.id, patch);
  }

  for (const [wierszId, patch] of patche) {
    const w = [...poNip.values()].find((x) => x.id === wierszId)!;
    wynik.zmiany.push({ wierszId, klucz: null, pola: patch });
    if (!w.dane.pit4r) wynik.ostrzezenia.push(`${nazwaWsp(w)}: w aplikacji nie ma jeszcze PIT-4R za rok ${rok} — zostanie utworzony z kwot z arkusza.`);
    else if (w.dane.pit4r.zlozone) wynik.ostrzezenia.push(`${nazwaWsp(w)}: PIT-4R jest oznaczony jako złożony — zmiana kwot po złożeniu oznacza korektę.`);
  }
}

/* ================================== Applying ================================== */

function scal<T extends object>(baza: T, patch: Partial<T> | undefined): T {
  if (!patch) return baza;
  const out = { ...baza };
  for (const k of Object.keys(patch) as (keyof T)[]) if (patch[k] !== undefined) out[k] = patch[k] as T[keyof T];
  return out;
}

function zastosujOsobe(o: PitOsoba, p: PitOsobaPatch): PitOsoba {
  const out: PitOsoba = { ...o };
  // A title the person lacks is never created by a patch.
  if (o.zarzad && p.zarzad) out.zarzad = scal<PitZarzad>(o.zarzad, p.zarzad);
  if (o.zlecenie && p.zlecenie) out.zlecenie = scal(o.zlecenie, p.zlecenie);
  if (o.etat && p.etat) out.etat = scal(o.etat, p.etat);
  if (o.art13 && p.art13) out.art13 = scal(o.art13, p.art13);
  if (p.skladki !== undefined) out.skladki = p.skladki;
  if (p.zdrowotna !== undefined) out.zdrowotna = p.zdrowotna;
  return out;
}

function zastosujMiesiace(obecne: PitMiesiace, zmiany: PitMiesiaceZmiany | undefined): PitMiesiace {
  const out = [...obecne];
  if (zmiany) for (const [i, v] of Object.entries(zmiany)) if (Number(i) >= 0 && Number(i) < 12) out[Number(i)] = v;
  return out;
}

/**
 * Pure: the community's data with the patches applied. Pass the patches of ONE community row (the integrator
 * filters `zmiany` by `wierszId`). `przeglad`, `zlozone`, `pobrania` and every field outside the patches stay as
 * they were; a patch for a person or title the data does not have is ignored; a PIT-4R patch on a community
 * without a PIT-4R starts an empty one.
 */
export function zastosujZmianyPit(dane: PitDane, zmiany: PitZmiana[]): PitDane {
  return zastosujZmianyPitZOstrzezeniami(dane, zmiany).dane;
}

/** As `zastosujZmianyPit`, plus the warnings: changes applied to a PIT-11 / PIT-4R already marked as filed. */
export function zastosujZmianyPitZOstrzezeniami(dane: PitDane, zmiany: PitZmiana[]): { dane: PitDane; ostrzezenia: string[] } {
  const ostrzezenia: string[] = [];
  let osoby = dane.osoby;
  let pit4r = dane.pit4r;
  for (const z of zmiany) {
    if (z.klucz === null) {
      const baza: PitPit4R = pit4r ?? pustePit4R();
      if (baza.zlozone) ostrzezenia.push(`${dane.nazwa || 'Wspólnota'}: PIT-4R jest oznaczony jako złożony — zmiana kwot oznacza korektę.`);
      pit4r = {
        ...baza,
        etatLiczba: zastosujMiesiace(baza.etatLiczba, z.pola.etatLiczba),
        etatKwota: zastosujMiesiace(baza.etatKwota, z.pola.etatKwota),
        art41: zastosujMiesiace(baza.art41, z.pola.art41),
        inne: zastosujMiesiace(baza.inne, z.pola.inne),
      };
    } else {
      const klucz = z.klucz;
      const pola = z.pola;
      osoby = osoby.map((o) => {
        if (o.klucz !== klucz) return o;
        if (o.zlozone) ostrzezenia.push(`${dane.nazwa || 'Wspólnota'}, ${nazwaOsoby(o)}: PIT-11 jest oznaczony jako złożony — zmiana kwot oznacza korektę.`);
        return zastosujOsobe(o, pola);
      });
    }
  }
  return { dane: { ...dane, osoby, pit4r }, ostrzezenia };
}
