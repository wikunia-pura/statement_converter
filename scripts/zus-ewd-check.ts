/**
 * Checks the EWD przesyłka and the client's framing without a card and without sending anything to ZUS:
 *  • a KEDU signed with a throwaway key (RSA, then EC) the way the card session signs, packed and enveloped to a
 *    throwaway "ZUS" certificate — then opened with OpenSSL as ZUS would: `cms -decrypt`, the ASiC-S container
 *    (mimetype first and stored), `cms -verify` of the detached CAdES over the KEDU, signing-time present;
 *  • the bundled ZUS certificates still valid, the przesyłka enveloped to the production one parses;
 *  • an MTOM request read back by the answer parser, attachments included;
 *  • a confirmation (POSWIADCZENIE_PRZEDLOZENIA in an ASiC-S) read into its fields.
 * With `--ping` it also calls CheckTransmision on ZUS's TEST service (pt2.zus.pl) — the documented connection
 * test, an echo of a few bytes, no document. Run: `npx tsx scripts/zus-ewd-check.ts [--ping]`.
 * Exits non-zero when anything fails.
 */
import { execFileSync } from 'child_process';
import { createPrivateKey, sign } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { asicSCades, otworzAsicS } from '../src/main/podpis/asic';
import { czytajCertyfikat } from '../src/main/podpis/certyfikat';
import { children, read } from '../src/main/podpis/der';
import { binarne, czytajOdpowiedz, czytajPotwierdzenie, sprawdzPolaczenie, zadanie, zbudujPrzesylke } from '../src/main/podatki/zusEwd';
import { certyfikatZus } from '../src/main/podatki/zusCertyfikaty';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zus-ewd-check-'));
let bledy = 0;

function ok(warunek: boolean, opis: string) {
  if (!warunek) {
    bledy += 1;
    console.log(`✗ ${opis}`);
  } else console.log(`✓ ${opis}`);
}

const openssl = (args: string[], input?: Buffer): string =>
  execFileSync('openssl', args, { cwd: tmp, input, stdio: ['pipe', 'pipe', 'pipe'] }).toString('utf8');

/** A self-signed certificate and its key, made by OpenSSL in the temp folder. */
function certyfikat(nazwa: string, klucz: 'rsa' | 'ec'): { der: Buffer; key: string } {
  const keyFile = path.join(tmp, `${nazwa}.key`);
  if (klucz === 'rsa') openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', keyFile]);
  else openssl(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', keyFile]);
  const crtFile = path.join(tmp, `${nazwa}.crt`);
  openssl(['req', '-new', '-x509', '-key', keyFile, '-out', crtFile, '-days', '30', '-subj', `/C=PL/O=Test/CN=${nazwa}`, '-outform', 'DER']);
  return { der: fs.readFileSync(crtFile), key: fs.readFileSync(keyFile, 'utf8') };
}

const kedu = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?>\n<KEDU wersja_schematu="1" xmlns="http://www.zus.pl/2026/KEDU_5_7"><ZUSDRA id_dokumentu="1"/></KEDU>\n',
  'utf8',
);

