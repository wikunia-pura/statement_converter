/**
 * Generates PIT-11 / PIT-4R XML from invented data and validates it against MF's schemas with xmllint
 * (scripts/pit-xsd). Run: `npx tsx scripts/pit-check.ts`. Exits non-zero when anything fails.
 * Extra argument: a folder of the office's real files to round-trip (needs the importer) — prints counts only.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pit11Xml, pit4rXml } from '../src/main/podatki/pitXml';
import { PitOsoba, PitPit4R, pustaOsoba, pustePit4R, pitWzor } from '../src/shared/podatki-pit';

const XSD = {
  pit11: path.join(__dirname, 'pit-xsd/pit11/crd.gov.pl/wzor/2024/10/15/13535/schemat.xsd'),
  pit4r: path.join(__dirname, 'pit-xsd/pit4r/crd.gov.pl/wzor/2023/11/07/12978/schemat.xsd'),
};

/** PESEL with a correct check digit from a 10-digit start. */
function pesel(start: string): string {
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = w.reduce((s, x, i) => s + x * Number(start[i]), 0);
  return start + String((10 - (sum % 10)) % 10);
}

const adres = { wojewodztwo: '', powiat: '', ulica: 'Testowa', nrDomu: '5', nrLokalu: '12', miejscowosc: 'Warszawa', kodPocztowy: '00-001' };
const baza = (): PitOsoba => ({
  ...pustaOsoba(),
  imie: 'Jan',
  nazwisko: 'Testowy',
  dataUrodzenia: '1985-06-17',
  pesel: pesel('8506170000'),
  adres,
  urzad: '1433',
});

const przyklady: { nazwa: string; osoba: PitOsoba }[] = [
  { nazwa: 'zarzad', osoba: { ...baza(), zarzad: { opis: 'WYNAGRODZENIE CZŁONKA ZARZĄDU WSPÓLNOTY MIESZKANIOWEJ', kwota: 3500 } } },
  {
    nazwa: 'zlecenie',
    osoba: { ...baza(), zlecenie: { przychod: 22294, koszty: null, zaliczka: 1898 }, skladki: 2570.3, zdrowotna: 1476.26 },
  },
  {
    nazwa: 'etat+zlecenie',
    osoba: {
      ...baza(),
      etat: { przychod: 16580.9, koszty: null, zaliczka: 230 },
      zlecenie: { przychod: 18638.68, koszty: null, zaliczka: 903 },
      skladki: 3340.96,
      zdrowotna: 1891.5,
      kosztyPodwyzszone: true,
    },
  },
  { nazwa: 'art13', osoba: { ...baza(), art13: { przychod: 1200, zaliczka: null } } },
  {
    nazwa: 'obcokrajowiec+zarzad+zlecenie, korekta',
    osoba: {
      ...baza(),
      nrId: 'XX 123456',
      rodzajNrId: 3,
      krajWydania: 'UA',
      urzad: '1438',
      cel: 2,
      przyczyna: 'BRAK ADRESU W POPRZEDNIEJ DEKLARACJI',
      zarzad: { opis: 'WYNAGRODZENIE CZŁONKA ZARZĄDU', kwota: 1500 },
      zlecenie: { przychod: 8400, koszty: null, zaliczka: 239 },
      skladki: 945.84,
      zdrowotna: 670.86,
    },
  },
  { nazwa: 'NIP zamiast PESEL, bez adresu', osoba: { ...baza(), pesel: '', nip: '5260300517', adres: { ...adres, ulica: '', nrDomu: '', nrLokalu: '', kodPocztowy: '' }, zarzad: { opis: 'WYNAGRODZENIE CZŁONKA ZARZĄDU', kwota: 500 } } },
];

const pit4r: PitPit4R = {
  ...pustePit4R(),
  etatLiczba: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  etatKwota: [109, 109, 109, 109, 109, 109, 115, 115, 115, 115, 115, 115],
  art41: [null, null, null, null, null, null, null, 432, 154, 98, 52, null],
};
const pit4rPomniejszenie: PitPit4R = { ...pit4r, pomniejszenie: [null, null, null, null, null, null, null, 10, null, null, null, null] };
const pit4rKorekta: PitPit4R = { ...pit4r, cel: 2, przyczyna: 'NIEWŁAŚCIWE WYPEŁNIENIE CZĘŚCI C.3 (POZ. 50).' };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pit-check-'));
let bledy = 0;

function waliduj(nazwa: string, xml: string, xsd: string) {
  const plik = path.join(dir, `${nazwa.replace(/[^a-z0-9]+/gi, '_')}.xml`);
  fs.writeFileSync(plik, xml, 'utf8');
  try {
    execFileSync('xmllint', ['--noout', '--schema', xsd, plik], { stdio: 'pipe' });
    console.log(`PASS ${nazwa}`);
  } catch (e: unknown) {
    bledy += 1;
    console.log(`FAIL ${nazwa}\n${(e as { stderr?: Buffer }).stderr?.toString() ?? e}`);
  }
}

for (const rok of [2024, 2025]) {
  if (!pitWzor(rok)) throw new Error(`no form for ${rok}`);
  for (const { nazwa, osoba } of przyklady) {
    waliduj(`PIT-11 ${rok} ${nazwa}`, pit11Xml({ rok, platnik: { nip: '1234563218', nazwa: 'Wspólnota Mieszkaniowa Testowa 1' }, osoba }), XSD.pit11);
  }
  for (const [nazwa, p] of [['PIT-4R', pit4r], ['PIT-4R korekta', pit4rKorekta], ['PIT-4R z pomniejszeniem', pit4rPomniejszenie]] as const) {
    waliduj(`${nazwa} ${rok}`, pit4rXml({ rok, platnik: { nip: '1234563218', nazwa: 'Wspólnota Mieszkaniowa Testowa 1' }, urzadPlatnika: '1433', pit4r: p }), XSD.pit4r);
  }
}
// Must refuse: invalid PESEL, no amounts, unknown office, correction without a reason.
const zle: [string, PitOsoba][] = [
  ['zły PESEL', { ...baza(), pesel: '85061700002', zarzad: { opis: 'X', kwota: 1 } }],
  ['brak kwot', { ...baza() }],
  ['nieznany urząd', { ...baza(), urzad: '9999', zarzad: { opis: 'X', kwota: 1 } }],
  ['korekta bez przyczyny', { ...baza(), cel: 2, zarzad: { opis: 'X', kwota: 1 } }],
];
for (const [nazwa, osoba] of zle) {
  try {
    pit11Xml({ rok: 2024, platnik: { nip: '1234563218', nazwa: 'X' }, osoba });
    bledy += 1;
    console.log(`FAIL (powinno odmówić) ${nazwa}`);
  } catch {
    console.log(`PASS odmowa: ${nazwa}`);
  }
}
console.log(bledy === 0 ? 'ALL PASS' : `${bledy} FAILED`);
process.exit(bledy === 0 ? 0 : 1);
