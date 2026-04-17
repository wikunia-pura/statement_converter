/**
 * BaseConverter - Abstract base class for all bank statement converters
 * 
 * Provides the complete processing pipeline:
 *   parse → filter → split income/expense → regex/cache → AI → generate result
 * 
 * Subclasses only need to implement format-specific operations:
 *   - doParse(): parse the raw file
 *   - doFilter(): filter unwanted transactions
 *   - isIncome(): determine income vs. expense
 *   - normalize(): convert to NormalizedTransaction for AI/cache/matching
 *   - extractWithRegex(): format-specific regex extraction
 *   - buildRawData(): build rawData for ExtractedData
 *   - createCsvExporter(): return the format-specific CsvExporter
 */

import { AIExtractor } from './ai-extractor';
import { ExtractionCache } from './extraction-cache';
import { ContractorMatcher, MatchedContractor } from './contractor-matcher';
import { Kontrahent, Adres, KontrahentTyp } from './types';

const EXPENSE_MATCH_TYPES: KontrahentTyp[] = ['Kontrahent', 'Pozostałe koszty'];
const INCOME_MATCH_TYPES: KontrahentTyp[] = ['Pozostałe przychody'];

// ============================================================
// Shared interfaces
// ============================================================

/**
 * Normalized transaction format used by AI extractor, cache, and contractor matcher.
 * Every converter normalizes its raw transactions into this before AI/matching.
 */
export interface NormalizedTransaction {
  descBase: string;
  descOpt: string;
  exeDate: string;
  creatDate: string;
  value: number;
  accValue: number;
  realValue: number;
  trnCode: string;
}

/**
 * Shared converter configuration.
 * Per-converter configs can extend this with extra fields.
 */
export interface BaseConverterConfig {
  aiProvider: 'anthropic' | 'openai' | 'ollama' | 'none';
  apiKey?: string;
  model?: string;
  useBatchProcessing: boolean;
  batchSize: number;
  confidenceThresholds: {
    autoApprove: number;
    needsReview: number;
  };
  useCache: boolean;
  useRegexFirst: boolean;
  skipNegativeAmounts: boolean;
  skipBankFees: boolean;
  useAIForExpenses?: boolean;
  contractors?: Kontrahent[];
  addresses?: Adres[];
  language?: 'pl' | 'en';
}

/**
 * Extracted data from a transaction (shared structure).
 * rawData is converter-specific so it's typed as Record<string, any>.
 */
export interface BaseExtractedData {
  streetName: string | null;
  buildingNumber: string | null;
  apartmentNumber: string | null;
  fullAddress: string | null;
  tenantName: string | null;
  confidence: {
    address: number;
    apartment: number;
    tenantName: number;
    overall: number;
  };
  extractionMethod: 'regex' | 'ai' | 'hybrid' | 'cache' | 'manual';
  reasoning?: string;
  warnings: string[];
  rawData: Record<string, any>;
}

/**
 * Processed transaction (generic over the raw transaction type).
 */
export interface BaseProcessedTransaction<TRaw> {
  original: TRaw;
  normalized: NormalizedTransaction;
  extracted: BaseExtractedData;
  matchedContractor?: MatchedContractor;
  transactionType: 'income' | 'expense';
  status: 'auto-approved' | 'needs-review' | 'needs-manual-input' | 'skipped';
  corrected?: {
    fullAddress: string;
    tenantName: string;
    correctedBy: 'user';
    correctedAt: Date;
  };
  reviewedByUser?: {
    action: 'accept' | 'reject' | 'manual';
    originalValue?: string | null;
    manualValue?: string;
    extractedFrom?: string;
  };
}

/**
 * Import result (generic over the raw transaction type).
 */
export interface BaseImportResult<TRaw> {
  totalTransactions: number;
  processed: BaseProcessedTransaction<TRaw>[];
  summary: {
    autoApproved: number;
    needsReview: number;
    needsManualInput: number;
    skipped: number;
  };
  statistics: {
    averageConfidence: number;
    extractionMethods: {
      regex: number;
      ai: number;
      cache: number;
      manual: number;
    };
  };
  errors: any[];
}

