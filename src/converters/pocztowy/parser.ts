/**
 * Bank Pocztowy MT940 Parser
 * Parses Bank Pocztowy's MT940 dialect into structured data.
 *
 * File shape:
 *   {1:F01BPBI}{2:I940BPBI}{4:
 *   :20:20260820
 *   :25:72132011042985859020000001
 *   :28C:07M/2026
 *   :60F:C260701PLN358,62
 *   :61:2607010701C653,00
 *   :86:
 *   <00202607012508252 C
 *   <101
 *   <20Zaliczki za 07.2026  Kwiato
 *   <21wa 24A/2
 *   <27Zarządzanie Nieruchomościami s.c. ,
 *   <28A. Kraciuk
 *   <3024900005
 *   <3138249000050000400029127390
 *   <32Adrianna KANTOR-MITCHELL
 *   <33KOMPUTEROWA 9/59, 02-676 W
 *   <3872132011042985859020000001
 *   …
 *   :62F:C260731PLN38,39
 *   :86:NAME ACCOUNT OWNER:WSPÓLNOTA MIESZKANIOWA NIERUCHOMOŚCI UL. KWIATOWA 24A
 *   -}
 *
 * Two quirks drive the implementation:
 *
 * 1. The `:86:` tag line is empty and its subfields follow as `<XX` continuation
 *    lines, so transactions are read by walking the lines from one `:61:` to the
 *    next instead of pairing two field lists. That also keeps the trailing
 *    statement-level `:86:NAME ACCOUNT OWNER:…` out of the transactions.
 *
 * 2. Every text field is cut into fixed-width chunks (27 chars for the
 *    description and the counterparty, 35 for the owner name) and each chunk is
 *    written with its surrounding blanks stripped. Concatenating the chunks as-is
 *    therefore glues words together ("…z UCHW." + "8/07 i 0" → "UCHW.8/07"), so a
 *    chunk that came in short gets its separating blank back — see
 *    restoreChunkGaps. What cannot be recovered is a blank at a cut whose left
 *    chunk still filled the width (only a *leading* blank of the next chunk was
 *    stripped); across the sample statements that happens once in 37 rows, and it
 *    leaves the identifiers the address matcher reads intact.
 *
 * Encoding is handled by the caller (shared/encoding.ts); this parser expects an
 * already-decoded string, or a Buffer it decodes as Windows-1250.
 */

import * as iconv from 'iconv-lite';
import { PocztowyStatement, PocztowyTransaction } from './types';

/** Width of the `<20`..`<26` description and `<32`/`<33` counterparty chunks. */
const TEXT_CHUNK_WIDTH = 27;
/** Width of the `<27`/`<28` statement-owner chunks. */
const OWNER_CHUNK_WIDTH = 35;

/** `<XX` subfield line, e.g. "<20Zaliczki za 07.2026". */
const SUBFIELD_LINE = /^<(\d{2})(.*)$/;
/** MT940 tag line, e.g. ":61:" or ":28C:". */
const TAG_LINE = /^:(\d{2,3}[A-Z]?):/;
/**
 * :61: without a transaction-type code: value date, optional entry date,
 * optional reversal flag + D/C, amount. Pocztowy leaves the rest empty.
 */
const FIELD_61 = /^(\d{6})(\d{4})?(R?)([DC])([\d,.]+)(.*)$/;

/** Counterparty names Pocztowy uses for its own fees on the account. */
const BANK_ITSELF = /^\s*(bank\s+pocztowy|bp\s*s\.?\s*a\.?)\s*$/i;

export class PocztowyMT940Parser {
  /**
   * Parse MT940 file content.
   * @param content - already-decoded string, or a Buffer (decoded as Windows-1250)
   */
  parse(content: string | Buffer): PocztowyStatement {
    const cleaned = this.cleanContent(
      Buffer.isBuffer(content) ? iconv.decode(content, 'win1250') : String(content)
    );

    const lines = cleaned.split('\n');
    const fields = this.parseFields(lines);

    return {
      reference: this.getFieldValue(fields, ':20:'),
      accountIBAN: this.getFieldValue(fields, ':25:').replace(/^\/?(PL)?/i, '').trim(),
      statementNumber: this.getFieldValue(fields, ':28C:'),
      openingBalance: this.parseBalance(this.getFieldValue(fields, ':60F:')),
      closingBalance: this.parseBalance(this.getFieldValue(fields, ':62F:')),
      availableBalance: fields.has(':64:')
        ? this.parseBalance(this.getFieldValue(fields, ':64:'))
        : undefined,
      accountOwner: this.parseAccountOwner(fields),
      transactions: this.parseTransactions(lines),
    };
  }

  // ── Statement-level fields ─────────────────────────────────

