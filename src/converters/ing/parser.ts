/**
 * ING Bank MT940 Parser
 * Parses MT940 bank statement format into structured data.
 *
 * Key differences from PKO MT940 / Alior MT940:
 *   - :86: appears TWICE per transaction:
 *       1st :86: — short code only (e.g., "082")
 *       2nd :86: — full structured data with `~XX` subfields
 *   - :61: field uses `S` separator between amount and 3-digit transaction type
 *     (e.g., "2601310131D1014,59S08297205308909")
 *   - Last entry may be balance info (type 940 / reference NONREF) — filtered out
 *   - Encoding: CP852 (DOS Latin-2) — Polish diacritics in legacy DOS encoding
 *   - ~62 field often contains continuation of counterparty address
 *   - Encoding: Windows-1250 (Polish diacritics supported)
 */

import * as iconv from 'iconv-lite';
import { INGStatement, INGTransaction } from './types';

export class INGMT940Parser {
  /**
   * Parse MT940 file content
   * @param content - File content as string (already decoded) or Buffer
   */
  parse(content: string | Buffer): INGStatement {
    let cleanedContent: string;

    if (Buffer.isBuffer(content)) {
      // ING MT940 files use CP852 (DOS Latin-2) encoding
      cleanedContent = iconv.decode(content, 'cp852');
    } else if (typeof content === 'string') {
      cleanedContent = content;
    } else {
      cleanedContent = String(content);
    }

    cleanedContent = this.cleanContent(cleanedContent);
    const fields = this.parseFields(cleanedContent);

    const reference = this.getFieldValue(fields, ':20:');
    const accountIBAN = this.getFieldValue(fields, ':25:');
    const statementNumber = this.getFieldValue(fields, ':28C:');
    const openingBalanceStr = this.getFieldValue(fields, ':60F:');
    const closingBalanceStr = this.getFieldValue(fields, ':62F:');
    const availableBalanceStr = this.getFieldValue(fields, ':64:');

    const openingBalance = this.parseBalance(openingBalanceStr);
    const closingBalance = this.parseBalance(closingBalanceStr);
    const availableBalance = availableBalanceStr ? this.parseBalance(availableBalanceStr) : undefined;

    const transactions = this.parseTransactions(fields);

    return {
      reference,
      accountIBAN,
      statementNumber,
      openingBalance,
      closingBalance,
      availableBalance,
      transactions,
    };
  }

  /**
   * Clean content - remove BOM, normalize line endings
   */
  private cleanContent(content: string): string {
    let cleaned = content.replace(/^\uFEFF/, ''); // UTF-8 BOM
    cleaned = cleaned.replace(/^\uFFFE/, '');      // UTF-16 BE BOM
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return cleaned.trim();
  }

  /**
   * Parse MT940 fields into a map of tag → values[]
   */
  private parseFields(content: string): Map<string, string[]> {
    const fields = new Map<string, string[]>();
    const lines = content.split('\n');

    let currentTag: string | null = null;
    let currentValue: string[] = [];

    for (const line of lines) {
      const tagMatch = line.match(/^:(\d{2,3}[A-Z]?):/);

      if (tagMatch) {
        // Save previous field
        if (currentTag !== null && currentValue.length > 0) {
          if (!fields.has(currentTag)) {
            fields.set(currentTag, []);
          }
          fields.get(currentTag)!.push(currentValue.join('\n'));
        }

        currentTag = `:${tagMatch[1]}:`;
        const value = line.substring(currentTag.length);
        currentValue = value ? [value] : [];
      } else if (currentTag !== null && line.trim() !== '-') {
        currentValue.push(line);
      }
    }

    // Save last field
    if (currentTag !== null && currentValue.length > 0) {
      if (!fields.has(currentTag)) {
        fields.set(currentTag, []);
      }
      fields.get(currentTag)!.push(currentValue.join('\n'));
    }

    return fields;
  }

  /**
   * Get single field value
   */
  private getFieldValue(fields: Map<string, string[]>, tag: string): string {
    const values = fields.get(tag);
    return values && values.length > 0 ? values[0] : '';
  }

  /**
   * Parse balance field (:60F:, :62F:, :64:)
   * Format: [D/C]YYMMDD[currency]amount
   * Example: C260131PLN3152,41
   */
  private parseBalance(balanceStr: string): { debitCredit: 'D' | 'C'; date: string; amount: number } {
    if (!balanceStr) {
      return { debitCredit: 'C', date: '', amount: 0 };
    }

    const debitCredit = balanceStr[0] as 'D' | 'C';
    const date = balanceStr.substring(1, 7);
    const amountStr = balanceStr.substring(10); // Skip currency (3 chars)
    const amount = this.parseAmount(amountStr);

    return { debitCredit, date, amount };
  }

  /**
   * Parse amount string (comma as decimal separator)
   */
  private parseAmount(amountStr: string): number {
    const normalized = amountStr.replace(',', '.');
    return parseFloat(normalized) || 0;
  }

  /**
   * Parse transactions from :61: and :86: fields.
   *
   * ING produces TWO :86: entries per transaction:
   *   - 1st :86: — short code (e.g., "082")
   *   - 2nd :86: — structured data with ~XX subfields
   *
   * Strategy: identify the "detailed" :86: fields (those containing `~`)
   * and pair them 1:1 with :61: fields.  Also filters out special
   * balance-info entries (transaction type "940").
   */
  private parseTransactions(fields: Map<string, string[]>): INGTransaction[] {
    const field61s = fields.get(':61:') || [];
    const field86s = fields.get(':86:') || [];

    // Separate detailed :86: fields (contain ~XX subfields) from short codes
    const detailedField86s = field86s.filter(f => f.includes('~'));

    const transactions: INGTransaction[] = [];

    for (let i = 0; i < field61s.length; i++) {
      const field61 = field61s[i];
      const field86 = i < detailedField86s.length ? detailedField86s[i] : '';

      const transaction = this.parseTransaction(field61, field86);
      if (transaction) {
        transactions.push(transaction);
      }
    }

    return transactions;
  }

