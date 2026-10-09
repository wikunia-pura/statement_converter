import { createHash, randomUUID, verify, X509Certificate, type KeyObject } from 'crypto';
import type { Certyfikat } from './certyfikat';
import { children, oidText, read, stringText, type Tlv } from './der';

/*
 * XAdES-BES, enveloped: the e-Deklaracje gateway takes the declaration XML with
 * a ds:Signature as the last child of its root. The layout below is the one the
 * Ministry's own signing tool writes (and the gateway accepts) — same elements,
 * same URIs, same line breaks — with the signer's certificate only in KeyInfo.
 *
 * The signature covers Canonical XML 1.0 (inclusive, no comments), which is
 * implemented here on a small strict XML parser: the app ships no XML-DSig
 * library and the lockfile is maintained by hand. The parser understands the
 * subset declarations are written in — elements, attributes, namespaces, text,
 * CDATA, character and predefined entity references, comments, processing
 * instructions, the XML declaration; a DTD is refused.
 */

const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const NS_XML = 'http://www.w3.org/XML/1998/namespace';
const ALG_C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ALG_XPATH = 'http://www.w3.org/TR/1999/REC-xpath-19991116';
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALG_ECDSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
const ALG_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const TYPE_SIGNED_PROPERTIES = 'http://uri.etsi.org/01903#SignedProperties';
const XPATH_NO_SIGNATURE = 'not(ancestor-or-self::ds:Signature)';
const EOL = '\r\n';

// ------------------------------------------------------------------ parser

export interface XmlAttr {
  /** Qualified name as written. */
  name: string;
  /** Namespace URI ('' = none). */
  uri: string;
  local: string;
  value: string;
}

export interface XmlText {
  kind: 'text';
  value: string;
}

export interface XmlPi {
  kind: 'pi';
  target: string;
  data: string;
}

export interface XmlElement {
  kind: 'element';
  /** Qualified name as written. */
  name: string;
  uri: string;
  local: string;
  attrs: XmlAttr[];
  /** Namespace declarations of this element only (prefix '' = default), as written. */
  declared: Map<string, string>;
  /** Every namespace in scope here, own declarations included (prefix '' = default; '' URI = none). */
  inScope: Map<string, string>;
  children: XmlNode[];
  parent: XmlElement | null;
}

export type XmlNode = XmlElement | XmlText | XmlPi;

export interface XmlDocument {
  root: XmlElement;
  /** Processing instructions before / after the root element. */
  before: XmlPi[];
  after: XmlPi[];
}

const bad = (what: string, at: number): Error => new Error(`Niepoprawny XML (znak ${at}): ${what}.`);

const WS = /[ \t\n]/;
const NAME_STOP = /[\s/>=<"'&?!]/;

function codePointText(n: number, at: number): string {
  // Char production of XML 1.0: tab, LF, CR, and the ranges that are not controls/surrogates/FFFE/FFFF.
  const ok = n === 9 || n === 10 || n === 13 || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);
  if (!ok) throw bad(`niedozwolony znak &#${n};`, at);
  return String.fromCodePoint(n);
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Expands the references of a text or attribute value; `from` is its offset in the source, for messages. */
function expand(raw: string, from: number): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(?:(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z_][\w.-]*);)?/g, (_m, ref: string | undefined, offset: number) => {
    if (ref === undefined) throw bad('samotny znak &', from + offset);
    if (ref[0] === '#') return codePointText(ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10), from + offset);
    const text = ENTITIES[ref];
    if (text === undefined) throw bad(`nieznana encja &${ref};`, from + offset);
    return text;
  });
}

