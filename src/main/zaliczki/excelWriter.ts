/**
 * Build an xlsx summary: one "Podsumowanie" sheet with a block per property
 * (12 months × 10 categories + SUMA column with formulas).
 *
 * Port of excel_writer.py — groups properties from multiple PDFs by normalized
 * name so consecutive monthly PDFs land in the same block.
 */

import ExcelJS from 'exceljs';
import {
  ExtractionResult,
  MONTH_SHORT,
  PropertyData,
  ZALICZKI_CATEGORIES,
  ZALICZKI_CATEGORY_LABELS,
  ZaliczkiCategory,
} from './extractor';

function normalize(s: string | undefined | null): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type MonthlyValues = Partial<Record<ZaliczkiCategory, number | null>>;
type MergedData = Map<string, Map<number, MonthlyValues>>;

function mergeResults(results: ExtractionResult[]): MergedData {
  // Group all raw property names by normalized form; pick longest as canonical.
  const groups = new Map<string, string[]>();
  for (const r of results) {
    for (const p of r.properties) {
      if (!p.property) continue;
      const norm = normalize(p.property);
      const list = groups.get(norm) ?? [];
      list.push(p.property);
      groups.set(norm, list);
    }
  }
  const canonical = new Map<string, string>();
  for (const [norm, names] of groups) {
    canonical.set(norm, names.reduce((a, b) => (b.length > a.length ? b : a)));
  }

  const merged: MergedData = new Map();
  for (const r of results) {
    if (r.month === null) continue;
    for (const p of r.properties) {
      if (!p.property) continue;
      const canon = canonical.get(normalize(p.property)) ?? p.property;
      const byMonth = merged.get(canon) ?? new Map<number, MonthlyValues>();
      byMonth.set(r.month, p.values);
      merged.set(canon, byMonth);
    }
  }
  return merged;
}

const SECTION_CATS: Set<ZaliczkiCategory> = new Set([
  'zaliczka_utrzymanie',
  'razem_swiadczenia',
  'odpady_komunalne',
  'fundusz_remontowy',
  'razem_total',
]);

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' },
};
const SECTION_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' },
};
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF888888' } },
  left: { style: 'thin', color: { argb: 'FF888888' } },
  right: { style: 'thin', color: { argb: 'FF888888' } },
  bottom: { style: 'thin', color: { argb: 'FF888888' } },
};

const MONEY_FMT = '0.00" zł"';

export async function buildWorkbook(
  results: ExtractionResult[],
  year: number,
): Promise<Buffer> {
  const merged = mergeResults(results);
  const props = [...merged.keys()].sort((a, b) => normalize(a).localeCompare(normalize(b)));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Podsumowanie');

  // Title
  ws.getCell('A1').value = `Podsumowanie zaliczek ${year}`;
  ws.getCell('A1').font = { bold: true, size: 14 };

  let row = 3;
  for (const prop of props) {
    row = writePropertyBlock(ws, row, prop, year, merged.get(prop)!);
    row += 2;
  }

  // Column widths
  ws.getColumn(1).width = 36;
  for (let m = 1; m <= 12; m++) ws.getColumn(1 + m).width = 13;
  ws.getColumn(14).width = 14;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function writePropertyBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  prop: string,
  year: number,
  perMonth: Map<number, MonthlyValues>,
): number {
  let r = startRow;

  ws.getCell(r, 1).value = prop;
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  r++;

  // Header row: Kategoria | sty YYYY | ... | gru YYYY | SUMA
  const headerCells: ExcelJS.Cell[] = [];
  ws.getCell(r, 1).value = 'Kategoria';
  headerCells.push(ws.getCell(r, 1));
  for (let m = 1; m <= 12; m++) {
    const cell = ws.getCell(r, 1 + m);
    cell.value = `${MONTH_SHORT[m - 1]} ${year}`;
    cell.alignment = { horizontal: 'center' };
    headerCells.push(cell);
  }
  const sumaHeader = ws.getCell(r, 14);
  sumaHeader.value = 'SUMA';
  sumaHeader.alignment = { horizontal: 'center' };
  headerCells.push(sumaHeader);
  for (const c of headerCells) {
    c.font = { bold: true };
    c.fill = HEADER_FILL;
    c.border = BORDER;
  }
  const headerRow = r;
  r++;

  for (const cat of ZALICZKI_CATEGORIES) {
    const labelCell = ws.getCell(r, 1);
    labelCell.value = ZALICZKI_CATEGORY_LABELS[cat];
    labelCell.font = { bold: true };
    labelCell.border = BORDER;

    const isSection = SECTION_CATS.has(cat);
    if (isSection) labelCell.fill = SECTION_FILL;

    for (let m = 1; m <= 12; m++) {
      const cell = ws.getCell(r, 1 + m);
      const val = perMonth.get(m)?.[cat];
      cell.value = val ?? null;
      cell.numFmt = MONEY_FMT;
      cell.border = BORDER;
      if (isSection) cell.fill = SECTION_FILL;
    }

    const sumCell = ws.getCell(r, 14);
    sumCell.value = { formula: `SUM(B${r}:M${r})` } as ExcelJS.CellFormulaValue;
    sumCell.numFmt = MONEY_FMT;
    sumCell.font = { bold: true };
    sumCell.border = BORDER;
    if (isSection) sumCell.fill = SECTION_FILL;

    r++;
  }

  // Returns the last written row (for outer caller to advance)
  void headerRow;
  return r - 1;
}

/**
 * Convenience wrapper: the renderer sends back its edited table. We rebuild
 * ExtractionResult-shaped entries and call buildWorkbook.
 */
export interface EditedFile {
  filename: string;
  month: number | null;
  year: number | null;
  properties: PropertyData[];
}

export async function buildWorkbookFromEdited(
  files: EditedFile[],
  year: number,
): Promise<Buffer> {
  const results: ExtractionResult[] = files.map((f) => ({
    filename: f.filename,
    month: f.month,
    year: f.year,
    properties: f.properties,
    rawResponse: '',
  }));
  return buildWorkbook(results, year);
}
