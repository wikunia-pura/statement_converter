/**
 * ING Bank MT940 Converter
 * Extends BaseConverter with ING MT940-specific parsing and extraction.
 *
 * Format: MT940 (SWIFT) with `~XX` subfield delimiters in :86:
 * Encoding: CP852 (DOS Latin-2, Polish diacritics)
 *
 * Format-specific responsibilities:
 *   - Parse ING MT940 file (via INGMT940Parser)
 *   - Normalize INGTransaction → NormalizedTransaction
 *   - Regex extraction via shared AddressMatcher
 *
 * Key ING quirks handled:
 *   - Double :86: fields per transaction (short code + detailed)
 *   - :61: uses S separator before 3-digit transaction type
 *   - ~62 field contains continuation of counterparty address
 *   - Balance info entries (type 940) are filtered out
 */

import { INGMT940Parser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { CsvExporter } from './csv-exporter';
import {
  INGTransaction,
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

export class INGConverter extends BaseConverter<INGTransaction> {
  private parser: INGMT940Parser;
  private regexExtractor: RegexExtractor;
  private localConfig: ConverterConfig;

  constructor(config: Partial<ConverterConfig> = {}) {
    super(config);
    this.localConfig = {
      ...this.config,
      useAIForExpenses: config.useAIForExpenses ?? false,
    } as ConverterConfig;
    this.parser = new INGMT940Parser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
  }

  // ── Abstract method implementations ────────────────────────

  protected getConverterName(): string {
    return 'ING Bank MT940';
  }

  protected async doParse(content: string): Promise<ParseResult<INGTransaction>> {
    const statement = this.parser.parse(content);
    return {
      transactions: statement.transactions,
      logExtra: `IBAN: ${statement.accountIBAN}, Opening: ${statement.openingBalance.amount} ${statement.openingBalance.debitCredit}, Closing: ${statement.closingBalance.amount} ${statement.closingBalance.debitCredit}`,
    };
  }

  protected doFilter(
    transactions: INGTransaction[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): INGTransaction[] {
    return this.parser.filterTransactions(transactions, {
      skipNegative: opts.skipNegative,
      skipBankFees: opts.skipBankFees,
    });
  }

  protected isIncome(transaction: INGTransaction): boolean {
    return transaction.debitCredit === 'C';
  }

  protected normalize(transaction: INGTransaction): NormalizedTransaction {
    // Counterparty info for descOpt: name + ~62 continuation
    const descOpt = [transaction.details.counterpartyName, transaction.details.additionalInfo]
      .filter(Boolean)
      .join(' ');

    return {
      descBase: transaction.details.description.join(' '),
      descOpt,
      exeDate: transaction.valueDate,
      creatDate: transaction.entryDate,
      value: transaction.debitCredit === 'C' ? transaction.amount : -transaction.amount,
      accValue: 0, // not available in ING MT940
      realValue: transaction.amount,
      trnCode: transaction.transactionType,
    };
  }

  protected extractWithRegex(transaction: INGTransaction): BaseExtractedData | null {
    return this.regexExtractor.extract(transaction) as unknown as BaseExtractedData | null;
  }

  protected buildRawData(transaction: INGTransaction): Record<string, any> {
    return {
      description: transaction.details.description.join(' '),
      counterpartyName: transaction.details.counterpartyName,
      counterpartyIBAN: transaction.details.counterpartyIBAN,
      additionalInfo: transaction.details.additionalInfo,
    };
  }

  protected createCsvExporter(options?: any): ICsvExporter<INGTransaction> {
    return new CsvExporter(options) as unknown as ICsvExporter<INGTransaction>;
  }

  // ── Hook overrides (ING-specific behavior) ─────────────────

  /** ING checks cache before regex (like BNP/Alior). */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  /** ING caches successful regex results. */
  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  /** ING uses 90% threshold for regex acceptance (like Alior). */
  protected regexAcceptThreshold(): number {
    return 90;
  }

  /** ING has explicit toggle for AI expenses (like Alior). */
  protected shouldUseAIForExpenses(): boolean {
    return this.localConfig.useAIForExpenses ?? false;
  }
}

// Re-exports
export * from './types';
export { INGMT940Parser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { CsvExporter } from './csv-exporter';
