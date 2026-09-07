/**
 * Bank Pocztowy MT940 Converter
 * Extends BaseConverter with the Pocztowy-specific parsing; everything else is shared.
 *
 * Format: MT940 (SWIFT) with `<XX` subfield lines in :86:
 * Encoding: Windows-1250
 *
 * Reuses ING's RegexExtractor and CsvExporter verbatim — after parsing, a
 * Pocztowy transaction carries exactly the fields those two read (see
 * PocztowyTransaction), so the only Pocztowy-specific piece is ./parser.
 * Same arrangement as BOŚ reusing BNP's.
 */

import { PocztowyMT940Parser } from './parser';
import { RegexExtractor } from '../ing/regex-extractor';
import { CsvExporter } from '../ing/csv-exporter';
import { PocztowyTransaction, ConverterConfig } from './types';
import {
  BaseConverter,
  BaseExtractedData,
  NormalizedTransaction,
  ParseResult,
  ICsvExporter,
} from '../../shared/base-converter';

export class PocztowyConverter extends BaseConverter<PocztowyTransaction> {
  private parser: PocztowyMT940Parser;
  private regexExtractor: RegexExtractor;
  private localConfig: ConverterConfig;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    this.localConfig = {
      ...this.config,
      useAIForExpenses: config.useAIForExpenses ?? false,
    } as ConverterConfig;
    this.parser = new PocztowyMT940Parser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  // ── Abstract method implementations ────────────────────────

  protected getConverterName(): string {
    return 'Bank Pocztowy MT940';
  }

  protected async doParse(content: string): Promise<ParseResult<PocztowyTransaction>> {
    const statement = this.parser.parse(content);
    return {
      transactions: statement.transactions,
      logExtra:
        `Account: ${statement.accountIBAN}, Statement: ${statement.statementNumber}, ` +
        `Opening: ${statement.openingBalance.amount} ${statement.openingBalance.debitCredit}, ` +
        `Closing: ${statement.closingBalance.amount} ${statement.closingBalance.debitCredit}`,
    };
  }

  protected doFilter(
    transactions: PocztowyTransaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): PocztowyTransaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: PocztowyTransaction): boolean {
    return transaction.debitCredit === 'C';
  }

  protected normalize(transaction: PocztowyTransaction): NormalizedTransaction {
    return {
      // The description chunks are cuts of one string — join without a separator.
      descBase: transaction.details.description.join(''),
      descOpt: transaction.details.counterpartyName,
      exeDate: transaction.valueDate,
      creatDate: transaction.entryDate,
      value: transaction.debitCredit === 'C' ? transaction.amount : -transaction.amount,
      accValue: 0, // not available in Pocztowy MT940
      realValue: transaction.amount,
      trnCode: transaction.transactionType,
    };
  }

  protected extractWithRegex(transaction: PocztowyTransaction): BaseExtractedData | null {
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData | null;
  }

  protected buildRawData(transaction: PocztowyTransaction): Record<string, any> {
    return {
      description: transaction.details.description.join(''),
      counterpartyName: transaction.details.counterpartyName,
      counterpartyIBAN: transaction.details.counterpartyIBAN,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<PocztowyTransaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<PocztowyTransaction>;
  }

  // ── Hook overrides ─────────────────────────────────────────

  /** Checks the cache before regex (like ING/BNP/Alior). */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  /** Caches successful regex results. */
  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  /** 90% threshold for accepting a regex extraction (like ING/Alior). */
  protected regexAcceptThreshold(): number {
    return 90;
  }
}

// Re-exports
export * from './types';
export { PocztowyMT940Parser } from './parser';
