/**
 * ZUS's EWD service (SOAP 1.2 with WS-Addressing of August 2004 and MTOM, WCF behind it) — building a
 * przesyłka from a KEDU, sending it, and fetching and reading its confirmation. Specification: "EWD
 * Elektroniczna Wymiana Dokumentów. Specyfikacja wejścia-wyjścia" 2.27 with its Załącznik 2 (WSDL) and 3
 * (confirmation schema), bip.zus.pl → Wymagania dla oprogramowania interfejsowego.
 *
 * No Electron: the caller hands in the `fetch` (main passes Electron's `net.fetch`, so the system proxy
 * applies) and the card session; scripts/zus-ewd-check.ts drives the same code with a throwaway key.
 *
 * The przesyłka is the type SDWI3.CMS.ASIC.CADESB.KEDUXML: the KEDU signed with CAdES-B detached, the file and
 * its signature in an ASiC-S container, the container in a CMS EnvelopedData to ZUS's certificate.
 */

import { createHash, randomUUID, verify, X509Certificate } from 'crypto';
import { asicSCades, otworzAsicS } from '../podpis/asic';
import { atrybutyPodpisane, zlozCms } from '../podpis/cades';
import type { Certyfikat } from '../podpis/certyfikat';
import { kopertaCms } from '../podpis/koperta';
import { bezPolaczenia, BramkaNiePrzyjela, pole } from './eDeklaracjeBramka';
import { EWD_URL, ZusPotwierdzenie, ZusSrodowisko } from '../../shared/zus-ewd';
import { AppError, hasAppErrorCode } from '../../shared/app-errors';

export const TYP_PRZESYLKI = 'SDWI3.CMS.ASIC.CADESB.KEDUXML';
/** What the program calls itself in every request (ZUS's log of who sent what). */
export interface ProgramEwd {
  producent: string;
  nazwa: string;
  wersja: string;
}

const NS = 'naws.zus.pl';
const WSA = 'http://schemas.xmlsoap.org/ws/2004/08/addressing';
const WSA_ANONYMOUS = 'http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous';
const LIMIT_MS = 60_000;
/** The signed file's name inside the container. */
const NAZWA_W_KONTENERZE = 'KEDU.xml';

const sha256 = (b: Buffer): Buffer => createHash('sha256').update(b).digest();

/* =============================== the przesyłka =============================== */

export interface SesjaEwd {
  cert: Certyfikat;
  lancuch: Buffer[];
  /** Signs the signed attributes' DER (the card hashes them); RSA PKCS#1 v1.5 or ECDSA in DER. */
  podpisz: (atrybuty: Buffer) => Promise<Buffer>;
}

/**
 * The przesyłka of one KEDU: signed with the card, packed, encrypted to ZUS. The signature is checked against
 * the certificate before anything else — a card that signed with another key never reaches ZUS.
 */
export async function zbudujPrzesylke(kedu: Buffer, sesja: SesjaEwd, certZus: Buffer, czas = new Date()): Promise<Buffer> {
  const atrybuty = atrybutyPodpisane(sha256(kedu), sesja.cert, czas);
  const podpis = await sesja.podpisz(atrybuty);
  let zgodny = false;
  try {
    // RSA PKCS#1 v1.5, or ECDSA as DER — Node's default encoding for EC keys.
    zgodny = verify('sha256', atrybuty, new X509Certificate(sesja.cert.der).publicKey, podpis);
  } catch {
    zgodny = false;
  }
  if (!zgodny) throw new AppError('cardSignatureMismatch');
  const p7s = zlozCms({ atrybuty, podpis, cert: sesja.cert, lancuch: sesja.lancuch });
  return kopertaCms(asicSCades(NAZWA_W_KONTENERZE, kedu, p7s, czas), certZus);
}

/* ================================== transport ================================== */

export type EwdFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