  /**
   * Remove BOM and normalize line endings. The `{1:…}{4:` envelope needs no
   * handling — it precedes the first tag — and the `-}` trailer is dropped where
   * continuation lines are collected.
   */
  private cleanContent(content: string): string {
    return content
      .replace(/^\uFEFF/, '') // UTF-8 BOM
      .replace(/^\uFFFE/, '') // UTF-16 BOM
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  /**
   * Collect the statement-level tags. Transactions are read separately (see
   * parseTransactions), so a `:61:`/`:86:` pair landing here is only used for
   * the trailing owner name.
   */
  private parseFields(lines: string[]): Map<string, string[]> {
    const fields = new Map<string, string[]>();
    let currentTag: string | null = null;
    let currentValue: string[] = [];

    const flush = () => {
      if (currentTag === null) return;
      const existing = fields.get(currentTag);
      if (existing) existing.push(currentValue.join('\n'));
      else fields.set(currentTag, [currentValue.join('\n')]);
    };

    for (const line of lines) {
      const tagMatch = line.match(TAG_LINE);
      if (tagMatch) {
        flush();
        currentTag = `:${tagMatch[1]}:`;
        currentValue = [line.substring(currentTag.length)];
      } else if (currentTag !== null && !/^-?[}\s]*$/.test(line)) {
        currentValue.push(line);
      }
    }
    flush();

    return fields;
  }

  private getFieldValue(fields: Map<string, string[]>, tag: string): string {
    const values = fields.get(tag);
    return values && values.length > 0 ? values[0].trim() : '';
  }

  /**
   * The trailing `:86:NAME ACCOUNT OWNER:…` that follows :62F:. It is the only
   * `:86:` without `<XX` subfields, so pick the last one that has none.
   */
  private parseAccountOwner(fields: Map<string, string[]>): string {
    const candidates = (fields.get(':86:') || []).filter((value) => !value.includes('<'));
    const owner = candidates.length > 0 ? candidates[candidates.length - 1] : '';
    return owner.replace(/^NAME ACCOUNT OWNER:/i, '').replace(/\n/g, ' ').trim();
  }

  /**
   * Parse a balance field (:60F:, :62F:, :64:).
   * Format: [D/C]YYMMDD[currency][amount] — e.g. "C260701PLN358,62".
   */
  private parseBalance(balanceStr: string): { debitCredit: 'D' | 'C'; date: string; amount: number } {
    if (!balanceStr) {
      return { debitCredit: 'C', date: '', amount: 0 };
    }
    return {
      debitCredit: balanceStr[0] as 'D' | 'C',
      date: balanceStr.substring(1, 7),
      amount: this.parseAmount(balanceStr.substring(10)), // skip the 3-char currency
    };
  }

  /** Amounts use a comma as the decimal separator. */
  private parseAmount(amountStr: string): number {
    return parseFloat(amountStr.replace(',', '.')) || 0;
  }

  // ── Transactions ───────────────────────────────────────────

  /**
   * Walk the lines and cut one transaction per `:61:`, collecting every `<XX`
   * subfield line that follows it. Any other tag (`:62F:`, the trailing `:86:`)
   * closes the current transaction.
   */
  private parseTransactions(lines: string[]): PocztowyTransaction[] {
    const transactions: PocztowyTransaction[] = [];

    let field61: string | null = null;
    let subfieldLines: string[] = [];

    const flush = () => {
      if (field61 === null) return;
      const transaction = this.parseTransaction(field61, subfieldLines);
      if (transaction) transactions.push(transaction);
      field61 = null;
      subfieldLines = [];
    };

    for (const line of lines) {
      if (line.startsWith(':61:')) {
        flush();
        field61 = line.substring(':61:'.length);
      } else if (SUBFIELD_LINE.test(line)) {
        if (field61 !== null) subfieldLines.push(line);
      } else if (TAG_LINE.test(line) && !line.startsWith(':86:')) {
        // :86: only introduces the subfields of the transaction we're inside.
        flush();
      }
    }
    flush();

    return transactions;
  }

