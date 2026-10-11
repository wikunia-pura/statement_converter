import type { PodpisPdfAnaliza } from '../../shared/types';
import { przeszkodaPodpisuXml } from './xades';

/*
 * Whether an XML dropped into the Podpis module can be signed by this app —
 * the twin of `pdfAnaliza.ts`. The signature is XAdES enveloped, the same one
 * the PIT and CIT declarations get (`podpiszXml`): it goes inside the file, as
 * the last child of the root, and everything else stays byte for byte.
 *
 * The file is read as UTF-8 text and written back as UTF-8, so one in any other
 * encoding is held back rather than converted: re-encoding it would either make
 * its XML declaration lie or change what the recipient gets. Whatever
 * `podpiszXml` would refuse after the PIN is refused here, before it.
 */

const ENCODING = /^\s*<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/;

/** The file as text — or why it cannot be read as UTF-8 XML. */
export function odczytajXml(bytes: Uint8Array): { tekst: string } | { blokada: string } {
  if (bytes.length === 0) return { blokada: 'Plik jest pusty.' };
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return { blokada: 'Plik XML jest zapisany w UTF-16 — podpisuję tylko pliki w UTF-8.' };
  }
  let tekst: string;
  try {
    tekst = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { blokada: 'Plik nie jest poprawnym tekstem UTF-8 — podpisuję tylko pliki XML w UTF-8.' };
  }
  const deklarowane = ENCODING.exec(tekst.replace(/^﻿/, ''))?.[1];
  if (deklarowane && !/^utf-?8$/i.test(deklarowane)) {
    return { blokada: `Plik XML jest w kodowaniu ${deklarowane} — podpisuję tylko pliki w UTF-8.` };
  }
  return { tekst };
}

export function analizujXml(bytes: Uint8Array): PodpisPdfAnaliza {
  const rozmiar = bytes.length;
  const odczyt = odczytajXml(bytes);
  if ('blokada' in odczyt) return { rozmiar, strony: null, blokada: odczyt.blokada };
  return { rozmiar, strony: null, blokada: przeszkodaPodpisuXml(odczyt.tekst) };
}
