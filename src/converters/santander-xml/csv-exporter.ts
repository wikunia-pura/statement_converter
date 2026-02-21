/**
 * CSV/TXT Exporter for accounting system
 * Exports transactions to tab-separated TXT format compatible with accounting software
 */

import { ProcessedTransaction } from './types';

export interface CsvExportOptions {
  separator?: string;
  dateFormat?: 'D.MM.YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  decimalSeparator?: ',' | '.';
}

export class CsvExporter {
  private options: Required<CsvExportOptions>;

  constructor(options: CsvExportOptions = {}) {
    this.options = {
      separator: options.separator || '\t',  // TAB separator by default
      dateFormat: options.dateFormat || 'D.MM.YYYY',
      decimalSeparator: options.decimalSeparator || ',',
    };
  }

  /**
   * Export transactions to CSV format
   */
  export(transactions: ProcessedTransaction[]): string {
    const lines: string[] = [];

    // Header
    lines.push(this.createHeader());

    // Get current month for document number (BNK/XXXX)
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const docNumber = `BNK/${String(currentMonth).padStart(4, '0')}`;

    let position = 1;

    // Separate transactions into income (positive) and expenses (negative)
    const incomeTransactions = transactions.filter(t => t.transactionType === 'income');
    const expenseTransactions = transactions.filter(t => t.transactionType === 'expense');

    // ========== INCOME SECTION ==========
    // Separate income into recognized and unrecognized
    const unrecognizedIncome: ProcessedTransaction[] = [];
    const recognizedIncome: ProcessedTransaction[] = [];

    for (const transaction of incomeTransactions) {
      const apartmentNumber = this.extractApartmentNumber(transaction);
      if (apartmentNumber === null) {
        unrecognizedIncome.push(transaction);
      } else {
        recognizedIncome.push(transaction);
      }
    }

    // Process unrecognized income first (single line, no k_ma)
    for (let i = 0; i < unrecognizedIncome.length; i++) {
      const transaction = unrecognizedIncome[i];
      const transactionIndex = incomeTransactions.indexOf(transaction) + 1; // Find position in original array
      const date = this.formatDate(transaction.original.exeDate);
      const description = `NIEROZPOZNANE #${transactionIndex} ` + this.cleanDescription(transaction.original.descBase);
      const amount = this.formatAmount(transaction.original.value);

      // Single line: k_wn = 131-1, k_ma = -
      lines.push(this.createLine({
        nr_dok: docNumber,
        nr_poz: position++,
        data_p: date,
        tresc: description,
        kwota: amount,
        k_wn: '131-1',
        k_ma: '   -',
      }));
    }

    // Process recognized income (2 lines each)
    for (const transaction of recognizedIncome) {
      const apartmentNumber = this.extractApartmentNumber(transaction)!;
      const date = this.formatDate(transaction.original.exeDate);
      const description = this.cleanDescription(transaction.original.descBase);
      const amount = this.formatAmount(transaction.original.value);

      // Line 1: k_wn = 131-1, k_ma = -
      lines.push(this.createLine({
        nr_dok: docNumber,
        nr_poz: position++,
        data_p: date,
        tresc: description,
        kwota: amount,
        k_wn: '131-1',
        k_ma: '   -',
      }));

      // Line 2: k_wn = -, k_ma = 204-XXXXXX
      lines.push(this.createLine({
        nr_dok: docNumber,
        nr_poz: position++,
        data_p: date,
        tresc: description,
        kwota: amount,
        k_wn: '   -',
        k_ma: this.formatAccountNumber(apartmentNumber),
      }));
    }

    // ========== EXPENSES SECTION ==========
    // Process expenses (negative amounts, placed below income)
    for (let i = 0; i < expenseTransactions.length; i++) {
      const transaction = expenseTransactions[i];
      const date = this.formatDate(transaction.original.exeDate);
      const matchedContractor = transaction.matchedContractor;
      
      // Convert negative amount to positive for display
      const amount = this.formatAmount(Math.abs(transaction.original.value));

      let description: string;
      let contractorAccount: string;

      if (matchedContractor && matchedContractor.contractor) {
        // Matched contractor
        description = this.cleanDescription(transaction.original.descBase);
        contractorAccount = matchedContractor.contractor.kontoKontrahenta;
      } else {
        // Unrecognized contractor
        const expenseIndex = i + 1;
        description = `NIEROZPOZNANY KONTRAHENT #${expenseIndex} ` + this.cleanDescription(transaction.original.descBase);
        contractorAccount = '   -'; // No contractor account for unrecognized
      }

      // Single line per expense: k_wn = contractor account (or -), k_ma = 131-1
      lines.push(this.createLine({
        nr_dok: docNumber,
        nr_poz: position++,
        data_p: date,
        tresc: description,
        kwota: amount,
        k_wn: contractorAccount,
        k_ma: '131-1',
      }));
    }

    return lines.join('\n');
  }

