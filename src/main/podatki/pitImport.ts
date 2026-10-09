/**
 * Import of the office's e-Deklaracje files (PIT-11 (29) and PIT-4R (13)) into the PIT module's data.
 *
 * A folder holds the same filing in up to three shapes — a hand-made draft (BOM, spaces in the NIP, typos,
 * sometimes a wrong year or empty amounts), the cleaned `deklaracja (n).xml` it was turned into, and the signed
 * file the gateway returned (`PIT-11(29)_<yyyyMMddHHmmss>_<32 hex>.xml`, the 32 hex being the reference number,
 * the 14 digits the filing time in Warsaw time). The importer groups the files by community NIP and person, picks
 * the best source of every filing and maps it into `PitDane`.
 *
 * What is never fixed silently: a problem in the source (a wrong year, a bad PESEL, an amount with more than
 * two decimals, an unknown office, files of one filing that disagree, a person nobody can identify) goes into
 * the `przeglad` list of the person / PIT-4R, which blocks the filing until the accountant ticks it off. The
 * messages carry no names, PESELs or amounts — only kinds and positions — so they can be counted and logged.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { PIT11_URZEDY, PIT4R_URZEDY_DODATKOWE } from '../../shared/pit-urzedy';
import {
  OPIS_ZARZADU,
  PitDane,
  PitOsoba,
  PitPit4R,
  PitTytul,
  PitZlozone,
  URZAD_DOMYSLNY,
  kluczOsoby,
  kosztyEtatu,
  kosztyZlecenia,
  nipPoprawny,
  nowyKlucz,
  peselPoprawny,
  pustaOsoba,
  pusteMiesiace,
  pustePit4R,
  zaliczkaArt13,
} from '../../shared/podatki-pit';
import { czysc, doGroszy, doZlotych, tylkoCyfry } from '../../shared/podatki';

/* ================================== Result =================================== */

export interface PitImportWynik {
  /** One row per community: all its people and its PIT-4R. */
  wiersze: { nip: string; rok: number; dane: PitDane }[];
  /** XML files read (signed `.XAdES` copies and PDF / txt / htm are not counted). */
  plikow: number;
  /** Files that were not imported at all, with the reason. Duplicates are not listed — they are not lost. */
  pominiete: { plik: string; powod: string }[];
  /** Things about the folder as a whole (no personal data). */
  ostrzezenia: string[];
}

/* ================================ Tiny XML tree ============================== */

interface XNode {
  /** Local name, the namespace prefix cut off. */
  name: string;
  attrs: Record<string, string>;
  text: string;
  kids: XNode[];
}

const ENCJE: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const odkoduj = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const kod = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(kod) ? String.fromCodePoint(kod) : all;
    }
    return ENCJE[e.toLowerCase()] ?? all;
  });

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![A-Za-z][^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATRYBUT = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const lokalna = (n: string): string => n.replace(/^.*:/, '');

/** Throws on a file that is not well-formed — the caller reports it as unreadable. */
function parsujXml(zrodlo: string): XNode {
  const korzen: XNode = { name: '#root', attrs: {}, text: '', kids: [] };
  const stos: XNode[] = [korzen];
  let ostatni = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(zrodlo); m; m = TOKEN.exec(zrodlo)) {
    const biezacy = stos[stos.length - 1];
    biezacy.text += odkoduj(zrodlo.slice(ostatni, m.index));
    ostatni = TOKEN.lastIndex;
    if (m[1] !== undefined) {
      biezacy.text += m[1];
    } else if (m[2] !== undefined) {
      if (stos.length < 2 || lokalna(m[2]) !== biezacy.name) throw new Error('niezgodny znacznik zamykający');
      stos.pop();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      ATRYBUT.lastIndex = 0;
      for (let a = ATRYBUT.exec(m[4] ?? ''); a; a = ATRYBUT.exec(m[4] ?? '')) attrs[a[1]] = odkoduj(a[2] ?? a[3] ?? '');
      const wezel: XNode = { name: lokalna(m[3]), attrs, text: '', kids: [] };
      biezacy.kids.push(wezel);
      if (m[5] !== '/') stos.push(wezel);
    }
  }
  if (stos.length !== 1) throw new Error('niedomknięty znacznik');
  const wezlyGlowne = korzen.kids;
  if (wezlyGlowne.length !== 1) throw new Error('brak elementu głównego');
  return wezlyGlowne[0];
}

const dziecko = (n: XNode | undefined, ...sciezka: string[]): XNode | undefined => {
  let w = n;
  for (const nazwa of sciezka) {
    w = w?.kids.find((k) => k.name === nazwa);
    if (!w) return undefined;
  }
  return w;
};

/** Trimmed text of the element; undefined when the element is missing, '' when it is empty. */
const tekst = (n: XNode | undefined, ...sciezka: string[]): string | undefined => {
  const w = dziecko(n, ...sciezka);
  return w === undefined ? undefined : w.text.trim();
};

/* ================================== Helpers ================================== */

const TYTULY_KOLEJNOSC: PitTytul[] = ['zarzad', 'zlecenie', 'etat', 'art13'];
const TYTUL_KROTKO: Record<PitTytul, string> = { zarzad: 'zarząd', zlecenie: 'zlecenie', etat: 'etat', art13: 'art. 13' };

