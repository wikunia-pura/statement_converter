/**
 * Round trip on the office's real Płatnik exports: import the KEDU files of a folder, write every monthly set
 * and registration back as KEDU 5.7, validate each against the schema (scripts/zus-xsd) and compare every
 * DRA / RCA figure with the file it came from — to the grosz. Prints counts and position names only, never
 * names or PESELs. Run: `npx tsx scripts/zus-roundtrip.ts <folder>` (e.g. test-data/zus, kept out of git).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { importujKedu } from '../src/main/podatki/zusImport';
import { DokumentKedu, dokumentCzlonka, dokumentWyrejestrowania, dokumentZgloszenia, dokumentyRozliczenia, plikKedu } from '../src/main/podatki/zusKedu';
import { PodatekZusPlatnik, kluczPozycji, obliczRozliczenie, pozycjaZmieniona } from '../src/shared/podatki-zus';
import { XNode, dziecko, parsujXml, tekst } from '../src/main/podatki/pitImport';

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: npx tsx scripts/zus-roundtrip.ts <folder with KEDU files>');
  process.exit(1);
}
const XSD = path.join(__dirname, 'zus-xsd/kedu_5_7.xsd');
const PROGRAM = { producent: 'FileFunky', symbol: 'FileFunky', wersja: 'roundtrip' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zus-roundtrip-'));

let bledy = 0;
const zle = (s: string) => {
  bledy += 1;
  console.log(`  ✗ ${s}`);
};

function waliduj(nazwa: string, xml: string): void {
  const plik = path.join(tmp, `${nazwa.replace(/[^\w.-]+/g, '_')}.xml`);
  fs.writeFileSync(plik, xml);
  try {
    execFileSync('xmllint', ['--nonet', '--noout', '--schema', XSD, plik], { stdio: 'pipe' });
  } catch (e: unknown) {
    zle(`${nazwa}: XSD — ${String((e as { stderr?: Buffer }).stderr ?? e).split('\n').slice(0, 3).join(' | ')}`);
  }
}

/** Every number of a block by position name: "IV.p37", "VI.p2"… */
function liczby(n: XNode | undefined, prefiks: string, out: Map<string, number>): void {
  if (!n) return;
  for (const k of n.kids) {
    if (k.kids.length > 0) liczby(k, `${prefiks}${k.name}.`, out);
    else if (/^\d+(\.\d+)?$/.test(k.text.trim())) out.set(`${prefiks}${k.name}`, Number(k.text.trim()));
  }
}

function dokumentyPliku(xml: string): XNode[] {
  const korzen = parsujXml(xml.replace(/^﻿/, ''));
  return korzen.kids.flatMap((k) => (k.name === 'zestaw' ? k.kids : [k])).filter((k) => k.name.startsWith('ZUS'));
}

const kluczZestawu = (d: XNode) => {
  const nip = tekst(d, 'II', 'p1') ?? '';
  const id = d.name === 'ZUSDRA' ? dziecko(d, 'I', 'p2') : dziecko(d, 'I', 'p1');
  return `${nip}|${tekst(id, 'p2')}|${Number(tekst(id, 'p1'))}`;
};

/** The position names compared — what the app computes; the identification and dates are not figures. */
const POROWNYWANE_DRA = /^(III\.p1|III\.p3|IV\.p\d+|V\.p\d+|VI\.p\d+|VII\.p\d+|IX\.p\d+)$/;
const POROWNYWANE_RCA = /^(B\.p([4-9]|1\d|2[0-6]|29)|C\.p[1-5])$/;