  /**
   * Parse single transaction from :61: and :86: fields
   *
   * :61: format: YYMMDDMMDD[D/C]amount S txtype reference
   * Example: 2601310131D1014,59S08297205308909
   *   - 260131 = valueDate (YYMMDD)
   *   - 0131   = entryDate (MMDD)
   *   - D      = debit
   *   - 1014,59 = amount
   *   - S      = separator
   *   - 082    = transaction type (3 digits)
   *   - 97205308909 = reference
   *
   * :86: format: code~00value~20value~21value...
   */
  private parseTransaction(field61: string, field86: string): INGTransaction | null {
    try {
      const firstLine = field61.split('\n')[0];

      const valueDate = firstLine.substring(0, 6);   // YYMMDD
      const entryDate = firstLine.substring(6, 10);   // MMDD
      const debitCredit = firstLine[10] as 'D' | 'C';

      // Amount: from position 11 until 'S' separator
      const sPos = firstLine.indexOf('S', 11);
      if (sPos === -1) {
        console.error('ING: Could not find S separator in :61: field:', firstLine);
        return null;
      }

      const amountStr = firstLine.substring(11, sPos);
      const amount = this.parseAmount(amountStr);

      // Transaction type: 3 digits after 'S'
      const transactionType = firstLine.substring(sPos + 1, sPos + 4);

      // Reference: everything after the 3-digit type
      const reference = firstLine.substring(sPos + 4).trim();

      // Filter out balance info entries (type "940")
      if (transactionType === '940') {
        return null;
      }

      // Parse :86: field
      const details = this.parseTransactionDetails(field86);

      return {
        valueDate,
        entryDate,
        debitCredit,
        amount,
        transactionType,
        reference,
        details,
        raw: {
          field61,
          field86,
        },
      };
    } catch (error) {
      console.error('Error parsing ING transaction:', error);
      return null;
    }
  }

  /**
   * Parse :86: field (transaction details with `~XX` subfield markers)
   *
   * ING :86: detailed format:
   *   082~00TS41PRZELEW~20RATA KREDYTU NR~21002469556100...
   *
   * The line starts with the transaction code (e.g., "082") followed
   * by ~XX subfields inline.  Multi-line fields use continuation lines
   * starting with ~XX.
   *
   * Subfields:
   *   ~00 — transaction type info
   *   ~20..~25 — description
   *   ~29 — counterparty account (raw)
   *   ~30 — bank code
   *   ~31 — account number
   *   ~32, ~33 — counterparty name
   *   ~34 — transaction code
   *   ~38 — counterparty IBAN (PL prefix)
   *   ~62 — continuation of address/name
   *   ~63 — additional info
   */
  private parseTransactionDetails(field86: string): INGTransaction['details'] {
    // Join all lines and extract ~XX subfields
    const combined = field86.replace(/\n/g, '');

    // Split by `~` — each piece after split starts with 2-digit tag
    // First piece before any `~` is the leading transaction code (e.g., "082")
    const parts = combined.split('~');

    const subfields: Record<string, string> = {};

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.length < 2) continue;

      const tag = part.substring(0, 2);
      const value = part.substring(2);

      // Accumulate values for multi-occurrence subfields
      if (!subfields[tag]) {
        subfields[tag] = value;
      } else {
        subfields[tag] += value;
      }
    }

    // Description fields: ~20 to ~25
    const descriptionParts: string[] = [];
    for (let i = 20; i <= 25; i++) {
      const tag = i.toString();
      if (subfields[tag] && subfields[tag].trim()) {
        descriptionParts.push(subfields[tag].trim());
      }
    }

    // Counterparty name: ~32 + ~33
    const counterpartyParts: string[] = [];
    if (subfields['32']) counterpartyParts.push(subfields['32'].trim());
    if (subfields['33']) counterpartyParts.push(subfields['33'].trim());

    // ~62 often contains continuation of counterparty name/address
    let additionalInfo = subfields['62']?.trim() || '';

    return {
      transactionCode: subfields['00'] || '',
      description: descriptionParts,
      counterpartyAccount: subfields['29']?.trim() || '',
      bankCode: subfields['30'] || '',
      accountNumber: subfields['31'] || '',
      counterpartyName: counterpartyParts.join(''), // No space — continuation
      transactionCodeField: subfields['34'] || '',
      counterpartyIBAN: subfields['38'] || '',
      additionalInfo,
      additionalInfo2: subfields['63']?.trim() || '',
    };
  }

  /**
   * Filter transactions by criteria
   */
  filterTransactions(
    transactions: INGTransaction[],
    options: {
      skipNegative?: boolean;
      skipBankFees?: boolean;
      onlyPositive?: boolean;
    } = {}
  ): INGTransaction[] {
    return transactions.filter((trn) => {
      if (options.skipNegative && trn.debitCredit === 'D') {
        return false;
      }

      if (options.onlyPositive && trn.debitCredit !== 'C') {
        return false;
      }

      // Skip bank fees: type "940" (balance info) already filtered in parseTransaction
      // Also skip known fee codes if any
      if (options.skipBankFees) {
        if (trn.transactionType === '940') {
          return false;
        }
      }

      return true;
    });
  }
}
