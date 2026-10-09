import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import type { PodpisPdfAnaliza } from '../../shared/types';

/*
 * Whether a PDF dropped into the Podpis module can be signed by this app.
 *
 * `podpiszPdf` loads the file with pdf-lib and saves it whole, which is right
 * for a PDF we made ourselves and wrong for one that already carries a
 * signature: the rewrite changes the bytes that signature covers, so the file
 * would come out looking signed with the older signature quietly void. Such a
 * file — like an encrypted or an unreadable one — is held back with the reason
 * instead of being signed "anyway". Adding a second signature properly needs an
 * incremental update, which `pades.ts` does not do.
 */

const BYTE_RANGE = PDFName.of('ByteRange');
const CONTENTS = PDFName.of('Contents');

export async function analizujPdf(bytes: Uint8Array): Promise<PodpisPdfAnaliza> {
  const rozmiar = bytes.length;
  if (rozmiar === 0) return { rozmiar, strony: null, blokada: 'Plik jest pusty.' };

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (error: unknown) {
    const powod = error instanceof Error ? error.message : String(error);
    return { rozmiar, strony: null, blokada: `Nie udało się odczytać tego pliku jako PDF (${powod}).` };
  }

  const strony = pdf.getPageCount();
  if (pdf.isEncrypted) {
    return { rozmiar, strony, blokada: 'PDF jest zabezpieczony hasłem — nie da się go podpisać. Zdejmij zabezpieczenie i dodaj plik ponownie.' };
  }
  if (strony === 0) return { rozmiar, strony, blokada: 'PDF nie ma ani jednej strony.' };

  // A signature dictionary is the only place /ByteRange and /Contents sit
  // together; objects packed in object streams are visible here too.
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.has(BYTE_RANGE) && obj.has(CONTENTS)) {
      return {
        rozmiar,
        strony,
        blokada: 'Ten plik ma już podpis — dołożenie drugiego unieważniłoby poprzedni. Podpisywanie plików już podpisanych nie jest jeszcze obsługiwane.',
      };
    }
  }
  return { rozmiar, strony, blokada: null };
}
