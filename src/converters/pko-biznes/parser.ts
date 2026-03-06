/**
 * PKO Biznes ELIXIR Parser
 * Parses ZIP archives containing CSV files in ELIXIR format
 */

import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { PKOBiznesTransaction, PKOBiznesStatement } from './types';

export class PKOBiznesParser {
  /**
   * Parse ZIP file containing PKO Biznes ELIXIR CSV files
   * 
   * @param buffer - ZIP file buffer
   * @param sourceZipFileName - Original ZIP filename (for metadata)
   * @returns Parsed statement with all transactions from all CSV files
   */
  parse(buffer: Buffer, sourceZipFileName: string = 'statement.zip'): PKOBiznesStatement {
    try {
      // Extract ZIP
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();
      
      // Filter for CSV/TXT files (ELIXIR format)
      const csvFiles = zipEntries.filter(entry => 
        !entry.isDirectory && 
        (entry.entryName.endsWith('.txt') || entry.entryName.endsWith('.csv') || entry.entryName.endsWith('.TXT') || entry.entryName.endsWith('.CSV'))
      );
      
      if (csvFiles.length === 0) {
        throw new Error('No CSV/TXT files found in ZIP archive');
      }
      
      console.log(`[PKO Biznes Parser] Found ${csvFiles.length} files in ZIP`);
      
      // Parse all CSV files
      const allTransactions: PKOBiznesTransaction[] = [];
      const accountNumbers = new Set<string>();
      
      for (const entry of csvFiles) {
        const content = entry.getData();
        // Decode from Windows-1250 (Polish encoding used by PKO)
        const text = iconv.decode(content, 'windows-1250');
        const fileName = entry.entryName;
        
        console.log(`[PKO Biznes Parser] Parsing file: ${fileName} (${text.length} bytes)`);
        
        const transactions = this.parseCSVContent(text, fileName);
        allTransactions.push(...transactions);
        
        // Collect account numbers
        transactions.forEach(t => accountNumbers.add(t.ownAccountNumber));
      }
      
      if (allTransactions.length === 0) {
        throw new Error('No transactions found in any CSV file');
      }
      
      // Sort transactions by date
      allTransactions.sort((a, b) => a.date.localeCompare(b.date));
      
      // Determine date range
      const startDate = allTransactions[0].date;
      const endDate = allTransactions[allTransactions.length - 1].date;
      
      console.log(`[PKO Biznes Parser] Successfully parsed ${allTransactions.length} transactions from ${csvFiles.length} files`);
      console.log(`[PKO Biznes Parser] Date range: ${this.formatDate(startDate)} - ${this.formatDate(endDate)}`);
      
      return {
        sourceZipFile: sourceZipFileName,
        filesCount: csvFiles.length,
        accountNumbers: Array.from(accountNumbers),
        startDate,
        endDate,
        transactions: allTransactions,
      };
    } catch (error) {
      console.error('[PKO Biznes Parser] Error parsing ZIP:', error);
      throw new Error(`Failed to parse PKO Biznes ZIP file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Parse CSV content from a single file
   */
  private parseCSVContent(content: string, sourceFile: string): PKOBiznesTransaction[] {
    const transactions: PKOBiznesTransaction[] = [];
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      try {
        const transaction = this.parseCSVLine(line, sourceFile);
        if (transaction) {
          transactions.push(transaction);
        }
      } catch (error) {
        console.warn(`[PKO Biznes Parser] Error parsing line ${i + 1} in ${sourceFile}:`, error);
        console.warn(`[PKO Biznes Parser] Line content: ${line.substring(0, 100)}...`);
        // Continue parsing other lines
      }
    }
    
    return transactions;
  }
  
  /**
   * Parse a single CSV line
   * 
   * Format: operationType,date,amount,code1,code2,code3,counterpartyIBAN,ownAccountNumber,
   *         counterpartyName,counterpartyNameExtra,generalCode,bankCode,description,
   *         emptyField,referenceNumber,emptyField,emptyField
   */
  private parseCSVLine(line: string, sourceFile: string): PKOBiznesTransaction | null {
    // Parse CSV with quoted fields
    const fields = this.parseCSVFields(line);
    
    if (fields.length < 15) {
      console.warn(`[PKO Biznes Parser] Line has too few fields (${fields.length}), skipping`);
      return null;
    }
    
    // Extract fields
    // Format: operationType,date,amount,code1,code2,counterpartyIBAN,ownAccountNumber,
    //         counterpartyName,counterpartyNameExtra,generalCode,bankCode,description,
    //         emptyField,referenceNumber,emptyField,emptyField
    const operationType = fields[0].trim() as '111' | '222';
    const date = fields[1].trim();
    const amountGroszy = parseInt(fields[2].trim(), 10);
    const code1 = fields[3].trim();
    const code2 = fields[4].trim();
    const counterpartyIBAN = fields[5].trim().replace(/["']/g, '');
    const ownAccountNumber = fields[6].trim().replace(/["']/g, '').replace(/\s+/g, ''); // Remove whitespace
    const counterpartyName = fields[7].trim().replace(/["']/g, '').replace(/\|/g, ' ').trim();
    const counterpartyNameExtra = fields[8].trim().replace(/["']/g, '').replace(/\|/g, ' ').trim();
    const generalCode = fields[9].trim();
    const bankCode = fields[10].trim();
    const description = fields[11].trim().replace(/["']/g, '').replace(/\|/g, ' ').trim();
    const referenceNumber = fields[13]?.trim().replace(/["']/g, '') || '';
    
    // Validate operation type
    if (operationType !== '111' && operationType !== '222') {
      console.warn(`[PKO Biznes Parser] Invalid operation type: ${operationType}`);
      return null;
    }
    
    // Validate date format (YYYYMMDD)
    if (!/^\d{8}$/.test(date)) {
      console.warn(`[PKO Biznes Parser] Invalid date format: ${date}`);
      return null;
    }
    
    // Convert amount from groszy to PLN
    const amount = amountGroszy / 100;
    
    return {
      operationType,
      date,
      amount,
      amountGroszy,
      ownAccountNumber,
      counterpartyIBAN,
      counterpartyName,
      counterpartyNameExtra,
      description,
      referenceNumber,
      code1,
      code2,
      generalCode,
      bankCode,
      sourceFile,
      raw: {
        line,
        fields,
      },
    };
  }
  
  /**
   * Parse CSV fields respecting quoted values
   * Handles commas inside quoted strings
   */
  private parseCSVFields(line: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let insideQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        insideQuotes = !insideQuotes;
        // Keep quotes in the field value for now, we'll strip them later
        currentField += char;
      } else if (char === ',' && !insideQuotes) {
        fields.push(currentField);
        currentField = '';
      } else {
        currentField += char;
      }
    }
    
    // Add last field
    fields.push(currentField);
    
    return fields;
  }
  
  /**
   * Filter transactions based on criteria
   */
  filterTransactions(
    transactions: PKOBiznesTransaction[],
    options: {
      skipNegative: boolean;
      skipBankFees: boolean;
    }
  ): PKOBiznesTransaction[] {
    return transactions.filter(transaction => {
      // Skip expenses if skipNegative is enabled (keep only income)
      if (options.skipNegative && transaction.operationType === '222') {
        return false;
      }
      
      // Skip bank fees if skipBankFees is enabled
      // Bank fees typically have specific codes or descriptions
      if (options.skipBankFees) {
        const desc = transaction.description.toLowerCase();
        if (
          desc.includes('opłata') || 
          desc.includes('prowizja') ||
          desc.includes('komisja') ||
          desc.includes('fee')
        ) {
          return false;
        }
      }
      
      return true;
    });
  }
  
  /**
   * Format date from YYYYMMDD to YYYY-MM-DD
   */
  private formatDate(date: string): string {
    if (date.length !== 8) return date;
    return `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
  }
}