/**
 * Interface for CsvExporter (both converters expose the same API).
 */
export interface ICsvExporter<TRaw> {
  export(transactions: BaseProcessedTransaction<TRaw>[]): string;
  exportAuxiliary(transactions: BaseProcessedTransaction<TRaw>[]): string;
}

/**
 * Parse result returned by doParse().
 */
export interface ParseResult<TRaw> {
  /** All transactions before filtering */
  transactions: TRaw[];
  /** Extra info for logging (e.g., opening/closing balance) */
  logExtra?: string;
}

// ============================================================
// Utility functions
// ============================================================

/**
 * Check if error is a billing/quota error that should stop processing.
 */
export function isBillingError(error: any): boolean {
  if (!error) return false;

  const errorMessage = error.message || '';

  if (errorMessage.includes('💸')) return true;

  if (
    errorMessage.toLowerCase().includes('quota') ||
    errorMessage.toLowerCase().includes('billing') ||
    errorMessage.toLowerCase().includes('payment required')
  ) {
    return true;
  }

  if (error.status === 402 || error.status === 429) return true;

  return false;
}

// ============================================================
// BaseConverter abstract class
// ============================================================

export abstract class BaseConverter<TRaw> {
  protected aiExtractor?: AIExtractor;
  protected cache: ExtractionCache;
  protected config: BaseConverterConfig;
  protected contractorMatcher?: ContractorMatcher;

  constructor(config: Partial<BaseConverterConfig> = {}) {
    this.config = {
      aiProvider: config.aiProvider || 'anthropic',
      apiKey: config.apiKey,
      model: config.model,
      useBatchProcessing: config.useBatchProcessing ?? true,
      batchSize: config.batchSize || 20,
      confidenceThresholds: config.confidenceThresholds || {
        autoApprove: 85,
        needsReview: 70,
      },
      useCache: config.useCache ?? true,
      useRegexFirst: config.useRegexFirst ?? true,
      skipNegativeAmounts: config.skipNegativeAmounts ?? false,
      skipBankFees: config.skipBankFees ?? true,
      useAIForExpenses: config.useAIForExpenses ?? false,
      contractors: config.contractors,
      addresses: config.addresses,
      language: config.language,
    };

    this.cache = new ExtractionCache();

    if (this.config.apiKey && this.config.aiProvider !== 'none') {
      this.aiExtractor = new AIExtractor(this.config);
    }

    if (this.config.contractors && this.config.contractors.length > 0) {
      this.contractorMatcher = new ContractorMatcher(this.config.contractors);
    }
  }

  // ============================================================
  // Abstract methods — each converter MUST implement these
  // ============================================================

  /** Converter display name for logs (e.g. "PKO BP MT940", "Santander XML") */
  protected abstract getConverterName(): string;

  /** Parse the raw file content and return all transactions. */
  protected abstract doParse(
    content: string
  ): Promise<ParseResult<TRaw>>;

  /** Filter transactions (remove bank fees, unwanted types, etc.). */
  protected abstract doFilter(
    transactions: TRaw[],
    opts: { skipNegative: boolean; skipBankFees: boolean }
  ): TRaw[];

  /** Return true if the transaction is income (credit). */
  protected abstract isIncome(transaction: TRaw): boolean;

  /** Normalize raw transaction into format for AI/cache/contractor matching. */
  protected abstract normalize(transaction: TRaw): NormalizedTransaction;

  /** Regex extraction (may return null if confidence too low). */
  protected abstract extractWithRegex(
    transaction: TRaw
  ): BaseExtractedData | null;

  /** Build the rawData object for ExtractedData. */
  protected abstract buildRawData(transaction: TRaw): Record<string, any>;

  /** Create the format-specific CsvExporter instance. */
  protected abstract createCsvExporter(options?: any): ICsvExporter<TRaw>;

  // ============================================================
  // Overridable hooks — subclasses CAN override for custom behavior
  // ============================================================

  /**
   * Whether to check cache before regex extraction (income).
   * Default: true for converters that use the AI-result cache.
   */
  protected shouldCheckCacheBeforeRegex(): boolean {
    return this.config.useCache;
  }