const GROSZ = 0.005;
const rowne = (a: number, b: number): boolean => Math.abs(a - b) < GROSZ;

/** "20250117110330" (Warsaw time) → "2025-01-17T09:03:30.000Z". */
export function czasBramkiNaUtc(czternascie: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(czternascie);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const lokalnyJakoUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const przesuniecie = (utc: number): number => {
    const czesci: Record<string, number> = {};
    for (const p of format.formatToParts(new Date(utc))) if (p.type !== 'literal') czesci[p.type] = Number(p.value);
    return Date.UTC(czesci.year, czesci.month - 1, czesci.day, czesci.hour, czesci.minute, czesci.second) - utc;
  };
  let utc = lokalnyJakoUtc - przesuniecie(lokalnyJakoUtc);
  utc = lokalnyJakoUtc - przesuniecie(utc);
  const wynik = new Date(utc);
  return Number.isNaN(wynik.getTime()) ? null : wynik.toISOString();
}

/**
 * An amount from a tag: null for a missing / empty tag (= nothing there). A value that cannot be read, is
 * negative, has more than two decimals (whole złoty for `calkowita`) is reported in `problemy` and rounded.
 */
function kwota(w: string | undefined, poz: number, problemy: string[], calkowita = false): number | null {
  if (w === undefined || w === '') return null;
  const czysta = w.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(czysta)) {
    problemy.push(`Pole poz. ${poz} ma nieczytelną wartość.`);
    return null;
  }
  const n = Number(czysta);
  if (n < 0) {
    problemy.push(`Pole poz. ${poz} ma wartość ujemną.`);
    return null;
  }
  if (calkowita) {
    if (Math.abs(n - Math.round(n)) > 1e-9) {
      problemy.push(`Pole poz. ${poz} (pełne złote) ma część ułamkową — zaokrąglono do złotych.`);
      return doZlotych(n);
    }
    return Math.round(n);
  }
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    problemy.push(`Kwota w poz. ${poz} ma więcej niż 2 miejsca po przecinku — zaokrąglono do groszy.`);
    return doGroszy(n);
  }
  return doGroszy(n);
}

const dodajUnikalnie = (cel: string[], ...wartosci: string[]): void => {
  for (const w of wartosci) if (!cel.includes(w)) cel.push(w);
};

/* ================================ Source records ============================= */

interface Zrodlo {
  /** Path relative to the import root. */
  plik: string;
  nazwaPliku: string;
  bramka: boolean;
  /** The 14 digits of the gateway file name ('' for other files). */
  znacznik: string;
  numerRef: string;
  rok: number;
  cel: 1 | 2;
  nipPlatnika: string;
  nazwaPlatnika: string;
  urzad: string;
}

interface KwotyTytulu {
  przychod: number | null;
  koszty: number | null;
  dochod: number | null;
  zaliczka: number | null;
}

interface Rekord11 extends Zrodlo {
  rodzaj: 'pit11';
  przyczyna: string;
  imie: string;
  nazwisko: string;
  dataUrodzenia: string | null;
  pesel: string;
  nip: string;
  nrId: string;
  rodzajNrId: number | null;
  krajWydania: string;
  adres: PitOsoba['adres'];
  zarzad: { opis: string; kwota: number | null } | null;
  zlecenie: KwotyTytulu | null;
  etat: KwotyTytulu | null;
  art13: KwotyTytulu | null;
  skladki: number | null;
  zdrowotna: number | null;
  /** Problems of the identity (PESEL, NIP, date, office). */
  problemyTozsamosci: string[];
  /** Problems of the amounts of one title. */
  problemyTytulu: Record<PitTytul, string[]>;
  /** Problems of the figures outside the titles (poz. 95, 122, fields the module does not know). */
  problemyWspolne: string[];
}

interface Rekord4R extends Zrodlo {
  rodzaj: 'pit4r';
  rodzajKorekty: 1 | 2;
  przyczyna: string;
  etatLiczba: (number | null)[];
  etatKwota: (number | null)[];
  art41: (number | null)[];
  inne: (number | null)[];
  pomniejszenie: (number | null)[];
  problemy: string[];
}

type Rekord = Rekord11 | Rekord4R;

/** Rank of a source inside one filing — the best is imported, the rest are duplicates. */
function ranga(r: Zrodlo, rok: number): number {
  if (r.rok !== rok) return 0;
  if (r.bramka) return r.cel === 2 ? 5 : 4;
  if (r.cel === 2) return 3;
  return /^deklaracja/i.test(r.nazwaPliku) ? 2 : 1;
}

function porownaj(rok: number): (a: Zrodlo, b: Zrodlo) => number {
  return (a, b) => ranga(b, rok) - ranga(a, rok) || b.znacznik.localeCompare(a.znacznik) || a.plik.localeCompare(b.plik);
}

const zlozone = (r: Zrodlo): PitZlozone | null => {
  if (!r.bramka) return null;
  const at = czasBramkiNaUtc(r.znacznik);
  return at ? { at, by: 'import', numerRef: r.numerRef } : null;
};

/* ================================== PIT-11 =================================== */

