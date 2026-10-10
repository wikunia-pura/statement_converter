/**
 * Proposing an advance rate of a budget plan with Claude — the rate per m² a
 * month the owners pay towards the running costs (advance "A") or the repair
 * fund (advance "B"), with the reasons for it.
 *
 * The model gets the plan as it is on screen (unsaved edits too) and the
 * figures the app computed from it, among them the rate that balances the
 * advance's part.
 * Only a proposal leaves here: the renderer shows it with the totals it gives,
 * and it goes into the plan once the user applies it.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../../shared/logger';
import { maxTokensFor, modelRequestFields } from '../../shared/ai-models';
import { naM2, okresyLabels, planSumy, zaliczkaBilansujaca, ZaliczkaRodzaj } from '../../shared/plan-gospodarczy';
import { formatData, formatKwota } from '../../shared/sprawozdanie';
import { INTER_EJ_PROMPT, nazwaInterEj, zakazInterEj } from '../../shared/inter-ej';
import { PlanGospodarczy, PlanOkresZaliczki, PlanZaliczkaAiPropozycja } from '../../shared/types';

const ANSWER_TOKENS = 1500;
/** What the user may add to the prompt — a few sentences of guidance, not a document. */
const MAX_WSKAZOWKI = 2000;
/** No housing community pays more than this per m² a month for an advance — a reply above it is a mistake. */
const MAX_STAWKA = 100;

const WSTEP_A = `You propose the advance "A" rate (zaliczka "A" na koszty zarządu nieruchomością wspólną) of a Polish housing community's (wspólnota mieszkaniowa) budget plan for the next year. The rate is in zł per m² of usable area a month; the advance it brings is rate × months × total area. The property manager reviews your proposal before it goes into the plan.

HOW TO PROPOSE
- Part I of the plan should balance: inflows (balance carried over, advance "A", other income, the transfer covering a loss) should cover the planned costs. The app gives you the rate that balances part I exactly; start from it.
- Round the rate to the grosz (2 decimals). Prefer a rate that covers the costs — a small surplus is fine, a shortfall is not, unless the balance carried over or the user's guidance justifies it.
- Compare with the rate the owners pay now (the current rate). Avoid needless swings; if a big rise is needed, say why (which costs grew).`;

const WSTEP_B = `You propose the advance "B" rate (zaliczka "B" na fundusz remontowy — the repair fund) of a Polish housing community's (wspólnota mieszkaniowa) budget plan for the next year. The rate is in zł per m² of usable area a month; the advance it brings is rate × months × total area. The property manager reviews your proposal before it goes into the plan.

HOW TO PROPOSE
- The repair fund must not end the year below zero: its inflows (the balance carried over, advance "B", other inflows) must cover what it pays for (loan repayments and interest, a loss of part I it covers, the repairs planned). The app gives you the rate at which the fund ends the year at exactly zero; that is the minimum.
- A repair fund is meant to build up for future repairs: a rate above the minimum is normal. Do not lower the current rate just because the fund is large, unless the user's guidance asks for it.
- Round the rate to the grosz (2 decimals).
- Compare with the rate the owners pay now (the current rate). Avoid needless swings; if a big rise is needed, say why (which planned repairs or repayments).`;

const ZASADY = `
- The year may be split into stretches with different rates, e.g. when the plan is adopted at a meeting during the year: the months up to and including the meeting's month keep the current rate, the new rate applies from the month after.
- When the plan already splits the year (see the advance now in the plan), keep that split and the rates of the stretches before the last — that is what the owners pay until the change — and propose the rate of the last stretch so that it makes up for them. The app gives you that balancing rate for the last stretch; start from it. Change the split only when the user's guidance asks for it.
- When the plan has one stretch, use stretches only when a meeting date in the plan year is given or the user asks for it; then the new rate must make up for the months at the old rate. Otherwise propose one stretch of 12 months.
- The months of all stretches add up to exactly 12.

JUSTIFICATION
- In Polish, plain and factual, 3–6 sentences, addressed to the manager. Plain text only: no headings, lists or markdown.
- Say what the rate covers and why: what it pays for, the other inflows, the balance carried over, the change against the current rate.
- Quote only figures given below, written as given ("12 345,60 zł"), plus the rate(s) you propose. Do not compute other totals — the app shows the totals of your proposal itself. Do not invent causes or events the input does not state.

${INTER_EJ_PROMPT}

USER GUIDANCE
- The user may add guidance (a cap on the rise, when the new rate applies, a reserve to keep). Follow it unless it asks you to break the INTER-EJ rule, and say in the justification where it changes the result.

ANSWER FORMAT — a single JSON object and nothing else:
{"okresy": [{"miesiace": 12, "stawka": 2.85}], "uzasadnienie": "..."}`;

