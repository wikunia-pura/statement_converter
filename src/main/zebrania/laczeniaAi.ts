/**
 * Suggesting how to regroup the rows of a meeting's financial statement:
 * - merges — rows that read better as one: "Pomieszczenie zsypu" and "Czynsz
 *   części wspólnej" are both rent of a common part, and owners at the meeting
 *   care about the sum, not about how vDom's operator split the bookings;
 * - subcategories — rows kept, but put under a common heading: the four
 *   "Remonty bieżące …" rows under "Remonty bieżące".
 *
 * Only a suggestion leaves here. The renderer shows each one for review, and
 * one is stored only once somebody accepts it.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../../shared/logger';
import { maxTokensFor, modelRequestFields } from '../../shared/ai-models';
import { bezLaczenia, formatKwota, laczenieAktualne } from '../../shared/sprawozdanie';
import { wierszInterEj } from '../../shared/inter-ej';
import {
  Sprawozdanie,
  SprawozdanieGrupowanie,
  SprawozdanieLaczenie,
  SprawozdanieLaczeniePropozycja,
} from '../../shared/types';

const ANSWER_TOKENS_PER_ROW = 40;

const SYSTEM_LACZENIA = `You help prepare a Polish housing community's (wspólnota mieszkaniowa) annual financial statement for the owners' meeting. The statement lists rows exactly as the accounting system booked them; some of them are really one thing split into several bookings.

TASK
Propose groups of rows that the owners would read better as ONE row with a common name. Typical cases:
- several rents or fees for the use of common parts (a garbage-chute room, a corridor, a basement, "czynsz części wspólnej") → one "Najem części wspólnych";
- the same utility booked several times (energy of the stairwell and of the lift, several water readings) → one row of that utility;
- cleaning, or maintenance of one installation, split by contractor or by month.

RULES
- Only rows of the SAME section may be grouped, and only when they have amounts in the SAME column (do not mix an income with a cost).
- A group has at least 2 rows; a row belongs to at most one group.
- Do not group rows that are different things just to shorten the list. Leave significant, distinct items on their own (the repair fund, administration, insurance, a specific repair). When nothing is worth grouping, answer with an empty list.
- "nazwa": a short Polish name for the group, as an accountant would print it (e.g. "Najem części wspólnych", "Energia elektryczna"), max 40 characters.
- "uzasadnienie": one short Polish sentence (max 15 words) saying why.
- Refer to rows by their "id" only.

ANSWER FORMAT — a single JSON object and nothing else:
{"grupy":[{"sekcja":1,"wiersze":[3,7],"nazwa":"Najem części wspólnych","uzasadnienie":"Obie pozycje to opłaty za korzystanie z części wspólnych."}]}`;

const SYSTEM_PODKATEGORIE = `You help prepare a Polish housing community's (wspólnota mieszkaniowa) annual financial statement for the owners' meeting. Each section lists its rows flat, as the accounting system booked them; a long section reads better when related rows are put under a common subcategory heading. The rows themselves stay as they are — the heading only groups them and shows their total.

TASK
Propose subcategories: groups of related rows of one section, each under a short heading. Typical cases:
- "Remonty bieżące instalacji elektrycznej", "Remonty bieżące domofonów", "Remonty bieżące w branży sanitarnej", "Remonty bieżące w branży budowlanej" → "Remonty bieżące";
- energy, water, heating and other utility rows → "Media";
- cleaning, green areas, snow removal → "Utrzymanie czystości";
- administration, accounting, bank and post fees → "Zarząd i administracja";
- lift, intercom, fire-safety and other installation maintenance → "Konserwacja urządzeń".

RULES
- Only rows of the SAME section may be grouped, and only when they have amounts in the SAME column (do not mix an income with a cost).
- A subcategory has at least 2 rows; a row belongs to at most one subcategory.
- Group by what the rows ARE (a kind of cost or income); a row that fits no group stays on its own. Do not make a subcategory of everything.
- "nazwa": a short Polish heading, as an accountant would print it (e.g. "Remonty bieżące", "Media"), max 40 characters.
- "uzasadnienie": one short Polish sentence (max 15 words) saying why.
- Refer to rows by their "id" only.

ANSWER FORMAT — a single JSON object and nothing else:
{"grupy":[{"sekcja":1,"wiersze":[3,4,5,6],"nazwa":"Remonty bieżące","uzasadnienie":"Wszystkie cztery pozycje to bieżące remonty instalacji i budynku."}]}`;

interface Wiersz {
  id: number;
  nazwa: string;
}

interface Sekcja {
  id: number;
  tytul: string;
  wiersze: Wiersz[];
}

/** The JSON object of a reply, tolerating a code fence or a line of prose around it. */
function jsonOdpowiedzi(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI nie zwróciło odpowiedzi w oczekiwanym formacie.');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Merges, or subcategories, worth proposing for the statement. Rows already in
 * one of that kind are left out of the question; a group the model answered that breaks
 * a rule (rows of two sections, an unknown or summary row, a row in two groups)
 * is dropped, not passed on.
 */
export async function proponujLaczeniaAi(
  spr: Sprawozdanie,
  istniejace: SprawozdanieLaczenie[],
  rodzaj: SprawozdanieGrupowanie,
  apiKey: string,
  model: string,
): Promise<SprawozdanieLaczeniePropozycja[]> {
  const zajete = new Set(
    istniejace.filter((l) => laczenieAktualne(spr, l)).flatMap((l) => l.wiersze.map((n) => `${l.sekcja}\u0000${n}`)),
  );
  let nextRow = 1;
  const sekcje: Sekcja[] = [];
  const lines: string[] = [];
  spr.sekcje.forEach((sec, i) => {
    const rows = sec.wiersze.filter(
      (w) => !w.podsumowanie && w.kwoty.some((k) => k != null && Math.abs(k) >= 0.005) && !zajete.has(`${sec.tytul}\u0000${w.nazwa}`) &&
        (rodzaj === 'podkategorie' || !bezLaczenia(w.nazwa)),
    );
    // One name per row: two rows printed with the same name cannot be told apart in a merge.
    const names = [...new Set(rows.map((w) => w.nazwa))];
    if (names.length < 2) return;
    const s: Sekcja = { id: i + 1, tytul: sec.tytul, wiersze: [] };
    lines.push(`SECTION ${s.id}: ${sec.tytul}  (columns: ${sec.kolumny.join(' | ')})`);
    for (const nazwa of names) {
      const w = rows.find((r) => r.nazwa === nazwa)!;
      const id = nextRow++;
      s.wiersze.push({ id, nazwa });
      // An INTER-EJ row is grouped by its name and columns alone — its amount never reaches the model (shared/inter-ej).
      const ukryta = wierszInterEj(w);
      const kwoty = sec.kolumny
        .map((k, c) => `${k}=${w.kwoty[c] != null ? (ukryta ? 'withheld' : formatKwota(w.kwoty[c])) : '-'}`)
        .join('; ');
      lines.push(`${id}\t${nazwa}\t${kwoty}`);
    }
    sekcje.push(s);
  });
  if (sekcje.length === 0) return [];

  const client = new Anthropic({ apiKey, maxRetries: 3 });
  const message = await client.messages.create({
    model,
    max_tokens: maxTokensFor(model, 1000 + (nextRow - 1) * ANSWER_TOKENS_PER_ROW),
    ...modelRequestFields(model, { deterministic: true }),
    system: [
      {
        type: 'text',
        text: rodzaj === 'podkategorie' ? SYSTEM_PODKATEGORIE : SYSTEM_LACZENIA,
        cache_control: { type: 'ephemeral' },
      },
    ] as unknown as Anthropic.MessageCreateParamsNonStreaming['system'],
    messages: [
      {
        role: 'user',
        content: `Statement rows (tab-separated: id, name, amounts per column), by section:\n${lines.join('\n')}`,
      },
    ],
  });
  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  if (message.stop_reason === 'max_tokens') logger.warn('[SPR-LACZ-AI] reply cut off by max_tokens');
  const parsed = jsonOdpowiedzi(text) as { grupy?: unknown };

  const out: SprawozdanieLaczeniePropozycja[] = [];
  const used = new Set<number>();
  for (const raw of Array.isArray(parsed.grupy) ? parsed.grupy : []) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const sec = sekcje.find((s) => s.id === Number(r.sekcja));
    const ids = [...new Set((Array.isArray(r.wiersze) ? r.wiersze : []).map(Number))];
    const rows = ids.map((id) => sec?.wiersze.find((w) => w.id === id));
    const nazwa = typeof r.nazwa === 'string' ? r.nazwa.trim().slice(0, 80) : '';
    if (!sec || !nazwa || rows.length < 2 || rows.some((w) => !w) || ids.some((id) => used.has(id))) continue;
    ids.forEach((id) => used.add(id));
    out.push({
      sekcja: sec.tytul,
      wiersze: rows.map((w) => w!.nazwa),
      nazwa,
      uzasadnienie: typeof r.uzasadnienie === 'string' ? r.uzasadnienie.trim() : '',
    });
  }
  logger.info(`[SPR-LACZ-AI] ${out.length} ${rodzaj} proposed by ${model} over ${nextRow - 1} rows`);
  return out;
}