async function main() {
  const pliki = fs
    .readdirSync(folder)
    .filter((f) => f.toLowerCase().endsWith('.xml'))
    .map((f) => path.join(folder, f));
  const wynik = await importujKedu(pliki, [], []);
  console.log(
    `Pliki ${wynik.plikow}, dokumenty ${wynik.dokumentow}, płatnicy ${wynik.nowiPlatnicy.length}, ` +
      `osoby ${wynik.nowiPlatnicy.reduce((n, p) => n + p.dane.ubezpieczeni.length, 0)}, zestawy ${wynik.rozliczenia.length}, pominięte ${wynik.pominiete.length}`,
  );
  for (const p of wynik.pominiete) console.log(`  pominięty: ${p.plik} — ${p.powod}`);
  for (const o of wynik.ostrzezenia) console.log(`  ostrzeżenie: ${o}`);

  const platnicy: PodatekZusPlatnik[] = wynik.nowiPlatnicy.map((p, i) => ({ id: i + 1, nip: p.nip, dane: p.dane, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '' }));
  const poNip = new Map(platnicy.map((p) => [p.nip, p]));

  // The original figures, per set and per RCA block (by the insured's identifier and title code).
  const oryginalDra = new Map<string, Map<string, number>>();
  const oryginalRca = new Map<string, Map<string, number>>();
  for (const plik of pliki) {
    for (const d of dokumentyPliku(fs.readFileSync(plik, 'utf8'))) {
      if (d.name === 'ZUSDRA') {
        const m = new Map<string, number>();
        for (const blok of d.kids) liczby(blok, `${blok.name}.`, m);
        oryginalDra.set(kluczZestawu(d), m);
      }
      if (d.name === 'ZUSRCA') {
        for (const iii of d.kids.filter((k) => k.name === 'III')) {
          const m = new Map<string, number>();
          for (const b of iii.kids.filter((k) => k.name === 'B' || k.name === 'C')) liczby(b, `${b.name}.`, m);
          oryginalRca.set(`${kluczZestawu(d)}|${tekst(iii, 'A', 'p4')}|${tekst(iii, 'B', 'p1', 'p1')}`, m);
        }
      }
    }
  }

  let zestawy = 0;
  let pola = 0;
  for (const r of wynik.rozliczenia) {
    const p = poNip.get(r.nip)!;
    const opis = `zestaw ${r.okres} id ${String(r.identyfikator).padStart(2, '0')}`;
    if (r.dane.przeglad.length > 0) console.log(`  przegląd (${opis}): ${r.dane.przeglad.length} uwag(i)`);
    const policzony = obliczRozliczenie(p.dane, r.dane, r.okres);
    let tylkoPozycje: Set<string> | undefined;
    if (r.identyfikator > 1) {
      const poprzedni = wynik.rozliczenia.find((x) => x.nip === r.nip && x.okres === r.okres && x.identyfikator === r.identyfikator - 1);
      const przed = poprzedni ? new Map(obliczRozliczenie(p.dane, poprzedni.dane, r.okres).pozycje.map((w) => [kluczPozycji(w.pozycja), w.skladki])) : new Map();
      tylkoPozycje = new Set(policzony.pozycje.filter((w) => !poprzedni || pozycjaZmieniona(przed.get(kluczPozycji(w.pozycja)), w.skladki)).map((w) => kluczPozycji(w.pozycja)));
      // Without the original set, the correction's own RCA says who changed.
      if (!poprzedni) {
        const wPliku = new Set([...oryginalRca.keys()].filter((k) => k.startsWith(`${r.nip}|${r.okres}|${r.identyfikator}|`)).map((k) => k.split('|')[3]));
        tylkoPozycje = new Set(policzony.pozycje.filter((w) => wPliku.has(w.osoba.pesel)).map((w) => kluczPozycji(w.pozycja)));
      }
    }
    const dokumenty = dokumentyRozliczenia({
      platnik: { nip: p.nip, dane: p.dane },
      okres: r.okres,
      identyfikator: r.identyfikator,
      dane: r.dane,
      wynik: policzony,
      tylkoPozycje,
      dataWypelnienia: r.dane.dataWypelnienia ?? '2026-10-23',
    });
    const xml = plikKedu(dokumenty, PROGRAM, '2026-10-23');
    waliduj(opis, xml);
    zestawy += 1;
    const klucz = `${r.nip}|${r.okres}|${r.identyfikator}`;
    // A correction imported without its original set lacks the people it does not change: its DRA totals
    // cannot be rebuilt (the import flags it for review) — only its RCA is compared.
    const draNiepelna = r.dane.przeglad.some((n) => n.startsWith('Korekta'));
    if (draNiepelna) console.log(`  ${opis}: DRA nieporównywalna — korekta bez zestawu pierwotnego w folderze`);
    for (const d of dokumentyPliku(xml)) {
      if (d.name === 'ZUSDRA' && !draNiepelna) {
        const nowe = new Map<string, number>();
        for (const blok of d.kids) liczby(blok, `${blok.name}.`, nowe);
        const stare = oryginalDra.get(klucz);
        if (!stare) {
          zle(`${opis}: brak DRA w plikach źródłowych`);
          continue;
        }
        for (const [poz, v] of stare) {
          if (!POROWNYWANE_DRA.test(poz)) continue;
          pola += 1;
          const n = nowe.get(poz) ?? 0;
          if (Math.abs(n - v) >= 0.005) zle(`${opis}: DRA ${poz} — w pliku ${v.toFixed(2)}, wygenerowane ${n.toFixed(2)}`);
        }
      }
      if (d.name === 'ZUSRCA') {
        for (const iii of d.kids.filter((k) => k.name === 'III')) {
          const kk = `${klucz}|${tekst(iii, 'A', 'p4')}|${tekst(iii, 'B', 'p1', 'p1')}`;
          const stare = oryginalRca.get(kk);
          if (!stare) {
            zle(`${opis}: blok RCA bez odpowiednika w pliku (${tekst(iii, 'B', 'p1', 'p1')})`);
            continue;
          }
          const nowe = new Map<string, number>();
          for (const b of iii.kids.filter((k) => k.name === 'B' || k.name === 'C')) liczby(b, `${b.name}.`, nowe);
          for (const [poz, v] of stare) {
            if (!POROWNYWANE_RCA.test(poz)) continue;
            pola += 1;
            const n = nowe.get(poz) ?? 0;
            if (Math.abs(n - v) >= 0.005) zle(`${opis}: RCA ${poz} — w pliku ${v.toFixed(2)}, wygenerowane ${n.toFixed(2)}`);
          }
        }
      }
    }
  }

  // Every registration of the register written back and validated.
  let zgloszenia = 0;
  for (const p of platnicy) {
    const pl = { nip: p.nip, dane: p.dane };
    const dokumenty: [string, DokumentKedu][] = [];
    for (const o of p.dane.ubezpieczeni) {
      for (const t of o.tytuly) {
        if (t.od) dokumenty.push([`zgłoszenie ${t.kod}`, dokumentZgloszenia(pl, o, t, '2026-10-23')]);
        if (t.do) dokumenty.push([`wyrejestrowanie ${t.kod}`, dokumentWyrejestrowania(pl, o, t, '2026-10-23')]);
      }
      for (const c of o.czlonkowie) {
        if (c.od) dokumenty.push(['ZCNA zgłoszenie', dokumentCzlonka(pl, o, c, 'z', '2026-10-23')]);
        if (c.do) dokumenty.push(['ZCNA wyrejestrowanie', dokumentCzlonka(pl, o, c, 'w', '2026-10-23')]);
      }
    }
    for (const [opis, d] of dokumenty) {
      waliduj(`${opis} ${zgloszenia}`, plikKedu([d], PROGRAM, '2026-10-23'));
      zgloszenia += 1;
    }
  }
  const doPrzegladu = platnicy.reduce((n, p) => n + p.dane.ubezpieczeni.filter((o) => o.przeglad.length > 0).length, 0);
  console.log(`Zestawy ${zestawy} (porównane pola ${pola}), zgłoszenia ${zgloszenia}, osoby do przeglądu ${doPrzegladu}, błędy ${bledy}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bledy > 0 ? 1 : 0);
}

void main();