/** Text of a SOAP field; the C0 controls XML 1.0 forbids are dropped. */
const esc = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** One field of a request: text, or binary sent as an MTOM attachment. */
type Pole = [string, string] | [string, { zalacznik: Buffer }];

interface Zadanie {
  /** The envelope part and the attachments, framed as one MTOM multipart body. */
  body: Buffer;
  contentType: string;
}

/** The request of one operation, MTOM-framed (what the WSDL's policy asks for) with WS-Addressing headers. */
export function zadanie(srodowisko: ZusSrodowisko, operacja: string, pola: Pole[]): Zadanie {
  const granica = `uuid:${randomUUID()}`;
  const start = `<root.message@filefunky>`;
  const zalaczniki: { cid: string; dane: Buffer }[] = [];
  const tresc = pola
    .map(([k, v]) => {
      if (typeof v === 'string') return `<${k}>${esc(v)}</${k}>`;
      const cid = `${k}.${zalaczniki.length}@filefunky`;
      zalaczniki.push({ cid, dane: v.zalacznik });
      return `<${k}><xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="cid:${encodeURIComponent(cid)}"/></${k}>`;
    })
    .join('');
  const koperta =
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="${WSA}"><s:Header>` +
    `<a:Action s:mustUnderstand="1">${NS}/${operacja}</a:Action>` +
    `<a:MessageID>urn:uuid:${randomUUID()}</a:MessageID>` +
    `<a:ReplyTo><a:Address>${WSA_ANONYMOUS}</a:Address></a:ReplyTo>` +
    `<a:To s:mustUnderstand="1">${EWD_URL[srodowisko]}</a:To>` +
    `</s:Header><s:Body><${operacja} xmlns="${NS}">${tresc}</${operacja}></s:Body></s:Envelope>`;
  const czesci: Buffer[] = [
    Buffer.from(
      `--${granica}\r\nContent-ID: ${start}\r\nContent-Transfer-Encoding: 8bit\r\n` +
        `Content-Type: application/xop+xml;charset=utf-8;type="application/soap+xml"\r\n\r\n${koperta}\r\n`,
      'utf8',
    ),
  ];
  for (const z of zalaczniki) {
    czesci.push(
      Buffer.from(
        `--${granica}\r\nContent-ID: <${z.cid}>\r\nContent-Transfer-Encoding: binary\r\nContent-Type: application/octet-stream\r\n\r\n`,
        'utf8',
      ),
      z.dane,
      Buffer.from('\r\n', 'utf8'),
    );
  }
  czesci.push(Buffer.from(`--${granica}--\r\n`, 'utf8'));
  return {
    body: Buffer.concat(czesci),
    contentType:
      `multipart/related; type="application/xop+xml"; start="${start}"; start-info="application/soap+xml"; ` +
      `boundary="${granica}"; action="${NS}/${operacja}"`,
  };
}

/** A parameter of a Content-Type header, quoted or not. */
const parametr = (naglowek: string, nazwa: string): string | null => {
  const m = new RegExp(`(?:^|;)\\s*${nazwa}\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(naglowek);
  return m ? (m[1] ?? m[2] ?? null) : null;
};

export interface Odpowiedz {
  /** The SOAP envelope, as text. */
  xml: string;
  /** The MTOM attachments by Content-ID (without the angle brackets). */
  czesci: Map<string, Buffer>;
}

