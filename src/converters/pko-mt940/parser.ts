/**
 * PKO BP MT940 Parser
 * Parses MT940 bank statement format into structured data
 * 
 * Note: Encoding is handled by the shared encoding utility (src/shared/encoding.ts).
 * This parser expects properly decoded UTF-8 strings.
 */

import * as iconv from 'iconv-lite';
import { MT940Statement, MT940Transaction } from './types';

export class PKOBPMT940Parser {
  /**
   * Parse MT940 file content
   * @param mt940Content - File content as string (already decoded) or Buffer
   */
  parse(mt940Content: string | Buffer): MT940Statement {
    let cleanedContent: string;
    
    if (Buffer.isBuffer(mt940Content)) {
      // If buffer, try to decode from Windows-1250 (legacy support)
      cleanedContent = iconv.decode(mt940Content, 'win1250');
    } else if (typeof mt940Content === 'string') {
      // String already decoded by shared encoding utility
      cleanedContent = mt940Content;
    } else {
      cleanedContent = String(mt940Content);
    }
    
    // Clean content - remove BOM and normalize line endings
    cleanedContent = this.cleanContent(cleanedContent);
    
    // Split into fields
    const fields = this.parseFields(cleanedContent);
    
    // Extract statement-level information
    const reference = this.getFieldValue(fields, ':20:');
    const accountIBAN = this.getFieldValue(fields, ':25:');
    const statementNumber = this.getFieldValue(fields, ':28C:');
    const openingBalanceStr = this.getFieldValue(fields, ':60F:');
    const closingBalanceStr = this.getFieldValue(fields, ':62F:');
    const availableBalanceStr = this.getFieldValue(fields, ':64:');
    
    // Parse balances
    const openingBalance = this.parseBalance(openingBalanceStr);
    const closingBalance = this.parseBalance(closingBalanceStr);
    const availableBalance = availableBalanceStr ? this.parseBalance(availableBalanceStr) : undefined;
    
    // Parse transactions
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
    // Remove BOM (Byte Order Mark)
    let cleaned = content.replace(/^\uFEFF/, ''); // UTF-8 BOM
    cleaned = cleaned.replace(/^\uFFFE/, ''); // UTF-16 BE BOM
    
    // Normalize line endings to \n
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    return cleaned.trim();
  }

