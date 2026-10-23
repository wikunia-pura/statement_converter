/**
 * Generates every ZUS document the module writes (DRA, RCA, RSA, ZUA, ZZA, ZWUA, ZCNA, a correction) from invented
 * data, validates each KEDU against the official schema (scripts/zus-xsd, xmllint) and checks the contribution
 * engine on bases whose results the office's Płatnik files show. Run: `npx tsx scripts/zus-check.ts`.
 * Exits non-zero when anything fails.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dokumentCzlonka, dokumentWyrejestrowania, dokumentZgloszenia, dokumentyRozliczenia, plikKedu } from '../src/main/podatki/zusKedu';
import { zestawieniePdf } from '../src/main/podatki/zusPdf';
import {
  ZusPlatnikDane,
  ZusRozliczenieDane,
  ZusTytul,
  ZusUbezpieczony,
  maBladZus,
  obliczRozliczenie,
  obliczSkladki,
  problemyCzlonka,
  problemyRozliczenia,
  problemyWyrejestrowania,
  problemyZgloszenia,
  pusteDaneRozliczenia,
  pusteDaneZusPlatnika,
  pustyCzlonek,
  pustyTytul,
  pustyUbezpieczony,
  terminRozliczenia,
  wiekZwalniaZFp,
} from '../src/shared/podatki-zus';

const XSD = path.join(__dirname, 'zus-xsd/kedu_5_7.xsd');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zus-check-'));
const PROGRAM = { producent: 'FileFunky', symbol: 'FileFunky', wersja: 'check' };
let bledy = 0;

function ok(warunek: boolean, opis: string) {
  if (!warunek) {
    bledy += 1;
    console.log(`  ✗ ${opis}`);
  }
}

function waliduj(nazwa: string, xml: string) {
  const plik = path.join(tmp, `${nazwa}.xml`);
  fs.writeFileSync(plik, xml);
  try {
    execFileSync('xmllint', ['--nonet', '--noout', '--schema', XSD, plik], { stdio: 'pipe' });
    console.log(`  ✓ ${nazwa}`);
  } catch (e: unknown) {
    bledy += 1;
    console.log(`  ✗ ${nazwa}: ${String((e as { stderr?: Buffer }).stderr ?? e).split('\n').slice(0, 4).join(' | ')}`);
  }
}

/** PESEL with a correct check digit from a 10-digit start. */
function pesel(start: string): string {
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  return start + String((10 - (w.reduce((s, x, i) => s + x * Number(start[i]), 0) % 10)) % 10);
}

/* ------------------------------ engine on known figures ------------------------------ */

console.log('Wyliczenia:');
const zlecenie: ZusTytul = { ...pustyTytul('0411'), chorobowe: 'dobrowolne' };
const s1 = obliczSkladki(zlecenie, 2405.63, 1.67);
ok(s1.emU === 234.79 && s1.renU === 36.08 && s1.chU === 58.94 && s1.renP === 156.37 && s1.wypP === 40.17, 'zlecenie z chorobowym 2405,63');
ok(s1.podstawaZdr === 2075.82 && s1.zdrowotna === 186.82 && s1.razem === 761.14, 'zlecenie 2405,63 — zdrowotna i p29');
const etat: ZusTytul = { ...pustyTytul('0110'), wymiarLicznik: 1, wymiarMianownik: 2 };
const s2 = obliczSkladki(etat, 2403, 1.67);
ok(s2.renU === 36.05 && s2.renP === 156.2 && s2.chU === 58.87 && s2.wypP === 40.13 && s2.zdrowotna === 186.62 && s2.razem === 760.31, 'etat 2403 (połówki groszy w górę)');
const s3 = obliczSkladki({ ...pustyTytul('0411'), schemat: 'zdrowotne' }, 1523.08, 1.67);
ok(s3.razem === 0 && s3.podstawaZdr === 1523.08 && s3.zdrowotna === 137.08, 'tylko zdrowotne 1523,08');
const s4 = obliczSkladki(pustyTytul('0411'), 1200, 1.67);
ok(s4.emU === 117.12 && s4.renU === 18 && s4.chU === 0 && s4.wypP === 20.04 && s4.razem === 350.28 && s4.zdrowotna === 95.84, 'zlecenie bez chorobowego 1200');
ok(terminRozliczenia('2026-09', '6') === '2026-10-20', 'termin za wrzesień 2026: 20.10 (wtorek)');
ok(terminRozliczenia('2026-05', '6') === '2026-06-22', 'termin za maj 2026: 20.06 to sobota → 22.06');
ok(terminRozliczenia('2026-10', '6') === '2026-11-20', 'termin za październik 2026');
ok(wiekZwalniaZFp({ pesel: '', plec: 'K', dataUrodzenia: '1971-03-10' }, '2026-04') && !wiekZwalniaZFp({ pesel: '', plec: 'K', dataUrodzenia: '1971-03-10' }, '2026-03'), 'FP: kobieta 55 lat od miesiąca po urodzinach');

