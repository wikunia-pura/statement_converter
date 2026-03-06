/**
 * PKO SA EXP Converter
 * Extends BaseConverter with PKO SA EXP-specific parsing and extraction.
 *
 * Format: Text file with #DATA#, #SALDO#, and #OPERACJA# tags
 * Encoding: Windows-1250 (Polish)
 *
 * Format-specific responsibilities:
 *   - Parse EXP file with tagged lines (via PKOSAParser)
 *   - Normalize PKOSATransaction → NormalizedTransaction
 *   - Regex extraction via shared AddressMatcher
 */

import { PKOSAParser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { CsvExporter } from './csv-exporter';
import {
  PKOSATransaction,
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

export class PKOSAConverter extends BaseConverter<PKOSATransaction> {
  private parser: PKOSAParser;
  private regexExtractor: RegexExtractor;
  private localConfig: ConverterConfig;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    this.localConfig = {
      ...this.config,
      useAIForExpenses: config.useAIForExpenses ?? false,
    } as ConverterConfig;
    this.parser = new PKOSAParser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  // ── Abstract method implementations ────────────────────────

  protected getConverterName(): string {
    return 'PKO SA EXP';
  }

  protected async doParse(content: string): Promise<ParseResult<PKOSATransaction>> {
    const statement = this.parser.parse(content);
    
    return {
      transactions: statement.transactions,
      logExtra: `Date range: ${statement.startDate} - ${statement.endDate}, Balance: ${statement.openingBalance} → ${statement.closingBalance} ${statement.currency || ''}`,
    };
  }

  protected doFilter(
    transactions: PKOSATransaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): PKOSATransaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: PKOSATransaction): boolean {
    return transaction.isIncome;
  }

  protected normalize(transaction: PKOSATransaction): NormalizedTransaction {
    // Counterparty info for descOpt
    const descOpt = transaction.counterparty;

    // Value: positive for income, negative for expense
    const value = transaction.amount;

    return {
      descBase: transaction.description,
      descOpt,
      exeDate: transaction.dateFormatted,
      creatDate: transaction.dateFormatted, // PKO SA doesn't distinguish execution vs creation date
      value,
      accValue: 0, // not available in PKO SA EXP
      realValue: transaction.amountAbsolute,
      trnCode: transaction.code,
    };
  }

  protected extractWithRegex(transaction: PKOSATransaction): BaseExtractedData | null {
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData | null;
  }

  protected buildRawData(transaction: PKOSATransaction): Record<string, any> {
    return {
      description: transaction.description,
      counterparty: transaction.counterparty,
      accountNumber: transaction.accountNumber,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<PKOSATransaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<PKOSATransaction>;
  }

  // ── Hook overrides (PKO SA-specific behavior) ───────────────

  /** PKO SA checks cache before regex. */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  /** PKO SA caches successful regex results. */
  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  /** PKO SA uses 90% threshold for regex acceptance. */
  protected regexAcceptThreshold(): number {
    return 90;
  }

  /** PKO SA has explicit toggle for AI expenses. */
  protected shouldUseAIForExpenses(): boolean {
    return this.localConfig.useAIForExpenses ?? false;
  }
}

// Re-exports
export * from './types';
export { PKOSAParser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { CsvExporter } from './csv-exporter';
