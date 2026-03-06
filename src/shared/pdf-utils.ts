/**
 * PDF Text Extraction - Node.js only (main process)
 * 
 * Extracts text from PDF bank statements for cross-referencing with MT940 data.
 * This file uses Node.js fs module and pdf-parse — do NOT import in the renderer.
 * For search logic, use pdf-search.ts instead.
 */

import * as fs from 'fs';

export interface PdfExtractResult {
  text: string;
  numPages: number;
  /** Individual lines of text */
  lines: string[];
}

/**
 * Extract all text from a PDF file
 */
export async function extractPdfText(filePath: string): Promise<PdfExtractResult> {
  // Lazy-load pdf-parse to avoid DOMMatrix errors at module load time
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse');
  
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  
  const text = data.text;
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  
  return {
    text,
    numPages: data.numpages,
    lines,
  };
}