async function koperta(klucz: 'rsa' | 'ec') {
  const podpisujacy = certyfikat(`signer-${klucz}`, klucz);
  const zus = certyfikat('zus', 'rsa');
  const cert = czytajCertyfikat(podpisujacy.der);
  const prywatny = createPrivateKey(podpisujacy.key);
  const przesylka = await zbudujPrzesylke(kedu, {
    cert,
    lancuch: [],
    // As the card does it: SHA-256 over the attributes; ECDSA comes back as DER.
    podpisz: async (atrybuty) => sign('sha256', atrybuty, prywatny),
  }, zus.der);
  const env = path.join(tmp, `przesylka-${klucz}.p7m`);
  fs.writeFileSync(env, przesylka);
  fs.writeFileSync(path.join(tmp, 'zus.pem'), openssl(['x509', '-inform', 'DER', '-in', path.join(tmp, 'zus.crt')]));

  const asicFile = path.join(tmp, `asic-${klucz}.zip`);
  openssl(['cms', '-decrypt', '-inform', 'DER', '-in', env, '-recip', 'zus.pem', '-inkey', 'zus.key', '-out', asicFile]);
  const asic = fs.readFileSync(asicFile);
  ok(asic.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004', `${klucz}: the envelope opens with ZUS's key into a ZIP`);
  ok(asic.readUInt16LE(8) === 0 && asic.subarray(30, 38).toString('latin1') === 'mimetype' && asic.readUInt16LE(28) === 0, `${klucz}: "mimetype" first, stored, no extra field`);
  ok(asic.subarray(38, 38 + 31).toString('latin1') === 'application/vnd.etsi.asic-s+zip', `${klucz}: the ASiC-S media type`);
  const z = otworzAsicS(asic);
  ok(z.nazwa === 'KEDU.xml' && z.dane.equals(kedu), `${klucz}: the KEDU inside, unchanged`);
  const p7s = z.meta.get('META-INF/signature.p7s');
  ok(!!p7s, `${klucz}: META-INF/signature.p7s present`);
  fs.writeFileSync(path.join(tmp, 'sig.p7s'), p7s!);
  fs.writeFileSync(path.join(tmp, 'KEDU.xml'), z.dane);
  let zweryfikowany = false;
  try {
    openssl(['cms', '-verify', '-inform', 'DER', '-in', 'sig.p7s', '-content', 'KEDU.xml', '-binary', '-noverify', '-out', path.join(tmp, 'out.bin')]);
    zweryfikowany = true;
  } catch (error: unknown) {
    console.log(String((error as { stderr?: Buffer }).stderr ?? error));
  }
  ok(zweryfikowany, `${klucz}: the detached CAdES verifies over the KEDU (openssl cms -verify)`);
  const druk = openssl(['cms', '-cmsout', '-print', '-inform', 'DER', '-in', 'sig.p7s']);
  ok(/signingTime \(1\.2\.840\.113549\.1\.9\.5\)/.test(druk) && /1\.2\.840\.113549\.1\.9\.16\.2\.47/.test(druk), `${klucz}: signing-time and signing-certificate-v2 signed`);
  const envDruk = openssl(['cms', '-cmsout', '-print', '-inform', 'DER', '-in', env]);
  // EnvelopedData's version and the recipient's, straight from the DER (OpenSSL prints a 0 as <ABSENT>).
  const envelopedData = children(children(read(przesylka))[1])[0];
  const [wersja, odbiorcy] = children(envelopedData);
  const ktri = children(children(odbiorcy)[0]);
  ok(
    /aes-256-cbc/.test(envDruk) && /rsaEncryption/.test(envDruk) && wersja.body.equals(Buffer.from([0])) && ktri[0].body.equals(Buffer.from([0])),
    `${klucz}: EnvelopedData v0 with a v0 key-transport recipient, AES-256-CBC, RSA`,
  );
}

async function main() {
  await koperta('rsa');
  await koperta('ec');

  for (const s of ['prod', 'test'] as const) {
    let der: Buffer | null = null;
    try {
      der = certyfikatZus(s);
    } catch (error: unknown) {
      console.log(String(error));
    }
    ok(!!der, `the bundled ZUS certificate (${s}) is valid today`);
    if (der && s === 'prod') {
      const x = czytajCertyfikat(der);
      ok(x.numerSeryjny === '77798805994D053DD0D2952DBCAFDF99', 'production certificate: PE-2-ZUS-EWD, the serial of ZUS’s notice');
    }
  }
  let wygasl = false;
  try {
    certyfikatZus('prod', Date.parse('2028-01-01'));
  } catch {
    wygasl = true;
  }
  ok(wygasl, 'an expired ZUS certificate stops the send');

  // MTOM: the request as the client writes it, read back by the answer parser.
  const przesylka = Buffer.from([0, 1, 2, 3, 0x0d, 0x0a, 0x2d, 0x2d, 255]);
  const z = zadanie('test', 'WyslijPrzesylke', [
    ['pbyPrzesylka', { zalacznik: przesylka }],
    ['uiPrzesylkaDlugosc', String(przesylka.length)],
    ['strNazwaProducenta', 'A & B <C>'],
  ]);
  const odp = czytajOdpowiedz(z.body, z.contentType);
  ok(/<WyslijPrzesylke xmlns="naws.zus.pl">/.test(odp.xml) && odp.xml.includes('A &amp; B &lt;C&gt;'), 'MTOM: the envelope part found and escaped');
  ok(binarne(odp, 'pbyPrzesylka')?.equals(przesylka) === true, 'MTOM: the attachment comes back byte for byte');
  ok(/<a:To s:mustUnderstand="1">https:\/\/www\.pt2\.zus\.pl\/SDWI_AWS2\/NawsUslugi\.svc<\/a:To>/.test(odp.xml), 'WS-Addressing: To is the test service');
  const inline = czytajOdpowiedz(
    Buffer.from('<s:Envelope><s:Body><X><byDataOut>cGluZw==</byDataOut></X></s:Body></s:Envelope>'),
    'application/soap+xml; charset=utf-8',
  );
  ok(binarne(inline, 'byDataOut')?.toString() === 'ping', 'a plain SOAP answer with inline base64');

  // A confirmation as ZUS sends it (Załącznik 3), in an ASiC-S container.
  const potw = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><POSWIADCZENIE_PRZEDLOZENIA VERSION="1.15" xmlns="http://tempuri.org/XMLSchema.xsd">' +
      '<PRZESYLKA_DO_ZUS><ID_PRZESYLKI>ABC-123</ID_PRZESYLKI><TYP_PRZESYLKI>SDWI3.CMS.ASIC.CADESB.KEDUXML</TYP_PRZESYLKI>' +
      '<DATA_REJ>2026-10-23T20:00:00</DATA_REJ><SKROT_TRESCI>x</SKROT_TRESCI><STATUS_PRZETW>Przyjęto z błędami</STATUS_PRZETW>' +
      '<KOD_PRZYJECIA>false</KOD_PRZYJECIA></PRZESYLKA_DO_ZUS><PODPISUJACY><NAZWA_PODPIS></NAZWA_PODPIS><NAZWISKO_PODPIS>KOWALSKA</NAZWISKO_PODPIS>' +
      '<IMIE_PODPIS>ANNA</IMIE_PODPIS><NIP_PODPIS/><REGON_PODPIS/><PESEL_PODPIS/><PSEUDONIM_PODPIS/><JEST_UPOWAZNIENIE>false</JEST_UPOWAZNIENIE></PODPISUJACY>' +
      '<DANE_POTWIERDZENIA><NAZWA_PODMIOTU>ZUS</NAZWA_PODMIOTU><NAZWA_APLIKACJI>EWD</NAZWA_APLIKACJI><WERSJA_APLIKACJI>2</WERSJA_APLIKACJI>' +
      '<DATA_EMISJI>2026-10-23T20:01:00</DATA_EMISJI></DANE_POTWIERDZENIA><BLEDY><BLAD><RODZAJ_BLEDU>Brak upoważnienia</RODZAJ_BLEDU>' +
      '<OPIS_ROZWIAZANIE>Złóż ZUS-PEL &amp; wyślij ponownie</OPIS_ROZWIAZANIE></BLAD></BLEDY></POSWIADCZENIE_PRZEDLOZENIA>',
    'utf8',
  );
  const c = czytajPotwierdzenie(asicSCades('POTWIERDZENIE.xml', potw, Buffer.from('sig')), 'P-1');
  ok(
    c.idPrzesylki === 'ABC-123' && !c.przyjeta && c.status === 'Przyjęto z błędami' && c.upowaznienie === 'false' && c.podpisal === 'KOWALSKA ANNA',
    'confirmation: id, KOD_PRZYJECIA, status, authorisation, signer',
  );
  ok(c.bledy.length === 1 && c.bledy[0].opis === 'Złóż ZUS-PEL & wyślij ponownie', 'confirmation: errors read, entities expanded');

  if (process.argv.includes('--ping')) {
    let echo = false;
    try {
      await sprawdzPolaczenie((url, init) => fetch(url, init), 'test');
      echo = true;
    } catch (error: unknown) {
      console.log(String(error));
    }
    ok(echo, 'CheckTransmision on pt2.zus.pl: the bytes come back (MTOM attachment, WS-Addressing 2004/08)');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bledy === 0 ? '\nAll checks passed.' : `\n${bledy} check(s) failed.`);
  process.exit(bledy === 0 ? 0 : 1);
}

void main();
