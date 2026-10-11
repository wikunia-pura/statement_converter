import fs from 'fs';
import path from 'path';
import type { PodpisPdfAnaliza, PodpisPdfWynik, PodpisWybor } from '../../shared/types';
import { analizujPdf } from './pdfAnaliza';
import { BladKarty, zKartaDoPodpisu, type SesjaPodpisu } from './karta';
import { podpiszPdf } from './pades';
import { podpiszXml } from './xades';
import { analizujXml, odczytajXml } from './xmlAnaliza';

/*
 * The Podpis module's run: the given PDFs and XMLs signed one by one under a
 * single card login — one PIN for all — each into "<name> (podpisany).<ext>"
 * next to its original: a PDF with PAdES, an XML with XAdES enveloped (the
 * signature PIT and CIT declarations get). Kept apart from main.ts so the
 * order of things stays readable: files are checked first and the card is
 * touched only for those that pass, so a file the app cannot sign never costs a
 * PIN entry.
 */

export interface PodpisPlikowOpcje {
  /** The library picked in Settings; '' = find Szafir's own. */
  biblioteka: string;
  wybor: PodpisWybor;
  pliki: string[];
  /** Before each file: how many are done of how many, and the name of the one in hand ('' at the end). */
  postep: (zrobione: number, wszystkie: number, nazwa: string) => void;
  /** Checked between files — "Przerwij". */
  czyPrzerwano: () => boolean;
  /** A free name in a folder, so a signed copy never overwrites anything. */
  wolnaSciezka: (dir: string, fileName: string) => string;
}

const komunikat = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** "Umowa.pdf" → "Umowa (podpisany).pdf", "JPK.xml" → "JPK (podpisany).xml". */
export const nazwaPodpisanego = (sciezka: string): string => {
  const ext = path.extname(sciezka);
  return `${path.basename(sciezka, ext)} (podpisany)${ext.toLowerCase()}`;
};

/** The module signs XML by its extension; everything else it is handed is a PDF. */
export const jestXml = (sciezka: string): boolean => path.extname(sciezka).toLowerCase() === '.xml';

/** What the screen shows about a dropped file, and whether it can be signed at all. */
export const analizujPlik = async (sciezka: string, bytes: Buffer): Promise<PodpisPdfAnaliza> =>
  jestXml(sciezka) ? analizujXml(bytes) : analizujPdf(bytes);

/** The signed copy's bytes. The XML was checked before the PIN, so a failure here is the card's or the key's. */
async function podpisany(sciezka: string, bytes: Buffer, sesja: SesjaPodpisu): Promise<Buffer> {
  if (!jestXml(sciezka)) return podpiszPdf(bytes, sesja);
  const odczyt = odczytajXml(bytes);
  if ('blokada' in odczyt) throw new Error(odczyt.blokada);
  return Buffer.from(await podpiszXml(odczyt.tekst, sesja), 'utf8');
}

export async function podpiszPliki(o: PodpisPlikowOpcje): Promise<PodpisPdfWynik> {
  const nazwa = (p: string) => path.basename(p);
  const pominiete: PodpisPdfWynik['pominiete'] = [];
  const gotowe: { zrodlo: string; bytes: Buffer }[] = [];

  // Before the PIN: whatever cannot be signed is named with the reason now.
  for (const zrodlo of [...new Set(o.pliki)]) {
    try {
      const bytes = fs.readFileSync(zrodlo);
      const { blokada } = await analizujPlik(zrodlo, bytes);
      if (blokada) pominiete.push({ zrodlo, nazwa: nazwa(zrodlo), powod: blokada });
      else gotowe.push({ zrodlo, bytes });
    } catch (error: unknown) {
      const powod = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Pliku już nie ma w tym miejscu — mógł zostać przeniesiony.' : komunikat(error);
      pominiete.push({ zrodlo, nazwa: nazwa(zrodlo), powod });
    }
  }
  if (gotowe.length === 0) return { podpis: null, podpisane: [], pominiete, przerwano: null, niepodpisane: [] };

  const podpisane: PodpisPdfWynik['podpisane'] = [];
  let przetworzone = 0;
  let przerwano: string | null = null;
  let slad: PodpisPdfWynik['podpis'] = null;

  await zKartaDoPodpisu(o.biblioteka, o.wybor, async (sesja) => {
    slad = { podmiot: sesja.cert.podmiot, wystawca: sesja.cert.wystawca, numerSeryjny: sesja.cert.numerSeryjny };
    for (const { zrodlo, bytes } of gotowe) {
      if (o.czyPrzerwano()) {
        przerwano = 'Podpisywanie przerwane na Twoje polecenie.';
        break;
      }
      o.postep(przetworzone, gotowe.length, nazwa(zrodlo));
      try {
        const wynik = await podpisany(zrodlo, bytes, sesja);
        const sciezka = o.wolnaSciezka(path.dirname(zrodlo), nazwaPodpisanego(zrodlo));
        fs.writeFileSync(sciezka, wynik);
        podpisane.push({ zrodlo, nazwa: nazwa(zrodlo), sciezka });
      } catch (error: unknown) {
        if (error instanceof BladKarty) {
          // Nothing signed yet: reject, so the window asks for the PIN again.
          if (podpisane.length === 0) throw error;
          przerwano = error.message;
          break;
        }
        pominiete.push({ zrodlo, nazwa: nazwa(zrodlo), powod: komunikat(error) });
      }
      przetworzone += 1;
    }
    o.postep(przetworzone, gotowe.length, '');
  });

  return {
    podpis: slad,
    podpisane,
    pominiete,
    przerwano,
    // The run stopped at `przetworzone`: that one and the rest are left.
    niepodpisane: gotowe.slice(przetworzone).map((g) => ({ zrodlo: g.zrodlo, nazwa: nazwa(g.zrodlo) })),
  };
}
