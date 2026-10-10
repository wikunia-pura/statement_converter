/**
 * RULE — amounts tied to INTER-EJ are never mentioned.
 *
 * INTER-EJ is the managing company, and its rows in a statement are its own fee.
 * Whatever the app works out from a statement or a budget plan — the sentences
 * it writes itself (the statement's introduction) and everything it hands to
 * the AI (and so everything the AI could write) — never names an amount of such
 * a row: the row is left out of every highlight and every AI prompt, and an AI
 * answer that brings INTER-EJ up is refused, not repaired.
 *
 * The figures stay in the accounts: every total (costs of the period, the
 * plan's part I) still includes them, and the tables print the rows as booked.
 * Any new calculation over statement or plan rows that names items goes
 * through `wierszInterEj` / `ukryteKwotyInterEj`, and any new AI text through
 * `zakazInterEj`.
 */

import { SprawozdanieSekcja, SprawozdanieWiersz } from './types';

/** "INTER-EJ", "Inter EJ", "InterEJ" — however the bookkeeper typed the name. */
const INTER_EJ = /inter[\s\-–—_.]*ej/i;

/** A name (of a row, a merge, a position) that is INTER-EJ's. */
export function nazwaInterEj(nazwa: string): boolean {
  return INTER_EJ.test(nazwa);
}

/** A statement row of INTER-EJ — by its name or one of the rows merged into it. */
export function wierszInterEj(w: Pick<SprawozdanieWiersz, 'nazwa' | 'polaczone'>): boolean {
  return nazwaInterEj(w.nazwa) || (w.polaczone ?? []).some(nazwaInterEj);
}

/**
 * The rows of a section whose amount must not be mentioned, by index: the
 * INTER-EJ rows and a subcategory heading over one of them (its total
 * contains the fee). Summary rows ("Razem", results) stay mentionable.
 */
export function ukryteKwotyInterEj(sec: Pick<SprawozdanieSekcja, 'wiersze'>): Set<number> {
  const out = new Set<number>();
  let naglowek = -1;
  sec.wiersze.forEach((w, i) => {
    if (w.podkategoria === 'naglowek') naglowek = i;
    else if (w.podkategoria !== 'pozycja') naglowek = -1;
    if (w.podsumowanie || !wierszInterEj(w)) return;
    out.add(i);
    if (w.podkategoria === 'pozycja' && naglowek >= 0) out.add(naglowek);
  });
  return out;
}

/** An AI answer that brings INTER-EJ up is refused — the rule is not left to the prompt alone. */
export function zakazInterEj(text: string): void {
  if (INTER_EJ.test(text)) {
    throw new Error('AI wspomniało o kwotach INTER-EJ, czego nie robimy — spróbuj ponownie.');
  }
}

/** The rule as the AI is told it, for every prompt over a statement or a plan. */
export const INTER_EJ_PROMPT = `INTER-EJ — THE HARD RULE
- INTER-EJ is the managing company; rows of its fee are left out of what you are given. Never mention INTER-EJ, its fee or any amount of it, and do not guess it from the totals.`;