  /**
   * Parse MT940 fields
   * Returns object with field tags as keys
   */
  private parseFields(content: string): Map<string, string[]> {
    const fields = new Map<string, string[]>();
    const lines = content.split('\n');
    
    let currentTag: string | null = null;
    let currentValue: string[] = [];
    
    for (const line of lines) {
      // Check if line starts with a tag (e.g., :20:, :61:, :86:)
      const tagMatch = line.match(/^:(\d{2,3}[A-Z]?):/);
      
      if (tagMatch) {
        // Save previous field
        if (currentTag !== null && currentValue.length > 0) {
          if (!fields.has(currentTag)) {
            fields.set(currentTag, []);
          }
          fields.get(currentTag)!.push(currentValue.join('\n'));
        }
        
        // Start new field
        currentTag = `:${tagMatch[1]}:`;
        const value = line.substring(currentTag.length);
        currentValue = value ? [value] : [];
      } else if (currentTag !== null && line.trim() !== '-') {
        // Continuation of current field (not the ending dash)
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
   * Example: C260102PLN164406,39
   */
  private parseBalance(balanceStr: string): { debitCredit: 'D' | 'C'; date: string; amount: number } {
    if (!balanceStr) {
      return { debitCredit: 'C', date: '', amount: 0 };
    }
    
    const debitCredit = balanceStr[0] as 'D' | 'C';
    const date = balanceStr.substring(1, 7); // YYMMDD
    const amountStr = balanceStr.substring(10); // Skip currency (3 chars)
    const amount = this.parseAmount(amountStr);
    
    return { debitCredit, date, amount };
  }

  /**
   * Parse amount string (handle comma as decimal separator)
   * Example: "431,14" -> 431.14
   */
  private parseAmount(amountStr: string): number {
    const normalized = amountStr.replace(',', '.');
    return parseFloat(normalized) || 0;
  }

  /**
   * Parse transactions from :61: and :86: fields
   */
  private parseTransactions(fields: Map<string, string[]>): MT940Transaction[] {
    const field61s = fields.get(':61:') || [];
    const field86s = fields.get(':86:') || [];
    
    const transactions: MT940Transaction[] = [];
    
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
   * :61: format: YYMMDDMMDD[D/C]amount[transaction type]reference
   * Example: 2601010101C431,14NU13NONREF//5010594470002223
   * 
   * :86: format: Multiple lines with ~ prefixes
   */
  private parseTransaction(field61: string, field86: string): MT940Transaction | null {
    try {
      // Parse :61: field
      const valueDate = field61.substring(0, 6); // YYMMDD
      const entryDate = field61.substring(6, 10); // MMDD
      const debitCredit = field61[10] as 'D' | 'C';
      
      // Find amount (ends before transaction type code - usually starts with 'N')
      let amountEndPos = 11;
      while (amountEndPos < field61.length && !/[A-Z]/.test(field61[amountEndPos])) {
        amountEndPos++;
      }
      const amountStr = field61.substring(11, amountEndPos);
      const amount = this.parseAmount(amountStr);
      
      // Transaction type (e.g., "NU13", "NG04", "N188")
      let typeEndPos = amountEndPos;
      while (typeEndPos < field61.length && field61[typeEndPos] !== 'N') {
        typeEndPos++;
      }
      if (typeEndPos === field61.length) typeEndPos = amountEndPos;
      typeEndPos += 4; // Usually 4 chars (e.g., "NU13")
      if (typeEndPos > field61.length) typeEndPos = field61.length;
      
      const transactionType = field61.substring(amountEndPos, Math.min(typeEndPos, field61.length));
      
      // Reference (after "NONREF//")
      const refMatch = field61.match(/NONREF\/\/(.+)/);
      const reference = refMatch ? refMatch[1].trim() : '';
      
      // Parse :86: field (structured information)
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
      console.error('Error parsing transaction:', error);
      return null;
    }
  }

  /**
   * Parse :86: field (transaction details with ~ prefixes)
   */
  private parseTransactionDetails(field86: string): MT940Transaction['details'] {
    const lines = field86.split('\n');
    
    const details: Record<string, string> = {};
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('~')) {
        const tag = trimmedLine.substring(1, 3); // e.g., "00", "20", "32"
        const value = trimmedLine.substring(3); // Rest of the line
        
        if (!details[tag]) {
          details[tag] = value;
        } else {
          details[tag] += value; // No space - continuation of same field
        }
      }
    }
    
    // Combine description fields (~20-25)
    // Empty fields contain 0xFF byte which decodes to:
    //   U+02D9 (˙ dot above) in ISO-8859-2
    //   U+FFFD (� replacement char) if mis-decoded
    const EMPTY_FIELD_MARKERS = ['\u02D9', '\uFFFD'];
    const descriptionParts: string[] = [];
    for (let i = 20; i <= 25; i++) {
      const tag = i.toString();
      if (details[tag] && !EMPTY_FIELD_MARKERS.includes(details[tag].trim())) {
        descriptionParts.push(details[tag].trim());
      }
    }
    
    // Combine counterparty name fields (~32-33)
    const counterpartyParts: string[] = [];
    if (details['32']) counterpartyParts.push(details['32'].trim());
    if (details['33']) counterpartyParts.push(details['33'].trim());
    
    return {
      transactionCode: details['00'] || '',
      description: descriptionParts,
      bankCode: details['30'] || '',
      accountNumber: details['31'] || '',
      counterpartyName: counterpartyParts.join(''), // No space between ~32 and ~33
      counterpartyIBAN: details['38'] || '',
      transactionDate: details['60'] || '',
      additionalInfo: details['63'] || '',
    };
  }

  /**
   * Filter transactions by criteria
   */
  filterTransactions(
    transactions: MT940Transaction[],
    options: {
      skipNegative?: boolean;
      skipBankFees?: boolean;
      onlyPositive?: boolean;
    } = {}
  ): MT940Transaction[] {
    return transactions.filter((trn) => {
      // Skip debit transactions (expenses) if requested
      if (options.skipNegative && trn.debitCredit === 'D') {
        return false;
      }

      // Only include credit transactions (income) if requested
      if (options.onlyPositive && trn.debitCredit !== 'C') {
        return false;
      }

      // Skip bank fees (transaction type "N188")
      if (options.skipBankFees && trn.transactionType.includes('188')) {
        return false;
      }

      return true;
    });
  }
}
