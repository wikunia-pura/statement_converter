/**
 * Shared AI Extractor using Claude/OpenAI
 * Converter-independent — for complex cases that regex can't handle.
 * Each converter maps its bank-specific transaction to AITransaction before calling this.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AITransaction, AIExtractedData, AIExtractionResponse, AIConfig } from './ai-types';
import logger from './logger';

export class AIExtractor {
  private anthropic?: Anthropic;
  private openai?: OpenAI;
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;

    if (config.aiProvider === 'anthropic' && config.apiKey) {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    } else if (config.aiProvider === 'openai' && config.apiKey) {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    }
  }

  /**
   * Retry logic with exponential backoff for transient errors
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 1s, 2s, 4s, max 10s
          logger.debug(`[AI-EXTRACTOR] Retry attempt ${attempt}/${maxRetries} after ${delay}ms for ${operationName}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);
        
        if (!isRetryable) {
          logger.debug(`[AI-EXTRACTOR] Non-retryable error for ${operationName}, failing immediately`);
          throw error;
        }
        
        if (attempt === maxRetries) {
          logger.error(`[AI-EXTRACTOR] Max retries (${maxRetries}) reached for ${operationName}`);
          throw error;
        }
        
        logger.warn(`[AI-EXTRACTOR] Retryable error for ${operationName} (attempt ${attempt + 1}/${maxRetries + 1}):`, 
          error instanceof Error ? error.message : error);
      }
    }
    
    throw lastError;
  }

  /**
   * Check if error is retryable (transient errors like 529, 503, timeouts)
   */
  private isRetryableError(error: any): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    
    // Check for HTTP status codes that are retryable
    const status = error.status || error.statusCode;
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529) {
      return true;
    }
    
    // Check for quota/billing errors (NOT retryable)
    const errorType = error.error?.type || '';
    const message = (error.message || '').toLowerCase();
    const code = (error.code || '').toLowerCase();
    
    if (status === 402 || 
        errorType === 'insufficient_quota' || 
        code === 'insufficient_quota' ||
        message.includes('quota') ||
        message.includes('billing') ||
        message.includes('payment required')) {
      return false; // Don't retry quota errors
    }
    
    // Check for network timeouts (retryable)
    if (message.includes('timeout') || message.includes('econnreset') || message.includes('network')) {
      return true;
    }
    
    return false;
  }

  /**
   * Clean JSON response from markdown formatting
   */
  private cleanJsonResponse(text: string): string {
    let cleaned = text.trim();
    
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    
    return cleaned.trim();
  }

  /**
   * Parse JSON with better error handling
   */
  private parseJsonResponse(text: string): any {
    let cleaned = this.cleanJsonResponse(text);
    
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      // First attempt failed - try to extract JSON from text
      // Sometimes Claude adds text after JSON or JSON is incomplete
      logger.warn('[AI-EXTRACTOR] Initial JSON parse failed, trying to extract valid JSON...');
      
      // Try to find JSON object boundaries
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const extracted = cleaned.substring(firstBrace, lastBrace + 1);
        try {
          logger.debug('[AI-EXTRACTOR] Attempting to parse extracted JSON (between first { and last })');
          return JSON.parse(extracted);
        } catch (extractError) {
          logger.error('[AI-EXTRACTOR] Extraction also failed');
        }
      }
      
      // If extraction failed, log detailed error
      logger.error('[AI-EXTRACTOR] Failed to parse JSON response');
      logger.error('[AI-EXTRACTOR] Raw text (first 500 chars):', text.substring(0, 500));
      logger.error('[AI-EXTRACTOR] Cleaned text (first 500 chars):', cleaned.substring(0, 500));
      logger.error('[AI-EXTRACTOR] Cleaned text (last 200 chars):', cleaned.substring(Math.max(0, cleaned.length - 200)));
      
      if (error instanceof Error) {
        throw new Error(`JSON parse error: ${error.message}. Response preview: ${cleaned.substring(0, 100)}...`);
      }
      throw new Error(`JSON parse error. Response preview: ${cleaned.substring(0, 100)}...`);
    }
  }

  /**
   * Extract data from a single transaction using AI
   */
  async extractSingle(transaction: AITransaction): Promise<AIExtractedData> {
    const results = await this.extractBatch([transaction]);
    return results[0];
  }

  /**
   * Extract data from multiple transactions in a single API call (batch processing)
   */
  async extractBatch(transactions: AITransaction[]): Promise<AIExtractedData[]> {
    logger.debug('[AI-EXTRACTOR] extractBatch called with', transactions.length, 'transactions');
    logger.debug('[AI-EXTRACTOR] Provider:', this.config.aiProvider);
    logger.debug('[AI-EXTRACTOR] TEST_AI_BILLING_ERROR env var =', process.env.TEST_AI_BILLING_ERROR);
    
    if (this.config.aiProvider === 'anthropic') {
      return this.extractWithClaude(transactions);
    } else if (this.config.aiProvider === 'openai') {
      return this.extractWithOpenAI(transactions);
    } else {
      throw new Error('No AI provider configured');
    }
  }

  /**
   * Match contractors for expense transactions using AI
   */
  async matchContractorsBatch(
    transactions: AITransaction[],
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; nip?: string; alternativeNames?: string[] }>>
  ): Promise<Array<{ contractor: any | null; confidence: number; matchedIn: 'desc-opt' | 'desc-base' | 'none'; matchedText?: string; reasoning?: string }>> {
    if (this.config.aiProvider === 'anthropic') {
      return this.matchContractorsWithClaude(transactions, candidatesPerTransaction);
    } else if (this.config.aiProvider === 'openai') {
      return this.matchContractorsWithOpenAI(transactions, candidatesPerTransaction);
    } else {
      throw new Error('No AI provider configured');
    }
  }

  /**
   * Extract using Claude API (with retry logic)
   */
  private async extractWithClaude(transactions: AITransaction[]): Promise<AIExtractedData[]> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.getUserPrompt(transactions);

    return this.retryWithBackoff(async () => {
      try {
        // TEST MODE: Simulate billing error if TEST_AI_BILLING_ERROR is set
        logger.debug('[AI-EXTRACTOR] TEST_AI_BILLING_ERROR =', process.env.TEST_AI_BILLING_ERROR);
        if (process.env.TEST_AI_BILLING_ERROR === 'true') {
          logger.info('[AI-EXTRACTOR] 🧪 TEST MODE: Simulating billing error');
          const testError = {
            status: 429,
            error: { type: 'insufficient_quota' },
            message: 'TEST: Simulating insufficient quota error'
          };
          throw testError;
        }

        // TEST MODE: Simulate generic AI error if TEST_AI_GENERIC_ERROR is set
        logger.debug('[AI-EXTRACTOR] TEST_AI_GENERIC_ERROR =', process.env.TEST_AI_GENERIC_ERROR);
        if (process.env.TEST_AI_GENERIC_ERROR === 'true') {
          logger.info('[AI-EXTRACTOR] 🧪 TEST MODE: Simulating generic AI error');
          throw new Error('TEST: Simulating network timeout error');
        }

        const message = await this.anthropic!.messages.create({
          model: this.config.model || 'claude-sonnet-4-6',
          max_tokens: 2000 + (transactions.length * 200),
          temperature: 0,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        });

        const content = message.content[0];
        if (content.type !== 'text') {
          throw new Error('Unexpected response type from Claude');
        }

        const response: AIExtractionResponse = this.parseJsonResponse(content.text);
        return this.processAIResponse(response, transactions);
      } catch (error) {
        logger.error('Claude API error (extract):', error);
        
        // Check for billing/quota errors - throw with special message
        if (error && typeof error === 'object' && 'status' in error) {
          const apiError = error as any;
          const status = apiError.status;
          const message = apiError.message || '';
          const errorType = apiError.error?.type || '';
          
          // 402 = payment required, quota errors
          if (status === 402 || 
              errorType === 'insufficient_quota' || 
              message.toLowerCase().includes('quota') ||
              message.toLowerCase().includes('billing') ||
              message.toLowerCase().includes('payment required')) {
            throw new Error('💸 Brak kasiory. Pogadaj z Olą');
          }
          
          // For other status errors, throw with status code
          throw new Error(`Claude API error (${status}): ${message || 'Unknown error'}`);
        }
        
        throw new Error(`Failed to extract with Claude: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }, 'Claude extraction');
  }

  /**
   * Extract using OpenAI API (with retry logic)
   */
  private async extractWithOpenAI(transactions: AITransaction[]): Promise<AIExtractedData[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.getUserPrompt(transactions);

    return this.retryWithBackoff(async () => {
      try {
        // TEST MODE: Simulate billing error if TEST_AI_BILLING_ERROR is set
        logger.debug('[AI-EXTRACTOR] TEST_AI_BILLING_ERROR =', process.env.TEST_AI_BILLING_ERROR);
        if (process.env.TEST_AI_BILLING_ERROR === 'true') {
          logger.info('[AI-EXTRACTOR] 🧪 TEST MODE: Simulating billing error');
          const testError = {
            status: 429,
            code: 'insufficient_quota',
            message: 'TEST: Simulating insufficient quota error'
          };
          throw testError;
        }

        // TEST MODE: Simulate generic AI error if TEST_AI_GENERIC_ERROR is set
        logger.debug('[AI-EXTRACTOR] TEST_AI_GENERIC_ERROR =', process.env.TEST_AI_GENERIC_ERROR);
        if (process.env.TEST_AI_GENERIC_ERROR === 'true') {
          logger.info('[AI-EXTRACTOR] 🧪 TEST MODE: Simulating generic AI error');
          throw new Error('TEST: Simulating network timeout error');
        }

        const completion = await this.openai!.chat.completions.create({
          model: this.config.model || 'gpt-4-turbo-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        });

        const content = completion.choices[0].message.content;
        if (!content) {
          throw new Error('Empty response from OpenAI');
        }

        const response: AIExtractionResponse = this.parseJsonResponse(content);
        return this.processAIResponse(response, transactions);
      } catch (error) {
        logger.error('OpenAI API error (extract):', error);
        
        if (error && typeof error === 'object') {
          logger.error('Error details:', JSON.stringify(error, null, 2));
        }
        
        // Check for billing/quota errors - throw with special message
        if (error && typeof error === 'object' && 'status' in error) {
          const apiError = error as any;
          const status = apiError.status;
          const code = apiError.code || '';
          const message = apiError.message || '';
          
          // Check for quota/billing errors
          if (status === 402 || 
              code === 'insufficient_quota' ||
              message.toLowerCase().includes('quota') ||
              message.toLowerCase().includes('billing') ||
              message.toLowerCase().includes('payment required')) {
            throw new Error('💸 Brak kasiory. Pogadaj z Olą');
          }
          
          // For other status errors, throw with status code
          throw new Error(`OpenAI API error (${status}): ${message || 'Unknown error'}`);
        }
        
        throw new Error(`Failed to extract with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }, 'OpenAI extraction');
  }

  /**
   * System prompt for AI
   */
  private getSystemPrompt(): string {
    const addresses = this.config.addresses || [];
    
    let addressExamples = '';
    if (addresses.length > 0) {
      const exampleAddr = addresses[0];
      const altNamesText = exampleAddr.alternativeNames && exampleAddr.alternativeNames.length > 0
        ? exampleAddr.alternativeNames.join(', ')
        : '';
      
      addressExamples = `1. Street name (e.g., "${exampleAddr.nazwa}"${altNamesText ? ` or variants: ${altNamesText}` : ''})
2. Building number (e.g., "3")
3. Apartment/unit number (e.g., "27")
4. Tenant name (person making the payment)

Known addresses in the system:
${addresses.map(a => {
  const alts = a.alternativeNames && a.alternativeNames.length > 0 
    ? ` (variants: ${a.alternativeNames.join(', ')})` 
    : '';
  return `- ${a.nazwa}${alts}`;
}).join('\n')}

Common patterns:
- Address format: "${exampleAddr.nazwa} 3/27" means building 3, apartment 27
- Variations: "${exampleAddr.nazwa.toUpperCase()} 3 M.11", "${exampleAddr.nazwa.substring(0, 2).toUpperCase()}.${exampleAddr.nazwa.split(' ')[exampleAddr.nazwa.split(' ').length - 1].toUpperCase()} 3/27"`;
    } else {
      addressExamples = `1. Street name
2. Building number
3. Apartment/unit number
4. Tenant name (person making the payment)

Common patterns:
- Address format: "Street 3/27" means building 3, apartment 27
- Variations: "STREET 3 M.11", "STR 3/27"`;
    }
    
    return `You are a data extraction specialist for Polish real estate management software.
Your job is to extract structured data from messy bank transfer descriptions in Polish.

Extract the following information:
${addressExamples}
- Identifiers: "IDENTYFIKATOR: 27/4" or "ID 22211214" are very reliable
- Names appear in various formats: "EWA TERESA OSIECKA-CISOWSKA" or "KRZYSZTOF MIECZYSŁAW WAŁBIŃSKI"

Data may contain typos, inconsistent formatting, or missing information.

IMPORTANT:
- Provide confidence scores (0-100) for each field
- Explain your reasoning in ${this.config.language === 'en' ? 'English' : 'Polish'}
- If you can't find data with confidence, mark it as null
- Normalize street names to match the primary name from the known addresses list
- Normalize names to Title Case

Return ONLY valid JSON matching the required schema.`;
  }

  /**
   * User prompt with transaction data
   */
  private getUserPrompt(transactions: AITransaction[]): string {
    const examples = this.getExamples();
    const addresses = this.config.addresses || [];
    
    const exampleAddr = addresses.length > 0 ? addresses[0].nazwa : 'StreetName';
    
    const transactionsData = transactions
      .map((t, i) => ({
        index: i,
        descBase: t.descBase,
        descOpt: t.descOpt,
        value: t.value,
        date: t.exeDate,
      }))
      .map(
        (t) => `
Transaction ${t.index}:
  DESC-BASE: ${t.descBase}
  DESC-OPT: ${t.descOpt}
  AMOUNT: ${t.value} PLN
  DATE: ${t.date}`
      )
      .join('\n---');

    return `${examples}

Now extract from these ${transactions.length} transaction(s):

${transactionsData}

Return a JSON object with this exact structure:
{
  "results": [
    {
      "index": 0,
      "streetName": "${exampleAddr}" | null,
      "buildingNumber": "3" | null,
      "apartmentNumber": "27" | null,
      "fullAddress": "${exampleAddr} 3/27" | null,
      "tenantName": "Ewa Teresa Osiecka-Cisowska" | null,
      "confidence": {
        "address": 95,
        "apartment": 90,
        "tenantName": 85
      },
      "reasoning": "Found clear identifier and name in desc-opt"
    }
  ]
}`;
  }

  /**
   * Few-shot examples for better accuracy
   */
  private getExamples(): string {
    const addresses = this.config.addresses || [];
    
    if (addresses.length > 0) {
      const addr1 = addresses[0];
      const addr1Upper = addr1.nazwa.toUpperCase();
      const addr1Alt = addr1.alternativeNames && addr1.alternativeNames.length > 0
        ? addr1.alternativeNames[0]
        : addr1Upper;
      
      return `Examples of correct extractions:

Example 1:
  DESC-BASE: "FUNDUSZ REMONTOWY"
  DESC-OPT: "EWA TERESA OSIECKA-CISOWSKA UL. ${addr1Upper} 3/27 02-646 WARSZAWA"
  
  Extraction:
  {
    "streetName": "${addr1.nazwa}",
    "buildingNumber": "3",
    "apartmentNumber": "27",
    "fullAddress": "${addr1.nazwa} 3/27",
    "tenantName": "Ewa Teresa Osiecka-Cisowska",
    "confidence": { "address": 95, "apartment": 95, "tenantName": 90 },
    "reasoning": "Clear address format 3/27 in desc-opt, name before UL."
  }

Example 2:
  DESC-BASE: "CZYNSZ I FUNDUSZ REMONTOWY ZA LOKAL${addr1Upper} 3/4 IDENTYFIKATOR: 27/4"
  DESC-OPT: "SYLWESTER ŚCIŚLEWSKI  UL.${addr1Alt} 3 M.4 02-646 WARSZAWA"
  
  Extraction:
  {
    "streetName": "${addr1.nazwa}",
    "buildingNumber": "3",
    "apartmentNumber": "4",
    "fullAddress": "${addr1.nazwa} 3/4",
    "tenantName": "Sylwester Ściślewski",
    "confidence": { "address": 98, "apartment": 98, "tenantName": 95 },
    "reasoning": "High confidence: IDENTYFIKATOR confirms 27/4, address confirmed in both fields"
  }

Example 3:
  DESC-BASE: "Op\u0142aty eksploatacyjne i za funduszremontowy lokalu 17"
  DESC-OPT: "KOSKA DANIEL  UL RÓŻANA 11 77-100 RZEPNICA"
  
  Extraction:
  {
    "streetName": null,
    "buildingNumber": null,
    "apartmentNumber": "17",
    "fullAddress": null,
    "tenantName": "Daniel Koska",
    "confidence": { "address": 0, "apartment": 70, "tenantName": 85 },
    "reasoning": "Only apartment number 'lokalu 17' found, different address in desc-opt, name extracted"
  }`;
    }
    
    return `Examples of correct extractions:

Example 1:
  DESC-BASE: "FUNDUSZ REMONTOWY"
  DESC-OPT: "EWA TERESA OSIECKA-CISOWSKA UL. EXAMPLE STREET 3/27 02-646 WARSZAWA"
  
  Extraction:
  {
    "streetName": "Example Street",
    "buildingNumber": "3",
    "apartmentNumber": "27",
    "fullAddress": "Example Street 3/27",
    "tenantName": "Ewa Teresa Osiecka-Cisowska",
    "confidence": { "address": 95, "apartment": 95, "tenantName": 90 },
    "reasoning": "Clear address format 3/27 in desc-opt, name before UL."
  }

Example 2:
  DESC-BASE: "Op\u0142aty eksploatacyjne i za funduszremontowy lokalu 17"
  DESC-OPT: "KOSKA DANIEL  UL RÓŻANA 11 77-100 RZEPNICA"
  
  Extraction:
  {
    "streetName": null,
    "buildingNumber": null,
    "apartmentNumber": "17",
    "fullAddress": null,
    "tenantName": "Daniel Koska",
    "confidence": { "address": 0, "apartment": 70, "tenantName": 85 },
    "reasoning": "Only apartment number 'lokalu 17' found, different address in desc-opt, name extracted"
  }`;
  }

  /**
   * Process AI response and convert to AIExtractedData format
   */
  private processAIResponse(
    response: AIExtractionResponse,
    transactions: AITransaction[]
  ): AIExtractedData[] {
    return response.results.map((result) => {
      const transaction = transactions[result.index];
      
      const overall = Math.round(
        (result.confidence.address + result.confidence.apartment + result.confidence.tenantName) / 3
      );
      
      return {
        streetName: result.streetName,
        buildingNumber: result.buildingNumber,
        apartmentNumber: result.apartmentNumber,
        fullAddress: result.fullAddress,
        tenantName: result.tenantName,
        confidence: {
          ...result.confidence,
          overall,
        },
        extractionMethod: 'ai' as const,
        reasoning: result.reasoning,
        warnings: overall < 60 ? ['Low confidence - review required'] : [],
        rawData: {
          descBase: transaction.descBase,
          descOpt: transaction.descOpt,
        },
      };
    });
  }

  /**
   * Match contractors using Claude API (with retry logic)
   */
  private async matchContractorsWithClaude(
    transactions: AITransaction[],
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; alternativeNames?: string[] }>>
  ): Promise<Array<{ contractor: any | null; confidence: number; matchedIn: 'desc-opt' | 'desc-base' | 'none'; matchedText?: string; reasoning?: string }>> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const systemPrompt = this.getContractorMatchingSystemPrompt();
    const userPrompt = this.getContractorMatchingUserPrompt(transactions, candidatesPerTransaction);

    return this.retryWithBackoff(async () => {
      try {
        const message = await this.anthropic!.messages.create({
          model: this.config.model || 'claude-sonnet-4-6',
          max_tokens: 2000 + (transactions.length * 300),
          temperature: 0,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        });

        const content = message.content[0];
        if (content.type !== 'text') {
          throw new Error('Unexpected response type from Claude');
        }

        const response = this.parseJsonResponse(content.text);
        return this.processContractorMatchingResponse(response, candidatesPerTransaction);
      } catch (error) {
        logger.error('Claude API error (contractor matching):', error);
        
        if (error && typeof error === 'object') {
          logger.error('Error details:', JSON.stringify(error, null, 2));
        }
        
        // Check for billing/quota errors - throw with special message
        if (error && typeof error === 'object' && 'status' in error) {
          const apiError = error as any;
          const status = apiError.status;
          const message = apiError.message || '';
          const errorType = apiError.error?.type || '';
          
          // 402 = payment required, quota errors
          if (status === 402 || 
              errorType === 'insufficient_quota' || 
              message.toLowerCase().includes('quota') ||
              message.toLowerCase().includes('billing') ||
              message.toLowerCase().includes('payment required')) {
            throw new Error('💸 Brak kasiory. Pogadaj z Olą');
          }
          
          // For other status errors, throw with status code
          throw new Error(`Claude API error (${status}): ${message || 'Unknown error'}`);
        }
        
        throw new Error(`Failed to match contractors with Claude: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }, 'Claude contractor matching');
  }

  /**
   * Match contractors using OpenAI API (with retry logic)
   */
  private async matchContractorsWithOpenAI(
    transactions: AITransaction[],
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; alternativeNames?: string[] }>>
  ): Promise<Array<{ contractor: any | null; confidence: number; matchedIn: 'desc-opt' | 'desc-base' | 'none'; matchedText?: string; reasoning?: string }>> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const systemPrompt = this.getContractorMatchingSystemPrompt();
    const userPrompt = this.getContractorMatchingUserPrompt(transactions, candidatesPerTransaction);

    return this.retryWithBackoff(async () => {
      try {
        const completion = await this.openai!.chat.completions.create({
          model: this.config.model || 'gpt-4-turbo-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 2000 + (transactions.length * 300),
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response from OpenAI');
        }

        const response = this.parseJsonResponse(content);
        return this.processContractorMatchingResponse(response, candidatesPerTransaction);
      } catch (error) {
        logger.error('OpenAI API error (contractor matching):', error);
        
        if (error && typeof error === 'object') {
          logger.error('Error details:', JSON.stringify(error, null, 2));
        }
        
        // Check for billing/quota errors - throw with special message
        if (error && typeof error === 'object' && 'status' in error) {
          const apiError = error as any;
          const status = apiError.status;
          const code = apiError.code || '';
          const message = apiError.message || '';
          
          // Check for quota/billing errors
          if (status === 402 || 
              code === 'insufficient_quota' ||
              message.toLowerCase().includes('quota') ||
              message.toLowerCase().includes('billing') ||
              message.toLowerCase().includes('payment required')) {
            throw new Error('💸 Brak kasiory. Pogadaj z Olą');
          }
          
          // For other status errors, throw with status code
          throw new Error(`OpenAI API error (${status}): ${message || 'Unknown error'}`);
        }
        
        throw new Error(`Failed to match contractors with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }, 'OpenAI contractor matching');
  }

  /**
   * Get system prompt for contractor matching
   */
  private getContractorMatchingSystemPrompt(): string {
    return `Dopasuj transakcje bankowe do kontrahentów z BAZY UŻYTKOWNIKA.

🔒 KRYTYCZNE: Lista kandydatów dla każdej transakcji to PRE-FILTROWANE kontrahenty z bazy użytkownika.
- MOŻESZ TYLKO wybrać ID z dostarczonych kandydatów lub zwrócić null
- NIE WOLNO Ci wymyślać/sugerować innych kontrahentów
- Jeśli żaden kandydat nie pasuje → zwróć null
- ℹ️ Lista kandydatów zawiera: exact matches + podobne nazwy (fuzzy match) - może zawierać typo/literówki

ZASADY DOPASOWANIA:
1. Analizuj DESC-BASE i DESC-OPT (DESC-OPT priorytet)
2. PRIORYTET DOPASOWANIA (od najwyższego):
   a) NIP - jeśli NIP kontrahenta jest zawarty W CAŁOŚCI w opisie = 100% confidence
   b) Nazwa główna ORAZ nazwy alternatywne - traktuj RÓWNORZĘDNIE, TEN SAM confidence
   c) Podobne nazwy (typo/literówki) - jeśli nazwa jest bardzo podobna do opisu (np. "Guntarek" vs "Gontarek")
3. Dopasowanie NIP: NIP musi być W CAŁOŚCI zawarty w opisie (ignoruj spacje i myślniki)
   - Przykład: opis "Zapłata NIP:1234567890" + NIP "1234567890" = DOPASOWANE ✓ (confidence: 100)
   - Przykład: opis "Zapłata NIP 123-456-78-90" + NIP "1234567890" = DOPASOWANE ✓ (confidence: 100)
   - Przykład: opis "Zapłata NIP:123456789" + NIP "1234567890" = NIE dopasowane ✗
4. Dopasowanie nazwa: nazwa główna LUB którakolwiek alternatywna nazwa musi być W CAŁOŚCI zawarta w opisie
   - WAŻNE: Nazwa główna i alternatywna mają IDENTYCZNY confidence - nie preferuj jednej nad drugą!
   - Przykład: opis "Zapłata dla MPWIK" + nazwa główna "Miejskie Przedsiębiorstwo Wodociągów i Kanalizacji" = NIE dopasowane ✗
   - Przykład: opis "Zapłata dla MPWIK" + alternatywna nazwa "MPWIK" = DOPASOWANE ✓ (confidence: 95)
   - Przykład: opis "Zapłata dla MPWI" + alternatywna nazwa "MPWIK" = NIE dopasowane ✗
5. Dopasowanie fuzzy (podobne nazwy):
   - Jeśli nazwa kontrahenta jest BARDZO PODOBNA do nazwy w opisie (1-2 litery różnicy), uznaj za dopasowanie
   - Przykład: opis "Jolanta Gontarek" + nazwa "Jolanta Guntarek" = DOPASOWANE (typo: o→u) ✓ (confidence: 90-95)
   - Przykład: opis "MPWIK Warszawa" + nazwa "MPWICK Warszawa" = DOPASOWANE (typo: I→IC) ✓ (confidence: 90-95)
6. Wielkość liter ignoruj
7. Confidence (0-100):
   - 100: Pełny NIP w opisie
   - 95-99: Pełna nazwa główna LUB pełna alt. nazwa w opisie (TEN SAM poziom!)
   - 90-94: Bardzo podobna nazwa (fuzzy match z 1-2 literami różnicy)
   - 70-89: Częściowa nazwa/akronim
   - 50-69: Prawdopodobne
   - <50: Zwróć null

📝 REASONING:
- Maksymalnie 150 znaków
- Zwięzłe, bez powtarzania opisu transakcji
- Załóż że czytający widzi już opis transakcji i kandydatów

JSON format:
{
  "results": [
    {
      "index": 0,
      "contractorId": 123 lub null,
      "confidence": 85,
      "matchedIn": "desc-opt" | "desc-base" | "none",
      "reasoning": "Krótkie wyjaśnienie"
    }
  ]
}`;
  }

  /**
   * Get user prompt for contractor matching
   */
  private getContractorMatchingUserPrompt(
    transactions: AITransaction[],
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; nip?: string; alternativeNames?: string[] }>>
  ): string {
    let prompt = '';
    
    transactions.forEach((t, idx) => {
      const candidates = candidatesPerTransaction[idx] || [];
      
      prompt += `\n=== Transakcja ${idx} ===\n`;
      prompt += `DESC-BASE: "${t.descBase}"\n`;
      prompt += `DESC-OPT: "${t.descOpt || '(brak)'}"\n`;
      
      if (candidates.length > 0) {
        prompt += `\n🏦 DOSTĘPNI KONTRAHENCI (z bazy użytkownika - pre-filtrowane top ${candidates.length}):\n`;
        candidates.forEach((c, i) => {
          prompt += `  ${i + 1}. ID:${c.id} "${c.nazwa}"`;
          if (c.nip) {
            prompt += ` [NIP: ${c.nip}]`;
          }
          if (c.alternativeNames && c.alternativeNames.length > 0) {
            prompt += ` [ALT: ${c.alternativeNames.join(', ')}]`;
          }
          prompt += `\n`;
        });
        prompt += `\n⚠️ Wybierz TYLKO z powyższej listy (ID) lub null jeśli żaden nie pasuje\n`;
      } else {
        prompt += `\n❌ Brak kandydatów dla tej transakcji - zwróć contractorId: null\n`;
      }
    });

    prompt += '\n\n📋 PODSUMOWANIE:';
    prompt += '\n- Zwróć JSON z "results" zawierającym dokładnie ' + transactions.length + ' elementów';
    prompt += '\n- Dla każdej transakcji: wybierz ID z listy kandydatów LUB null (jeśli żaden nie pasuje)';
    prompt += '\n- NIE wymyślaj nowych kontrahentów - tylko ID z listy!';
    prompt += '\n- W "reasoning" wyjaśnij ZWIĘŹLE dlaczego wybrałeś tego kontrahenta lub dlaczego null';
    
    return prompt;
  }

  /**
   * Process contractor matching response
   */
  private processContractorMatchingResponse(
    response: any,
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; alternativeNames?: string[] }>>
  ): Array<{ contractor: any | null; confidence: number; matchedIn: 'desc-opt' | 'desc-base' | 'none'; matchedText?: string; reasoning?: string }> {
    return response.results.map((result: any, idx: number) => {
      if (result.contractorId === null || result.confidence < 50) {
        return {
          contractor: null,
          confidence: 0,
          matchedIn: 'none' as const,
          reasoning: result.reasoning,
        };
      }

      const candidates = candidatesPerTransaction[idx] || [];
      const contractor = candidates.find(c => c.id === result.contractorId);
      
      if (!contractor) {
        logger.warn(`[AI-EXTRACTOR] AI returned contractorId ${result.contractorId} for transaction ${idx}, but it's NOT in candidate list! Returning null.`);
        logger.warn(`[AI-EXTRACTOR] Available candidate IDs: ${candidates.map(c => c.id).join(', ')}`);
        return {
          contractor: null,
          confidence: 0,
          matchedIn: 'none' as const,
          reasoning: `AI error: Wybrano ID:${result.contractorId} spoza listy kandydatów`,
        };
      }

      return {
        contractor: {
          id: contractor.id,
          nazwa: contractor.nazwa,
          kontoKontrahenta: contractor.kontoKontrahenta,
        },
        confidence: result.confidence,
        matchedIn: result.matchedIn || 'none',
        matchedText: contractor.nazwa,
        reasoning: result.reasoning,
      };
    });
  }
}
