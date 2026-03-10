import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { app } from 'electron';
import { Converter, TransactionForReview, ConversionReviewData } from '../shared/types';
import { readFileWithEncoding } from '../shared/encoding';
import { SantanderXmlConverter } from '../converters/santander-xml';
import { PKOBPMT940Converter } from '../converters/pko-mt940';
import { BnpXmlConverter } from '../converters/bnp-xml';
import { AliorConverter } from '../converters/alior';
import { PKOBiznesConverter } from '../converters/pko-biznes';
import { PKOSAConverter } from '../converters/pko-sa';
import { INGConverter } from '../converters/ing';
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
  warningMessage?: string;
  error?: string;
}

// Database instance will be passed from main.ts
let dbInstance: DatabaseService | null = null;

export function setDatabaseInstance(db: DatabaseService) {
  dbInstance = db;
}

/**
 * Helper function to save accounting file to IMPEX folder if configured
 */
function saveToImpexFolder(accountingFilePath: string, csvOutput: string): void {
  if (!dbInstance) return;
  
  const impexFolder = dbInstance.getSetting('impexFolder');
  if (!impexFolder) return; // IMPEX folder not configured
  
  try {
    // Ensure IMPEX folder exists
    if (!fs.existsSync(impexFolder)) {
      fs.mkdirSync(impexFolder, { recursive: true });
    }
    
    // Get just the filename from the accounting file path
    const fileName = path.basename(accountingFilePath);
    
    // Write the file to IMPEX folder
    const impexFilePath = path.join(impexFolder, fileName);
    fs.writeFileSync(impexFilePath, csvOutput, 'utf8');
    
    console.log(`✅ Saved accounting file to IMPEX folder: ${impexFilePath}`);
  } catch (error) {
    console.error('Error saving to IMPEX folder:', error);
    // Don't throw - IMPEX is optional, main file save is more important
  }
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
      // Priority 1: Try to load from bundled config file (works in both dev and production)
      const appPath = app.getAppPath();
      const configPath = path.join(appPath, 'config', 'ai-config.yml');
      
      if (fs.existsSync(configPath)) {
        const fileContents = fs.readFileSync(configPath, 'utf8');
        this.aiConfig = yaml.load(fileContents) as AIConfig;
        console.log('[AI Config] Loaded from bundled config:', configPath);
        return;
      }
      
      // Priority 2: Try environment variables (useful for deployment)
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      const openaiKey = process.env.OPENAI_API_KEY;
      
      if (anthropicKey || openaiKey) {
        this.aiConfig = {
          ai: {
            anthropic_api_key: anthropicKey || '',
            openai_api_key: openaiKey || '',
            default_provider: anthropicKey ? 'anthropic' : 'openai',
          }
        };
        console.log('[AI Config] Loaded from environment variables');
        return;
      }
      
      console.warn('[AI Config] No configuration found. AI features will be disabled.');
      console.warn('[AI Config] To enable AI:');
      console.warn('[AI Config]   1. Add config/ai-config.yml with your API keys, or');
      console.warn('[AI Config]   2. Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable');
    } catch (error) {
      console.error('[AI Config] Error loading configuration:', error);
      console.warn('[AI Config] AI features will be disabled');
    }
  }

  private loadConverters() {
    try {
      // Use app.getAppPath() to get the root directory in both dev and production
      const appPath = app.getAppPath();
      const configPath = path.join(appPath, 'config', 'converters.yml');
      
      console.log('[ConverterRegistry] Loading converters from:', configPath);
      
      if (!fs.existsSync(configPath)) {
        console.error('[ConverterRegistry] Config file not found:', configPath);
        throw new Error(`Converters config file not found at: ${configPath}`);
      }
      
      const fileContents = fs.readFileSync(configPath, 'utf8');
      const config = yaml.load(fileContents) as { converters: Converter[] };

      if (!config || !config.converters || !Array.isArray(config.converters)) {
        console.error('[ConverterRegistry] Invalid config structure');
        throw new Error('Invalid converters config structure');
      }

      config.converters.forEach((converter) => {
        this.converters.set(converter.id, converter);
        console.log('[ConverterRegistry] Loaded converter:', converter.id, '-', converter.name);
      });
      
      console.log(`[ConverterRegistry] Successfully loaded ${this.converters.size} converters`);
    } catch (error) {
      console.error('[ConverterRegistry] Error loading converters config:', error);
      // Re-throw to make it visible that converters failed to load
      throw error;
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
      
      // Get app language
      const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';
      
      const converter = new SantanderXmlConverter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: {
          autoApprove: 85,
          needsReview: 70,
        },
        contractors, // Pass contractors for expense matching
        addresses, // Pass addresses for address matching
        language,
      });

      const xmlContent = readFileWithEncoding(inputPath);
      const result = await converter.convert(xmlContent);

      // Count all transactions that will need AI (both income and expenses < 70%)
      const lowConfidenceTransactions = result.processed.filter(trn => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 70;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 70;
        }
      });

      const incomeCount = result.processed.filter(t => t.transactionType === 'income' && t.extracted.confidence.overall < 70).length;
      const expenseCount = result.processed.filter(t => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 70).length;
      console.log(`[Santander] Total: ${result.processed.length}, Low confidence (<70%): ${lowConfidenceTransactions.length} (income: ${incomeCount}, expenses: ${expenseCount})`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: lowConfidenceTransactions.length,
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceTransactions.length > 0, // Both income and expenses trigger AI
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
      
      // Get app language
      const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';
      
      const converter = new PKOBPMT940Converter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: {
          autoApprove: 85,
          needsReview: 70,
        },
        contractors, // Pass contractors for expense matching
        addresses, // Pass addresses for address matching
        language,
      });

      const mt940Content = readFileWithEncoding(inputPath);
      const result = await converter.convert(mt940Content);

      // Count all transactions that will need AI (both income and expenses < 70%)
      const lowConfidenceTransactions = result.processed.filter(trn => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 70;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 70;
        }
      });

      const incomeCount = result.processed.filter(t => t.transactionType === 'income' && t.extracted.confidence.overall < 70).length;
      const expenseCount = result.processed.filter(t => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 70).length;
      console.log(`[PKO BP] Total: ${result.processed.length}, Low confidence (<70%): ${lowConfidenceTransactions.length} (income: ${incomeCount}, expenses: ${expenseCount})`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: lowConfidenceTransactions.length,
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceTransactions.length > 0, // Both income and expenses trigger AI
      };
    }

    if (converterId === 'bnp_xml') {
      const contractors = dbInstance?.getAllKontrahenci() || [];
      let addresses = dbInstance?.getAllAdresy() || [];
      if (adresId !== null && adresId !== undefined) {
        addresses = addresses.filter(a => a.id === adresId);
      }
      const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

      const converter = new BnpXmlConverter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: { autoApprove: 85, needsReview: 70 },
        contractors,
        addresses,
        language,
      });

      const xmlContent = readFileWithEncoding(inputPath);
      const result = await converter.convert(xmlContent);

      const lowConfidenceTransactions = result.processed.filter(trn => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 70;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 70;
        }
      });

      const incomeCount = result.processed.filter(t => t.transactionType === 'income' && t.extracted.confidence.overall < 70).length;
      const expenseCount = result.processed.filter(t => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 70).length;
      console.log(`[BNP] Total: ${result.processed.length}, Low confidence (<70%): ${lowConfidenceTransactions.length} (income: ${incomeCount}, expenses: ${expenseCount})`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: lowConfidenceTransactions.length,
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceTransactions.length > 0,
      };
    }

    if (converterId === 'alior') {
      const contractors = dbInstance?.getAllKontrahenci() || [];
      let addresses = dbInstance?.getAllAdresy() || [];
      if (adresId !== null && adresId !== undefined) {
        addresses = addresses.filter(a => a.id === adresId);
      }
      const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

      const converter = new AliorConverter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: { autoApprove: 85, needsReview: 70 },
        contractors,
        addresses,
        language,
      });

      const mt940Content = readFileWithEncoding(inputPath);
      const result = await converter.convert(mt940Content);

      const lowConfidenceTransactions = result.processed.filter(trn => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 70;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 70;
        }
      });

      const incomeCount = result.processed.filter(t => t.transactionType === 'income' && t.extracted.confidence.overall < 70).length;
      const expenseCount = result.processed.filter(t => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 70).length;
      console.log(`[Alior] Total: ${result.processed.length}, Low confidence (<70%): ${lowConfidenceTransactions.length} (income: ${incomeCount}, expenses: ${expenseCount})`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: lowConfidenceTransactions.length,
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceTransactions.length > 0,
      };
    }

    if (converterId === 'pko_biznes') {
      const contractors = dbInstance?.getAllKontrahenci() || [];
      let addresses = dbInstance?.getAllAdresy() || [];
      if (adresId !== null && adresId !== undefined) {
        addresses = addresses.filter(a => a.id === adresId);
      }
      const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

      const converter = new PKOBiznesConverter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: { autoApprove: 85, needsReview: 70 },
        contractors,
        addresses,
        language,
      });

      const zipBuffer = fs.readFileSync(inputPath);
      const result = await converter.convert(zipBuffer);

      const lowConfidenceTransactions = result.processed.filter((trn: any) => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 70;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 70;
        }
      });

      const incomeCount = result.processed.filter((t: any) => t.transactionType === 'income' && t.extracted.confidence.overall < 70).length;
      const expenseCount = result.processed.filter((t: any) => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 70).length;
      console.log(`[PKO Biznes] Total: ${result.processed.length}, Low confidence (<70%): ${lowConfidenceTransactions.length} (income: ${incomeCount}, expenses: ${expenseCount})`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: lowConfidenceTransactions.length,
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceTransactions.length > 0,
      };
    }

    if (converterId === 'pko_sa') {
      const contractors = dbInstance?.getAllKontrahenci() || [];
      let addresses = dbInstance?.getAllAdresy() || [];
      if (adresId !== null && adresId !== undefined) {
        addresses = addresses.filter(a => a.id === adresId);
      }
      const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

      const converter = new PKOSAConverter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: { autoApprove: 85, needsReview: 70 },
        contractors,
        addresses,
        language,
      });

      const expContent = readFileWithEncoding(inputPath);
      const result = await converter.convert(expContent);

      const lowConfidenceTransactions = result.processed.filter((trn: any) => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 70;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 70;
        }
      });

      const incomeCount = result.processed.filter((t: any) => t.transactionType === 'income' && t.extracted.confidence.overall < 70).length;
      const expenseCount = result.processed.filter((t: any) => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 70).length;
      console.log(`[PKO SA] Total: ${result.processed.length}, Low confidence (<70%): ${lowConfidenceTransactions.length} (income: ${incomeCount}, expenses: ${expenseCount})`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: lowConfidenceTransactions.length,
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceTransactions.length > 0,
      };
    }

    if (converterId === 'ing') {
      const contractors = dbInstance?.getAllKontrahenci() || [];
      let addresses = dbInstance?.getAllAdresy() || [];
      if (adresId !== null && adresId !== undefined) {
        addresses = addresses.filter(a => a.id === adresId);
      }
      const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

      const converter = new INGConverter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: { autoApprove: 85, needsReview: 70 },
        contractors,
        addresses,
        language,
      });

      const mt940Content = readFileWithEncoding(inputPath, 'cp852');
      const result = await converter.convert(mt940Content);

      const lowConfidenceTransactions = result.processed.filter(trn => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < 70;
        } else {
          return (trn.matchedContractor?.confidence || 0) < 70;
        }
      });

      const incomeCount = result.processed.filter(t => t.transactionType === 'income' && t.extracted.confidence.overall < 70).length;
      const expenseCount = result.processed.filter(t => t.transactionType === 'expense' && (t.matchedContractor?.confidence || 0) < 70).length;
      console.log(`[ING] Total: ${result.processed.length}, Low confidence (<70%): ${lowConfidenceTransactions.length} (income: ${incomeCount}, expenses: ${expenseCount})`);

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: lowConfidenceTransactions.length,
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceTransactions.length > 0,
      };
    }
    
    throw new Error(`Unknown converter: ${converterId}`);
  }

  /**
   * Extract transactions that need review (confidence < 70%)
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
      
      // Include in review if:
      // 1. Confidence below threshold (<70%), OR
      // 2. Income transaction without apartment number (regardless of confidence)
      const needsReview = confidence < 70 
        || (trn.transactionType === 'income' && !trn.extracted.apartmentNumber);
      
      if (needsReview) {
        // For Santander, use 'value' (transaction amount) not 'realValue' (account balance)
        // For other converters, 'realValue' is the absolute transaction amount
        const amount = converterId === 'santander_xml' 
          ? Math.abs(trn.normalized.value)
          : trn.normalized.realValue;
        
        const review: TransactionForReview = {
          index,
          transactionType: trn.transactionType,
          original: {
            date: trn.normalized.exeDate,
            amount: amount,
            description: trn.normalized.descBase,
            counterparty: trn.normalized.descOpt,
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
    decisions: import('../shared/types').ReviewDecision[],
    contractors: import('../shared/types').Kontrahent[]
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
      } else if (decision.action === 'manual') {
        if (decision.manualRemainingIncomeId) {
          // Use user-selected "Pozostałe przychody" entry (for income)
          const selectedEntry = contractors.find(k => k.id === decision.manualRemainingIncomeId);
          if (selectedEntry) {
            // Set apartment number to the account of the remaining income entry
            trn.extracted.apartmentNumber = selectedEntry.kontoKontrahenta;
            trn.extracted.confidence.overall = 100;
            trn.extracted.confidence.apartment = 100;
            
            trn.reviewedByUser = {
              action: 'manual',
              originalValue: originalApartmentNumber,
              manualValue: selectedEntry.kontoKontrahenta,
              manualRemainingIncomeId: decision.manualRemainingIncomeId
            };
          }
        } else if (decision.manualApartmentNumber) {
          // Use user-provided apartmentNumber (for income)
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
        
        if (decision.manualRemainingCostId && trn.matchedContractor) {
          // Use user-selected "Pozostałe koszty" entry (for expense)
          const selectedEntry = contractors.find(k => k.id === decision.manualRemainingCostId);
          if (selectedEntry) {
            trn.matchedContractor.contractor = selectedEntry;
            trn.matchedContractor.confidence = 100;
            trn.matchedContractor.matchedIn = 'manual' as any;
            
            trn.reviewedByUser = {
              ...trn.reviewedByUser,
              action: 'manual',
              originalContractorValue: {
                name: trn.matchedContractor.contractor?.nazwa || null,
                account: trn.matchedContractor.contractor?.kontoKontrahenta || null
              },
              manualRemainingCostId: decision.manualRemainingCostId
            };
          }
        } else if (decision.manualContractorId && trn.matchedContractor) {
          // Use user-selected contractor (for expense)
          const originalContractorName = trn.matchedContractor.contractor?.nazwa || null;
          const originalContractorAccount = trn.matchedContractor.contractor?.kontoKontrahenta || null;
          
          // Find the contractor by ID
          const selectedContractor = contractors.find(k => k.id === decision.manualContractorId);
          
          if (selectedContractor) {
            // Update matchedContractor with the manually selected one
            trn.matchedContractor.contractor = selectedContractor;
            trn.matchedContractor.confidence = 100; // Max confidence for manual selection
            trn.matchedContractor.matchedIn = 'manual' as any; // Mark as manually selected
            
            // Mark as reviewed by user
            trn.reviewedByUser = {
              ...trn.reviewedByUser,
              action: 'manual',
              originalContractorValue: {
                name: originalContractorName,
                account: originalContractorAccount
              },
              manualContractorId: decision.manualContractorId
            };
          }
        }
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

          // Get app language
          const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

          // Use the real Santander XML converter
          const converter = new SantanderXmlConverter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: {
              autoApprove: 85,
              needsReview: 70,
            },
            contractors, // Pass contractors for expense matching
            addresses, // Pass addresses for income address matching
            language,
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
            output += `🔍 ${language === 'pl' ? 'WYEKSTRAHOWANE DANE' : 'EXTRACTED DATA'}:\n`;
            output += `   ${language === 'pl' ? 'Mieszkanie' : 'Apartment'}:        ${trn.extracted.apartmentNumber || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Pełny adres' : 'Full Address'}:     ${trn.extracted.fullAddress || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Ulica' : 'Street Name'}:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Nr budynku' : 'Building Number'}:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Najemca' : 'Tenant Name'}:      ${trn.extracted.tenantName || 'N/A'}\n\n`;
            
            // Confidence & Status
            output += `📊 ${language === 'pl' ? 'PEWNOŚĆ I STATUS' : 'CONFIDENCE & STATUS'}:\n`;
            output += `   ${language === 'pl' ? 'Pewność ogólna' : 'Overall Confidence'}:    ${trn.extracted.confidence.overall}%\n`;
            output += `   ${language === 'pl' ? 'Pewność mieszkania' : 'Apartment Confidence'}:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   ${language === 'pl' ? 'Pewność adresu' : 'Address Confidence'}:    ${trn.extracted.confidence.address}%\n`;
            output += `   ${language === 'pl' ? 'Pewność najemcy' : 'Tenant Confidence'}:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   ${language === 'pl' ? 'Metoda ekstrakcji' : 'Extraction Method'}:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;
            
            if (trn.extracted.warnings && trn.extracted.warnings.length > 0) {
              output += `   ${language === 'pl' ? 'Ostrzeżenia' : 'Warnings'}:              ${trn.extracted.warnings.join(', ')}\n`;
            }
            
            // User Review Info (if applicable)
            if (trn.reviewedByUser) {
              output += `\n👤 ${language === 'pl' ? 'WERYFIKACJA UŻYTKOWNIKA' : 'USER REVIEW'}:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ZAAKCEPTOWANO' : 'ACCEPTED'}\n`;
                if (trn.reviewedByUser.extractedFrom) {
                  output += `   ${language === 'pl' ? 'Źródło' : 'Source'}:                ${language === 'pl' ? 'Wyekstrahowano z' : 'Extracted from'} ${trn.reviewedByUser.extractedFrom}\n`;
                }
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ODRZUCONO' : 'REJECTED'}\n`;
                if (trn.reviewedByUser.originalValue) {
                  output += `   ${language === 'pl' ? 'Oryginalna wartość' : 'Original Value'}:        ${trn.reviewedByUser.originalValue}\n`;
                }
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'WPISANO RĘCZNIE' : 'MANUAL INPUT'}\n`;
                output += `   ${language === 'pl' ? 'Wpisana wartość' : 'Manual Value'}:          ${trn.reviewedByUser.manualValue}\n`;
                if (trn.reviewedByUser.originalValue !== undefined) {
                  output += `   ${language === 'pl' ? 'Oryginalna wartość' : 'Original Value'}:        ${trn.reviewedByUser.originalValue || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
                }
              }
            }
            
            if (trn.extracted.reasoning) {
              output += `\n   ${language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:\n`;
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
            // Check if any transactions have AI failure warnings
            const hasAIFailures = result.processed.some(trn => 
              trn.extracted.warnings?.some(w => 
                w.includes('AI extraction failed') || 
                w.includes('AI matching failed')
              )
            );
            
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
            
            const convertResult: ConvertResult = {
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
            };
            
            // Add warning message if AI failed
            if (hasAIFailures) {
              convertResult.warningMessage = 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.';
            }
            
            resolve(convertResult);
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
          saveToImpexFolder(txtPath, csvOutput);
          
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

          // Get app language
          const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

          // Use the PKO BP MT940 converter
          const converter = new PKOBPMT940Converter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: {
              autoApprove: 85,
              needsReview: 70,
            },
            contractors, // Pass contractors for expense matching
            addresses, // Pass addresses for income address matching
            language,
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
            output += `🔍 ${language === 'pl' ? 'WYEKSTRAHOWANE DANE' : 'EXTRACTED DATA'}:\n`;
            output += `   ${language === 'pl' ? 'Mieszkanie' : 'Apartment'}:        ${trn.extracted.apartmentNumber || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Pełny adres' : 'Full Address'}:     ${trn.extracted.fullAddress || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Ulica' : 'Street Name'}:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Nr budynku' : 'Building Number'}:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Najemca' : 'Tenant Name'}:      ${trn.extracted.tenantName || 'N/A'}\n\n`;
            
            // Confidence & Status
            output += `📊 ${language === 'pl' ? 'PEWNOŚĆ I STATUS' : 'CONFIDENCE & STATUS'}:\n`;
            output += `   ${language === 'pl' ? 'Pewność ogólna' : 'Overall Confidence'}:    ${trn.extracted.confidence.overall}%\n`;
            output += `   ${language === 'pl' ? 'Pewność mieszkania' : 'Apartment Confidence'}:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   ${language === 'pl' ? 'Pewność adresu' : 'Address Confidence'}:    ${trn.extracted.confidence.address}%\n`;
            output += `   ${language === 'pl' ? 'Pewność najemcy' : 'Tenant Confidence'}:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   ${language === 'pl' ? 'Metoda ekstrakcji' : 'Extraction Method'}:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;
            
            if (trn.extracted.warnings && trn.extracted.warnings.length > 0) {
              output += `   ${language === 'pl' ? 'Ostrzeżenia' : 'Warnings'}:              ${trn.extracted.warnings.join(', ')}\n`;
            }
            
            // User Review Info (if applicable)
            if (trn.reviewedByUser) {
              output += `\n👤 ${language === 'pl' ? 'WERYFIKACJA UŻYTKOWNIKA' : 'USER REVIEW'}:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ZAAKCEPTOWANO' : 'ACCEPTED'}\n`;
                if (trn.reviewedByUser.extractedFrom) {
                  output += `   ${language === 'pl' ? 'Źródło' : 'Source'}:                ${language === 'pl' ? 'Wyekstrahowano z' : 'Extracted from'} ${trn.reviewedByUser.extractedFrom}\n`;
                }
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ODRZUCONO' : 'REJECTED'}\n`;
                if (trn.reviewedByUser.originalValue) {
                  output += `   ${language === 'pl' ? 'Oryginalna wartość' : 'Original Value'}:        ${trn.reviewedByUser.originalValue}\n`;
                }
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'WPISANO RĘCZNIE' : 'MANUAL INPUT'}\n`;
                output += `   ${language === 'pl' ? 'Wpisana wartość' : 'Manual Value'}:          ${trn.reviewedByUser.manualValue}\n`;
                if (trn.reviewedByUser.originalValue !== undefined) {
                  output += `   ${language === 'pl' ? 'Oryginalna wartość' : 'Original Value'}:        ${trn.reviewedByUser.originalValue || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
                }
              }
            }
            
            if (trn.extracted.reasoning) {
              output += `\n   ${language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:\n`;
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
            // Check if any transactions have AI failure warnings
            const hasAIFailures = result.processed.some(trn => 
              trn.extracted.warnings?.some(w => 
                w.includes('AI extraction failed') || 
                w.includes('AI matching failed')
              )
            );
            
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
            
            const convertResult: ConvertResult = {
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
            };
            
            // Add warning message if AI failed
            if (hasAIFailures) {
              convertResult.warningMessage = 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.';
            }
            
            resolve(convertResult);
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
          saveToImpexFolder(txtPath, csvOutput);
          
          console.log(`✅ Generated preview file: ${podgladPath}`);
          console.log(`✅ Generated accounting file: ${txtPath}`);
          
          resolve({ success: true });
        } else if (converterId === 'bnp_xml') {
          let provider: 'none' | 'anthropic' | 'openai' = 'none';
          let apiKey = '';

          if (useAI && this.aiConfig) {
            provider = this.aiConfig.ai.default_provider;
            apiKey = provider === 'anthropic'
              ? this.aiConfig.ai.anthropic_api_key
              : this.aiConfig.ai.openai_api_key;
          }

          const contractors = dbInstance?.getAllKontrahenci() || [];
          let addresses = dbInstance?.getAllAdresy() || [];
          if (adresId !== null && adresId !== undefined) {
            addresses = addresses.filter(a => a.id === adresId);
          }
          const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

          const converter = new BnpXmlConverter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors,
            addresses,
            language,
          });

          const xmlContent = readFileWithEncoding(inputPath);
          const result = await converter.convert(xmlContent);

          const incomeTransactions = result.processed.filter(t => t.transactionType === 'income');
          const expenseTransactions = result.processed.filter(t => t.transactionType === 'expense');

          let output = '=== BNP PARIBAS XML CONVERSION RESULTS ===\n\n';
          output += `Summary:\n`;
          output += `- Total transactions: ${result.totalTransactions}\n`;
          output += `- Income transactions: ${incomeTransactions.length}\n`;
          output += `- Expense transactions: ${expenseTransactions.length}\n`;
          output += `- Auto-approved: ${result.summary.autoApproved}\n`;
          output += `- Needs review: ${result.summary.needsReview}\n`;
          output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
          output += `- Skipped: ${result.summary.skipped}\n`;
          output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

          // INCOME SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WPŁATY (INCOME) ===\n';
          output += '='.repeat(80) + '\n\n';

          incomeTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 BNP DATA:\n`;
            output += `   Booking Date:     ${trn.original.bookingDate}\n`;
            output += `   Value Date:       ${trn.original.valueDate}\n`;
            output += `   Amount:           ${trn.original.amount} ${trn.original.currency}\n`;
            output += `   TX Code:          ${trn.original.txCode}\n`;
            output += `   Reference:        ${trn.original.instrId}\n\n`;

            output += `   Description:\n`;
            output += `   ${trn.original.description || '(empty)'}\n\n`;

            output += `   Counterparty:\n`;
            output += `   ${trn.original.counterpartyName || '(empty)'}\n`;
            output += `   ${trn.original.counterpartyAddress || '(empty)'}\n`;
            output += `   Account: ${trn.original.counterpartyAccount || '(empty)'}\n\n`;

            output += `🔍 ${language === 'pl' ? 'WYEKSTRAHOWANE DANE' : 'EXTRACTED DATA'}:\n`;
            output += `   ${language === 'pl' ? 'Mieszkanie' : 'Apartment'}:        ${trn.extracted.apartmentNumber || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Pełny adres' : 'Full Address'}:     ${trn.extracted.fullAddress || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Ulica' : 'Street Name'}:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Nr budynku' : 'Building Number'}:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Najemca' : 'Tenant Name'}:      ${trn.extracted.tenantName || 'N/A'}\n\n`;

            output += `📊 ${language === 'pl' ? 'PEWNOŚĆ I STATUS' : 'CONFIDENCE & STATUS'}:\n`;
            output += `   ${language === 'pl' ? 'Pewność ogólna' : 'Overall Confidence'}:    ${trn.extracted.confidence.overall}%\n`;
            output += `   ${language === 'pl' ? 'Pewność mieszkania' : 'Apartment Confidence'}:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   ${language === 'pl' ? 'Pewność adresu' : 'Address Confidence'}:    ${trn.extracted.confidence.address}%\n`;
            output += `   ${language === 'pl' ? 'Pewność najemcy' : 'Tenant Confidence'}:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   ${language === 'pl' ? 'Metoda ekstrakcji' : 'Extraction Method'}:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   ${language === 'pl' ? 'Ostrzeżenia' : 'Warnings'}:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            if (trn.reviewedByUser) {
              output += `\n👤 ${language === 'pl' ? 'WERYFIKACJA UŻYTKOWNIKA' : 'USER REVIEW'}:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ZAAKCEPTOWANO' : 'ACCEPTED'}\n`;
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ODRZUCONO' : 'REJECTED'}\n`;
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'WPISANO RĘCZNIE' : 'MANUAL INPUT'}\n`;
                output += `   ${language === 'pl' ? 'Wpisana wartość' : 'Manual Value'}:          ${trn.reviewedByUser.manualValue}\n`;
              }
            }

            if (trn.extracted.reasoning) {
              output += `\n   ${language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:\n`;
              output += `   ${trn.extracted.reasoning}\n`;
            }

            output += `\n`;
          });

          // EXPENSES SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WYDATKI (EXPENSES) ===\n';
          output += '='.repeat(80) + '\n\n';

          expenseTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 BNP DATA:\n`;
            output += `   Booking Date:     ${trn.original.bookingDate}\n`;
            output += `   Value Date:       ${trn.original.valueDate}\n`;
            output += `   Amount:           ${trn.original.amount} ${trn.original.currency}\n`;
            output += `   TX Code:          ${trn.original.txCode}\n`;
            output += `   Reference:        ${trn.original.instrId}\n\n`;

            output += `   Description:\n`;
            output += `   ${trn.original.description || '(empty)'}\n\n`;

            output += `   Counterparty:\n`;
            output += `   ${trn.original.counterpartyName || '(empty)'}\n`;
            output += `   ${trn.original.counterpartyAddress || '(empty)'}\n`;
            output += `   Account: ${trn.original.counterpartyAccount || '(empty)'}\n\n`;

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

            output += `📊 STATUS:\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            output += `\n`;
          });

          // Check if transactions need review
          const reviewTransactions = this.extractReviewTransactions(result.processed, 'bnp_xml');

          if (reviewTransactions.length > 0) {
            const hasAIFailures = result.processed.some(trn =>
              trn.extracted.warnings?.some(w =>
                w.includes('AI extraction failed') ||
                w.includes('AI matching failed')
              )
            );

            const tempConversionId = conversionCache.store(
              fileName || path.basename(inputPath),
              bankName || 'BNP Paribas',
              converterId,
              inputPath,
              outputPath,
              result.processed,
              output
            );

            let adresName: string | null = null;
            if (adresId !== null && adresId !== undefined) {
              const adres = dbInstance?.getAdresById(adresId);
              adresName = adres?.nazwa || null;
            }

            console.log(`⚠️  ${reviewTransactions.length} transactions need review`);

            const convertResult: ConvertResult = {
              success: true,
              needsReview: true,
              reviewData: {
                needsReview: true,
                tempConversionId,
                fileName: fileName || path.basename(inputPath),
                bankName: bankName || 'BNP Paribas',
                adresId: adresId || null,
                adresName,
                transactions: reviewTransactions,
              },
            };

            if (hasAIFailures) {
              convertResult.warningMessage = 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.';
            }

            resolve(convertResult);
            return;
          }

          const podgladPath = outputPath.replace(/\.(txt|TXT)$/, '-podglad.txt');
          fs.writeFileSync(podgladPath, output, 'utf8');

          const csvOutput = converter.exportToCsv(result.processed);
          const txtPath = outputPath.replace(/\.(txt|TXT)$/, '-accounting.txt');
          fs.writeFileSync(txtPath, csvOutput, 'utf8');
          saveToImpexFolder(txtPath, csvOutput);

          console.log(`✅ Generated preview file: ${podgladPath}`);
          console.log(`✅ Generated accounting file: ${txtPath}`);

          resolve({ success: true });
        } else if (converterId === 'alior') {
          let provider: 'none' | 'anthropic' | 'openai' = 'none';
          let apiKey = '';

          if (useAI && this.aiConfig) {
            provider = this.aiConfig.ai.default_provider;
            apiKey = provider === 'anthropic'
              ? this.aiConfig.ai.anthropic_api_key
              : this.aiConfig.ai.openai_api_key;
          }

          const contractors = dbInstance?.getAllKontrahenci() || [];
          let addresses = dbInstance?.getAllAdresy() || [];
          if (adresId !== null && adresId !== undefined) {
            addresses = addresses.filter(a => a.id === adresId);
          }
          const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

          const converter = new AliorConverter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors,
            addresses,
            language,
          });

          const mt940Content = readFileWithEncoding(inputPath);
          const result = await converter.convert(mt940Content);

          const incomeTransactions = result.processed.filter(t => t.transactionType === 'income');
          const expenseTransactions = result.processed.filter(t => t.transactionType === 'expense');

          let output = '=== ALIOR BANK MT940 CONVERSION RESULTS ===\n\n';
          output += `Summary:\n`;
          output += `- Total transactions: ${result.totalTransactions}\n`;
          output += `- Income transactions: ${incomeTransactions.length}\n`;
          output += `- Expense transactions: ${expenseTransactions.length}\n`;
          output += `- Auto-approved: ${result.summary.autoApproved}\n`;
          output += `- Needs review: ${result.summary.needsReview}\n`;
          output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
          output += `- Skipped: ${result.summary.skipped}\n`;
          output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

          // INCOME SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WPŁATY (INCOME) ===\n';
          output += '='.repeat(80) + '\n\n';

          incomeTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 ALIOR DATA:\n`;
            output += `   Value Date:       ${trn.original.valueDate}\n`;
            output += `   Entry Date:       ${trn.original.entryDate}\n`;
            output += `   Transaction Type: ${trn.original.transactionType}\n`;
            output += `   Amount:           ${trn.original.amount} PLN\n`;
            output += `   Reference:        ${trn.original.reference}\n\n`;

            output += `   Description:\n`;
            output += `   ${trn.original.details.description.join(' ')}\n\n`;

            output += `   Counterparty:\n`;
            output += `   ${trn.original.details.counterpartyName}\n`;
            if (trn.original.details.counterpartyAddress) {
              output += `   ${trn.original.details.counterpartyAddress}\n`;
            }
            output += `   IBAN: ${trn.original.details.counterpartyIBAN}\n\n`;

            output += `🔍 ${language === 'pl' ? 'WYEKSTRAHOWANE DANE' : 'EXTRACTED DATA'}:\n`;
            output += `   ${language === 'pl' ? 'Mieszkanie' : 'Apartment'}:        ${trn.extracted.apartmentNumber || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Pełny adres' : 'Full Address'}:     ${trn.extracted.fullAddress || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Ulica' : 'Street Name'}:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Nr budynku' : 'Building Number'}:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Najemca' : 'Tenant Name'}:      ${trn.extracted.tenantName || 'N/A'}\n\n`;

            output += `📊 ${language === 'pl' ? 'PEWNOŚĆ I STATUS' : 'CONFIDENCE & STATUS'}:\n`;
            output += `   ${language === 'pl' ? 'Pewność ogólna' : 'Overall Confidence'}:    ${trn.extracted.confidence.overall}%\n`;
            output += `   ${language === 'pl' ? 'Pewność mieszkania' : 'Apartment Confidence'}:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   ${language === 'pl' ? 'Pewność adresu' : 'Address Confidence'}:    ${trn.extracted.confidence.address}%\n`;
            output += `   ${language === 'pl' ? 'Pewność najemcy' : 'Tenant Confidence'}:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   ${language === 'pl' ? 'Metoda ekstrakcji' : 'Extraction Method'}:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   ${language === 'pl' ? 'Ostrzeżenia' : 'Warnings'}:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            if (trn.reviewedByUser) {
              output += `\n👤 ${language === 'pl' ? 'WERYFIKACJA UŻYTKOWNIKA' : 'USER REVIEW'}:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ZAAKCEPTOWANO' : 'ACCEPTED'}\n`;
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ODRZUCONO' : 'REJECTED'}\n`;
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'WPISANO RĘCZNIE' : 'MANUAL INPUT'}\n`;
                output += `   ${language === 'pl' ? 'Wpisana wartość' : 'Manual Value'}:          ${trn.reviewedByUser.manualValue}\n`;
              }
            }

            if (trn.extracted.reasoning) {
              output += `\n   ${language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:\n`;
              output += `   ${trn.extracted.reasoning}\n`;
            }

            output += `\n`;
          });

          // EXPENSES SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WYDATKI (EXPENSES) ===\n';
          output += '='.repeat(80) + '\n\n';

          expenseTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 ALIOR DATA:\n`;
            output += `   Value Date:       ${trn.original.valueDate}\n`;
            output += `   Entry Date:       ${trn.original.entryDate}\n`;
            output += `   Transaction Type: ${trn.original.transactionType}\n`;
            output += `   Amount:           ${trn.original.amount} PLN\n`;
            output += `   Reference:        ${trn.original.reference}\n\n`;

            output += `   Description:\n`;
            output += `   ${trn.original.details.description.join(' ')}\n\n`;

            output += `   Counterparty:\n`;
            output += `   ${trn.original.details.counterpartyName}\n`;
            if (trn.original.details.counterpartyAddress) {
              output += `   ${trn.original.details.counterpartyAddress}\n`;
            }
            output += `   IBAN: ${trn.original.details.counterpartyIBAN}\n\n`;

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

            output += `📊 STATUS:\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            output += `\n`;
          });

          // Check if transactions need review
          const reviewTransactions = this.extractReviewTransactions(result.processed, 'alior');

          if (reviewTransactions.length > 0) {
            const hasAIFailures = result.processed.some(trn =>
              trn.extracted.warnings?.some(w =>
                w.includes('AI extraction failed') ||
                w.includes('AI matching failed')
              )
            );

            const tempConversionId = conversionCache.store(
              fileName || path.basename(inputPath),
              bankName || 'Alior Bank',
              converterId,
              inputPath,
              outputPath,
              result.processed,
              output
            );

            let adresName: string | null = null;
            if (adresId !== null && adresId !== undefined) {
              const adres = dbInstance?.getAdresById(adresId);
              adresName = adres?.nazwa || null;
            }

            console.log(`⚠️  ${reviewTransactions.length} transactions need review`);

            const convertResult: ConvertResult = {
              success: true,
              needsReview: true,
              reviewData: {
                needsReview: true,
                tempConversionId,
                fileName: fileName || path.basename(inputPath),
                bankName: bankName || 'Alior Bank',
                adresId: adresId || null,
                adresName,
                transactions: reviewTransactions,
              },
            };

            if (hasAIFailures) {
              convertResult.warningMessage = 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.';
            }

            resolve(convertResult);
            return;
          }

          const podgladPath = outputPath.replace(/\.(txt|TXT)$/, '-podglad.txt');
          fs.writeFileSync(podgladPath, output, 'utf8');

          const csvOutput = converter.exportToCsv(result.processed);
          const txtPath = outputPath.replace(/\.(txt|TXT)$/, '-accounting.txt');
          fs.writeFileSync(txtPath, csvOutput, 'utf8');
          saveToImpexFolder(txtPath, csvOutput);

          console.log(`✅ Generated preview file: ${podgladPath}`);
          console.log(`✅ Generated accounting file: ${txtPath}`);

          resolve({ success: true });
        } else if (converterId === 'pko_biznes') {
          let provider: 'none' | 'anthropic' | 'openai' = 'none';
          let apiKey = '';

          if (useAI && this.aiConfig) {
            provider = this.aiConfig.ai.default_provider;
            apiKey = provider === 'anthropic'
              ? this.aiConfig.ai.anthropic_api_key
              : this.aiConfig.ai.openai_api_key;
          }

          const contractors = dbInstance?.getAllKontrahenci() || [];
          let addresses = dbInstance?.getAllAdresy() || [];
          if (adresId !== null && adresId !== undefined) {
            addresses = addresses.filter(a => a.id === adresId);
          }
          const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

          const converter = new PKOBiznesConverter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors,
            addresses,
            language,
          });

          const zipBuffer = fs.readFileSync(inputPath);
          const result = await converter.convert(zipBuffer);

          const incomeTransactions = result.processed.filter((t: any) => t.transactionType === 'income');
          const expenseTransactions = result.processed.filter((t: any) => t.transactionType === 'expense');

          let output = '=== PKO BIZNES ELIXIR CONVERSION RESULTS ===\n\n';
          output += `Summary:\n`;
          output += `- Total transactions: ${result.totalTransactions}\n`;
          output += `- Income transactions: ${incomeTransactions.length}\n`;
          output += `- Expense transactions: ${expenseTransactions.length}\n`;
          output += `- Auto-approved: ${result.summary.autoApproved}\n`;
          output += `- Needs review: ${result.summary.needsReview}\n`;
          output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
          output += `- Skipped: ${result.summary.skipped}\n`;
          output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

          // INCOME SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WPŁATY (INCOME) ===\n';
          output += '='.repeat(80) + '\n\n';

          incomeTransactions.forEach((trn: any, idx: number) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 PKO BIZNES DATA:\n`;
            output += `   Date:             ${trn.original.date}\n`;
            output += `   Operation Type:   ${trn.original.operationType === '111' ? 'Credit (Income)' : 'Debit (Expense)'}\n`;
            output += `   Amount:           ${trn.original.amount} PLN\n`;
            output += `   Reference:        ${trn.original.referenceNumber}\n`;
            output += `   Source File:      ${trn.original.sourceFile}\n\n`;

            output += `   Description:\n`;
            output += `   ${trn.original.description}\n\n`;

            output += `   Counterparty:\n`;
            output += `   ${trn.original.counterpartyName}\n`;
            if (trn.original.counterpartyNameExtra) {
              output += `   ${trn.original.counterpartyNameExtra}\n`;
            }
            output += `   IBAN: ${trn.original.counterpartyIBAN}\n\n`;

            output += `🔍 ${language === 'pl' ? 'WYEKSTRAHOWANE DANE' : 'EXTRACTED DATA'}:\n`;
            output += `   ${language === 'pl' ? 'Mieszkanie' : 'Apartment'}:        ${trn.extracted.apartmentNumber || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Pełny adres' : 'Full Address'}:     ${trn.extracted.fullAddress || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Ulica' : 'Street Name'}:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Nr budynku' : 'Building Number'}:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Najemca' : 'Tenant Name'}:      ${trn.extracted.tenantName || 'N/A'}\n\n`;

            output += `📊 ${language === 'pl' ? 'PEWNOŚĆ I STATUS' : 'CONFIDENCE & STATUS'}:\n`;
            output += `   ${language === 'pl' ? 'Pewność ogólna' : 'Overall Confidence'}:    ${trn.extracted.confidence.overall}%\n`;
            output += `   ${language === 'pl' ? 'Pewność mieszkania' : 'Apartment Confidence'}:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   ${language === 'pl' ? 'Pewność adresu' : 'Address Confidence'}:    ${trn.extracted.confidence.address}%\n`;
            output += `   ${language === 'pl' ? 'Pewność najemcy' : 'Tenant Confidence'}:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   ${language === 'pl' ? 'Metoda ekstrakcji' : 'Extraction Method'}:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   ${language === 'pl' ? 'Ostrzeżenia' : 'Warnings'}:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            if (trn.reviewedByUser) {
              output += `\n👤 ${language === 'pl' ? 'WERYFIKACJA UŻYTKOWNIKA' : 'USER REVIEW'}:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ZAAKCEPTOWANO' : 'ACCEPTED'}\n`;
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ODRZUCONO' : 'REJECTED'}\n`;
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'WPISANO RĘCZNIE' : 'MANUAL INPUT'}\n`;
                output += `   ${language === 'pl' ? 'Wpisana wartość' : 'Manual Value'}:          ${trn.reviewedByUser.manualValue}\n`;
              }
            }

            if (trn.extracted.reasoning) {
              output += `\n   ${language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:\n`;
              output += `   ${trn.extracted.reasoning}\n`;
            }

            output += `\n`;
          });

          // EXPENSES SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WYDATKI (EXPENSES) ===\n';
          output += '='.repeat(80) + '\n\n';

          expenseTransactions.forEach((trn: any, idx: number) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 PKO BIZNES DATA:\n`;
            output += `   Date:             ${trn.original.date}\n`;
            output += `   Operation Type:   ${trn.original.operationType === '111' ? 'Credit (Income)' : 'Debit (Expense)'}\n`;
            output += `   Amount:           ${trn.original.amount} PLN\n`;
            output += `   Reference:        ${trn.original.referenceNumber}\n`;
            output += `   Source File:      ${trn.original.sourceFile}\n\n`;

            output += `   Description:\n`;
            output += `   ${trn.original.description}\n\n`;

            output += `   Counterparty:\n`;
            output += `   ${trn.original.counterpartyName}\n`;
            if (trn.original.counterpartyNameExtra) {
              output += `   ${trn.original.counterpartyNameExtra}\n`;
            }
            output += `   IBAN: ${trn.original.counterpartyIBAN}\n\n`;

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

            output += `📊 STATUS:\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            output += `\n`;
          });

          // Check if transactions need review
          const reviewTransactions = this.extractReviewTransactions(result.processed, 'pko_biznes');

          if (reviewTransactions.length > 0) {
            const hasAIFailures = result.processed.some((trn: any) =>
              trn.extracted.warnings?.some((w: string) =>
                w.includes('AI extraction failed') ||
                w.includes('AI matching failed')
              )
            );

            const tempConversionId = conversionCache.store(
              fileName || path.basename(inputPath),
              bankName || 'PKO Biznes',
              converterId,
              inputPath,
              outputPath,
              result.processed,
              output
            );

            let adresName: string | null = null;
            if (adresId !== null && adresId !== undefined) {
              const adres = dbInstance?.getAdresById(adresId);
              adresName = adres?.nazwa || null;
            }

            console.log(`⚠️  ${reviewTransactions.length} transactions need review`);

            const convertResult: ConvertResult = {
              success: true,
              needsReview: true,
              reviewData: {
                needsReview: true,
                tempConversionId,
                fileName: fileName || path.basename(inputPath),
                bankName: bankName || 'PKO Biznes',
                adresId: adresId || null,
                adresName,
                transactions: reviewTransactions,
              },
            };

            if (hasAIFailures) {
              convertResult.warningMessage = 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.';
            }

            resolve(convertResult);
            return;
          }

          const podgladPath = outputPath.replace(/\.(txt|TXT|zip|ZIP)$/, '-podglad.txt');
          fs.writeFileSync(podgladPath, output, 'utf8');

          const csvOutput = converter.exportToCsv(result.processed);
          const txtPath = outputPath.replace(/\.(txt|TXT|zip|ZIP)$/, '-accounting.txt');
          fs.writeFileSync(txtPath, csvOutput, 'utf8');
          saveToImpexFolder(txtPath, csvOutput);

          console.log(`✅ Generated preview file: ${podgladPath}`);
          console.log(`✅ Generated accounting file: ${txtPath}`);

          resolve({ success: true });
        } else if (converterId === 'pko_sa') {
          let provider: 'none' | 'anthropic' | 'openai' = 'none';
          let apiKey = '';

          if (useAI && this.aiConfig) {
            provider = this.aiConfig.ai.default_provider;
            apiKey = provider === 'anthropic'
              ? this.aiConfig.ai.anthropic_api_key
              : this.aiConfig.ai.openai_api_key;
          }

          const contractors = dbInstance?.getAllKontrahenci() || [];
          let addresses = dbInstance?.getAllAdresy() || [];
          if (adresId !== null && adresId !== undefined) {
            addresses = addresses.filter(a => a.id === adresId);
          }
          const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

          const converter = new PKOSAConverter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors,
            addresses,
            language,
          });

          const expContent = readFileWithEncoding(inputPath);
          const result = await converter.convert(expContent);

          const incomeTransactions = result.processed.filter((t: any) => t.transactionType === 'income');
          const expenseTransactions = result.processed.filter((t: any) => t.transactionType === 'expense');

          let output = '=== PKO SA EXP CONVERSION RESULTS ===\n\n';
          output += `Summary:\n`;
          output += `- Total transactions: ${result.totalTransactions}\n`;
          output += `- Income transactions: ${incomeTransactions.length}\n`;
          output += `- Expense transactions: ${expenseTransactions.length}\n`;
          output += `- Auto-approved: ${result.summary.autoApproved}\n`;
          output += `- Needs review: ${result.summary.needsReview}\n`;
          output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
          output += `- Skipped: ${result.summary.skipped}\n`;
          output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

          // INCOME SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WPŁATY (INCOME) ===\n';
          output += '='.repeat(80) + '\n\n';

          incomeTransactions.forEach((trn: any, idx: number) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 PKO SA EXP DATA:\n`;
            output += `   Date:             ${trn.original.exeDate}\n`;
            output += `   Amount:           ${trn.original.value} PLN\n`;
            output += `   Transaction Code: ${trn.original.trnCode}\n`;
            output += `   Raw Data:\n`;
            output += `     Description:    ${trn.extracted.rawData.description}\n`;
            output += `     Counterparty:   ${trn.extracted.rawData.counterparty}\n`;
            output += `     Account:        ${trn.extracted.rawData.accountNumber}\n\n`;

            output += `🔍 ${language === 'pl' ? 'WYEKSTRAHOWANE DANE' : 'EXTRACTED DATA'}:\n`;
            output += `   ${language === 'pl' ? 'Mieszkanie' : 'Apartment'}:        ${trn.extracted.apartmentNumber || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Pełny adres' : 'Full Address'}:     ${trn.extracted.fullAddress || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Ulica' : 'Street Name'}:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Nr budynku' : 'Building Number'}:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Najemca' : 'Tenant Name'}:      ${trn.extracted.tenantName || 'N/A'}\n\n`;

            output += `📊 ${language === 'pl' ? 'PEWNOŚĆ I STATUS' : 'CONFIDENCE & STATUS'}:\n`;
            output += `   ${language === 'pl' ? 'Pewność ogólna' : 'Overall Confidence'}:    ${trn.extracted.confidence.overall}%\n`;
            output += `   ${language === 'pl' ? 'Pewność mieszkania' : 'Apartment Confidence'}:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   ${language === 'pl' ? 'Pewność adresu' : 'Address Confidence'}:    ${trn.extracted.confidence.address}%\n`;
            output += `   ${language === 'pl' ? 'Pewność najemcy' : 'Tenant Confidence'}:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   ${language === 'pl' ? 'Metoda ekstrakcji' : 'Extraction Method'}:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   ${language === 'pl' ? 'Ostrzeżenia' : 'Warnings'}:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            if (trn.reviewedByUser) {
              output += `\n👤 ${language === 'pl' ? 'WERYFIKACJA UŻYTKOWNIKA' : 'USER REVIEW'}:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ZAAKCEPTOWANO' : 'ACCEPTED'}\n`;
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ODRZUCONO' : 'REJECTED'}\n`;
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'WPISANO RĘCZNIE' : 'MANUAL INPUT'}\n`;
                output += `   ${language === 'pl' ? 'Wpisana wartość' : 'Manual Value'}:          ${trn.reviewedByUser.manualValue}\n`;
              }
            }

            if (trn.extracted.reasoning) {
              output += `\n   ${language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:\n`;
              output += `   ${trn.extracted.reasoning}\n`;
            }

            output += `\n`;
          });

          // EXPENSES SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WYDATKI (EXPENSES) ===\n';
          output += '='.repeat(80) + '\n\n';

          expenseTransactions.forEach((trn: any, idx: number) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 PKO SA EXP DATA:\n`;
            output += `   Date:             ${trn.original.exeDate}\n`;
            output += `   Amount:           ${trn.original.value} PLN\n`;
            output += `   Transaction Code: ${trn.original.trnCode}\n`;
            output += `   Raw Data:\n`;
            output += `     Description:    ${trn.extracted.rawData.description}\n`;
            output += `     Counterparty:   ${trn.extracted.rawData.counterparty}\n`;
            output += `     Account:        ${trn.extracted.rawData.accountNumber}\n\n`;

            if (trn.matchedContractor) {
              output += `💼 MATCHED CONTRACTOR:\n`;
              if (trn.matchedContractor.contractor) {
                output += `   Contractor Name:       ${trn.matchedContractor.contractor.nazwa}\n`;
                output += `   Contractor Account:    ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
                output += `   Match Confidence:      ${trn.matchedContractor.confidence}%\n`;
                output += `   Matched In:            ${trn.matchedContractor.matchedIn === 'desc-opt' ? 'Counterparty' : 'Description'}\n`;
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

            output += `📊 STATUS:\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            output += `\n`;
          });

          // Check if transactions need review
          const reviewTransactions = this.extractReviewTransactions(result.processed, 'pko_sa');

          if (reviewTransactions.length > 0) {
            const hasAIFailures = result.processed.some((trn: any) =>
              trn.extracted.warnings?.some((w: string) =>
                w.includes('AI extraction failed') ||
                w.includes('AI matching failed')
              )
            );

            const tempConversionId = conversionCache.store(
              fileName || path.basename(inputPath),
              bankName || 'PKO SA',
              converterId,
              inputPath,
              outputPath,
              result.processed,
              output
            );

            let adresName: string | null = null;
            if (adresId !== null && adresId !== undefined) {
              const adres = dbInstance?.getAdresById(adresId);
              adresName = adres?.nazwa || null;
            }

            console.log(`⚠️  ${reviewTransactions.length} transactions need review`);

            const convertResult: ConvertResult = {
              success: true,
              needsReview: true,
              reviewData: {
                needsReview: true,
                tempConversionId,
                fileName: fileName || path.basename(inputPath),
                bankName: bankName || 'PKO SA',
                adresId: adresId || null,
                adresName,
                transactions: reviewTransactions,
              },
            };

            if (hasAIFailures) {
              convertResult.warningMessage = 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.';
            }

            resolve(convertResult);
            return;
          }

          const podgladPath = outputPath.replace(/\.(txt|TXT|exp|EXP)$/, '-podglad.txt');
          fs.writeFileSync(podgladPath, output, 'utf8');

          const csvOutput = converter.exportToCsv(result.processed);
          const txtPath = outputPath.replace(/\.(txt|TXT|exp|EXP)$/, '-accounting.txt');
          fs.writeFileSync(txtPath, csvOutput, 'utf8');
          saveToImpexFolder(txtPath, csvOutput);

          console.log(`✅ Generated preview file: ${podgladPath}`);
          console.log(`✅ Generated accounting file: ${txtPath}`);

          resolve({ success: true });
        } else if (converterId === 'ing') {
          let provider: 'none' | 'anthropic' | 'openai' = 'none';
          let apiKey = '';

          if (useAI && this.aiConfig) {
            provider = this.aiConfig.ai.default_provider;
            apiKey = provider === 'anthropic'
              ? this.aiConfig.ai.anthropic_api_key
              : this.aiConfig.ai.openai_api_key;
          }

          const contractors = dbInstance?.getAllKontrahenci() || [];
          let addresses = dbInstance?.getAllAdresy() || [];
          if (adresId !== null && adresId !== undefined) {
            addresses = addresses.filter(a => a.id === adresId);
          }
          const language = (dbInstance?.getSetting('language') || 'pl') as 'pl' | 'en';

          const converter = new INGConverter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors,
            addresses,
            language,
          });

          const mt940Content = readFileWithEncoding(inputPath, 'cp852');
          const result = await converter.convert(mt940Content);

          const incomeTransactions = result.processed.filter(t => t.transactionType === 'income');
          const expenseTransactions = result.processed.filter(t => t.transactionType === 'expense');

          let output = '=== ING BANK MT940 CONVERSION RESULTS ===\n\n';
          output += `Summary:\n`;
          output += `- Total transactions: ${result.totalTransactions}\n`;
          output += `- Income transactions: ${incomeTransactions.length}\n`;
          output += `- Expense transactions: ${expenseTransactions.length}\n`;
          output += `- Auto-approved: ${result.summary.autoApproved}\n`;
          output += `- Needs review: ${result.summary.needsReview}\n`;
          output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
          output += `- Skipped: ${result.summary.skipped}\n`;
          output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

          // INCOME SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WPŁATY (INCOME) ===\n';
          output += '='.repeat(80) + '\n\n';

          incomeTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 ING DATA:\n`;
            output += `   Value Date:       ${trn.original.valueDate}\n`;
            output += `   Entry Date:       ${trn.original.entryDate}\n`;
            output += `   Transaction Type: ${trn.original.transactionType}\n`;
            output += `   Amount:           ${trn.original.amount} PLN\n`;
            output += `   Reference:        ${trn.original.reference}\n\n`;

            output += `   Description:\n`;
            output += `   ${trn.original.details.description.join(' ')}\n\n`;

            output += `   Counterparty:\n`;
            output += `   ${trn.original.details.counterpartyName}\n`;
            if (trn.original.details.additionalInfo) {
              output += `   ${trn.original.details.additionalInfo}\n`;
            }
            output += `   IBAN: ${trn.original.details.counterpartyIBAN}\n\n`;

            output += `🔍 ${language === 'pl' ? 'WYEKSTRAHOWANE DANE' : 'EXTRACTED DATA'}:\n`;
            output += `   ${language === 'pl' ? 'Mieszkanie' : 'Apartment'}:        ${trn.extracted.apartmentNumber || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Pełny adres' : 'Full Address'}:     ${trn.extracted.fullAddress || (language === 'pl' ? 'NIE ZNALEZIONO' : 'NOT FOUND')}\n`;
            output += `   ${language === 'pl' ? 'Ulica' : 'Street Name'}:      ${trn.extracted.streetName || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Nr budynku' : 'Building Number'}:  ${trn.extracted.buildingNumber || 'N/A'}\n`;
            output += `   ${language === 'pl' ? 'Najemca' : 'Tenant Name'}:      ${trn.extracted.tenantName || 'N/A'}\n\n`;

            output += `📊 ${language === 'pl' ? 'PEWNOŚĆ I STATUS' : 'CONFIDENCE & STATUS'}:\n`;
            output += `   ${language === 'pl' ? 'Pewność ogólna' : 'Overall Confidence'}:    ${trn.extracted.confidence.overall}%\n`;
            output += `   ${language === 'pl' ? 'Pewność mieszkania' : 'Apartment Confidence'}:  ${trn.extracted.confidence.apartment}%\n`;
            output += `   ${language === 'pl' ? 'Pewność adresu' : 'Address Confidence'}:    ${trn.extracted.confidence.address}%\n`;
            output += `   ${language === 'pl' ? 'Pewność najemcy' : 'Tenant Confidence'}:     ${trn.extracted.confidence.tenantName}%\n`;
            output += `   ${language === 'pl' ? 'Metoda ekstrakcji' : 'Extraction Method'}:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   ${language === 'pl' ? 'Ostrzeżenia' : 'Warnings'}:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            if (trn.reviewedByUser) {
              output += `\n👤 ${language === 'pl' ? 'WERYFIKACJA UŻYTKOWNIKA' : 'USER REVIEW'}:\n`;
              if (trn.reviewedByUser.action === 'accept') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ZAAKCEPTOWANO' : 'ACCEPTED'}\n`;
              } else if (trn.reviewedByUser.action === 'reject') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'ODRZUCONO' : 'REJECTED'}\n`;
              } else if (trn.reviewedByUser.action === 'manual') {
                output += `   ${language === 'pl' ? 'Akcja' : 'Action'}:                ${language === 'pl' ? 'WPISANO RĘCZNIE' : 'MANUAL INPUT'}\n`;
                output += `   ${language === 'pl' ? 'Wpisana wartość' : 'Manual Value'}:          ${trn.reviewedByUser.manualValue}\n`;
              }
            }

            if (trn.extracted.reasoning) {
              output += `\n   ${language === 'pl' ? 'Uzasadnienie AI' : 'AI Reasoning'}:\n`;
              output += `   ${trn.extracted.reasoning}\n`;
            }

            output += `\n`;
          });

          // EXPENSES SECTION
          output += '='.repeat(80) + '\n';
          output += '=== WYDATKI (EXPENSES) ===\n';
          output += '='.repeat(80) + '\n\n';

          expenseTransactions.forEach((trn, idx) => {
            const num = idx + 1;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            output += `#${num}\n`;
            output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            output += `📄 ING DATA:\n`;
            output += `   Value Date:       ${trn.original.valueDate}\n`;
            output += `   Entry Date:       ${trn.original.entryDate}\n`;
            output += `   Transaction Type: ${trn.original.transactionType}\n`;
            output += `   Amount:           ${trn.original.amount} PLN\n`;
            output += `   Reference:        ${trn.original.reference}\n\n`;

            output += `   Description:\n`;
            output += `   ${trn.original.details.description.join(' ')}\n\n`;

            output += `   Counterparty:\n`;
            output += `   ${trn.original.details.counterpartyName}\n`;
            if (trn.original.details.additionalInfo) {
              output += `   ${trn.original.details.additionalInfo}\n`;
            }
            output += `   IBAN: ${trn.original.details.counterpartyIBAN}\n\n`;

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

            output += `📊 STATUS:\n`;
            output += `   Extraction Method:     ${trn.extracted.extractionMethod}\n`;
            output += `   Status:                ${trn.status}\n`;

            if (trn.extracted.warnings?.length) {
              output += `   Warnings:              ${trn.extracted.warnings.join(', ')}\n`;
            }

            output += `\n`;
          });

          // Check if transactions need review
          const reviewTransactions = this.extractReviewTransactions(result.processed, 'ing');

          if (reviewTransactions.length > 0) {
            const hasAIFailures = result.processed.some(trn =>
              trn.extracted.warnings?.some(w =>
                w.includes('AI extraction failed') ||
                w.includes('AI matching failed')
              )
            );

            const tempConversionId = conversionCache.store(
              fileName || path.basename(inputPath),
              bankName || 'ING Bank',
              converterId,
              inputPath,
              outputPath,
              result.processed,
              output
            );

            let adresName: string | null = null;
            if (adresId !== null && adresId !== undefined) {
              const adres = dbInstance?.getAdresById(adresId);
              adresName = adres?.nazwa || null;
            }

            console.log(`⚠️  ${reviewTransactions.length} transactions need review`);

            const convertResult: ConvertResult = {
              success: true,
              needsReview: true,
              reviewData: {
                needsReview: true,
                tempConversionId,
                fileName: fileName || path.basename(inputPath),
                bankName: bankName || 'ING Bank',
                adresId: adresId || null,
                adresName,
                transactions: reviewTransactions,
              },
            };

            if (hasAIFailures) {
              convertResult.warningMessage = 'Nie udało się użyć AI. Przeprowadzono standardową konwersję.';
            }

            resolve(convertResult);
            return;
          }

          const podgladPath = outputPath.replace(/\.(txt|TXT)$/, '-podglad.txt');
          fs.writeFileSync(podgladPath, output, 'utf8');

          const csvOutput = converter.exportToCsv(result.processed);
          const txtPath = outputPath.replace(/\.(txt|TXT)$/, '-accounting.txt');
          fs.writeFileSync(txtPath, csvOutput, 'utf8');
          saveToImpexFolder(txtPath, csvOutput);

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
      
      // Load contractors and addresses from database (needed for manual selections and export)
      const kontrahenci = dbInstance ? await dbInstance.getAllKontrahenci() : [];
      const adresy = dbInstance ? await dbInstance.getAllAdresy() : [];
      
      // Apply user decisions to transactions
      const updatedTransactions = this.applyReviewDecisions(cached.processedTransactions, decisions, kontrahenci);
      
      // Now generate files with updated transactions
      const converter = cached.converterId === 'santander_xml' 
        ? new SantanderXmlConverter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors: kontrahenci,
            addresses: adresy,
          })
        : cached.converterId === 'bnp_xml'
        ? new BnpXmlConverter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors: kontrahenci,
            addresses: adresy,
          })
        : cached.converterId === 'alior'
        ? new AliorConverter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors: kontrahenci,
            addresses: adresy,
          })
        : cached.converterId === 'pko_biznes'
        ? new PKOBiznesConverter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors: kontrahenci,
            addresses: adresy,
          })
        : cached.converterId === 'pko_sa'
        ? new PKOSAConverter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors: kontrahenci,
            addresses: adresy,
          })
        : cached.converterId === 'ing'
        ? new INGConverter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors: kontrahenci,
            addresses: adresy,
          })
        : new PKOBPMT940Converter({
            aiProvider: 'none',
            apiKey: '',
            batchSize: 20,
            confidenceThresholds: { autoApprove: 85, needsReview: 70 },
            contractors: kontrahenci,
            addresses: adresy,
          });
      
      // Generate accounting file
      const csvOutput = converter.exportToCsv(updatedTransactions);
      const txtPath = cached.outputPath.replace(/\.(txt|TXT)$/, '-accounting.txt');
      fs.writeFileSync(txtPath, csvOutput, 'utf8');
      saveToImpexFolder(txtPath, csvOutput);
      
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
        
        // Separate into income and expenses
        const reviewedIncome = reviewedTransactions.filter((t: any) => t.transactionType === 'income');
        const reviewedExpenses = reviewedTransactions.filter((t: any) => t.transactionType === 'expense');
        
        newPreviewOutput += `Całkowita liczba przejrzanych transakcji: ${reviewedTransactions.length}\n`;
        newPreviewOutput += `  Wpłaty: ${reviewedIncome.length}\n`;
        newPreviewOutput += `  Wydatki: ${reviewedExpenses.length}\n\n`;
        
        // ========== INCOME SECTION ==========
        if (reviewedIncome.length > 0) {
          newPreviewOutput += '─'.repeat(80) + '\n';
          newPreviewOutput += '💰 WPŁATY (INCOME)\n';
          newPreviewOutput += '─'.repeat(80) + '\n\n';
          
          reviewedIncome.forEach((trn: any) => {
            const transactionIndex = updatedTransactions.indexOf(trn) + 1;
            newPreviewOutput += `Pozycja #${transactionIndex}:\n`;
            
            if (trn.reviewedByUser.action === 'accept') {
              newPreviewOutput += `  ✅ ZAAKCEPTOWANO\n`;
              if (trn.reviewedByUser.extractedFrom) {
                newPreviewOutput += `     Wyekstrahowano z: ${trn.reviewedByUser.extractedFrom}\n`;
              }
              newPreviewOutput += `     Numer mieszkania: ${trn.extracted.apartmentNumber}\n`;
            } else if (trn.reviewedByUser.action === 'reject') {
              newPreviewOutput += `  ❌ ODRZUCONO - NIEROZPOZNANE\n`;
              if (trn.reviewedByUser.originalValue) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalValue}\n`;
              }
              newPreviewOutput += `     Finalna wartość: NIEROZPOZNANE\n`;
            } else if (trn.reviewedByUser.action === 'manual') {
              newPreviewOutput += `  ✏️  WPISANO RĘCZNIE\n`;
              if (trn.reviewedByUser.originalValue !== undefined) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalValue || 'NIE ZNALEZIONO'}\n`;
              }
              newPreviewOutput += `     Ręcznie wpisano: ${trn.reviewedByUser.manualValue}\n`;
              newPreviewOutput += `     Finalna wartość: ${trn.extracted.apartmentNumber}\n`;
            }
            
            newPreviewOutput += `\n`;
          });
        }
        
        // ========== EXPENSES SECTION ==========
        if (reviewedExpenses.length > 0) {
          newPreviewOutput += '─'.repeat(80) + '\n';
          newPreviewOutput += '💸 WYDATKI (EXPENSES)\n';
          newPreviewOutput += '─'.repeat(80) + '\n\n';
          
          reviewedExpenses.forEach((trn: any) => {
            const transactionIndex = updatedTransactions.indexOf(trn) + 1;
            newPreviewOutput += `Pozycja #${transactionIndex}:\n`;
            
            if (trn.reviewedByUser.action === 'accept') {
              newPreviewOutput += `  ✅ ZAAKCEPTOWANO\n`;
              if (trn.matchedContractor?.contractor) {
                newPreviewOutput += `     Kontrahent: ${trn.matchedContractor.contractor.nazwa}\n`;
                newPreviewOutput += `     Konto: ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
              }
            } else if (trn.reviewedByUser.action === 'reject') {
              newPreviewOutput += `  ❌ ODRZUCONO - NIEROZPOZNANY KONTRAHENT\n`;
              if (trn.reviewedByUser.originalContractorValue) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalContractorValue.name || 'NIE ZNALEZIONO'}\n`;
              }
              newPreviewOutput += `     Finalna wartość: NIEROZPOZNANY\n`;
            } else if (trn.reviewedByUser.action === 'manual') {
              newPreviewOutput += `  ✏️  WYBRANO RĘCZNIE\n`;
              if (trn.reviewedByUser.originalContractorValue) {
                newPreviewOutput += `     Oryginalna wartość: ${trn.reviewedByUser.originalContractorValue.name || 'NIE ZNALEZIONO'}\n`;
              }
              
              // Show the manually selected contractor
              if (trn.reviewedByUser.manualContractorId && trn.matchedContractor?.contractor) {
                newPreviewOutput += `     Ręcznie wybrano: ${trn.matchedContractor.contractor.nazwa}\n`;
                newPreviewOutput += `     Konto kontrahenta: ${trn.matchedContractor.contractor.kontoKontrahenta}\n`;
                newPreviewOutput += `     NIP: ${trn.matchedContractor.contractor.nip || 'N/A'}\n`;
              }
            }
            
            newPreviewOutput += `\n`;
          });
        }
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

  /**
   * Check if AI is configured and ready to use
   */
  isAIConfigured(): boolean {
    if (!this.aiConfig || !this.aiConfig.ai) {
      return false;
    }
    
    const provider = this.aiConfig.ai.default_provider;
    if (provider === 'anthropic') {
      return !!this.aiConfig.ai.anthropic_api_key && this.aiConfig.ai.anthropic_api_key.length > 0;
    } else if (provider === 'openai') {
      return !!this.aiConfig.ai.openai_api_key && this.aiConfig.ai.openai_api_key.length > 0;
    }
    
    return false;
  }
}

export default ConverterRegistry;
