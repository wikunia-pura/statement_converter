/**
 * Small pieces every accounting-file exporter needs the same way.
 */

import * as iconv from 'iconv-lite';

// ── Document number ─────────────────────────────────────────

/** Date layouts the exporters read their transaction dates in. */
export type ExportDateLayout = 'YYMMDD' | 'YYYYMMDD' | 'YYYY-MM-DD' | 'DD/MM/YYYY';

/** "2026-07" for a transaction date, or null when the date does not read as one. */
export function yearMonthOf(date: string | null | undefined, layout: ExportDateLayout): string | null {
  const d = (date ?? '').trim();
  let year = '';
  let month = '';
  if (layout === 'YYMMDD' && /^\d{6}/.test(d)) {
    year = `20${d.substring(0, 2)}`;
    month = d.substring(2, 4);
  } else if (layout === 'YYYYMMDD' && /^\d{8}/.test(d)) {
    year = d.substring(0, 4);
    month = d.substring(4, 6);
  } else if (layout === 'YYYY-MM-DD' && /^\d{4}-\d{2}/.test(d)) {
    year = d.substring(0, 4);
    month = d.substring(5, 7);
  } else if (layout === 'DD/MM/YYYY' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(d)) {
    const [, m, y] = d.split('/');
    year = y.substring(0, 4);
    month = m.padStart(2, '0');
  } else {
    return null;
  }
  const monthNumber = Number(month);
  return monthNumber >= 1 && monthNumber <= 12 ? `${year}-${month}` : null;
}

/**
 * The bank document number ("BNK/0007") of an accounting file.
 *
 * It names the month of the statement, read from its transactions: the month
 * most of them fall in, and of months equally common the later one. Neither the
 * earliest nor the latest date will do — a July statement opens with late-June
 * value dates, and a December one can close with a 2 January value date, and
 * either would name the wrong month. (The statement's own period is not handed
 * to the exporters; the transactions are what every format has.) It used to be
 * the month the file happened to be converted in, so a July statement converted
 * on 3 August went into the books as BNK/0008. The current month remains only as
 * the fallback for a file without a readable date.
 */
export function bankDocNumber(yearMonths: Array<string | null>): string {
  const counts = new Map<string, number>();
  for (const ym of yearMonths) {
    if (ym) counts.set(ym, (counts.get(ym) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [ym, count] of counts) {
    const bestCount = best ? counts.get(best)! : 0;
    if (count > bestCount || (count === bestCount && best !== null && ym > best)) best = ym;
  }
  const month = best ? Number(best.substring(5, 7)) : new Date().getMonth() + 1;
  return `BNK/${String(month).padStart(4, '0')}`;
}

// ── Windows-1250 text ───────────────────────────────────────

/** Every character Windows-1250 can encode, read off the code page itself. */
const WIN1250_CHARS: Set<string> = (() => {
  const bytes = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  const decoded = iconv.decode(bytes, 'win1250');
  // iconv decodes the code page's unassigned bytes to U+FFFD; that is not a character it can write.
  return new Set(Array.from(decoded).filter((c) => c !== '\uFFFD'));
})();

/** ASCII spellings for symbols outside Windows-1250 that turn up in transfer titles. */
const SYMBOLS: Record<string, string> = {
  '№': 'Nr',
  '₴': 'UAH',
  '₽': 'RUB',
  '£': 'GBP',
  '¥': 'JPY',
  '\u2212': '-', // minus sign
  '\u2010': '-', // hyphen
  '\u2011': '-', // non-breaking hyphen
  '\u2012': '-', // figure dash
  '\u2015': '-', // horizontal bar
  '\u2009': ' ', // thin space
  '\u202F': ' ', // narrow no-break space
  '\u2032': "'", // prime
  '\u2033': '"', // double prime
};

/** Cyrillic letters, Polish-style (payers write titles in Ukrainian and Russian too). */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'w', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'je', ё: 'jo', ж: 'z', з: 'z',
  и: 'y', і: 'i', ї: 'ji', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'ch', ц: 'c', ч: 'cz', ш: 'sz', щ: 'szcz', ъ: '',
  ы: 'y', ь: '', э: 'e', ю: 'ju', я: 'ja',
};

/**
 * Text the accounting file can carry, character for character.
 *
 * The file is written in Windows-1250, and the encoder replaces everything the
 * code page lacks with "?" — so a title with a Cyrillic name or a "№" reached the
 * books as a row of question marks. Characters the code page has (Polish letters,
 * "–", "€", „quotes") are kept as they are; the rest get an ASCII spelling: a
 * Latin letter without its accent ("ő" → "o"), a known symbol ("№" → "Nr"), a
 * Cyrillic letter transliterated. Only what has no spelling at all stays "?".
 */
export function toWin1250Text(text: string): string {
  let out = '';
  for (const c of text.normalize('NFC')) {
    if (WIN1250_CHARS.has(c)) {
      out += c;
      continue;
    }
    if (c in SYMBOLS) {
      out += SYMBOLS[c];
      continue;
    }
    const lower = c.toLowerCase();
    if (lower in CYRILLIC) {
      const latin = CYRILLIC[lower];
      out += c === lower ? latin : latin.charAt(0).toUpperCase() + latin.slice(1);
      continue;
    }
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // A stray combining accent (left over after NFC) has no letter to carry it.
    if (base === '') continue;
    if (Array.from(base).every((b) => WIN1250_CHARS.has(b))) {
      out += base;
      continue;
    }
    out += '?';
  }
  return out;
}
