/**
 * Build an xlsx that faithfully reproduces a Nota/Korekta PDF:
 *   - Header with Korekta number and dates
 *   - "Do:" period list
 *   - Two-column Wystawca | Nabywca block, then Odbiorca
 *   - Konto line
 *   - Rozliczenie świadczeń table with formula `Korekta = Powinno być − Było`
 *   - Razem row with SUM formulas
 *   - Do zwrotu / Do zapłaty line with ABS formula
 *   - Extra informational line and the signature + footer
 */

import ExcelJS from 'exceljs';
import { NotaData } from './extractor';

const MONEY_FMT = '#,##0.00" zł"';

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
  const ws = wb.addWorksheet('Korekta', {
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

  // Header row — left: "Korekta nr ... z dnia ...", right: city+issue date
  const titleLeft = data.korektaNumer
    ? `Korekta nr ${data.korektaNumer}${data.dataWystawienia ? ` z dnia ${data.dataWystawienia}` : ''}`
    : 'Korekta';
  ws.getCell(r, 1).value = titleLeft;
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  ws.mergeCells(r, 1, r, 2);

  if (data.miasto || data.dataMiasta) {
    const right = [data.miasto, data.dataMiasta].filter(Boolean).join(', ');
    ws.getCell(r, 3).value = right;
    ws.getCell(r, 3).alignment = { horizontal: 'right' };
    ws.mergeCells(r, 3, r, 4);
  }
  r++;

  if (data.doList) {
    ws.getCell(r, 1).value = `Do: ${data.doList}`;
    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).alignment = { wrapText: true };
    r++;
  }

  r++; // blank spacer

  // Parties: Wystawca (cols 1-2) | Nabywca (cols 3-4)
  ws.getCell(r, 1).value = data.wystawcaHeader || 'Wystawca';
  ws.getCell(r, 1).font = { bold: true };
  ws.mergeCells(r, 1, r, 2);
  ws.getCell(r, 3).value = data.nabywcaHeader || 'Nabywca';
  ws.getCell(r, 3).font = { bold: true };
  ws.mergeCells(r, 3, r, 4);
  r++;

  const maxParty = Math.max(data.wystawca.length, data.nabywca.length);
  for (let i = 0; i < maxParty; i++) {
    if (data.wystawca[i]) {
      ws.getCell(r, 1).value = data.wystawca[i];
      ws.mergeCells(r, 1, r, 2);
    }
    if (data.nabywca[i]) {
      ws.getCell(r, 3).value = data.nabywca[i];
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
      ws.getCell(r, 3).value = line;
      ws.mergeCells(r, 3, r, 4);
      r++;
    }
  }

  if (data.konto) {
    r++;
    ws.getCell(r, 1).value = `Konto ${data.konto}`;
    ws.mergeCells(r, 1, r, 4);
    r++;
  }

  r += 1;

  // Rozliczenie świadczeń title
  ws.getCell(r, 1).value = data.tableTitle || 'Rozliczenie świadczeń';
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  ws.mergeCells(r, 1, r, 4);
  r++;
  r++;

  // Table header
  const headers = ['Tytuł korekty', 'Było (zaliczka)', 'Powinno być', 'Korekta'];
  headers.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.border = THIN;
    cell.alignment = { horizontal: i === 0 ? 'left' : 'center' };
  });
  r++;

  const firstDataRow = r;
  for (const row of data.rows) {
    ws.getCell(r, 1).value = row.label;
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
  ws.getCell(r, 1).value = settlementLabel;
  ws.getCell(r, 1).font = { bold: true };
  ws.mergeCells(r, 1, r, 2);

  ws.getCell(r, 3).value = { formula: `ABS(D${razemRow})` } as ExcelJS.CellFormulaValue;
  ws.getCell(r, 3).numFmt = MONEY_FMT;
  ws.getCell(r, 3).font = { bold: true };
  ws.mergeCells(r, 3, r, 4);
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
    ws.getCell(r, 3).value = data.signatureName;
    ws.getCell(r, 3).font = { bold: true };
    ws.getCell(r, 3).alignment = { horizontal: 'center' };
    ws.mergeCells(r, 3, r, 4);
    r++;
  }

  if (data.footerLines.length > 0) {
    r++;
    for (const line of data.footerLines) {
      ws.getCell(r, 1).value = line;
      ws.getCell(r, 1).font = { size: 9, italic: true };
      ws.getCell(r, 1).alignment = { wrapText: true };
      ws.mergeCells(r, 1, r, 4);
      r++;
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
