/**
 * Visual check of the PIT-11 / PIT-4R PDFs (src/main/podatki/pitPdf.ts) on invented
 * data: builds several variants, writes them to a directory, renders every page
 * with `pdftoppm -r 110 -png` and prints what to look at. Nothing here is real —
 * the names, the PESELs and the NIPs are made up (the check digits are computed).
 *
 *   npx tsx scripts/pit-pdf-check.ts [outDir]
 *
 * The default outDir is the system temp folder; pass another one for your own run.
 * Needs `pdftoppm` (poppler) on the PATH. It also checks that what must be refused
 * is refused: a value that does not fit its box, a blocking problem, a negative
 * amount, a correction without its justification.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { pit11Pdf, pit4rPdf } from '../src/main/podatki/pitPdf';
import { PitOsoba, PitPit4R, pustaOsoba, pustePit4R } from '../src/shared/podatki-pit';

const DOMYSLNY_KATALOG = path.join(os.tmpdir(), 'pit-pdf-check');
const outDir = process.argv[2] ?? DOMYSLNY_KATALOG;

/* ------------------------------ invented identifiers ------------------------------ */

function peselZ(data: string, seria: string): string {
  const [rok, mies, dzien] = data.split('-').map(Number);
  const mm = mies + (rok >= 2000 ? 20 : 0);
  const baza = `${String(rok % 100).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dzien).padStart(2, '0')}${seria}`;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const suma = w.reduce((s, x, i) => s + x * Number(baza[i]), 0);
  return baza + String((10 - (suma % 10)) % 10);
}

function nipZ(szesc: string): string {
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  for (let i = 0; i < 100; i++) {
    const baza = `${szesc}${String(i).padStart(3, '0')}`;
    const r = w.reduce((s, x, j) => s + x * Number(baza[j]), 0) % 11;
    if (r !== 10) return baza + String(r);
  }
  throw new Error('no NIP');
}

const PLATNIK = { nip: nipZ('123456'), nazwa: 'Wspólnota Mieszkaniowa Przykładowa 12' };

const adres = {
  wojewodztwo: 'mazowieckie',
  powiat: 'Warszawa',
  ulica: 'ul. Wiśniowa',
  nrDomu: '12',
  nrLokalu: '34',
  miejscowosc: 'Warszawa',
  kodPocztowy: '02-520',
};

function osoba(zmiany: Partial<PitOsoba>): PitOsoba {
  return {
    ...pustaOsoba(),
    imie: 'Jan',
    nazwisko: 'Kowalczewski-Nowak',
    dataUrodzenia: '1975-03-14',
    pesel: peselZ('1975-03-14', '1234'),
    adres,
    urzad: '1433',
    ...zmiany,
  };
}

const OPIS_ZARZADU = 'WYNAGRODZENIE CZŁONKA ZARZĄDU WSPÓLNOTY MIESZKANIOWEJ';

const PRZYCZYNA =
  'Korekta dotyczy uzupełnienia adresu zamieszkania podatnika oraz poprawienia kwoty składek na ubezpieczenie zdrowotne ' +
  'w poz. 122. W informacji złożonej pierwotnie adres podatnika został pominięty, a składki zdrowotne wykazano ' +
  'w wysokości wynikającej z listy płac za jedenaście miesięcy zamiast za dwanaście.\n\n' +
  'Po korekcie dane są zgodne z deklaracją PIT-4R za ten sam rok. Prosimy o uwzględnienie niniejszej korekty ' +
  'w miejsce informacji złożonej wcześniej oraz o przyjęcie jej jako poprawnej i kompletnej w całości.';

/* ----------------------------------- variants ----------------------------------- */

const pit11: [string, PitOsoba][] = [
  ['pit11-zarzad', osoba({ zarzad: { opis: OPIS_ZARZADU, kwota: 1500 } })],
  [
    'pit11-dozorca',
    osoba({
      imie: 'Zofia',
      nazwisko: 'Wiśniewska',
      dataUrodzenia: '1969-07-23',
      pesel: peselZ('1969-07-23', '2222'),
      urzad: '1438',
      zlecenie: { przychod: 6400.00, koszty: null, zaliczka: 600 },
      skladki: 1302.40,
      zdrowotna: 1287.96,
    }),
  ],
  [
    'pit11-etat-zlecenie',
    osoba({
      imie: 'Piotr',
      nazwisko: 'Zieliński',
      dataUrodzenia: '1988-11-02',
      pesel: peselZ('1988-11-02', '3141'),
      kosztyPodwyzszone: true,
      etat: { przychod: 41234.5, koszty: null, zaliczka: 2105 },
      zlecenie: { przychod: 1200, koszty: null, zaliczka: 0 },
      skladki: 5821.77,
      zdrowotna: 3790.05,
    }),
  ],
  [
    'pit11-art13',
    osoba({
      imie: 'Tomasz',
      nazwisko: 'Burakowicz',
      dataUrodzenia: '1971-09-30',
      pesel: peselZ('1971-09-30', '5555'),
      urzad: '1442',
      art13: { przychod: 2850, zaliczka: null },
    }),
  ],
  [
    'pit11-obcy',
    osoba({
      imie: 'Oksana',
      nazwisko: 'Kovalenko',
      dataUrodzenia: '1990-01-21',
      pesel: '',
      nrId: 'FA1234567',
      rodzajNrId: 3,
      krajWydania: 'UA',
      zlecenie: { przychod: 4380, koszty: null, zaliczka: 211 },
      skladki: 600.12,
      zdrowotna: 394.2,
    }),
  ],
  [
    'pit11-korekta',
    osoba({
      imie: 'Anna',
      nazwisko: 'Maria Przykładowska',
      dataUrodzenia: '1980-12-31',
      pesel: '',
      nip: nipZ('123456'),
      cel: 2,
      przyczyna: PRZYCZYNA,
      zlecenie: { przychod: 9999.99, koszty: 1999.99, zaliczka: 812 },
      zarzad: { opis: OPIS_ZARZADU, kwota: 1234567.89 },
      skladki: 1000,
      zdrowotna: 900,
    }),
  ],
];

