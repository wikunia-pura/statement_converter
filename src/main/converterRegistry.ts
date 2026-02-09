import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { app } from 'electron';
import { Converter } from '../shared/types';
import { SantanderXmlConverter } from '../converters/santander-xml';

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
    confidenceThreshold: number = 95
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

      const lowConfidenceTransactions = result.processed.filter(
        trn => trn.extracted.confidence.overall < confidenceThreshold
      );

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

          // Use the real Santander XML converter
          const converter = new SantanderXmlConverter({
            aiProvider: provider,
            apiKey,
            batchSize: 20,
            confidenceThresholds: {
              autoApprove: 85,
              needsReview: 60,
            },
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
            output += `${idx + 1}. ${trn.original.descBase}\n`;
            output += `   Date: ${trn.original.exeDate}\n`;
            output += `   Amount: ${trn.original.value} PLN\n`;
            output += `   Apartment: ${trn.extracted.apartmentNumber || 'N/A'} (confidence: ${trn.extracted.confidence.apartment || 0}%)\n`;
            output += `   Full Address: ${trn.extracted.fullAddress || 'N/A'}\n`;
            output += `   Tenant: ${trn.extracted.tenantName || 'N/A'}\n`;
            output += `   Status: ${trn.status}\n`;
            output += `   Overall Confidence: ${trn.extracted.confidence.overall}%\n`;
            output += `   Method: ${trn.extracted.extractionMethod || 'N/A'}\n\n`;
          });

          fs.writeFileSync(outputPath, output, 'utf8');
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
