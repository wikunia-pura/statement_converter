/**
 * BOŚ Bank XML Converter
 * Format: ISO 20022 camt.052.001.04 (Account Report)
 *
 * Reuses BNP Paribas' RegexExtractor and CsvExporter verbatim — the per-transaction
 * data shape is identical (BosTransaction === BnpTransaction). The only BOŚ-specific
 * piece is the XML envelope parser in ./parser.
 */

import { BosXmlParser } from './parser';
import { BosTransaction, ConverterConfig } from './types';
import { RegexExtractor } from '../bnp-xml/regex-extractor';
import { CsvExporter } from '../bnp-xml/csv-exporter';
import {
  BaseConverter,
  BaseExtractedData,
  NormalizedTransaction,
  ParseResult,
  ICsvExporter,
} from '../../shared/base-converter';

export class BosXmlConverter extends BaseConverter<BosTransaction> {
  private parser: BosXmlParser;
  private regexExtractor: RegexExtractor;
  private localConfig: ConverterConfig;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    this.localConfig = {
      ...this.config,
      useAIForExpenses: config.useAIForExpenses ?? false,
    } as ConverterConfig;
    this.parser = new BosXmlParser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  protected getConverterName(): string {
    return 'BOŚ Bank XML';
  }

  protected async doParse(content: string): Promise<ParseResult<BosTransaction>> {
    const statement = await this.parser.parse(content);
    return {
      transactions: statement.transactions,
      logExtra:
        `IBAN: ${statement.iban}, Period: ${statement.periodStart} – ${statement.periodEnd}, ` +
        `Currency: ${statement.currency}, Entries: ${statement.transactions.length}`,
    };
  }

  protected doFilter(
    transactions: BosTransaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): BosTransaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: BosTransaction): boolean {
    return transaction.creditDebitIndicator === 'CRDT';
  }

  protected normalize(transaction: BosTransaction): NormalizedTransaction {
    const descOpt = [transaction.counterpartyName, transaction.counterpartyAddress]
      .filter(Boolean)
      .join(' ');

    return {
      descBase: transaction.description,
      descOpt,
      exeDate: transaction.bookingDate,
      creatDate: transaction.valueDate,
      value: transaction.creditDebitIndicator === 'CRDT' ? transaction.amount : -transaction.amount,
      accValue: 0,
      realValue: transaction.amount,
      trnCode: transaction.txCode,
    };
  }

  protected extractWithRegex(transaction: BosTransaction): BaseExtractedData | null {
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData | null;
  }

  protected buildRawData(transaction: BosTransaction): Record<string, any> {
    return {
      description: transaction.description,
      counterpartyName: transaction.counterpartyName,
      counterpartyAddress: transaction.counterpartyAddress,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<BosTransaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<BosTransaction>;
  }

  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  protected regexAcceptThreshold(): number {
    return 90;
  }

  protected shouldUseAIForExpenses(): boolean {
    return this.localConfig.useAIForExpenses ?? false;
  }
}

export * from './types';
export { BosXmlParser } from './parser';
