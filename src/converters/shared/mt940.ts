/**
 * The parts of MT940 every bank's dialect shares: the `:61:` statement line and
 * the order in which `:61:` and `:86:` follow each other.
 *
 * Four parsers (PKO BP, ING, Alior, Pocztowy) used to read both on their own, and
 * each got a different part wrong:
 *
 *  - `:61:` was cut by character positions, so a funds code after the D/C mark
 *    ("CN653,00") or a storno mark ("RC") left an empty amount, which became 0,00
 *    — or, for a reversal, booked the money on the wrong side.
 *  - `:86:` fields were collected into one list and paired with the `:61:` list by
 *    position. An empty `:86:` was not collected at all, so from that point on
 *    every description sat next to the following transaction's amount.
 *
 * Here `:61:` is read by one pattern, and the file is walked in order: a `:61:`
 * opens a transaction, the `:86:` fields after it belong to it (ING writes two),
 * and any other tag closes it. An empty `:86:` stays an empty description.
 */

/** MT940 tag line, e.g. ":61:" or ":28C:". */
const TAG_LINE = /^:(\d{2,3}[A-Z]?):/;

/** Block terminators: "-" (end of a message) and Alior/Pocztowy's "-}". */
const TERMINATOR = /^\s*-\}?\s*$/;

/**
 * `:61:` up to the amount: value date (YYMMDD), optional entry date (MMDD),
 * optional reversal mark R, the D/C mark, an optional one-letter funds code, the
 * amount (comma as the decimal separator), then whatever the bank writes after it
 * (type code, references), which each dialect reads on its own.
 */
const LINE_61 = /^(\d{6})(\d{4})?(R?)([DC])([A-Z])?([\d,]+)(.*)$/;

/** A well-formed MT940 amount: digits, optionally a comma and decimals. */
const AMOUNT = /^\d+(?:,\d*)?$/;

export interface Line61 {
  /** YYMMDD */
  valueDate: string;
  /** MMDD, or '' when the bank leaves it out. */
  entryDate: string;
  /** True for a storno ("RC"/"RD"): the bank takes an earlier booking back. */
  reversal: boolean;
  /**
   * The side the row is booked on. A reversal turns the mark over: RC reverses a
   * credit, so the money leaves the account (D); RD reverses a debit (C).
   */
  debitCredit: 'D' | 'C';
  /** One-letter funds code after the mark (Alior, Pocztowy: "N"), or ''. */
  fundsCode: string;
  /** The amount as written, e.g. "431,14". */
  amountText: string;
  /** The amount, or null when what stands there is not an amount — never 0 by default. */
  amount: number | null;
  /** Everything after the amount on the first line: type code, references. */
  rest: string;
}

/**
 * Read the first line of a `:61:` value, or null when it is not shaped like one.
 * A line whose amount does not read cleanly comes back with `amount: null`; the
 * caller records it as a dropped line instead of booking 0,00.
 */
export function parseLine61(value: string): Line61 | null {
  const firstLine = (value ?? '').split('\n')[0].trim();
  const match = firstLine.match(LINE_61);
  if (!match) return null;
  const [, valueDate, entryDate, reversalMark, mark, fundsCode, amountText, rest] = match;
  const reversal = reversalMark === 'R';
  // "653.00" would otherwise read as 653 with ".00" left in the rest: a dot right
  // after the digits means the amount is written in a form we do not read.
  const amount =
    AMOUNT.test(amountText) && !rest.startsWith('.')
      ? Number(amountText.replace(',', '.'))
      : null;
  return {
    valueDate,
    entryDate: entryDate ?? '',
    reversal,
    debitCredit: reversal ? (mark === 'C' ? 'D' : 'C') : (mark as 'D' | 'C'),
    fundsCode: fundsCode ?? '',
    amountText,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    rest,
  };
}

/** The first line of a `:61:` value, trimmed and cut short — what a dropped line is shown as. */
export function line61Excerpt(value: string): string {
  return (value ?? '').split('\n')[0].trim().slice(0, 80);
}

/** One transaction of an MT940 file: its `:61:` and the `:86:` fields that follow it. */
export interface Mt940Entry {
  /** The `:61:` value, continuation lines included. */
  field61: string;
  /** Every `:86:` that follows, in order; '' for an empty one. */
  field86s: string[];
}

/**
 * Walk the file in order and cut it into transactions. Statement-level tags
 * (`:20:`, `:60F:`, `:62F:`, a trailing `:86:` after `:62F:`) close the current
 * transaction and are not part of any.
 */
export function walkMt940Entries(content: string): Mt940Entry[] {
  const entries: Mt940Entry[] = [];
  let current: Mt940Entry | null = null;
  let field: string[] | null = null;
  let fieldTag: '61' | '86' | null = null;

  const closeField = () => {
    if (current && field) {
      const value = field.join('\n');
      if (fieldTag === '61') current.field61 = value;
      else if (fieldTag === '86') current.field86s.push(value);
    }
    field = null;
    fieldTag = null;
  };

  for (const line of content.split('\n')) {
    const tag = line.match(TAG_LINE);
    if (tag) {
      closeField();
      const value = line.substring(tag[0].length);
      if (tag[1] === '61') {
        current = { field61: '', field86s: [] };
        entries.push(current);
        field = value ? [value] : [];
        fieldTag = '61';
      } else if (tag[1] === '86' && current) {
        field = value ? [value] : [];
        fieldTag = '86';
      } else {
        current = null;
      }
    } else if (field && !TERMINATOR.test(line)) {
      field.push(line);
    }
  }
  closeField();

  return entries;
}
