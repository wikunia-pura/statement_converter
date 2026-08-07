/**
 * AI contractor matching for expenses — the batching/fallback/caching policy in
 * one place.
 *
 * Extracted from BaseConverter because a second caller needs exactly the same
 * behaviour: the "przelicz AI" button in the acceptance screen re-runs matching
 * for expenses the user hasn't resolved, long after the converter that produced
 * them is gone. Copying the loop would let the two drift silently — both would
 * still return plausible matches, just with different batch sizes, a different
 * fallback rule, or no MatchCache write.
 */

import { AIExtractor } from './ai-extractor';
import { AITransaction, MatchedContractor } from './ai-types';
import { ContractorMatcher } from './contractor-matcher';
import { MatchCache } from './match-cache';
import { KontrahentTyp } from './types';
import logger from './logger';

/** Contractor roles an expense may be booked to. */
export const EXPENSE_MATCH_TYPES: KontrahentTyp[] = ['Kontrahent', 'Pozostałe koszty'];

/** How many pre-filtered candidates are offered per transaction. */
const CANDIDATES_PER_TRANSACTION = 10;

export const DEFAULT_EXPENSE_AI_BATCH_SIZE = 50;
export const DEFAULT_EXPENSE_AI_CONCURRENCY = 3;

/**
 * Batch lifecycle, reported so callers can drive their own progress UI.
 * `planned` fires once, before any request goes out.
 */
export type ExpenseAiProgressEvent =
  | { type: 'planned'; batches: number }
  | { type: 'started' }
  | { type: 'completed' };

export interface ExpenseAiMatchOptions {
  aiExtractor: AIExtractor;
  contractorMatcher: ContractorMatcher;
  /**
   * When provided, positive matches are remembered so the same recurring
   * payment skips the AI next month. Nulls are deliberately not cached — see
   * MatchCache's header.
   */
  matchCache?: MatchCache;
  batchSize?: number;
  concurrency?: number;
  onProgress?: (event: ExpenseAiProgressEvent) => void;
}

/** Run `worker` over `items` with at most `limit` in flight, preserving order. */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });

  await Promise.all(runners);
  return results;
}

/** Split `items` into contiguous chunks of at most `batchSize`. */
export function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Match each transaction to a contractor using the AI.
 *
 * Returns one result per input transaction, in input order. Batches are
 * contiguous slices and their results are concatenated, so index alignment is
 * preserved. A failing batch rejects the whole call — the caller decides
 * whether that means "fall back to a non-AI conversion" or "leave the rows
 * as they were".
 */
export async function matchExpensesWithAI(
  transactions: AITransaction[],
  options: ExpenseAiMatchOptions
): Promise<MatchedContractor[]> {
  const {
    aiExtractor,
    contractorMatcher,
    matchCache,
    batchSize = DEFAULT_EXPENSE_AI_BATCH_SIZE,
    concurrency = DEFAULT_EXPENSE_AI_CONCURRENCY,
    onProgress,
  } = options;

  if (transactions.length === 0) return [];

  const batches = createBatches(transactions, Math.max(1, batchSize));
  onProgress?.({ type: 'planned', batches: batches.length });

  console.log(
    `   Processing ${batches.length} expense batches (${batchSize} txns each, concurrency=${concurrency})...`
  );

  const batchResults = await runWithConcurrency(
    batches,
    concurrency,
    async (batch, batchIdx) => {
      try {
        onProgress?.({ type: 'started' });

        // Full type-filtered catalog, used only as a fallback for transactions
        // where fuzzy pre-filtering surfaces nothing (e.g. names corrupted by
        // 35-char line wrapping that injects spaces — "La skowski", "GON TAREK").
        // Without this the AI would receive an empty list and be forced to null.
        //
        // Such transactions get an empty candidate list and the catalog is passed
        // separately, so it is rendered once per request (and prompt-cached)
        // instead of being inlined under every fallback transaction — that
        // duplication was ~14k tokens per fallback and dominated the AI bill.
        const fullCatalog = contractorMatcher.getAllByTypes(EXPENSE_MATCH_TYPES);
        let needsFullCatalog = false;
        const candidatesPerTransaction = batch.map((t) => {
          const top = contractorMatcher.getTopCandidates(
            t,
            CANDIDATES_PER_TRANSACTION,
            EXPENSE_MATCH_TYPES
          );
          if (top.length > 0) return top;
          needsFullCatalog = true;
          return [];
        });

        const matchedContractors = await aiExtractor.matchContractorsBatch(
          batch,
          candidatesPerTransaction,
          needsFullCatalog && fullCatalog.length > 0 ? fullCatalog : undefined
        );

        // Diagnostic logging: for every transaction, record what the AI was
        // given (candidate IDs+names, whether the full-catalog fallback kicked
        // in) and what it returned (matched contractor / null + confidence +
        // reasoning). This makes "AI ran but didn't match X" inspectable in
        // main.log instead of a black box.
        batch.forEach((t, j) => {
          const cands = candidatesPerTransaction[j] || [];
          // Empty candidates now means "drew from the shared full list".
          const usedFallback = cands.length === 0 && needsFullCatalog;
          const mc = matchedContractors[j];
          const candStr = cands.length
            ? cands.slice(0, 12).map((c) => `#${c.id}:${c.nazwa}`).join(' | ') +
              (cands.length > 12 ? ` …(+${cands.length - 12})` : '')
            : usedFallback
              ? `pełna lista (${fullCatalog.length} poz., wysłana raz na zapytanie)`
              : '(brak)';
          logger.info(
            `[EXPENSE-AI] desc-opt="${t.descOpt || ''}" desc-base="${t.descBase}" | ` +
              `kandydaci(${usedFallback ? fullCatalog.length : cands.length}${usedFallback ? ', FALLBACK=pełna lista' : ''}): ${candStr} | ` +
              `AI => ${mc.contractor ? `MATCH #${mc.contractor.id} "${mc.contractor.nazwa}" (conf ${mc.confidence})` : 'NULL'}` +
              `${mc.reasoning ? ` | reasoning: ${mc.reasoning}` : ''}`
          );
        });

        // Remember positive matches so the same recurring payment doesn't go
        // to the AI again next month.
        if (matchCache) {
          batch.forEach((t, j) => {
            const mc = matchedContractors[j];
            if (mc.contractor && mc.confidence > 0) {
              matchCache.set(t.descBase, t.descOpt, {
                contractorId: mc.contractor.id,
                confidence: mc.confidence,
                matchedIn: mc.matchedIn,
                reasoning: mc.reasoning,
              });
            }
          });
        }

        onProgress?.({ type: 'completed' });
        return matchedContractors;
      } catch (error) {
        console.error(`   ❌ Expense batch ${batchIdx + 1} failed:`, error);
        throw error;
      }
    }
  );

  return batchResults.flat();
}
