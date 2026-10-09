/**
 * Check of the PIT Excel exchange (src/main/podatki/pitExcel.ts) on invented data: the template is built,
 * filled in programmatically the way the accountant would (Polish commas, a negative, a text, greyed columns),
 * read back, and every behaviour is asserted.
 *
 *   npx tsx scripts/pit-excel-check.ts
 *
 * The workbooks are left in the output directory (argument 1, default: the system temp folder) for opening in Excel.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { PitDane, PitOsoba, PodatekPit, pustaOsoba, pustePit4R } from '../src/shared/podatki-pit';
import { zastosujZmianyPit, zastosujZmianyPitZOstrzezeniami, wczytajPit, zbudujSzablonPit, PitZmiana } from '../src/main/podatki/pitExcel';

const OUT_DIR = process.argv[2] ?? path.join(os.tmpdir(), 'pit-excel-check');
const ROK = 2025;

let failures = 0;
function check(nazwa: string, ok: boolean, szczegoly?: unknown): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nazwa}${!ok && szczegoly !== undefined ? `\n        ${JSON.stringify(szczegoly)}` : ''}`);
}

/* ------------------------------- Invented data ------------------------------- */

function osoba(klucz: string, nazwisko: string, imie: string, pesel: string, tytuly: Partial<PitOsoba>): PitOsoba {
  return { ...pustaOsoba(), klucz, nazwisko, imie, pesel, dataUrodzenia: '1970-01-01', ...tytuly };
}

function wiersz(id: number, nip: string, rok: number, nazwa: string, osoby: PitOsoba[], pit4r: PitDane['pit4r'] = null): PodatekPit {
  return {
    id,
    nip,
    rok,
    dane: { nazwa, urzadPlatnika: '1433', osoby, pit4r },
    createdAt: '2026-01-01',
    createdBy: 'test',
    updatedAt: '2026-01-01',
    updatedBy: 'test',
  };
}

const m = (...v: (number | null)[]) => [...v, ...Array.from({ length: 12 - v.length }, () => null)];

const NOWAK_PESEL = '70010100001';

function dane(): PodatekPit[] {
  // Alfa: board member, caretaker with mandate + contributions, art. 13 person; PIT-4R this year and last.
  const alfa24 = wiersz(
    10,
    '1111111111',
    2024,
    'WM ALFA',
    [
      osoba('a-kow', 'Kowalska', 'Anna', '60010100002', { zarzad: { opis: 'ZARZĄD', kwota: 6000 } }),
      osoba('a-now', 'Nowak', 'Piotr', NOWAK_PESEL, {
        zlecenie: { przychod: 12000, koszty: null, zaliczka: 900 },
        skladki: 1500.5,
        zdrowotna: 700.25,
      }),
      osoba('a-wis', 'Wiśniewska', 'Ewa', '65010100003', { art13: { przychod: 20000, zaliczka: null } }),
    ],
    { ...pustePit4R(), etatLiczba: m(1, 1), etatKwota: m(100, 100), art41: m(900, 900, 900, 900), inne: m() },
  );
  const alfa25 = wiersz(
    11,
    '1111111111',
    ROK,
    'WM ALFA',
    [
      osoba('a-kow', 'Kowalska', 'Anna', '60010100002', { zarzad: { opis: 'ZARZĄD', kwota: 6500 } }),
      osoba('a-now', 'Nowak', 'Piotr', NOWAK_PESEL, { zlecenie: { przychod: 13000, koszty: null, zaliczka: 1000 }, skladki: 1600, zdrowotna: null }),
      osoba('a-wis', 'Wiśniewska', 'Ewa', '65010100003', { art13: { przychod: 21000, zaliczka: 1000 } }),
    ],
    { ...pustePit4R(), etatLiczba: m(1), etatKwota: m(50), art41: m(1000, 1000, 1000), inne: m() },
  );
  // Beta: the same Nowak (another key, same PESEL), an employee; no PIT-4R anywhere.
  const beta25 = wiersz(12, '2222222222', ROK, 'WM BETA', [
    osoba('b-now', 'Nowak', 'Piotr', NOWAK_PESEL, { zlecenie: { przychod: 4000, koszty: 500, zaliczka: 100 } }),
    osoba('b-zie', 'Zieliński', 'Marek', '75010100004', { etat: { przychod: 30000, koszty: null, zaliczka: 2000 }, skladki: 4000 }),
  ]);
  // Gamma: a board-only person whose PIT-11 is already filed; PIT-4R only last year.
  const gamma24 = wiersz(13, '3333333333', 2024, 'WM GAMMA', [osoba('g-lis', 'Lis', 'Jan', '80010100005', { zarzad: { opis: 'ZARZĄD', kwota: 3000 } })], {
    ...pustePit4R(),
    etatLiczba: m(),
    etatKwota: m(),
    art41: m(10, 10),
    inne: m(),
  });
  const gamma25 = wiersz(14, '3333333333', ROK, 'WM GAMMA', [
    {
      ...osoba('g-lis', 'Lis', 'Jan', '80010100005', { zarzad: { opis: 'ZARZĄD', kwota: 3000 } }),
      zlozone: { at: '2026-02-01', by: 'test', numerRef: 'REF1' },
      przeglad: ['coś do przeglądu'],
    },
  ]);
  // Delta: only a past year — not in the template.
  const delta24 = wiersz(15, '4444444444', 2024, 'WM DELTA', [osoba('d-x', 'Xyz', 'Ola', '', { zarzad: { opis: 'ZARZĄD', kwota: 1 } })]);
  return [alfa24, alfa25, beta25, gamma24, gamma25, delta24];
}

