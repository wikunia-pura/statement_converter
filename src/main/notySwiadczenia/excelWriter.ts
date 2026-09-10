/**
 * Build an xlsx that faithfully reproduces a Nota/Korekta PDF:
 *   - Header with the nota number (the "z dnia …" date is dropped)
 *   - Two-column Wystawca | Nabywca block, then Odbiorca
 *   - Konto line
 *   - Rozliczenie świadczeń table with formula `Nota = Powinno być − Było`
 *   - Razem row with SUM formulas
 *   - Do zwrotu / Do zapłaty line, then the "Cena m³ podgrzania:" line
 *   - Extra informational line and the signature + footer
 *
 * Every piece of text that reaches a cell goes through notaText(): the PDFs
 * are worded as "Korekta", the xlsx has to read as "Nota", and the "z dnia …"
 * date and the "Do: 1/2026,2/2026,…" period list must not appear at all.
 */

import ExcelJS from 'exceljs';
import { NotaData } from './extractor';

const MONEY_FMT = '#,##0.00" zł"';

/** "z dnia 2026.06.30", "z dnia 30-06-2026", … — dropped wherever it appears. */
const DATE_PHRASE_RE = /\s*\bz\s+dnia\s+\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b\.?/gi;

/** "Do: 1/2026,2/2026,…" period list — dropped; "Do zwrotu" is left alone. */
const DO_LIST_RE = /\bDo:\s*\d{1,2}\/\d{4}(?:\s*,\s*\d{1,2}\/\d{4})*\s*,?/gi;

/**
 * "Korekta" in every Polish case → the matching form of "Nota", so replaced
 * headings stay grammatical ("Tytuł korekty" → "Tytuł noty").
 */
const KOREKTA_FORMS: Record<string, string> = {
  korekta: 'nota',
  korekty: 'noty',
  korekcie: 'nocie',
  korektę: 'notę',
  korektą: 'notą',
  korekto: 'noto',
  korekt: 'not',
  korektom: 'notom',
  korektami: 'notami',
  korektach: 'notach',
};
const KOREKTA_RE = /\bkorekt(?:ami|ach|om|ę|ą|y|a|o)?\b|\bkorekcie\b/gi;

function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Applied to every string written into the sheet. */
export function notaText(value: string): string {
  return value
    .replace(DO_LIST_RE, '')
    .replace(DATE_PHRASE_RE, '')
    .replace(KOREKTA_RE, (m) => matchCase(m, KOREKTA_FORMS[m.toLowerCase()] ?? 'nota'))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF888888' } },
  left: { style: 'thin', color: { argb: 'FF888888' } },
  right: { style: 'thin', color: { argb: 'FF888888' } },
  bottom: { style: 'thin', color: { argb: 'FF888888' } },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFDDEBF7' },
};

const TOTAL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF2F2F2' },
};

