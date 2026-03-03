/**
 * PKO BP MT940 Converter
 * Main orchestrator for MT940 bank statement processing
 */

import { PKOBPMT940Parser } from './parser';
import { RegexExtractor } from './regex-extractor';
import { AIExtractor } from '../../shared/ai-extractor';
import { ExtractionCache } from '../../shared/extraction-cache';
import { CsvExporter } from './csv-exporter';
import { ContractorMatcher } from '../../shared/contractor-matcher';
import {
  MT940Statement,
  MT940Transaction,
  ProcessedTransaction,
  ImportResult,
  ConverterConfig,
  ExtractedData,
} from './types';

/**
 * Check if error is a billing/quota error that should stop processing
 */
function isBillingError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error.message || '';
  
  // Check for our custom billing error message
  if (errorMessage.includes('💸')) return true;
  
  // Check for quota/billing keywords
  if (errorMessage.toLowerCase().includes('quota') || 
      errorMessage.toLowerCase().includes('billing') ||
      errorMessage.toLowerCase().includes('payment required')) {
    return true;
  }
  
  // Check for API error status codes
  if (error.status === 402 || error.status === 429) return true;
  
  return false;
}

export class PKOBPMT940Converter {
  private parser: PKOBPMT940Parser;
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
      skipNegativeAmounts: config.skipNegativeAmounts ?? false,
      skipBankFees: config.skipBankFees ?? true,
      contractors: config.contractors,
      addresses: config.addresses,
      language: config.language,
    };

    this.parser = new PKOBPMT940Parser();
    this.regexExtractor = new RegexExtractor(this.config.addresses || []);
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
   * Convert MT940 file
   */
  async convert(mt940Content: string): Promise<ImportResult> {
    console.log('🔄 Starting PKO BP MT940 conversion...');

    // Parse MT940
    const statement = this.parser.parse(mt940Content);
    console.log(`📄 Parsed ${statement.transactions.length} transactions`);
    console.log(`   Opening balance: ${statement.openingBalance.amount} ${statement.openingBalance.debitCredit}`);
    console.log(`   Closing balance: ${statement.closingBalance.amount} ${statement.closingBalance.debitCredit}`);

    // Filter transactions (skip bank fees, etc.)
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
    transactions: MT940Transaction[]
  ): Promise<ProcessedTransaction[]> {
    const processed: ProcessedTransaction[] = [];
    
    // Separate income (credit) and expenses (debit)
    const incomeTransactions = transactions.filter(t => t.debitCredit === 'C');
    const expenseTransactions = transactions.filter(t => t.debitCredit === 'D');

    // Process income transactions
    if (incomeTransactions.length > 0) {
      const incomeProcessed = await this.processIncomeTransactions(incomeTransactions);
      processed.push(...incomeProcessed);
    }

    // Process expense transactions
    if (expenseTransactions.length > 0) {
      const expenseProcessed = await this.processExpenseTransactions(expenseTransactions);
      processed.push(...expenseProcessed);
    }

    return processed;
  }

  /**
   * Process income transactions (credit)
   */
  private async processIncomeTransactions(
    transactions: MT940Transaction[]
  ): Promise<ProcessedTransaction[]> {
    const processed: ProcessedTransaction[] = [];
    const needsAI: Array<{ transaction: MT940Transaction; index: number }> = [];

    // Phase 1: Try regex + cache for all transactions
    console.log('🔍 Phase 1: Quick extraction (regex + cache) for income...');
    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      let extracted: ExtractedData | null = null;

      // Try regex extraction
      if (this.config.useRegexFirst) {
        extracted = this.regexExtractor.extract(transaction);
        if (extracted && extracted.confidence.overall >= this.config.confidenceThresholds.autoApprove) {
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
            description: transaction.details.description.join(''),
            counterpartyName: transaction.details.counterpartyName,
            counterpartyIBAN: transaction.details.counterpartyIBAN,
          },
        };
        processed.push(this.createProcessedTransaction(transaction, extracted, 'income'));
      }
    }

    return processed;
  }

  /**
   * Process expense transactions (debit)
   */
  private async processExpenseTransactions(
    transactions: MT940Transaction[]
  ): Promise<ProcessedTransaction[]> {
    console.log(`💸 Processing ${transactions.length} expense transactions...`);
    const processed: ProcessedTransaction[] = [];
    const needsAI: Array<{ transaction: MT940Transaction; index: number }> = [];

    // Phase 1: Try partial matching for all expenses
    console.log('🔍 Phase 1: Partial matching with contractors...');
    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      
      // Convert MT940Transaction to a format that contractor matcher can use
      const transactionForMatcher = {
        descBase: transaction.details.description.join(''),
        descOpt: transaction.details.counterpartyName,
        trnCode: transaction.transactionType,
        exeDate: transaction.valueDate,
        creatDate: transaction.entryDate,
        value: -transaction.amount, // negative for expenses
        accValue: -transaction.amount,
        realValue: -transaction.amount,
      };
      
      // Match with contractors
      const matchedContractor = this.contractorMatcher 
        ? this.contractorMatcher.match(transactionForMatcher)
        : {
            contractor: null,
            confidence: 0,
            matchedIn: 'none' as const,
          };

      // If recognized with ANY confidence, add to processed (regex is reliable)
      // Only send to AI if NO match found (confidence = 0)
      if (matchedContractor.contractor !== null && matchedContractor.confidence > 0) {
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
          extractionMethod: matchedContractor.confidence >= 90 ? 'manual' : 'regex',
          warnings: matchedContractor.confidence < 60 ? ['Low confidence match - may need review'] : [],
          rawData: {
            description: transaction.details.description.join(''),
            counterpartyName: transaction.details.counterpartyName,
            counterpartyIBAN: transaction.details.counterpartyIBAN,
          },
        };
        processed.push(this.createProcessedTransaction(transaction, extracted, 'expense', matchedContractor));
      } else {
        // Mark for AI matching - ONLY if regex found nothing
        needsAI.push({ transaction, index: i });
      }
    }

    const matchedCount = processed.length;
    console.log(`   ✅ Partial matching: ${matchedCount}/${transactions.length}`);
    console.log(`   🤖 Needs AI: ${needsAI.length}`);

    // Phase 2: AI matching for remaining expenses
    if (needsAI.length > 0) {
      await this.processExpensesWithAI(needsAI, processed);
    }

    const finalMatchedCount = processed.filter(p => p.matchedContractor?.contractor !== null).length;
    console.log(`   ✅ Total matched contractors: ${finalMatchedCount}/${transactions.length}`);

    return processed;
  }

  /**
   * Process transactions with AI (with batch processing)
   */
  private async processWithAI(
    needsAI: Array<{ transaction: MT940Transaction; index: number }>,
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
        // Convert MT940 transactions to format AI extractor expects
        const transactionsForAI = batch.map((item) => ({
          descBase: item.transaction.details.description.join(''),
          descOpt: item.transaction.details.counterpartyName,
          exeDate: item.transaction.valueDate,
          value: item.transaction.amount,
          trnCode: item.transaction.transactionType,
          creatDate: item.transaction.entryDate,
          accValue: item.transaction.amount,
          realValue: item.transaction.amount,
        }));
        
        const extracted = await this.aiExtractor.extractBatch(transactionsForAI);

        // Add to processed
        for (let j = 0; j < batch.length; j++) {
          const { transaction } = batch[j];
          // Convert the extracted data from santander format to MT940 format
          const santanderExtracted = extracted[j];
          const extractedData: ExtractedData = {
            ...santanderExtracted,
            rawData: {
              description: transaction.details.description.join(''),
              counterpartyName: transaction.details.counterpartyName,
              counterpartyIBAN: transaction.details.counterpartyIBAN,
            },
          };

          processed.push(this.createProcessedTransaction(transaction, extractedData, 'income'));
        }
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error);
        
        // For ANY AI error (billing or general), re-throw to trigger fallback in main.ts
        // Main.ts will attempt standard conversion without AI and show warning to user
        throw error;
      }
    }
  }

  /**
   * Process expenses with AI contractor matching (with batch processing)
   */
  private async processExpensesWithAI(
    needsAI: Array<{ transaction: MT940Transaction; index: number }>,
    processed: ProcessedTransaction[]
  ): Promise<void> {
    // If AI is not available, add all as unrecognized
    if (!this.aiExtractor || !this.contractorMatcher) {
      console.warn('   ⚠️  AI not available, marking expenses as unrecognized');
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
            description: transaction.details.description.join(''),
            counterpartyName: transaction.details.counterpartyName,
            counterpartyIBAN: transaction.details.counterpartyIBAN,
          },
        };
        const unrecognized = {
          contractor: null,
          confidence: 0,
          matchedIn: 'none' as const,
        };
        processed.push(this.createProcessedTransaction(transaction, extracted, 'expense', unrecognized));
      }
      return;
    }

    const batchSize = this.config.useBatchProcessing ? 50 : 1;
    const batches = this.createBatches(needsAI, batchSize);

    console.log(`   Processing ${batches.length} batches (${batchSize} expenses each)...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`   Batch ${i + 1}/${batches.length}...`);

      try {
        // Convert MT940 transactions to format AI extractor expects
        const transactionsForAI = batch.map((item) => ({
          descBase: item.transaction.details.description.join(''),
          descOpt: item.transaction.details.counterpartyName,
          exeDate: item.transaction.valueDate,
          value: item.transaction.amount,
          trnCode: item.transaction.transactionType,
          creatDate: item.transaction.entryDate,
          accValue: item.transaction.amount,
          realValue: item.transaction.amount,
        }));
        
        const candidatesPerTransaction = transactionsForAI.map(t => 
          this.contractorMatcher!.getTopCandidates(t, 10)
        );
        
        const matchedContractors = await this.aiExtractor.matchContractorsBatch(
          transactionsForAI, 
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
            reasoning: matchedContractor.reasoning, // Copy AI reasoning for display
            warnings: matchedContractor.contractor ? [] : ['AI could not match contractor'],
            rawData: {
              description: transaction.details.description.join(''),
              counterpartyName: transaction.details.counterpartyName,
              counterpartyIBAN: transaction.details.counterpartyIBAN,
            },
          };

          processed.push(this.createProcessedTransaction(transaction, extracted, 'expense', matchedContractor));
        }
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error);
        
        // For ANY AI error (billing or general), re-throw to trigger fallback in main.ts
        // Main.ts will attempt standard conversion without AI and show warning to user
        throw error;
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
    transaction: MT940Transaction,
    extracted: ExtractedData,
    transactionType: 'income' | 'expense',
    matchedContractor?: import('../../shared/contractor-matcher').MatchedContractor
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

    const totalConfidence = processed.reduce((sum, p) => {
      if (p.transactionType === 'income') {
        return sum + p.extracted.confidence.overall;
      } else {
        return sum + (p.matchedContractor?.confidence || 0);
      }
    }, 0);
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
   * Export preview file with transaction details and matching information
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
export { PKOBPMT940Parser } from './parser';
export { RegexExtractor } from './regex-extractor';
export { CsvExporter } from './csv-exporter';
