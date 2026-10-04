/**
 * Reader of vDom's "RozliczenieWsp" PDF — the financial statements of many
 * communities in one file, one after another.
 *
 * vDom prints the statement as monospaced text (Consolas), one text item per
 * printed line with its spaces kept. That makes the columns exact: an amount
 * is right-aligned to its column heading, so the right edge of the amount (in
 * points) lands on the right edge of the heading word above it. The parser
 * reads each line's position from pdf.js and assigns every amount to the
 * heading it ends under — no guessing from the order of the numbers, which
 * would put a cost into the income column the first time a row had only one.
 *
 * The content is not a fixed schema: sections keep their printed titles,
 * columns and rows, so a row vDom adds next year is carried, not dropped. The
 * pieces the budget plan needs are looked up by name later
 * (shared/plan-gospodarczy), where a missing piece is reported, not assumed.
 */

import fs from 'fs';
import { Sprawozdanie, SprawozdanieSekcja, SprawozdanieWiersz } from '../../shared/types';

/** One printed line, positioned. */
export interface PdfLine {
  page: number;
  /** Baseline, in points from the bottom of the page. */
  y: number;
  /** Left edge of the line's first character, in points. */
  x: number;
  /** Font size — the title is set larger than the body, the footer smaller. */
  size: number;
  /** Width of one character (the font is monospaced). */
  cw: number;
  text: string;
}

const AMOUNT_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}(?![\d,])/g;
/** Within this many points an amount still ends "under" a heading. */
const COLUMN_TOLERANCE = 4;

export function parseAmount(text: string): number {
  const negative = text.trim().startsWith('-');
  const digits = text.replace(/[^\d,]/g, '').replace(',', '.');
  const value = Number(digits);
  return negative ? -value : value;
}

function isoFromDots(text: string): string {
  const m = /(\d{4})\.(\d{2})\.(\d{2})/.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function isDashLine(text: string): boolean {
  const t = text.trim();
  return t.length >= 6 && /^-+$/.test(t);
}

function isSectionHeading(text: string): boolean {
  return /^\s*\d+\.\s+\p{L}/u.test(text) || /^\s*Informacja o\s+\p{L}/u.test(text);
}

/** The amounts on a line, each with the point its last character ends at. */
function amountsOf(line: PdfLine): { value: number; right: number; index: number }[] {
  const out: { value: number; right: number; index: number }[] = [];
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(line.text))) {
    out.push({ value: parseAmount(m[0]), right: line.x + (m.index + m[0].length) * line.cw, index: m.index });
  }
  return out;
}

/** Words of a line with their right edges, in points. */
function wordsOf(line: PdfLine, from = 0): { word: string; start: number; right: number }[] {
  const out: { word: string; start: number; right: number }[] = [];
  const re = /\S+/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line.text))) {
    out.push({ word: m[0], start: m.index, right: line.x + (m.index + m[0].length) * line.cw });
  }
  return out;
}

/** A section being read: its heading line and the lines under it. */
interface RawSection {
  heading: PdfLine;
  lines: { line: PdfLine; summary: boolean }[];
}

/**
 * Turn a section's heading and lines into columns and rows. Headings are split
 * at runs of two or more spaces ("Bilans otwarcia  Zaciągnięty"), then split
 * further where the amounts below say a column ends inside a run ("Zaliczka
 * Rozliczenie" is two columns that vDom prints one space apart).
 */
