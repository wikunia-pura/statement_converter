/**
 * "Importuj z Excela" — the office's property-tax spreadsheet, one row per
 * community, read into DN-1 data.
 *
 * The sheet is laid out by the form: row 1 holds the DN-1 field numbers
 * ("1", "3", "6A", "40 - STAWKA PODATKU…", "99 - ZAOKRĄGLONE"), an empty
 * column, then the ZDN-1 block, whose numbers start over ("1", "3", "4") and
 * whose plot columns are "B.1.A" … "B.1.G". Columns are therefore matched by
 * the leading token of their heading, and the two blocks by position: the
 * first empty heading (or the first repeat of "1") ends the DN-1 block.
 *
 * Deliberately not read: the amounts (poz. 41, 97–111 — the app computes them),
 * the rate (poz. 40 / B.1.F — a year's rates live in their own table) and the
 * filling date (poz. 123 — in the source file it is a fill-down series, one
 * day later on every row, not a date anybody chose).
 */

import * as XLSX from 'xlsx';
import { GruntRodzaj, PodatekAdres, PodatekGrunt, PodatekNieruchomosciDane } from '../../shared/types';
import { FORMY_WLADANIA, czysc, pusteDane, pustyGrunt, tylkoCyfry } from '../../shared/podatki';
import { foldText } from '../../shared/plan-gospodarczy';

export interface PodatekZPliku {
  nip: string;
  rok: number;
  dane: PodatekNieruchomosciDane;
}

export interface PodatkiXlsx {
  rekordy: PodatekZPliku[];
  /** Rows without a NIP or a year. */
  pominiete: number;
}

/** "40 - STAWKA PODATKU…" → "40"; "6A" → "6A"; "B.1.c" → "B.1.C". */
function token(heading: unknown): string {
  const text = czysc(heading).toUpperCase();
  const m = /^(B\.\d\.[A-H]|\d{1,3}[A-Z]?)\b/.exec(text);
  return m ? m[1] : '';
}

/** A cell's value as text: numbers without a stray ".0", dates left alone. */
function tekst(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return '';
  if (typeof cell.v === 'number') return Number.isInteger(cell.v) ? String(cell.v) : String(cell.v).replace('.', ',');
  return czysc(cell.v);
}

