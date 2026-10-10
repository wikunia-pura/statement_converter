/**
 * Sorting a financial statement's rows into the CIT-8's categories with Claude —
 * the part of the job a fixed dictionary cannot do: "Zabudowa korytarza",
 * "Energia elektr.- ryczałt", a row a vDom operator named last week.
 *
 * Only a suggestion leaves here. The renderer stores it as unconfirmed, and the
 * return's PDF stays blocked until somebody accepts it, because the tax
 * treatment of a row is the accountant's call, not the model's.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../../shared/logger';
import { maxTokensFor, modelRequestFields } from '../../shared/ai-models';
import { kategorieDlaStrony } from '../../shared/podatki-cit';
import { nazwaInterEj } from '../../shared/inter-ej';
import { CitAiPozycja, CitAiPropozycja, CitKategoria } from '../../shared/types';

/** Rows per request: ~25 tokens a row in, ~40 out, so a batch stays far from any limit. */
const BATCH_SIZE = 60;
const CONCURRENCY = 3;
const ANSWER_TOKENS_PER_ROW = 80;

const SYSTEM = `You classify rows of a Polish housing community's (wspólnota mieszkaniowa) annual financial statement for its CIT-8 corporate income tax return.

LAW IN SHORT
- A housing community's income from managing the housing stock ("gospodarka zasobami mieszkaniowymi"), spent on upkeep of that stock, is exempt from CIT (art. 17 ust. 1 pkt 44): owners' monthly advances/charges for upkeep and administration ("zaliczka", "opłata eksploatacyjna", "fundusz remontowy"), amounts settled with owners for utilities.
- Everything else is taxed: renting out or leasing common parts to anyone (rooms, basement or attic space, corridors built into by an owner, garage and parking places let out, roof, facade, wall), advertising on the building, antennas and telecom equipment, bank interest, fees for use of the common property by third parties, re-billed utilities of such tenants.
- Opening balances and results carried over from earlier years ("Bilans otwarcia", "Wynik roku …", "Rozliczenie wyniku …") are not flows of the year at all.

CATEGORIES (use exactly these ids)
Income rows (strona = "przychod"):
- "przychod_opodatkowany" — taxed income (see above).
- "przychod_zwolniony" — exempt income from managing the housing stock.
- "pomin" — not a flow of the year.
Cost rows (strona = "koszt"):
- "koszt_wspolny" — the default: a cost of running the building as a whole (administration, cleaning, repairs, utilities of common areas, insurance, lift). It is split between exempt and taxed income later.
- "koszt_opodatkowany" — a cost that can only belong to the taxed income (a commission for letting space, advertising costs, repair of the part that is let out).
- "koszt_zwolniony" — a cost that can only belong to the exempt side (costs of the repair fund).
- "niekoszt" — not a tax-deductible cost (transfers to funds and "odpisy" from the result, fines and penalty interest, depreciation of investments, loan principal).
- "pomin" — not a flow of the year.

RULES
- Judge by the row's NAME, its column (strona) and its section; the amount is context only.
- Use only the categories valid for the row's strona.
- If a row is ambiguous, still pick the more cautious reading for tax (an income row that could be taxed → "przychod_opodatkowany"; a cost row you cannot place → "koszt_wspolny") and say in the reason that it is uncertain.
- "uzasadnienie": one short Polish sentence (max 15 words) saying why.

ANSWER FORMAT — a single JSON object and nothing else:
{"wyniki":[{"id":1,"kategoria":"przychod_opodatkowany","uzasadnienie":"Najem pomieszczenia wspólnego."}, ...]}
One entry per input row, same "id".`;

interface Wiersz {
  id: number;
  pozycja: CitAiPozycja;
}

function prompt(batch: Wiersz[]): string {
  // An INTER-EJ row is classified by its name alone — its amount never reaches the model (shared/inter-ej).
  const lines = batch.map(
    ({ id, pozycja: p }) =>
      `${id}\t${p.strona}\t${p.sekcja === 'fundusz' ? 'Fundusz remontowy' : 'Koszty eksploatacji'}\t${nazwaInterEj(p.nazwa) ? '-' : p.kwota.toFixed(2)}\t${p.nazwa}`,
  );
  return `Rows to classify (tab-separated: id, strona, section, amount in zł or "-" when withheld, name):\n${lines.join('\n')}`;
}

/** The JSON object of a reply, tolerating a code fence or a line of prose around it. */
function jsonOdpowiedzi(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI nie zwróciło odpowiedzi w oczekiwanym formacie.');
  return JSON.parse(text.slice(start, end + 1));
}

async function zapytaj(client: Anthropic, model: string, batch: Wiersz[]): Promise<CitAiPropozycja[]> {
  const message = await client.messages.create({
    model,
    max_tokens: maxTokensFor(model, 1000 + batch.length * ANSWER_TOKENS_PER_ROW),
    ...modelRequestFields(model, { deterministic: true }),
    system: [
      // Identical for every batch of every return, so the prefix cache serves all but the first.
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ] as unknown as Anthropic.MessageCreateParamsNonStreaming['system'],
    messages: [{ role: 'user', content: prompt(batch) }],
  });
  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  if (message.stop_reason === 'max_tokens') logger.warn('[CIT-AI] reply cut off by max_tokens');
  const parsed = jsonOdpowiedzi(text) as { wyniki?: unknown };
  const out: CitAiPropozycja[] = [];
  for (const raw of Array.isArray(parsed.wyniki) ? parsed.wyniki : []) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const row = batch.find((b) => b.id === Number(r.id));
    // A category the row's column does not allow is a wrong answer, not a suggestion.
    if (!row || !kategorieDlaStrony(row.pozycja.strona).includes(r.kategoria as CitKategoria)) continue;
    out.push({
      klucz: row.pozycja.klucz,
      kategoria: r.kategoria as CitKategoria,
      uzasadnienie: typeof r.uzasadnienie === 'string' ? r.uzasadnienie.trim() : '',
    });
  }
  return out;
}

/**
 * One suggestion per row the model could place — a row it skipped or answered
 * with an impossible category is simply absent, and stays unsorted.
 */
export async function klasyfikujCitAi(
  pozycje: CitAiPozycja[],
  apiKey: string,
  model: string,
): Promise<CitAiPropozycja[]> {
  if (pozycje.length === 0) return [];
  const client = new Anthropic({ apiKey, maxRetries: 3 });
  const batches: Wiersz[][] = [];
  for (let i = 0; i < pozycje.length; i += BATCH_SIZE) {
    batches.push(pozycje.slice(i, i + BATCH_SIZE).map((pozycja, j) => ({ id: j + 1, pozycja })));
  }

  const results: CitAiPropozycja[][] = new Array(batches.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
    while (next < batches.length) {
      const i = next++;
      results[i] = await zapytaj(client, model, batches[i]);
    }
  });
  await Promise.all(workers);

  const out = results.flat();
  logger.info(`[CIT-AI] ${out.length}/${pozycje.length} rows classified by ${model}`);
  return out;
}