  /**
   * Parse one transaction from its `:61:` value and its `<XX` subfield lines.
   *
   * :61: — "2607010701C653,00"
   *   260701 = value date (YYMMDD), 0701 = entry date (MMDD),
   *   C = credit, 653,00 = amount. No type code and no reference follow.
   */
  private parseTransaction(field61: string, subfieldLines: string[]): PocztowyTransaction | null {
    const match = field61.trim().match(FIELD_61);
    if (!match) {
      console.error('Pocztowy: unrecognized :61: field:', field61);
      return null;
    }

    const [, valueDate, entryDate, reversal, mark, amountStr, rest] = match;

    // MT940 marks a reversal as "RC"/"RD": a reversed credit takes the money back
    // out of the account, so the row belongs on the opposite side. Pocztowy has
    // not been seen sending one, but reading it the other way round would book a
    // returned payment as income.
    const debitCredit: 'D' | 'C' = reversal
      ? (mark === 'C' ? 'D' : 'C')
      : (mark as 'D' | 'C');

    const subfields = this.parseSubfields(subfieldLines);

    const description = this.restoreChunkGaps(
      this.collectChunks(subfields, 20, 26),
      TEXT_CHUNK_WIDTH
    );
    const counterpartyName = this.joinChunks(
      [subfields.get('32'), subfields.get('33')],
      TEXT_CHUNK_WIDTH
    );
    const accountOwnerName = this.joinChunks(
      [subfields.get('27'), subfields.get('28')],
      OWNER_CHUNK_WIDTH
    );

    // `<31` is the counterparty's account on both sides of the statement (on a
    // credit it is the payer's, on a debit the payee's); `<38` names the
    // beneficiary, which on a credit is our own account — so it is only a fallback.
    const counterpartyAccount = (subfields.get('31') || '').trim();
    const beneficiaryAccount = (subfields.get('38') || '').trim();

    return {
      valueDate,
      entryDate: entryDate || '',
      debitCredit,
      amount: this.parseAmount(amountStr),
      // Pocztowy sends no transaction-type code; `rest` is empty in every known
      // file and is passed through rather than dropped, in case one appears.
      transactionType: rest.trim(),
      reference: (subfields.get('00') || '').trim(),
      ordinal: (subfields.get('10') || '').trim(),
      accountOwnerName,
      details: {
        transactionCode: (subfields.get('00') || '').trim(),
        description,
        counterpartyAccount,
        bankCode: (subfields.get('30') || '').trim(),
        accountNumber: counterpartyAccount,
        counterpartyName,
        transactionCodeField: '',
        counterpartyIBAN: counterpartyAccount || beneficiaryAccount,
        // ING's `~62` (counterparty address continuation) has no Pocztowy
        // counterpart — `<33` is already part of counterpartyName.
        additionalInfo: '',
        additionalInfo2: '',
      },
      raw: {
        field61,
        field86: subfieldLines.join('\n'),
      },
    };
  }

  /** Index the `<XX` lines by tag. */
  private parseSubfields(subfieldLines: string[]): Map<string, string> {
    const subfields = new Map<string, string>();
    for (const line of subfieldLines) {
      const match = line.match(SUBFIELD_LINE);
      if (!match) continue;
      const [, tag, value] = match;
      // A repeated tag would be a continuation, not a replacement.
      subfields.set(tag, (subfields.get(tag) ?? '') + value);
    }
    return subfields;
  }

  /** The values of tags `from`..`to` that are present, in tag order. */
  private collectChunks(subfields: Map<string, string>, from: number, to: number): string[] {
    const chunks: string[] = [];
    for (let tag = from; tag <= to; tag++) {
      const value = subfields.get(String(tag));
      if (value !== undefined) chunks.push(value);
    }
    return chunks;
  }

  /**
   * Give back the blanks the bank stripped off the end of each chunk.
   *
   * The text was cut every `width` characters and each piece written without its
   * trailing spaces, so a piece shorter than `width` ended on a space that is now
   * missing. Restoring one space per short piece turns "…z UCHW." + "8/07 i 0"
   * back into "…z UCHW. 8/07 i 0". The last piece keeps its own end.
   */
  private restoreChunkGaps(chunks: string[], width: number): string[] {
    return chunks.map((chunk, i) =>
      i < chunks.length - 1 && chunk.length < width ? `${chunk} ` : chunk
    );
  }

  /** restoreChunkGaps for a field that is consumed as one string. */
  private joinChunks(chunks: (string | undefined)[], width: number): string {
    const present = chunks.filter((chunk): chunk is string => chunk !== undefined);
    return this.restoreChunkGaps(present, width).join('').trim();
  }

  // ── Filtering ──────────────────────────────────────────────

  /**
   * Filter transactions.
   *
   * Bank-fee heuristic: a debit whose counterparty is Pocztowy itself ("opł. za
   * rachunek", "prowizja wplaty otwarte"). There is no transaction-type code to
   * key on, so the name is the only evidence — same approach as the BOŚ parser.
   */
  filterTransactions(
    transactions: PocztowyTransaction[],
    options: {
      skipNegative?: boolean;
      skipBankFees?: boolean;
      onlyPositive?: boolean;
    } = {}
  ): PocztowyTransaction[] {
    return transactions.filter((trn) => {
      if (options.skipNegative && trn.debitCredit === 'D') {
        return false;
      }

      if (options.onlyPositive && trn.debitCredit !== 'C') {
        return false;
      }

      if (
        options.skipBankFees &&
        trn.debitCredit === 'D' &&
        BANK_ITSELF.test(trn.details.counterpartyName)
      ) {
        return false;
      }

      return true;
    });
  }
}
