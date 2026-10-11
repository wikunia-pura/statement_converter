/**
 * Generates CIT-8 (+ CIT-8/O) XML from invented returns and validates it against MF's schemas with xmllint
 * (scripts/cit-xsd). Run: `npx tsx scripts/cit-check.ts`. Exits non-zero when anything fails.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cit8Xml } from '../src/main/podatki/citXml';
import { defaultCitSlownik, obliczCIT8, pozycjeZeSprawozdania, pusteDaneCit } from '../src/shared/podatki-cit';
import { PodatekCitDane, Sprawozdanie } from '../src/shared/types';

const XSD = path.join(__dirname, 'cit-xsd/cit8/crd.gov.pl/wzor/2026/01/07/14112/schemat.xsd');
const slownik = defaultCitSlownik();

/** A vDom statement of the year with the given income and cost rows. */
function sprawozdanie(rok: number, przychody: [string, number][], koszty: [string, number][]): Sprawozdanie {
  const wiersz = (nazwa: string, kwoty: (number | null)[]) => ({ nazwa, kwoty, podsumowanie: false, wyroznienie: false });
  return {
    nrWsp: 1,
    nazwa: 'Wspólnota Mieszkaniowa Testowa 1',
    okresOd: `${rok}-01-01`,
    okresDo: `${rok}-12-31`,
    powierzchnia: null,
    powierzchniaCo: null,
    sredniaLiczbaOsob: null,
    wydruk: '',
    sekcje: [
      {
        tytul: '2. Koszty eksploatacji',
        kolumny: ['Przychód', 'Koszty'],
        kwotaNaglowka: null,
        wiersze: [...przychody.map(([n, k]) => wiersz(n, [k, null])), ...koszty.map(([n, k]) => wiersz(n, [null, k]))],
      },
    ],
  };
}

function zeznanie(rok: number, przychody: [string, number][], koszty: [string, number][], zmiany: Partial<PodatekCitDane> = {}): PodatekCitDane {
  return {
    ...pusteDaneCit(),
    nip: '1234563218',
    kodUrzedu: '1433',
    urzad: 'Urząd Skarbowy Warszawa-Mokotów',
    nazwaPelna: 'Wspólnota Mieszkaniowa „Testowa 1” & Co',
    siedziba: {
      kraj: 'POLSKA',
      wojewodztwo: 'mazowieckie',
      powiat: 'Warszawa',
      gmina: 'Warszawa',
      ulica: 'Testowa',
      nrDomu: '1',
      nrLokalu: '',
      miejscowosc: 'Warszawa',
      kodPocztowy: '00-001',
    },
    sprawozdanie: { zrodloId: null, dane: sprawozdanie(rok, przychody, koszty), plikNazwa: 'x.pdf', dodano: '', dodal: '' },
    reprezentant: { imie: 'Jan', nazwisko: 'Testowy', dataWypelnienia: null },
    ...zmiany,
  };
}

const przyklady: { nazwa: string; rok: number; dane: PodatekCitDane; cit8o: boolean }[] = [
  {
    nazwa: 'tylko zwolnione, koszty > zaliczki',
    rok: 2025,
    dane: zeznanie(2025, [['Zaliczka eksploatacyjna', 50000]], [['Sprzątanie', 61000.4]]),
    cit8o: false,
  },
  {
    nazwa: 'zwolniony dochód (CIT-8/O) + najem, 9%, zaliczki miesięczne',
    rok: 2025,
    dane: zeznanie(
      2025,
      [
        ['Zaliczka eksploatacyjna', 80000],
        ['Najem pomieszczenia', 12000],
      ],
      [['Sprzątanie', 30000.55]],
      { zaliczki: [0, 0, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120] },
    ),
    cit8o: true,
  },
  {
    nazwa: '19%, zaliczki kwartalne, korekta, nadpłata',
    rok: 2026,
    dane: zeznanie(2026, [['Reklama na elewacji', 20000]], [['Sprzątanie', 4000]], {
      stawka: 19,
      zaliczkiKwartalne: true,
      zaliczki: [null, null, 2000, null, null, 2000, null, null, 2000, null, null, 2000],
      cel: 2,
      rodzajKorekty: 1,
    }),
    cit8o: false,
  },
  {
    nazwa: 'strata na opodatkowanej stronie',
    rok: 2025,
    dane: zeznanie(2025, [['Najem garażu', 1000]], [['Remont garażu', 5000]], {}),
    cit8o: false,
  },
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cit-check-'));
let bledy = 0;

for (const { nazwa, rok, dane, cit8o } of przyklady) {
  const xml = cit8Xml({ rok, dane, slownik });
  const plik = path.join(dir, `${nazwa.replace(/[^a-z0-9]+/gi, '_')}.xml`);
  fs.writeFileSync(plik, xml, 'utf8');
  const w = obliczCIT8(dane, pozycjeZeSprawozdania(dane, slownik));
  if (w.cit8o !== cit8o || xml.includes('Zalacznik_CIT-8_O') !== cit8o) {
    bledy += 1;
    console.log(`FAIL ${nazwa}: CIT-8/O expected ${cit8o}`);
    continue;
  }
  try {
    execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, plik], { stdio: 'pipe' });
    console.log(`PASS ${nazwa} (podatek ${w.podatek}, do zapłaty ${w.doZaplaty}, nadpłata ${w.nadplata})`);
  } catch (e: unknown) {
    bledy += 1;
    console.log(`FAIL ${nazwa}\n${(e as { stderr?: Buffer }).stderr?.toString() ?? e}\n${plik}`);
  }
}

// Must refuse: no office code, an incomplete seat, a year before the form, a NIP with a wrong check digit.
const ok = przyklady[0].dane;
const zle: [string, number, PodatekCitDane][] = [
  ['brak kodu urzędu', 2025, { ...ok, kodUrzedu: '' }],
  ['nieznany urząd', 2025, { ...ok, kodUrzedu: '9999' }],
  ['adres bez gminy', 2025, { ...ok, siedziba: { ...ok.siedziba, gmina: '' } }],
  ['zły kod pocztowy', 2025, { ...ok, siedziba: { ...ok.siedziba, kodPocztowy: '00001' } }],
  ['rok 2024', 2024, zeznanie(2024, [['Zaliczka', 1]], [['Sprzątanie', 2]])],
  ['NIP z błędną cyfrą kontrolną', 2025, { ...ok, nip: '1234563219' }],
];
for (const [nazwa, rok, dane] of zle) {
  try {
    cit8Xml({ rok, dane, slownik });
    bledy += 1;
    console.log(`FAIL (powinno odmówić) ${nazwa}`);
  } catch {
    console.log(`PASS odmowa: ${nazwa}`);
  }
}
console.log(bledy === 0 ? 'ALL PASS' : `${bledy} FAILED`);
process.exit(bledy === 0 ? 0 : 1);
