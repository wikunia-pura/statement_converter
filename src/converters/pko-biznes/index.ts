/**
 * PKO Biznes ELIXIR Converter
 * Extends BaseConverter with PKO Biznes ELIXIR-specific parsing and extraction.
 *
 * Format: CSV files in ZIP archive (one statement = multiple CSV files)
 * Encoding: Windows-1250 (Polish)
 *
 * Format-specific responsibilities:
 *   - Parse ZIP archive containing CSV files (via PKOBiznesParser)
 *   - Normalize PKOBiznesTransaction → NormalizedTransaction
 *   - Regex extraction via shared AddressMatcher
 */

import { PKOBiznesParser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { CsvExporter } from './csv-exporter';
import {
  PKOBiznesTransaction,
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

export class PKOBiznesConverter extends BaseConverter<PKOBiznesTransaction> {
  private parser: PKOBiznesParser;
  private regexExtractor: RegexExtractor;
  private localConfig: ConverterConfig;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    this.localConfig = {
      ...this.config,
      useAIForExpenses: config.useAIForExpenses ?? false,
    } as ConverterConfig;
    this.parser = new PKOBiznesParser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  // ── Override convert to accept Buffer ──────────────────────

  /**
   * Override convert() to accept Buffer (ZIP file) instead of string
   */
  async convert(content: string | Buffer): Promise<any> {
    // Convert string to Buffer if needed
    const buffer = typeof content === 'string' ? Buffer.from(content, 'binary') : content;
    
    // Call parent convert with Buffer (will be passed to doParse)
    return super.convert(buffer as any);
  }

  // ── Abstract method implementations ────────────────────────

  protected getConverterName(): string {
    return 'PKO Biznes ELIXIR';
  }

  protected async doParse(content: string | Buffer): Promise<ParseResult<PKOBiznesTransaction>> {
    // For PKO Biznes, content should be a Buffer (ZIP file)
    const buffer = typeof content === 'string' ? Buffer.from(content, 'binary') : content;
    
    const statement = this.parser.parse(buffer);
    
    return {
      transactions: statement.transactions,
      logExtra: `Files: ${statement.filesCount}, Accounts: ${statement.accountNumbers.join(', ')}, Date range: ${statement.startDate} - ${statement.endDate}`,
    };
  }

  protected doFilter(
    transactions: PKOBiznesTransaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): PKOBiznesTransaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: PKOBiznesTransaction): boolean {
    return transaction.operationType === '111';
  }

  protected normalize(transaction: PKOBiznesTransaction): NormalizedTransaction {
    // Counterparty info for descOpt: combine name + extra info
    const descOpt = [transaction.counterpartyName, transaction.counterpartyNameExtra]
      .filter(Boolean)
      .join(' ');

    // Convert amount: 111 (credit/income) = positive, 222 (debit/expense) = negative
    const value = transaction.operationType === '111' ? transaction.amount : -transaction.amount;

    // Format date from YYYYMMDD to YYYY-MM-DD for consistency
    const formattedDate = `${transaction.date.substring(0, 4)}-${transaction.date.substring(4, 6)}-${transaction.date.substring(6, 8)}`;

    return {
      descBase: transaction.description,
      descOpt,
      exeDate: formattedDate,
      creatDate: formattedDate, // PKO Biznes doesn't distinguish execution vs creation date
      value,
      accValue: 0, // not available in PKO Biznes ELIXIR
      realValue: transaction.amount,
      trnCode: transaction.operationType,
    };
  }

  protected extractWithRegex(transaction: PKOBiznesTransaction): BaseExtractedData | null {
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData | null;
  }

  protected buildRawData(transaction: PKOBiznesTransaction): Record<string, any> {
    return {
      description: transaction.description,
      counterpartyName: transaction.counterpartyName,
      counterpartyNameExtra: transaction.counterpartyNameExtra,
      counterpartyIBAN: transaction.counterpartyIBAN,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<PKOBiznesTransaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<PKOBiznesTransaction>;
  }

  // ── Hook overrides (PKO Biznes-specific behavior) ───────────────

  /** PKO Biznes checks cache before regex. */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  /** PKO Biznes caches successful regex results. */
  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  /** PKO Biznes uses 90% threshold for regex acceptance. */
  protected regexAcceptThreshold(): number {
    return 90;
  }

  /** PKO Biznes has explicit toggle for AI expenses. */
  protected shouldUseAIForExpenses(): boolean {
    return this.localConfig.useAIForExpenses ?? false;
  }
}

// Re-exports
export * from './types';
export { PKOBiznesParser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { CsvExporter } from './csv-exporter';
