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
   * Clean JSON response from markdown formatting
   */
  private cleanJsonResponse(text: string): string {
    // Remove markdown code blocks (```json ... ``` or ``` ... ```)
    let cleaned = text.trim();
    
    // Remove opening markdown fence
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    
    // Remove closing markdown fence
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    
    return cleaned.trim();
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
   * Match contractors for expense transactions using AI
   * 
   * @param transactions - Array of transactions to match
   * @param candidatesPerTransaction - Array of pre-filtered contractor candidates for each transaction
   *                                   (e.g., top 10 most likely contractors per transaction)
   */
  async matchContractorsBatch(
    transactions: XmlTransaction[],
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; nip?: string; alternativeNames?: string[] }>>
  ): Promise<Array<{ contractor: any | null; confidence: number; matchedIn: 'desc-opt' | 'desc-base' | 'none'; matchedText?: string }>> {
    if (this.config.aiProvider === 'anthropic') {
      return this.matchContractorsWithClaude(transactions, candidatesPerTransaction);
    } else if (this.config.aiProvider === 'openai') {
      return this.matchContractorsWithOpenAI(transactions, candidatesPerTransaction);
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

      const cleanedJson = this.cleanJsonResponse(content.text);
      const response: AIExtractionResponse = JSON.parse(cleanedJson);
      return this.processAIResponse(response, transactions);
    } catch (error) {
      console.error('Claude API error (extract):', error);
      
      // Log detailed error info
      if (error && typeof error === 'object') {
        console.error('Error details:', JSON.stringify(error, null, 2));
      }
      
      // Check for Anthropic specific error
      if (error && typeof error === 'object' && 'status' in error) {
        const apiError = error as any;
        throw new Error(`Claude API error (${apiError.status}): ${apiError.message || 'Unknown error'}`);
      }
      
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

      const cleanedJson = this.cleanJsonResponse(content);
      const response: AIExtractionResponse = JSON.parse(cleanedJson);
      return this.processAIResponse(response, transactions);
    } catch (error) {
      console.error('❌ OpenAI API error (extract):', error);
      
      // Log detailed error info
      if (error && typeof error === 'object') {
        console.error('Error details:', JSON.stringify(error, null, 2));
      }
      
      throw new Error(`Failed to extract with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * System prompt for AI
   */
  private getSystemPrompt(): string {
    const addresses = this.config.addresses || [];
    
    // Build address examples from database
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
- Explain your reasoning
- If you can't find data with confidence, mark it as null
- Normalize street names to match the primary name from the known addresses list
- Normalize names to Title Case

Return ONLY valid JSON matching the required schema.`;
  }

  /**
   * User prompt with transaction data
   */
  private getUserPrompt(transactions: XmlTransaction[]): string {
    const examples = this.getExamples();
    const addresses = this.config.addresses || [];
    
    // Use first address for example, or generic if none available
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
    
    // Use real addresses from database if available
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
    
    // Fallback to generic examples if no addresses configured
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

  /**
   * Match contractors using Claude API
   */
  private async matchContractorsWithClaude(
    transactions: XmlTransaction[],
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; alternativeNames?: string[] }>>
  ): Promise<Array<{ contractor: any | null; confidence: number; matchedIn: 'desc-opt' | 'desc-base' | 'none'; matchedText?: string }>> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const systemPrompt = this.getContractorMatchingSystemPrompt();
    const userPrompt = this.getContractorMatchingUserPrompt(transactions, candidatesPerTransaction);

    try {
      const message = await this.anthropic.messages.create({
        model: this.config.model || 'claude-sonnet-4-6',
        max_tokens: 1000 + (transactions.length * 100), // Reduced from 150
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

      const cleanedJson = this.cleanJsonResponse(content.text);
      const response = JSON.parse(cleanedJson);
      return this.processContractorMatchingResponse(response, candidatesPerTransaction);
    } catch (error) {
      console.error('Claude API error (contractor matching):', error);
      
      // Log detailed error info  
      if (error && typeof error === 'object') {
        console.error('Error details:', JSON.stringify(error, null, 2));
      }
      
      // Check for Anthropic specific error
      if (error && typeof error === 'object' && 'status' in error) {
        const apiError = error as any;
        throw new Error(`Claude API error (${apiError.status}): ${apiError.message || 'Unknown error'}`);
      }
      
      throw new Error(`Failed to match contractors with Claude: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Match contractors using OpenAI API
   */
  private async matchContractorsWithOpenAI(
    transactions: XmlTransaction[],
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; alternativeNames?: string[] }>>
  ): Promise<Array<{ contractor: any | null; confidence: number; matchedIn: 'desc-opt' | 'desc-base' | 'none'; matchedText?: string }>> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const systemPrompt = this.getContractorMatchingSystemPrompt();
    const userPrompt = this.getContractorMatchingUserPrompt(transactions, candidatesPerTransaction);

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.config.model || 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      const cleanedJson = this.cleanJsonResponse(content);
      const response = JSON.parse(cleanedJson);
      return this.processContractorMatchingResponse(response, candidatesPerTransaction);
    } catch (error) {
      console.error('OpenAI API error (contractor matching):', error);
      
      // Log detailed error info
      if (error && typeof error === 'object') {
        console.error('Error details:', JSON.stringify(error, null, 2));
      }
      
      throw new Error(`Failed to match contractors with OpenAI: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get system prompt for contractor matching
   */
  private getContractorMatchingSystemPrompt(): string {
    return `Dopasuj transakcje bankowe do kontrahentów z listy kandydatów.

ZASADY:
1. Analizuj DESC-BASE i DESC-OPT (DESC-OPT priorytet)
2. PRIORYTET DOPASOWANIA (od najwyższego):
   a) NIP - jeśli NIP kontrahenta jest zawarty W CAŁOŚCI w opisie = 100% confidence
   b) Nazwa główna ORAZ nazwy alternatywne - traktuj RÓWNORZĘDNIE, TEN SAM confidence
3. Dopasowanie NIP: NIP musi być W CAŁOŚCI zawarty w opisie (ignoruj spacje i myślniki)
   - Przykład: opis "Zapłata NIP:1234567890" + NIP "1234567890" = DOPASOWANE ✓ (confidence: 100)
   - Przykład: opis "Zapłata NIP 123-456-78-90" + NIP "1234567890" = DOPASOWANE ✓ (confidence: 100)
   - Przykład: opis "Zapłata NIP:123456789" + NIP "1234567890" = NIE dopasowane ✗
4. Dopasowanie nazwa: nazwa główna LUB którakolwiek alternatywna nazwa musi być W CAŁOŚCI zawarta w opisie
   - WAŻNE: Nazwa główna i alternatywna mają IDENTYCZNY confidence - nie preferuj jednej nad drugą!
   - Przykład: opis "Zapłata dla MPWIK" + nazwa główna "Miejskie Przedsiębiorstwo Wodociągów i Kanalizacji" = NIE dopasowane ✗
   - Przykład: opis "Zapłata dla MPWIK" + alternatywna nazwa "MPWIK" = DOPASOWANE ✓ (confidence: 95)
   - Przykład: opis "Zapłata dla MPWI" + alternatywna nazwa "MPWIK" = NIE dopasowane ✗
5. Wielkość liter ignoruj
6. Confidence (0-100):
   - 100: Pełny NIP w opisie
   - 95-99: Pełna nazwa główna LUB pełna alt. nazwa w opisie (TEN SAM poziom!)
   - 70-89: Częściowa nazwa/akronim
   - 50-69: Prawdopodobne
   - <50: Zwróć null

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
   * Get user prompt for contractor matching (optimized with pre-filtered candidates)
   */
  private getContractorMatchingUserPrompt(
    transactions: XmlTransaction[],
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; nip?: string; alternativeNames?: string[] }>>
  ): string {
    let prompt = '';
    
    transactions.forEach((t, idx) => {
      const candidates = candidatesPerTransaction[idx] || [];
      
      prompt += `\n=== Transakcja ${idx} ===\n`;
      prompt += `DESC-BASE: "${t.descBase}"\n`;
      prompt += `DESC-OPT: "${t.descOpt || '(brak)'}"\n`;
      
      if (candidates.length > 0) {
        prompt += `\nKandydaci:\n`;
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
      } else {
        prompt += `\nBrak kandydatów - zwróć null\n`;
      }
    });

    prompt += '\n\nZwróć JSON z results dla każdej transakcji.';
    
    return prompt;
  }

  /**
   * Process contractor matching response
   */
  private processContractorMatchingResponse(
    response: any,
    candidatesPerTransaction: Array<Array<{ id: number; nazwa: string; kontoKontrahenta: string; alternativeNames?: string[] }>>
  ): Array<{ contractor: any | null; confidence: number; matchedIn: 'desc-opt' | 'desc-base' | 'none'; matchedText?: string }> {
    return response.results.map((result: any, idx: number) => {
      if (result.contractorId === null || result.confidence < 50) {
        return {
          contractor: null,
          confidence: 0,
          matchedIn: 'none' as const,
        };
      }

      // Find contractor in the candidates for this specific transaction
      const candidates = candidatesPerTransaction[idx] || [];
      const contractor = candidates.find(c => c.id === result.contractorId);
      
      if (!contractor) {
        return {
          contractor: null,
          confidence: 0,
          matchedIn: 'none' as const,
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
      };
    });
  }
}