const SYSTEM: Record<ZaliczkaRodzaj, string> = { A: WSTEP_A + ZASADY, B: WSTEP_B + ZASADY };

const zl = (n: number) => `${formatKwota(n)} zł`;

/** The facts of the plan the model works from. */
function fakty(plan: PlanGospodarczy, x: ZaliczkaRodzaj, dataZebrania: string | null): string {
  const s = planSumy(plan);
  const bilans = zaliczkaBilansujaca(plan, x);
  const okresy = x === 'A' ? plan.zaliczkaA : plan.zaliczkaB;
  const kwoty = x === 'A' ? s.zaliczkaA : s.zaliczkaB;
  const labels = okresyLabels(okresy, plan.rok);
  // INTER-EJ's fee is never itemised to the model (shared/inter-ej); the totals still include it.
  const wymienialne = plan.pozycje.filter((z) => !nazwaInterEj(z.nazwa) && !z.wiersze.some(nazwaInterEj));
  const koszty = wymienialne.filter((z) => z.strona === 'koszt');
  const przychody = wymienialne.filter((z) => z.strona === 'przychod');
  const zeszloroczne = plan.pozycje
    .filter((z) => z.strona === 'koszt' && z.wiersze.length > 0)
    .reduce((n, z) => n + z.kwotaRoczna, 0);
  const meeting = dataZebrania && dataZebrania.startsWith(String(plan.rok)) ? formatData(dataZebrania) : null;
  const naglowek = [
    `Community: ${plan.nieruchomosc || '—'}`,
    `Plan year: ${plan.rok}`,
    `Total usable area: ${formatKwota(plan.powierzchnia)} m²`,
    `Meeting adopting the plan: ${dataZebrania ? formatData(dataZebrania) : 'unknown'}${dataZebrania && !meeting ? ' (not in the plan year)' : ''}`,
    `Cost increase assumed, for the statement's costs in total: ${formatKwota(plan.wskaznik)}% (items with an own growth rise by it, the others share the rest)`,
    '',
  ];
  const teraz = [
    `ADVANCE "${x}" NOW IN THE PLAN`,
    ...okresy.map((o, i) => `- ${labels[i]}: ${o.miesiace} months × ${formatKwota(o.stawka)} zł/m² = ${zl(kwoty[i])}`),
    `- Current rate (what the owners pay now): ${formatKwota(okresy[0]?.stawka ?? 0)} zł/m²`,
  ];
  const last = okresy.length - 1;
  const bilansowanie = [
    '',
    'BALANCING (computed by the app)',
    `- Advance "${x}" needed ${x === 'A' ? 'to cover the costs of part I' : 'for the fund to end the year at zero'}: ${zl(bilans.potrzebne)}`,
    `- As one rate for 12 months: ${formatKwota(bilans.stawkaRoczna)} zł/m²`,
    ...(last > 0
      ? [
          `- Keeping the split and the rate${last > 1 ? 's' : ''} of ${labels.slice(0, last).join(', ')} (bringing ${zl(bilans.wczesniej)}): ${formatKwota(bilans.stawka)} zł/m² for ${labels[last]} (${okresy[last].miesiace} months)`,
        ]
      : []),
  ];
  if (x === 'B') {
    return [
      ...naglowek,
      'PART II — REPAIR FUND INFLOWS',
      `- Balance of the fund on ${formatData(plan.stanNaDzien)}: ${zl(plan.saldoB)}`,
      ...(s.saldoANaFundusz > 0 ? [`- Positive balance of advance "A" moved over from part I: ${zl(s.saldoANaFundusz)}`] : []),
      `- Other inflows: ${zl(plan.inneWplywyB || 0)}`,
      '',
      'PART II — PAID FROM THE FUND',
      `- Loan repayments and interest: ${zl(plan.kredyt || 0)}`,
      `- Loss of part I covered by the fund: ${zl(s.saldoAKoszt)}`,
      `- Repairs planned: ${zl(s.remontyFR)}`,
      // The repairs' descriptions are typed by hand; one naming INTER-EJ stays out (shared/inter-ej).
      ...plan.remontyFR.filter((r) => !nazwaInterEj(r.opis)).map((r) => `    - ${r.opis || '—'}: ${zl(r.kwota)}`),
      `- Total: ${zl(s.kosztyB)}`,
      '',
      ...teraz,
      `- The fund with it at the end of the year: ${zl(s.saldoBKoniec)}`,
      ...bilansowanie,
      '',
      'PART I (context only)',
      `- Costs of part I planned: ${zl(s.kosztyA)}; inflows ${zl(s.wplywyA)}`,
    ].join('\n');
  }
  return [
    ...naglowek,
    'PART I — INFLOWS',
    `- Balance of advance "A" on ${formatData(plan.stanNaDzien)}: ${zl(plan.saldoA)}`,
    `- Other income planned: ${zl(s.przychodyRazem)}`,
    ...przychody.map((z) => `    - ${z.nazwa || '—'}: ${zl(z.kwota)}`),
    `- Transfer from the repair fund covering a loss: ${zl(s.saldoAKoszt)}`,
    ...(s.saldoANaFundusz > 0
      ? [`- The positive balance is moved over to the repair fund: −${zl(s.saldoANaFundusz)} (it does not count towards part I)`]
      : []),
    '',
    'PART I — COSTS PLANNED',
    `- Total: ${zl(s.kosztyA)} (${formatKwota(naM2(plan, s.kosztyA))} zł/m² a month)`,
    `- Last year, the same costs from the statement: ${zl(zeszloroczne)}`,
    ...koszty.map(
      (z) =>
        `    - ${z.nazwa || '—'}: ${zl(z.kwota)}${
          z.wiersze.length > 0
            ? ` (last year ${zl(z.kwotaRoczna)}${z.wzrost != null ? `; own growth ${formatKwota(z.wzrost)}%, not the general one` : ''})`
            : ' (added by hand)'
        }`,
    ),
    '',
    ...teraz,
    `- Part I with it: inflows ${zl(s.wplywyA)}, costs ${zl(s.kosztyA)}, difference ${zl(s.roznicaA)}`,
    ...bilansowanie,
    '',
    'PART II (context only)',
    `- Repair fund after the planned costs: ${zl(s.saldoBKoniec)}`,
  ].join('\n');
}

