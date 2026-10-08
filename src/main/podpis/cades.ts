import { createHash } from 'crypto';
import type { Certyfikat } from './certyfikat';
import { alg, ctx, nul, octets, oid, seq, setOf, small, uint } from './der';

/*
 * A detached CAdES signature (CMS SignedData) at the PAdES baseline B-B level,
 * ETSI EN 319 142-1: content-type, message-digest and signing-certificate-v2 as
 * signed attributes. No signing-time attribute — PAdES puts the time in the
 * signature dictionary's /M instead.
 */

const SHA256 = '2.16.840.1.101.3.4.2.1';
const ID_DATA = '1.2.840.113549.1.7.1';
const ID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const ATTR_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const ATTR_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const ATTR_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';
const SHA256_WITH_RSA = '1.2.840.113549.1.1.11';
const ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';

export const sha256 = (...parts: Buffer[]): Buffer => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

const atrybut = (type: string, value: Buffer): Buffer => seq(oid(type), setOf(value));

/** The signed attributes as a DER SET — exactly the bytes the card signs. */
export function atrybutyPodpisane(skrotDokumentu: Buffer, cert: Certyfikat): Buffer {
  const essCertIdV2 = seq(
    // hashAlgorithm left out: it is DEFAULT sha256, and DER omits defaults.
    octets(sha256(cert.der)),
    // issuerSerial: GeneralNames { directoryName [4] issuer }, serialNumber.
    seq(seq(ctx(4, cert.wystawcaDer)), cert.numerDer),
  );
  return setOf(
    atrybut(ATTR_CONTENT_TYPE, oid(ID_DATA)),
    atrybut(ATTR_MESSAGE_DIGEST, octets(skrotDokumentu)),
    atrybut(ATTR_SIGNING_CERTIFICATE_V2, seq(seq(essCertIdV2))),
  );
}

/** ECDSA from a PKCS#11 card is r‖s; CMS wants ECDSA-Sig-Value { r INTEGER, s INTEGER }. */
export const ecdsaDer = (rs: Buffer): Buffer => seq(uint(rs.subarray(0, rs.length / 2)), uint(rs.subarray(rs.length / 2)));

/**
 * The finished ContentInfo: SignedData over the detached document, with the
 * signer's certificate and whatever chain the card holds.
 */
export function zlozCms(o: {
  atrybuty: Buffer;
  podpis: Buffer;
  cert: Certyfikat;
  lancuch: Buffer[];
}): Buffer {
  const { cert } = o;
  const signerInfo = seq(
    small(1),
    seq(cert.wystawcaDer, cert.numerDer),
    alg(SHA256),
    // [0] IMPLICIT SignedAttributes: the very bytes that were signed, retagged SET → [0].
    Buffer.concat([Buffer.from([0xa0]), o.atrybuty.subarray(1)]),
    cert.klucz === 'rsa' ? alg(SHA256_WITH_RSA, nul()) : alg(ECDSA_WITH_SHA256),
    octets(o.podpis),
  );
  const certyfikaty = [cert.der, ...o.lancuch.filter((c) => !c.equals(cert.der))];
  const signedData = seq(
    small(1),
    setOf(alg(SHA256)),
    seq(oid(ID_DATA)),
    ctx(0, ...certyfikaty.sort(Buffer.compare)), // [0] IMPLICIT CertificateSet — a SET OF, so sorted
    setOf(signerInfo),
  );
  return seq(oid(ID_SIGNED_DATA), ctx(0, signedData));
}
