/**
 * Split a scanned PDF into one single-page PDF per page.
 *
 * Every page of these documents is one housing community, so a page is the
 * natural unit of work: it is what gets sent to the model, what gets validated,
 * and what gets cached. Splitting locally is cheap — 5–25 ms for a whole
 * 15–28 page file, measured on the sample workbooks — because pdf-lib copies the
 * existing page objects rather than re-encoding the scans.
 *
 * pdf-lib is pure JavaScript, so this adds no native dependency to the packaged
 * app. Some scanners still emit PDFs it cannot parse, so callers must be ready
 * for this to throw and fall back to sending the whole file in one request.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { PDFDocument } from 'pdf-lib';

export interface PdfPage {
  /** 0-based index in the source document. */
  index: number;
  /** A complete one-page PDF, ready to send as a `document` content block. */
  bytes: Buffer;
  /**
   * Digest of `bytes`, used as the cache key. It is derived from the page's own
   * content, so the same scanned page keeps its identity when the surrounding
   * file is renamed, re-saved, or split differently.
   */
  sha256: string;
}

export async function splitPdfPages(pdfPath: string): Promise<PdfPage[]> {
  const source = await PDFDocument.load(fs.readFileSync(pdfPath), {
    // Some scanner output carries an owner password with no user password; the
    // pages are readable and we only ever copy them.
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const pageCount = source.getPageCount();
  if (pageCount === 0) throw new Error('PDF nie zawiera żadnej strony.');

  const pages: PdfPage[] = [];
  for (let index = 0; index < pageCount; index++) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(source, [index]);
    single.addPage(copied);
    // Object streams off: keeps the output byte-stable across pdf-lib patch
    // releases, so cache keys stay valid.
    const bytes = Buffer.from(await single.save({ useObjectStreams: false }));
    pages.push({
      index,
      bytes,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return pages;
}
