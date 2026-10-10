/**
 * A meeting's materials at a glance — the headline figures of the statement
 * and of the budget plan, as the "Podsumowanie" tab shows them and the
 * package PDF's cover prints them. Shared by the renderer and the main process
 * so the two never tell different numbers.
 */

import { PlanGospodarczy, PlanOkresZaliczki, Sprawozdanie, SprawozdanieWstepTekst } from './types';
import { planSumy } from './plan-gospodarczy';
import { formatKwota, sprawozdanieWstep } from './sprawozdanie';

/** One headline figure, already formatted. */
export interface SkrotLiczba {
  etykieta: string;
  wartosc: string;
  /** A loss or a negative balance reads 'zle', a surplus 'dobrze'. */
  ton: 'neutralny' | 'dobrze' | 'zle';
}

export interface Skrot {
  liczby: SkrotLiczba[];
  /** The points a reader should not miss. */
  uwagi: string[];
}

const zl = (n: number) => `${formatKwota(n)} zł`;

/** "2,70 zł/m²", or "2,70 → 2,90 zł/m²" when the rate changes during the year. */
export function stawkiLabel(okresy: PlanOkresZaliczki[]): string {
  const stawki = okresy.map((o) => o.stawka).filter((s, i, all) => i === 0 || s !== all[i - 1]);
  return stawki.length > 0 ? `${stawki.map((s) => formatKwota(s)).join(' → ')} zł/m²` : '—';
}

/** The statement's headline figures and notes — the introduction's, as edited for the version. */
export function sprawozdanieSkrot(spr: Sprawozdanie, tekst: SprawozdanieWstepTekst | null): Skrot {
  const w = sprawozdanieWstep(spr);
  return {
    liczby: w.kluczowe.map((k) => ({ etykieta: k.etykieta, wartosc: zl(k.kwota), ton: k.ton })),
    uwagi: tekst ? tekst.uwagi : w.uwagi,
  };
}

/** What the plan asks of the owners, and where the repair fund ends the year. */
export function planSkrot(plan: PlanGospodarczy): Skrot {
  const s = planSumy(plan);
  const liczby: SkrotLiczba[] = [
    { etykieta: 'Zaliczka „A” (mies.)', wartosc: stawkiLabel(plan.zaliczkaA), ton: 'neutralny' },
    { etykieta: 'Zaliczka „B” (mies.)', wartosc: stawkiLabel(plan.zaliczkaB), ton: 'neutralny' },
    { etykieta: 'Planowane koszty eksploatacji', wartosc: zl(s.kosztyA), ton: 'neutralny' },
  ];
  if (s.remontyFR > 0.005) {
    liczby.push({ etykieta: 'Remonty z funduszu', wartosc: zl(s.remontyFR), ton: 'neutralny' });
  }
  if (plan.kredyt > 0.005) {
    liczby.push({ etykieta: 'Spłata kredytu + odsetki', wartosc: zl(plan.kredyt), ton: 'neutralny' });
  }
  liczby.push({
    etykieta: 'Fundusz remontowy na koniec roku',
    wartosc: zl(s.saldoBKoniec),
    ton: s.saldoBKoniec < 0 ? 'zle' : 'neutralny',
  });
  const uwagi: string[] = [];
  if (Math.abs(s.roznicaA) >= 0.01) {
    uwagi.push(
      s.roznicaA > 0
        ? `Część I planu ma nadwyżkę: wpływy przewyższają koszty o ${zl(s.roznicaA)}.`
        : `Część I planu ma niedobór: koszty przewyższają wpływy o ${zl(-s.roznicaA)}.`,
    );
  }
  if (s.saldoBKoniec < 0) {
    uwagi.push(`Planowane koszty przekraczają fundusz remontowy o ${zl(-s.saldoBKoniec)}.`);
  }
  return { liczby, uwagi };
}
