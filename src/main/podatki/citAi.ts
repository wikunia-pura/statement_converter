/**
 * Sorting a financial statement's rows into the CIT-8's categories with Claude —
 * the part of the job a fixed dictionary cannot do: "Zabudowa korytarza",
 * "Energia elektr.- ryczałt", a row a vDom operator named last week.
 *
 * Only a suggestion leaves here. The renderer stores it as unconfirmed, and the
 * return's PDF stays blocked until somebody accepts it, because the tax
 * treatment of a row is the accountant's call, not the model's.
 *
 * Three things keep the answers worth reading (measured with
 * `scripts/cit-ai-eval.ts`):
 * - the office's dictionary goes along as examples, so the model follows the
 *   office's own conventions instead of a generic reading of the law;
 * - a strong model thinks it over (`CIT_MODEL`, whatever model Settings pick for
 *   the rest of the app — a few hundred rows a year cost next to nothing);
 * - every row is asked twice, independently. An adaptive model's sampling cannot
 *   be pinned, so a row the two passes answer differently is a genuinely open
 *   question: it comes back marked `niepewne` instead of as a coin toss.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../../shared/logger';
import { maxTokensFor, modelRequestFields } from '../../shared/ai-models';
import { kategorieDlaStrony } from '../../shared/podatki-cit';
import { nazwaInterEj, wspominaInterEj } from '../../shared/inter-ej';
import { CitAiPozycja, CitAiPropozycja, CitAiPrzyklad, CitAiWynik, CitKategoria } from '../../shared/types';

/** Rows per request: ~25 tokens a row in, ~40 out, so a batch stays far from any limit. */
const BATCH_SIZE = 60;
const CONCURRENCY = 3;
const ANSWER_TOKENS_PER_ROW = 80;
/** Independent passes over every row; a row they answer differently is `niepewne`. */
const PASSES = 2;

/**
 * The model every CIT classification goes to — the newest Opus, a step past
 * the `claude-opus-5` that re-reads failed pages in zaliczki/extractor.ts. If the
 * account cannot use it, the run falls back to the model picked in Settings (an
 * unavailable model must never take the feature away) and says so, because the
 * answers are then visibly worse.
 */
export const CIT_MODEL = 'claude-opus-5-5';
/**
 * Room for the model's thinking on top of the answer. Kept so the whole ceiling
 * stays under ~21k tokens, past which the SDK refuses a non-streaming request.
 */
const CIT_THINKING_TOKENS = 12000;

const SYSTEM = `You classify rows of a Polish housing community's (wspólnota mieszkaniowa) annual financial statement for its CIT-8 corporate income tax return.

LAW IN SHORT
- A housing community's income from managing the housing stock ("gospodarka zasobami mieszkaniowymi"), spent on upkeep of that stock, is exempt from CIT (art. 17 ust. 1 pkt 44): owners' monthly advances/charges for upkeep and administration ("zaliczka", "opłata eksploatacyjna", "fundusz remontowy"), amounts settled with owners for utilities — including the electricity, water or heat of the owners' own basements, storage rooms and garages.
- Everything else is taxed: renting out or leasing common parts to anyone (rooms, basement or attic space, corridors built into by an owner, garage and parking places let out, roof, facade, wall), advertising on the building, antennas and telecom equipment, bank interest, fees for use of the common property by third parties, re-billed utilities of such tenants. A row the statement calls "pożytki" is income from the common property and is taxed, whatever follows the word.
- Opening balances and results carried over from earlier years ("Bilans otwarcia", "Wynik roku …", "Rozliczenie wyniku …") are not flows of the year at all.
- Costs: interest PAID on a loan or credit and bank fees and commissions are tax-deductible costs (art. 16 ust. 1 pkt 11 excludes only interest accrued but not paid). What is NOT a deductible cost: repaying a loan's principal, penalty interest for late payment ("odsetki za zwłokę"), fines and penalties, transfers to funds and "odpisy" from the result, depreciation of investments.

CATEGORIES (use exactly these ids)
Income rows (strona = "przychod"):
- "przychod_opodatkowany" — taxed income (see above).
- "przychod_zwolniony" — exempt income from managing the housing stock.
- "pomin" — not a flow of the year.
Cost rows (strona = "koszt"):
- "koszt_wspolny" — the default: a cost of running the building as a whole (administration, cleaning, repairs, utilities of common areas, insurance, lift, bank fees). It is split between exempt and taxed income later.
- "koszt_opodatkowany" — a cost that can only belong to the taxed income (a commission for letting space, advertising costs, repair of the part that is let out).
- "koszt_zwolniony" — a deductible cost that can only belong to the exempt side (costs of the repair fund, interest paid on a loan that financed repairs of the building).
- "niekoszt" — not a tax-deductible cost (see the list above).
- "pomin" — not a flow of the year.

RULES
- Judge by the row's NAME, its column (strona) and its section; the amount is context only.
- Use only the categories valid for the row's strona.
- If a row is ambiguous, still pick the more cautious reading for tax (an income row that could be taxed → "przychod_opodatkowany"; a cost row you cannot place → "koszt_wspolny") and say in the reason that it is uncertain.
- CHECKING THE DICTIONARY: a row may carry the dictionary's current category ("current" column). Then the accountant has already decided it: answer that same category unless it is clearly wrong under the law above. A defensible reading, an ambiguous name or a merely more cautious alternative is NOT a reason to change it — change it only when you could name the rule of law it breaks, and say so in the reason.
- "uzasadnienie": one short Polish sentence (max 15 words) saying why; write it before the category. Never name INTER-EJ (the managing company) or any amount of its rows in it — call such a row "wynagrodzenie zarządcy".

ANSWER FORMAT — a single JSON object and nothing else:
{"wyniki":[{"id":1,"uzasadnienie":"Najem pomieszczenia wspólnego.","kategoria":"przychod_opodatkowany"}, ...]}
One entry per input row, same "id".`;