  /**
   * Export auxiliary file with contractor matching details
   */
  exportAuxiliary(transactions: ProcessedTransaction[]): string {
    const lines: string[] = [];

    // Separate transactions into income and expenses
    const incomeTransactions = transactions.filter(t => t.transactionType === 'income');
    const expenseTransactions = transactions.filter(t => t.transactionType === 'expense');

    // ========== INCOME SECTION ==========
    if (incomeTransactions.length > 0) {
      lines.push('='.repeat(80));
      lines.push('WPŁATY (INCOME)');
      lines.push('='.repeat(80));
      lines.push('');

      for (let i = 0; i < incomeTransactions.length; i++) {
        const transaction = incomeTransactions[i];
        const date = this.formatDate(transaction.original.exeDate);
        const amount = this.formatAmount(transaction.original.value);
        const apartmentNumber = this.extractApartmentNumber(transaction);

        lines.push(`Pozycja #${i + 1}`);
        lines.push(`Data: ${date}`);
        lines.push(`Kwota: ${amount}`);
        lines.push(`Opis bazowy: ${transaction.original.descBase}`);
        if (transaction.original.descOpt) {
          lines.push(`Opis opcjonalny: ${transaction.original.descOpt}`);
        }
        
        if (apartmentNumber) {
          lines.push(`Rozpoznane mieszkanie: ${apartmentNumber}`);
          lines.push(`Konto: ${this.formatAccountNumber(apartmentNumber)}`);
          if (transaction.extracted?.tenantName) {
            lines.push(`Nazwa najemcy: ${transaction.extracted.tenantName}`);
          }
        } else {
          lines.push(`Status: NIEROZPOZNANE`);
        }

        if (transaction.extracted?.warnings && transaction.extracted.warnings.length > 0) {
          lines.push(`Ostrzeżenia: ${transaction.extracted.warnings.join(', ')}`);
        }

        lines.push('-'.repeat(80));
        lines.push('');
      }
    }

    // ========== EXPENSES SECTION ==========
    if (expenseTransactions.length > 0) {
      lines.push('='.repeat(80));
      lines.push('WYDATKI (EXPENSES) - DOPASOWANIE KONTRAHENTÓW');
      lines.push('='.repeat(80));
      lines.push('');

      for (let i = 0; i < expenseTransactions.length; i++) {
        const transaction = expenseTransactions[i];
        const date = this.formatDate(transaction.original.exeDate);
        const amount = this.formatAmount(Math.abs(transaction.original.value));
        const matchedContractor = transaction.matchedContractor;

        lines.push(`Pozycja #${i + 1}`);
        lines.push(`Data: ${date}`);
        lines.push(`Kwota: ${amount}`);
        lines.push(`Opis bazowy: ${transaction.original.descBase}`);
        if (transaction.original.descOpt) {
          lines.push(`Opis opcjonalny: ${transaction.original.descOpt}`);
        }

        if (matchedContractor && matchedContractor.contractor) {
          lines.push(`Dopasowany kontrahent: ${matchedContractor.contractor.nazwa}`);
          lines.push(`Konto kontrahenta: ${matchedContractor.contractor.kontoKontrahenta}`);
          lines.push(`Pewność dopasowania: ${matchedContractor.confidence}%`);
          lines.push(`Metoda: wynik automatycznego dopasowania`);
          if (matchedContractor.matchedIn) {
            lines.push(`Dopasowano w: ${matchedContractor.matchedIn === 'desc-opt' ? 'opis opcjonalny' : 'opis bazowy'}`);
          }
        } else {
          lines.push(`Status: NIEROZPOZNANY KONTRAHENT`);
          lines.push(`Wymaga ręcznego przypisania kontrahenta`);
        }

        lines.push('-'.repeat(80));
        lines.push('');
      }
    }

    // Summary
    lines.push('='.repeat(80));
    lines.push('PODSUMOWANIE');
    lines.push('='.repeat(80));
    lines.push(`Łączna liczba transakcji: ${transactions.length}`);
    lines.push(`  - Wpłaty: ${incomeTransactions.length}`);
    lines.push(`  - Wydatki: ${expenseTransactions.length}`);
    
    const matchedExpenses = expenseTransactions.filter(t => t.matchedContractor).length;
    const unrecognizedExpenses = expenseTransactions.length - matchedExpenses;
    
    if (expenseTransactions.length > 0) {
      lines.push(`  - Wydatki rozpoznane: ${matchedExpenses}`);
      lines.push(`  - Wydatki nierozpoznane: ${unrecognizedExpenses}`);
      const matchRate = ((matchedExpenses / expenseTransactions.length) * 100).toFixed(1);
      lines.push(`  - Wskaźnik dopasowania: ${matchRate}%`);
    }

    return lines.join('\n');
  }