/** An answer as the service sends it — MTOM multipart (WCF's way), or a plain SOAP body. */
export function czytajOdpowiedz(bytes: Buffer, contentType: string): Odpowiedz {
  const czesci = new Map<string, Buffer>();
  if (!/^\s*multipart\/related/i.test(contentType)) return { xml: bytes.toString('utf8'), czesci };
  const granica = parametr(contentType, 'boundary');
  if (!granica) throw new AppError('ewdUnexpectedAnswer', { http: 200 });
  const start = (parametr(contentType, 'start') ?? '').replace(/^<|>$/g, '');
  const ogranicznik = Buffer.from(`--${granica}`, 'latin1');
  let xml: string | null = null;
  let pierwsza: string | null = null;
  let at = bytes.indexOf(ogranicznik);
  while (at >= 0) {
    let poczatek = at + ogranicznik.length;
    if (bytes.subarray(poczatek, poczatek + 2).toString('latin1') === '--') break; // the closing delimiter
    poczatek = bytes.indexOf('\r\n', poczatek) + 2;
    const nastepny = bytes.indexOf(ogranicznik, poczatek);
    if (nastepny < 0) break;
    // The body ends before the CRLF that precedes the next delimiter.
    const koniec = bytes.subarray(nastepny - 2, nastepny).toString('latin1') === '\r\n' ? nastepny - 2 : nastepny;
    const czesc = bytes.subarray(poczatek, koniec);
    const sep = czesc.indexOf('\r\n\r\n');
    const naglowki = sep >= 0 ? czesc.subarray(0, sep).toString('latin1') : '';
    const tresc = sep >= 0 ? czesc.subarray(sep + 4) : czesc;
    const id = (/^content-id:\s*<?([^>\r\n]*)>?/im.exec(naglowki)?.[1] ?? '').trim();
    if (pierwsza === null) pierwsza = id;
    if ((start && id === start) || (!start && xml === null)) xml = tresc.toString('utf8');
    else czesci.set(id, Buffer.from(tresc));
    at = nastepny;
  }
  if (xml === null && pierwsza !== null) xml = czesci.get(pierwsza)?.toString('utf8') ?? null;
  if (xml === null) throw new AppError('ewdUnexpectedAnswer', { http: 200 });
  return { xml, czesci };
}

/** A base64Binary field of an answer: inline, or an `xop:Include` of an attachment. Null when absent or empty. */
export function binarne(o: Odpowiedz, nazwa: string): Buffer | null {
  const m = new RegExp(`<(?:[\\w.-]+:)?${nazwa}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nazwa}>`).exec(o.xml);
  if (!m) return null;
  const include = /<(?:[\w.-]+:)?Include\b[^>]*\bhref\s*=\s*"cid:([^"]+)"/.exec(m[1]);
  if (include) {
    const cid = decodeURIComponent(include[1]);
    const dane = o.czesci.get(cid);
    if (!dane) throw new AppError('ewdUnexpectedAnswer', { http: 200 });
    return dane;
  }
  const b64 = m[1].replace(/\s+/g, '');
  return b64 ? Buffer.from(b64, 'base64') : null;
}

/** The reason of a SOAP 1.2 fault (or a 1.1 one), null when the answer is none. */
const powodBledu = (xml: string): string | null => {
  if (!/<(?:[\w.-]+:)?Fault[\s>]/.test(xml)) return null;
  return (pole(xml, 'Text') ?? pole(xml, 'faultstring') ?? '').trim() || 'SOAP Fault';
};

/**
 * One call. A fault, or a connection that never opened, is `BramkaNiePrzyjela` — the request certainly did
 * not get in; a timeout or a dropped connection is a plain Error — it may have.
 */