export async function buildNotaWorkbook(data: NotaData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Nota', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: {
        left: 0.4,
        right: 0.4,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    },
  });
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 38;
  ws.getColumn(4).width = 18;

  let r = 1;

  // Header row — left: "Nota nr ...", right: city+issue date.
  // The "z dnia ..." part of the title is intentionally not carried over.
  const titleLeft = data.korektaNumer ? `Nota nr ${data.korektaNumer}` : 'Nota';
  ws.getCell(r, 1).value = notaText(titleLeft);
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  ws.mergeCells(r, 1, r, 2);

  if (data.miasto || data.dataMiasta) {
    const right = [data.miasto, data.dataMiasta].filter(Boolean).join(', ');
    ws.getCell(r, 3).value = notaText(right);
    ws.getCell(r, 3).alignment = { horizontal: 'right' };
    ws.mergeCells(r, 3, r, 4);
  }
  r++;

  // The "Do: 1/2026,2/2026,…" period list is deliberately not written out.

  r++; // blank spacer

  // Parties: Wystawca (cols 1-2) | Nabywca (cols 3-4)
  ws.getCell(r, 1).value = notaText(data.wystawcaHeader || 'Wystawca');
  ws.getCell(r, 1).font = { bold: true };
  ws.mergeCells(r, 1, r, 2);
  ws.getCell(r, 3).value = notaText(data.nabywcaHeader || 'Nabywca');
  ws.getCell(r, 3).font = { bold: true };
  ws.mergeCells(r, 3, r, 4);
  r++;

  const maxParty = Math.max(data.wystawca.length, data.nabywca.length);
  for (let i = 0; i < maxParty; i++) {
    if (data.wystawca[i]) {
      ws.getCell(r, 1).value = notaText(data.wystawca[i]);
      ws.mergeCells(r, 1, r, 2);
    }
    if (data.nabywca[i]) {
      ws.getCell(r, 3).value = notaText(data.nabywca[i]);
      ws.mergeCells(r, 3, r, 4);
    }
    r++;
  }

  // Odbiorca: right column
  if (data.odbiorca.length > 0) {
    r++; // spacer
    ws.getCell(r, 3).value = 'Odbiorca';
    ws.getCell(r, 3).font = { bold: true };
    ws.mergeCells(r, 3, r, 4);
    r++;
    for (const line of data.odbiorca) {
      ws.getCell(r, 3).value = notaText(line);
      ws.mergeCells(r, 3, r, 4);
      r++;
    }
  }

  if (data.konto) {
    r++;
    ws.getCell(r, 1).value = notaText(`Konto ${data.konto}`);
    ws.mergeCells(r, 1, r, 4);
    r++;
  }

  r += 1;

  // Rozliczenie świadczeń title
  ws.getCell(r, 1).value = notaText(data.tableTitle || 'Rozliczenie świadczeń');
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  ws.mergeCells(r, 1, r, 4);
  r++;
  r++;

  // Table header
  const headers = ['Tytuł korekty', 'Było (zaliczka)', 'Powinno być', 'Korekta'];
  headers.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = notaText(h);
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = THIN;
    cell.alignment = { horizontal: i === 0 ? 'left' : 'center' };
  });
  r++;

  const firstDataRow = r;
  for (const row of data.rows) {
    ws.getCell(r, 1).value = notaText(row.label);
    ws.getCell(r, 1).border = THIN;

    ws.getCell(r, 2).value = row.was;
    ws.getCell(r, 2).numFmt = MONEY_FMT;
    ws.getCell(r, 2).border = THIN;

    ws.getCell(r, 3).value = row.shouldBe;
    ws.getCell(r, 3).numFmt = MONEY_FMT;
    ws.getCell(r, 3).border = THIN;

    // Formula: Korekta = Powinno być − Było
    ws.getCell(r, 4).value = { formula: `C${r}-B${r}` } as ExcelJS.CellFormulaValue;
    ws.getCell(r, 4).numFmt = MONEY_FMT;
    ws.getCell(r, 4).border = THIN;
    r++;
  }
  const lastDataRow = r - 1;

  // Razem row with SUM formulas
  const razemRow = r;
  ws.getCell(r, 1).value = 'Razem';
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 1).fill = TOTAL_FILL;
  ws.getCell(r, 1).border = THIN;

  if (lastDataRow >= firstDataRow) {
    ws.getCell(r, 2).value = { formula: `SUM(B${firstDataRow}:B${lastDataRow})` } as ExcelJS.CellFormulaValue;
    ws.getCell(r, 3).value = { formula: `SUM(C${firstDataRow}:C${lastDataRow})` } as ExcelJS.CellFormulaValue;
    ws.getCell(r, 4).value = { formula: `SUM(D${firstDataRow}:D${lastDataRow})` } as ExcelJS.CellFormulaValue;
  }
  for (let c = 2; c <= 4; c++) {
    const cell = ws.getCell(r, c);
    cell.numFmt = MONEY_FMT;
    cell.font = { bold: true };
    cell.fill = TOTAL_FILL;
    cell.border = THIN;
  }
  r++;
  r++;

  // Do zwrotu / Do zapłaty — amount = ABS of Razem korekta
  const settlementLabel = data.settlementLabel || 'Do zwrotu';
  ws.getCell(r, 1).value = notaText(settlementLabel);
  ws.getCell(r, 1).font = { bold: true };
  ws.mergeCells(r, 1, r, 2);

  ws.getCell(r, 3).value = { formula: `ABS(D${razemRow})` } as ExcelJS.CellFormulaValue;
  ws.getCell(r, 3).numFmt = MONEY_FMT;
  ws.getCell(r, 3).font = { bold: true };
  ws.mergeCells(r, 3, r, 4);
  r++;

  // Directly under the settlement line — "3" as a superscript, hence richText
  ws.getCell(r, 1).value = {
    richText: [
      { text: 'Cena m' },
      { text: '3', font: { vertAlign: 'superscript' } },
      { text: ' podgrzania:' },
    ],
  };
  ws.mergeCells(r, 1, r, 2);
  r++;
  r++;

  // Extra informational line requested by the user
  ws.getCell(r, 1).value = 'Proszę o uwzględnienie kwot w bieżących opłatach';
  ws.getCell(r, 1).font = { italic: true };
  ws.mergeCells(r, 1, r, 4);
  r++;
  r++;

  if (data.signatureName) {
    ws.getCell(r, 3).value = '___________________________';
    ws.getCell(r, 3).alignment = { horizontal: 'center' };
    ws.mergeCells(r, 3, r, 4);
    r++;
    ws.getCell(r, 3).value = notaText(data.signatureName);
    ws.getCell(r, 3).font = { bold: true };
    ws.getCell(r, 3).alignment = { horizontal: 'center' };
    ws.mergeCells(r, 3, r, 4);
    r++;
  }

  if (data.footerLines.length > 0) {
    r++;
    for (const line of data.footerLines) {
      // A footer line that was only a "z dnia …" date sanitizes down to nothing
      const text = notaText(line);
      if (!text) continue;
      ws.getCell(r, 1).value = text;
      ws.getCell(r, 1).font = { size: 9, italic: true };
      ws.getCell(r, 1).alignment = { wrapText: true };
      ws.mergeCells(r, 1, r, 4);
      r++;
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