/** Positions of the PIT-11 (29) body the module understands (the rest, when not zero, is reported). */
const ZNANE_POZ_PIT11 = new Set<number>([11, 28, 29, 30, 31, 33, 54, 55, 56, 57, 58, 59, 60, 61, 95, 99, 100, 105, 121, 122]);

function czytajPit11(z: Zrodlo, korzen: XNode): Rekord11 {
  const problemyTozsamosci: string[] = [];
  const problemyWspolne: string[] = [];
  const problemyTytulu: Record<PitTytul, string[]> = { zarzad: [], zlecenie: [], etat: [], art13: [] };

  const osoba = dziecko(korzen, 'Podmiot2', 'OsobaFizyczna');
  const adres = dziecko(korzen, 'Podmiot2', 'AdresZamieszkania');
  const imie = czysc(tekst(osoba, 'ImiePierwsze')).toUpperCase();
  const nazwisko = czysc(tekst(osoba, 'Nazwisko')).toUpperCase();

  const pesel = tylkoCyfry(tekst(osoba, 'PESEL'));
  if (pesel && !peselPoprawny(pesel)) {
    problemyTozsamosci.push(
      pesel.length !== 11 ? `PESEL w pliku ma ${pesel.length} cyfr zamiast 11 — nieprawidłowy.` : 'PESEL w pliku ma błędną cyfrę kontrolną.',
    );
  }
  const nip = tylkoCyfry(tekst(osoba, 'NIP'));
  if (nip && !nipPoprawny(nip)) {
    problemyTozsamosci.push(
      nip.length === 11 && peselPoprawny(nip)
        ? 'NIP podatnika w pliku ma 11 cyfr — to chyba PESEL wpisany w pole NIP.'
        : 'NIP podatnika w pliku jest nieprawidłowy.',
    );
  }

  const nrId = czysc(tekst(osoba, 'NrId'));
  const rodzajSurowy = tekst(osoba, 'RodzajNrId');
  const rodzajNrId = rodzajSurowy && /^\d+$/.test(rodzajSurowy) ? Number(rodzajSurowy) : null;
  const krajWydania = czysc(tekst(osoba, 'KodKrajuWydania')).toUpperCase();
  const maObcy = nrId !== '' && rodzajNrId !== null && krajWydania !== '';
  if (!(pesel && peselPoprawny(pesel)) && !(nip && nipPoprawny(nip)) && !maObcy) {
    problemyTozsamosci.push('Brak PESEL-u, NIP-u i numeru zagranicznego — nie da się zidentyfikować podatnika.');
  }

  const dataSurowa = tekst(osoba, 'DataUrodzenia') ?? '';
  let dataUrodzenia: string | null = dataSurowa.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataUrodzenia)) {
    problemyTozsamosci.push(dataSurowa === '' ? 'Brak daty urodzenia w pliku.' : 'Data urodzenia w pliku ma zły format.');
    dataUrodzenia = null;
  }

  const kraj = czysc(tekst(adres, 'KodKraju')).toUpperCase();
  if (kraj && kraj !== 'PL') problemyTozsamosci.push('Adres podatnika jest poza Polską — moduł zakłada Polskę.');
  const adresOut = {
    wojewodztwo: czysc(tekst(adres, 'Wojewodztwo')),
    powiat: czysc(tekst(adres, 'Powiat')),
    ulica: czysc(tekst(adres, 'Ulica')),
    nrDomu: czysc(tekst(adres, 'NrDomu')),
    nrLokalu: czysc(tekst(adres, 'NrLokalu')),
    miejscowosc: czysc(tekst(adres, 'Miejscowosc')),
    kodPocztowy: czysc(tekst(adres, 'KodPocztowy')),
  };

  if (!(z.urzad in PIT11_URZEDY)) {
    problemyTozsamosci.push(z.urzad ? 'Kod urzędu skarbowego w pliku nie ma na liście MF.' : 'Brak kodu urzędu skarbowego w pliku.');
  }

  const poz = dziecko(korzen, 'PozycjeSzczegolowe');
  const t = (n: number): string | undefined => tekst(poz, `P_${n}`);

  const wiersz = (przychod: number, koszty: number, dochod: number, zaliczka: number, tytul: PitTytul, calkowitaZaliczka = true): KwotyTytulu | null => {
    const p = problemyTytulu[tytul];
    const k: KwotyTytulu = {
      przychod: kwota(t(przychod), przychod, p),
      koszty: kwota(t(koszty), koszty, p),
      dochod: kwota(t(dochod), dochod, p),
      zaliczka: kwota(t(zaliczka), zaliczka, p, calkowitaZaliczka),
    };
    return (t(przychod) ?? '') === '' ? null : k;
  };

  const kwotaZarzadu = kwota(t(100), 100, problemyTytulu.zarzad);
  const suma105 = kwota(t(105), 105, problemyTytulu.zarzad);
  let zarzad: Rekord11['zarzad'] = null;
  if ((t(100) ?? '') !== '') {
    zarzad = { opis: czysc(t(99)), kwota: kwotaZarzadu };
    if (suma105 !== null && kwotaZarzadu !== null && !rowne(suma105, kwotaZarzadu)) {
      problemyTytulu.zarzad.push('Suma części F (poz. 105) w pliku różni się od poz. 100.');
    }
  }
  const etat = wiersz(29, 30, 31, 33, 'etat');
  const art13 = wiersz(54, 55, 56, 57, 'art13');
  const zlecenie = wiersz(58, 59, 60, 61, 'zlecenie');
  const skladki = kwota(t(95), 95, problemyWspolne);
  const zdrowotna = kwota(t(122), 122, problemyWspolne);

  const nieznane: number[] = [];
  for (const k of poz?.kids ?? []) {
    const m = /^P_(\d+)$/.exec(k.name);
    if (!m || ZNANE_POZ_PIT11.has(Number(m[1]))) continue;
    const w = k.text.trim();
    if (w !== '' && !(/^-?\d+([.,]\d+)?$/.test(w) && Number(w.replace(',', '.')) === 0)) nieznane.push(Number(m[1]));
  }
  if (nieznane.length > 0) {
    problemyWspolne.push(`Plik wypełnia pola, których moduł nie obsługuje (poz. ${nieznane.sort((a, b) => a - b).join(', ')}).`);
  }

  const przyczyna = czysc(tekst(korzen, 'Zalaczniki', 'Zalacznik_ORD-ZU', 'PozycjeSzczegolowe', 'P_13'));
  return {
    ...z,
    rodzaj: 'pit11',
    przyczyna,
    imie,
    nazwisko,
    dataUrodzenia,
    pesel,
    nip,
    nrId,
    rodzajNrId,
    krajWydania,
    adres: adresOut,
    zarzad,
    zlecenie,
    etat,
    art13,
    skladki,
    zdrowotna,
    problemyTozsamosci,
    problemyTytulu,
    problemyWspolne,
  };
}