/** Strict enough for declarations: throws on anything malformed rather than guessing. */
export function parsujXml(zrodlo: string): XmlDocument {
  let src = zrodlo.charCodeAt(0) === 0xfeff ? zrodlo.slice(1) : zrodlo;
  // 2.11 End-of-Line Handling: CRLF and lone CR become LF before anything else is looked at.
  src = src.replace(/\r\n?/g, '\n');
  let i = 0;
  const n = src.length;

  const skipWs = () => {
    while (i < n && WS.test(src[i])) i++;
  };
  const readName = (): string => {
    const start = i;
    while (i < n && !NAME_STOP.test(src[i])) i++;
    if (i === start) throw bad('oczekiwano nazwy', i);
    return src.slice(start, i);
  };

  if (src.startsWith('<?xml') && WS.test(src[5] ?? '')) {
    const end = src.indexOf('?>');
    if (end < 0) throw bad('niezamknięta deklaracja XML', 0);
    i = end + 2;
  }

  const before: XmlPi[] = [];
  const after: XmlPi[] = [];
  let root: XmlElement | null = null;
  let current: XmlElement | null = null;

  const pi = (): XmlPi => {
    const start = i;
    i += 2;
    const target = readName();
    const end = src.indexOf('?>', i);
    if (end < 0) throw bad('niezamknięta instrukcja przetwarzania', start);
    if (target.toLowerCase() === 'xml') throw bad('deklaracja XML poza początkiem dokumentu', start);
    const data = src.slice(i, end).replace(/^[ \t\n]+/, '');
    i = end + 2;
    return { kind: 'pi', target, data };
  };
  const comment = () => {
    const end = src.indexOf('-->', i + 4);
    if (end < 0) throw bad('niezamknięty komentarz', i);
    i = end + 3;
  };

  while (i < n) {
    if (src[i] !== '<') {
      const end = src.indexOf('<', i);
      const raw = src.slice(i, end < 0 ? n : end);
      if (!current) {
        if (raw.trim() !== '') throw bad('tekst poza elementem głównym', i);
      } else {
        if (raw.includes(']]>')) throw bad('niedozwolone „]]>” w tekście', i);
        const last = current.children[current.children.length - 1];
        const text = expand(raw, i);
        if (last?.kind === 'text') last.value += text;
        else current.children.push({ kind: 'text', value: text });
      }
      i = end < 0 ? n : end;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      comment();
    } else if (src.startsWith('<![CDATA[', i)) {
      if (!current) throw bad('CDATA poza elementem', i);
      const end = src.indexOf(']]>', i);
      if (end < 0) throw bad('niezamknięta sekcja CDATA', i);
      const text = src.slice(i + 9, end);
      const last = current.children[current.children.length - 1];
      if (last?.kind === 'text') last.value += text;
      else current.children.push({ kind: 'text', value: text });
      i = end + 3;
    } else if (src.startsWith('<!', i)) {
      throw bad('DTD / deklaracje <! nie są obsługiwane', i);
    } else if (src.startsWith('<?', i)) {
      const p = pi();
      if (current) current.children.push(p);
      else (root ? after : before).push(p);
    } else if (src.startsWith('</', i)) {
      const at = i;
      i += 2;
      const name = readName();
      skipWs();
      if (src[i] !== '>') throw bad('oczekiwano „>”', i);
      i++;
      if (!current || current.name !== name) throw bad(`zamknięcie </${name}> bez pasującego otwarcia`, at);
      current = current.parent;
    } else {
      const at = i;
      if (!current && root) throw bad('drugi element główny', at);
      i++;
      const name = readName();
      const raw: { name: string; value: string }[] = [];
      let selfClosing = false;
      for (;;) {
        const hadWs = i < n && WS.test(src[i]);
        skipWs();
        if (i >= n) throw bad('niezamknięty znacznik', at);
        if (src[i] === '>') {
          i++;
          break;
        }
        if (src[i] === '/') {
          if (src[i + 1] !== '>') throw bad('oczekiwano „/>”', i);
          i += 2;
          selfClosing = true;
          break;
        }
        if (!hadWs) throw bad('brak odstępu przed atrybutem', i);
        const attrName = readName();
        skipWs();
        if (src[i] !== '=') throw bad(`atrybut ${attrName} bez wartości`, i);
        i++;
        skipWs();
        const quote = src[i];
        if (quote !== '"' && quote !== "'") throw bad(`wartość atrybutu ${attrName} bez cudzysłowu`, i);
        const end = src.indexOf(quote, i + 1);
        if (end < 0) throw bad('niezamknięty atrybut', i);
        const rawValue = src.slice(i + 1, end);
        if (rawValue.includes('<')) throw bad('znak „<” w wartości atrybutu', i);
        // 3.3.3 attribute-value normalization: literal whitespace becomes a space, references are expanded after.
        raw.push({ name: attrName, value: expand(rawValue.replace(/[\t\n]/g, ' '), i + 1) });
        if (raw.filter((a) => a.name === attrName).length > 1) throw bad(`powtórzony atrybut ${attrName}`, i);
        i = end + 1;
      }

      const declared = new Map<string, string>();
      for (const a of raw) {
        if (a.name === 'xmlns') declared.set('', a.value);
        else if (a.name.startsWith('xmlns:')) {
          const prefix = a.name.slice(6);
          if (a.value === '') throw bad(`pusta deklaracja przestrzeni nazw ${prefix}`, at);
          declared.set(prefix, a.value);
        }
      }
      const inScope = new Map(current?.inScope ?? []);
      for (const [p, u] of declared) inScope.set(p, u);
      const resolve = (qname: string, isAttr: boolean): { uri: string; local: string } => {
        const colon = qname.indexOf(':');
        if (colon < 0) return { uri: isAttr ? '' : (inScope.get('') ?? ''), local: qname };
        const prefix = qname.slice(0, colon);
        const uri = prefix === 'xml' ? NS_XML : inScope.get(prefix);
        if (uri === undefined) throw bad(`nieznany prefiks przestrzeni nazw „${prefix}”`, at);
        return { uri, local: qname.slice(colon + 1) };
      };
      const attrs: XmlAttr[] = raw
        .filter((a) => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))
        .map((a) => ({ name: a.name, value: a.value, ...resolve(a.name, true) }));
      const el: XmlElement = { kind: 'element', name, ...resolve(name, false), attrs, declared, inScope, children: [], parent: current };
      if (current) current.children.push(el);
      else root = el;
      if (!selfClosing) current = el;
    }
  }
  if (current) throw bad(`element <${current.name}> nie został zamknięty`, n);
  if (!root) throw bad('brak elementu głównego', 0);
  return { root, before, after };
}

