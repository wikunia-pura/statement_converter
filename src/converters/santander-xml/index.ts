/**
 * Santander XML Converter
 * Extends BaseConverter with XML-specific parsing and extraction.
 *
 * Format-specific responsibilities:
 *   - Parse Santander XML file (via SantanderXmlParser)
 *   - Normalize XmlTransaction → NormalizedTransaction (trivial — same shape)
 *   - Regex extraction (returns null when confidence < 70%)
 */

import { SantanderXmlParser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { CsvExporter } from './csv-exporter';
import {
  XmlTransaction,
  ProcessedTransaction,
  ImportResult,
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

export class SantanderXmlConverter extends BaseConverter<XmlTransaction> {
  private parser: SantanderXmlParser;
  private regexExtractor: RegexExtractor;
  private localConfig: ConverterConfig;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    // Keep Santander-specific config field
    this.localConfig = {
      ...this.config,
      useAIForExpenses: config.useAIForExpenses ?? false,
    } as ConverterConfig;
    this.parser = new SantanderXmlParser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  // ── Abstract method implementations ────────────────────────

  protected getConverterName(): string {
    return 'Santander XML';
  }

  protected async doParse(content: string): Promise<ParseResult<XmlTransaction>> {
    const statement = await this.parser.parse(content);
    return {
      transactions: statement.transactions,
    };
  }

  protected doFilter(
    transactions: XmlTransaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): XmlTransaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: XmlTransaction): boolean {
    return transaction.value >= 0;
  }

  protected normalize(transaction: XmlTransaction): NormalizedTransaction {
    // XmlTransaction already has the normalized shape
    return {
      descBase: transaction.descBase,
      descOpt: transaction.descOpt,
      exeDate: transaction.exeDate,
      creatDate: transaction.creatDate,
      value: transaction.value,
      accValue: transaction.accValue,
      realValue: transaction.realValue,
      trnCode: transaction.trnCode,
    };
  }

  protected extractWithRegex(transaction: XmlTransaction): BaseExtractedData | null {
    // Santander regex returns null when confidence < 70%
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData | null;
  }

  protected buildRawData(transaction: XmlTransaction): Record<string, any> {
    return {
      descBase: transaction.descBase,
      descOpt: transaction.descOpt,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<XmlTransaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<XmlTransaction>;
  }

  // ── Hook overrides (Santander-specific behavior) ───────────

  /** Santander checks cache before regex. */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  /** Santander caches successful regex results. */
  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  /** Santander uses 90% threshold for regex acceptance. */
  protected regexAcceptThreshold(): number {
    return 90;
  }

  /** Santander has explicit toggle for AI expenses. */
  protected shouldUseAIForExpenses(): boolean {
    return this.localConfig.useAIForExpenses ?? false;
  }
}

// Export everything
export * from './types';
export { SantanderXmlParser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { CsvExporter } from './csv-exporter';
