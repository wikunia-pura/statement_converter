/**
 * Budget plans across the app — the ones in Zebrania (the source of truth)
 * and the ones made in the Plany gospodarcze module. Shared by the main
 * process (which refuses a module plan Zebrania already has) and the renderer.
 */

import { PlanGospodarczy, Zebranie, ZebraniaWspolnota, ZebranieWersja } from './types';
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
