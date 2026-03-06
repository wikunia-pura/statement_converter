/**
 * CSV/TXT Exporter for accounting system (PKO BP MT940)
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

    // Separate transactions into income (credit) and expenses (debit)
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
      const transactionIndex = incomeTransactions.indexOf(transaction) + 1;
      const date = this.formatDate(transaction.original.valueDate);
      const description = `NIEROZPOZNANE #${transactionIndex} ` + this.cleanDescription(transaction);
      const amount = this.formatAmount(transaction.original.amount);

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
      const date = this.formatDate(transaction.original.valueDate);
      const description = this.cleanDescription(transaction);
      const amount = this.formatAmount(transaction.original.amount);

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
    // Separate expenses into unrecognized and recognized
    const unrecognizedExpenses: ProcessedTransaction[] = [];
    const recognizedExpenses: ProcessedTransaction[] = [];

    for (const transaction of expenseTransactions) {
      const matchedContractor = transaction.matchedContractor;
      if (matchedContractor && matchedContractor.contractor) {
        recognizedExpenses.push(transaction);
      } else {
        unrecognizedExpenses.push(transaction);
      }
    }

    // Process unrecognized expenses first
    for (let i = 0; i < unrecognizedExpenses.length; i++) {
      const transaction = unrecognizedExpenses[i];
      const expenseIndex = expenseTransactions.indexOf(transaction) + 1;
      const date = this.formatDate(transaction.original.valueDate);
      const description = `NIEROZPOZNANY KONTRAHENT #${expenseIndex} ` + this.cleanDescription(transaction);
      const amount = this.formatAmount(Math.abs(transaction.original.amount));

      // Single line: k_wn = -, k_ma = 131-1
      lines.push(this.createLine({
        nr_dok: docNumber,
        nr_poz: position++,
        data_p: date,
        tresc: description,
        kwota: amount,
        k_wn: '   -',
        k_ma: '131-1',
      }));
    }

    // Process recognized expenses with matched contractors
    for (const transaction of recognizedExpenses) {
      const date = this.formatDate(transaction.original.valueDate);
      const matchedContractor = transaction.matchedContractor!;
      const description = this.cleanDescription(transaction);
      const amount = this.formatAmount(Math.abs(transaction.original.amount));
      const contractorAccount = matchedContractor.contractor!.kontoKontrahenta;

      // Single line: k_wn = contractor account, k_ma = 131-1
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
   * Export preview file with transaction details and matching information
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
        const date = this.formatDate(transaction.original.valueDate);
        const amount = this.formatAmount(transaction.original.amount);
        const apartmentNumber = this.extractApartmentNumber(transaction);

        lines.push(`Pozycja #${i + 1}`);
        lines.push(`Data: ${date}`);
        lines.push(`Kwota: ${amount}`);
        lines.push(`Opis: ${transaction.original.details.description.join('')}`);
        lines.push(`Kontrahent: ${transaction.original.details.counterpartyName}`);
        
        if (apartmentNumber) {
          lines.push(`Rozpoznane mieszkanie: ${apartmentNumber}`);
          lines.push(`Konto lokalu: ${this.formatAccountNumber(apartmentNumber)}`);
          lines.push(`Księgowanie:`);
          lines.push(`  Linia 1: k_wn = 131-1, k_ma = ---`);
          lines.push(`  Linia 2: k_wn = ---, k_ma = ${this.formatAccountNumber(apartmentNumber)}`);
        } else {
          lines.push(`Status: NIEROZPOZNANE`);
          lines.push(`Księgowanie: k_wn = 131-1, k_ma = ---`);
        }
        
        // Confidence and status in one readable line
        const conf = transaction.extracted.confidence;
        lines.push(`Pewność: Overall: ${conf.overall}% | Adres: ${conf.address}% | Mieszkanie: ${conf.apartment}% | Najemca: ${conf.tenantName}%`);
        lines.push(`Status: ${transaction.status} | Metoda ekstrakcji: ${transaction.extracted.extractionMethod}`);
        
        if (transaction.extracted.warnings.length > 0) {
          lines.push(`Ostrzeżenia: ${transaction.extracted.warnings.join(', ')}`);
        }
        lines.push('');
        lines.push('-'.repeat(80));
        lines.push('');
      }
    }

    // ========== EXPENSES SECTION ==========
    if (expenseTransactions.length > 0) {
      lines.push('');
      lines.push('='.repeat(80));
      lines.push('WYDATKI (EXPENSES)');
      lines.push('='.repeat(80));
      lines.push('');

      for (let i = 0; i < expenseTransactions.length; i++) {
        const transaction = expenseTransactions[i];
        const date = this.formatDate(transaction.original.valueDate);
        const amount = this.formatAmount(Math.abs(transaction.original.amount));
        const matchedContractor = transaction.matchedContractor;

        lines.push(`Pozycja #${i + 1}`);
        lines.push(`Data: ${date}`);
        lines.push(`Kwota: ${amount}`);
        lines.push(`Opis: ${transaction.original.details.description.join('')}`);
        lines.push(`Kontrahent (z wyciągu): ${transaction.original.details.counterpartyName}`);
        
        if (matchedContractor && matchedContractor.contractor) {
          const contractor = matchedContractor.contractor;
          lines.push(`Rozpoznany kontrahent: ${contractor.nazwa}`);
          lines.push(`Konto kontrahenta: ${contractor.kontoKontrahenta}`);
          lines.push(`Confidence: ${matchedContractor.confidence}%`);
          lines.push(`Dopasowane w: ${matchedContractor.matchedIn}`);
          lines.push(`Księgowanie: k_wn = ${contractor.kontoKontrahenta}, k_ma = 131-1`);
        } else {
          lines.push(`Status: NIEROZPOZNANY KONTRAHENT`);
          lines.push(`Księgowanie: k_wn = ---, k_ma = 131-1`);
        }
        
        lines.push(`Metoda ekstrakcji: ${transaction.extracted.extractionMethod}`);
        if (transaction.extracted.warnings.length > 0) {
          lines.push(`Ostrzeżenia: ${transaction.extracted.warnings.join(', ')}`);
        }
        lines.push('');
        lines.push('-'.repeat(80));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Create header line
   */
  private createHeader(): string {
    return ['nr_dok', 'nr_poz', 'data_p', 'tresc', 'kwota', 'k_wn', 'k_ma'].join(this.options.separator);
  }

  /**
   * Create data line
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
    // Pad account numbers to 7 characters
    const k_wn = data.k_wn === '   -' ? '   -' : data.k_wn.padEnd(7, ' ');
    const k_ma = data.k_ma === '   -' ? '   -' : data.k_ma.padEnd(7, ' ');

    return [
      data.nr_dok,
      data.nr_poz.toString(),
      data.data_p,
      data.tresc,
      data.kwota,
      k_wn,
      k_ma,
    ].join(this.options.separator);
  }

  /**
   * Format date according to options
   */
  private formatDate(dateStr: string): string {
    // Input format: YYMMDD (e.g., "260101")
    const year = '20' + dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const day = dateStr.substring(4, 6);
    
    switch (this.options.dateFormat) {
      case 'D.MM.YYYY':
        return `${parseInt(day, 10)}.${month}.${year}`;
      case 'DD/MM/YYYY':
        return `${day}/${month}/${year}`;
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`;
      default:
        return `${parseInt(day, 10)}.${month}.${year}`;
    }
  }

  /**
   * Format amount according to options
   */
  private formatAmount(amount: number): string {
    const formatted = amount.toFixed(2);
    return this.options.decimalSeparator === ','
      ? formatted.replace('.', ',')
      : formatted;
  }

  /**
   * Extract apartment number from processed transaction
   */
  private extractApartmentNumber(transaction: ProcessedTransaction): string | null {
    return transaction.extracted.apartmentNumber;
  }

  /**
   * Format account number for output (204-XXXXXX)
   */
  private formatAccountNumber(apartmentNumber: string): string {
    // Handle ZGN special case - all zeros (same as santander-xml)
    if (apartmentNumber.toUpperCase() === 'ZGN') {
      return '204-000000';
    }
    // If contains a dash, it's already a full account number (e.g. 760-00001 or HWDP)
    if (apartmentNumber.includes('-')) return apartmentNumber;
    
    return `204-${apartmentNumber.padStart(6, '0')}`;
  }

  /**
   * Clean and truncate description for output
   */
  private cleanDescription(transaction: ProcessedTransaction): string {
    // Use the description from transaction details
    const description = transaction.original.details.description.join('');
    
    // Remove special characters and extra whitespace
    let cleaned = description
      .replace(/[^\w\sąćęłńóśźżĄĆĘŁŃÓŚŹŻ.,\-/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Truncate to 50 characters
    if (cleaned.length > 50) {
      cleaned = cleaned.substring(0, 47) + '...';
    }
    
    return cleaned;
  }
}
