/**
 * The accounting file a converted statement becomes — one layout for every
 * bank: `nr_dok nr_poz data_p tresc kwota k_wn k_ma`, tab-separated.
 *
 * Income first, then expenses; within each, what could not be booked comes
 * first as a single line against the bank account (k_ma or k_wn "-"), titled
 * "NIEROZPOZNANE #n" / "NIEROZPOZNANY KONTRAHENT #n" for the accountant to
 * finish by hand. A booked income takes two lines (the bank account, then the
 * apartment's account), a booked expense one (the contractor's account against
 * the bank account). The document number is the statement's month (see
 * `bankDocNumber`).
 *
 * A bank's exporter only says where its parser keeps what the file needs: the
 * date and its layout, the amount, the title — and how its file has always
 * written the title and the accounts (see `title` and `padAccounts`), which
 * stay as they were so no bank's file changes under this class.
 */

import { resolveApartmentAccount } from '../../shared/apartment-account';
import type { MatchedContractor } from '../../shared/contractor-matcher';
import { ExportDateLayout, bankDocNumber, yearMonthOf } from './export-text';

export interface CsvExportOptions {
  separator?: string;
  dateFormat?: 'D.MM.YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  decimalSeparator?: ',' | '.';
  /** Community bank-account symbol (e.g. '131-1', '142-2'). Selected via the account type. */
  bankAccountSymbol?: string;
  /** Apartment-account prefix (e.g. '204', '205'). Selected via the account type. */
  apartmentPrefix?: string;
}

/** What the file reads of a converted transaction. */
export interface ExportRow<TRaw> {
  original: TRaw;
  transactionType: 'income' | 'expense';
  extracted: {
    apartmentNumber: string | null;
    accountOverride?: string | null;
    needsAccount?: boolean;
  };
  matchedContractor?: MatchedContractor;
}

/** The empty side of a one-sided line. */
const NO_ACCOUNT = '   -';

export abstract class BaseCsvExporter<TRaw> {
  protected readonly options: Required<CsvExportOptions>;

  /** The layout the bank's dates come in. */
  protected abstract readonly dateLayout: ExportDateLayout;

  /**
   * Account symbols padded to 7 characters. Every bank's file has always had
   * them so, except the camt ones (BNP Paribas / BOŚ, Santander).
   */
  protected readonly padAccounts: boolean = true;

  constructor(options: CsvExportOptions = {}) {
    this.options = {
      separator: options.separator || '\t',
      dateFormat: options.dateFormat || 'D.MM.YYYY',
      decimalSeparator: options.decimalSeparator || ',',
      bankAccountSymbol: options.bankAccountSymbol || '131-1',
      apartmentPrefix: options.apartmentPrefix || '204',
    };
  }

  /** The row's date as the parser keeps it, in `dateLayout`. */
  protected abstract dateOf(raw: TRaw): string;

  /** The amount of an income as the file prints it. */
  protected abstract incomeAmount(raw: TRaw): number;

  /** The amount of an expense as the file prints it — without its sign. */
  protected abstract expenseAmount(raw: TRaw): number;

  /** The `tresc` column: the row's title, cleaned for the file (`shortTitle` or `fullTitle`). */
  protected abstract title(raw: TRaw): string;