/* ================================== PIT-4R =================================== */

/** Positions of the PIT-4R (13) body the module understands (row 1, 3, 4, their sum and the derived rows). */
function znanePozPit4R(): Set<number> {
  const s = new Set<number>([7, 158]);
  const zakres = (od: number, doo: number) => {
    for (let i = od; i <= doo; i++) s.add(i);
  };
  zakres(10, 33);
  zakres(46, 81);
  zakres(122, 133);
  zakres(146, 157);
  zakres(159, 170);
  zakres(171, 182);
  return s;
}
const ZNANE_POZ_PIT4R = znanePozPit4R();

function czytajPit4R(z: Zrodlo, korzen: XNode): Rekord4R {
  const problemy: string[] = [];
  const poz = dziecko(korzen, 'PozycjeSzczegolowe');
  const t = (n: number): string | undefined => tekst(poz, `P_${n}`);
  const miesiace = (pierwsza: number, drugaPolowa?: number): (number | null)[] =>
    Array.from({ length: 12 }, (_, i) => {
      const n = drugaPolowa !== undefined && i >= 6 ? drugaPolowa + (i - 6) : pierwsza + i;
      return kwota(t(n), n, problemy, true);
    });
  const etatLiczba = miesiace(10, 22);
  const etatKwota = miesiace(16, 28);
  const art41 = miesiace(46);
  const inne = miesiace(58);
  const pomniejszenie = miesiace(159);

  const suma = miesiace(70);
  if (suma.some((v, i) => v !== null && v !== (etatKwota[i] ?? 0) + (art41[i] ?? 0) + (inne[i] ?? 0))) {
    problemy.push('Suma w wierszu 5 (poz. 70–81) w pliku różni się od wierszy 1, 3 i 4.');
  }
  const nieznane: number[] = [];
  for (const k of poz?.kids ?? []) {
    const m = /^P_(\d+)$/.exec(k.name);
    if (!m || ZNANE_POZ_PIT4R.has(Number(m[1]))) continue;
    const w = k.text.trim();
    if (w !== '' && !(/^-?\d+([.,]\d+)?$/.test(w) && Number(w.replace(',', '.')) === 0)) nieznane.push(Number(m[1]));
  }
  if (nieznane.length > 0) {
    problemy.push(`Plik wypełnia pola, których moduł nie obsługuje (poz. ${nieznane.sort((a, b) => a - b).join(', ')}).`);
  }
  if (!(z.urzad in PIT11_URZEDY) && !(z.urzad in PIT4R_URZEDY_DODATKOWE)) {
    problemy.push(z.urzad ? 'Kod urzędu skarbowego płatnika w pliku nie ma na liście MF.' : 'Brak kodu urzędu skarbowego płatnika w pliku.');
  }
  return {
    ...z,
    rodzaj: 'pit4r',
    rodzajKorekty: z.cel === 2 && t(7) === '2' ? 2 : 1,
    przyczyna: czysc(tekst(korzen, 'Zalaczniki', 'Zalacznik_ORD-ZU', 'PozycjeSzczegolowe', 'P_13')),
    etatLiczba,
    etatKwota,
    art41,
    inne,
    pomniejszenie,
    problemy,
  };
}

/* ================================== Discovery ================================ */

async function wszystkiePliki(korzen: string): Promise<string[]> {
  const wynik: string[] = [];
  const idz = async (dir: string): Promise<void> => {
    const wpisy = await fs.readdir(dir, { withFileTypes: true });
    for (const w of wpisy.sort((a, b) => a.name.localeCompare(b.name))) {
      if (w.name.startsWith('.')) continue;
      const pelna = path.join(dir, w.name);
      if (w.isDirectory()) await idz(pelna);
      else if (w.isFile()) wynik.push(pelna);
    }
  };
  await idz(korzen);
  return wynik;
}