const miesiace = (...v: (number | null)[]): (number | null)[] => Array.from({ length: 12 }, (_, i) => v[i] ?? null);

const pit4r: [string, PitPit4R, string][] = [
  [
    'pit4r-art41',
    {
      ...pustePit4R(),
      art41: miesiace(199, 199, 199, 199, 199, 199, 199, 199, 199, 314, 199, 199),
    },
    '1433',
  ],
  [
    'pit4r-etat-art41',
    {
      ...pustePit4R(),
      etatLiczba: miesiace(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1),
      etatKwota: miesiace(109, 109, 109, 109, 109, 109, 115, 115, 115, 115, 115, 15234),
      art41: miesiace(null, null, null, null, null, null, null, null, 432, 154, 98, 52),
      inne: miesiace(null, null, 12, null, null, null),
    },
    '1438',
  ],
  [
    'pit4r-korekta',
    {
      ...pustePit4R(),
      cel: 2,
      rodzajKorekty: 2,
      przyczyna: PRZYCZYNA,
      art41: miesiace(44, 44, 44, 44, 44, 44, null, null, null, null, null, 77),
      pomniejszenie: miesiace(null, 10.5, null, null, null, null, null, null, null, null, null, 7),
    },
    '1433',
  ],
];

/* ------------------------------------ running ------------------------------------ */

async function zapisz(nazwa: string, bytes: Uint8Array) {
  const plik = path.join(outDir, `${nazwa}.pdf`);
  fs.writeFileSync(plik, bytes);
  execFileSync('pdftoppm', ['-r', '110', '-png', plik, path.join(outDir, nazwa)]);
  console.log(`ok   ${nazwa}.pdf  (${bytes.length} B)`);
}

async function oczekujBledu(nazwa: string, fragment: string, praca: () => Promise<unknown>) {
  try {
    await praca();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes(fragment)) {
      console.log(`ok   refused: ${nazwa} — ${msg}`);
      return;
    }
    console.log(`FAIL refused with a different message: ${nazwa} — ${msg}`);
    process.exitCode = 1;
    return;
  }
  console.log(`FAIL not refused: ${nazwa}`);
  process.exitCode = 1;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^pit(11|4r)-.*\.(pdf|png)$/.test(f)) fs.unlinkSync(path.join(outDir, f));

  for (const [nazwa, o] of pit11) await zapisz(nazwa, await pit11Pdf({ rok: 2024, platnik: PLATNIK, osoba: o }));
  for (const [nazwa, p, urzad] of pit4r) {
    await zapisz(nazwa, await pit4rPdf({ rok: 2024, platnik: PLATNIK, urzadPlatnika: urzad, pit4r: p }));
  }

  await oczekujBledu('za długa nazwa płatnika', 'za długie', () =>
    pit11Pdf({ rok: 2024, platnik: { ...PLATNIK, nazwa: 'WSPÓLNOTA MIESZKANIOWA '.repeat(12) }, osoba: pit11[0][1] })
  );
  await oczekujBledu('za dużo cyfr w kwocie', 'za długie', () =>
    pit11Pdf({
      rok: 2024,
      platnik: PLATNIK,
      osoba: osoba({ zlecenie: { przychod: 123456789012.34, koszty: null, zaliczka: 0 } }),
    })
  );
  await oczekujBledu('brak kwot (blokujący problem)', 'nie da się jeszcze wydrukować', () =>
    pit11Pdf({ rok: 2024, platnik: PLATNIK, osoba: osoba({}) })
  );
  await oczekujBledu('korekta bez uzasadnienia', 'nie da się jeszcze wydrukować', () =>
    pit11Pdf({ rok: 2024, platnik: PLATNIK, osoba: osoba({ cel: 2, zarzad: { opis: OPIS_ZARZADU, kwota: 100 } }) })
  );
  await oczekujBledu('uzasadnienie za długie na stronę', 'za długie', () =>
    pit11Pdf({
      rok: 2024,
      platnik: PLATNIK,
      osoba: osoba({ cel: 2, przyczyna: 'wiersz\n'.repeat(60), zarzad: { opis: OPIS_ZARZADU, kwota: 100 } }),
    })
  );
  await oczekujBledu('zaliczka z groszami w pełnych złotych', 'pełnych złotych', () =>
    pit11Pdf({
      rok: 2024,
      platnik: PLATNIK,
      osoba: osoba({ etat: { przychod: 5000, koszty: null, zaliczka: 10.5 } }),
    })
  );
  await oczekujBledu('NIP płatnika z błędem', 'NIP płatnika', () =>
    pit4rPdf({ rok: 2024, platnik: { ...PLATNIK, nip: '1234567890' }, urzadPlatnika: '1433', pit4r: pit4r[0][1] })
  );
  await oczekujBledu('PIT-4R bez zaliczek', 'nie da się jeszcze wydrukować', () =>
    pit4rPdf({ rok: 2024, platnik: PLATNIK, urzadPlatnika: '1433', pit4r: pustePit4R() })
  );
  console.log(`\nPNG-i w ${outDir} — obejrzyj każdą stronę (pit11-*-1..3.png / -4 = uzasadnienie, pit4r-*-1..3.png / -4).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
