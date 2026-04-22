/**
 * Parse "Korekta/Nota Świadczeń" PDF notices used by housing communities.
 *
 * The PDFs follow a fixed layout:
 *   - Header: "Korekta nr {nr} z dnia {date}  {city}, {issueDate}"
 *   - "Do: {months list}"
 *   - Two-column parties block (Wystawca | Nabywca), then single-column Odbiorca
 *   - "Konto {IBAN}"
 *   - Table "Rozliczenie świadczeń" with rows [Tytuł | Było | Powinno być | Korekta]
 *   - "Razem" totals row
 *   - "Do zwrotu" / "Do zapłaty" amount
 *   - Signature name + footer disclaimer
 */

import fs from 'fs';

export interface NotaRow {
  label: string;
  was: number | null;
  shouldBe: number | null;
  korekta: number | null;
}

export interface NotaData {
  filename: string;
  korektaNumer: string;
  dataWystawienia: string;
  miasto: string;
  dataMiasta: string;
  doList: string;
  wystawcaHeader: string;
  nabywcaHeader: string;
  wystawca: string[];
  nabywca: string[];
  odbiorca: string[];
  konto: string;
  tableTitle: string;
  rows: NotaRow[];
  razemWas: number | null;
  razemShouldBe: number | null;
  razemKorekta: number | null;
  settlementLabel: string;
  settlementAmount: number | null;
  signatureName: string;
  footerLines: string[];
}

