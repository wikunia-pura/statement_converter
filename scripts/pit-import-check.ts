/**
 * Runs the PIT importer on a real folder of e-Deklaracje files and prints what came out — counts only, never a
 * name, PESEL or amount of a person, so the output can be pasted anywhere.
 *
 *   npx tsx scripts/pit-import-check.ts "test-data/pity 2024" [2024]
 */

import * as path from 'path';
import { importujPitFolder } from '../src/main/podatki/pitImport';
import { PIT_TYTULY, obliczPit4R, sumyZaliczek } from '../src/shared/podatki-pit';

/** A message without its numbers, so the same kind counts once ("PESEL w pliku ma 10 cyfr" = "PESEL w pliku ma # cyfr"). */
const rodzajKomunikatu = (m: string): string => m.replace(/\d+/g, '#');

function licz(komunikaty: string[]): [string, number][] {
  const mapa = new Map<string, number>();
  for (const m of komunikaty) mapa.set(rodzajKomunikatu(m), (mapa.get(rodzajKomunikatu(m)) ?? 0) + 1);
  return [...mapa.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function main(): Promise<void> {
  const folder = process.argv[2];
  const rok = Number(process.argv[3] ?? 2024);
  if (!folder || !Number.isInteger(rok)) {
    console.error('Usage: npx tsx scripts/pit-import-check.ts <folder> [year]');
    process.exit(2);
  }
  const t0 = Date.now();
  const w = await importujPitFolder(path.resolve(folder), rok);
  const ms = Date.now() - t0;

  const osoby = w.wiersze.flatMap((r) => r.dane.osoby);
  console.log(`year ${rok}: ${w.wiersze.length} communities (rows), ${osoby.length} people, ${w.plikow} XML files read, ${ms} ms`);

  console.log('titles:');
  for (const t of PIT_TYTULY) console.log(`  ${t}: ${osoby.filter((o) => o[t] !== null).length}`);
  const ileTytulow = (o: (typeof osoby)[number]) => PIT_TYTULY.filter((t) => o[t] !== null).length;
  console.log(`  people with 2+ titles: ${osoby.filter((o) => ileTytulow(o) >= 2).length}, with none: ${osoby.filter((o) => ileTytulow(o) === 0).length}`);
  console.log(`  increased costs (kosztyPodwyzszone): ${osoby.filter((o) => o.kosztyPodwyzszone).length}`);
  console.log(`  zlecenie with own costs: ${osoby.filter((o) => o.zlecenie?.koszty != null).length}, art13 with own advance: ${osoby.filter((o) => o.art13?.zaliczka != null).length}`);
  console.log(`  poz. 95 set: ${osoby.filter((o) => o.skladki !== null).length}, poz. 122 set: ${osoby.filter((o) => o.zdrowotna !== null).length}`);
  console.log(`  with PESEL: ${osoby.filter((o) => o.pesel).length}, with foreign number: ${osoby.filter((o) => o.nrId).length}, without birth date: ${osoby.filter((o) => !o.dataUrodzenia).length}`);

  const zPrzegladem = osoby.filter((o) => o.przeglad.length > 0);
  console.log(`people with przeglad: ${zPrzegladem.length}`);
  for (const [rodzaj, n] of licz(zPrzegladem.flatMap((o) => o.przeglad))) console.log(`  ${n} x ${rodzaj}`);

  console.log(`people filed (zlozone): ${osoby.filter((o) => o.zlozone).length}, corrections (cel 2): ${osoby.filter((o) => o.cel === 2).length}`);
  const bezReferencji = osoby.filter((o) => o.zlozone && !/^[0-9a-f]{32}$/.test(o.zlozone.numerRef)).length;
  console.log(`  filed without a 32-hex reference: ${bezReferencji}`);

  const pit4r = w.wiersze.filter((r) => r.dane.pit4r);
  console.log(`PIT-4R: ${pit4r.length} (corrections: ${pit4r.filter((r) => r.dane.pit4r?.cel === 2).length}, filed: ${pit4r.filter((r) => r.dane.pit4r?.zlozone).length}, with row 1 counts: ${pit4r.filter((r) => r.dane.pit4r?.etatLiczba.some((v) => v)).length})`);
  const pit4rPrzeglad = pit4r.filter((r) => (r.dane.pit4r?.przeglad.length ?? 0) > 0);
  console.log(`PIT-4R with przeglad: ${pit4rPrzeglad.length}`);
  for (const [rodzaj, n] of licz(pit4rPrzeglad.flatMap((r) => r.dane.pit4r?.przeglad ?? []))) console.log(`  ${n} x ${rodzaj}`);
  console.log(`communities without PIT-4R: ${w.wiersze.length - pit4r.length}; offices of PIT-4R: ${[...new Set(pit4r.map((r) => r.dane.urzadPlatnika))].sort().join(', ')}`);

  let zgodne = 0;
  let etatRozne = 0;
  let art41Rozne = 0;
  for (const r of pit4r) {
    const k = obliczPit4R(r.dane.pit4r!);
    const s = sumyZaliczek(r.dane.osoby);
    const e = k.rokEtat !== s.etat;
    const a = k.rokArt41 !== s.art41;
    if (e) etatRozne++;
    if (a) art41Rozne++;
    if (!e && !a) zgodne++;
  }
  // Same check on the PIT-11s that went through the gateway only (a draft nobody filed is not in the PIT-4R's sums).
  let zgodneZlozone = 0;
  for (const r of pit4r) {
    const k = obliczPit4R(r.dane.pit4r!);
    const s = sumyZaliczek(r.dane.osoby.filter((o) => o.zlozone));
    if (k.rokEtat === s.etat && k.rokArt41 === s.art41) zgodneZlozone++;
  }
  console.log(`  counting only the filed PIT-11s: ${zgodneZlozone} agree, ${pit4r.length - zgodneZlozone} disagree`);
  console.log(`PIT-4R year totals vs PIT-11 advance sums: ${zgodne} agree, ${pit4r.length - zgodne} disagree (row 1 differs: ${etatRozne}, row 3 differs: ${art41Rozne})`);
  const bez4rZZaliczkami = w.wiersze.filter((r) => !r.dane.pit4r && sumyZaliczek(r.dane.osoby).razem > 0).length;
  console.log(`communities without PIT-4R but with PIT-11 advances: ${bez4rZZaliczkami}`);

  console.log(`skipped files: ${w.pominiete.length}`);
  for (const [rodzaj, n] of licz(w.pominiete.map((p) => p.powod))) console.log(`  ${n} x ${rodzaj}`);
  console.log(`folder warnings: ${w.ostrzezenia.length}`);
  for (const [rodzaj, n] of licz(w.ostrzezenia.map((o) => o.replace(/\bNIP \d{10}\b/, 'NIP N')))) console.log(`  ${n} x ${rodzaj}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
