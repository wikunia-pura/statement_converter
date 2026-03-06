/**
 * PKO BP MT940 Converter
 * Extends BaseConverter with MT940-specific parsing and extraction.
 *
 * Format-specific responsibilities:
 *   - Parse MT940 file (via PKOBPMT940Parser)
 *   - Normalize MT940Transaction → NormalizedTransaction
 *   - Regex extraction (always returns ExtractedData, never null)
 */

import { PKOBPMT940Parser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { CsvExporter } from './csv-exporter';
import {
  MT940Transaction,
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

export class PKOBPMT940Converter extends BaseConverter<MT940Transaction> {
  private parser: PKOBPMT940Parser;
  private regexExtractor: RegexExtractor;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    this.parser = new PKOBPMT940Parser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  // ── Abstract method implementations ────────────────────────

  protected getConverterName(): string {
    return 'PKO BP MT940';
  }

  protected async doParse(content: string): Promise<ParseResult<MT940Transaction>> {
    const statement = this.parser.parse(content);
    return {
      transactions: statement.transactions,
      logExtra: `Opening balance: ${statement.openingBalance.amount} ${statement.openingBalance.debitCredit}, Closing balance: ${statement.closingBalance.amount} ${statement.closingBalance.debitCredit}`,
    };
  }

  protected doFilter(
    transactions: MT940Transaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): MT940Transaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: MT940Transaction): boolean {
    return transaction.debitCredit === 'C';
  }

  protected normalize(transaction: MT940Transaction): NormalizedTransaction {
    return {
      descBase: transaction.details.description.join(''),
      descOpt: transaction.details.counterpartyName,
      exeDate: transaction.valueDate,
      creatDate: transaction.entryDate,
      value: transaction.amount,
      accValue: transaction.amount,
      realValue: transaction.amount,
      trnCode: transaction.transactionType,
    };
  }

  protected extractWithRegex(transaction: MT940Transaction): BaseExtractedData | null {
    // PKO regex extractor always returns ExtractedData (never null)
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData;
  }

  protected buildRawData(transaction: MT940Transaction): Record<string, any> {
    return {
      description: transaction.details.description.join(''),
      counterpartyName: transaction.details.counterpartyName,
      counterpartyIBAN: transaction.details.counterpartyIBAN,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<MT940Transaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<MT940Transaction>;
  }

  // ── Hook overrides (PKO-specific behavior) ─────────────────

  /** PKO does not check cache before regex (relies on regex alone). */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return false;
  }

  /** PKO does not cache regex results. */
  protected shouldCacheRegexResults(): boolean {
    return false;
  }

  /** PKO uses autoApprove threshold (85) for regex acceptance. */
  protected regexAcceptThreshold(): number {
    return this.config.confidenceThresholds.autoApprove;
  }

  /** PKO always uses AI for expenses when available. */
  protected shouldUseAIForExpenses(): boolean {
    return true;
  }
}

// Export everything
export * from './types';
export { PKOBPMT940Parser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { CsvExporter } from './csv-exporter';
