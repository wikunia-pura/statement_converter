import fs from 'fs';
import path from 'path';
import type { PodpisPdfWynik, PodpisWybor } from '../../shared/types';
import { analizujPdf } from './pdfAnaliza';
import { BladKarty, zKartaDoPodpisu } from './karta';
import { podpiszPdf } from './pades';

/*
 * The Podpis module's run: the given PDFs signed one by one under a single card
 * login — one PIN for all — each into "<name> (podpisany).pdf" next to its
 * original. Kept apart from main.ts so the order of things stays readable:
 * files are checked first and the card is touched only for those that pass, so
 * a file the app cannot sign never costs a PIN entry.
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

/** "Umowa.pdf" → "Umowa (podpisany).pdf". */
export const nazwaPodpisanego = (sciezka: string): string => {
  const ext = path.extname(sciezka);
  return `${path.basename(sciezka, ext)} (podpisany).pdf`;
};

export async function podpiszPliki(o: PodpisPlikowOpcje): Promise<PodpisPdfWynik> {
  const nazwa = (p: string) => path.basename(p);
  const pominiete: PodpisPdfWynik['pominiete'] = [];
  const gotowe: { zrodlo: string; bytes: Buffer }[] = [];

  // Before the PIN: whatever cannot be signed is named with the reason now.
  for (const zrodlo of [...new Set(o.pliki)]) {
    try {
      const bytes = fs.readFileSync(zrodlo);
      const { blokada } = await analizujPdf(bytes);
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
        const pdf = await podpiszPdf(bytes, sesja);
        const sciezka = o.wolnaSciezka(path.dirname(zrodlo), nazwaPodpisanego(zrodlo));
        fs.writeFileSync(sciezka, pdf);
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
