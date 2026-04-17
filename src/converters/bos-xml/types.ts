/**
 * BOŚ Bank XML Converter - Type Definitions
 * Format: ISO 20022 CAMT.052.001.04 (camt.052 — Account Report)
 *
 * Re-uses BnpTransaction because the per-entry field set is identical to BNP's CAMT.053.
 * BOŚ-specific differences live in the Statement envelope (no balances, no owner info,
 * report is split across multiple <Rpt> elements).
 */

import { BnpTransaction } from '../bnp-xml/types';

export type BosTransaction = BnpTransaction;

export interface BosStatement {
  /** Group header message ID */
  messageId: string;
  /** Group header creation date-time */
  creationDateTime: string;
  /** Account IBAN */
  iban: string;
  /** Account currency (usually PLN) */
  currency: string;
  /** Period start (from first <Rpt>) */
  periodStart: string;
  /** Period end (from first <Rpt>) */
  periodEnd: string;
  /** All entries across every <Rpt> */
  transactions: BosTransaction[];
}

export interface ConverterConfig {
  aiProvider: 'openai' | 'anthropic' | 'ollama' | 'none';
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
  useAIForExpenses: boolean;
  contractors?: import('../../shared/types').Kontrahent[];
  addresses?: import('../../shared/types').Adres[];
  language?: 'pl' | 'en';
}