async function wywolaj(fetchFn: EwdFetch, srodowisko: ZusSrodowisko, operacja: string, pola: Pole[]): Promise<Odpowiedz> {
  const { body, contentType } = zadanie(srodowisko, operacja, pola);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIMIT_MS);
  try {
    const res = await fetchFn(EWD_URL[srodowisko], {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(body),
      signal: ctrl.signal,
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    let odp: Odpowiedz | null = null;
    try {
      odp = czytajOdpowiedz(bytes, res.headers.get('content-type') ?? '');
    } catch {
      odp = null;
    }
    const fault = odp ? powodBledu(odp.xml) : null;
    // WCF answers a fault with HTTP 500 — its text says more than the code.
    if (fault !== null) throw new BramkaNiePrzyjela(new AppError('ewdRejected', { detail: fault }).message);
    if (!res.ok) throw new AppError('ewdBadStatus', { http: res.status });
    if (!odp) throw new AppError('ewdUnexpectedAnswer', { http: res.status });
    return odp;
  } catch (error: unknown) {
    if (error instanceof BramkaNiePrzyjela) throw error;
    if (ctrl.signal.aborted) throw new AppError('ewdTimeout');
    if (hasAppErrorCode(error, 'ewdBadStatus') || hasAppErrorCode(error, 'ewdUnexpectedAnswer')) throw error;
    const tekst = new AppError('ewdUnreachable', { detail: error instanceof Error ? error.message : String(error) }).message;
    throw bezPolaczenia(error) ? new BramkaNiePrzyjela(tekst) : new Error(tekst);
  } finally {
    clearTimeout(timer);
  }
}

const programu = (p: ProgramEwd): Pole[] => [
  ['strNazwaProducenta', p.producent.slice(0, 64)],
  ['strNazwaOprogramowania', p.nazwa.slice(0, 64)],
  ['strWersjaOprogramowania', p.wersja.slice(0, 32)],
];

/** CheckTransmision — ZUS's echo, "testowanie połączenia": a few bytes there and back. Throws when they differ. */
export async function sprawdzPolaczenie(fetchFn: EwdFetch, srodowisko: ZusSrodowisko): Promise<void> {
  const proba = Buffer.from(`FileFunky ${randomUUID()}`, 'utf8');
  const odp = await wywolaj(fetchFn, srodowisko, 'CheckTransmision', [
    ['byDataIn', { zalacznik: proba }],
    ['uiDataInLength', String(proba.length)],
    ['uiDataOutLength', '0'],
  ]);
  const echo = binarne(odp, 'byDataOut');
  if (!echo || !echo.equals(proba)) throw new AppError('ewdUnexpectedAnswer', { http: 200 });
}

/**
 * Sends a przesyłka; ZUS's id of it, and whether the digest ZUS computed is ours — a mismatch means the bytes
 * were damaged on the way: ZUS has the przesyłka (its confirmation will say what it made of it), but it is
 * not the one signed.
 */
export async function wyslijPrzesylke(
  fetchFn: EwdFetch,
  srodowisko: ZusSrodowisko,
  program: ProgramEwd,
  przesylka: Buffer,
): Promise<{ id: string; skrotZgodny: boolean }> {
  const skrot = sha256(przesylka).toString('base64');
  const odp = await wywolaj(fetchFn, srodowisko, 'WyslijPrzesylke', [
    ['pbyPrzesylka', { zalacznik: przesylka }],
    ['uiPrzesylkaDlugosc', String(przesylka.length)],
    ...programu(program),
    ['strB64SkrotPrzesylkiIn', skrot],
    ['strTypPrzesylki', TYP_PRZESYLKI],
    ['metodaPodpisu', '0'], // qualified signature
    ['strB64SkrotPrzesylkiOut', ''],
    ['strIdentyfikator', ''],
  ]);
  const id = (pole(odp.xml, 'strIdentyfikator') ?? '').trim();
  if (!id) throw new AppError('ewdUnexpectedAnswer', { http: 200 });
  const ich = (pole(odp.xml, 'strB64SkrotPrzesylkiOut') ?? '').replace(/\s+/g, '');
  return { id, skrotZgodny: !ich || ich === skrot };
}

export interface WpisIndeksu {
  /** The id of the confirmation przesyłka — what `pobierzPotwierdzenie` takes. */
  identyfikator: string;
  typ: string;
  dataWpisu: string;
}

/** The confirmations ZUS has for a przesyłka so far — none yet is an empty list. */
export async function pobierzIndeks(fetchFn: EwdFetch, srodowisko: ZusSrodowisko, program: ProgramEwd, idPrzesylki: string): Promise<WpisIndeksu[]> {
  const odp = await wywolaj(fetchFn, srodowisko, 'PobierzIndexPrzesylek', [['strIdZadania', idPrzesylki], ...programu(program)]);
  const out: WpisIndeksu[] = [];
  const re = /<(?:[\w.-]+:)?MessageIndexElement(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?MessageIndexElement>/g;
  for (let m = re.exec(odp.xml); m; m = re.exec(odp.xml)) {
    const identyfikator = (pole(m[1], 'strIdentyfikator') ?? '').trim();
    if (identyfikator) out.push({ identyfikator, typ: (pole(m[1], 'strTyp') ?? '').trim(), dataWpisu: (pole(m[1], 'DataWpisu') ?? '').trim() });
  }
  return out;
}

/** One confirmation przesyłka, as ZUS sent it (an ASiC-S container for the SDWI3 types), its digest checked. */
export async function pobierzPotwierdzenie(fetchFn: EwdFetch, srodowisko: ZusSrodowisko, program: ProgramEwd, identyfikator: string): Promise<Buffer> {
  const odp = await wywolaj(fetchFn, srodowisko, 'PobierzPotwierdzenie', [
    ['strIdentyfikator', identyfikator],
    ...programu(program),
    // "Pole puste. Pole wymagane przez SOAP." — the required ones need a value the schema takes.
    ['strIdZadania', ''],
    ['DataWpisu', '0001-01-01T00:00:00'],
    ['strTyp', ''],
    ['uiWielkoscPrzesylki', '0'],
    ['strB64Skrot', ''],
  ]);
  const dane = binarne(odp, 'byPrzesylka');
  if (!dane || dane.length === 0) throw new AppError('ewdUnexpectedAnswer', { http: 200 });
  const skrot = (pole(odp.xml, 'strB64Skrot') ?? '').replace(/\s+/g, '');
  const typ = (pole(odp.xml, 'strTyp') ?? '').trim();
  const nasz = createHash(typ.startsWith('SDWI2') ? 'sha1' : 'sha256').update(dane).digest('base64');
  if (skrot && skrot !== nasz) throw new AppError('ewdDigestMismatch', { id: identyfikator });
  return dane;
}

/* ================================ the confirmation ================================ */

/** The fields of a POSWIADCZENIE_PRZEDLOZENIA (Załącznik 3), from the container ZUS sent. */
export function czytajPotwierdzenie(
  kontener: Buffer,
  id: string,
): Omit<ZusPotwierdzenie, 'at' | 'plik' | 'kontener'> & { idPrzesylki: string } {
  let xml: string;
  try {
    xml = otworzAsicS(kontener).dane.toString('utf8');
  } catch (error: unknown) {
    throw new AppError('ewdConfirmationUnreadable', { detail: error instanceof Error ? error.message : String(error) });
  }
  if (!/POSWIADCZENIE_PRZEDLOZENIA/.test(xml)) throw new AppError('ewdConfirmationUnreadable', { detail: 'POSWIADCZENIE_PRZEDLOZENIA' });
  const kod = (pole(xml, 'KOD_PRZYJECIA') ?? '').trim().toLowerCase();
  const bledy: ZusPotwierdzenie['bledy'] = [];
  const re = /<(?:[\w.-]+:)?BLAD(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?BLAD>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    bledy.push({ rodzaj: (pole(m[1], 'RODZAJ_BLEDU') ?? '').trim(), opis: (pole(m[1], 'OPIS_ROZWIAZANIE') ?? '').trim() });
  }
  const t = (n: string) => (pole(xml, n) ?? '').trim();
  return {
    id,
    idPrzesylki: t('ID_PRZESYLKI'),
    przyjeta: kod === 'true' || kod === '1',
    status: t('STATUS_PRZETW'),
    bledy,
    upowaznienie: t('JEST_UPOWAZNIENIE'),
    podpisal: [t('NAZWISKO_PODPIS'), t('IMIE_PODPIS')].filter(Boolean).join(' ') || t('NAZWA_PODPIS'),
    zarejestrowano: t('DATA_REJ'),
    tresc: xml,
  };
}