// ------------------------------------------------------------ canonical XML

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const jestPodpisem = (el: XmlElement): boolean => el.uri === NS_DS && el.local === 'Signature';

interface OpcjeKanoniczne {
  /** Leave out every ds:Signature element and what is inside — the XPath `not(ancestor-or-self::ds:Signature)`. */
  bezPodpisow?: boolean;
}

function renderElement(el: XmlElement, rendered: Map<string, string>, o: OpcjeKanoniczne): string {
  // Namespace nodes: those in scope whose value differs from what the nearest output ancestor already declares.
  const prefixes = new Set([...el.inScope.keys(), ...rendered.keys()]);
  const declarations: [string, string][] = [];
  for (const p of prefixes) {
    if (p === 'xml') continue;
    const now = el.inScope.get(p) ?? '';
    if (now !== (rendered.get(p) ?? '')) declarations.push([p, now]);
  }
  declarations.sort((a, b) => compare(a[0], b[0]));
  const attrs = [...el.attrs].sort((a, b) => compare(a.uri, b.uri) || compare(a.local, b.local));

  let out = `<${el.name}`;
  for (const [p, u] of declarations) out += ` ${p === '' ? 'xmlns' : `xmlns:${p}`}="${escapeAttr(u)}"`;
  for (const a of attrs) out += ` ${a.name}="${escapeAttr(a.value)}"`;
  out += '>';

  const next = new Map(rendered);
  for (const [p, u] of declarations) next.set(p, u);
  for (const c of el.children) {
    if (c.kind === 'text') out += escapeText(c.value);
    else if (c.kind === 'pi') out += `<?${c.target}${c.data ? ` ${c.data}` : ''}?>`;
    else if (!(o.bezPodpisow && jestPodpisem(c))) out += renderElement(c, next, o);
  }
  return `${out}</${el.name}>`;
}

