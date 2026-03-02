import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { app } from 'electron';
import { Converter, TransactionForReview, ConversionReviewData } from '../shared/types';
import { readFileWithEncoding } from '../shared/encoding';
import { SantanderXmlConverter } from '../converters/santander-xml';
import { PKOBPMT940Converter } from '../converters/pko-mt940';
import DatabaseService from './database';
import { conversionCache } from './conversionCache';

export interface ConvertResult {
  success: boolean;
  needsReview?: boolean;
  reviewData?: ConversionReviewData;
  outputPath?: string;
  fileName?: string;
  bankName?: string;
  converterId?: string;
  inputPath?: string;
}

// Database instance will be passed from main.ts
let dbInstance: DatabaseService | null = null;

export function setDatabaseInstance(db: DatabaseService) {
  dbInstance = db;
}

interface AIConfig {
  ai: {
    anthropic_api_key: string;
    openai_api_key: string;
    default_provider: 'anthropic' | 'openai';
  };
}

class ConverterRegistry {
  private converters: Map<string, Converter> = new Map();
  private aiConfig: AIConfig | null = null;

  constructor() {
    this.loadConverters();
    this.loadAIConfig();
  }

  private loadAIConfig() {
    try {
      const appPath = app.getAppPath();
      const configPath = path.join(appPath, 'config', 'ai-config.yml');
      if (fs.existsSync(configPath)) {
        const fileContents = fs.readFileSync(configPath, 'utf8');
        this.aiConfig = yaml.load(fileContents) as AIConfig;
      }
    } catch (error) {
      console.warn('AI config not found or invalid, AI features will be disabled');
    }
  }

  private loadConverters() {
    try {
      // Use app.getAppPath() to get the root directory in both dev and production
      const appPath = app.getAppPath();
      const configPath = path.join(appPath, 'config', 'converters.yml');
      const fileContents = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(fileContents) as { converters: Converter[] };

      config.converters.forEach((converter) => {
        this.converters.set(converter.id, converter);
      });
    } catch (error) {
      console.error('Error loading converters config:', error);
    }
  }

  getAllConverters(): Converter[] {
    return Array.from(this.converters.values());
  }

  getConverter(id: string): Converter | undefined {
    return this.converters.get(id);
  }

  async analyzeWithoutAI(
    converterId: string,
    inputPath: string,
    confidenceThreshold: number = 90,
    adresId?: number | null
  ): Promise<{ totalTransactions: number; lowConfidenceCount: number; averageConfidence: number; needsAI: boolean }> {
    if (converterId === 'santander_xml') {
      // Fetch contractors from database
      const contractors = dbInstance?.getAllKontrahenci() || [];
      
      // Fetch addresses from database
      const addresses = dbInstance?.getAllAdresy() || [];
      
      const converter = new SantanderXmlConverter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: {
          autoApprove: 85,
          needsReview: 60,
        },
        contractors, // Pass contractors for expense matching
        addresses, // Pass addresses for address matching
      });

      const xmlContent = readFileWithEncoding(inputPath);
      const result = await converter.convert(xmlContent);

      // Count only INCOME transactions that will need manual review (< 60%)
      // AI is not used for expenses, so they don't trigger AI modal
      const lowConfidenceIncomeTransactions = result.processed.filter(trn => {
        return trn.transactionType === 'income' && trn.extracted.confidence.overall < 60;
      });

