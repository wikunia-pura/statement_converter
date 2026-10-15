/**
 * AI answers are placed by the `index` each result names, never by their order
 * in the reply (`placeByIndex`, reached here through the public extractBatch /
 * matchContractorsBatch with the Anthropic client stubbed — no network).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock('./logger', () => {
  const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: quiet, logger: quiet };
});

import { AIExtractor } from './ai-extractor';
import { AIConfig, AITransaction } from './ai-types';

const CONFIG: AIConfig = {
  aiProvider: 'anthropic',
  apiKey: 'test-key',
  model: 'claude-test-model',
  confidenceThresholds: { autoApprove: 85, needsReview: 60 },
};

const tx = (descBase: string): AITransaction => ({
  descBase,
  descOpt: 'JAN KOWALSKI',
  exeDate: '2026-01-05',
  value: 500,
});

const TXS = [tx('CZYNSZ TESTOWA 1/1'), tx('CZYNSZ TESTOWA 1/2'), tx('CZYNSZ TESTOWA 1/3')];

/** One extraction result naming apartment `apt`, with full confidence. */
const result = (index: unknown, apt: string) => ({
  index,
  streetName: 'Testowa',
  buildingNumber: '1',
  apartmentNumber: apt,
  fullAddress: `Testowa 1/${apt}`,
  tenantName: 'Jan Kowalski',
  confidence: { address: 90, apartment: 90, tenantName: 90 },
});

/** Make the stubbed Claude reply with this JSON (or raw text). */
function reply(body: unknown) {
  create.mockResolvedValueOnce({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

const apartments = (out: Array<{ apartmentNumber: string | null } | null>) =>
  out.map((r) => (r ? r.apartmentNumber : null));

describe('AIExtractor.extractBatch — placement by index', () => {
  beforeEach(() => create.mockReset());

  it('a reply in reversed order lands each answer on its own transaction', async () => {
    reply({ results: [result(2, '3'), result(1, '2'), result(0, '1')] });
    const out = await new AIExtractor(CONFIG).extractBatch(TXS);
    expect(apartments(out)).toEqual(['1', '2', '3']);
    expect(out[0]?.rawData.descBase).toBe('CZYNSZ TESTOWA 1/1');
  });

  it('an index written as a string of digits counts', async () => {
    reply({ results: [result('0', '1'), result('1', '2'), result('2', '3')] });
    expect(apartments(await new AIExtractor(CONFIG).extractBatch(TXS))).toEqual(['1', '2', '3']);
  });

  it('an index answered twice leaves that slot empty — which answer is right cannot be known', async () => {
    reply({ results: [result(0, '1'), result(1, '2'), result(1, '9')] });
    expect(apartments(await new AIExtractor(CONFIG).extractBatch(TXS))).toEqual(['1', null, null]);
  });

  it('a missing answer is a hole held for review, not a shift of the others', async () => {
    reply({ results: [result(0, '1'), result(2, '3')] });
    expect(apartments(await new AIExtractor(CONFIG).extractBatch(TXS))).toEqual(['1', null, '3']);
  });

  it('out-of-range, negative, fractional and missing indexes are ignored', async () => {
    reply({
      results: [
        result(3, 'X'),
        result(-1, 'X'),
        result(1.5, 'X'),
        result(undefined, 'X'),
        result('1a', 'X'),
        result(1, '2'),
      ],
    });
    expect(apartments(await new AIExtractor(CONFIG).extractBatch(TXS))).toEqual([null, '2', null]);
  });

  it('a reply without a results array holds every transaction, without throwing', async () => {
    reply({ results: 'none' });
    expect(await new AIExtractor(CONFIG).extractBatch(TXS)).toEqual([null, null, null]);
    reply([]);
    expect(await new AIExtractor(CONFIG).extractBatch(TXS)).toEqual([null, null, null]);
    reply({ results: [null, 7, 'x'] });
    expect(await new AIExtractor(CONFIG).extractBatch(TXS)).toEqual([null, null, null]);
  });

  it('a result without numeric confidence scores is held for review', async () => {
    reply({
      results: [
        result(0, '1'),
        { ...result(1, '2'), confidence: { address: 'high', apartment: 90, tenantName: 90 } },
        { ...result(2, '3'), confidence: undefined },
      ],
    });
    expect(apartments(await new AIExtractor(CONFIG).extractBatch(TXS))).toEqual(['1', null, null]);
  });

  it('scores are clamped to 0–100 and averaged into overall', async () => {
    reply({
      results: [{ ...result(0, '1'), confidence: { address: 150, apartment: 40, tenantName: -5 } }],
    });
    const [r] = await new AIExtractor(CONFIG).extractBatch([TXS[0]]);
    expect(r?.confidence).toEqual({ address: 100, apartment: 40, tenantName: 0, overall: 47 });
    expect(r?.warnings).toEqual(['Low confidence - review required']);
  });
});

describe('AIExtractor.matchContractorsBatch — placement by index', () => {
  beforeEach(() => create.mockReset());

  const ENERGIA = { id: 11, nazwa: 'Energia Testowa Sp. z o.o.', kontoKontrahenta: '201-11' };
  const WODA = { id: 12, nazwa: 'Wodociagi Testowe', kontoKontrahenta: '201-12' };

  it('answers in any order reach their own transaction; an id outside the candidates is refused', async () => {
    reply({
      results: [
        { index: 1, contractorId: WODA.id, confidence: 95, matchedIn: 'desc-base' },
        { index: 0, contractorId: ENERGIA.id, confidence: 90, matchedIn: 'desc-opt' },
        { index: 2, contractorId: 999, confidence: 99, matchedIn: 'desc-base' },
      ],
    });
    const out = await new AIExtractor(CONFIG).matchContractorsBatch(TXS, [
      [ENERGIA],
      [WODA],
      [ENERGIA],
    ]);
    expect(out.map((r) => r.contractor?.id ?? null)).toEqual([ENERGIA.id, WODA.id, null]);
    expect(out[2].confidence).toBe(0);
  });

  it('a duplicated index and a missing answer both come back unmatched', async () => {
    reply({
      results: [
        { index: 0, contractorId: ENERGIA.id, confidence: 90 },
        { index: 0, contractorId: WODA.id, confidence: 90 },
      ],
    });
    const out = await new AIExtractor(CONFIG).matchContractorsBatch(TXS, [
      [ENERGIA, WODA],
      [WODA],
      [ENERGIA],
    ]);
    expect(out.map((r) => r.contractor)).toEqual([null, null, null]);
  });
});
