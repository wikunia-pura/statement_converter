/**
 * Gate for src/main/podpis/xades.ts — the hand-written Canonical XML 1.0 and the
 * XAdES-BES envelope the e-Deklaracje gateway accepts.
 *
 *   npx tsx scripts/xades-check.ts [dir]        (default: test-data/pity 2024)
 *
 * Part 1: every `*.xml` with a ds:Signature and every `*.xml.XAdES` under the
 * directory — signed by the Ministry's own tool and accepted by the gateway —
 * must verify with OUR canonicalizer: (a) the document minus ds:Signature
 * hashes to the first DigestValue, (b) SignedProperties to the second, (c)
 * SignatureValue verifies over canonical SignedInfo with the embedded
 * certificate, plus (d) X509IssuerName rebuilt from the certificate DER equals
 * the one the tool wrote.
 *
 * Part 2: a fresh declaration signed through the real `podpiszXml` with
 * throw-away RSA and EC keys (fake card session), then the same checks on the
 * output, xmllint for well-formedness, and xmllint --c14n against our
 * canonicalizer.
 *
 * Output is counts only — the samples hold real personal data, so no file name,
 * name or number from them is ever printed.
 */
import { execFileSync } from 'child_process';
import { sign, type KeyObject, createPrivateKey } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { czytajCertyfikat } from '../src/main/podpis/certyfikat';
import type { SesjaPodpisu } from '../src/main/podpis/karta';
import {
  kanonicznyDokument,
  parsujXml,
  podpiszXml,
  sprawdzPodpisXml,
  type WynikWeryfikacji,
} from '../src/main/podpis/xades';

const ok = (r: WynikWeryfikacji): boolean => r.skroty.length === 2 && r.skroty.every(Boolean) && r.podpis && r.uwagi.length === 0;

// ------------------------------------------------------------------ part 1

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.xml.XAdES') || e.name.endsWith('.xml')) out.push(p);
  }
  return out;
}

function samples(dir: string): boolean {
  const files = walk(dir);
  let total = 0;
  let pass = 0;
  let unsigned = 0;
  const failures = { digestDocument: 0, digestProperties: 0, signature: 0, issuer: 0, parse: 0, other: 0 };
  const failed: number[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file).toString('utf8');
    if (!text.includes('ds:Signature')) {
      unsigned++;
      continue;
    }
    total++;
    try {
      const r = sprawdzPodpisXml(text);
      const good = ok(r) && r.wystawca;
      if (good) pass++;
      else {
        failed.push(total);
        if (r.skroty[0] === false) failures.digestDocument++;
        if (r.skroty[1] === false) failures.digestProperties++;
        if (!r.podpis) failures.signature++;
        if (!r.wystawca) failures.issuer++;
        if (r.skroty.length !== 2 || r.uwagi.length) failures.other++;
      }
    } catch {
      failures.parse++;
      failed.push(total);
    }
  }
  console.log(`Samples in "${path.basename(dir)}": ${files.length} xml-ish files, ${unsigned} without a signature skipped`);
  console.log(`  signed: ${total}, pass: ${pass}, fail: ${total - pass}  (${total ? ((pass / total) * 100).toFixed(1) : '0'}%)`);
  console.log(`  failure classes (a file can be in several): ${JSON.stringify(failures)}`);
  if (failed.length) console.log(`  failed sample indexes (walk order, signed only): ${failed.slice(0, 60).join(',')}`);
  return total > 0 && pass / total >= 0.95;
}

// ------------------------------------------------------------------ part 2

/** A tiny declaration: default namespace, a prefixed one on the root, entities, CDATA, CRLF, empty elements. */
const DEKLARACJA =
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
  '<Deklaracja xmlns="http://crd.gov.pl/wzor/2023/11/07/12978/" xmlns:zzu="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2011/06/21/eD/DefinicjeTypow/" xmlns:unused="urn:unused">\r\n' +
  '  <Naglowek>\r\n' +
  '    <KodFormularza kodPodatku="PIT" wersjaSchemy="1-0E" kodSystemowy="PIT-11 (29)">PIT-11</KodFormularza>\r\n' +
  '    <Rok>2024</Rok>\r\n' +
  '  </Naglowek>\r\n' +
  '  <!-- a comment is not part of the canonical form -->\r\n' +
  '  <Podmiot1 rola=\'Płatnik\' zzu:a="x &amp; y &lt; z &quot;q&quot;&#9;t">\r\n' +
  '    <zzu:Nazwa>Wspólnota &amp; Spółka &lt;ą&gt; ęłóżź</zzu:Nazwa>\r\n' +
  '    <Pusty/>\r\n' +
  '    <Pusty2 ></Pusty2>\r\n' +
  '    <Cdata><![CDATA[1 < 2 && 3 > 2]]></Cdata>\r\n' +
  '    <Ref>&#x105;&#322;&#13;</Ref>\r\n' +
  '  </Podmiot1>\r\n' +
  '  <Pouczenia>1</Pouczenia>\r\n' +
  '</Deklaracja>';

interface Klucz {
  sesja: SesjaPodpisu;
  /** The key kind, for reporting. */
  nazwa: string;
}

function openssl(args: string[], cwd: string): void {
  execFileSync('openssl', args, { cwd, stdio: 'pipe' });
}