function parsePolishAmount(raw: string): number | null {
  const s = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

interface AmountMatch {
  value: string;
  start: number;
}

function findAmounts(line: string): AmountMatch[] {
  const matches: AmountMatch[] = [];
  const re = new RegExp(AMOUNT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    matches.push({ value: m[0], start: m.index });
  }
  return matches;
}

// Returns the label (text before the first of the last `count` amounts) and
// the selected amounts. Uses actual match positions so duplicated values
// (e.g. "28.380,00  28.380,00  0,00") don't confuse the label boundary.
function splitLabelAndAmounts(
  line: string,
  count: number,
): { label: string; numbers: string[] } | null {
  const all = findAmounts(line);
  if (all.length < count) return null;
  const selected = all.slice(-count);
  const label = line.slice(0, selected[0].start).trim();
  return { label, numbers: selected.map((s) => s.value) };
}

function splitTwoColumns(line: string): [string, string] {
  const m = line.match(/^(.*?\S)\s{2,}(\S.*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  return [line.trim(), ''];
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isDashLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 6) return false;
  return /^[-\s]+$/.test(t) && t.includes('---');
}

// pdf-parse's default renderer drops horizontal positions, collapsing
// multi-column layouts into single lines. This renderer groups items by y
// and pads with spaces proportional to the x-gap between adjacent items
// so that "Wystawca" / "Nabywca" side-by-side columns stay separated.
function renderPageWithLayout(pageData: {
  getTextContent: (options: unknown) => Promise<{
    items: { str: string; width?: number; transform: number[] }[];
  }>;
}): Promise<string> {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((textContent) => {
      const lineMap = new Map<number, { x: number; str: string; width: number }[]>();
      for (const item of textContent.items) {
        if (!item.str) continue;
        const y = Math.round(item.transform[5]);
        const x = item.transform[4];
        const arr = lineMap.get(y) ?? [];
        arr.push({ x, str: item.str, width: item.width ?? 0 });
        lineMap.set(y, arr);
      }
      const ys = [...lineMap.keys()].sort((a, b) => b - a);
      let out = '';
      for (const y of ys) {
        const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
        let line = '';
        let prevEnd = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (i === 0) {
            // Leading spaces proportional to the item's x position
            const leadSpaces = Math.max(0, Math.floor(it.x / 6));
            line += ' '.repeat(leadSpaces);
          } else {
            const gap = it.x - prevEnd;
            if (gap > 15) {
              line += ' '.repeat(Math.max(4, Math.floor(gap / 6)));
            } else if (gap > 2) {
              line += ' ';
            }
          }
          line += it.str;
          prevEnd = it.x + (it.width || 0);
        }
        out += line + '\n';
      }
      return out;
    });
}

export async function extractNotaFromPdf(filePath: string): Promise<NotaData> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(buffer, { pagerender: renderPageWithLayout });
  const rawText: string = parsed.text ?? '';
  const rawLines = rawText.split('\n').map((l: string) => l.replace(/\s+$/g, ''));

  const nonEmptyLinesWithIdx: { idx: number; line: string }[] = rawLines
    .map((line: string, idx: number) => ({ idx, line }))
    .filter((x: { idx: number; line: string }) => !isBlank(x.line));

  const findAnchor = (pred: (l: string) => boolean): number => {
    const hit = nonEmptyLinesWithIdx.find((x) => pred(x.line));
    return hit ? hit.idx : -1;
  };

  const result: NotaData = {
    filename: filePath,
    korektaNumer: '',
    dataWystawienia: '',
    miasto: '',
    dataMiasta: '',
    doList: '',
    wystawcaHeader: 'Wystawca',
    nabywcaHeader: 'Nabywca',
    wystawca: [],
    nabywca: [],
    odbiorca: [],
    konto: '',
    tableTitle: 'Rozliczenie świadczeń',
    rows: [],
    razemWas: null,
    razemShouldBe: null,
    razemKorekta: null,
    settlementLabel: '',
    settlementAmount: null,
    signatureName: '',
    footerLines: [],
  };

  // Korekta header line: "Korekta nr ZR/1/1/2025 z dnia 2025.12.31 ... Warszawa, 2026.04.20"
  for (const { line } of nonEmptyLinesWithIdx) {
    const m = line.match(/Korekta nr\s+(\S+)\s+z dnia\s+(\S+)\s+(.+?),\s*(\S+)\s*$/);
    if (m) {
      result.korektaNumer = m[1].trim();
      result.dataWystawienia = m[2].trim();
      result.miasto = m[3].trim();
      result.dataMiasta = m[4].trim();
      break;
    }
  }

  // "Do: 1/2025,..."
  for (const { line } of nonEmptyLinesWithIdx) {
    const t = line.trim();
    if (t.startsWith('Do:')) {
      result.doList = t.substring(3).trim().replace(/,+$/, '');
      break;
    }
  }

  // Parties: find the line that contains both "Wystawca" and "Nabywca"
  const wystawcaHeaderIdx = findAnchor((l) => /Wystawca/i.test(l) && /Nabywca/i.test(l));
  const odbiorcaIdx = findAnchor((l) => l.trim().startsWith('Odbiorca'));
  const kontoIdx = findAnchor((l) => l.trim().startsWith('Konto'));
  const tableTitleIdx = findAnchor((l) => l.includes('Rozliczenie świadczeń'));

  if (wystawcaHeaderIdx >= 0) {
    const [lh, rh] = splitTwoColumns(rawLines[wystawcaHeaderIdx]);
    const cleanLh = lh.replace(/\[\d+\]/g, '').trim();
    const cleanRh = rh.replace(/\[\d+\]/g, '').trim();
    if (cleanLh) result.wystawcaHeader = cleanLh;
    if (cleanRh) result.nabywcaHeader = cleanRh;

    const endIdx = odbiorcaIdx > wystawcaHeaderIdx
      ? odbiorcaIdx
      : tableTitleIdx > wystawcaHeaderIdx
      ? tableTitleIdx
      : rawLines.length;
    for (let i = wystawcaHeaderIdx + 1; i < endIdx; i++) {
      const line = rawLines[i];
      if (isBlank(line)) continue;
      if (line.trim().startsWith('Konto')) break;
      if (line.trim().startsWith('Odbiorca')) break;
      const [left, right] = splitTwoColumns(line);
      if (left) result.wystawca.push(left);
      if (right) result.nabywca.push(right);
    }
  }

  if (odbiorcaIdx >= 0) {
    const endIdx = kontoIdx > odbiorcaIdx
      ? kontoIdx
      : tableTitleIdx > odbiorcaIdx
      ? tableTitleIdx
      : rawLines.length;
    for (let i = odbiorcaIdx + 1; i < endIdx; i++) {
      const line = rawLines[i];
      if (isBlank(line)) continue;
      if (line.trim().startsWith('Konto')) break;
      result.odbiorca.push(line.trim());
    }
  }

  if (kontoIdx >= 0) {
    result.konto = rawLines[kontoIdx].trim().replace(/^Konto\s*/i, '').trim();
  }

  // Table: find the header row "Tytuł korekty  Było (zaliczka)  Powinno być  Korekta"
  const tableHeaderIdx = nonEmptyLinesWithIdx.find(
    (x) => /Tytu[łl]\s+korekty/i.test(x.line) && /Powinno/i.test(x.line),
  )?.idx ?? -1;

  let razemIdx = -1;
  if (tableHeaderIdx >= 0) {
    // Rows are between tableHeaderIdx and a dash-line OR the "Razem" line.
    for (let i = tableHeaderIdx + 1; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (isBlank(line) || isDashLine(line)) continue;
      const t = line.trim();
      if (/^Razem\b/i.test(t)) {
        razemIdx = i;
        break;
      }
      const parsed = splitLabelAndAmounts(line, 3);
      if (!parsed || !parsed.label) continue;
      result.rows.push({
        label: parsed.label,
        was: parsePolishAmount(parsed.numbers[0]),
        shouldBe: parsePolishAmount(parsed.numbers[1]),
        korekta: parsePolishAmount(parsed.numbers[2]),
      });
    }
  }

  if (razemIdx >= 0) {
    const parsed = splitLabelAndAmounts(rawLines[razemIdx], 3);
    if (parsed) {
      result.razemWas = parsePolishAmount(parsed.numbers[0]);
      result.razemShouldBe = parsePolishAmount(parsed.numbers[1]);
      result.razemKorekta = parsePolishAmount(parsed.numbers[2]);
    }
  }

  // Settlement line: "Do zwrotu 12.063,71" or "Do zapłaty ..."
  const settlementIdx = rawLines.findIndex((l) =>
    /^\s*Do\s+(zwrotu|zap[łl]aty|dop[łl]aty)\b/i.test(l),
  );
  if (settlementIdx >= 0) {
    const line = rawLines[settlementIdx];
    const parsed = splitLabelAndAmounts(line, 1);
    const amount = parsed ? parsePolishAmount(parsed.numbers[0]) : null;
    const labelMatch = line.trim().match(/^(Do\s+\S+)/i);
    result.settlementLabel = labelMatch ? labelMatch[1] : 'Do zwrotu';
    result.settlementAmount = amount;
  }

  // Signature: a line that is mostly uppercase letters (Polish) appearing after settlement.
  const startSig = settlementIdx >= 0 ? settlementIdx + 1 : 0;
  for (let i = startSig; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    if (!t) continue;
    if (/^[A-ZŻŹĆĄŚĘŁÓŃ ]{4,}$/.test(t)) {
      result.signatureName = t;
      // Footer lines after signature
      for (let j = i + 1; j < rawLines.length; j++) {
        const ft = rawLines[j].trim();
        if (ft) result.footerLines.push(ft);
      }
      break;
    }
  }

  return result;
}
