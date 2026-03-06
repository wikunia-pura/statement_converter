/**
 * CSV/TXT Exporter for PKO Biznes ELIXIR converter
 * Exports transactions to tab-separated TXT format compatible with accounting software.
 *
 * Same accounting format as PKO MT940/Alior/BNP exporters (shared output schema).
 * Date handling: PKO Biznes stores dates as YYYYMMDD.
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
      separator: options.separator || '\t',
      dateFormat: options.dateFormat || 'D.MM.YYYY',
      decimalSeparator: options.decimalSeparator || ',',
    };
  }

  // ── Main export ──────────────────────────────────────────

  export(transactions: ProcessedTransaction[]): string {
    const lines: string[] = [];
    lines.push(this.createHeader());

    const currentMonth = new Date().getMonth() + 1;
    const docNumber = `BNK/${String(currentMonth).padStart(4, '0')}`;

    let position = 1;

    const incomeTransactions = transactions.filter(t => t.transactionType === 'income');
    const expenseTransactions = transactions.filter(t => t.transactionType === 'expense');

    // ── INCOME ──────────────────────────────────────────────

    const unrecognizedIncome: ProcessedTransaction[] = [];
    const recognizedIncome: ProcessedTransaction[] = [];

    for (const transaction of incomeTransactions) {
      const aptNum = this.extractApartmentNumber(transaction);
      if (aptNum === null) {
        unrecognizedIncome.push(transaction);
      } else {
        recognizedIncome.push(transaction);
      }
    }

    // Unrecognized income — single line, k_ma = -
    for (let i = 0; i < unrecognizedIncome.length; i++) {
      const transaction = unrecognizedIncome[i];
      const transactionIndex = incomeTransactions.indexOf(transaction) + 1;
      const date = this.formatDate(transaction.original.date);
      const description = `NIEROZPOZNANE #${transactionIndex} ` + this.cleanDescription(transaction);
      const amount = this.formatAmount(transaction.original.amount);

      lines.push(this.createLine({
        nr_dok: docNumber, nr_poz: position++, data_p: date,
        tresc: description, kwota: amount, k_wn: '131-1', k_ma: '   -',
      }));
    }

    // Recognized income — 2 lines each
    for (const transaction of recognizedIncome) {
      const aptNum = this.extractApartmentNumber(transaction)!;
      const date = this.formatDate(transaction.original.date);
      const description = this.cleanDescription(transaction);
      const amount = this.formatAmount(transaction.original.amount);

      lines.push(this.createLine({
        nr_dok: docNumber, nr_poz: position++, data_p: date,
        tresc: description, kwota: amount, k_wn: '131-1', k_ma: '   -',
      }));

      lines.push(this.createLine({
        nr_dok: docNumber, nr_poz: position++, data_p: date,
        tresc: description, kwota: amount, k_wn: '   -', k_ma: this.formatAccountNumber(aptNum),
      }));
    }

    // ── EXPENSES ────────────────────────────────────────────

    const unrecognizedExpenses: ProcessedTransaction[] = [];
    const recognizedExpenses: ProcessedTransaction[] = [];

    for (const transaction of expenseTransactions) {
      if (transaction.matchedContractor?.contractor) {
        recognizedExpenses.push(transaction);
      } else {
        unrecognizedExpenses.push(transaction);
      }
    }

    for (let i = 0; i < unrecognizedExpenses.length; i++) {
      const transaction = unrecognizedExpenses[i];
      const expenseIndex = expenseTransactions.indexOf(transaction) + 1;
      const date = this.formatDate(transaction.original.date);
      const description = `NIEROZPOZNANY KONTRAHENT #${expenseIndex} ` + this.cleanDescription(transaction);
      const amount = this.formatAmount(Math.abs(transaction.original.amount));

      lines.push(this.createLine({
        nr_dok: docNumber, nr_poz: position++, data_p: date,
        tresc: description, kwota: amount, k_wn: '   -', k_ma: '131-1',
      }));
    }

    for (const transaction of recognizedExpenses) {
      const date = this.formatDate(transaction.original.date);
      const description = this.cleanDescription(transaction);
      const amount = this.formatAmount(Math.abs(transaction.original.amount));
      const contractorAccount = transaction.matchedContractor!.contractor!.kontoKontrahenta;

      lines.push(this.createLine({
        nr_dok: docNumber, nr_poz: position++, data_p: date,
        tresc: description, kwota: amount, k_wn: contractorAccount, k_ma: '131-1',
      }));
    }

    return lines.join('\n');
  }

  // ── Auxiliary preview ────────────────────────────────────

  exportAuxiliary(transactions: ProcessedTransaction[]): string {
    const lines: string[] = [];

    const incomeTransactions = transactions.filter(t => t.transactionType === 'income');
    const expenseTransactions = transactions.filter(t => t.transactionType === 'expense');

    // ── INCOME SECTION ─────────────────────────────────────
    if (incomeTransactions.length > 0) {
      lines.push('='.repeat(80));
      lines.push('WPŁATY (INCOME)');
      lines.push('='.repeat(80));
      lines.push('');

      for (let i = 0; i < incomeTransactions.length; i++) {
        const transaction = incomeTransactions[i];
        const date = this.formatDate(transaction.original.date);
        const amount = this.formatAmount(transaction.original.amount);
        const aptNum = this.extractApartmentNumber(transaction);

        lines.push(`Pozycja #${i + 1}`);
        lines.push(`Data: ${date}`);
        lines.push(`Kwota: ${amount}`);
        lines.push(`Opis: ${transaction.original.description}`);
        lines.push(`Kontrahent: ${transaction.original.counterpartyName}`);
        if (transaction.original.counterpartyNameExtra) {
          lines.push(`Dodatkowe info: ${transaction.original.counterpartyNameExtra}`);
        }

        if (aptNum) {
          lines.push(`Rozpoznane mieszkanie: ${aptNum}`);
          lines.push(`Konto lokalu: ${this.formatAccountNumber(aptNum)}`);
          lines.push(`Księgowanie:`);
          lines.push(`  Linia 1: k_wn = 131-1, k_ma = ---`);
          lines.push(`  Linia 2: k_wn = ---, k_ma = ${this.formatAccountNumber(aptNum)}`);
          if (transaction.extracted?.tenantName) {
            lines.push(`Nazwa najemcy: ${transaction.extracted.tenantName}`);
          }
        } else {
          lines.push(`Status: NIEROZPOZNANE #${i + 1}`);
          lines.push(`Księgowanie: k_wn = 131-1, k_ma = ---`);
        }

        if (transaction.extracted?.confidence) {
          const conf = transaction.extracted.confidence;
          lines.push(`Pewność: Overall: ${conf.overall}% | Adres: ${conf.address}% | Mieszkanie: ${conf.apartment}% | Najemca: ${conf.tenantName}%`);
        }
        if (transaction.extracted?.extractionMethod) {
          lines.push(`Status: ${transaction.status} | Metoda ekstrakcji: ${transaction.extracted.extractionMethod}`);
        }

        if (transaction.extracted?.warnings?.length) {
          lines.push(`Ostrzeżenia: ${transaction.extracted.warnings.join(', ')}`);
        }

        lines.push('-'.repeat(80));
        lines.push('');
      }
    }

    // ── EXPENSES SECTION ───────────────────────────────────
    if (expenseTransactions.length > 0) {
      lines.push('='.repeat(80));
      lines.push('WYDATKI (EXPENSES) - DOPASOWANIE KONTRAHENTÓW');
      lines.push('='.repeat(80));
      lines.push('');

      const unrecognizedExpenses: ProcessedTransaction[] = [];
      const recognizedExpenses: ProcessedTransaction[] = [];

      for (const transaction of expenseTransactions) {
        if (transaction.matchedContractor?.contractor) {
          recognizedExpenses.push(transaction);
        } else {
          unrecognizedExpenses.push(transaction);
        }
      }

      for (const transaction of unrecognizedExpenses) {
        const i = expenseTransactions.indexOf(transaction);
        const date = this.formatDate(transaction.original.date);
        const amount = this.formatAmount(transaction.original.amount);

        lines.push(`Pozycja #${i + 1}`);
        lines.push(`Data: ${date}`);
        lines.push(`Kwota: ${amount}`);
        lines.push(`Opis: ${transaction.original.description}`);
        if (transaction.original.counterpartyName) {
          lines.push(`Kontrahent: ${transaction.original.counterpartyName}`);
        }
        if (transaction.original.counterpartyNameExtra) {
          lines.push(`Dodatkowe info: ${transaction.original.counterpartyNameExtra}`);
        }
        lines.push(`Status: NIEROZPOZNANY KONTRAHENT #${i + 1}`);
        lines.push(`Konto kontrahenta (k_wn): ---`);
        lines.push(`Konto Ma (k_ma): 131-1`);
        lines.push(`Wymaga ręcznego przypisania kontrahenta`);
        lines.push('-'.repeat(80));
        lines.push('');
      }

      for (const transaction of recognizedExpenses) {
        const i = expenseTransactions.indexOf(transaction);
        const date = this.formatDate(transaction.original.date);
        const amount = this.formatAmount(transaction.original.amount);
        const mc = transaction.matchedContractor!;

        lines.push(`Pozycja #${i + 1}`);
        lines.push(`Data: ${date}`);
        lines.push(`Kwota: ${amount}`);
        lines.push(`Opis: ${transaction.original.description}`);
        if (transaction.original.counterpartyName) {
          lines.push(`Kontrahent: ${transaction.original.counterpartyName}`);
        }
        lines.push(`Dopasowany kontrahent: ${mc.contractor!.nazwa}`);
        lines.push(`Konto kontrahenta (k_wn): ${mc.contractor!.kontoKontrahenta}`);
        lines.push(`Konto Ma (k_ma): 131-1`);
        lines.push(`Pewność dopasowania: ${mc.confidence}%`);
        lines.push(`Metoda: wynik automatycznego dopasowania`);
        if (mc.matchedIn) {
          lines.push(`Dopasowano w: ${mc.matchedIn === 'desc-opt' ? 'nazwa kontrahenta' : 'opis'}`);
        }
        lines.push('-'.repeat(80));
        lines.push('');
      }
    }

    // ── SUMMARY ────────────────────────────────────────────
    lines.push('='.repeat(80));
    lines.push('PODSUMOWANIE');
    lines.push('='.repeat(80));
    lines.push(`Łączna liczba transakcji: ${transactions.length}`);
    lines.push(`  - Wpłaty: ${incomeTransactions.length}`);
    lines.push(`  - Wydatki: ${expenseTransactions.length}`);

    const matchedExpenses = expenseTransactions.filter(t => t.matchedContractor?.contractor).length;
    const unmatchedExpenses = expenseTransactions.length - matchedExpenses;

    if (expenseTransactions.length > 0) {
      lines.push(`  - Wydatki rozpoznane: ${matchedExpenses}`);
      lines.push(`  - Wydatki nierozpoznane: ${unmatchedExpenses}`);
      const matchRate = ((matchedExpenses / expenseTransactions.length) * 100).toFixed(1);
      lines.push(`  - Wskaźnik dopasowania: ${matchRate}%`);
    }

    return lines.join('\n');
  }

  // ── Private helpers ──────────────────────────────────────

  private createHeader(): string {
    return ['nr_dok', 'nr_poz', 'data_p', 'tresc', 'kwota', 'k_wn', 'k_ma']
      .join(this.options.separator);
  }

  private createLine(data: {
    nr_dok: string; nr_poz: number; data_p: string;
    tresc: string; kwota: string; k_wn: string; k_ma: string;
  }): string {
    const k_wn = data.k_wn === '   -' ? '   -' : data.k_wn.padEnd(7, ' ');
    const k_ma = data.k_ma === '   -' ? '   -' : data.k_ma.padEnd(7, ' ');

    return [
      data.nr_dok, data.nr_poz, data.data_p,
      data.tresc, data.kwota, k_wn, k_ma,
    ].join(this.options.separator);
  }

  private extractApartmentNumber(transaction: ProcessedTransaction): string | null {
    const aptNum = transaction.extracted?.apartmentNumber;
    if (aptNum && aptNum.trim() !== '') return aptNum;
    return null;
  }

  private formatAccountNumber(apartmentNumber: string): string {
    if (apartmentNumber.toUpperCase() === 'ZGN') return '204-000000';
    // If contains a dash, it's already a full account number (e.g. 760-00001 or HWDP)
    if (apartmentNumber.includes('-')) return apartmentNumber;
    const numericPart = apartmentNumber.replace(/\D/g, '');
    return `204-${numericPart.padStart(6, '0')}`;
  }

  /**
   * Format date from YYYYMMDD to accounting format.
   */
  private formatDate(dateStr: string): string {
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);

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

  private formatAmount(amount: number): string {
    const formatted = amount.toFixed(2);
    if (this.options.decimalSeparator === ',') {
      return formatted.replace('.', ',');
    }
    return formatted;
  }

  private cleanDescription(transaction: ProcessedTransaction): string {
    const description = transaction.original.description;
    let cleaned = description
      .replace(/[^\w\sąćęłńóśźżĄĆĘŁŃÓŚŹŻ.,\-/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length > 50) {
      cleaned = cleaned.substring(0, 47) + '...';
    }

    return cleaned;
  }
}
