import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { atrybutyPodpisane, sha256, zlozCms } from './cades';
import type { Certyfikat } from './certyfikat';

/*
 * PAdES: the PDF gets an invisible signature field whose dictionary holds the
 * CAdES signature in /Contents; /ByteRange names every byte of the file but
 * that hex string, and those are the bytes the signature covers. pdf-lib
 * rewrites the whole file on save, which is fine for a declaration we just
 * made — a PDF signed before would need an incremental update instead.
 */

/** Room for the signature in /Contents, in bytes — the certificates take most of it. */
const MIEJSCE = 16384;
/** Ten characters: room for any offset up to 9 999 999 999. */
const ZNACZNIK = '**********';

export interface PodpisPdf {
  cert: Certyfikat;
  /** CA certificates to embed after the signer's. */
  lancuch: Buffer[];
  /** Signs the signed attributes' DER; resolves to SignerInfo's signature value. */
  podpisz: (atrybuty: Buffer) => Promise<Buffer>;
  /** /Reason of the signature dictionary. */
  powod?: string;
}

export async function podpiszPdf(bytes: Uint8Array, o: PodpisPdf): Promise<Buffer> {
  const pdf = await PDFDocument.load(bytes);
  const ctx = pdf.context;
  const sig = ctx.register(
    ctx.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'ETSI.CAdES.detached',
      ByteRange: [0, PDFName.of(ZNACZNIK), PDFName.of(ZNACZNIK), PDFName.of(ZNACZNIK)],
      Contents: PDFHexString.of('0'.repeat(MIEJSCE * 2)),
      M: PDFString.fromDate(new Date()),
      Name: PDFHexString.fromText(o.cert.podmiot),
      ...(o.powod ? { Reason: PDFHexString.fromText(o.powod) } : {}),
    }),
  );
  const page = pdf.getPage(0);
  const widget = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFString.of('Podpis'),
      Rect: [0, 0, 0, 0],
      F: 132, // Print + Locked
      P: page.ref,
      V: sig,
    }),
  );
  page.node.addAnnot(widget);
  const form = pdf.catalog.getOrCreateAcroForm();
  form.addField(widget);
  form.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3)); // SignaturesExist + AppendOnly

  const out = Buffer.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
  const text = out.toString('latin1');

  const zera = `<${'0'.repeat(MIEJSCE * 2)}>`;
  const start = text.indexOf(zera);
  if (start < 0 || text.indexOf(zera, start + 1) >= 0) throw new Error('PDF: nie znaleziono miejsca na podpis.');
  const end = start + zera.length;

  const br = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/.exec(text);
  if (!br) throw new Error('PDF: nie znaleziono zakresu podpisu.');
  const zakres = `/ByteRange [0 ${start} ${end} ${out.length - end}]`;
  if (zakres.length > br[0].length) throw new Error('PDF: plik za duży na podpis.');
  out.write(zakres.padEnd(br[0].length, ' '), br.index, 'latin1');

  const atrybuty = atrybutyPodpisane(sha256(out.subarray(0, start), out.subarray(end)), o.cert);
  const cms = zlozCms({ atrybuty, podpis: await o.podpisz(atrybuty), cert: o.cert, lancuch: o.lancuch });
  if (cms.length > MIEJSCE) throw new Error('PDF: podpis nie mieści się w miejscu na niego przeznaczonym.');
  out.write(cms.toString('hex').padEnd(MIEJSCE * 2, '0'), start + 1, 'latin1');
  return out;
}
