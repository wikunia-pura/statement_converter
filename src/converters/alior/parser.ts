/**
 * Alior Bank MT940 Parser
 * Parses MT940 bank statement format into structured data.
 *
 * Key differences from PKO MT940:
 *   - :86: subfield delimiter: `<XX` instead of `~XX`
 *   - :61: may contain optional funds code letter after D/C indicator
 *   - Bank fees identified by transaction type `NCHG` or code `8090`
 *   - ASCII encoding (no Polish diacritics)
 *   - Block delimited by `{` ... `-}`
 */

import { AliorStatement, AliorTransaction } from './types';

export class AliorMT940Parser {
  /**
   * Parse MT940 file content
   * @param content - File content as string (already decoded)
   */
  parse(content: string): AliorStatement {
    const cleanedContent = this.cleanContent(content);
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
   * Clean content - remove BOM, normalize line endings, strip block delimiters
   */
  private cleanContent(content: string): string {
    let cleaned = content.replace(/^\uFEFF/, '');
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Strip Alior block delimiters: leading `{` and trailing `-}`
    cleaned = cleaned.replace(/^\{/, '').replace(/-\}\s*$/, '');
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
        if (currentTag !== null && currentValue.length > 0) {
          if (!fields.has(currentTag)) {
            fields.set(currentTag, []);
          }
          fields.get(currentTag)!.push(currentValue.join('\n'));
        }

        currentTag = `:${tagMatch[1]}:`;
        const value = line.substring(currentTag.length);
        currentValue = value ? [value] : [];
      } else if (currentTag !== null && line.trim() !== '-' && line.trim() !== '-}') {
        currentValue.push(line);
      }
    }

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
   * Example: C260202PLN21026,50
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
   * Parse transactions from :61: and :86: fields
   */
  private parseTransactions(fields: Map<string, string[]>): AliorTransaction[] {
    const field61s = fields.get(':61:') || [];
    const field86s = fields.get(':86:') || [];

    const transactions: AliorTransaction[] = [];

    for (let i = 0; i < field61s.length; i++) {
      const field61 = field61s[i];
      const field86 = i < field86s.length ? field86s[i] : '';

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
   * :61: format: YYMMDDMMDD[D/C][funds_code?]amount[tx_type]reference
   * Examples:
   *   2602020202CN506,14NTRFNONREF//17929   (C + funds code N + 506,14)
   *   2602020202DN2460,00NTRFNONREF//17931   (D + funds code N + 2460,00)
   */
  private parseTransaction(field61: string, field86: string): AliorTransaction | null {
    try {
      // Only first line of :61: contains the structured data
      const firstLine = field61.split('\n')[0];

      const valueDate = firstLine.substring(0, 6);   // YYMMDD
      const entryDate = firstLine.substring(6, 10);   // MMDD
      const debitCredit = firstLine[10] as 'D' | 'C';

      // After D/C there may be an optional funds code (single alpha char)
      let pos = 11;
      if (pos < firstLine.length && /[A-Z]/i.test(firstLine[pos]) && !/[0-9,]/.test(firstLine[pos])) {
        // Skip funds code character (e.g., 'N')
        pos++;
      }

      // Parse amount: digits and comma until first uppercase letter
      const amountStart = pos;
      while (pos < firstLine.length && !/[A-Z]/.test(firstLine[pos])) {
        pos++;
      }
      const amountStr = firstLine.substring(amountStart, pos);
      const amount = this.parseAmount(amountStr);

      // Transaction type: 4 characters (e.g., "NTRF", "NCHG")
      const transactionType = firstLine.substring(pos, Math.min(pos + 4, firstLine.length));

      // Reference (after "NONREF//")
      const refMatch = firstLine.match(/NONREF\/\/(.+)/);
      const reference = refMatch ? refMatch[1].trim() : '';

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
      console.error('Error parsing Alior transaction:', error);
      return null;
    }
  }

  /**
   * Parse :86: field (transaction details with `<XX` subfield markers)
   *
   * Alior :86: format:
   *   First line: `CODE<00value<10value`  (inline subfields)
   *   Subsequent lines: `<XXvalue`
   *
   * All lines are joined and then split by `<` regex to extract subfields.
   */
  private parseTransactionDetails(field86: string): AliorTransaction['details'] {
    // Join all lines into one string
    const combined = field86.replace(/\n/g, '');

    // Split by `<` — each piece after split starts with 2-digit tag
    // The first piece before any `<` is the initial code (e.g., "0510")
    const parts = combined.split('<');

    const subfields: Record<string, string> = {};

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.length < 2) continue;

      const tag = part.substring(0, 2);
      const value = part.substring(2);

      // Accumulate values for multi-line subfields (<20>, <21>, <22>, etc.)
      if (!subfields[tag]) {
        subfields[tag] = value;
      } else {
        subfields[tag] += value;
      }
    }

    // Description fields: <20>-<25>
    const descriptionParts: string[] = [];
    for (let i = 20; i <= 25; i++) {
      const tag = i.toString();
      if (subfields[tag] && subfields[tag].trim()) {
        descriptionParts.push(subfields[tag].trim());
      }
    }

    // Counterparty name: <27> + <28>
    const counterpartyParts: string[] = [];
    if (subfields['27']) counterpartyParts.push(subfields['27'].trim());
    if (subfields['28']) counterpartyParts.push(subfields['28'].trim());

    return {
      transactionCode: subfields['00'] || '',
      description: descriptionParts,
      counterpartyName: counterpartyParts.join(' '),
      counterpartyAddress: subfields['29']?.trim() || '',
      counterpartyShortName: subfields['32']?.trim() || '',
      bankCode: subfields['30'] || '',
      accountNumber: subfields['31'] || '',
      counterpartyIBAN: subfields['38'] || '',
      city: subfields['60']?.trim() || '',
      additionalInfo: subfields['63']?.trim() || '',
    };
  }

  /**
   * Filter transactions by criteria
   */
  filterTransactions(
    transactions: AliorTransaction[],
    options: {
      skipNegative?: boolean;
      skipBankFees?: boolean;
      onlyPositive?: boolean;
    } = {}
  ): AliorTransaction[] {
    return transactions.filter((trn) => {
      if (options.skipNegative && trn.debitCredit === 'D') {
        return false;
      }

      if (options.onlyPositive && trn.debitCredit !== 'C') {
        return false;
      }

      // Skip bank fees: NCHG transaction type or 8090 transaction code
      if (options.skipBankFees) {
        if (trn.transactionType === 'NCHG' || trn.details.transactionCode.startsWith('8090')) {
          return false;
        }
      }

      return true;
    });
  }
}
