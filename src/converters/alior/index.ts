/**
 * Alior Bank MT940 Converter
 * Extends BaseConverter with Alior MT940-specific parsing and extraction.
 *
 * Format: MT940 (SWIFT) with `<XX` subfield delimiters in :86:
 * Encoding: ASCII (no Polish diacritics)
 *
 * Format-specific responsibilities:
 *   - Parse Alior MT940 file (via AliorMT940Parser)
 *   - Normalize AliorTransaction → NormalizedTransaction
 *   - Regex extraction via shared AddressMatcher
 */

import { AliorMT940Parser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { CsvExporter } from './csv-exporter';
import {
  AliorTransaction,
  ConverterConfig,
} from './types';
import {
  BaseConverter,
  BaseConverterConfig,
  BaseExtractedData,
  NormalizedTransaction,
  ParseResult,
  ICsvExporter,
} from '../../shared/base-converter';

export class AliorConverter extends BaseConverter<AliorTransaction> {
  private parser: AliorMT940Parser;
  private regexExtractor: RegexExtractor;
  private localConfig: ConverterConfig;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    this.localConfig = {
      ...this.config,
      useAIForExpenses: config.useAIForExpenses ?? false,
    } as ConverterConfig;
    this.parser = new AliorMT940Parser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  // ── Abstract method implementations ────────────────────────

  protected getConverterName(): string {
    return 'Alior Bank MT940';
  }

  protected async doParse(content: string): Promise<ParseResult<AliorTransaction>> {
    const statement = this.parser.parse(content);
    return {
      transactions: statement.transactions,
      logExtra: `IBAN: ${statement.accountIBAN}, Opening: ${statement.openingBalance.amount} ${statement.openingBalance.debitCredit}, Closing: ${statement.closingBalance.amount} ${statement.closingBalance.debitCredit}`,
    };
  }

  protected doFilter(
    transactions: AliorTransaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): AliorTransaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: AliorTransaction): boolean {
    return transaction.debitCredit === 'C';
  }

  protected normalize(transaction: AliorTransaction): NormalizedTransaction {
    // Counterparty info for descOpt: combine name + address (like BNP pattern)
    const descOpt = [transaction.details.counterpartyName, transaction.details.counterpartyAddress]
      .filter(Boolean)
      .join(' ');

    return {
      descBase: transaction.details.description.join(' '),
      descOpt,
      exeDate: transaction.valueDate,
      creatDate: transaction.entryDate,
      value: transaction.debitCredit === 'C' ? transaction.amount : -transaction.amount,
      accValue: 0, // not available in Alior MT940
      realValue: transaction.amount,
      trnCode: transaction.transactionType,
    };
  }

  protected extractWithRegex(transaction: AliorTransaction): BaseExtractedData | null {
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData | null;
  }

  protected buildRawData(transaction: AliorTransaction): Record<string, any> {
    return {
      description: transaction.details.description.join(' '),
      counterpartyName: transaction.details.counterpartyName,
      counterpartyAddress: transaction.details.counterpartyAddress,
      counterpartyIBAN: transaction.details.counterpartyIBAN,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<AliorTransaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<AliorTransaction>;
  }

  // ── Hook overrides (Alior-specific behavior) ───────────────

  /** Alior checks cache before regex (like BNP). */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  /** Alior caches successful regex results. */
  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  /** Alior uses 90% threshold for regex acceptance (like BNP). */
  protected regexAcceptThreshold(): number {
    return 90;
  }

  /** Alior has explicit toggle for AI expenses (like BNP). */
  protected shouldUseAIForExpenses(): boolean {
    return this.localConfig.useAIForExpenses ?? false;
  }
}

// Re-exports
export * from './types';
export { AliorMT940Parser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { CsvExporter } from './csv-exporter';
