import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { app } from 'electron';
import { Converter } from '../shared/types';
import { SantanderXmlConverter } from '../converters/santander-xml';
import DatabaseService from './database';

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
    confidenceThreshold: number = 90
  ): Promise<{ totalTransactions: number; lowConfidenceCount: number; averageConfidence: number; needsAI: boolean }> {
    if (converterId === 'santander_xml') {
      const converter = new SantanderXmlConverter({
        aiProvider: 'none',
        apiKey: '',
        batchSize: 20,
        confidenceThresholds: {
          autoApprove: 85,
          needsReview: 60,
        },
      });

      const xmlContent = fs.readFileSync(inputPath, 'latin1');
      const result = await converter.convert(xmlContent);

      // For income transactions: check extracted.confidence.overall
      // For expense transactions: check matchedContractor.confidence
      const lowConfidenceTransactions = result.processed.filter(trn => {
        if (trn.transactionType === 'income') {
          return trn.extracted.confidence.overall < confidenceThreshold;
        } else {
          // For expenses, check contractor matching confidence
          return (trn.matchedContractor?.confidence || 0) < confidenceThreshold;
        }
      });

      return {
        totalTransactions: result.processed.length,
        lowConfidenceCount: lowConfidenceTransactions.length,
        averageConfidence: result.statistics.averageConfidence,
        needsAI: lowConfidenceTransactions.length > 0,
      };
    }
    
    throw new Error(`Unknown converter: ${converterId}`);
  }

  async convert(
    converterId: string,
    inputPath: string,
    outputPath: string,
    useAI: boolean = false
  ): Promise<void> {
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
          });

          const xmlContent = fs.readFileSync(inputPath, 'latin1');
          const result = await converter.convert(xmlContent);

          // Format output as text file with transaction details
          let output = '=== SANTANDER XML CONVERSION RESULTS ===\n\n';
          output += `Summary:\n`;
          output += `- Total transactions: ${result.totalTransactions}\n`;
          output += `- Auto-approved: ${result.summary.autoApproved}\n`;
          output += `- Needs review: ${result.summary.needsReview}\n`;
          output += `- Needs manual input: ${result.summary.needsManualInput}\n`;
          output += `- Skipped: ${result.summary.skipped}\n`;
          output += `- Average confidence: ${result.statistics.averageConfidence.toFixed(1)}%\n\n`;

          output += '=== TRANSACTIONS ===\n\n';
          
          result.processed.forEach((trn, idx) => {
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
            
            if (trn.extracted.reasoning) {
              output += `\n   AI Reasoning:\n`;
              output += `   ${trn.extracted.reasoning}\n`;
            }
            
            output += `\n`;
          });

          fs.writeFileSync(outputPath, output, 'utf8');

          // Generate TXT file for accounting system (tab-separated format)
          const csvOutput = converter.exportToCsv(result.processed);
          const txtPath = outputPath.replace(/\.(txt|TXT)$/, '-accounting.txt');
          fs.writeFileSync(txtPath, csvOutput, 'utf8');
          
          // Generate auxiliary file with contractor matching details
          const auxiliaryOutput = converter.exportAuxiliaryFile(result.processed);
          const auxiliaryPath = outputPath.replace(/\.(txt|TXT)$/, '-auxiliary.txt');
          fs.writeFileSync(auxiliaryPath, auxiliaryOutput, 'utf8');
          
          console.log(`✅ Generated summary: ${outputPath}`);
          console.log(`✅ Generated accounting file: ${txtPath}`);
          console.log(`✅ Generated auxiliary file: ${auxiliaryPath}`);
        } else {
          throw new Error(`Unknown converter: ${converterId}`);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
}

export default ConverterRegistry;
