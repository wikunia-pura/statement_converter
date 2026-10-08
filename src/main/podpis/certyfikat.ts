import { X509Certificate } from 'crypto';
import type { PodpisCertyfikat } from '../../shared/types';
import { children, oid, oidText, read, stringText, type Tlv } from './der';

const OID_CN = '2.5.4.3';
const OID_NAZWISKO = '2.5.4.4';
const OID_IMIE = '2.5.4.42';
const OID_O = '2.5.4.10';
const OID_KEY_USAGE = '2.5.29.15';
const OID_QC_STATEMENTS = '1.3.6.1.5.5.7.1.3';
/** ETSI EN 319 412-5 QcCompliance: "this is an EU qualified certificate". */
const OID_QC_COMPLIANCE = '0.4.0.1862.1.1';

/** A certificate as the signature needs it: the DER, the parts copied verbatim, and its description. */
export interface Certyfikat extends Omit<PodpisCertyfikat, 'id'> {
  der: Buffer;
  /** The issuer Name element — IssuerAndSerialNumber and ESSCertIDv2 copy it byte for byte. */
  wystawcaDer: Buffer;
  /** The serialNumber INTEGER element. */
  numerDer: Buffer;
  /** A CA certificate the card keeps for the chain — embedded, never offered for signing. */
  ca: boolean;
  /** RSA modulus or EC field size in bytes — how long the card's signature is. */
  rozmiarKlucza: number;
}

/** Name attributes by OID, first occurrence wins. */
function nazwa(name: Tlv): Map<string, string> {
  const out = new Map<string, string>();
  for (const rdn of children(name)) {
    for (const atv of children(rdn)) {
      const [type, value] = children(atv);
      const key = oidText(type);
      if (!out.has(key)) out.set(key, stringText(value).trim());
    }
  }
  return out;
}

/** UTCTime (YYMMDDHHMMSSZ) or GeneralizedTime (YYYYMMDDHHMMSSZ), as ISO. */
function czas(t: Tlv): string {
  const s = t.body.toString('latin1');
  const full = t.tag === 0x17 ? `${Number(s.slice(0, 2)) < 50 ? '20' : '19'}${s}` : s;
  const iso = `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}T${full.slice(8, 10)}:${full.slice(10, 12)}:${full.slice(12, 14)}Z`;
  return new Date(iso).toISOString();
}

export function czytajCertyfikat(der: Buffer): Certyfikat {
  const tbs = children(read(der))[0];
  const pola = children(tbs);
  const i = pola[0].tag === 0xa0 ? 1 : 0; // [0] version is optional (v1 certificates)
  const numer = pola[i];
  const wystawca = pola[i + 2];
  const [od, do_] = children(pola[i + 3]);
  const podmiot = pola[i + 4];

  let doPodpisu = false;
  let kwalifikowany = false;
  const rozszerzenia = pola.find((p) => p.tag === 0xa3);
  if (rozszerzenia) {
    for (const ext of children(children(rozszerzenia)[0])) {
      const parts = children(ext);
      const id = oidText(parts[0]);
      const value = parts[parts.length - 1].body; // extnValue, after the optional `critical`
      if (id === OID_KEY_USAGE) {
        const bits = read(value).body; // BIT STRING: unused-bits count, then the flags
        doPodpisu = bits.length > 1 && (bits[1] & 0x40) !== 0; // nonRepudiation (contentCommitment)
      } else if (id === OID_QC_STATEMENTS) {
        kwalifikowany = value.includes(oid(OID_QC_COMPLIANCE));
      }
    }
  }

  const p = nazwa(podmiot);
  const w = nazwa(wystawca);
  const x509 = new X509Certificate(der);
  const typ = x509.publicKey.asymmetricKeyType;
  const details = x509.publicKey.asymmetricKeyDetails;
  const rozmiarKlucza =
    typ === 'rsa'
      ? Math.ceil((details?.modulusLength ?? 2048) / 8)
      : ({ prime256v1: 32, secp384r1: 48, secp521r1: 66 } as Record<string, number>)[details?.namedCurve ?? ''] ?? 66;

  return {
    der,
    wystawcaDer: wystawca.raw,
    numerDer: numer.raw,
    podmiot:
      p.get(OID_CN) || [p.get(OID_IMIE), p.get(OID_NAZWISKO)].filter(Boolean).join(' ') || p.get(OID_O) || '—',
    wystawca: w.get(OID_CN) || w.get(OID_O) || '—',
    numerSeryjny: x509.serialNumber.toUpperCase(),
    waznyOd: czas(od),
    waznyDo: czas(do_),
    kwalifikowany,
    doPodpisu,
    klucz: typ === 'rsa' ? 'rsa' : typ === 'ec' ? 'ec' : 'inny',
    ca: x509.ca,
    rozmiarKlucza,
  };
}
