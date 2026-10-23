/**
 * A community's areas kept on its Adresy record — the one place the budget
 * plans take their total, the city's and the leased ("pożytki") areas from.
 */

import { Adres, AdresPowierzchnie } from './types';

export const pustePowierzchnie = (): AdresPowierzchnie => ({ calkowita: null, miasto: null, pozytki: null });

/** A stored or typed area: a non-negative number, else null (not entered). */
const m2 = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/** Stored or typed data made safe to keep: every field present, each null or a non-negative m². */
export function normalizePowierzchnie(raw: unknown): AdresPowierzchnie {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { calkowita: m2(r.calkowita), miasto: m2(r.miasto), pozytki: m2(r.pozytki) };
}

/** Which of the areas an address still lacks — null, i.e. neither entered nor marked as none. */
export function brakujacePowierzchnie(adres: Pick<Adres, 'powierzchnie'>): (keyof AdresPowierzchnie)[] {
  const p = normalizePowierzchnie(adres.powierzchnie);
  // A total of 0 is no area at all — every advance rate would come out 0.
  return [
    ...(p.calkowita ? [] : (['calkowita'] as const)),
    ...(p.miasto === null ? (['miasto'] as const) : []),
    ...(p.pozytki === null ? (['pozytki'] as const) : []),
  ];
}
