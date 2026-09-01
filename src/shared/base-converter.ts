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

import * as path from 'path';
import { AIExtractor } from './ai-extractor';
import { ExtractionCache } from './extraction-cache';
import { MatchCache, contractorSetFingerprint } from './match-cache';
import { ContractorMatcher, MatchedContractor } from './contractor-matcher';
import {
  EXPENSE_MATCH_TYPES,
  DEFAULT_EXPENSE_AI_BATCH_SIZE,
  createBatches,
  matchExpensesWithAI,
  runWithConcurrency,
} from './expense-ai-matcher';
import { Kontrahent, Adres, KontrahentTyp } from './types';
import {
  needsExplicitAccount,
  apartmentGlueInText,
  apartmentWidthImplausible,
  HELD_BACK_CONFIDENCE,
} from './apartment-account';

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
  /** Optional file path for cross-session extraction cache persistence. */
  cachePath?: string;
  /** Max concurrent AI batches per phase. Defaults to 3. */
  aiConcurrency?: number;
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
  /** True when the apartment number came from a user-defined ApartmentMapping rule. */
  matchedByManualMapping?: boolean;
  /**
   * Account symbol that overrides the default `prefix + zero-padded number` rule.
   * Set from an apartment rule's "konto lokalu", or by the user in the review screen.
   */
  accountOverride?: string | null;
  /**
   * True when the apartment number carries a letter (17A) and no account symbol is
   * known for it, so the transaction must not be booked automatically.
   */
  needsAccount?: boolean;
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

/**
 * Progress event emitted during conversion.
 */
export interface ConversionProgress {
  phase:
    | 'parse'
    | 'filter'
    | 'income-quick'
    | 'income-ai'
    | 'expense-quick'
    | 'expense-ai'
    | 'done';
  label: string;
  /** Completed AI batches so far (across both income & expense). */
  aiBatchesCompleted: number;
  /** Total AI batches planned for this conversion. May be 0 before planning. */
  aiBatchesTotal: number;
  /** Percent in [0,100]. */
  percent: number;
}

export type ConversionProgressCallback = (e: ConversionProgress) => void;