/* ------------------------------------ the register ------------------------------------ */

const adres = { kodPocztowy: '00001', miejscowosc: 'Warszawa', gmina: 'Mokotów', ulica: 'Testowa', nrDomu: '5', nrLokalu: '12', telefon: '' };
const osoba = (p: Partial<ZusUbezpieczony>): ZusUbezpieczony => ({
  ...pustyUbezpieczony(),
  obywatelstwo: 'POLSKIE',
  adres,
  kodNfz: '07R',
  kodZawodu: '962902',
  ...p,
});

const tZlecenie: ZusTytul = { ...pustyTytul('0411'), od: '2026-03-01', chorobowe: 'dobrowolne', podstawa: 2405.63 };
const tEtat: ZusTytul = {
  ...pustyTytul('0110'),
  emRent: '1',
  od: '2024-01-01',
  do: '2026-09-19',
  wymiarLicznik: 1,
  wymiarMianownik: 2,
  dataRozwiazania: '2026-09-19',
  kodWygasniecia: '22R',
  kodPodstawyPrawnej: '402',
  stronaInicjujaca: '1',
};
const tZdrowotne: ZusTytul = { ...pustyTytul('0411'), schemat: 'zdrowotne', od: '2026-09-01' };
const czlonek = { ...pustyCzlonek(), pesel: pesel('1521010000'), nazwisko: 'Testowa', imie: 'Zofia', dataUrodzenia: '2015-01-01', od: '2026-09-10' };
const czlonekW = { ...czlonek, do: '2026-09-30' };

const jan = osoba({ pesel: pesel('8506170000'), nazwisko: 'Testowy', imie: 'Jan', dataUrodzenia: '1985-06-17', plec: 'M', tytuly: [tZlecenie], czlonkowie: [czlonekW] });
const anna = osoba({ pesel: pesel('6302150000'), nazwisko: 'Próbna', imie: 'Anna', imieDrugie: 'Maria', nazwiskoRodowe: 'Wzorcowa', dataUrodzenia: '1963-02-15', plec: 'K', tytuly: [tEtat] });
const obcy = osoba({ rodzajDok: '2', seriaNrDok: 'FX1234567', nazwisko: 'Example', imie: 'Ivan', dataUrodzenia: '1990-04-04', plec: 'M', obywatelstwo: 'UKRAIŃSKIE', tytuly: [tZdrowotne], adresZamieszkania: { ...adres, ulica: 'Inna' } });

const platnik: ZusPlatnikDane = {
  ...pusteDaneZusPlatnika(),
  nazwaSkrocona: 'WM TESTOWA 5',
  regon: '123456785',
  rachunek: '12345678901234567890123456',
  ubezpieczeni: [jan, anna, obcy],
};
const NIP = '1234563218';
const pl = { nip: NIP, dane: platnik };

const dane: ZusRozliczenieDane = {
  ...pusteDaneRozliczenia(),
  pozycje: [
    { kluczOsoby: jan.klucz, kluczTytulu: tZlecenie.klucz, podstawa: 2405.63, przychodZdrowotny: null, zdrowotna: null },
    // Sick leave in the month: the sick pay (RSA 331) goes into the health base only.
    { kluczOsoby: anna.klucz, kluczTytulu: tEtat.klucz, podstawa: 2403, przychodZdrowotny: 310.4, zdrowotna: null },
    { kluczOsoby: obcy.klucz, kluczTytulu: tZdrowotne.klucz, podstawa: 1523.08, przychodZdrowotny: null, zdrowotna: null },
  ],
  rsa: [{ klucz: 'r1', kluczOsoby: anna.klucz, kluczTytulu: tEtat.klucz, kod: '331', od: '2026-09-02', do: '2026-09-05', dni: null, kwota: 310.4 }],
};
const okres = '2026-09';
const wynik = obliczRozliczenie(platnik, dane, okres);
const grosze = (x: number) => Math.round(x * 100);
ok(grosze(wynik.dra.iv[37]) === 76114 + 76031, `DRA IV p37 = suma p29 (${wynik.dra.iv[37]})`);
const zAnna = wynik.pozycje.find((w) => w.osoba.klucz === anna.klucz)!.skladki;
ok(zAnna.razem === 760.31 && zAnna.podstawaZdr === 2383.95 && zAnna.zdrowotna === 214.56, `chorobowe tylko w podstawie zdrowotnej (${zAnna.podstawaZdr} / ${zAnna.zdrowotna})`);
ok(grosze(wynik.dra.zdrowotna) === 18682 + 21456 + 13708, `DRA VI p2 = suma zdrowotnych (${wynik.dra.zdrowotna})`);
ok(grosze(wynik.dra.doZaplaty) === 76114 + 76031 + 18682 + 21456 + 13708, `DRA IX p2 = społeczne + zdrowotna (${wynik.dra.doZaplaty})`);
ok(wynik.dra.fp === 0, 'FP 0 poniżej płacy minimalnej');
const problemy = problemyRozliczenia(NIP, platnik, { okres, identyfikator: 1, dane }, wynik);
ok(!maBladZus(problemy), `rozliczenie bez błędów (${problemy.filter((p) => p.poziom === 'blad').map((p) => p.tekst).join('; ')})`);
for (const [n, p] of [
  ['ZUA zlecenie', problemyZgloszenia(jan, tZlecenie)],
  ['ZUA etat', problemyZgloszenia(anna, tEtat)],
  ['ZZA', problemyZgloszenia(obcy, tZdrowotne)],
  ['ZWUA etat', problemyWyrejestrowania(anna, tEtat)],
  ['ZCNA', problemyCzlonka(jan, czlonekW, 'w')],
] as const) {
  ok(!maBladZus(p), `${n} bez błędów (${p.filter((x) => x.poziom === 'blad').map((x) => x.tekst).join('; ')})`);
}