  /**
   * Whether to cache successful regex extractions.
   * Default: true.
   */
  protected shouldCacheRegexResults(): boolean {
    return this.config.useCache;
  }

  /**
   * Minimum confidence for regex extraction to be accepted (income).
   * Default: 90.
   */
  protected regexAcceptThreshold(): number {
    return 90;
  }

  /**
   * Whether AI is allowed for expense matching.
   * Default: from config.useAIForExpenses.
   */
  protected shouldUseAIForExpenses(): boolean {
    return this.config.useAIForExpenses ?? false;
  }

  // ============================================================
  // Shared pipeline
  // ============================================================

  /**
   * Main conversion entry point.
   */
  async convert(content: string): Promise<BaseImportResult<TRaw>> {
    const name = this.getConverterName();
    console.log(`🔄 Starting ${name} conversion...`);

    const { transactions, logExtra } = await this.doParse(content);
    console.log(`📄 Parsed ${transactions.length} transactions`);
    if (logExtra) console.log(`   ${logExtra}`);

    const filtered = this.doFilter(transactions, {
      skipNegative: this.config.skipNegativeAmounts,
      skipBankFees: this.config.skipBankFees,
    });
    const skipped = transactions.length - filtered.length;
    console.log(`✂️  Filtered to ${filtered.length} transactions (skipped ${skipped})`);

    const processed = await this.processTransactions(filtered);
    const result = this.generateResult(processed, transactions.length);

    console.log('✅ Conversion complete');
    console.log(`   Auto-approved: ${result.summary.autoApproved}`);
    console.log(`   Needs review: ${result.summary.needsReview}`);
    console.log(`   Needs manual input: ${result.summary.needsManualInput}`);
    console.log(`   Skipped: ${result.summary.skipped}`);

    return result;
  }

  /**
   * Split transactions into income/expense and process each group.
   */
  private async processTransactions(
    transactions: TRaw[]
  ): Promise<BaseProcessedTransaction<TRaw>[]> {
    const processed: BaseProcessedTransaction<TRaw>[] = [];

    const income = transactions.filter((t) => this.isIncome(t));
    const expenses = transactions.filter((t) => !this.isIncome(t));

    if (income.length > 0) {
      processed.push(...(await this.processIncomeTransactions(income)));
    }
    if (expenses.length > 0) {
      processed.push(...(await this.processExpenseTransactions(expenses)));
    }

    return processed;
  }

  /**
   * Process income transactions: regex → cache → AI → manual fallback.
   */
  private async processIncomeTransactions(
    transactions: TRaw[]
  ): Promise<BaseProcessedTransaction<TRaw>[]> {
    const processed: BaseProcessedTransaction<TRaw>[] = [];
    const needsAI: Array<{ transaction: TRaw; index: number }> = [];

    console.log('🔍 Phase 1: Quick extraction (regex + cache) for income...');

    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      let extracted: BaseExtractedData | null = null;

      // Income-side name match against 'Pozostałe przychody' entries.
      // Runs before cache/regex so categorized deposits (lokaty, odsetki, etc.)
      // route straight to the configured income account.
      if (this.contractorMatcher) {
        const norm = this.normalize(transaction);
        const incomeMatch = this.contractorMatcher.match(norm, INCOME_MATCH_TYPES);
        if (incomeMatch.contractor && incomeMatch.confidence >= 90) {
          extracted = this.buildIncomeCategoryExtracted(transaction, incomeMatch.contractor);
          processed.push(
            this.createProcessedTransaction(transaction, extracted, 'income')
          );
          continue;
        }
      }

      // Optional: check cache first
      if (this.shouldCheckCacheBeforeRegex()) {
        const norm = this.normalize(transaction);
        extracted = this.cache.get(norm.descBase, norm.descOpt) as BaseExtractedData | null;
        if (extracted) {
          processed.push(
            this.createProcessedTransaction(transaction, extracted, 'income')
          );
          continue;
        }
      }

      // Try regex extraction
      if (this.config.useRegexFirst) {
        extracted = this.extractWithRegex(transaction);
        if (
          extracted &&
          extracted.confidence.overall >= this.regexAcceptThreshold()
        ) {
          // Optionally cache
          if (this.shouldCacheRegexResults()) {
            const norm = this.normalize(transaction);
            this.cache.set(norm.descBase, norm.descOpt, extracted as any);
          }
          processed.push(
            this.createProcessedTransaction(transaction, extracted, 'income')
          );
          continue;
        }
      }

      needsAI.push({ transaction, index: i });
    }

