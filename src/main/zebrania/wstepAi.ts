/**
 * Writing the introduction's paragraph of a meeting's financial statement with
 * Claude — the words the owners read first, above the tables.
 *
 * The model gets the facts the app computed from the figures (every number in
 * them is one vDom printed, or a difference of two of them), the statement's
 * rows as the meeting shows them (merges and subcategories applied), and what
 * the user asked for. Only a draft leaves here: the renderer puts it in the
 * editor, and it is stored once somebody saves it.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../../shared/logger';
import { maxTokensFor, modelRequestFields } from '../../shared/ai-models';
import { formatKwota, okresLabel, sprawozdanieWstep } from '../../shared/sprawozdanie';
import { INTER_EJ_PROMPT, ukryteKwotyInterEj, zakazInterEj } from '../../shared/inter-ej';
import { Sprawozdanie } from '../../shared/types';

const ANSWER_TOKENS = 1500;
/** What the user may add to the prompt — a few sentences of guidance, not a document. */
const MAX_WSKAZOWKI = 2000;

const SYSTEM = `You write the opening paragraph of a Polish housing community's (wspólnota mieszkaniowa) financial statement for the annual owners' meeting. The property manager presents it; the owners read it first, above the tables.

WRITE
- In Polish, plain and factual, in the manager's voice addressing the owners, without greetings or sign-off.
- 4–7 sentences, as one paragraph (two at most, separated by a blank line). Plain text only: no headings, lists, markdown or quotes.
- Say what the period came to: income against costs and the result, the biggest cost items, the repair fund, loans if any, cash at the end. Lead with what matters most for this community.

FACTS — THE HARD RULE
- Use ONLY the numbers given below (FACTS and ROWS), written exactly as given ("12 345,60 zł"). Never compute a new figure, round, estimate a percentage or guess a cause.
- Do not invent events, plans, repairs or reasons that the input does not state. If the user's guidance mentions something, you may say it — as the user put it.
- Do not repeat the "important notes" verbatim; they are printed separately below the paragraph.

${INTER_EJ_PROMPT}

USER GUIDANCE
- The user may add guidance (tone, what to stress, something to mention). Follow it unless it asks you to break the facts rule or the INTER-EJ rule.

ANSWER — the paragraph text and nothing else.`;

function wiersze(spr: Sprawozdanie): string {
  const lines: string[] = [];
  for (const sec of spr.sekcje) {
    lines.push(`## ${sec.tytul}${sec.kwotaNaglowka != null ? ` — ${formatKwota(sec.kwotaNaglowka)}` : ''}`);
    if (sec.kolumny.length === 0) continue;
    lines.push(`(columns: ${sec.kolumny.join(' | ')})`);
    // INTER-EJ's fee never reaches the model (shared/inter-ej); the totals still include it.
    const ukryte = ukryteKwotyInterEj(sec);
    for (const [i, w] of sec.wiersze.entries()) {
      if (ukryte.has(i)) continue;
      if (!w.kwoty.some((k) => k != null && Math.abs(k) >= 0.005)) continue;
      const kwoty = sec.kolumny
        .map((k, c) => (w.kwoty[c] != null ? `${k}: ${formatKwota(w.kwoty[c])} zł` : ''))
        .filter(Boolean)
        .join('; ');
      const prefix = w.podsumowanie ? '= ' : w.podkategoria === 'pozycja' ? '    - ' : w.podkategoria === 'naglowek' ? '+ ' : '- ';
      const suffix = w.podkategoria === 'naglowek' ? ' (subcategory total)' : '';
      lines.push(`${prefix}${w.nazwa}${suffix}: ${kwoty}`);
    }
  }
  return lines.join('\n');
}

/** A draft of the paragraph. */
export async function napiszWstepAi(
  spr: Sprawozdanie,
  wskazowki: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const w = sprawozdanieWstep(spr);
  const user = [
    `Community: ${spr.nazwa}`,
    `Period: ${okresLabel(spr.okresOd, spr.okresDo)}`,
    '',
    'FACTS (computed from the printed figures):',
    w.fakty || '—',
    '',
    'HEADLINE FIGURES:',
    ...w.kluczowe.map((k) => `- ${k.etykieta}: ${formatKwota(k.kwota)} zł`),
    '',
    'IMPORTANT NOTES (printed below the paragraph):',
    ...(w.uwagi.length ? w.uwagi.map((u) => `- ${u}`) : ['—']),
    '',
    'ROWS (as shown at the meeting; "+" a subcategory with its rows indented, "=" a summary row):',
    wiersze(spr),
    '',
    'USER GUIDANCE:',
    wskazowki.trim().slice(0, MAX_WSKAZOWKI) || '—',
  ].join('\n');

  const client = new Anthropic({ apiKey, maxRetries: 3 });
  const message = await client.messages.create({
    model,
    max_tokens: maxTokensFor(model, ANSWER_TOKENS),
    ...modelRequestFields(model),
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ] as unknown as Anthropic.MessageCreateParamsNonStreaming['system'],
    messages: [{ role: 'user', content: user }],
  });
  if (message.stop_reason === 'max_tokens') logger.warn('[SPR-WSTEP-AI] reply cut off by max_tokens');
  const text = message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .replace(/^```[a-z]*\n?|\n?```$/g, '')
    .trim();
  if (!text) throw new Error('AI nie zwróciło tekstu wstępu.');
  zakazInterEj(text);
  logger.info(`[SPR-WSTEP-AI] ${text.length} chars by ${model}`);
  return text;
}
