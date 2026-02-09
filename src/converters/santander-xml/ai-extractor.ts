/**
 * AI Extractor using Claude/OpenAI
 * For complex cases that regex can't handle
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ExtractedData, XmlTransaction, AIExtractionRequest, AIExtractionResponse, ConverterConfig } from './types';

export class AIExtractor {
  private anthropic?: Anthropic;
  private openai?: OpenAI;
  private config: ConverterConfig;

  constructor(config: ConverterConfig) {
    this.config = config;

    if (config.aiProvider === 'anthropic' && config.apiKey) {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    } else if (config.aiProvider === 'openai' && config.apiKey) {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    }
  }

  /**
   * Extract data from a single transaction using AI
   */
  async extractSingle(transaction: XmlTransaction): Promise<ExtractedData> {
    const results = await this.extractBatch([transaction]);
    return results[0];
  }

  /**
   * Extract data from multiple transactions in a single API call (batch processing)
   */
  async extractBatch(transactions: XmlTransaction[]): Promise<ExtractedData[]> {
    if (this.config.aiProvider === 'anthropic') {
      return this.extractWithClaude(transactions);
    } else if (this.config.aiProvider === 'openai') {
      return this.extractWithOpenAI(transactions);
    } else {
      throw new Error('No AI provider configured');
    }
  }

  /**
   * Extract using Claude API (recommended)
   */
  private async extractWithClaude(transactions: XmlTransaction[]): Promise<ExtractedData[]> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.getUserPrompt(transactions);

    try {
      const message = await this.anthropic.messages.create({
        model: this.config.model || 'claude-3-5-sonnet-20241022',
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

      const response: AIExtractionResponse = JSON.parse(content.text);
      return this.processAIResponse(response, transactions);
    } catch (error) {
      console.error('Claude API error:', error);
      throw new Error(`Failed to extract with Claude: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract using OpenAI API
   */
  private async extractWithOpenAI(transactions: XmlTransaction[]): Promise<ExtractedData[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.getUserPrompt(transactions);

    try {
      const completion = await this.openai.chat.completions.create({
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

      const response: AIExtractionResponse = JSON.parse(content);
      return this.processAIResponse(response, transactions);
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw new Error(`Failed to extract with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * System prompt for AI
   */
  private getSystemPrompt(): string {
    return `You are a data extraction specialist for Polish real estate management software.
Your job is to extract structured data from messy bank transfer descriptions in Polish.

Extract the following information:
1. Street name (e.g., "Joliot-Curie")
2. Building number (e.g., "3")
3. Apartment/unit number (e.g., "27")
4. Tenant name (person making the payment)

Common patterns:
- Address format: "Joliot-Curie 3/27" means building 3, apartment 27
- Variations: "JOLIOT CURIE 3 M.11", "J.CURIE 3/27", "JCURIE 3/34"
- Identifiers: "IDENTYFIKATOR: 27/4" or "ID 22211214" are very reliable
- Names appear in various formats: "EWA TERESA OSIECKA-CISOWSKA" or "KRZYSZTOF MIECZYSŁAW WAŁBIŃSKI"

Data may contain typos, inconsistent formatting, or missing information.

IMPORTANT:
- Provide confidence scores (0-100) for each field
- Explain your reasoning
- If you can't find data with confidence, mark it as null
- Normalize street names to "Joliot-Curie" format
- Normalize names to Title Case

Return ONLY valid JSON matching the required schema.`;
  }

  /**
   * User prompt with transaction data
   */
  private getUserPrompt(transactions: XmlTransaction[]): string {
    const examples = this.getExamples();
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
      "streetName": "Joliot-Curie" | null,
      "buildingNumber": "3" | null,
      "apartmentNumber": "27" | null,
      "fullAddress": "Joliot-Curie 3/27" | null,
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
    return `Examples of correct extractions:

Example 1:
  DESC-BASE: "FUNDUSZ REMONTOWY"
  DESC-OPT: "EWA TERESA OSIECKA-CISOWSKA UL. JOLIOT-CURIE 3/27 02-646 WARSZAWA"
  
  Extraction:
  {
    "streetName": "Joliot-Curie",
    "buildingNumber": "3",
    "apartmentNumber": "27",
    "fullAddress": "Joliot-Curie 3/27",
    "tenantName": "Ewa Teresa Osiecka-Cisowska",
    "confidence": { "address": 95, "apartment": 95, "tenantName": 90 },
    "reasoning": "Clear address format 3/27 in desc-opt, name before UL."
  }

Example 2:
  DESC-BASE: "CZYNSZ I FUNDUSZ REMONTOWY ZA LOKALJOLIOT-CURIE 3/4 IDENTYFIKATOR: 27/4"
  DESC-OPT: "SYLWESTER ŚCIŚLEWSKI  UL.JOLIOT-CURIE 3 M.4 02-646 WARSZAWA"
  
  Extraction:
  {
    "streetName": "Joliot-Curie",
    "buildingNumber": "3",
    "apartmentNumber": "4",
    "fullAddress": "Joliot-Curie 3/4",
    "tenantName": "Sylwester Ściślewski",
    "confidence": { "address": 98, "apartment": 98, "tenantName": 95 },
    "reasoning": "High confidence: IDENTYFIKATOR confirms 27/4, address confirmed in both fields"
  }

Example 3:
  DESC-BASE: "Op�aty eksploatacyjne i za funduszremontowy lokalu 17"
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
   * Process AI response and convert to ExtractedData format
   */
  private processAIResponse(
    response: AIExtractionResponse,
    transactions: XmlTransaction[]
  ): ExtractedData[] {
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
        extractionMethod: 'ai',
        reasoning: result.reasoning,
        warnings: overall < 60 ? ['Low confidence extraction'] : [],
        rawData: {
          descBase: transaction.descBase,
          descOpt: transaction.descOpt,
        },
      };
    });
  }
}