    console.log(`   ✅ Quick extraction: ${processed.length}/${transactions.length}`);
    console.log(`   🤖 Needs AI: ${needsAI.length}`);

    // Phase 2: AI extraction
    if (needsAI.length > 0 && this.aiExtractor) {
      console.log('🤖 Phase 2: AI extraction...');
      await this.processWithAI(needsAI, processed);
    } else if (needsAI.length > 0 && !this.aiExtractor) {
      console.warn('⚠️  No AI provider configured, creating low-confidence entries');
      for (const { transaction } of needsAI) {
        const extracted = this.buildLowConfidenceExtracted(transaction, [
          'No AI provider configured',
        ]);
        processed.push(
          this.createProcessedTransaction(transaction, extracted, 'income')
        );
      }
    }

    return processed;
  }

  /**
   * Process expense transactions: contractor matcher → AI → manual fallback.
   */
  private async processExpenseTransactions(
    transactions: TRaw[]
  ): Promise<BaseProcessedTransaction<TRaw>[]> {
    console.log(`💸 Processing ${transactions.length} expense transactions...`);
    const processed: BaseProcessedTransaction<TRaw>[] = [];
    const needsAI: Array<{ transaction: TRaw; index: number }> = [];

    console.log('🔍 Phase 1: Partial matching with contractors...');

    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      const norm = this.normalize(transaction);

      const matchedContractor = this.contractorMatcher
        ? this.contractorMatcher.match(norm, EXPENSE_MATCH_TYPES)
        : { contractor: null, confidence: 0, matchedIn: 'none' as const };

      if (matchedContractor.contractor !== null && matchedContractor.confidence > 0) {
        const extracted = this.buildExpenseExtracted(
          transaction,
          matchedContractor.confidence >= 90 ? 'manual' : 'regex',
          matchedContractor.confidence < 70
            ? ['Low confidence match - may need review']
            : []
        );
        processed.push(
          this.createProcessedTransaction(
            transaction,
            extracted,
            'expense',
            matchedContractor
          )
        );
      } else {
        needsAI.push({ transaction, index: i });
      }
    }

    const matchedCount = processed.length;
    console.log(`   ✅ Partial matching: ${matchedCount}/${transactions.length}`);
    console.log(`   🤖 Needs AI: ${needsAI.length}`);

    // Phase 2: AI matching
    if (needsAI.length > 0) {
      if (this.shouldUseAIForExpenses()) {
        await this.processExpensesWithAI(needsAI, processed);
      } else {
        console.log('   ⚠️  AI disabled/unavailable for expenses, marking as unrecognized');
        for (const { transaction } of needsAI) {
          const extracted = this.buildExpenseExtracted(transaction, 'manual', [
            'No contractor matched - needs manual assignment',
          ]);
          const unrecognized = {
            contractor: null,
            confidence: 0,
            matchedIn: 'none' as const,
          };
          processed.push(
            this.createProcessedTransaction(transaction, extracted, 'expense', unrecognized)
          );
        }
      }
    }

    const finalMatchedCount = processed.filter(
      (p) => p.matchedContractor?.contractor !== null
    ).length;
    console.log(`   ✅ Total matched contractors: ${finalMatchedCount}/${transactions.length}`);

    return processed;
  }

  /**
   * Process income transactions with AI in batches.
   */
  private async processWithAI(
    needsAI: Array<{ transaction: TRaw; index: number }>,
    processed: BaseProcessedTransaction<TRaw>[]
  ): Promise<void> {
    if (!this.aiExtractor) return;

    const batchSize = this.config.useBatchProcessing ? this.config.batchSize : 1;
    const batches = this.createBatches(needsAI, batchSize);

    console.log(
      `   Processing ${batches.length} batches (${batchSize} transactions each)...`
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`   Batch ${i + 1}/${batches.length}...`);

      try {
        const transactionsForAI = batch.map((item) =>
          this.normalize(item.transaction)
        );
        const extracted = await this.aiExtractor.extractBatch(transactionsForAI);

        for (let j = 0; j < batch.length; j++) {
          const { transaction } = batch[j];
          const extractedData: BaseExtractedData = {
            ...extracted[j],
            rawData: this.buildRawData(transaction),
          };

          // Cache AI extraction
          if (this.config.useCache) {
            const norm = this.normalize(transaction);
            this.cache.set(norm.descBase, norm.descOpt, extractedData as any);
          }

          processed.push(
            this.createProcessedTransaction(transaction, extractedData, 'income')
          );
        }
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error);
        throw error;
      }
    }
  }

  /**
   * Process expenses with AI contractor matching in batches.
   */
  private async processExpensesWithAI(
    needsAI: Array<{ transaction: TRaw; index: number }>,
    processed: BaseProcessedTransaction<TRaw>[]
  ): Promise<void> {
    if (!this.aiExtractor || !this.contractorMatcher) {
      console.warn('   ⚠️  AI not available, marking expenses as unrecognized');
      for (const { transaction } of needsAI) {
        const extracted = this.buildExpenseExtracted(transaction, 'manual', [
          'No contractor matched - needs manual assignment',
        ]);
        const unrecognized = {
          contractor: null,
          confidence: 0,
          matchedIn: 'none' as const,
        };
        processed.push(
          this.createProcessedTransaction(transaction, extracted, 'expense', unrecognized)
        );
      }
      return;
    }

    const batchSize = this.config.useBatchProcessing ? 50 : 1;
    const batches = this.createBatches(needsAI, batchSize);

    console.log(
      `   Processing ${batches.length} batches (${batchSize} expenses each)...`
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`   Batch ${i + 1}/${batches.length}...`);

      try {
        const transactionsForAI = batch.map((item) =>
          this.normalize(item.transaction)
        );

        const candidatesPerTransaction = transactionsForAI.map((t) =>
          this.contractorMatcher!.getTopCandidates(t, 10, EXPENSE_MATCH_TYPES)
        );

        const matchedContractors =
          await this.aiExtractor.matchContractorsBatch(
            transactionsForAI,
            candidatesPerTransaction
          );

        for (let j = 0; j < batch.length; j++) {
          const { transaction } = batch[j];
          const matchedContractor = matchedContractors[j];

          const extracted: BaseExtractedData = {
            streetName: null,
            buildingNumber: null,
            apartmentNumber: null,
            fullAddress: null,
            tenantName: null,
            confidence: {
              address: 0,
              apartment: 0,
              tenantName: 0,
              overall: 0,
            },
            extractionMethod: 'ai',
            reasoning: matchedContractor.reasoning,
            warnings: matchedContractor.contractor
              ? []
              : ['AI could not match contractor'],
            rawData: this.buildRawData(transaction),
          };

          processed.push(
            this.createProcessedTransaction(
              transaction,
              extracted,
              'expense',
              matchedContractor
            )
          );
        }
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error);
        throw error;
      }
    }
  }

  // ============================================================
  // Helper methods
  // ============================================================

  /**
   * Create a ProcessedTransaction from extraction result.
   */
  protected createProcessedTransaction(
    transaction: TRaw,
    extracted: BaseExtractedData,
    transactionType: 'income' | 'expense',
    matchedContractor?: MatchedContractor
  ): BaseProcessedTransaction<TRaw> {
    const confidence =
      transactionType === 'income'
        ? extracted.confidence.overall
        : matchedContractor?.confidence || 0;

    let status: BaseProcessedTransaction<TRaw>['status'];
    if (confidence >= this.config.confidenceThresholds.autoApprove) {
      status = 'auto-approved';
    } else if (confidence >= this.config.confidenceThresholds.needsReview) {
      status = 'needs-review';
    } else {
      status = 'needs-manual-input';
    }

    return {
      original: transaction,
      normalized: this.normalize(transaction),
      extracted,
      transactionType,
      matchedContractor,
      status,
    };
  }

  /**
   * Generate the final import result with statistics.
   */
  protected generateResult(
    processed: BaseProcessedTransaction<TRaw>[],
    totalTransactions: number
  ): BaseImportResult<TRaw> {
    const summary = {
      autoApproved: processed.filter((p) => p.status === 'auto-approved').length,
      needsReview: processed.filter((p) => p.status === 'needs-review').length,
      needsManualInput: processed.filter((p) => p.status === 'needs-manual-input').length,
      skipped: totalTransactions - processed.length,
    };

    const extractionMethods = {
      regex: processed.filter((p) => p.extracted.extractionMethod === 'regex').length,
      ai: processed.filter((p) => p.extracted.extractionMethod === 'ai').length,
      cache: processed.filter((p) => p.extracted.extractionMethod === 'cache').length,
      manual: processed.filter((p) => p.extracted.extractionMethod === 'manual').length,
    };

    const totalConfidence = processed.reduce((sum, p) => {
      if (p.transactionType === 'income') {
        return sum + p.extracted.confidence.overall;
      } else {
        return sum + (p.matchedContractor?.confidence || 0);
      }
    }, 0);
    const averageConfidence =
      processed.length > 0 ? totalConfidence / processed.length : 0;

    return {
      totalTransactions,
      processed,
      summary,
      statistics: {
        averageConfidence,
        extractionMethods,
      },
      errors: [],
    };
  }

  /**
   * Build ExtractedData for an income transaction that matched a 'Pozostałe przychody' entry.
   * The entry's account goes straight into apartmentNumber — csv-exporter's formatAccountNumber
   * passes non-digit strings through as-is, so konto like "760-500" routes correctly.
   */
  protected buildIncomeCategoryExtracted(
    transaction: TRaw,
    contractor: Kontrahent
  ): BaseExtractedData {
    return {
      streetName: null,
      buildingNumber: null,
      apartmentNumber: contractor.kontoKontrahenta,
      fullAddress: contractor.nazwa,
      tenantName: contractor.nazwa,
      confidence: { address: 100, apartment: 100, tenantName: 100, overall: 100 },
      extractionMethod: 'regex',
      reasoning: `Dopasowano wpis "${contractor.nazwa}" (Pozostałe przychody)`,
      warnings: [],
      rawData: this.buildRawData(transaction),
    };
  }

  /**
   * Build a low-confidence ExtractedData for manual fallback.
   */
  protected buildLowConfidenceExtracted(
    transaction: TRaw,
    warnings: string[]
  ): BaseExtractedData {
    return {
      streetName: null,
      buildingNumber: null,
      apartmentNumber: null,
      fullAddress: null,
      tenantName: null,
      confidence: { address: 0, apartment: 0, tenantName: 0, overall: 0 },
      extractionMethod: 'manual',
      warnings,
      rawData: this.buildRawData(transaction),
    };
  }

  /**
   * Build ExtractedData for expense transactions (address fields are N/A for expenses).
   */
  protected buildExpenseExtracted(
    transaction: TRaw,
    method: BaseExtractedData['extractionMethod'],
    warnings: string[]
  ): BaseExtractedData {
    return {
      streetName: null,
      buildingNumber: null,
      apartmentNumber: null,
      fullAddress: null,
      tenantName: null,
      confidence: { address: 0, apartment: 0, tenantName: 0, overall: 0 },
      extractionMethod: method,
      warnings,
      rawData: this.buildRawData(transaction),
    };
  }

  /**
   * Split items into batches.
   */
  protected createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  // ============================================================
  // Public export methods (delegate to per-converter CsvExporter)
  // ============================================================

  exportToCsv(transactions: BaseProcessedTransaction<TRaw>[]): string {
    const exporter = this.createCsvExporter({
      separator: '\t',
      dateFormat: 'D.MM.YYYY',
      decimalSeparator: ',',
    });
    return exporter.export(transactions);
  }

  exportAuxiliaryFile(transactions: BaseProcessedTransaction<TRaw>[]): string {
    const exporter = this.createCsvExporter({
      separator: '\t',
      dateFormat: 'D.MM.YYYY',
      decimalSeparator: ',',
    });
    return exporter.exportAuxiliary(transactions);
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  clearCache() {
    this.cache.clear();
  }
}