/**
 * Canonical XML 1.0 of an element subtree, comments left out — the element is
 * the apex, so it carries every namespace declaration in scope from its
 * ancestors, as the spec has it for a node-set made of a subtree.
 */
export function kanoniczny(el: XmlElement, opcje: OpcjeKanoniczne = {}): string {
  return renderElement(el, new Map(), opcje);
}

/** Canonical XML 1.0 of the whole document (its processing instructions included; XML declaration, comments and DOCTYPE never are). */
export function kanonicznyDokument(doc: XmlDocument, opcje: OpcjeKanoniczne = {}): string {
  const pi = (p: XmlPi) => `<?${p.target}${p.data ? ` ${p.data}` : ''}?>`;
  return (
    doc.before.map((p) => `${pi(p)}\n`).join('') + kanoniczny(doc.root, opcje) + doc.after.map((p) => `\n${pi(p)}`).join('')
  );
}

// ------------------------------------------------------------------ helpers

const sha256 = (data: string | Buffer): Buffer => createHash('sha256').update(data).digest();
const utf8 = (s: string): Buffer => Buffer.from(s, 'utf8');

/** Base64 as the Ministry's tool writes it: 64-character lines, CRLF between them, none at the ends. */
const base64Zawiniete = (b: Buffer): string => (b.toString('base64').match(/.{1,64}/g) ?? []).join(EOL);

/** Direct element children with the given namespace and local name. */
const dzieci = (el: XmlElement, uri: string, local: string): XmlElement[] =>
  el.children.filter((c): c is XmlElement => c.kind === 'element' && c.uri === uri && c.local === local);

/** Text of an element with all whitespace dropped — base64 values come wrapped. */
const tekst = (el: XmlElement): string =>
  el.children.map((c) => (c.kind === 'text' ? c.value : '')).join('');

function szukaj(el: XmlElement, uri: string, local: string): XmlElement | null {
  if (el.uri === uri && el.local === local) return el;
  for (const c of el.children) {
    if (c.kind !== 'element') continue;
    const found = szukaj(c, uri, local);
    if (found) return found;
  }
  return null;
}

function szukajWszystkie(el: XmlElement, uri: string, local: string, out: XmlElement[] = []): XmlElement[] {
  if (el.uri === uri && el.local === local) out.push(el);
  for (const c of el.children) if (c.kind === 'element') szukajWszystkie(c, uri, local, out);
  return out;
}

function poId(el: XmlElement, id: string): XmlElement | null {
  if (el.attrs.some((a) => a.uri === '' && (a.local === 'Id' || a.local === 'ID' || a.local === 'id') && a.value === id)) return el;
  for (const c of el.children) {
    if (c.kind !== 'element') continue;
    const found = poId(c, id);
    if (found) return found;
  }
  return null;
}

/** ECDSA-Sig-Value { r, s } (what the card session returns) → r‖s of fixed width, the form XML-DSig wants. */
export function ecdsaDerNaRs(der: Buffer, rozmiar: number): Buffer {
  const [r, s] = children(read(der));
  const fit = (t: Tlv): Buffer => {
    let b = t.body;
    while (b.length > rozmiar && b[0] === 0) b = b.subarray(1);
    if (b.length > rozmiar) throw new Error('Podpis ECDSA ma nieoczekiwaną długość.');
    return Buffer.concat([Buffer.alloc(rozmiar - b.length), b]);
  };
  return Buffer.concat([fit(r), fit(s)]);
}

// ------------------------------------------------- issuer name, RFC 2253 form

/** The keywords Java's X500Principal.getName(RFC2253) knows — what the Ministry's tool writes; everything else is `OID=#DER`. */
const KEYWORDS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'STREET',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '0.9.2342.19200300.100.1.25': 'DC',
  '0.9.2342.19200300.100.1.1': 'UID',
};
/** UTF8String, PrintableString, TeletexString, IA5String, BMPString. */
const STRING_TAGS = new Set([0x0c, 0x13, 0x14, 0x16, 0x1e]);

