import { constants, createCipheriv, publicEncrypt, randomBytes, X509Certificate } from 'crypto';
import { czytajCertyfikat } from './certyfikat';
import { alg, ctx, ctxPrim, nul, octets, oid, seq, setOf, small } from './der';

/*
 * A CMS EnvelopedData (RFC 5652 §6) for one recipient: the content encrypted
 * with a fresh AES-256-CBC key, the key encrypted to the recipient's RSA
 * certificate (PKCS#1 v1.5 key transport, the recipient named by issuer and
 * serial number). Version 0 — no originator info, one key-transport recipient
 * of version 0, no unprotected attributes — as ZUS's EWD specification has it
 * for the envelope of a przesyłka.
 */

const ID_DATA = '1.2.840.113549.1.7.1';
const ID_ENVELOPED_DATA = '1.2.840.113549.1.7.3';
const RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const AES256_CBC = '2.16.840.1.101.3.4.1.42';

/** The finished ContentInfo of `dane` enveloped to the holder of `odbiorca` (DER). */
export function kopertaCms(dane: Buffer, odbiorca: Buffer): Buffer {
  const cert = czytajCertyfikat(odbiorca);
  const klucz = new X509Certificate(odbiorca).publicKey;
  if (klucz.asymmetricKeyType !== 'rsa') throw new Error('CMS: the recipient certificate holds no RSA key');

  const kluczSesji = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', kluczSesji, iv); // PKCS#7 padding by default, as CMS wants
  const szyfrogram = Buffer.concat([cipher.update(dane), cipher.final()]);
  const zaszyfrowanyKlucz = publicEncrypt({ key: klucz, padding: constants.RSA_PKCS1_PADDING }, kluczSesji);

  const odbiorcaInfo = seq(
    small(0),
    seq(cert.wystawcaDer, cert.numerDer), // IssuerAndSerialNumber
    alg(RSA_ENCRYPTION, nul()),
    octets(zaszyfrowanyKlucz),
  );
  const envelopedData = seq(
    small(0),
    setOf(odbiorcaInfo),
    seq(oid(ID_DATA), alg(AES256_CBC, octets(iv)), ctxPrim(0, szyfrogram)),
  );
  return seq(oid(ID_ENVELOPED_DATA), ctx(0, envelopedData));
}
