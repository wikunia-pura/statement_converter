/**
 * PKO SA EXP Parser
 * Parses PKO SA bank export files in EXP format
 */

import iconv from 'iconv-lite';
import { PKOSATransaction, PKOSAStatement } from './types';

export class PKOSAParser {
  /**
   * Parse PKO SA EXP file content
   * 
   * @param content - File content (string or Buffer)
   * @returns Parsed statement with all transactions
   */
  parse(content: string | Buffer): PKOSAStatement {
    try {
      // Decode from Windows-1250 if Buffer
      const text = typeof content === 'string' 
        ? content 
        : iconv.decode(content, 'windows-1250');
      
      const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      console.log(`[PKO SA Parser] Processing ${lines.length} lines`);
      
      // Parse statement data
      let startDate = '';
      let endDate = '';
      let accountNumber: string | undefined;
      let openingBalance: number | undefined;
      let closingBalance: number | undefined;
      let currency: string | undefined;
      const transactions: PKOSATransaction[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('#DATA#')) {
          // Parse date line
          const dateMatch = line.match(/#DATA#\s+"([^"]+)"/);
          if (dateMatch) {
            const date = dateMatch[1];
            if (!startDate) {
              startDate = date;
            } else if (!endDate) {
              endDate = date;
            }
          }
        } else if (line.startsWith('#SALDO#')) {
          // Parse balance line
          // Format: #SALDO# "account" "opening" "closing" "currency"
          const fields = this.extractQuotedFields(line);
          if (fields.length >= 4) {
            accountNumber = fields[0];
            openingBalance = parseFloat(fields[1]);
            closingBalance = parseFloat(fields[2]);
            currency = fields[3];
          }
        } else if (line.startsWith('#OPERACJA#')) {
          // Parse transaction line
          // Format: #OPERACJA# "amount" "description" "counterparty" "currency" "date" "account" "code"
          const transaction = this.parseTransaction(line);
          if (transaction) {
            transactions.push(transaction);
          }
        }
      }
      
      console.log(`[PKO SA Parser] Successfully parsed ${transactions.length} transactions`);
      console.log(`[PKO SA Parser] Date range: ${startDate} - ${endDate}`);
      
      if (openingBalance !== undefined && closingBalance !== undefined) {
        console.log(`[PKO SA Parser] Balance: ${openingBalance} → ${closingBalance} ${currency || ''}`);
      }
      
      return {
        startDate,
        endDate,
        accountNumber,
        openingBalance,
        closingBalance,
        currency,
        transactions,
      };
    } catch (error) {
      console.error('[PKO SA Parser] Error parsing file:', error);
      throw new Error(`Failed to parse PKO SA EXP file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Parse a single transaction line
   * Format: #OPERACJA# "amount" "description" "counterparty" "currency" "date" "account" "code"
   */
  private parseTransaction(line: string): PKOSATransaction | null {
    try {
      const fields = this.extractQuotedFields(line);
      
      if (fields.length < 7) {
        console.warn(`[PKO SA Parser] Transaction line has too few fields (${fields.length}), skipping`);
        return null;
      }
      
      // Extract fields
      const amountStr = fields[0].trim();
      const description = fields[1].trim();
      const counterparty = fields[2].trim();
      const currency = fields[3].trim();
      const date = fields[4].trim(); // DD/MM/YYYY
      const accountNumber = fields[5].trim();
      const code = fields[6].trim();
      
      // Parse amount
      const amount = parseFloat(amountStr);
      if (isNaN(amount)) {
        console.warn(`[PKO SA Parser] Invalid amount: ${amountStr}`);
        return null;
      }
      
      const amountAbsolute = Math.abs(amount);
      const isIncome = amount > 0;
      
      // Convert date from DD/MM/YYYY to YYYY-MM-DD
      const dateFormatted = this.formatDate(date);
      
      return {
        amount,
        amountAbsolute,
        isIncome,
        description,
        counterparty,
        currency,
        date,
        dateFormatted,
        accountNumber,
        code,
        raw: {
          line,
          fields,
        },
      };
    } catch (error) {
      console.warn(`[PKO SA Parser] Error parsing transaction line:`, error);
      console.warn(`[PKO SA Parser] Line: ${line.substring(0, 100)}...`);
      return null;
    }
  }
  
  /**
   * Extract fields enclosed in double quotes from a line
   * Handles multi-line fields and escaped quotes
   */
  private extractQuotedFields(line: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let insideQuotes = false;
    let i = 0;
    
    // Skip the tag part (e.g., "#OPERACJA# ")
    const tagEnd = line.indexOf('#', 1);
    if (tagEnd !== -1) {
      i = tagEnd + 1;
      // Skip whitespace after tag
      while (i < line.length && line[i] === ' ') i++;
    }
    
    while (i < line.length) {
      const char = line[i];
      
      if (char === '"' && !insideQuotes) {
        // Start of quoted field
        insideQuotes = true;
        currentField = '';
      } else if (char === '"' && insideQuotes) {
        // Check if it's an escaped quote (double quote)
        if (i + 1 < line.length && line[i + 1] === '"') {
          currentField += '"';
          i++; // Skip next quote
        } else {
          // End of quoted field
          insideQuotes = false;
          fields.push(currentField);
          currentField = '';
        }
      } else if (insideQuotes) {
        currentField += char;
      }
      // Skip whitespace and other characters outside quotes
      
      i++;
    }
    
    // Handle case where quote wasn't closed
    if (insideQuotes && currentField.length > 0) {
      fields.push(currentField);
    }
    
    return fields;
  }
  
  /**
   * Convert date from DD/MM/YYYY to YYYY-MM-DD
   */
  private formatDate(date: string): string {
    const parts = date.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return date;
  }
  
  /**
   * Filter transactions based on criteria
   */
  filterTransactions(
    transactions: PKOSATransaction[],
    options: {
      skipNegative: boolean;
      skipBankFees: boolean;
    }
  ): PKOSATransaction[] {
    return transactions.filter(transaction => {
      // Skip expenses if skipNegative is enabled (keep only income)
      if (options.skipNegative && !transaction.isIncome) {
        return false;
      }
      
      // Skip bank fees if skipBankFees is enabled
      // Bank fees typically have codes like 8300 or descriptions with "Opłata"
      if (options.skipBankFees) {
        if (transaction.code === '8300') {
          return false;
        }
        const desc = transaction.description.toLowerCase();
        if (
          desc.includes('opłata za kod') || 
          desc.includes('opłata za przelew') ||
          desc.includes('prowizja') ||
          desc.includes('komisja')
        ) {
          return false;
        }
      }
      
      return true;
    });
  }
}