const BRAMKA = /_(\d{14})_([0-9a-f]{32})\.xml$/i;

interface Wczytane {
  rekordy: Rekord[];
  pominiete: { plik: string; powod: string }[];
  /** Files whose community cannot be told (bad NIP) — kept apart to tell a duplicate from a lost filing. */
  odrzucone: { rekord: Rekord; powod: string }[];
  plikow: number;
  numeryZTxt: Set<string>;
}

async function wczytaj(folder: string): Promise<Wczytane> {
  const pliki = await wszystkiePliki(folder);
  const rekordy: Rekord[] = [];
  const pominiete: { plik: string; powod: string }[] = [];
  const odrzucone: Wczytane['odrzucone'] = [];
  const numeryZTxt = new Set<string>();
  let plikow = 0;

  for (const pelna of pliki) {
    const wzgledna = path.relative(folder, pelna);
    const nazwa = path.basename(pelna);
    if (/^numer-referencyjny.*\.txt$/i.test(nazwa)) {
      const m = /Numer referencyjny:\s*([0-9a-f]{32})/i.exec(await fs.readFile(pelna, 'utf8').catch(() => ''));
      if (m) numeryZTxt.add(m[1].toLowerCase());
      continue;
    }
    if (!/\.xml$/i.test(nazwa)) continue;
    plikow++;
    let korzen: XNode;
    try {
      korzen = parsujXml((await fs.readFile(pelna, 'utf8')).replace(/^\uFEFF/, ''));
    } catch (e) {
      pominiete.push({ plik: wzgledna, powod: `Nieczytelny XML (${e instanceof Error ? e.message : 'błąd'}).` });
      continue;
    }
    if (korzen.name !== 'Deklaracja') {
      pominiete.push({ plik: wzgledna, powod: 'To nie jest deklaracja.' });
      continue;
    }
    const kod = dziecko(korzen, 'Naglowek', 'KodFormularza')?.attrs.kodSystemowy ?? '';
    const rodzaj = /^PIT-11\b/i.test(kod) ? 'pit11' : /^PIT-4R\b/i.test(kod) ? 'pit4r' : null;
    if (!rodzaj) {
      pominiete.push({ plik: wzgledna, powod: 'To nie jest PIT-11 ani PIT-4R.' });
      continue;
    }
    const podmiot = dziecko(korzen, 'Podmiot1', 'OsobaNiefizyczna');
    const nipPlatnika = tylkoCyfry(tekst(podmiot, 'NIP'));
    const bramka = BRAMKA.exec(nazwa);
    const celSurowy = tekst(korzen, 'Naglowek', 'CelZlozenia');
    const rokPliku = Number(tekst(korzen, 'Naglowek', 'Rok'));
    const z: Zrodlo = {
      plik: wzgledna,
      nazwaPliku: nazwa,
      bramka: bramka !== null,
      znacznik: bramka?.[1] ?? '',
      numerRef: bramka?.[2].toLowerCase() ?? '',
      rok: Number.isInteger(rokPliku) ? rokPliku : 0,
      cel: celSurowy === '2' ? 2 : 1,
      nipPlatnika,
      nazwaPlatnika: czysc(tekst(podmiot, 'PelnaNazwa')).toUpperCase(),
      urzad: tylkoCyfry(tekst(korzen, 'Naglowek', 'KodUrzedu')).slice(0, 4),
    };
    const rekord = rodzaj === 'pit11' ? czytajPit11(z, korzen) : czytajPit4R(z, korzen);
    if (nipPlatnika.length !== 10) {
      // The community cannot be told: not imported, and not repaired by guessing from the name.
      odrzucone.push({
        rekord,
        powod: nipPlatnika ? `NIP płatnika w pliku ma ${nipPlatnika.length} cyfr zamiast 10 — wspólnoty nie da się ustalić.` : 'Brak NIP-u płatnika w pliku.',
      });
      continue;
    }
    rekordy.push(rekord);
  }
  return { rekordy, pominiete, odrzucone, plikow, numeryZTxt };
}

/* ================================= Person ==================================== */

/** The figures a title states, named, for comparing two sources of the same filing. */
const liczbyTytulu = (t: KwotyTytulu | { kwota: number | null } | null): [string, number | null][] =>
  !t
    ? []
    : 'kwota' in t
      ? [['kwota', t.kwota]]
      : [
          ['przychód', t.przychod],
          ['koszty', t.koszty],
          ['zaliczka', t.zaliczka],
        ];

/** Names of the figures the two sources state differently (compared only where both state them). */
function roznicaTytulu(a: KwotyTytulu | { kwota: number | null } | null, b: KwotyTytulu | { kwota: number | null } | null): string[] {
  const y = new Map(liczbyTytulu(b));
  return liczbyTytulu(a)
    .filter(([nazwa, v]) => v !== null && y.get(nazwa) != null && !rowne(v, y.get(nazwa) as number))
    .map(([nazwa]) => nazwa);
}