function liczba(cell: XLSX.CellObject | undefined): number | null {
  if (!cell || cell.v == null || cell.v === '') return null;
  if (typeof cell.v === 'number') return Number.isFinite(cell.v) ? cell.v : null;
  const n = Number(String(cell.v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "POSIADANIE ZALEŻNE" → "posiadanie zależne"; anything else kept as typed. */
function formaWladania(value: string): string {
  const hit = FORMY_WLADANIA.find((f) => foldText(f) === foldText(value));
  return hit ?? value;
}

/** A precinct typed as a number lost its leading zero: 419 → "0419". */
function obreb(cell: XLSX.CellObject | undefined): string {
  if (cell && typeof cell.v === 'number' && Number.isInteger(cell.v) && cell.v < 10000) {
    return String(cell.v).padStart(4, '0');
  }
  return tekst(cell);
}

const ADRES_C2: Record<string, keyof PodatekAdres> = {
  '15': 'kraj', '16': 'wojewodztwo', '17': 'powiat', '18': 'gmina', '19': 'ulica',
  '20': 'nrDomu', '21': 'nrLokalu', '22': 'miejscowosc', '23': 'kodPocztowy',
};
const ADRES_C3: Record<string, keyof PodatekAdres> = {
  '24': 'kraj', '25': 'wojewodztwo', '26': 'powiat', '27': 'gmina', '28': 'ulica',
  '29': 'nrDomu', '30': 'nrLokalu', '31': 'miejscowosc', '32': 'kodPocztowy',
};
/** D.1 area columns — the kind of land a row's plot belongs to. */
const POWIERZCHNIA_D1: Record<string, GruntRodzaj> = {
  '33': 'dzialalnosc', '36': 'wody', '39': 'pozostale', '42': 'rewitalizacja',
};

export function parsePodatkiXlsx(buffer: Buffer): PodatkiXlsx {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws['!ref']) throw new Error('Plik nie ma arkusza z danymi.');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cellAt = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

  // Column → field token, per block.
  const dn1 = new Map<string, number>();
  const zdn1 = new Map<string, number>();
  let block: 'dn1' | 'zdn1' = 'dn1';
  for (let c = range.s.c; c <= range.e.c; c++) {
    const t = token(cellAt(range.s.r, c)?.v);
    if (block === 'dn1' && (t === '' ? dn1.size > 0 : dn1.has(t))) block = 'zdn1';
    if (!t) continue;
    const target = block === 'dn1' ? dn1 : zdn1;
    if (!target.has(t)) target.set(t, c);
  }
  if (!dn1.has('1') || !dn1.has('3')) {
    throw new Error('To nie wygląda na tabelę do DN-1: w pierwszym wierszu nie ma kolumn „1” (NIP) i „3” (rok).');
  }

  const byKey = new Map<string, PodatekZPliku>();
  let pominiete = 0;
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const pole = (t: string) => (dn1.has(t) ? cellAt(r, dn1.get(t)!) : undefined);
    const zal = (t: string) => (zdn1.has(t) ? cellAt(r, zdn1.get(t)!) : undefined);
    const nip = tylkoCyfry(tekst(pole('1')));
    const rok = Math.round(liczba(pole('3')) ?? 0);
    const anything = [...dn1.values()].some((c) => tekst(cellAt(r, c)) !== '');
    if (!anything) continue;
    if (!nip || rok < 2000 || rok > 2100) {
      pominiete += 1;
      continue;
    }

    const key = `${nip}|${rok}`;
    let rek = byKey.get(key);
    if (!rek) {
      const d = pusteDane();
      d.organ = tekst(pole('4'));
      d.cel = liczba(pole('5')) === 2 ? 2 : 1;
      const okres = Math.round(liczba(pole('6A') ?? pole('6')) ?? 1);
      d.okresOd = okres >= 1 && okres <= 12 ? okres : 1;
      d.rodzajPodmiotu = liczba(pole('7')) === 2 ? 2 : 1;
      const podatnik = liczba(pole('8'));
      d.rodzajPodatnika = podatnik === 1 || podatnik === 2 ? podatnik : 3;
      d.nazwaPelna = tekst(pole('9'));
      d.nazwaSkrocona = tekst(pole('10'));
      d.regon = tylkoCyfry(tekst(pole('11')));
      for (const [t, k] of Object.entries(ADRES_C2)) d.siedziba[k] = tekst(pole(t));
      for (const [t, k] of Object.entries(ADRES_C3)) d.doreczenia[k] = tekst(pole(t));
      const k98 = liczba(pole('98'));
      d.kwotaNieobjeta = d.cel === 2 && k98 !== null ? k98 : null;
      d.telefon = tekst(pole('114'));
      d.email = tekst(pole('115'));
      d.inne = tekst(pole('116'));
      d.reprezentant = { imie: tekst(pole('121')), nazwisko: tekst(pole('122')), dataWypelnienia: null };
      rek = { nip, rok, dane: d };
      byKey.set(key, rek);
    }

    // The plot of this row: the ZDN-1 block, its kind from the D.1 column that
    // holds an area (pozostałe when none does).
    const d1 = Object.entries(POWIERZCHNIA_D1).find(([t]) => liczba(pole(t)) !== null);
    const rodzaj: GruntRodzaj = d1 ? d1[1] : 'pozostale';
    const grunt: PodatekGrunt = {
      ...pustyGrunt(rodzaj),
      polozenie: tekst(zal('B.1.A')),
      ksiegaWieczysta: tekst(zal('B.1.B')),
      obreb: obreb(zal('B.1.C')),
      dzialka: tekst(zal('B.1.D')),
      powierzchnia: liczba(zal('B.1.E')) ?? (d1 ? liczba(pole(d1[0])) : null),
      formaWladania: formaWladania(tekst(zal('B.1.G'))),
    };
    const hasPlot =
      grunt.polozenie || grunt.ksiegaWieczysta || grunt.obreb || grunt.dzialka || grunt.powierzchnia !== null;
    if (hasPlot) rek.dane.grunty.push(grunt);
  }

  return { rekordy: [...byKey.values()], pominiete };
}