  export(transactions: ExportRow<TRaw>[]): string {
    const lines: string[] = [this.createHeader()];

    // Document number (BNK/00MM): the month of the statement itself, not the
    // month the file happens to be converted in — see bankDocNumber.
    const docNumber = bankDocNumber(transactions.map((t) => yearMonthOf(this.dateOf(t.original), this.dateLayout)));

    let position = 1;
    const line = (raw: TRaw, tresc: string, kwota: number, k_wn: string, k_ma: string) =>
      lines.push(
        [
          docNumber,
          position++,
          this.formatDate(this.dateOf(raw)),
          tresc,
          this.formatAmount(kwota),
          this.account(k_wn),
          this.account(k_ma),
        ].join(this.options.separator),
      );

    const incomes = transactions.filter((t) => t.transactionType === 'income');
    const expenses = transactions.filter((t) => t.transactionType === 'expense');
    // "#n" counts within incomes or within expenses, in statement order.
    const incomeNo = new Map(incomes.map((t, i) => [t, i + 1]));
    const expenseNo = new Map(expenses.map((t, i) => [t, i + 1]));
    const bank = this.options.bankAccountSymbol;

    // ========== INCOME ==========
    // Unrecognized when there is no apartment *or* when no account symbol may be
    // derived for it (a lettered apartment without an explicit account).
    const accounts = new Map(incomes.map((t) => [t, this.resolveAccount(t)] as const));
    for (const t of incomes) {
      if (accounts.get(t) !== null) continue;
      line(t.original, `NIEROZPOZNANE #${incomeNo.get(t)} ` + this.title(t.original), this.incomeAmount(t.original), bank, NO_ACCOUNT);
    }
    for (const t of incomes) {
      const account = accounts.get(t);
      if (account == null) continue;
      const tresc = this.title(t.original);
      const kwota = this.incomeAmount(t.original);
      line(t.original, tresc, kwota, bank, NO_ACCOUNT);
      line(t.original, tresc, kwota, NO_ACCOUNT, account);
    }

    // ========== EXPENSES ==========
    for (const t of expenses) {
      if (t.matchedContractor?.contractor) continue;
      line(
        t.original,
        `NIEROZPOZNANY KONTRAHENT #${expenseNo.get(t)} ` + this.title(t.original),
        this.expenseAmount(t.original),
        NO_ACCOUNT,
        bank,
      );
    }
    for (const t of expenses) {
      const contractor = t.matchedContractor?.contractor;
      if (!contractor) continue;
      line(t.original, this.title(t.original), this.expenseAmount(t.original), contractor.kontoKontrahenta, bank);
    }

    return lines.join('\n');
  }

  private createHeader(): string {
    return ['nr_dok', 'nr_poz', 'data_p', 'tresc', 'kwota', 'k_wn', 'k_ma'].join(this.options.separator);
  }

  private account(symbol: string): string {
    return symbol === NO_ACCOUNT || !this.padAccounts ? symbol : symbol.padEnd(7, ' ');
  }

  /**
   * The account this income must be booked to, or null when it cannot be booked.
   *
   * Delegates to the shared resolver so every converter agrees; in particular a
   * lettered apartment ("17A") resolves to null unless an account symbol was
   * supplied, because deriving one from the digits alone would book the money
   * onto a different apartment.
   */
  private resolveAccount(transaction: ExportRow<TRaw>): string | null {
    // needsAccount means the letter evidence and the recognized number disagree, or
    // the number carries a letter of its own. Either way an account was never
    // established, so the row stays unrecognized until the user names one.
    if (transaction.extracted?.needsAccount && !transaction.extracted?.accountOverride) {
      return null;
    }
    return resolveApartmentAccount(
      transaction.extracted?.apartmentNumber ?? null,
      transaction.extracted?.accountOverride ?? null,
      this.options.apartmentPrefix,
    );
  }

  private formatDate(raw: string): string {
    let year: string;
    let month: string;
    let day: string;
    switch (this.dateLayout) {
      case 'YYMMDD':
        [year, month, day] = ['20' + raw.substring(0, 2), raw.substring(2, 4), raw.substring(4, 6)];
        break;
      case 'YYYYMMDD':
        [year, month, day] = [raw.substring(0, 4), raw.substring(4, 6), raw.substring(6, 8)];
        break;
      case 'YYYY-MM-DD': {
        const parts = raw.split('-');
        if (parts.length !== 3) return raw;
        [year, month, day] = parts;
        // Already in this layout: written as the statement has it.
        if (this.options.dateFormat === 'YYYY-MM-DD') return raw;
        break;
      }
      case 'DD/MM/YYYY': {
        const parts = raw.split('/');
        if (parts.length !== 3) return raw;
        [day, month, year] = parts;
        break;
      }
    }
    switch (this.options.dateFormat) {
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
    return this.options.decimalSeparator === ',' ? formatted.replace('.', ',') : formatted;
  }
}