const fp = obliczRozliczenie(platnik, { pozycje: [{ kluczOsoby: jan.klucz, kluczTytulu: tZlecenie.klucz, podstawa: 5000, przychodZdrowotny: null, zdrowotna: null }] }, okres);
ok(fp.dra.fp === 122.5, `FP 2,45% od 5000 zł (${fp.dra.fp})`);

/* --------------------------------------- files --------------------------------------- */

console.log('KEDU 5.7 wobec XSD:');
const dzis = '2026-10-05';
waliduj('rozliczenie DRA RCA RSA', plikKedu(dokumentyRozliczenia({ platnik: pl, okres, identyfikator: 1, dane, wynik, dataWypelnienia: dzis }), PROGRAM, dzis));
const korekta = { ...dane, pozycje: dane.pozycje.map((p) => (p.kluczOsoby === jan.klucz ? { ...p, podstawa: 2500 } : p)) };
const wynikK = obliczRozliczenie(platnik, korekta, okres);
const tylko = new Set([`${jan.klucz}|${tZlecenie.klucz}`]);
const dokK = dokumentyRozliczenia({ platnik: pl, okres, identyfikator: 2, dane: korekta, wynik: wynikK, tylkoPozycje: tylko, dataWypelnienia: dzis });
ok(dokK.find((d) => d.nazwa === 'ZUSRCA')?.bloki.filter((b) => b.nazwa === 'III').length === 1, 'korekta: RCA tylko dla zmienionej osoby');
ok(!dokK.some((d) => d.nazwa === 'ZUSRSA'), 'korekta: bez RSA osoby, której nie zmienia');
waliduj('korekta 02', plikKedu(dokK, PROGRAM, dzis));
waliduj('ZUA zlecenie (chorobowe dobrowolne)', plikKedu([dokumentZgloszenia(pl, jan, tZlecenie, dzis)], PROGRAM, dzis));
waliduj('ZUA etat (emeryt)', plikKedu([dokumentZgloszenia(pl, anna, tEtat, dzis)], PROGRAM, dzis));
waliduj('ZZA (paszport, adres zamieszkania)', plikKedu([dokumentZgloszenia(pl, obcy, tZdrowotne, dzis)], PROGRAM, dzis));
waliduj('ZWUA etat (blok V)', plikKedu([dokumentWyrejestrowania(pl, anna, tEtat, dzis)], PROGRAM, dzis));
waliduj('ZWUA korekta', plikKedu([dokumentWyrejestrowania(pl, anna, { ...tEtat, korektaWyrejestrowania: true }, dzis)], PROGRAM, dzis));
waliduj('ZCNA zgłoszenie', plikKedu([dokumentCzlonka(pl, jan, czlonek, 'z', dzis)], PROGRAM, dzis));
waliduj('ZCNA wyrejestrowanie', plikKedu([dokumentCzlonka(pl, jan, czlonekW, 'w', dzis)], PROGRAM, dzis));
waliduj(
  'wszystko razem w jednym pliku',
  plikKedu(
    [
      ...dokumentyRozliczenia({ platnik: pl, okres, identyfikator: 1, dane, wynik, dataWypelnienia: dzis }),
      dokumentZgloszenia(pl, jan, tZlecenie, dzis),
      dokumentWyrejestrowania(pl, anna, tEtat, dzis),
    ],
    PROGRAM,
    dzis,
  ),
);

void (async () => {
  const pdf = await zestawieniePdf({ nip: NIP, platnik, okres, identyfikator: 1, dane, wynik, wydrukowano: '05.10.2026 12:00' });
  const plik = path.join(tmp, 'zestawienie.pdf');
  fs.writeFileSync(plik, pdf);
  ok(pdf.length > 5000, 'PDF zestawienia');
  if (process.argv.includes('--pdf')) {
    const cel = path.join(process.cwd(), 'zus-zestawienie-check.pdf');
    fs.copyFileSync(plik, cel);
    console.log(`PDF: ${cel}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bledy === 0 ? 'Wszystko w porządku.' : `Błędy: ${bledy}`);
  process.exit(bledy > 0 ? 1 : 0);
})();