function podwyzszoneZPliku(r: Rekord11): boolean {
  const sprawdz = (w: KwotyTytulu | null, wzor: (p: number, pod: boolean) => number): boolean =>
    !!w &&
    w.przychod !== null &&
    w.koszty !== null &&
    rowne(w.koszty, wzor(w.przychod, true)) &&
    !rowne(w.koszty, wzor(w.przychod, false));
  return sprawdz(r.zlecenie, kosztyZlecenia) || sprawdz(r.etat, kosztyEtatu);
}

/** Known typos of the part F description that the office's drafts carry — only drafts are corrected, a filed text stays. */
const LITEROWKI_OPISU: [RegExp, string][] = [[/WYNAGRODZNIE/g, 'WYNAGRODZENIE']];

function zbudujOsobe(grupa: Rekord11[], rok: number): PitOsoba {
  const poprawneLata = grupa.filter((r) => r.rok === rok);
  const kandydaci = (poprawneLata.length > 0 ? poprawneLata : grupa).slice().sort(porownaj(rok));
  const p = kandydaci[0];
  const przeglad: string[] = [];
  const dodaj = (...m: string[]) => dodajUnikalnie(przeglad, ...m);

  if (p.rok !== rok) dodaj(`Plik źródłowy ma rok ${p.rok} zamiast ${rok} — sprawdź, czy to na pewno PIT za ${rok}.`);
  dodaj(...p.problemyTozsamosci);

  // Which source states which title: the best file that has it.
  const zrodloTytulu = new Map<PitTytul, Rekord11>();
  for (const t of TYTULY_KOLEJNOSC) if (p[t]) zrodloTytulu.set(t, p);
  for (const t of TYTULY_KOLEJNOSC) {
    if (zrodloTytulu.has(t)) continue;
    const inny = kandydaci.find((r) => r !== p && r[t]);
    if (!inny) continue;
    zrodloTytulu.set(t, inny);
    if (p.bramka || p.cel === 2) dodaj(`Tytuł „${TYTUL_KROTKO[t]}” pochodzi z innego pliku niż złożony PIT-11 — sprawdź, czy go wykazać.`);
  }
  if (p.cel === 1 && kandydaci.some((r) => r.cel === 2)) {
    dodaj('W plikach jest korekta (cel 2), której nie złożono przez bramkę — wzięto złożone zeznanie pierwotne; sprawdź.');
  }
  for (const [t, r] of zrodloTytulu) dodaj(...r.problemyTytulu[t]);
  dodaj(...p.problemyWspolne);

  // Duplicates of the same filing that disagree with the imported one.
  for (const o of kandydaci) {
    if (o === p || o.cel !== p.cel) continue;
    // A hand-made draft that differs from the filed file is just what the office corrected on the way —
    // only disagreements between files of equal standing are worth the accountant's eye.
    if (p.bramka && !o.bramka) continue;
    for (const t of TYTULY_KOLEJNOSC) {
      const a = t === 'zarzad' ? p.zarzad : p[t];
      const b = t === 'zarzad' ? o.zarzad : o[t];
      const rozne = roznicaTytulu(a, b);
      if (rozne.length > 0) {
        dodaj(`Pliki tej samej deklaracji różnią się kwotami (${TYTUL_KROTKO[t]}: ${rozne.join(', ')}) — wzięto ${p.bramka ? 'plik zwrócony przez bramkę' : 'plik o najwyższym priorytecie'}.`);
      }
    }
    if (p.skladki !== null && o.skladki !== null && !rowne(p.skladki, o.skladki)) dodaj('Pliki tej samej deklaracji różnią się składkami (poz. 95).');
    if (p.zdrowotna !== null && o.zdrowotna !== null && !rowne(p.zdrowotna, o.zdrowotna)) dodaj('Pliki tej samej deklaracji różnią się składką zdrowotną (poz. 122).');
    const pesele = new Set([p.pesel, o.pesel].filter((x) => x !== '' && peselPoprawny(x)));
    if (pesele.size > 1) dodaj('Pliki tej samej deklaracji mają różne numery PESEL.');
  }

  const kosztyPodwyzszone = [...zrodloTytulu.values()].some(podwyzszoneZPliku);

  const o = pustaOsoba();
  o.imie = p.imie;
  o.nazwisko = p.nazwisko;
  o.dataUrodzenia = p.dataUrodzenia;
  o.pesel = p.pesel;
  o.nip = p.nip;
  o.nrId = p.nrId;
  o.rodzajNrId = p.rodzajNrId;
  o.krajWydania = p.krajWydania;
  o.adres = { ...p.adres };
  o.urzad = p.urzad;
  o.kosztyPodwyzszone = kosztyPodwyzszone;
  o.cel = p.cel;
  o.przyczyna = p.przyczyna;
  o.skladki = p.skladki;
  o.zdrowotna = p.zdrowotna;
  o.zlozone = zlozone(p);

  const z = zrodloTytulu.get('zarzad')?.zarzad;
  if (z) {
    let opis = z.opis;
    if (opis === '') opis = OPIS_ZARZADU;
    else if (!zrodloTytulu.get('zarzad')?.bramka) for (const [re, zam] of LITEROWKI_OPISU) opis = opis.replace(re, zam);
    o.zarzad = { opis, kwota: z.kwota };
  }

  const koszty = (w: KwotyTytulu, wzor: (p: number, pod: boolean) => number): number | null =>
    w.koszty === null || w.przychod === null || rowne(w.koszty, wzor(w.przychod, kosztyPodwyzszone)) ? null : w.koszty;
  const dochodZgodny = (w: KwotyTytulu, wzor: (p: number, pod: boolean) => number, tytul: PitTytul, poz: number) => {
    if (w.przychod === null || w.dochod === null) return;
    const k = Math.min(w.przychod, w.koszty ?? wzor(w.przychod, kosztyPodwyzszone));
    if (!rowne(w.dochod, Math.max(0, doGroszy(w.przychod - k)))) dodaj(`Dochód w pliku (poz. ${poz}, ${TYTUL_KROTKO[tytul]}) nie zgadza się z przychodem pomniejszonym o koszty.`);
  };

  const zl = zrodloTytulu.get('zlecenie')?.zlecenie;
  if (zl) {
    o.zlecenie = { przychod: zl.przychod, koszty: koszty(zl, kosztyZlecenia), zaliczka: zl.zaliczka };
    dochodZgodny(zl, kosztyZlecenia, 'zlecenie', 60);
  }
  const et = zrodloTytulu.get('etat')?.etat;
  if (et) {
    o.etat = { przychod: et.przychod, koszty: koszty(et, kosztyEtatu), zaliczka: et.zaliczka };
    dochodZgodny(et, kosztyEtatu, 'etat', 31);
  }
  const a13 = zrodloTytulu.get('art13')?.art13;
  if (a13) {
    let zaliczka = a13.zaliczka;
    if (a13.przychod !== null) {
      const kosztyRegula = doGroszy(a13.przychod * 0.2);
      const dochodRegula = Math.max(0, doGroszy(a13.przychod - kosztyRegula));
      if (a13.koszty !== null && !rowne(a13.koszty, kosztyRegula)) dodaj('Art. 13: koszty w pliku (poz. 55) inne niż 20% przychodu — moduł liczy 20%.');
      if (a13.dochod !== null && !rowne(a13.dochod, dochodRegula)) dodaj('Art. 13: dochód w pliku (poz. 56) nie zgadza się z przychodem pomniejszonym o 20% kosztów.');
      if (zaliczka !== null && zaliczka === zaliczkaArt13(dochodRegula)) zaliczka = null;
    }
    o.art13 = { przychod: a13.przychod, zaliczka };
  }

  o.przeglad = przeglad;
  return o;
}

