/**
 * Just enough DER to build a CAdES signature and to read a certificate — the
 * structures are fixed, so a few encoders and a TLV reader beat a dependency.
 * Single-byte tags only (all CMS and X.509 needs); lengths in definite form.
 */

const length = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};

/** One TLV: tag, length, the parts concatenated as the value. */
export const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};

export const seq = (...parts: Buffer[]): Buffer => tlv(0x30, ...parts);

/** SET OF — DER wants the elements in ascending order of their encodings. */
export const setOf = (...parts: Buffer[]): Buffer => tlv(0x31, ...[...parts].sort(Buffer.compare));

export const octets = (b: Buffer): Buffer => tlv(0x04, b);

export const nul = (): Buffer => Buffer.from([0x05, 0x00]);

/** [n] EXPLICIT, or the constructed [n] IMPLICIT of a SET/SEQUENCE body. */
export const ctx = (n: number, ...parts: Buffer[]): Buffer => tlv(0xa0 | n, ...parts);

export const small = (n: number): Buffer => tlv(0x02, Buffer.from([n]));

/** An unsigned big-endian integer as DER INTEGER: no extra leading zeros, a 0x00 before a high bit. */
export const uint = (b: Buffer): Buffer => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.subarray(i);
  return tlv(0x02, v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v);
};

export const oid = (dotted: string): Buffer => {
  const arcs = dotted.split('.').map(Number);
  const out = [40 * arcs[0] + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunk = [arc & 0x7f];
    for (let v = Math.floor(arc / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};

/** An AlgorithmIdentifier; `params` NULL where the algorithm wants it (RSA). */
export const alg = (dotted: string, params?: Buffer): Buffer => seq(oid(dotted), ...(params ? [params] : []));

// ------------------------------------------------------------------ reading

export interface Tlv {
  tag: number;
  /** The whole element, header included — what goes back into a structure verbatim. */
  raw: Buffer;
  /** The value only. */
  body: Buffer;
}

/** The element starting at `at`. Throws on anything a DER certificate cannot contain. */
export function read(buf: Buffer, at = 0): Tlv {
  if (at + 2 > buf.length) throw new Error('DER: koniec danych');
  const tag = buf[at];
  if ((tag & 0x1f) === 0x1f) throw new Error('DER: znacznik wielobajtowy');
  let len = buf[at + 1];
  let head = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('DER: nieobsługiwana długość');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i];
    head += n;
  }
  const end = at + head + len;
  if (end > buf.length) throw new Error('DER: element dłuższy niż dane');
  return { tag, raw: buf.subarray(at, end), body: buf.subarray(at + head, end) };
}

/** The elements inside a constructed one, in order. */
export function children(t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = 0; at < t.body.length; ) {
    const c = read(t.body, at);
    out.push(c);
    at += c.raw.length;
  }
  return out;
}

/** An OBJECT IDENTIFIER's value, dotted. */
export function oidText(t: Tlv): string {
  const b = t.body;
  const arcs = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      arcs.push(v);
      v = 0;
    }
  }
  return arcs.join('.');
}

/** A directory string as text — UTF8, Printable/IA5/Teletex (Latin-1) or BMP (UTF-16BE). */
export function stringText(t: Tlv): string {
  switch (t.tag) {
    case 0x0c:
      return t.body.toString('utf8');
    case 0x1e: {
      const swapped = Buffer.from(t.body);
      swapped.swap16();
      return swapped.toString('utf16le');
    }
    default:
      return t.body.toString('latin1');
  }
}