export interface ConvertOptions {
  onProgress?: ConversionProgressCallback;
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
  protected matchCache: MatchCache;
  protected config: BaseConverterConfig;
  protected contractorMatcher?: ContractorMatcher;
  private onProgress?: ConversionProgressCallback;
  private aiBatchesCompleted = 0;
  private aiBatchesStarted = 0;
  private aiBatchesTotal = 0;
  private totalTransactionsToPrepare = 0;
  private transactionsPrepared = 0;

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
      // Opt-in only — see shouldUseAIForExpenses(). Conversions leave it unset
      // and expenses the matcher can't resolve come to acceptance unmatched.
      useAIForExpenses: config.useAIForExpenses,
      contractors: config.contractors,
      addresses: config.addresses,
      language: config.language,
      cachePath: config.cachePath,
      aiConcurrency: config.aiConcurrency ?? 3,
    };

    this.cache = new ExtractionCache(this.config.cachePath);
    // Contractor matches live in their own file next to the extraction cache, so
    // every converter gets one without threading a second path through all the
    // construction sites in converterRegistry.
    this.matchCache = new MatchCache(
      this.config.cachePath
        ? path.join(path.dirname(this.config.cachePath), 'match-cache.json')
        : undefined,
      contractorSetFingerprint(this.config.contractors ?? []),
    );

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
   * Whether AI is allowed for expense matching *during a conversion* — opt-in,
   * and off unless a caller explicitly asks for it.
   *
   * Income is different: there, AI resolves an address the user cannot supply
   * any other way, so it runs automatically. An expense only ever fails to match
   * because the contractor is missing from the database or spelled differently
   * there — something the user fixes in the acceptance screen, and re-matching
   * before that fix is a call that can only return the same null. So the expense
   * side is driven from the "Dopasuj ponownie" button instead, once the
   * contractor list has actually changed.
   *
   * Note this does not disable the deterministic matcher or the MatchCache:
   * recurring vendors still match during conversion without any AI call.
   */
  protected shouldUseAIForExpenses(): boolean {
    return this.config.useAIForExpenses === true;
  }

  // ============================================================
  // Shared pipeline
  // ============================================================

  /**
   * Main conversion entry point.
   */
  async convert(
    content: string,
    opts: ConvertOptions = {}
  ): Promise<BaseImportResult<TRaw>> {
    this.onProgress = opts.onProgress;
    this.aiBatchesCompleted = 0;
    this.aiBatchesStarted = 0;
    this.aiBatchesTotal = 0;
    this.totalTransactionsToPrepare = 0;
    this.transactionsPrepared = 0;

    const name = this.getConverterName();
    console.log(`🔄 Starting ${name} conversion...`);

    this.emitProgress('parse', 'Parsowanie pliku...');
    const { transactions, logExtra } = await this.doParse(content);
    console.log(`📄 Parsed ${transactions.length} transactions`);
    if (logExtra) console.log(`   ${logExtra}`);

    this.emitProgress('filter', 'Filtrowanie transakcji...');
    const filtered = this.doFilter(transactions, {
      skipNegative: this.config.skipNegativeAmounts,
      skipBankFees: this.config.skipBankFees,
    });
    const skipped = transactions.length - filtered.length;
    console.log(`✂️  Filtered to ${filtered.length} transactions (skipped ${skipped})`);

    const processed = await this.processTransactions(filtered);

    this.emitProgress('done', 'Generowanie wyników...', 97);
    const result = this.generateResult(processed, transactions.length);

    console.log('✅ Conversion complete');
    console.log(`   Auto-approved: ${result.summary.autoApproved}`);
    console.log(`   Needs review: ${result.summary.needsReview}`);
    console.log(`   Needs manual input: ${result.summary.needsManualInput}`);
    console.log(`   Skipped: ${result.summary.skipped}`);

    this.emitProgress('done', 'Gotowe', 100);
    this.onProgress = undefined;

    return result;
  }

  /**
   * Split transactions into income/expense and process each group in parallel.
   * Income and expense phases are independent and can safely run concurrently.
   */
  private async processTransactions(
    transactions: TRaw[]
  ): Promise<BaseProcessedTransaction<TRaw>[]> {
    const income = transactions.filter((t) => this.isIncome(t));
    const expenses = transactions.filter((t) => !this.isIncome(t));

    this.totalTransactionsToPrepare = income.length + expenses.length;
    this.transactionsPrepared = 0;

    const [incomeProcessed, expenseProcessed] = await Promise.all([
      income.length > 0
        ? this.processIncomeTransactions(income)
        : Promise.resolve([] as BaseProcessedTransaction<TRaw>[]),
      expenses.length > 0
        ? this.processExpenseTransactions(expenses)
        : Promise.resolve([] as BaseProcessedTransaction<TRaw>[]),
    ]);

    return [...incomeProcessed, ...expenseProcessed];
  }

  /**
   * Emit a progress event if a callback is attached.
   *
   * Percent buckets:
   *   parse:                 2%
   *   filter:                5%
   *   prepare (quick):       5% → 30%   (linear by transactionsPrepared / total)
   *   AI batches:           30% → 95%   (linear by aiBatchesCompleted / aiBatchesTotal)
   *   finalize (97%) → done (100%)
   *
   * Callers may pass explicitPercent to override (used for parse/filter/done).
   */
  private emitProgress(
    phase: ConversionProgress['phase'],
    label: string,
    explicitPercent?: number
  ): void {
    if (!this.onProgress) return;

    let percent: number;
    if (typeof explicitPercent === 'number') {
      percent = explicitPercent;
    } else if (phase === 'parse') {
      percent = 2;
    } else if (phase === 'filter') {
      percent = 5;
    } else if (phase === 'income-quick' || phase === 'expense-quick') {
      const total = Math.max(1, this.totalTransactionsToPrepare);
      const share = (this.transactionsPrepared / total) * 25;
      percent = Math.min(30, 5 + share);
    } else if (phase === 'income-ai' || phase === 'expense-ai') {
      if (this.aiBatchesTotal === 0) {
        percent = 30;
      } else {
        // In-flight batches get half credit so each batch start nudges the bar
        // immediately, instead of sitting still until the API call returns.
        const inFlight = this.aiBatchesStarted - this.aiBatchesCompleted;
        const effective = this.aiBatchesCompleted + inFlight * 0.5;
        const share = (effective / this.aiBatchesTotal) * 65;
        percent = Math.min(95, 30 + share);
      }
    } else {
      percent = 50;
    }

    try {
      this.onProgress({
        phase,
        label,
        aiBatchesCompleted: this.aiBatchesCompleted,
        aiBatchesTotal: this.aiBatchesTotal,
        percent: Math.round(percent),
      });
    } catch (e) {
      console.warn('onProgress callback threw:', e);
    }
  }

  /**
   * Yield to the event loop. Lets queued IPC messages flush so the UI
   * actually sees progress emitted from inside otherwise-synchronous loops.
   */
  private yieldEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
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
    this.emitProgress(
      'income-quick',
      `Szybka ekstrakcja przychodów: 0/${transactions.length}`
    );

    const tickEvery = 25;
    for (let i = 0; i < transactions.length; i++) {
      // Bump prepare counter at the top so it's visible even if the rest of
      // the body `continue`s. Emit + yield every `tickEvery` items so the
      // renderer actually sees the progress update.
      this.transactionsPrepared++;
      if (this.transactionsPrepared % tickEvery === 0) {
        this.emitProgress(
          'income-quick',
          `Szybka ekstrakcja przychodów: ${this.transactionsPrepared}/${this.totalTransactionsToPrepare}`
        );
        await this.yieldEventLoop();
      }

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
          // Optionally cache — never a rule match, though. The cache is consulted
          // before the matcher runs, so a cached rule match would freeze the rule's
          // answer: editing the rule (or adding a second apartment to it) would
          // change nothing for this payer until the entry expired. Re-running a
          // rule costs a substring search, so there is nothing to save here.
          if (this.shouldCacheRegexResults() && !extracted.matchedByManualMapping) {
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
    let matchCacheHits = 0;

    console.log('🔍 Phase 1: Partial matching with contractors...');
    this.emitProgress(
      'expense-quick',
      `Dopasowanie kontrahentów: 0/${transactions.length}`
    );

    const tickEvery = 25;
    for (let i = 0; i < transactions.length; i++) {
      this.transactionsPrepared++;
      if (this.transactionsPrepared % tickEvery === 0) {
        this.emitProgress(
          'expense-quick',
          `Dopasowanie kontrahentów: ${this.transactionsPrepared}/${this.totalTransactionsToPrepare}`
        );
        await this.yieldEventLoop();
      }

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
        continue;
      }

      // The deterministic matcher gave up. Before paying for an AI call, check
      // whether this exact description was already matched in an earlier run —
      // housing communities pay the same vendors every month, so recurring
      // transfers hit here. The cached id is re-resolved against the current
      // database, so a renamed or deleted contractor can't resurrect stale data.
      const cachedMatch = this.config.useCache
        ? this.matchCache.get(norm.descBase, norm.descOpt)
        : null;
      const cachedContractor = cachedMatch
        ? this.contractorMatcher?.getById(cachedMatch.contractorId, EXPENSE_MATCH_TYPES)
        : undefined;

      if (cachedMatch && cachedContractor) {
        const fromCache: MatchedContractor = {
          contractor: cachedContractor,
          confidence: cachedMatch.confidence,
          matchedIn: cachedMatch.matchedIn,
          matchedText: cachedContractor.nazwa,
          reasoning: cachedMatch.reasoning,
        };
        const extracted = this.buildExpenseExtracted(transaction, 'cache', []);
        extracted.reasoning = cachedMatch.reasoning;
        processed.push(
          this.createProcessedTransaction(transaction, extracted, 'expense', fromCache)
        );
        matchCacheHits++;
        continue;
      }

      needsAI.push({ transaction, index: i });
    }

    const matchedCount = processed.length;
    console.log(
      `   ✅ Partial matching: ${matchedCount}/${transactions.length}` +
        (matchCacheHits > 0 ? ` (w tym ${matchCacheHits} z cache dopasowań)` : '')
    );
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
   * Batches run with bounded concurrency (config.aiConcurrency, default 3).
   */
  private async processWithAI(
    needsAI: Array<{ transaction: TRaw; index: number }>,
    processed: BaseProcessedTransaction<TRaw>[]
  ): Promise<void> {
    if (!this.aiExtractor) return;

    const batchSize = this.config.useBatchProcessing ? this.config.batchSize : 1;
    const batches = createBatches(needsAI, batchSize);
    const concurrency = this.config.aiConcurrency ?? 3;

    this.aiBatchesTotal += batches.length;
    this.emitProgress(
      'income-ai',
      `AI: przychody — 0/${batches.length} batchy`
    );

    console.log(
      `   Processing ${batches.length} income batches (${batchSize} txns each, concurrency=${concurrency})...`
    );

    const batchResults = await runWithConcurrency(
      batches,
      concurrency,
      async (batch, batchIdx) => {
        try {
          this.aiBatchesStarted += 1;
          this.emitProgress(
            'income-ai',
            `AI: przychody — ${this.aiBatchesCompleted}/${this.aiBatchesTotal} batchy (w toku: ${this.aiBatchesStarted - this.aiBatchesCompleted})`
          );

          const transactionsForAI = batch.map((item) =>
            this.normalize(item.transaction)
          );
          const extracted =
            await this.aiExtractor!.extractBatch(transactionsForAI);

          const items: BaseProcessedTransaction<TRaw>[] = batch.map((b, j) => {
            const norm = transactionsForAI[j];
            const aiText = `${norm.descBase} ${norm.descOpt}`;
            const aiApartment = extracted[j].apartmentNumber;
            // The glue guard has to run again here, for the same reason the letter
            // check does: by this point the matcher's own result is gone, and the
            // model read the same unseparated "M.202-620" the regexes did. An
            // answer of 202 would arrive carrying the model's own confidence, so
            // the evidence is re-read from the text rather than trusted from the
            // producer — whichever producer it was.
            const gluedNumber =
              !!apartmentGlueInText(aiText, aiApartment) ||
              apartmentWidthImplausible(aiApartment);
            const extractedData: BaseExtractedData = {
              ...extracted[j],
              rawData: this.buildRawData(b.transaction),
              // The model is asked to keep the letter in "17A", but a dropped one
              // looks exactly like a correct plain number, so it is checked against
              // the text here. Without this, an AI answer of "17" for text saying
              // "17A" would be booked with the model's own high confidence.
              needsAccount: needsExplicitAccount(aiApartment, null, aiText),
              confidence: gluedNumber
                ? {
                    ...extracted[j].confidence,
                    apartment: Math.min(
                      extracted[j].confidence.apartment,
                      HELD_BACK_CONFIDENCE
                    ),
                    overall: Math.min(
                      extracted[j].confidence.overall,
                      HELD_BACK_CONFIDENCE
                    ),
                  }
                : extracted[j].confidence,
            };
            if (this.config.useCache) {
              this.cache.set(norm.descBase, norm.descOpt, extractedData as any);
            }
            return this.createProcessedTransaction(
              b.transaction,
              extractedData,
              'income'
            );
          });

          this.aiBatchesCompleted += 1;
          this.emitProgress(
            'income-ai',
            `AI: przychody — ${this.aiBatchesCompleted}/${this.aiBatchesTotal} batchy`
          );

          return items;
        } catch (error) {
          console.error(`   ❌ Income batch ${batchIdx + 1} failed:`, error);
          throw error;
        }
      }
    );

    for (const items of batchResults) {
      processed.push(...items);
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

    const matchedContractors = await matchExpensesWithAI(
      needsAI.map((item) => this.normalize(item.transaction)),
      {
        aiExtractor: this.aiExtractor,
        contractorMatcher: this.contractorMatcher,
        matchCache: this.config.useCache ? this.matchCache : undefined,
        batchSize: this.config.useBatchProcessing ? DEFAULT_EXPENSE_AI_BATCH_SIZE : 1,
        concurrency: this.config.aiConcurrency ?? 3,
        onProgress: (event) => {
          if (event.type === 'planned') {
            this.aiBatchesTotal += event.batches;
            this.emitProgress('expense-ai', `AI: wydatki — 0/${event.batches} batchy`);
            return;
          }
          if (event.type === 'started') {
            this.aiBatchesStarted += 1;
            this.emitProgress(
              'expense-ai',
              `AI: wydatki — ${this.aiBatchesCompleted}/${this.aiBatchesTotal} batchy (w toku: ${this.aiBatchesStarted - this.aiBatchesCompleted})`
            );
            return;
          }
          this.aiBatchesCompleted += 1;
          this.emitProgress(
            'expense-ai',
            `AI: wydatki — ${this.aiBatchesCompleted}/${this.aiBatchesTotal} batchy`
          );
        },
      }
    );

    needsAI.forEach(({ transaction }, i) => {
      const matchedContractor = matchedContractors[i];
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
        warnings: matchedContractor.contractor ? [] : ['AI could not match contractor'],
        rawData: this.buildRawData(transaction),
      };
      processed.push(
        this.createProcessedTransaction(transaction, extracted, 'expense', matchedContractor)
      );
    });
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
    // Single pass over `processed` instead of ~9 separate .filter().length scans.
    const summary = { autoApproved: 0, needsReview: 0, needsManualInput: 0, skipped: totalTransactions - processed.length };
    const extractionMethods = { regex: 0, ai: 0, cache: 0, manual: 0 };
    let totalConfidence = 0;
    for (const p of processed) {
      if (p.status === 'auto-approved') summary.autoApproved++;
      else if (p.status === 'needs-review') summary.needsReview++;
      else if (p.status === 'needs-manual-input') summary.needsManualInput++;

      const method = p.extracted.extractionMethod;
      if (method === 'regex') extractionMethods.regex++;
      else if (method === 'ai') extractionMethods.ai++;
      else if (method === 'cache') extractionMethods.cache++;
      else if (method === 'manual') extractionMethods.manual++;

      totalConfidence += p.transactionType === 'income'
        ? p.extracted.confidence.overall
        : (p.matchedContractor?.confidence || 0);
    }
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

  // ============================================================
  // Public export methods (delegate to per-converter CsvExporter)
  // ============================================================

  exportToCsv(
    transactions: BaseProcessedTransaction<TRaw>[],
    accountConfig?: { bankAccountSymbol?: string; apartmentPrefix?: string },
  ): string {
    const exporter = this.createCsvExporter({
      separator: '\t',
      dateFormat: 'D.MM.YYYY',
      decimalSeparator: ',',
      bankAccountSymbol: accountConfig?.bankAccountSymbol,
      apartmentPrefix: accountConfig?.apartmentPrefix,
    });
    return exporter.export(transactions);
  }

  exportAuxiliaryFile(
    transactions: BaseProcessedTransaction<TRaw>[],
    accountConfig?: { bankAccountSymbol?: string; apartmentPrefix?: string },
  ): string {
    const exporter = this.createCsvExporter({
      separator: '\t',
      dateFormat: 'D.MM.YYYY',
      decimalSeparator: ',',
      bankAccountSymbol: accountConfig?.bankAccountSymbol,
      apartmentPrefix: accountConfig?.apartmentPrefix,
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
