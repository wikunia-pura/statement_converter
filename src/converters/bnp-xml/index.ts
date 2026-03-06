/**
 * BNP Paribas XML Converter
 * Extends BaseConverter with CAMT.053-specific parsing and extraction.
 *
 * Format: ISO 20022 camt.053.001.02
 * Encoding: windows-1250
 *
 * Format-specific responsibilities:
 *   - Parse BNP CAMT.053 XML (via BnpXmlParser)
 *   - Normalize BnpTransaction → NormalizedTransaction
 *   - Regex extraction via shared AddressMatcher
 */

import { BnpXmlParser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { CsvExporter } from './csv-exporter';
import {
  BnpTransaction,
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

export class BnpXmlConverter extends BaseConverter<BnpTransaction> {
  private parser: BnpXmlParser;
  private regexExtractor: RegexExtractor;
  private localConfig: ConverterConfig;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    this.localConfig = {
      ...this.config,
      useAIForExpenses: config.useAIForExpenses ?? false,
    } as ConverterConfig;
    this.parser = new BnpXmlParser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  // ── Abstract method implementations ────────────────────────

  protected getConverterName(): string {
    return 'BNP Paribas XML';
  }

  protected async doParse(content: string): Promise<ParseResult<BnpTransaction>> {
    const statement = await this.parser.parse(content);
    return {
      transactions: statement.transactions,
      logExtra: `IBAN: ${statement.iban}, Period: ${statement.periodStart} – ${statement.periodEnd}, ` +
        `Opening: ${statement.openingBalance} ${statement.currency}, Closing: ${statement.closingBalance} ${statement.currency}`,
    };
  }

  protected doFilter(
    transactions: BnpTransaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): BnpTransaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: BnpTransaction): boolean {
    return transaction.creditDebitIndicator === 'CRDT';
  }

  protected normalize(transaction: BnpTransaction): NormalizedTransaction {
    // Map BNP fields → NormalizedTransaction
    // descBase ← description (RmtInf/Ustrd)
    // descOpt  ← counterpartyName + counterpartyAddress (for matching)
    const descOpt = [transaction.counterpartyName, transaction.counterpartyAddress]
      .filter(Boolean)
      .join(' ');

    return {
      descBase: transaction.description,
      descOpt,
      exeDate: transaction.bookingDate,
      creatDate: transaction.valueDate,
      value: transaction.creditDebitIndicator === 'CRDT' ? transaction.amount : -transaction.amount,
      accValue: 0, // not available in CAMT.053
      realValue: transaction.amount,
      trnCode: transaction.txCode,
    };
  }

  protected extractWithRegex(transaction: BnpTransaction): BaseExtractedData | null {
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData | null;
  }

  protected buildRawData(transaction: BnpTransaction): Record<string, any> {
    return {
      description: transaction.description,
      counterpartyName: transaction.counterpartyName,
      counterpartyAddress: transaction.counterpartyAddress,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<BnpTransaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<BnpTransaction>;
  }

  // ── Hook overrides (BNP-specific behavior) ─────────────────

  /** BNP checks cache before regex (like Santander). */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  /** BNP caches successful regex results. */
  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  /** BNP uses 90% threshold for regex acceptance. */
  protected regexAcceptThreshold(): number {
    return 90;
  }

  /** BNP has explicit toggle for AI expenses (like Santander). */
  protected shouldUseAIForExpenses(): boolean {
    return this.localConfig.useAIForExpenses ?? false;
  }
}

// Re-exports
export * from './types';
export { BnpXmlParser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { CsvExporter } from './csv-exporter';