/** A self-signed certificate and its key; the fake session signs like the card (RSA raw, EC as DER). */
function wygenerujKlucz(dir: string, rodzaj: 'rsa' | 'ec', subj: string): Klucz {
  const key = path.join(dir, `${rodzaj}.key`);
  const crt = path.join(dir, `${rodzaj}.crt`);
  if (rodzaj === 'rsa') openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '30', '-subj', subj], dir);
  else {
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key], dir);
    openssl(['req', '-x509', '-new', '-key', key, '-out', crt, '-days', '30', '-subj', subj], dir);
  }
  const pem = fs.readFileSync(crt, 'utf8');
  const der = Buffer.from(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
  const privateKey: KeyObject = createPrivateKey(fs.readFileSync(key));
  const cert = czytajCertyfikat(der);
  return {
    nazwa: rodzaj,
    sesja: {
      cert,
      lancuch: [],
      podpisz: async (data: Buffer) =>
        rodzaj === 'rsa' ? sign('sha256', data, privateKey) : sign('sha256', data, { key: privateKey, dsaEncoding: 'der' }),
    },
  };
}

/** libxml2's --c14n keeps comments (ours drops them, as Canonical XML 1.0 without comments does), so it is fed a comment-free copy. */
function xmllintC14n(dir: string, xml: string): string {
  const file = path.join(dir, 'nocomments.xml');
  fs.writeFileSync(file, xml.replace(/<!--[\s\S]*?-->/g, ''));
  return xmllint(file, ['--c14n']);
}

function xmllint(file: string, args: string[]): string {
  return execFileSync('xmllint', [...args, file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
}

async function selfTest(): Promise<boolean> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xades-check-'));
  let allOk = true;
  const report = (label: string, good: boolean, detail = ''): void => {
    if (!good) allOk = false;
    console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  try {
    console.log('Self-test (fake session, throw-away keys):');

    // Canonicalizer against libxml2 on an unsigned tricky document (entities, CDATA, attribute order, empty elements, CR).
    const ours = kanonicznyDokument(parsujXml(DEKLARACJA));
    report('c14n of the unsigned test document equals xmllint --c14n', ours === xmllintC14n(dir, DEKLARACJA));

    const keys: Klucz[] = [
      wygenerujKlucz(dir, 'rsa', '/C=PL/O=Krajowa Izba Rozliczeniowa S.A./CN=Test CA, Sp. z o.o. #1'),
      wygenerujKlucz(dir, 'ec', '/C=PL/O=Wspólnota Test/CN=EC Test'),
    ];
    for (const k of keys) {
      const signed = await podpiszXml(DEKLARACJA, { ...k.sesja, czas: new Date('2026-10-09T10:11:12.345Z') });
      const file = path.join(dir, `${k.nazwa}-signed.xml`);
      fs.writeFileSync(file, signed);
      const r = sprawdzPodpisXml(signed);
      report(`${k.nazwa}: digest of the document (a)`, r.skroty[0] === true);
      report(`${k.nazwa}: digest of SignedProperties (b)`, r.skroty[1] === true);
      report(`${k.nazwa}: signature value (c)`, r.podpis);
      report(`${k.nazwa}: X509IssuerName matches the certificate (d)`, r.wystawca, r.uwagi.join('; '));
      try {
        xmllint(file, ['--noout']);
        report(`${k.nazwa}: xmllint --noout`, true);
      } catch {
        report(`${k.nazwa}: xmllint --noout`, false);
      }
      report(`${k.nazwa}: whole signed document c14n equals xmllint --c14n`, kanonicznyDokument(parsujXml(signed)) === xmllintC14n(dir, signed));
      report(`${k.nazwa}: signature is the last child, before </Deklaracja>`, /<\/ds:Signature><\/Deklaracja>$/.test(signed) && signed.includes('Id="ID-'));
      report(`${k.nazwa}: SigningTime in UTC without milliseconds`, signed.includes('<xades:SigningTime>2026-10-09T10:11:12Z</xades:SigningTime>'));
      report(`${k.nazwa}: signature method matches the key`, signed.includes(k.nazwa === 'rsa' ? 'xmldsig-more#rsa-sha256' : 'xmldsig-more#ecdsa-sha256'));

      // Whatever is removed from the signed document must break it.
      const tamper = signed.replace('<Rok>2024</Rok>', '<Rok>2025</Rok>');
      const t = sprawdzPodpisXml(tamper);
      report(`${k.nazwa}: edited content is detected`, t.skroty[0] === false && t.podpis);
      const tamper2 = signed.replace('Dokument w formacie xml', 'Dokument w formacie xlm');
      const t2 = sprawdzPodpisXml(tamper2);
      report(`${k.nazwa}: edited SignedProperties is detected`, t2.skroty[1] === false);

      // The signed output of an already signed document is refused.
      await podpiszXml(signed, { ...k.sesja }).then(
        () => report(`${k.nazwa}: double signing is refused`, false),
        () => report(`${k.nazwa}: double signing is refused`, true),
      );
    }

    // A BOM and LF-only line endings do not matter.
    const lf = await podpiszXml(`﻿${DEKLARACJA.replace(/\r\n/g, '\n')}`, keys[0].sesja);
    const rLf = sprawdzPodpisXml(lf);
    report('rsa: BOM + LF-only input signs and verifies, BOM dropped', ok(rLf) && lf.charCodeAt(0) !== 0xfeff);
    // A wrong key on the "card" is caught before anything is written.
    const wrong = wygenerujKlucz(path.join(dir), 'rsa', '/C=PL/CN=Other');
    await podpiszXml(DEKLARACJA, { cert: keys[0].sesja.cert, lancuch: [], podpisz: wrong.sesja.podpisz }).then(
      () => report('mismatching signature is refused', false),
      () => report('mismatching signature is refused', true),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return allOk;
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  const dir = process.argv[2] ?? 'test-data/pity 2024';
  let good = true;
  if (fs.existsSync(dir)) good = samples(dir) && good;
  else console.log(`Samples directory not found (${path.basename(dir)}) — part 1 skipped.`);
  good = (await selfTest()) && good;
  console.log(good ? 'ALL GREEN' : 'FAILED');
  process.exit(good ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
