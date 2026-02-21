/**
 * Main Santander XML Converter
 * Orchestrates the extraction process with hybrid approach (regex + AI)
 */

import { SantanderXmlParser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { AIExtractor } from './ai-extractor';
import { ExtractionCache } from './cache';
import { CsvExporter } from './csv-exporter';
import { ContractorMatcher } from './contractor-matcher';
import {
  XmlStatement,
  XmlTransaction,
  ProcessedTransaction,
  ImportResult,
  ConverterConfig,
  ExtractedData,
} from './types';

export class SantanderXmlConverter {
  private parser: SantanderXmlParser;
  private regexExtractor: RegexExtractor;
  private aiExtractor?: AIExtractor;
  private cache: ExtractionCache;
  private config: ConverterConfig;
  private contractorMatcher?: ContractorMatcher;

  constructor(config: Partial<ConverterConfig> = {}) {
    this.config = {
      aiProvider: config.aiProvider || 'anthropic',
      apiKey: config.apiKey,
      model: config.model,
      useBatchProcessing: config.useBatchProcessing ?? true,
      batchSize: config.batchSize || 20,
      confidenceThresholds: config.confidenceThresholds || {
        autoApprove: 85,
        needsReview: 60,
      },
      useCache: config.useCache ?? true,
      useRegexFirst: config.useRegexFirst ?? true,
      skipNegativeAmounts: config.skipNegativeAmounts ?? false, // Changed to false - process expenses
      skipBankFees: config.skipBankFees ?? true,
      contractors: config.contractors,
    };

    this.parser = new SantanderXmlParser();
    this.regexExtractor = new RegexExtractor();
    this.cache = new ExtractionCache();

    // Initialize AI extractor if configured
    if (this.config.apiKey && this.config.aiProvider !== 'none') {
      this.aiExtractor = new AIExtractor(this.config);
    }

    // Initialize contractor matcher if contractors provided
    if (this.config.contractors && this.config.contractors.length > 0) {
      this.contractorMatcher = new ContractorMatcher(this.config.contractors);
    }
  }

  /**
   * Convert XML file
   */
  async convert(xmlContent: string): Promise<ImportResult> {
    console.log('🔄 Starting Santander XML conversion...');

    // Parse XML
    const statement = await this.parser.parse(xmlContent);
    console.log(`📄 Parsed ${statement.transactions.length} transactions`);

    // Filter transactions (skip expenses, bank fees, etc.)
    const filteredTransactions = this.parser.filterTransactions(statement.transactions, {
      skipNegative: this.config.skipNegativeAmounts,
      skipBankFees: this.config.skipBankFees,
    });

    const skippedCount = statement.transactions.length - filteredTransactions.length;
    console.log(`✂️  Filtered to ${filteredTransactions.length} transactions (skipped ${skippedCount})`);

    // Process transactions
    const processed = await this.processTransactions(filteredTransactions);

    // Generate summary
    const result = this.generateResult(processed, statement.transactions.length);

    console.log('✅ Conversion complete');
    console.log(`   Auto-approved: ${result.summary.autoApproved}`);
    console.log(`   Needs review: ${result.summary.needsReview}`);
    console.log(`   Needs manual input: ${result.summary.needsManualInput}`);
    console.log(`   Skipped: ${result.summary.skipped}`);

    return result;
  }

  /**
   * Process transactions using hybrid extraction
   */
  private async processTransactions(
    transactions: XmlTransaction[]
  ): Promise<ProcessedTransaction[]> {
    const processed: ProcessedTransaction[] = [];
    
    // Separate income (positive) and expenses (negative)
    const incomeTransactions = transactions.filter(t => t.value >= 0);
    const expenseTransactions = transactions.filter(t => t.value < 0);

    // Process income transactions (existing logic)
    if (incomeTransactions.length > 0) {
      const incomeProcessed = await this.processIncomeTransactions(incomeTransactions);
      processed.push(...incomeProcessed);
    }

    // Process expense transactions (new logic with contractor matching)
    if (expenseTransactions.length > 0) {
      const expenseProcessed = await this.processExpenseTransactions(expenseTransactions);
      processed.push(...expenseProcessed);
    }

    return processed;
  }

  /**
   * Process income transactions (positive amounts)
   */
  private async processIncomeTransactions(
    transactions: XmlTransaction[]
  ): Promise<ProcessedTransaction[]> {
    const processed: ProcessedTransaction[] = [];
    const needsAI: Array<{ transaction: XmlTransaction; index: number }> = [];

    // Phase 1: Try regex + cache for all transactions
    console.log('🔍 Phase 1: Quick extraction (regex + cache) for income...');
    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      let extracted: ExtractedData | null = null;

      // Try cache first
      if (this.config.useCache) {
        extracted = this.cache.get(transaction.descBase, transaction.descOpt);
        if (extracted) {
          processed.push(this.createProcessedTransaction(transaction, extracted, 'income'));
          continue;
        }
      }

      // Try regex extraction
      if (this.config.useRegexFirst) {
        extracted = this.regexExtractor.extract(transaction);
        if (extracted && extracted.confidence.overall >= 90) {
          // Cache successful regex extraction
          if (this.config.useCache) {
            this.cache.set(transaction.descBase, transaction.descOpt, extracted);
          }
          processed.push(this.createProcessedTransaction(transaction, extracted, 'income'));
          continue;
        }
      }

      // Mark for AI extraction
      needsAI.push({ transaction, index: i });
    }

    console.log(`   ✅ Quick extraction: ${processed.length}/${transactions.length}`);
    console.log(`   🤖 Needs AI: ${needsAI.length}`);

    // Phase 2: AI extraction for remaining transactions
    if (needsAI.length > 0 && this.aiExtractor) {
      console.log('🤖 Phase 2: AI extraction...');
      await this.processWithAI(needsAI, processed);
    } else if (needsAI.length > 0 && !this.aiExtractor) {
      console.warn('⚠️  No AI provider configured, creating low-confidence entries');
      // Create low-confidence entries for transactions that need AI
      for (const { transaction } of needsAI) {
        const extracted: ExtractedData = {
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
          extractionMethod: 'manual',
          warnings: ['No AI provider configured'],
          rawData: {
            descBase: transaction.descBase,
            descOpt: transaction.descOpt,
          },
        };
        processed.push(this.createProcessedTransaction(transaction, extracted, 'income'));
      }
    }

    return processed;
  }

  /**
   * Process expense transactions (negative amounts)
   */
  private async processExpenseTransactions(
    transactions: XmlTransaction[]
  ): Promise<ProcessedTransaction[]> {
    console.log(`💸 Processing ${transactions.length} expense transactions...`);
    const processed: ProcessedTransaction[] = [];
    const needsAI: Array<{ transaction: XmlTransaction; index: number }> = [];

    // Phase 1: Try partial matching for all expenses
    console.log('🔍 Phase 1: Partial matching with contractors...');
    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      
      // Match with contractors
      const matchedContractor = this.contractorMatcher 
        ? this.contractorMatcher.match(transaction)
        : {
            contractor: null,
            confidence: 0,
            matchedIn: 'none' as const,
          };

      // If recognized with high confidence (>= 90%), add to processed
      if (matchedContractor.contractor !== null && matchedContractor.confidence >= 90) {
        const extracted: ExtractedData = {
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
          extractionMethod: 'manual',
          warnings: [],
          rawData: {
            descBase: transaction.descBase,
            descOpt: transaction.descOpt,
          },
        };
        processed.push(this.createProcessedTransaction(transaction, extracted, 'expense', matchedContractor));
      } else {
        // Mark for AI matching
        needsAI.push({ transaction, index: i });
      }
    }

    const matchedCount = processed.length;
    console.log(`   ✅ Partial matching: ${matchedCount}/${transactions.length}`);
    console.log(`   🤖 Needs AI: ${needsAI.length}`);

    // Phase 2: AI matching for remaining expenses
    if (needsAI.length > 0 && this.aiExtractor && this.contractorMatcher) {
      console.log('🤖 Phase 2: AI contractor matching...');
      await this.processExpensesWithAI(needsAI, processed);
    } else if (needsAI.length > 0) {
      console.warn('⚠️  No AI provider configured, creating unrecognized entries');
      // Create entries for unrecognized contractors
      for (const { transaction } of needsAI) {
        const extracted: ExtractedData = {
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
          extractionMethod: 'manual',
          warnings: ['No contractor matched - needs manual assignment'],
          rawData: {
            descBase: transaction.descBase,
            descOpt: transaction.descOpt,
          },
        };
        const unrecognized = {
          contractor: null,
          confidence: 0,
          matchedIn: 'none' as const,
        };
        processed.push(this.createProcessedTransaction(transaction, extracted, 'expense', unrecognized));
      }
    }

    const finalMatchedCount = processed.filter(p => p.matchedContractor?.contractor !== null).length;
    console.log(`   ✅ Total matched contractors: ${finalMatchedCount}/${transactions.length}`);

    return processed;
  }

  /**
   * Process transactions with AI (with batch processing)
   */
  private async processWithAI(
    needsAI: Array<{ transaction: XmlTransaction; index: number }>,
    processed: ProcessedTransaction[]
  ): Promise<void> {
    if (!this.aiExtractor) return;

    const batchSize = this.config.useBatchProcessing ? this.config.batchSize : 1;
    const batches = this.createBatches(needsAI, batchSize);

    console.log(`   Processing ${batches.length} batches (${batchSize} transactions each)...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`   Batch ${i + 1}/${batches.length}...`);

      try {
        const transactions = batch.map((item) => item.transaction);
        const extracted = await this.aiExtractor.extractBatch(transactions);

        // Add to processed and cache
        for (let j = 0; j < batch.length; j++) {
          const { transaction } = batch[j];
          const extractedData = extracted[j];

          // Cache AI extraction
          if (this.config.useCache) {
            this.cache.set(transaction.descBase, transaction.descOpt, extractedData);
          }

          processed.push(this.createProcessedTransaction(transaction, extractedData, 'income'));
        }
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error);
        
        // Add as low-confidence entries
        for (const { transaction } of batch) {
          const extracted: ExtractedData = {
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
            extractionMethod: 'manual',
            warnings: [`AI extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
            rawData: {
              descBase: transaction.descBase,
              descOpt: transaction.descOpt,
            },
          };
          processed.push(this.createProcessedTransaction(transaction, extracted, 'income'));
        }
      }
    }
  }

  /**
   * Process expenses with AI contractor matching (with batch processing)
   */
  private async processExpensesWithAI(
    needsAI: Array<{ transaction: XmlTransaction; index: number }>,
    processed: ProcessedTransaction[]
  ): Promise<void> {
    if (!this.aiExtractor || !this.contractorMatcher) return;

    // Use larger batch size for contractor matching (50 vs 20 for income)
    // Contractor matching is simpler than address extraction
    const batchSize = this.config.useBatchProcessing ? 50 : 1;
    const batches = this.createBatches(needsAI, batchSize);

    console.log(`   Processing ${batches.length} batches (${batchSize} expenses each)...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`   Batch ${i + 1}/${batches.length}...`);

      try {
        const transactions = batch.map((item) => item.transaction);
        
        // 🚀 OPTIMIZATION: Pre-filter contractors for each transaction
        // Instead of sending ALL contractors (e.g., 940), send only top 10 candidates per transaction
        // This reduces input tokens by ~95%!
        const candidatesPerTransaction = transactions.map(t => 
          this.contractorMatcher!.getTopCandidates(t, 10)
        );
        
        // Use AI to match contractors (with pre-filtered candidates)
        const matchedContractors = await this.aiExtractor.matchContractorsBatch(
          transactions, 
          candidatesPerTransaction
        );

        // Add to processed
        for (let j = 0; j < batch.length; j++) {
          const { transaction } = batch[j];
          const matchedContractor = matchedContractors[j];

          const extracted: ExtractedData = {
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
            warnings: matchedContractor.contractor ? [] : ['AI could not match contractor'],
            rawData: {
              descBase: transaction.descBase,
              descOpt: transaction.descOpt,
            },
          };

          processed.push(this.createProcessedTransaction(transaction, extracted, 'expense', matchedContractor));
        }
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error);
        
        // Add as unrecognized entries
        for (const { transaction } of batch) {
          const extracted: ExtractedData = {
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
            extractionMethod: 'manual',
            warnings: [`AI matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
            rawData: {
              descBase: transaction.descBase,
              descOpt: transaction.descOpt,
            },
          };
          const unrecognized = {
            contractor: null,
            confidence: 0,
            matchedIn: 'none' as const,
          };
          processed.push(this.createProcessedTransaction(transaction, extracted, 'expense', unrecognized));
        }
      }
    }
  }

  /**
   * Create batches for batch processing
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Create ProcessedTransaction from extraction result
   */
  private createProcessedTransaction(
    transaction: XmlTransaction,
    extracted: ExtractedData,
    transactionType: 'income' | 'expense',
    matchedContractor?: import('./contractor-matcher').MatchedContractor
  ): ProcessedTransaction {
    const confidence = transactionType === 'income' 
      ? extracted.confidence.overall 
      : (matchedContractor?.confidence || 0);
    
    let status: ProcessedTransaction['status'];

    if (confidence >= this.config.confidenceThresholds.autoApprove) {
      status = 'auto-approved';
    } else if (confidence >= this.config.confidenceThresholds.needsReview) {
      status = 'needs-review';
    } else {
      status = 'needs-manual-input';
    }

    return {
      original: transaction,
      extracted,
      transactionType,
      matchedContractor,
      status,
    };
  }

  /**
   * Generate final import result
   */
  private generateResult(
    processed: ProcessedTransaction[],
    totalTransactions: number
  ): ImportResult {
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

    const totalConfidence = processed.reduce((sum, p) => sum + p.extracted.confidence.overall, 0);
    const averageConfidence = processed.length > 0 ? totalConfidence / processed.length : 0;

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
   * Export transactions to TXT format for accounting system
   */
  exportToCsv(transactions: ProcessedTransaction[]): string {
    const exporter = new CsvExporter({
      separator: '\t',  // TAB separator
      dateFormat: 'D.MM.YYYY',
      decimalSeparator: ',',
    });

    return exporter.export(transactions);
  }

  /**
   * Export auxiliary file with contractor matching details
   */
  exportAuxiliaryFile(transactions: ProcessedTransaction[]): string {
    const exporter = new CsvExporter({
      separator: '\t',
      dateFormat: 'D.MM.YYYY',
      decimalSeparator: ',',
    });

    return exporter.exportAuxiliary(transactions);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

// Export everything
export * from './types';
export { SantanderXmlParser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { AIExtractor } from './ai-extractor';
export { ExtractionCache } from './cache';
export { CsvExporter } from './csv-exporter';