  /**
   * Create CSV header
   */
  private createHeader(): string {
    return ['nr_dok', 'nr_poz', 'data_p', 'tresc', 'kwota', 'k_wn', 'k_ma']
      .join(this.options.separator);
  }

  /**
   * Create CSV line
   */
  private createLine(data: {
    nr_dok: string;
    nr_poz: number;
    data_p: string;
    tresc: string;
    kwota: string;
    k_wn: string;
    k_ma: string;
  }): string {
    return [
      data.nr_dok,
      data.nr_poz,
      data.data_p,
      data.tresc,
      data.kwota,
      data.k_wn,
      data.k_ma,
    ].join(this.options.separator);
  }

  /**
   * Extract apartment number from transaction
   */
  private extractApartmentNumber(transaction: ProcessedTransaction): string | null {
    // Use extracted apartment number directly
    const apartmentNumber = transaction.extracted?.apartmentNumber;
    
    // Return if exists and not empty
    if (apartmentNumber && apartmentNumber.trim() !== '') {
      return apartmentNumber;
    }

    return null;
  }

  /**
   * Format apartment number to account format: 204-XXXXXX
   */
  private formatAccountNumber(apartmentNumber: string): string {
    // Handle ZGN special case - all zeros
    if (apartmentNumber.toUpperCase() === 'ZGN') {
      return '204-000000';
    }

    // Remove any non-numeric characters and pad with zeros
    const numericPart = apartmentNumber.replace(/\D/g, '');
    const paddedNumber = numericPart.padStart(6, '0');
    
    return `204-${paddedNumber}`;
  }

  /**
   * Format date according to options
   */
  private formatDate(date: string): string {
    // Date from XML is in DD/MM/YYYY format (e.g., "01/04/2025")
    const [day, month, year] = date.split('/');
    
    if (this.options.dateFormat === 'D.MM.YYYY') {
      // Remove leading zero from day, keep leading zero in month
      const dayNum = parseInt(day, 10);
      return `${dayNum}.${month}.${year}`;
    }
    
    if (this.options.dateFormat === 'DD/MM/YYYY') {
      return `${day}/${month}/${year}`;
    }
    
    // YYYY-MM-DD format
    return `${year}-${month}-${day}`;
  }

  /**
   * Format amount with proper decimal separator
   */
  private formatAmount(amount: number): string {
    const formatted = amount.toFixed(2);
    
    if (this.options.decimalSeparator === ',') {
      return formatted.replace('.', ',');
    }
    
    return formatted;
  }

  /**
   * Clean description text
   */
  private cleanDescription(description: string): string {
    // Remove extra whitespace and normalize
    return description.trim().replace(/\s+/g, ' ');
  }
}