      // But still count all transactions needing review for display purposes
      const allLowConfidence = result.processed.filter(trn => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 60;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 60;
        }
      });

      const incomeCount = result.processed.filter(t => t.transactionType === 'income' && t.extracted.confidence.overall < 60).length;
      const expenseCount = result.processed.filter(t => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 60).length;
      console.log(`[Santander] Total: ${result.processed.length}, All low confidence (<60%): ${allLowConfidence.length} (income: ${incomeCount}, expenses: ${expenseCount}). AI will process: ${lowConfidenceIncomeTransactions.length}`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: allLowConfidence.length, // All transactions needing review
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceIncomeTransactions.length > 0, // Only income triggers AI
      };
    }
    
    if (converterId === 'pko_mt940') {
      // Fetch contractors from database
      const contractors = dbInstance?.getAllKontrahenci() || [];
      
      // Fetch addresses from database
      // If adresId is provided, use only that address; otherwise use all addresses
      let addresses = dbInstance?.getAllAdresy() || [];
      if (adresId !== null && adresId !== undefined) {
        addresses = addresses.filter(a => a.id === adresId);
      }
      
      const converter = new PKOBPMT940Converter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: {
          autoApprove: 85,
          needsReview: 60,
        },
        contractors, // Pass contractors for expense matching
        addresses, // Pass addresses for address matching
      });

      const mt940Content = readFileWithEncoding(inputPath);
      const result = await converter.convert(mt940Content);

      // Count only INCOME transactions that will need manual review (< 60%)
      // AI is not used for expenses, so they don't trigger AI modal
      const lowConfidenceIncomeTransactions = result.processed.filter(trn => {
        return trn.transactionType === 'income' && trn.extracted.confidence.overall < 60;
      });

      // But still count all transactions needing review for display purposes
      const allLowConfidence = result.processed.filter(trn => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 60;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 60;
        }
      });

      const incomeCount = result.processed.filter(t => t.transactionType === 'income' && t.extracted.confidence.overall < 60).length;
      const expenseCount = result.processed.filter(t => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 60).length;
      console.log(`[PKO BP] Total: ${result.processed.length}, All low confidence (<60%): ${allLowConfidence.length} (income: ${incomeCount}, expenses: ${expenseCount}). AI will process: ${lowConfidenceIncomeTransactions.length}`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: allLowConfidence.length, // All transactions needing review
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceIncomeTransactions.length > 0, // Only income triggers AI
      };
    }
    
    throw new Error(`Unknown converter: ${converterId}`);
  }

  /**
   * Extract transactions that need review (confidence < 60%)
   */
  private extractReviewTransactions(
    transactions: any[], // ProcessedTransaction from either converter
    converterId: string
  ): TransactionForReview[] {
    const reviewTransactions: TransactionForReview[] = [];
    
    transactions.forEach((trn, index) => {
      const confidence = trn.transactionType === 'income' 
        ? trn.extracted.confidence.overall 
        : (trn.matchedContractor?.confidence || 0);
      
      // Only include transactions with confidence < 60%
      if (confidence < 60) {
        const review: TransactionForReview = {
          index,
          transactionType: trn.transactionType,
          original: {
            date: converterId === 'santander_xml' ? trn.original.exeDate : trn.original.valueDate,
            amount: converterId === 'santander_xml' ? trn.original.value : trn.original.amount,
            description: converterId === 'santander_xml' 
              ? trn.original.descBase 
              : trn.original.details.description.join(''),
            counterparty: converterId === 'santander_xml' 
              ? trn.original.descOpt 
              : trn.original.details.counterpartyName,
          },
          extracted: {
            apartmentNumber: trn.extracted.apartmentNumber,
            fullAddress: trn.extracted.fullAddress,
            streetName: trn.extracted.streetName,
            buildingNumber: trn.extracted.buildingNumber,
            tenantName: trn.extracted.tenantName,
            confidence,
            reasoning: trn.extracted.reasoning,
          },
        };
        
        // Add contractor info for expenses
        if (trn.transactionType === 'expense' && trn.matchedContractor) {
          review.matchedContractor = {
            contractorName: trn.matchedContractor.contractor?.nazwa || null,
            contractorAccount: trn.matchedContractor.contractor?.kontoKontrahenta || null,
            confidence: trn.matchedContractor.confidence,
          };
        }
        
        reviewTransactions.push(review);
      }
    });
    
    return reviewTransactions;
  }

  /**
   * Apply user review decisions to transactions
   */
  private applyReviewDecisions(
    transactions: any[],
    decisions: import('../shared/types').ReviewDecision[]
  ): any[] {
    const updatedTransactions = [...transactions];
    
    decisions.forEach(decision => {
      const trn = updatedTransactions[decision.index];
      if (!trn) return;
      
      // Store original value for preview
      const originalApartmentNumber = trn.extracted.apartmentNumber;
      
      if (decision.action === 'accept') {
        // User accepts the extracted data
        // If apartmentNumber is null but we have fullAddress, try to extract it
        if (!trn.extracted.apartmentNumber && trn.extracted.fullAddress) {
          // Try to extract apartment number from fullAddress
          // Patterns: "Street 81/48", "Street 81 m. 48", "Street 81 lok. 48", "ZGN"
          const patterns = [
            /\/(\d+)$/,  // "/48" at end
            /m\.?\s*(\d+)$/i,  // "m. 48" or "m.48" at end
            /lok\.?\s*(\d+)$/i,  // "lok. 48" or "lok.48" at end
            /mieszkanie\s*(\d+)$/i,  // "mieszkanie 48" at end
          ];
          
          for (const pattern of patterns) {
            const match = trn.extracted.fullAddress.match(pattern);
            if (match && match[1]) {
              trn.extracted.apartmentNumber = match[1];
              break;
            }
          }
          
          // Special case: "ZGN" in fullAddress
          if (!trn.extracted.apartmentNumber && /zgn/i.test(trn.extracted.fullAddress)) {
            trn.extracted.apartmentNumber = 'ZGN';
          }
        }
        
        // Mark as reviewed by user
        trn.reviewedByUser = {
          action: 'accept',
          originalValue: originalApartmentNumber,
          extractedFrom: 'fullAddress'
        };
      } else if (decision.action === 'reject') {
        // Clear apartmentNumber - mark as unrecognized
        trn.extracted.apartmentNumber = null;
        
        // Mark as reviewed by user
        trn.reviewedByUser = {
          action: 'reject',
          originalValue: originalApartmentNumber
        };
      } else if (decision.action === 'manual' && decision.manualApartmentNumber) {
        // Use user-provided apartmentNumber
        trn.extracted.apartmentNumber = decision.manualApartmentNumber;
        // Boost confidence since user manually entered it
        trn.extracted.confidence.overall = 100;
        trn.extracted.confidence.apartment = 100;
        
        // Mark as reviewed by user
        trn.reviewedByUser = {
          action: 'manual',
          originalValue: originalApartmentNumber,
          manualValue: decision.manualApartmentNumber
        };
      }
    });
    
    return updatedTransactions;
  }

  async convert(
    converterId: string,
    inputPath: string,
    outputPath: string,
    useAI: boolean = false,
    adresId?: number | null,
    fileName?: string,
    bankName?: string
  ): Promise<ConvertResult> {
    return new Promise(async (resolve, reject) => {
      try {
        if (converterId === 'santander_xml') {
          let provider: 'none' | 'anthropic' | 'openai' = 'none';
          let apiKey = '';

          // Use AI if requested and config available
          if (useAI && this.aiConfig) {
            provider = this.aiConfig.ai.default_provider;
            apiKey = provider === 'anthropic' 
              ? this.aiConfig.ai.anthropic_api_key 
              : this.aiConfig.ai.openai_api_key;
          }

          // Fetch contractors from database
          const contractors = dbInstance?.getAllKontrahenci() || [];
          
          // Fetch addresses from database
          // If adresId is provided, use only that address; otherwise use all addresses
          let addresses = dbInstance?.getAllAdresy() || [];
          if (adresId !== null && adresId !== undefined) {
            addresses = addresses.filter(a => a.id === adresId);
          }

          // Use the real Santander XML converter
          const converter = new SantanderXmlConverter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: {
              autoApprove: 85,
              needsReview: 60,
            },
            contractors, // Pass contractors for expense matching
            addresses, // Pass addresses for income address matching
          });

          const xmlContent = readFileWithEncoding(inputPath);
          const result = await converter.convert(xmlContent);

          // Separate transactions into income and expenses
          const incomeTransactions = result.processed.filter(t => t.transactionType === 'income');
          const expenseTransactions = result.processed.filter(t => t.transactionType === 'expense');

          // Format output as text file with transaction details
          let output = '=== SANTANDER XML CONVERSION RESULTS ===\n\n';
          output += `Summary:\n`;
          output += `- Total transactions: ${result.totalTransactions}\n`;
          output += `- Income transactions: ${incomeTransactions.length}\n`;
          output += `- Expense transactions: ${expenseTransactions.length}\n`;
          output += `- Auto-approved: ${result.summary.autoApproved}\n`;
          output += `- Needs review: ${result.summary.needsReview}\n`;
          output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
          output += `- Skipped: ${result.summary.skipped}\n`;
          output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

          // ========== INCOME SECTION ==========
          output += '='.repeat(80) + '\n';
          output += '=== WPŁATY (INCOME) ===\n';
          output += '='.repeat(80) + '\n\n';
          
          incomeTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            // XML Data
            output += `📄 XML DATA:\n`;
            output += `   Transaction Code: ${trn.original.trnCode}\n`;
            output += `   Execution Date:   ${trn.original.exeDate}\n`;
            output += `   Creation Date:    ${trn.original.creatDate}\n`;
            output += `   Amount:           ${trn.original.value} PLN\n`;
            output += `   Account Value:    ${trn.original.accValue} PLN\n`;
            output += `   Real Value:       ${trn.original.realValue} PLN\n\n`;
            
            output += `   Description (base):\n`;
            output += `   ${trn.original.descBase}\n\n`;
            
            output += `   Description (optional):\n`;
            output += `   ${trn.original.descOpt || '(empty)'}\n\n`;
            
            // Extracted Data
            output += `🔍 EXTRACTED DATA:\n`;
            output += `   Apartment:        ${trn.extracted.apartmentNumber || 'NOT FOUND'}\n`;
            output += `   Full Address:     ${trn.extracted.fullAddress || 'NOT FOUND'}\n`;
            output += `   Street Name:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   Building Number:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   Tenant Name:      ${trn.extracted.tenantName || 'N/A'}\n\n`;
            
            // Confidence & Status
            output += `📊 CONFIDENCE & STATUS:\n`;
            output += `   Overall Confidence:    ${trn.extracted.confidence.overall}%\n`;
            output += `   Apartment Confidence:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   Address Confidence:    ${trn.extracted.confidence.address}%\n`;
            output += `   Tenant Confidence:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;
            
            if (trn.extracted.warnings && trn.extracted.warnings.length > 0) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }
            
            // User Review Info (if applicable)
            if (trn.reviewedByUser) {
              output += `\n👤 USER REVIEW:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   Action:                ZAAKCEPTOWANO\n`;
                if (trn.reviewedByUser.extractedFrom) {
                  output += `   Source:                Wyekstrahowano z ${trn.reviewedByUser.extractedFrom}\n`;
                }
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   Action:                ODRZUCONO\n`;
                if (trn.reviewedByUser.originalValue) {
                  output += `   Original Value:        ${trn.reviewedByUser.originalValue}\n`;
                }
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   Action:                WPISANO RĘCZNIE\n`;
                output += `   Manual Value:          ${trn.reviewedByUser.manualValue}\n`;
                if (trn.reviewedByUser.originalValue !== undefined) {
                  output += `   Original Value:        ${trn.reviewedByUser.originalValue || 'NOT FOUND'}\n`;
                }
              }
            }
            
            if (trn.extracted.reasoning) {
              output += `\n   AI Reasoning:\n`;
              output += `   ${trn.extracted.reasoning}\n`;
            }
            
            output += `\n`;
          });

          // ========== EXPENSES SECTION ==========
          output += '='.repeat(80) + '\n';
          output += '=== WYDATKI (EXPENSES) ===\n';
          output += '='.repeat(80) + '\n\n';
          
          expenseTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            // XML Data
            output += `📄 XML DATA:\n`;
            output += `   Transaction Code: ${trn.original.trnCode}\n`;
            output += `   Execution Date:   ${trn.original.exeDate}\n`;
            output += `   Creation Date:    ${trn.original.creatDate}\n`;
            output += `   Amount:           ${trn.original.value} PLN\n`;
            output += `   Account Value:    ${trn.original.accValue} PLN\n`;
            output += `   Real Value:       ${trn.original.realValue} PLN\n\n`;
            
            output += `   Description (base):\n`;
            output += `   ${trn.original.descBase}\n\n`;
            
            output += `   Description (optional):\n`;
            output += `   ${trn.original.descOpt || '(empty)'}\n\n`;
            
            // Matched Contractor Info (for expenses)
            if (trn.matchedContractor) {
              output += `💼 MATCHED CONTRACTOR:\n`;
              if (trn.matchedContractor.contractor) {
                output += `   Contractor Name:       ${trn.matchedContractor.contractor.nazwa}\n`;
                output += `   Contractor Account:    ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
                output += `   Match Confidence:      ${trn.matchedContractor.confidence}%\n`;
                output += `   Matched In:            ${trn.matchedContractor.matchedIn === 'desc-opt' ? 'Description (optional)' : 'Description (base)'}\n`;
                if (trn.matchedContractor.contractor.nip) {
                  output += `   NIP:                   ${trn.matchedContractor.contractor.nip}\n`;
                }
              } else {
                output += `   Status:                No contractor matched - needs manual assignment\n`;
              }
              output += `\n`;
            } else {
              output += `💼 CONTRACTOR:\n`;
              output += `   Status:                No contractor matched - needs manual assignment\n\n`;
            }
            
            // Confidence & Status
            output += `📊 STATUS:\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;
            
            if (trn.extracted.warnings && trn.extracted.warnings.length > 0) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }
            
            output += `\n`;
          });

          // Check if transactions need review
          const reviewTransactions = this.extractReviewTransactions(result.processed, 'santander_xml');
          
          if (reviewTransactions.length > 0) {
            // Store in cache and return review data
            const tempConversionId = conversionCache.store(
              fileName || path.basename(inputPath),
              bankName || 'Santander',
              converterId,
              inputPath,
              outputPath,
              result.processed,
              output
            );
            
            // Get address name from database
            let adresName: string | null = null;
            if (adresId !== null && adresId !== undefined) {
              const adres = dbInstance?.getAdresById(adresId);
              adresName = adres?.nazwa || null;
            }
            
            console.log(`⚠️  ${reviewTransactions.length} transactions need review`);
            
            resolve({
              success: true,
              needsReview: true,
              reviewData: {
                needsReview: true,
                tempConversionId,
                fileName: fileName || path.basename(inputPath),
                bankName: bankName || 'Santander',
                adresId: adresId || null,
                adresName,
                transactions: reviewTransactions,
              },
            });
            return;
          }

          // No review needed - save files normally
          // Change output path to -podglad.txt instead of .txt
          const podgladPath = outputPath.replace(/\.(txt|TXT)$/, '-podglad.txt');
          fs.writeFileSync(podgladPath, output, 'utf8');

          // Generate TXT file for accounting system (tab-separated format)
          const csvOutput = converter.exportToCsv(result.processed);
          const txtPath = outputPath.replace(/\.(txt|TXT)$/, '-accounting.txt');
          fs.writeFileSync(txtPath, csvOutput, 'utf8');
          
          console.log(`✅ Generated preview file: ${podgladPath}`);
          console.log(`✅ Generated accounting file: ${txtPath}`);
          
          resolve({ success: true });
        } else if (converterId === 'pko_mt940') {
          let provider: 'none' | 'anthropic' | 'openai' = 'none';
          let apiKey = '';

          // Use AI if requested and config available
          if (useAI && this.aiConfig) {
            provider = this.aiConfig.ai.default_provider;
            apiKey = provider === 'anthropic' 
              ? this.aiConfig.ai.anthropic_api_key 
              : this.aiConfig.ai.openai_api_key;
          }

          // Fetch contractors from database
          const contractors = dbInstance?.getAllKontrahenci() || [];
          
          // Fetch addresses from database
          // If adresId is provided, use only that address; otherwise use all addresses
          let addresses = dbInstance?.getAllAdresy() || [];
          if (adresId !== null && adresId !== undefined) {
            addresses = addresses.filter(a => a.id === adresId);
          }

          // Use the PKO BP MT940 converter
          const converter = new PKOBPMT940Converter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: {
              autoApprove: 85,
              needsReview: 60,
            },
            contractors, // Pass contractors for expense matching
            addresses, // Pass addresses for income address matching
          });

          const mt940Content = readFileWithEncoding(inputPath);
          const result = await converter.convert(mt940Content);

          // Separate transactions into income and expenses
          const incomeTransactions = result.processed.filter(t => t.transactionType === 'income');
          const expenseTransactions = result.processed.filter(t => t.transactionType === 'expense');

          // Format output as text file with transaction details
          let output = '=== PKO BP MT940 CONVERSION RESULTS ===\n\n';
          output += `Summary:\n`;
          output += `- Total transactions: ${result.totalTransactions}\n`;
          output += `- Income transactions: ${incomeTransactions.length}\n`;
          output += `- Expense transactions: ${expenseTransactions.length}\n`;
          output += `- Auto-approved: ${result.summary.autoApproved}\n`;
          output += `- Needs review: ${result.summary.needsReview}\n`;
          output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
          output += `- Skipped: ${result.summary.skipped}\n`;
          output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

          // ========== INCOME SECTION ==========
          output += '='.repeat(80) + '\n';
          output += '=== WPŁATY (INCOME) ===\n';
          output += '='.repeat(80) + '\n\n';
          
          incomeTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            // MT940 Data
            output += `📄 MT940 DATA:\n`;
            output += `   Value Date:       ${trn.original.valueDate}\n`;
            output += `   Entry Date:       ${trn.original.entryDate}\n`;
            output += `   Transaction Type: ${trn.original.transactionType}\n`;
            output += `   Amount:           ${trn.original.amount} PLN\n`;
            output += `   Reference:        ${trn.original.reference}\n\n`;
            
            output += `   Description:\n`;
            output += `   ${trn.original.details.description.join(' ')}\n\n`;
            
            output += `   Counterparty:\n`;
            output += `   ${trn.original.details.counterpartyName}\n`;
            output += `   IBAN: ${trn.original.details.counterpartyIBAN}\n\n`;
            
            // Extracted Data
            output += `🔍 EXTRACTED DATA:\n`;
            output += `   Apartment:        ${trn.extracted.apartmentNumber || 'NOT FOUND'}\n`;
            output += `   Full Address:     ${trn.extracted.fullAddress || 'NOT FOUND'}\n`;
            output += `   Street Name:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   Building Number:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   Tenant Name:      ${trn.extracted.tenantName || 'N/A'}\n\n`;
            
            // Confidence & Status
            output += `📊 CONFIDENCE & STATUS:\n`;
            output += `   Overall Confidence:    ${trn.extracted.confidence.overall}%\n`;
            output += `   Apartment Confidence:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   Address Confidence:    ${trn.extracted.confidence.address}%\n`;
            output += `   Tenant Confidence:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;
            
            if (trn.extracted.warnings && trn.extracted.warnings.length > 0) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }
            
            // User Review Info (if applicable)
            if (trn.reviewedByUser) {
              output += `\n👤 USER REVIEW:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   Action:                ZAAKCEPTOWANO\n`;
                if (trn.reviewedByUser.extractedFrom) {
                  output += `   Source:                Wyekstrahowano z ${trn.reviewedByUser.extractedFrom}\n`;
                }
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   Action:                ODRZUCONO\n`;
                if (trn.reviewedByUser.originalValue) {
                  output += `   Original Value:        ${trn.reviewedByUser.originalValue}\n`;
                }
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   Action:                WPISANO RĘCZNIE\n`;
                output += `   Manual Value:          ${trn.reviewedByUser.manualValue}\n`;
                if (trn.reviewedByUser.originalValue !== undefined) {
                  output += `   Original Value:        ${trn.reviewedByUser.originalValue || 'NOT FOUND'}\n`;
                }
              }
            }
            
            if (trn.extracted.reasoning) {
              output += `\n   AI Reasoning:\n`;
              output += `   ${trn.extracted.reasoning}\n`;
            }
            
            output += `\n`;
          });

          // ========== EXPENSES SECTION ==========
          output += '='.repeat(80) + '\n';
          output += '=== WYDATKI (EXPENSES) ===\n';
          output += '='.repeat(80) + '\n\n';
          
          expenseTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            // MT940 Data
            output += `📄 MT940 DATA:\n`;
            output += `   Value Date:       ${trn.original.valueDate}\n`;
            output += `   Entry Date:       ${trn.original.entryDate}\n`;
            output += `   Transaction Type: ${trn.original.transactionType}\n`;
            output += `   Amount:           ${trn.original.amount} PLN\n`;
            output += `   Reference:        ${trn.original.reference}\n\n`;
            
            output += `   Description:\n`;
            output += `   ${trn.original.details.description.join(' ')}\n\n`;
            
            output += `   Counterparty:\n`;
            output += `   ${trn.original.details.counterpartyName}\n`;
            output += `   IBAN: ${trn.original.details.counterpartyIBAN}\n\n`;
            
            // Matched Contractor Info (for expenses)
            if (trn.matchedContractor) {
              output += `💼 MATCHED CONTRACTOR:\n`;
              if (trn.matchedContractor.contractor) {
                output += `   Contractor Name:       ${trn.matchedContractor.contractor.nazwa}\n`;
                output += `   Contractor Account:    ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
                output += `   Match Confidence:      ${trn.matchedContractor.confidence}%\n`;
                output += `   Matched In:            ${trn.matchedContractor.matchedIn === 'desc-opt' ? 'Counterparty name' : 'Description'}\n`;
                if (trn.matchedContractor.contractor.nip) {
                  output += `   NIP:                   ${trn.matchedContractor.contractor.nip}\n`;
                }
              } else {
                output += `   Status:                No contractor matched - needs manual assignment\n`;
              }
              output += `\n`;
            } else {
              output += `💼 CONTRACTOR:\n`;
              output += `   Status:                No contractor matched - needs manual assignment\n\n`;
            }
            
            // Confidence & Status
            output += `📊 STATUS:\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;
            
            if (trn.extracted.warnings && trn.extracted.warnings.length > 0) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }
            
            output += `\n`;
          });

          // Check if transactions need review
          const reviewTransactions = this.extractReviewTransactions(result.processed, 'pko_mt940');
          
          if (reviewTransactions.length > 0) {
            // Store in cache and return review data
            const tempConversionId = conversionCache.store(
              fileName || path.basename(inputPath),
              bankName || 'PKO BP',
              converterId,
              inputPath,
              outputPath,
              result.processed,
              output
            );
            
            // Get address name from database
            let adresName: string | null = null;
            if (adresId !== null && adresId !== undefined) {
              const adres = dbInstance?.getAdresById(adresId);
              adresName = adres?.nazwa || null;
            }
            
            console.log(`⚠️  ${reviewTransactions.length} transactions need review`);
            
            resolve({
              success: true,
              needsReview: true,
              reviewData: {
                needsReview: true,
                tempConversionId,
                fileName: fileName || path.basename(inputPath),
                bankName: bankName || 'PKO BP',
                adresId: adresId || null,
                adresName,
                transactions: reviewTransactions,
              },
            });
            return;
          }

          // No review needed - save files normally
          // Change output path to -podglad.txt instead of .txt
          const podgladPath = outputPath.replace(/\.(txt|TXT)$/, '-podglad.txt');
          fs.writeFileSync(podgladPath, output, 'utf8');

          // Generate TXT file for accounting system (tab-separated format)
          const csvOutput = converter.exportToCsv(result.processed);
          const txtPath = outputPath.replace(/\.(txt|TXT)$/, '-accounting.txt');
          fs.writeFileSync(txtPath, csvOutput, 'utf8');
          
          console.log(`✅ Generated preview file: ${podgladPath}`);
          console.log(`✅ Generated accounting file: ${txtPath}`);
          
          resolve({ success: true });
        } else {
          throw new Error(`Unknown converter: ${converterId}`);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Finalize conversion after user review
   */
  async finalizeConversion(
    tempConversionId: string,
    decisions: import('../shared/types').ReviewDecision[]
  ): Promise<ConvertResult> {
    try {
      // Retrieve cached conversion
      const cached = conversionCache.get(tempConversionId);
      
      if (!cached) {
        throw new Error('Conversion not found or expired. Please try again.');
      }
      
      // Apply user decisions to transactions
      const updatedTransactions = this.applyReviewDecisions(cached.processedTransactions, decisions);
      
      // Now generate files with updated transactions
      const converter = cached.converterId === 'santander_xml' 
        ? new SantanderXmlConverter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 60 },
            contractors: [],
            addresses: [],
          })
        : new PKOBPMT940Converter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 60 },
            contractors: [],
            addresses: [],
          });
      
      // Generate accounting file
      const csvOutput = converter.exportToCsv(updatedTransactions);
      const txtPath = cached.outputPath.replace(/\.(txt|TXT)$/, '-accounting.txt');
      fs.writeFileSync(txtPath, csvOutput, 'utf8');
      
      // Generate updated preview file with user review information
      const podgladPath = cached.outputPath.replace(/\.(txt|TXT)$/, '-podglad.txt');
      
      // Start with cached preview and add user review summary
      let newPreviewOutput = cached.previewOutput;
      
      // Add user review summary at the end
      const reviewedTransactions = updatedTransactions.filter((t: any) => t.reviewedByUser);
      
      if (reviewedTransactions.length > 0) {
        newPreviewOutput += `\n\n`;
        newPreviewOutput += '='.repeat(80) + '\n';
        newPreviewOutput += '=== 👤 USER REVIEW SUMMARY ===\n';
        newPreviewOutput += '='.repeat(80) + '\n\n';
        
        newPreviewOutput += `Total reviewed transactions: ${reviewedTransactions.length}\n\n`;
        
        reviewedTransactions.forEach((trn: any, idx: number) => {
          const transactionIndex = updatedTransactions.indexOf(trn) + 1;
          newPreviewOutput += `Transaction #${transactionIndex}:\n`;
          
          if (trn.reviewedByUser.action === 'accept') {
            newPreviewOutput += `  ✅ ZAAKCEPTOWANO\n`;
            if (trn.reviewedByUser.extractedFrom) {
              newPreviewOutput += `     Apartment number wyekstrahowany z: ${trn.reviewedByUser.extractedFrom}\n`;
            }
            newPreviewOutput += `     Final value: ${trn.extracted.apartmentNumber}\n`;
          } else if (trn.reviewedByUser.action === 'reject') {
            newPreviewOutput += `  ❌ ODRZUCONO\n`;
            if (trn.reviewedByUser.originalValue) {
              newPreviewOutput += `     Original value: ${trn.reviewedByUser.originalValue}\n`;
            }
            newPreviewOutput += `     Final value: NOT RECOGNIZED\n`;
          } else if (trn.reviewedByUser.action === 'manual') {
            newPreviewOutput += `  ✏️  WPISANO RĘCZNIE\n`;
            if (trn.reviewedByUser.originalValue !== undefined) {
              newPreviewOutput += `     Original value: ${trn.reviewedByUser.originalValue || 'NOT FOUND'}\n`;
            }
            newPreviewOutput += `     Manual value: ${trn.reviewedByUser.manualValue}\n`;
            newPreviewOutput += `     Final value: ${trn.extracted.apartmentNumber}\n`;
          }
          
          newPreviewOutput += `\n`;
        });
      }
      
      fs.writeFileSync(podgladPath, newPreviewOutput, 'utf8');
      
      console.log(`✅ Generated preview file with user review info: ${podgladPath}`);
      console.log(`✅ Generated accounting file: ${txtPath}`);
      
      // Clean up cache
      conversionCache.remove(tempConversionId);
      
      return { 
        success: true, 
        outputPath: cached.outputPath,
        fileName: cached.fileName,
        bankName: cached.bankName,
        converterId: cached.converterId,
        inputPath: cached.inputPath,
      };
    } catch (error) {
      throw error;
    }
  }
}

export default ConverterRegistry;