/* ================================= PIT-4R ==================================== */

const miesiaceZPliku = (m: (number | null)[]): (number | null)[] => {
  const out = pusteMiesiace();
  for (let i = 0; i < 12; i++) out[i] = m[i];
  return out;
};

function zbudujPit4R(rekordy: Rekord4R[], rok: number): PitPit4R {
  const poprawneLata = rekordy.filter((r) => r.rok === rok);
  const kandydaci = (poprawneLata.length > 0 ? poprawneLata : rekordy).slice().sort(porownaj(rok));
  const p = kandydaci[0];
  const przeglad: string[] = [];
  if (p.rok !== rok) dodajUnikalnie(przeglad, `Plik źródłowy ma rok ${p.rok} zamiast ${rok} — sprawdź, czy to na pewno PIT-4R za ${rok}.`);
  dodajUnikalnie(przeglad, ...p.problemy);
  const rowneMiesiace = (a: (number | null)[], b: (number | null)[]) => a.every((v, i) => (v ?? 0) === (b[i] ?? 0));
  for (const o of kandydaci) {
    if (o === p || o.cel !== p.cel) continue;
    if (
      !rowneMiesiace(p.etatLiczba, o.etatLiczba) ||
      !rowneMiesiace(p.etatKwota, o.etatKwota) ||
      !rowneMiesiace(p.art41, o.art41) ||
      !rowneMiesiace(p.inne, o.inne) ||
      !rowneMiesiace(p.pomniejszenie, o.pomniejszenie)
    ) {
      dodajUnikalnie(przeglad, `Pliki tego PIT-4R różnią się kwotami — wzięto ${p.bramka ? 'plik zwrócony przez bramkę' : 'plik o najwyższym priorytecie'}.`);
    }
  }
  return {
    ...pustePit4R(),
    cel: p.cel,
    rodzajKorekty: p.rodzajKorekty,
    przyczyna: p.przyczyna,
    etatLiczba: miesiaceZPliku(p.etatLiczba),
    etatKwota: miesiaceZPliku(p.etatKwota),
    art41: miesiaceZPliku(p.art41),
    inne: miesiaceZPliku(p.inne),
    pomniejszenie: miesiaceZPliku(p.pomniejszenie),
    zlozone: zlozone(p),
    przeglad,
  };
}

/* ================================= Grouping ================================== */

/** Keys that make two source files the same person (valid identifiers first, the name and birth date last). */
function kluczeOsoby(r: Rekord11): string[] {
  const out: string[] = [];
  if (r.pesel && peselPoprawny(r.pesel)) out.push(`p${r.pesel}`);
  if (r.nip && nipPoprawny(r.nip)) out.push(`n${r.nip}`);
  if (r.nrId && r.krajWydania) out.push(`f${r.krajWydania}|${r.nrId.replace(/\s/g, '').toUpperCase()}`);
  if (r.imie && r.nazwisko) out.push(kluczOsoby({ ...pustaOsoba(), imie: r.imie, nazwisko: r.nazwisko, dataUrodzenia: r.dataUrodzenia }));
  return out;
}