interface Wiersz {
  id: number;
  pozycja: CitAiPozycja;
}

function prompt(batch: Wiersz[]): string {
  // An INTER-EJ row is classified by its name alone — its amount never reaches the model (shared/inter-ej),
  // nor does the amount of a row merged with one or of a heading over one (`ukryta`, from ukryteKwotyInterEj).
  const lines = batch.map(({ id, pozycja: p }) => {
    // A current category the row's column does not allow is no decision to keep.
    const current = p.regula && kategorieDlaStrony(p.strona).includes(p.regula) ? p.regula : '-';
    const kwota = p.ukryta || nazwaInterEj(p.nazwa) ? '-' : p.kwota.toFixed(2);
    return `${id}\t${p.strona}\t${p.sekcja === 'fundusz' ? 'Fundusz remontowy' : 'Koszty eksploatacji'}\t${kwota}\t${current}\t${p.nazwa}`;
  });
  return `Rows to classify (tab-separated: id, strona, section, amount in zł or "-" when withheld, current dictionary category or "-", name):\n${lines.join('\n')}`;
}

/** The JSON object of a reply, tolerating a code fence or a line of prose around it. */
function jsonOdpowiedzi(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI nie zwróciło odpowiedzi w oczekiwanym formacie.');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * The office's dictionary as a block of the system prompt: its rules are the
 * accountant's decisions, the best evidence of how this office treats a name.
 */
function slownikTekst(przyklady: CitAiPrzyklad[]): string {
  const lines = przyklady
    .filter((r) => r.fraza.trim() && kategorieDlaStrony(r.strona).includes(r.kategoria))
    .map((r) => `${r.fraza.trim()}\t${r.strona}\t${r.kategoria}`);
  if (lines.length === 0) return '';
  return `THE OFFICE'S DICTIONARY
The accountant's own decisions, as rules "phrase → category" (tab-separated: phrase, strona, category); a rule covers every row name of that strona that contains the phrase. They show how THIS office treats its names: where the law leaves room, follow them, and decide a row they do not cover by analogy with the closest rules.
${lines.join('\n')}`;
}

/** Request fields for the CIT model itself, or for the fallback picked in Settings. */
function pola(model: string, answerTokens: number): { max_tokens: number } & Record<string, unknown> {
  if (model === CIT_MODEL) {
    return { max_tokens: answerTokens + CIT_THINKING_TOKENS, output_config: { effort: 'medium' } };
  }
  return { max_tokens: maxTokensFor(model, answerTokens), ...modelRequestFields(model, { deterministic: true }) };
}

async function zapytaj(client: Anthropic, model: string, slownik: string, batch: Wiersz[]): Promise<CitAiPropozycja[]> {
  // Both blocks are identical for every batch of a run, so the prefix cache serves all but the first.
  const system = slownik
    ? [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: slownik, cache_control: { type: 'ephemeral' } },
      ]
    : [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];
  const message = await client.messages.create({
    model,
    ...pola(model, 1000 + batch.length * ANSWER_TOKENS_PER_ROW),
    system: system as unknown as Anthropic.MessageCreateParamsNonStreaming['system'],
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
    const uzasadnienie = typeof r.uzasadnienie === 'string' ? r.uzasadnienie.trim() : '';
    out.push({
      klucz: row.pozycja.klucz,
      kategoria: r.kategoria as CitKategoria,
      // A reason that brings INTER-EJ up is refused (shared/inter-ej); the category, a decision about the
      // row's name the accountant still confirms, stays.
      uzasadnienie: wspominaInterEj(uzasadnienie) ? '' : uzasadnienie,
    });
  }
  return out;
}

/**
 * The CIT model refused the request itself — absent from the account, or not
 * taking its request shape. Worth one more try on the fallback, which reports
 * its own error if it fails as well.
 */
function modelNiedostepny(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 400 || status === 403 || status === 404;
}

/** Two passes' answers for one row as one suggestion: agreement is the answer, anything else is `niepewne`. */
function polacz([a, b]: CitAiPropozycja[]): CitAiPropozycja {
  if (!b) return { ...a, niepewne: true };
  if (a.kategoria === b.kategoria) return a;
  return { ...a, niepewne: true, alternatywa: { kategoria: b.kategoria, uzasadnienie: b.uzasadnienie } };
}

/**
 * One suggestion per row the model could place — a row neither pass answered
 * (or answered only with an impossible category) is simply absent, and stays
 * unsorted. `przyklady` is the dictionary to follow; pass none when the rows
 * themselves are the dictionary's rules under check.
 */
export async function klasyfikujCitAi(
  pozycje: CitAiPozycja[],
  apiKey: string,
  fallbackModel: string,
  przyklady: CitAiPrzyklad[] = [],
): Promise<CitAiWynik> {
  if (pozycje.length === 0) return { propozycje: [], zapasowy: false };
  const client = new Anthropic({ apiKey, maxRetries: 3 });
  const slownik = slownikTekst(przyklady);
  const batches: Wiersz[][] = [];
  for (let i = 0; i < pozycje.length; i += BATCH_SIZE) {
    batches.push(pozycje.slice(i, i + BATCH_SIZE).map((pozycja, j) => ({ id: j + 1, pozycja })));
  }

  let model = CIT_MODEL;
  const zapytajZPowrotem = async (batch: Wiersz[]): Promise<CitAiPropozycja[]> => {
    try {
      return await zapytaj(client, model, slownik, batch);
    } catch (err) {
      if (model === fallbackModel || !modelNiedostepny(err)) throw err;
      logger.warn(`[CIT-AI] ${model} unavailable (${err instanceof Error ? err.message : err}) — falling back to ${fallbackModel}`);
      model = fallbackModel;
      return zapytaj(client, model, slownik, batch);
    }
  };

  // Every pass over every batch is one job; the first runs alone, so the cache is
  // written once and a missing model is found before the rest go out.
  const jobs = Array.from({ length: PASSES }, () => batches).flat();
  const results: CitAiPropozycja[][] = new Array(jobs.length);
  results[0] = await zapytajZPowrotem(jobs[0]);
  let next = 1;
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length - 1) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await zapytajZPowrotem(jobs[i]);
    }
  });
  await Promise.all(workers);

  const poKluczu = new Map<string, CitAiPropozycja[]>();
  for (const r of results.flat()) poKluczu.set(r.klucz, [...(poKluczu.get(r.klucz) ?? []), r]);
  const out = [...poKluczu.values()].map(polacz);
  const niepewne = out.filter((p) => p.niepewne).length;
  logger.info(`[CIT-AI] ${out.length}/${pozycje.length} rows classified by ${model}, ${niepewne} uncertain`);
  return { propozycje: out, zapasowy: model !== CIT_MODEL };
}