function buildSection(raw: RawSection, baseX: number): SprawozdanieSekcja {
  const heading = raw.heading;
  const headingAmounts = amountsOf(heading);
  const titleEnd = (() => {
    const m = /^(\s*(?:\d+\.\s+)?\S+(?:\s\S+)*)/.exec(heading.text);
    return m ? m[1].length : heading.text.length;
  })();
  const tytul = heading.text.slice(0, titleEnd).trim();

  const rowAmounts = raw.lines.flatMap(({ line }) => amountsOf(line).map((a) => a.right));
  const endsUnder = (right: number) => rowAmounts.some((r) => Math.abs(r - right) <= COLUMN_TOLERANCE);

  // Column labels and the point each one ends at.
  const columns: { label: string; right: number }[] = [];
  if (headingAmounts.length === 0) {
    let current: string[] = [];
    let lastStart = -1;
    let lastEnd = -1;
    for (const w of wordsOf(heading, titleEnd)) {
      const gap = lastEnd < 0 ? Infinity : w.start - lastEnd;
      if (current.length > 0 && gap >= 2) {
        columns.push({ label: current.join(' '), right: heading.x + lastEnd * heading.cw });
        current = [];
      } else if (current.length > 0 && endsUnder(heading.x + lastEnd * heading.cw)) {
        // One space apart, but the amounts below end at the previous word.
        columns.push({ label: current.join(' '), right: heading.x + lastEnd * heading.cw });
        current = [];
      }
      current.push(w.word);
      lastStart = w.start;
      lastEnd = w.start + w.word.length;
    }
    void lastStart;
    if (current.length > 0) columns.push({ label: current.join(' '), right: heading.x + lastEnd * heading.cw });
  } else {
    // "4. Środki pieniężne  98.472,96": the total sits where the single column is.
    columns.push({ label: 'Kwota', right: headingAmounts[headingAmounts.length - 1].right });
  }

  const columnOf = (right: number): number => {
    let best = -1;
    let bestDist = Infinity;
    columns.forEach((c, i) => {
      const d = Math.abs(c.right - right);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  const wiersze: SprawozdanieWiersz[] = raw.lines.map(({ line, summary }) => {
    const amounts = amountsOf(line);
    const kwoty: (number | null)[] = columns.map(() => null);
    for (const a of amounts) {
      const col = columnOf(a.right);
      if (col >= 0) kwoty[col] = a.value;
    }
    const labelEnd = amounts.length > 0 ? amounts[0].index : line.text.length;
    return {
      nazwa: line.text.slice(0, labelEnd).replace(/\s+/g, ' ').trim(),
      kwoty,
      podsumowanie: summary,
      // vDom sets its bold lines a few points in from the regular ones.
      wyroznienie: line.x - baseX > 10,
    };
  });

  return {
    tytul,
    kolumny: columns.map((c) => c.label),
    wiersze,
    kwotaNaglowka: headingAmounts.length > 0 ? headingAmounts[headingAmounts.length - 1].value : null,
  };
}

/**
 * Split a file's lines into statements. Pure, so it can be checked against a
 * line dump without a PDF.
 */
export function parseSprawozdaniaLines(lines: PdfLine[]): Sprawozdanie[] {
  const result: Sprawozdanie[] = [];
  let current: Sprawozdanie | null = null;
  let titleOpen = false;
  let section: RawSection | null = null;
  let dashes = 0;
  let lastWasDash = false;
  let stamp = '';
  let baseX = Infinity;

  const closeSection = () => {
    if (section && current) current.sekcje.push(buildSection(section, baseX));
    section = null;
    dashes = 0;
    lastWasDash = false;
  };

  for (const line of lines) {
    const text = line.text;
    const trimmed = text.trim();
    if (!trimmed) continue;

    // vDom's footer, printed at the top of every page: who printed it, and when.
    if (trimmed.startsWith('©vDom') || trimmed.startsWith('(c)vDom')) {
      const m = /(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2})\s*$/.exec(trimmed);
      if (m) stamp = m[1];
      continue;
    }

    // A new statement starts with its large title.
    if (line.size >= 16 && /Sprawozdanie\s+Wsp/i.test(trimmed)) {
      closeSection();
      current = {
        nrWsp: null,
        nazwa: '',
        okresOd: '',
        okresDo: '',
        powierzchnia: null,
        powierzchniaCo: null,
        sredniaLiczbaOsob: null,
        sekcje: [],
        wydruk: stamp,
      };
      result.push(current);
      titleOpen = true;
      baseX = Infinity;
      continue;
    }
    if (!current) continue;

    // The community's name — one or two large lines under the title.
    if (titleOpen && line.size >= 16) {
      current.nazwa = `${current.nazwa} ${trimmed}`.replace(/\s+/g, ' ').trim();
      continue;
    }
    titleOpen = false;

    if (/^Za okres od/i.test(trimmed)) {
      const dates = trimmed.match(/\d{4}\.\d{2}\.\d{2}/g) ?? [];
      current.okresOd = isoFromDots(dates[0] ?? '');
      current.okresDo = isoFromDots(dates[1] ?? '');
      continue;
    }
    if (/^Nr wsp\./i.test(trimmed)) {
      const nr = /Nr wsp\.\s*(\d+)/i.exec(trimmed);
      const pow = /Powierzchnia\s+(-?[\d.]+,\d{2})/i.exec(trimmed);
      const co = /Pow\.\s*CO\s+(-?[\d.]+,\d{2})/i.exec(trimmed);
      const osoby = /liczba os[oó]b\s+(-?[\d.]+,\d{2})/i.exec(trimmed);
      current.nrWsp = nr ? Number(nr[1]) : null;
      current.powierzchnia = pow ? parseAmount(pow[1]) : null;
      current.powierzchniaCo = co ? parseAmount(co[1]) : null;
      current.sredniaLiczbaOsob = osoby ? parseAmount(osoby[1]) : null;
      continue;
    }

    if (isSectionHeading(text)) {
      closeSection();
      section = { heading: line, lines: [] };
      continue;
    }
    if (!section) continue;

    if (isDashLine(text)) {
      // vDom draws each rule twice, a hair apart; one rule is one boundary.
      if (!lastWasDash) dashes += 1;
      lastWasDash = true;
      continue;
    }
    lastWasDash = false;
    baseX = Math.min(baseX, line.x);
    // Rows between the first and second rule are the section's items; what
    // follows the second rule is its summary.
    (section as RawSection).lines.push({ line, summary: dashes >= 2 });
  }
  closeSection();
  return result;
}

/** Positioned lines of a PDF, top to bottom, page by page. */
async function readLines(buffer: Buffer): Promise<PdfLine[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require('pdf-parse');
  const lines: PdfLine[] = [];
  let page = 0;
  await pdfParse(buffer, {
    pagerender: (pageData: {
      getTextContent: (o: unknown) => Promise<{ items: { str: string; width?: number; transform: number[] }[] }>;
    }) => {
      page += 1;
      const p = page;
      return pageData
        .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
        .then((content) => {
          // Items on one baseline make one line; vDom prints one item per line,
          // but a merged line is joined back by position just in case.
          const byY = new Map<number, { x: number; str: string; width: number; size: number }[]>();
          for (const item of content.items) {
            if (!item.str) continue;
            const y = Math.round(item.transform[5]);
            const arr = byY.get(y) ?? [];
            arr.push({ x: item.transform[4], str: item.str, width: item.width ?? 0, size: Math.abs(item.transform[0]) });
            byY.set(y, arr);
          }
          for (const y of [...byY.keys()].sort((a, b) => b - a)) {
            const items = byY.get(y)!.sort((a, b) => a.x - b.x);
            const first = items[0];
            const cw = first.str.length > 0 && first.width > 0 ? first.width / first.str.length : first.size * 0.55;
            // Each item is written over its own character columns. vDom fakes
            // bold by printing a line twice a fraction of a point apart, so the
            // second copy must land on the first, not after it.
            const chars: string[] = [];
            for (const it of items) {
              const col = Math.max(0, Math.round((it.x - first.x) / cw));
              for (let i = 0; i < it.str.length; i++) {
                const ch = it.str[i];
                if (ch !== ' ' || chars[col + i] === undefined) chars[col + i] = ch;
              }
            }
            // Control characters are glyphs pdf.js could not map (one sits in
            // "Koszty świadczeń"); they would print as boxes in the documents.
            const text = Array.from(chars, (ch) => ch ?? ' ')
              .join('')
              .replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
            if (text.trim()) lines.push({ page: p, y, x: first.x, size: first.size, cw, text });
          }
          return '';
        });
    },
  });
  return lines;
}

/** Every statement in a vDom "RozliczenieWsp" PDF. */
export async function parseSprawozdaniaPdf(filePath: string): Promise<Sprawozdanie[]> {
  const lines = await readLines(fs.readFileSync(filePath));
  return parseSprawozdaniaLines(lines);
}