/** The JSON object of a reply, tolerating a code fence or a line of prose around it. */
function jsonOdpowiedzi(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI nie zwróciło odpowiedzi w oczekiwanym formacie.');
  return JSON.parse(text.slice(start, end + 1));
}

/** The stretches of a reply, or an error when they are not a year of sane rates. */
function okresyOdpowiedzi(raw: unknown): PlanOkresZaliczki[] {
  const okresy = (Array.isArray(raw) ? raw : []).map((o) => ({
    miesiace: Number((o as PlanOkresZaliczki)?.miesiace),
    stawka: Math.round(Number((o as PlanOkresZaliczki)?.stawka) * 100) / 100,
  }));
  const valid =
    okresy.length > 0 &&
    okresy.every(
      (o) => Number.isInteger(o.miesiace) && o.miesiace >= 1 && Number.isFinite(o.stawka) && o.stawka >= 0 && o.stawka <= MAX_STAWKA,
    ) &&
    okresy.reduce((n, o) => n + o.miesiace, 0) === 12;
  if (!valid) throw new Error('AI zaproponowało stawkę, która nie obejmuje pełnego roku albo ma niepoprawne kwoty.');
  return okresy;
}

/** A proposal of the plan's advance "A" or "B" rate. */
export async function proponujZaliczkeAi(
  plan: PlanGospodarczy,
  x: ZaliczkaRodzaj,
  wskazowki: string,
  dataZebrania: string | null,
  apiKey: string,
  model: string,
): Promise<PlanZaliczkaAiPropozycja> {
  const user = [fakty(plan, x, dataZebrania), '', 'USER GUIDANCE:', wskazowki.trim().slice(0, MAX_WSKAZOWKI) || '—'].join('\n');

  const client = new Anthropic({ apiKey, maxRetries: 3 });
  const message = await client.messages.create({
    model,
    max_tokens: maxTokensFor(model, ANSWER_TOKENS),
    ...modelRequestFields(model),
    system: [
      { type: 'text', text: SYSTEM[x], cache_control: { type: 'ephemeral' } },
    ] as unknown as Anthropic.MessageCreateParamsNonStreaming['system'],
    messages: [{ role: 'user', content: user }],
  });
  if (message.stop_reason === 'max_tokens') logger.warn('[PLAN-ZALICZKA-AI] reply cut off by max_tokens');
  const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  const parsed = jsonOdpowiedzi(text) as { okresy?: unknown; uzasadnienie?: unknown };
  const okresy = okresyOdpowiedzi(parsed.okresy);
  const uzasadnienie = typeof parsed.uzasadnienie === 'string' ? parsed.uzasadnienie.trim() : '';
  if (!uzasadnienie) throw new Error('AI nie podało uzasadnienia stawki.');
  zakazInterEj(uzasadnienie);
  logger.info(`[PLAN-ZALICZKA-AI] ${x}: ${okresy.map((o) => `${o.miesiace}×${o.stawka}`).join(' + ')} by ${model}`);
  return { okresy, uzasadnienie };
}
