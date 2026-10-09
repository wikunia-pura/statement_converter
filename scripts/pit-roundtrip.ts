/**
 * Import → generate → validate, on the office's real folder: every person the importer makes is turned back into
 * a PIT-11 XML and every community's PIT-4R into a PIT-4R XML, and each file is validated against MF's schema
 * with xmllint. Prints counts only (never a name, PESEL or amount).
 *
 *   npx tsx scripts/pit-roundtrip.ts "test-data/pity 2024" [2024]
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { importujPitFolder } from '../src/main/podatki/pitImport';
import { pit11Xml, pit4rXml } from '../src/main/podatki/pitXml';
import { maBlad, problemyOsoby, problemyPit4R } from '../src/shared/podatki-pit';

const XSD = {
  pit11: path.join(__dirname, 'pit-xsd/pit11/crd.gov.pl/wzor/2024/10/15/13535/schemat.xsd'),
  pit4r: path.join(__dirname, 'pit-xsd/pit4r/crd.gov.pl/wzor/2023/11/07/12978/schemat.xsd'),
};

const rodzaj = (m: string): string => m.replace(/\d+/g, '#').replace(/„[^”]*”/g, '„…”');

async function main(): Promise<void> {
  const folder = process.argv[2];
  const rok = Number(process.argv[3] ?? 2024);
  if (!folder) {
    console.error('Usage: npx tsx scripts/pit-roundtrip.ts <folder> [year]');
    process.exit(2);
  }
  const wynik = await importujPitFolder(path.resolve(folder), rok);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pit-roundtrip-'));
  let zXsd = 0;
  let bledyXsd = 0;
  let zablokowane = 0;
  const powody = new Map<string, number>();
  const bledyOpis = new Map<string, number>();

  const waliduj = (xml: string, xsd: string, nazwa: string) => {
    const plik = path.join(tmp, nazwa);
    fs.writeFileSync(plik, xml, 'utf8');
    try {
      execFileSync('xmllint', ['--noout', '--schema', xsd, plik], { stdio: 'pipe' });
      zXsd += 1;
    } catch (e: unknown) {
      bledyXsd += 1;
      const msg = (e as { stderr?: Buffer }).stderr?.toString().split('\n')[0] ?? String(e);
      bledyOpis.set(rodzaj(msg.replace(plik, 'file')), (bledyOpis.get(rodzaj(msg.replace(plik, 'file'))) ?? 0) + 1);
    }
  };

  let n = 0;
  for (const w of wynik.wiersze) {
    for (const o of w.dane.osoby) {
      n += 1;
      const problemy = problemyOsoby(o, rok);
      if (maBlad(problemy)) {
        zablokowane += 1;
        for (const p of problemy.filter((x) => x.poziom === 'blad')) powody.set(rodzaj(p.tekst), (powody.get(rodzaj(p.tekst)) ?? 0) + 1);
        continue;
      }
      waliduj(pit11Xml({ rok, platnik: { nip: w.nip, nazwa: w.dane.nazwa }, osoba: o }), XSD.pit11, `p11-${n}.xml`);
    }
    if (w.dane.pit4r) {
      const problemy = problemyPit4R(w.dane, rok);
      if (maBlad(problemy)) {
        zablokowane += 1;
        for (const p of problemy.filter((x) => x.poziom === 'blad')) powody.set(`PIT-4R: ${rodzaj(p.tekst)}`, (powody.get(`PIT-4R: ${rodzaj(p.tekst)}`) ?? 0) + 1);
        continue;
      }
      waliduj(pit4rXml({ rok, platnik: { nip: w.nip, nazwa: w.dane.nazwa }, urzadPlatnika: w.dane.urzadPlatnika, pit4r: w.dane.pit4r }), XSD.pit4r, `p4r-${w.nip}.xml`);
    }
  }
  console.log(`communities ${wynik.wiersze.length}, PIT-11 ${n}, generated+validated ${zXsd + bledyXsd}: ${zXsd} valid, ${bledyXsd} invalid; held back by blocking problems: ${zablokowane}`);
  for (const [k, v] of [...powody.entries()].sort((a, b) => b[1] - a[1])) console.log(`  blocked ${v} x ${k}`);
  for (const [k, v] of bledyOpis) console.log(`  xsd ${v} x ${k}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bledyXsd === 0 ? 0 : 1);
}

void main();