/* ------------------------------ Workbook helpers ------------------------------ */

async function otworz(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

async function zapisz(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Row of the "Kwoty" sheet for a community name and person name. */
function znajdzWiersz(ws: ExcelJS.Worksheet, wsp: string, osobaTekst: string): number {
  for (let r = 3; r <= ws.rowCount; r++) {
    if (ws.getCell(r, 2).value === wsp && ws.getCell(r, 3).value === osobaTekst) return r;
  }
  throw new Error(`no row for ${wsp} / ${osobaTekst}`);
}

function kolumna(ws: ExcelJS.Worksheet, wiersz: number, naglowek: string, ostatnia = false): number {
  let found = -1;
  ws.getRow(wiersz).eachCell((c, k) => {
    if (c.value === naglowek && (ostatnia || found < 0)) found = k;
  });
  if (found < 0) throw new Error(`no column ${naglowek}`);
  return found;
}

const zmianaOsoby = (zmiany: PitZmiana[], wierszId: number, klucz: string) => zmiany.find((z) => z.wierszId === wierszId && z.klucz === klucz);
const zmianaPit4R = (zmiany: PitZmiana[], wierszId: number) => zmiany.find((z) => z.wierszId === wierszId && z.klucz === null);

/* ==================================== Main ==================================== */

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const wiersze = dane();
  const snapshot = JSON.stringify(wiersze);

  /* ---- 1. Template ---- */
  const szablon = await zbudujSzablonPit(wiersze, ROK);
  fs.writeFileSync(path.join(OUT_DIR, 'szablon-pit.xlsx'), szablon);
  check('template does not mutate the input rows', JSON.stringify(wiersze) === snapshot);

  const wb = await otworz(szablon);
  check('sheets are Kwoty, PIT-4R, Instrukcja', wb.worksheets.map((s) => s.name).join('|') === 'Kwoty|PIT-4R|Instrukcja', wb.worksheets.map((s) => s.name));
  const kw = wb.getWorksheet('Kwoty')!;
  const p4 = wb.getWorksheet('PIT-4R')!;

  // 3 (Alfa) + 2 (Beta) + 1 (Gamma) people of ROK; Delta (2024 only) absent.
  check('Kwoty has one row per community x person of the year (6)', kw.rowCount === 2 + 6, kw.rowCount);
  const kolejnosc = [3, 4, 5, 6, 7, 8].map((r) => `${kw.getCell(r, 2).value}/${kw.getCell(r, 3).value}`);
  check(
    'rows sorted by community name, then person',
    kolejnosc.join(',') === 'WM ALFA/Kowalska Anna,WM ALFA/Nowak Piotr,WM ALFA/Wiśniewska Ewa,WM BETA/Nowak Piotr,WM BETA/Zieliński Marek,WM GAMMA/Lis Jan',
    kolejnosc,
  );
  check('Delta (no row for the year) is not in the template', !kolejnosc.some((x) => x.includes('DELTA')));
  const rowNowakA = znajdzWiersz(kw, 'WM ALFA', 'Nowak Piotr');
  const kId = kolumna(kw, 2, 'Identyfikator');
  check('identifier column carries the person key', kw.getCell(rowNowakA, kId).value === 'a-now');
  check('identifier column is plain grey text', String((kw.getCell(rowNowakA, kId).font?.color as { argb?: string } | undefined)?.argb) === 'FF808080');
  check('group heading names the previous year (Rok 2024)', String(kw.getCell(1, 16 + 1).value).startsWith('Rok 2024'), kw.getCell(1, 17).value);
  check('freeze panes + autofilter set', kw.views[0]?.state === 'frozen' && !!kw.autoFilter);

  const kPrzych = kolumna(kw, 2, 'Zlecenie – przychód');
  const kPrzychPop = kolumna(kw, 2, 'Poprz. – Zlecenie – przychód');
  check('inputs are pre-filled with the year\'s current values', kw.getCell(rowNowakA, kPrzych).value === 13000);
  check('previous year values beside (via poprzedniaOsoba)', kw.getCell(rowNowakA, kPrzychPop).value === 12000);
  check('previous year of the data is in "rok danych"', kw.getCell(rowNowakA, kolumna(kw, 2, 'Poprz. – rok danych')).value === 2024);
  const kKoszty = kolumna(kw, 2, 'Zlecenie – koszty');
  const kKosztyPop = kolumna(kw, 2, 'Poprz. – Zlecenie – koszty');
  check('empty koszty stay empty; previous shows the rule (20% = 2400)', kw.getCell(rowNowakA, kKoszty).value == null && kw.getCell(rowNowakA, kKosztyPop).value === 2400, [
    kw.getCell(rowNowakA, kKoszty).value,
    kw.getCell(rowNowakA, kKosztyPop).value,
  ]);
  check('number formats: amounts #,##0.00, advances 0', kw.getCell(rowNowakA, kPrzych).numFmt === '#,##0.00' && kw.getCell(rowNowakA, kolumna(kw, 2, 'Zlecenie – zaliczka')).numFmt === '0');

  const rowLis = znajdzWiersz(kw, 'WM GAMMA', 'Lis Jan');
  const szary = (r: number, nagl: string) => (kw.getCell(r, kolumna(kw, 2, nagl)).fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb === 'FFD9D9D9';
  check('board-only person: Zlecenie/Etat/Art.13 columns greyed, Zarząd not', szary(rowLis, 'Zlecenie – przychód') && szary(rowLis, 'Etat – zaliczka') && szary(rowLis, 'Art. 13 – przychód') && !szary(rowLis, 'Zarząd – kwota roczna'));

  // PIT-4R sheet: Alfa (current + previous), Gamma (previous only); Beta has none.
  const nipy4 = new Set<string>();
  for (let r = 2; r <= p4.rowCount; r++) nipy4.add(String(p4.getCell(r, 1).value));
  check('PIT-4R sheet: Alfa and Gamma (had one), not Beta', nipy4.has('1111111111') && nipy4.has('3333333333') && !nipy4.has('2222222222'), [...nipy4]);
  check('PIT-4R sheet: 4 current + 4 previous rows per community = 16', p4.rowCount === 1 + 16, p4.rowCount);
  const f4 = (r: number) => p4.getCell(r, 18).value as { formula?: string };
  // Alfa's rows: 2 etatLiczba, 3 etatKwota, 4 art41 (Nowak 1000 + Wiśniewska 1000), 5 inne.
  check(
    'PIT-4R sheet: Razem is a formula; control column holds the PIT-11 sums (etat 0, art. 41 2000)',
    !!f4(4).formula && p4.getCell(3, 19).value === 0 && p4.getCell(4, 19).value === 2000 && p4.getCell(2, 19).value == null && !!(p4.getCell(4, 20).value as { formula?: string }).formula,
    [f4(4), p4.getCell(3, 19).value, p4.getCell(4, 19).value],
  );
  check('PIT-4R sheet: previous rows carry the previous year', p4.getCell(6, 3).value === 2024 && p4.getCell(2, 3).value === ROK);

  /* ---- 2. Round trip: nothing edited -> nothing to change ---- */
  const bezZmian = await wczytajPit(szablon, wiersze, ROK);
  check('round trip without edits: no changes', bezZmian.zmiany.length === 0, bezZmian.zmiany);
  check('round trip without edits: nothing skipped, no warnings', bezZmian.pominiete.length === 0 && bezZmian.ostrzezenia.length === 0, [bezZmian.pominiete, bezZmian.ostrzezenia]);
  check('round trip: every person matched', bezZmian.statystyki.dopasowaneOsoby === 6 && bezZmian.statystyki.wierszeOsob === 6, bezZmian.statystyki);

  /* ---- 3. The accountant fills it in ---- */
  const kwEd = (await otworz(szablon)).getWorksheet('Kwoty')!;
  const wbEd = kwEd.workbook;
  const p4Ed = wbEd.getWorksheet('PIT-4R')!;
  const R = (wsp: string, os: string) => znajdzWiersz(kwEd, wsp, os);
  const C = (nagl: string) => kolumna(kwEd, 2, nagl);

  // Kowalska: board amount typed as Polish text with a thousands space and a comma.
  kwEd.getCell(R('WM ALFA', 'Kowalska Anna'), C('Zarząd – kwota roczna')).value = '7 234,50';
  // Nowak (Alfa): przychód as number, zaliczka text with "zł", skladki, zdrowotna negative.
  kwEd.getCell(R('WM ALFA', 'Nowak Piotr'), C('Zlecenie – przychód')).value = 15000;
  kwEd.getCell(R('WM ALFA', 'Nowak Piotr'), C('Zlecenie – zaliczka')).value = '1 100 zł';
  kwEd.getCell(R('WM ALFA', 'Nowak Piotr'), C('Składki ZUS (poz. 95)')).value = 1700.75;
  kwEd.getCell(R('WM ALFA', 'Nowak Piotr'), C('Zdrowotna (poz. 122)')).value = -5;
  // Wiśniewska: clear the art. 13 advance (= by rule), new revenue.
  kwEd.getCell(R('WM ALFA', 'Wiśniewska Ewa'), C('Art. 13 – przychód')).value = '24.000,00';
  kwEd.getCell(R('WM ALFA', 'Wiśniewska Ewa'), C('Art. 13 – zaliczka')).value = null;
  // Nowak (Beta): text in a number cell; koszty explicit.
  kwEd.getCell(R('WM BETA', 'Nowak Piotr'), C('Zlecenie – przychód')).value = 'dużo';
  kwEd.getCell(R('WM BETA', 'Nowak Piotr'), C('Zlecenie – koszty')).value = 800;
  // Zieliński: koszty typed (3000), advance with grosze, art. 13 not his (greyed) but filled.
  kwEd.getCell(R('WM BETA', 'Zieliński Marek'), C('Etat – koszty')).value = 3000;
  kwEd.getCell(R('WM BETA', 'Zieliński Marek'), C('Etat – zaliczka')).value = 2100.5;
  kwEd.getCell(R('WM BETA', 'Zieliński Marek'), C('Zlecenie – przychód')).value = 777;
  kwEd.getCell(R('WM BETA', 'Zieliński Marek'), C('Zdrowotna (poz. 122)')).value = 1.234;
  // Lis (filed): changed board amount; greyed Etat typed in.
  kwEd.getCell(R('WM GAMMA', 'Lis Jan'), C('Zarząd – kwota roczna')).value = 3300;
  kwEd.getCell(R('WM GAMMA', 'Lis Jan'), C('Etat – przychód')).value = 999;
  // Editing the previous-year block must be ignored.
  kwEd.getCell(R('WM ALFA', 'Kowalska Anna'), C('Poprz. – Zarząd – kwota roczna')).value = 1;
  // Rows the app cannot match: a bad identifier and an unknown community.
  const wolny = kwEd.rowCount + 1;
  kwEd.getCell(wolny, 1).value = '1111111111';
  kwEd.getCell(wolny, 3).value = 'Obcy Ktoś';
  kwEd.getCell(wolny, 4).value = 'nie-ma-takiego';
  kwEd.getCell(wolny, C('Zarząd – kwota roczna')).value = 100;
  kwEd.getCell(wolny + 1, 1).value = '9999999999';
  kwEd.getCell(wolny + 1, 3).value = 'Ktoś Inny';
  kwEd.getCell(wolny + 1, 4).value = 'a-now';
  kwEd.getCell(wolny + 1, C('Zarząd – kwota roczna')).value = 5;

  // PIT-4R: Alfa March etat = 75 (current), liczba March text, art41 April with grosze, Razem/Kontrola/previous edited (ignored).
  const kod4 = (r: number) => String(p4Ed.getCell(r, 5).value);
  const wiersz4 = (nip: string, kod: string, rok: number) => {
    for (let r = 2; r <= p4Ed.rowCount; r++) {
      if (String(p4Ed.getCell(r, 1).value) === nip && kod4(r) === kod && p4Ed.getCell(r, 3).value === rok) return r;
    }
    throw new Error(`no pit4r row ${nip} ${kod} ${rok}`);
  };
  p4Ed.getCell(wiersz4('1111111111', 'etatKwota', ROK), 6 + 2).value = 75;
  p4Ed.getCell(wiersz4('1111111111', 'etatLiczba', ROK), 6 + 2).value = 'kilku';
  p4Ed.getCell(wiersz4('1111111111', 'art41', ROK), 6 + 3).value = 1234.5;
  p4Ed.getCell(wiersz4('1111111111', 'inne', ROK), 6 + 11).value = '20';
  p4Ed.getCell(wiersz4('1111111111', 'etatKwota', 2024), 6 + 5).value = 12345; // previous year row — ignored
  p4Ed.getCell(wiersz4('1111111111', 'art41', ROK), 19).value = 99999; // control column — ignored
  p4Ed.getCell(wiersz4('1111111111', 'art41', ROK), 6).value = -3;

  const edytowany = await zapisz(wbEd);
  fs.writeFileSync(path.join(OUT_DIR, 'szablon-pit-wypelniony.xlsx'), edytowany);
  const w = await wczytajPit(edytowany, wiersze, ROK);
  console.log(JSON.stringify({ zmiany: w.zmiany, pominiete: w.pominiete, ostrzezenia: w.ostrzezenia, statystyki: w.statystyki }, null, 1));

  const zKow = zmianaOsoby(w.zmiany, 11, 'a-kow');
  check('Polish comma + thousands space: "7 234,50" -> 7234.5', zKow?.klucz === 'a-kow' && (zKow.pola as { zarzad?: { kwota?: number } }).zarzad?.kwota === 7234.5, zKow);
  const zNowA = zmianaOsoby(w.zmiany, 11, 'a-now')?.pola as { zlecenie?: Record<string, unknown>; skladki?: number; zdrowotna?: number } | undefined;
  check('number cell, "1 100 zł" text, contributions -> patch', zNowA?.zlecenie?.przychod === 15000 && zNowA.zlecenie.zaliczka === 1100 && zNowA.skladki === 1700.75, zNowA);
  check('untouched empty koszty (null, by rule) -> not in the patch', !!zNowA && !('koszty' in (zNowA.zlecenie ?? {})));
  check('negative number skipped (zdrowotna)', !!zNowA && zNowA.zdrowotna === undefined && w.pominiete.some((p) => p.arkusz === 'Kwoty' && /ujemna/.test(p.powod) && /Zdrowotna/.test(p.powod)));
  const zWis = zmianaOsoby(w.zmiany, 11, 'a-wis')?.pola as { art13?: Record<string, unknown> } | undefined;
  check('art. 13: "24.000,00" -> 24000 and cleared advance -> null (by rule)', zWis?.art13?.przychod === 24000 && 'zaliczka' in (zWis.art13 ?? {}) && zWis.art13?.zaliczka === null, zWis);
  const zNowB = zmianaOsoby(w.zmiany, 12, 'b-now')?.pola as { zlecenie?: Record<string, unknown> } | undefined;
  check('text in a number cell skipped, rest of the row kept (koszty 800)', zNowB?.zlecenie?.koszty === 800 && zNowB.zlecenie.przychod === undefined && w.pominiete.some((p) => /tekst zamiast liczby/.test(p.powod)), zNowB);
  const zZie = zmianaOsoby(w.zmiany, 12, 'b-zie')?.pola as { etat?: Record<string, unknown>; zdrowotna?: number; zlecenie?: unknown } | undefined;
  check('typed koszty 3000 -> patch', zZie?.etat?.koszty === 3000, zZie);
  check('advance with grosze skipped', zZie?.etat?.zaliczka === undefined && w.pominiete.some((p) => /zaliczka musi być w pełnych złotych/.test(p.powod)));
  check('more than 2 decimals skipped', zZie?.zdrowotna === undefined && w.pominiete.some((p) => /więcej niż 2 miejsca/.test(p.powod)));
  check('title the person lacks: ignored and reported (Zlecenie of the employee)', zZie?.zlecenie === undefined && w.pominiete.some((p) => /nie ma tytułu „zlecenie”/.test(p.powod)));
  const zLis = zmianaOsoby(w.zmiany, 14, 'g-lis')?.pola as { zarzad?: { kwota?: number }; etat?: unknown } | undefined;
  check('board-only: Zarząd patched, greyed Etat ignored + reported', zLis?.zarzad?.kwota === 3300 && zLis.etat === undefined && w.pominiete.some((p) => /nie ma tytułu „etat”/.test(p.powod)), zLis);
  check('filed PIT-11: change reported as a warning, not blocked', w.ostrzezenia.some((o) => /Lis Jan.*złożony/.test(o)), w.ostrzezenia);
  check('previous-year block edits are ignored', zKow !== undefined && Object.keys(zKow.pola).join(',') === 'zarzad');
  check('unknown identifier -> skipped with a reason', w.pominiete.some((p) => /nie-ma-takiego/.test(p.powod)));
  check('unknown community NIP -> skipped with a reason', w.pominiete.some((p) => /9999999999/.test(p.powod)));
  check('no person or community is invented (every change targets an existing row/key)', w.zmiany.every((z) => wiersze.some((x) => x.id === z.wierszId && (z.klucz === null || x.dane.osoby.some((o) => o.klucz === z.klucz)))));
  check('person in two communities kept apart (NIP + key)', !!zmianaOsoby(w.zmiany, 11, 'a-now') && !!zmianaOsoby(w.zmiany, 12, 'b-now') && !zmianaOsoby(w.zmiany, 11, 'b-now'));

  const z4 = zmianaPit4R(w.zmiany, 11)?.pola as { etatKwota?: Record<number, number>; etatLiczba?: unknown; art41?: Record<number, number>; inne?: Record<number, number> } | undefined;
  check('PIT-4R: March etat 75 in the patch (month index 2)', z4?.etatKwota?.[2] === 75 && Object.keys(z4.etatKwota).length === 1, z4);
  check('PIT-4R: text in a month cell skipped', z4?.etatLiczba === undefined && w.pominiete.some((p) => p.arkusz === 'PIT-4R' && /tekst zamiast liczby/.test(p.powod)));
  check('PIT-4R: grosze and negative skipped', z4?.art41 === undefined && w.pominiete.filter((p) => p.arkusz === 'PIT-4R').some((p) => /pełne złote/.test(p.powod)) && w.pominiete.some((p) => p.arkusz === 'PIT-4R' && /ujemna/.test(p.powod)));
  check('PIT-4R: text number "20" in December of "inne" -> 20 (index 11)', z4?.inne?.[11] === 20, z4);
  check('PIT-4R: previous-year rows and control column ignored', z4?.etatKwota?.[5] === undefined && !('art41' in (z4 ?? {})));
  check('PIT-4R: Beta/Gamma without edits give no PIT-4R change', !zmianaPit4R(w.zmiany, 12) && !zmianaPit4R(w.zmiany, 14));

  /* ---- 4. Name fallback when the identifier column is gone / empty ---- */
  const wbNoId = await otworz(edytowany);
  const kwNoId = wbNoId.getWorksheet('Kwoty')!;
  for (let r = 3; r <= kwNoId.rowCount; r++) kwNoId.getCell(r, 4).value = null;
  kwNoId.getCell(2, 4).value = null; // the heading is gone as well
  const bezId = await wczytajPit(await zapisz(wbNoId), wiersze, ROK);
  const kowBezId = zmianaOsoby(bezId.zmiany, 11, 'a-kow');
  check('identifier column missing: matched by NIP + name', kowBezId !== undefined && zmianaOsoby(bezId.zmiany, 11, 'a-now') !== undefined && zmianaOsoby(bezId.zmiany, 12, 'b-now') !== undefined, bezId.zmiany.map((z) => z.klucz));
  check('name fallback is reported as a warning', bezId.ostrzezenia.some((o) => /dopasowano po nazwisku/.test(o)));
  check('missing identifier on a stray row -> skipped (no such name)', bezId.pominiete.some((p) => /Obcy Ktoś/.test(p.powod)));

  /* ---- 5. Applying ---- */
  const alfa = wiersze.find((x) => x.id === 11)!;
  const przed = JSON.stringify(alfa.dane);
  const zAlfa = w.zmiany.filter((z) => z.wierszId === alfa.id);
  const po = zastosujZmianyPit(alfa.dane, zAlfa);
  check('zastosujZmianyPit is pure (input untouched)', JSON.stringify(alfa.dane) === przed);
  const now = po.osoby.find((o) => o.klucz === 'a-now')!;
  check('applied: zlecenie przychód/zaliczka/skladki set, koszty still null', now.zlecenie?.przychod === 15000 && now.zlecenie.zaliczka === 1100 && now.zlecenie.koszty === null && now.skladki === 1700.75 && now.zdrowotna === null, now);
  const wis = po.osoby.find((o) => o.klucz === 'a-wis')!;
  check('applied: art13 przychód 24000, zaliczka null (rule)', wis.art13?.przychod === 24000 && wis.art13.zaliczka === null);
  check('applied: PIT-4R March etat 75, the rest untouched', po.pit4r?.etatKwota[2] === 75 && po.pit4r.etatKwota[0] === 50 && po.pit4r.art41[0] === 1000);
  check('applied: nazwa, urzad, other persons untouched', po.nazwa === alfa.dane.nazwa && po.osoby.length === 3 && po.osoby.find((o) => o.klucz === 'a-kow')!.zarzad?.opis === 'ZARZĄD');

  const gamma = wiersze.find((x) => x.id === 14)!;
  const zGamma = zastosujZmianyPitZOstrzezeniami(gamma.dane, w.zmiany.filter((z) => z.wierszId === gamma.id));
  const lis = zGamma.dane.osoby[0];
  check('applied to a filed person: zlozone and przeglad untouched, warning returned', lis.zarzad?.kwota === 3300 && lis.zlozone?.numerRef === 'REF1' && lis.przeglad.length === 1 && zGamma.ostrzezenia.length === 1, zGamma.ostrzezenia);
  check('applied: a patch never creates a title the person lacks', lis.etat === null);

  // A PIT-4R patch for a community without one starts an empty PIT-4R.
  const beta = wiersze.find((x) => x.id === 12)!;
  const nowyP4 = zastosujZmianyPit(beta.dane, [{ wierszId: 12, klucz: null, pola: { art41: { 0: 10 } } }]);
  check('PIT-4R patch on a community without one creates it', nowyP4.pit4r?.art41[0] === 10 && nowyP4.pit4r.art41[1] === null);

  /* ---- 6. Template made from the applied data reads back clean ---- */
  const poZmianach = wiersze.map((x) => {
    const mine = w.zmiany.filter((z) => z.wierszId === x.id);
    return mine.length ? { ...x, dane: zastosujZmianyPit(x.dane, mine) } : x;
  });
  const szablon2 = await zbudujSzablonPit(poZmianach, ROK);
  const drugi = await wczytajPit(szablon2, poZmianach, ROK);
  check('apply -> export -> read back: stable (no changes)', drugi.zmiany.length === 0, drugi.zmiany);
  // The cleared-by-rule cell stays empty after the round trip.
  const kw2 = (await otworz(szablon2)).getWorksheet('Kwoty')!;
  check('by-rule input stays empty in the new template', kw2.getCell(znajdzWiersz(kw2, 'WM ALFA', 'Wiśniewska Ewa'), kolumna(kw2, 2, 'Art. 13 – zaliczka')).value == null);

  /* ---- 7. Wrong year / not a template ---- */
  const innyRok = await wczytajPit(szablon, wiersze, ROK + 1);
  check('a template of another year is warned about', innyRok.ostrzezenia.some((o) => /szablonem na rok 2025/.test(o)));
  let blad = '';
  try {
    const pusty = new ExcelJS.Workbook();
    pusty.addWorksheet('Inny').getCell(1, 1).value = 'x';
    await wczytajPit(await zapisz(pusty), wiersze, ROK);
  } catch (e) {
    blad = (e as Error).message;
  }
  check('a workbook without the sheets is refused with a Polish message', /Kwoty/.test(blad), blad);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
