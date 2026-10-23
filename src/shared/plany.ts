/**
 * Budget plans across the app — the ones in Zebrania (the source of truth)
 * and the ones made in the Plany gospodarcze module. Shared by the main
 * process (which refuses a module plan Zebrania already has) and the renderer.
 */

import { Adres, AdresPowierzchnie, PlanGospodarczy, Zebranie, ZebraniaWspolnota, ZebranieWersja } from './types';
import { normalizePowierzchnie } from './adres-powierzchnie';
import { foldText } from './text';
import { sortWersje } from './zebrania';

/** A plan of a Zebrania entry: the newest version that has one. */
export interface PlanZZebran {
  zebranie: Zebranie;
  wersja: ZebranieWersja;
  plan: PlanGospodarczy;
  /** The community's vDom number — from the version's statement, else as remembered for its community. */
  nrWsp: number | null;
}

/** Community and year: two plans with the same key are the same plan. */
export const planKey = (nrWsp: number | null, rok: number): string | null =>
  nrWsp == null ? null : `${nrWsp}|${rok}`;

export function planyZZebran(zebrania: Zebranie[], wspolnoty: ZebraniaWspolnota[]): PlanZZebran[] {
  const nrByName = new Map(
    wspolnoty.filter((w) => w.vdomNr != null).map((w) => [w.adresNazwa, w.vdomNr as number]),
  );
  const out: PlanZZebran[] = [];
  for (const zebranie of zebrania) {
    const wersja = [...sortWersje(zebranie.wersje)].reverse().find((w) => w.plan);
    if (!wersja?.plan) continue;
    const nrWsp = wersja.sprawozdanie?.dane.nrWsp ?? nrByName.get(zebranie.adresNazwa) ?? null;
    out.push({ zebranie, wersja, plan: wersja.plan, nrWsp });
  }
  return out;
}

/** The Zebrania plan a module plan of this community and year would duplicate, if any. */
export function planWZebraniach(
  plany: PlanZZebran[],
  nrWsp: number | null,
  rok: number,
): PlanZZebran | undefined {
  const key = planKey(nrWsp, rok);
  return key ? plany.find((p) => planKey(p.nrWsp, p.plan.rok) === key) : undefined;
}

/** A community's address by the name a meeting or the Zebrania module keeps for it. */
export function adresPoNazwie(adresy: Adres[], nazwa: string | null | undefined): Adres | null {
  if (!nazwa) return null;
  const key = foldText(nazwa);
  return adresy.find((a) => foldText(a.nazwa) === key) ?? null;
}

/**
 * The plan with its community's areas, as the address keeps them. An area the
 * address has not got entered stays as the plan has it — for the total, as the
 * statement printed it when the plan was drafted.
 */
export function zPowierzchniamiAdresu(
  plan: PlanGospodarczy,
  powierzchnie: AdresPowierzchnie | null | undefined,
): PlanGospodarczy {
  if (!powierzchnie) return plan;
  const p = normalizePowierzchnie(powierzchnie);
  return {
    ...plan,
    powierzchnia: p.calkowita || plan.powierzchnia,
    miastoM2: p.miasto ?? plan.miastoM2,
    pozytkiM2: p.pozytki ?? plan.pozytkiM2,
  };
}

/** Whether the address now gives the plan other areas than it holds — offered as "Pobierz z adresu". */
export function powierzchnieNieaktualne(
  plan: PlanGospodarczy,
  powierzchnie: AdresPowierzchnie | null | undefined,
): boolean {
  const z = zPowierzchniamiAdresu(plan, powierzchnie);
  return z.powierzchnia !== plan.powierzchnia || z.miastoM2 !== plan.miastoM2 || z.pozytkiM2 !== plan.pozytkiM2;
}