function grupujOsoby(rekordy: Rekord11[]): Rekord11[][] {
  const rodzic = rekordy.map((_, i) => i);
  const znajdz = (i: number): number => {
    while (rodzic[i] !== i) {
      rodzic[i] = rodzic[rodzic[i]];
      i = rodzic[i];
    }
    return i;
  };
  const wgKlucza = new Map<string, number>();
  rekordy.forEach((r, i) => {
    for (const k of kluczeOsoby(r)) {
      const j = wgKlucza.get(k);
      if (j === undefined) wgKlucza.set(k, i);
      else rodzic[znajdz(i)] = znajdz(j);
    }
  });
  const grupy = new Map<number, Rekord11[]>();
  rekordy.forEach((r, i) => {
    const g = znajdz(i);
    grupy.set(g, [...(grupy.get(g) ?? []), r]);
  });
  return [...grupy.values()];
}

/** The best spelling of the community's name: from a gateway file, spelled "WSPÓLNOTA …", the most frequent. */
function najlepszaNazwa(rekordy: Zrodlo[]): string {
  const punkty = new Map<string, number>();
  for (const r of rekordy) {
    if (!r.nazwaPlatnika) continue;
    const bonus = (r.bramka ? 1000 : 0) + (/^WSPÓLNOTA MIESZKANIOWA\b/.test(r.nazwaPlatnika) ? 100 : 0);
    punkty.set(r.nazwaPlatnika, (punkty.get(r.nazwaPlatnika) ?? 0) + 1 + bonus);
  }
  return [...punkty.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
}

/* ================================== Entry ==================================== */

export async function importujPitFolder(folder: string, rok: number): Promise<PitImportWynik> {
  const { rekordy, pominiete, odrzucone, plikow, numeryZTxt } = await wczytaj(folder);
  const ostrzezenia: string[] = [];

  const wgWspolnoty = new Map<string, Rekord[]>();
  for (const r of rekordy) wgWspolnoty.set(r.nipPlatnika, [...(wgWspolnoty.get(r.nipPlatnika) ?? []), r]);

  const wiersze: PitImportWynik['wiersze'] = [];
  for (const nip of [...wgWspolnoty.keys()].sort()) {
    const wszystkie = wgWspolnoty.get(nip) ?? [];
    if (!nipPoprawny(nip)) ostrzezenia.push(`NIP ${nip} w plikach wspólnoty ma nieprawidłową sumę kontrolną.`);
    const pit11 = wszystkie.filter((r): r is Rekord11 => r.rodzaj === 'pit11');
    const pit4r = wszystkie.filter((r): r is Rekord4R => r.rodzaj === 'pit4r');

    const osoby = grupujOsoby(pit11)
      .map((g) => zbudujOsobe(g, rok))
      .sort((a, b) => `${a.nazwisko} ${a.imie}`.localeCompare(`${b.nazwisko} ${b.imie}`, 'pl'));
    const uzyte = new Set<string>();
    for (const o of osoby) {
      let k = nowyKlucz();
      while (uzyte.has(k)) k = nowyKlucz();
      uzyte.add(k);
      o.klucz = k;
    }

    const czwartaR = pit4r.length > 0 ? zbudujPit4R(pit4r, rok) : null;
    const zwyciezca4R = pit4r.length > 0 ? pit4r.slice().sort(porownaj(rok))[0] : null;
    const dane: PitDane = {
      nazwa: najlepszaNazwa(wszystkie),
      urzadPlatnika: zwyciezca4R && zwyciezca4R.urzad ? zwyciezca4R.urzad : URZAD_DOMYSLNY,
      osoby,
      pit4r: czwartaR,
    };
    wiersze.push({ nip, rok, dane });
  }

  // Files of an unknown community: a duplicate of someone imported elsewhere, or a filing that would be lost.
  const znaneKlucze = new Set(rekordy.filter((r): r is Rekord11 => r.rodzaj === 'pit11').flatMap(kluczeOsoby));
  for (const { rekord, powod } of odrzucone) {
    const duplikat = rekord.rodzaj === 'pit11' && kluczeOsoby(rekord).some((k) => znaneKlucze.has(k));
    pominiete.push({
      plik: rekord.plik,
      powod: rekord.rodzaj === 'pit11' ? `${powod} ${duplikat ? 'Ta osoba jest już w innych plikach z poprawnym NIP-em (duplikat).' : 'Tej osoby nie ma w żadnym pliku z poprawnym NIP-em — PIT-11 do wprowadzenia ręcznie.'}` : powod,
    });
  }

  // Cross-checks that concern the folder, not one person.
  const bramkowe = rekordy.filter((r) => r.bramka);
  if (numeryZTxt.size > 0) {
    const bezTxt = bramkowe.filter((r) => !numeryZTxt.has(r.numerRef)).length;
    if (bezTxt > 0) ostrzezenia.push(`${bezTxt} plików z bramki nie ma pliku „numer-referencyjny” z tym numerem.`);
  }
  return { wiersze, plikow, pominiete, ostrzezenia };
}