function escapeRfc2253(value: string): string {
  let out = value.replace(/[,+"\\<>;]/g, (c) => `\\${c}`);
  if (/^[# ]/.test(out)) out = `\\${out}`;
  if (/ $/.test(out)) out = `${out.slice(0, -1)}\\ `;
  return out;
}

/** An X.501 Name as `X509IssuerName` carries it: RDNs last to first, multi-valued ones joined with "+". */
export function nazwaRfc2253(name: Buffer): string {
  return children(read(name))
    .reverse()
    .map((rdn) =>
      children(rdn)
        .map((atv) => {
          const [type, value] = children(atv);
          const id = oidText(type);
          const keyword = KEYWORDS[id];
          return keyword && STRING_TAGS.has(value.tag) ? `${keyword}=${escapeRfc2253(stringText(value))}` : `${id}=#${value.raw.toString('hex')}`;
        })
        .join('+'),
    )
    .join(',');
}

// ------------------------------------------------------------------ signing

export interface PodpisXml {
  cert: Certyfikat;
  /** CA certificates the card holds — accepted so the options look like `podpiszPdf`'s; the signature carries the signer's certificate only. */
  lancuch: Buffer[];
  /** Signs the canonical SignedInfo (UTF-8 bytes): the card hashes with SHA-256 and signs, RSA PKCS#1 v1.5 or ECDSA (DER, as the session returns it). */
  podpisz: (dane: Buffer) => Promise<Buffer>;
  /** SigningTime; now by default. */
  czas?: Date;
}

interface Identyfikatory {
  podpis: string;
  signedInfo: string;
  refDokument: string;
  refWlasciwosci: string;
  wartosc: string;
  wlasciwosci: string;
  signedProperties: string;
}

/** The ds:Signature element, byte for byte the Ministry tool's layout. */
function zlozPodpis(o: {
  id: Identyfikatory;
  rsa: boolean;
  skrotDokumentu: string;
  skrotWlasciwosci: string;
  wartosc: string;
  cert: Certyfikat;
  czas: string;
}): string {
  const { id, cert } = o;
  const x509 = new X509Certificate(cert.der);
  const serial = BigInt(`0x${x509.serialNumber}`).toString(10);
  return (
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${id.podpis}">${EOL}` +
    `<ds:SignedInfo Id="${id.signedInfo}"><ds:CanonicalizationMethod Algorithm="${ALG_C14N}"/>${EOL}` +
    `<ds:SignatureMethod Algorithm="${o.rsa ? ALG_RSA_SHA256 : ALG_ECDSA_SHA256}"/>${EOL}` +
    `<ds:Reference Id="${id.refDokument}" URI=""><ds:Transforms><ds:Transform Algorithm="${ALG_XPATH}">` +
    `<ds:XPath xmlns="${NS_XADES}">${XPATH_NO_SIGNATURE}</ds:XPath>${EOL}</ds:Transform>${EOL}</ds:Transforms>${EOL}` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"/>${EOL}` +
    `<ds:DigestValue>${o.skrotDokumentu}</ds:DigestValue>${EOL}</ds:Reference>${EOL}` +
    `<ds:Reference Id="${id.refWlasciwosci}" Type="${TYPE_SIGNED_PROPERTIES}" URI="#${id.signedProperties}">` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"/>${EOL}` +
    `<ds:DigestValue>${o.skrotWlasciwosci}</ds:DigestValue>${EOL}</ds:Reference>${EOL}</ds:SignedInfo>${EOL}` +
    `<ds:SignatureValue Id="${id.wartosc}">${o.wartosc}</ds:SignatureValue>${EOL}` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${base64Zawiniete(cert.der)}</ds:X509Certificate>${EOL}</ds:X509Data>${EOL}</ds:KeyInfo>${EOL}` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${NS_XADES}" Id="${id.wlasciwosci}" Target="#${id.podpis}">` +
    `<xades:SignedProperties Id="${id.signedProperties}"><xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${o.czas}</xades:SigningTime>${EOL}` +
    `<xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="${ALG_SHA256}"/>${EOL}` +
    `<ds:DigestValue>${sha256(cert.der).toString('base64')}</ds:DigestValue>${EOL}</xades:CertDigest>${EOL}` +
    `<xades:IssuerSerial><ds:X509IssuerName>${escapeText(nazwaRfc2253(cert.wystawcaDer))}</ds:X509IssuerName>${EOL}` +
    `<ds:X509SerialNumber>${serial}</ds:X509SerialNumber>${EOL}</xades:IssuerSerial>${EOL}</xades:Cert>${EOL}` +
    `</xades:SigningCertificate>${EOL}</xades:SignedSignatureProperties>${EOL}` +
    `<xades:SignedDataObjectProperties><xades:DataObjectFormat ObjectReference="#${id.refDokument}">` +
    `<xades:Description>Dokument w formacie xml [XML]</xades:Description>${EOL}` +
    `<xades:MimeType>application/octet-stream</xades:MimeType>${EOL}</xades:DataObjectFormat>${EOL}` +
    `<xades:CommitmentTypeIndication><xades:CommitmentTypeId>` +
    `<xades:Identifier>http://uri.etsi.org/01903/v1.2.2#ProofOfApproval</xades:Identifier>${EOL}</xades:CommitmentTypeId>${EOL}` +
    `<xades:AllSignedDataObjects/>${EOL}</xades:CommitmentTypeIndication>${EOL}</xades:SignedDataObjectProperties>${EOL}` +
    `</xades:SignedProperties>${EOL}</xades:QualifyingProperties>${EOL}</ds:Object>${EOL}</ds:Signature>`
  );
}

/**
 * Signs a declaration with the card: the ds:Signature goes in as the last child
 * of the root element, right before its closing tag, and the signed XML is
 * returned. The XML must already be in the form to be sent — whitespace
 * included, it is all part of what is signed; nothing may be changed in it
 * afterwards except what precedes the root (BOM, XML declaration, comments).
 * A leading BOM is dropped from the result, as the Ministry's files have none.
 */
export async function podpiszXml(xml: string, o: PodpisXml): Promise<string> {
  const source = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const doc = parsujXml(source);
  if (szukaj(doc.root, NS_DS, 'Signature')) throw new Error('Deklaracja jest już podpisana.');
  if (o.cert.klucz === 'inny') throw new Error('Klucz tego certyfikatu nie jest ani RSA, ani EC — nie umiem nim podpisać.');
  const rsa = o.cert.klucz === 'rsa';

  // The signature goes before the root's closing tag; anything but whitespace and PIs/comments may not follow it.
  const closing = `</${doc.root.name}`;
  const at = source.lastIndexOf(closing);
  if (at < 0 || !/^\s*>/.test(source.slice(at + closing.length))) {
    throw new Error('Nie da się podpisać tego XML: element główny musi mieć osobny znacznik zamykający.');
  }

  const uuid = () => `ID-${randomUUID()}`;
  const id: Identyfikatory = {
    podpis: uuid(),
    signedInfo: uuid(),
    refDokument: uuid(),
    refWlasciwosci: uuid(),
    wartosc: uuid(),
    wlasciwosci: uuid(),
    signedProperties: uuid(),
  };
  const czas = (o.czas ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const placeholder = Buffer.alloc(32).toString('base64');
  const compose = (skrotWlasciwosci: string, wartosc: string): string =>
    zlozPodpis({ id, rsa, skrotDokumentu, skrotWlasciwosci, wartosc, cert: o.cert, czas });
  const insert = (signature: string): string => `${source.slice(0, at)}${signature}${source.slice(at)}`;

  // Reference 1: the document without the signature — canonical form of the XML as it stands now.
  const skrotDokumentu = sha256(utf8(kanonicznyDokument(doc, { bezPodpisow: true }))).toString('base64');

  // Reference 2: SignedProperties, canonicalized in place (it inherits the root's namespace declarations).
  const withProperties = parsujXml(insert(compose(placeholder, placeholder)));
  const last = withProperties.root.children.filter((c): c is XmlElement => c.kind === 'element').pop();
  if (!last || !jestPodpisem(last)) throw new Error('Nie da się podpisać tego XML: podpis nie trafił na koniec elementu głównego.');
  const properties = szukaj(withProperties.root, NS_XADES, 'SignedProperties');
  if (!properties) throw new Error('XAdES: nie złożono SignedProperties.');
  const skrotWlasciwosci = sha256(utf8(kanoniczny(properties))).toString('base64');

  // The signature over SignedInfo as it will be written, digests included.
  const withInfo = parsujXml(insert(compose(skrotWlasciwosci, placeholder)));
  const signedInfo = szukaj(withInfo.root, NS_DS, 'SignedInfo');
  if (!signedInfo) throw new Error('XAdES: nie złożono SignedInfo.');
  const dane = utf8(kanoniczny(signedInfo));
  const raw = await o.podpisz(dane);
  const podpis = rsa ? raw : ecdsaDerNaRs(raw, o.cert.rozmiarKlucza);

  const key = new X509Certificate(o.cert.der).publicKey;
  if (!weryfikujPodpis(key, dane, podpis)) {
    throw new Error('Karta zwróciła podpis, który nie pasuje do certyfikatu. Sprawdź, czy wybrano właściwy certyfikat.');
  }
  return insert(compose(skrotWlasciwosci, base64Zawiniete(podpis)));
}

function weryfikujPodpis(key: KeyObject, dane: Buffer, podpis: Buffer): boolean {
  try {
    return key.asymmetricKeyType === 'ec'
      ? verify('sha256', dane, { key, dsaEncoding: 'ieee-p1363' }, podpis)
      : verify('sha256', dane, key, podpis);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- verification

export interface WynikWeryfikacji {
  /** Per Reference, in order: the digest in the signature equals the one recomputed. */
  skroty: boolean[];
  /** SignatureValue verifies over canonical SignedInfo with the certificate in KeyInfo. */
  podpis: boolean;
  /** X509IssuerName in the signature equals the issuer of the embedded certificate, written RFC 2253-style. */
  wystawca: boolean;
  /** What could not be checked or went wrong — empty when everything held. */
  uwagi: string[];
}

const HASHES: Record<string, string> = {
  'http://www.w3.org/2000/09/xmldsig#sha1': 'sha1',
  'http://www.w3.org/2001/04/xmlenc#sha256': 'sha256',
  'http://www.w3.org/2001/04/xmldsig-more#sha384': 'sha384',
  'http://www.w3.org/2001/04/xmlenc#sha512': 'sha512',
};
const SIGNATURES: Record<string, { hash: string; ec: boolean }> = {
  'http://www.w3.org/2000/09/xmldsig#rsa-sha1': { hash: 'sha1', ec: false },
  [ALG_RSA_SHA256]: { hash: 'sha256', ec: false },
  [ALG_ECDSA_SHA256]: { hash: 'sha256', ec: true },
};

const algorytm = (el: XmlElement | undefined): string => el?.attrs.find((a) => a.name === 'Algorithm')?.value ?? '';
const atrybut = (el: XmlElement, name: string): string | undefined => el.attrs.find((a) => a.name === name)?.value;
const bezBialych = (s: string): string => s.replace(/\s+/g, '');

/**
 * Checks the first ds:Signature of a signed document the way a receiving side
 * would: every Reference digest, then the signature value with the embedded
 * certificate's key. Supports the algorithms and transforms the Ministry's tool
 * and `podpiszXml` produce; anything else is reported in `uwagi`.
 */
export function sprawdzPodpisXml(xml: string): WynikWeryfikacji {
  const wynik: WynikWeryfikacji = { skroty: [], podpis: false, wystawca: false, uwagi: [] };
  const doc = parsujXml(xml);
  const signature = szukaj(doc.root, NS_DS, 'Signature');
  if (!signature) {
    wynik.uwagi.push('brak ds:Signature');
    return wynik;
  }
  const signedInfo = dzieci(signature, NS_DS, 'SignedInfo')[0];
  if (!signedInfo) {
    wynik.uwagi.push('brak ds:SignedInfo');
    return wynik;
  }
  if (algorytm(dzieci(signedInfo, NS_DS, 'CanonicalizationMethod')[0]) !== ALG_C14N) {
    wynik.uwagi.push('nieobsługiwana kanonikalizacja');
    return wynik;
  }

  for (const ref of dzieci(signedInfo, NS_DS, 'Reference')) {
    try {
      const uri = atrybut(ref, 'URI') ?? '';
      const transforms = dzieci(ref, NS_DS, 'Transforms')[0];
      let bezPodpisow = false;
      for (const t of transforms ? dzieci(transforms, NS_DS, 'Transform') : []) {
        const a = algorytm(t);
        const xpath = dzieci(t, NS_DS, 'XPath')[0];
        if (a === ALG_ENVELOPED || (a === ALG_XPATH && xpath && bezBialych(tekst(xpath)) === XPATH_NO_SIGNATURE)) bezPodpisow = true;
        else if (a !== ALG_C14N) throw new Error(`nieobsługiwana transformacja ${a}`);
      }
      let canonical: string;
      if (uri === '') canonical = kanonicznyDokument(doc, { bezPodpisow });
      else if (uri.startsWith('#')) {
        const target = poId(doc.root, uri.slice(1));
        if (!target) throw new Error(`brak elementu ${uri}`);
        canonical = kanoniczny(target, { bezPodpisow });
      } else throw new Error(`nieobsługiwany URI ${uri}`);
      const hash = HASHES[algorytm(dzieci(ref, NS_DS, 'DigestMethod')[0])];
      if (!hash) throw new Error('nieobsługiwany algorytm skrótu');
      const expected = dzieci(ref, NS_DS, 'DigestValue')[0];
      if (!expected) throw new Error('brak DigestValue');
      wynik.skroty.push(createHash(hash).update(utf8(canonical)).digest('base64') === bezBialych(tekst(expected)));
    } catch (error: unknown) {
      wynik.skroty.push(false);
      wynik.uwagi.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const method = SIGNATURES[algorytm(dzieci(signedInfo, NS_DS, 'SignatureMethod')[0])];
    if (!method) throw new Error('nieobsługiwany algorytm podpisu');
    const certEl = szukaj(signature, NS_DS, 'X509Certificate');
    if (!certEl) throw new Error('brak certyfikatu w KeyInfo');
    const der = Buffer.from(bezBialych(tekst(certEl)), 'base64');
    const x509 = new X509Certificate(der);
    const value = dzieci(signature, NS_DS, 'SignatureValue')[0];
    if (!value) throw new Error('brak SignatureValue');
    const sig = Buffer.from(bezBialych(tekst(value)), 'base64');
    const data = utf8(kanoniczny(signedInfo));
    const key = x509.publicKey;
    wynik.podpis = method.ec
      ? verify(method.hash, data, { key, dsaEncoding: 'ieee-p1363' }, sig)
      : verify(method.hash, data, key, sig);

    const issuerName = szukaj(signature, NS_DS, 'X509IssuerName');
    if (issuerName) {
      const issuer = children(children(read(der))[0]);
      const i = issuer[0].tag === 0xa0 ? 1 : 0;
      wynik.wystawca = tekst(issuerName) === nazwaRfc2253(issuer[i + 2].raw);
    }
    // The CertDigest of SigningCertificate must be the embedded certificate's.
    for (const digest of szukajWszystkie(signature, NS_XADES, 'CertDigest')) {
      const v = dzieci(digest, NS_DS, 'DigestValue')[0];
      if (!v || bezBialych(tekst(v)) !== sha256(der).toString('base64')) wynik.uwagi.push('CertDigest nie pasuje do certyfikatu');
    }
  } catch (error: unknown) {
    wynik.uwagi.push(error instanceof Error ? error.message : String(error));
  }
  return wynik;
}
