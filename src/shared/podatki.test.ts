import { describe, it, expect } from 'vitest';
import {
  doGroszy,
  doZlotych,
  obliczDN1,
  pusteDane,
  pusteStawki,
  pustyGrunt,
  rozloz,
} from './podatki';
import { GruntRodzaj, PodatekNieruchomosciDane, PodatkiStawkiDane } from './types';

/** A declaration with one plot of `powierzchnia` of the given kind. */
function deklaracja(
  powierzchnia: number,
  opts: Partial<Pick<PodatekNieruchomosciDane, 'cel' | 'okresOd' | 'kwotaNieobjeta'>> & {
    rodzaj?: GruntRodzaj;
  } = {}
): PodatekNieruchomosciDane {
  const { rodzaj = 'pozostale', ...rest } = opts;
  return {
    ...pusteDane(),
    ...rest,
    grunty: [{ ...pustyGrunt(rodzaj), powierzchnia }],
  };
}

const stawka = (pozostale: number): PodatkiStawkiDane => ({ ...pusteStawki(), pozostale });

const suma = (raty: (number | null)[]) => raty.reduce<number>((s, r) => s + (r ?? 0), 0);

describe('rozloz — DN-1 monthly rates', () => {
  it('9 zł over 6 rates: the złoty left over go to the first months, none negative', () => {
    // The documented regression: evening out on the last rate gave −1 zł here.
    expect(rozloz(9, 6)).toEqual([2, 2, 2, 1, 1, 1]);
  });

  // The split declarations were filed with: each rate the share rounded to
  // whole złoty, the last one evening out. It must stay exactly that — a reprint
  // of a filed DN-1 has to show the rates that were filed.
  const filedSplit = (kwota: number, ile: number): number[] => {
    const rata = doZlotych(kwota / ile);
    const out = Array<number>(ile).fill(rata);
    out[ile - 1] = kwota - rata * (ile - 1);
    return out;
  };

  it('every split is exact, whole-złoty and never negative', () => {
    for (let kwota = 0; kwota <= 3000; kwota++) {
      for (let ile = 1; ile <= 12; ile++) {
        const raty = rozloz(kwota, ile);
        expect(raty).toHaveLength(ile);
        expect(raty.reduce((s, r) => s + r, 0)).toBe(kwota);
        expect(raty.every((r) => Number.isInteger(r) && r >= 0)).toBe(true);
      }
    }
  });

  it('keeps the filed split wherever it had no negative rate', () => {
    for (let kwota = 0; kwota <= 3000; kwota++) {
      for (let ile = 1; ile <= 12; ile++) {
        const filed = filedSplit(kwota, ile);
        if (filed.every((r) => r >= 0)) expect(rozloz(kwota, ile)).toEqual(filed);
      }
    }
    expect(rozloz(1000, 12)).toEqual([...Array(11).fill(83), 87]);
  });

  it('where the filed split would go negative, the rates differ by at most 1 zł', () => {
    const raty = rozloz(9, 6);
    expect(raty).toEqual([2, 2, 2, 1, 1, 1]);
    expect(Math.max(...raty) - Math.min(...raty)).toBeLessThanOrEqual(1);
  });

  it('no months → no rates', () => {
    expect(rozloz(50, 0)).toEqual([]);
  });
});

describe('rounding', () => {
  it('doGroszy is half-up and does not lose 1.005 to binary floating point', () => {
    expect(doGroszy(1.005)).toBe(1.01);
    expect(doGroszy(2.344)).toBe(2.34);
  });

  it('doZlotych: below 50 gr drops, 50 gr and more rounds up (note 7)', () => {
    expect(doZlotych(123.49)).toBe(123);
    expect(doZlotych(123.5)).toBe(124);
    expect(doZlotych(0.5)).toBe(1);
  });
});

describe('obliczDN1', () => {
  it('a full year up to 100 zł is paid at once, as the first rate', () => {
    // 100 m² × 0,67 zł = 67 zł.
    const w = obliczDN1(deklaracja(100), stawka(0.67));
    expect(w.kwota97).toBe(67);
    expect(w.kwota99).toBe(67);
    expect(w.raty[0]).toBe(67);
    expect(w.raty.slice(1).every((r) => r === null)).toBe(true);
  });

  it('a declaration from April up to 100 zł is paid at once on its own first month', () => {
    // 100 m² × 0,67 zł × 9/12 = 50,25 zł → 50 zł, all in April.
    const w = obliczDN1(deklaracja(100, { okresOd: 4 }), stawka(0.67));
    expect(w.miesiace).toBe(9);
    expect(w.kwota97).toBe(50.25);
    expect(w.kwota99).toBe(50);
    expect(w.raty[3]).toBe(50);
    expect(suma(w.raty)).toBe(50);
    expect(w.raty.filter((r) => r !== null)).toHaveLength(1);
  });

  it('over 100 zł spreads over the months, exactly, the last rate evening out', () => {
    // 1000 m² × 0,67 zł = 670 zł = 11 × 56 + 54.
    const w = obliczDN1(deklaracja(1000), stawka(0.67));
    expect(w.kwota99).toBe(670);
    expect(w.raty).toEqual([56, 56, 56, 56, 56, 56, 56, 56, 56, 56, 56, 54]);
  });

  it('poz. 99 rounds half-up to whole złoty', () => {
    expect(obliczDN1(deklaracja(247), stawka(0.5)).kwota99).toBe(124); // 123,50
    expect(obliczDN1(deklaracja(12349), stawka(0.01)).kwota99).toBe(123); // 123,49
  });

  it('a missing rate blocks every figure instead of printing zero', () => {
    const w = obliczDN1(deklaracja(100), null);
    expect(w.brakujaceStawki).toEqual(['pozostale']);
    expect(w.kwota97).toBeNull();
    expect(w.kwota99).toBeNull();
    expect(w.raty.every((r) => r === null)).toBe(true);
  });

  it('nothing to pay leaves every rate blank', () => {
    const w = obliczDN1({ ...pusteDane(), grunty: [] }, stawka(0.67));
    expect(w.kwota99).toBe(0);
    expect(w.raty.every((r) => r === null)).toBe(true);
  });

  it('correction: months it does not cover keep what was declared, a small rest is never negative', () => {
    // From July; 36 m² × 0,50 zł × 6/12 = 9 zł for the covered months, 95 zł
    // declared before (poz. 98) → poz. 99 = 104 zł. 9 zł over 6 months was the
    // case that used to produce a −1 zł rate.
    const w = obliczDN1(deklaracja(36, { cel: 2, okresOd: 7, kwotaNieobjeta: 95 }), stawka(0.5));
    expect(w.kwota97).toBe(9);
    expect(w.kwota98).toBe(95);
    expect(w.kwota99).toBe(104);
    expect(w.raty).toEqual([16, 16, 16, 16, 16, 15, 2, 2, 2, 1, 1, 1]);
  });

  it('correction up to 100 zł keeps January as the date of the single rate', () => {
    const w = obliczDN1(deklaracja(36, { cel: 2, okresOd: 7, kwotaNieobjeta: 40 }), stawka(0.5));
    expect(w.kwota99).toBe(49);
    expect(w.raty[0]).toBe(49);
    expect(w.raty.slice(1).every((r) => r === null)).toBe(true);
  });

  it('correction that lowers the tax below what was declared never asks for a negative rate', () => {
    // Declared 300 zł for January–June; the covered months now owe 0,50 zł.
    const w = obliczDN1(deklaracja(2, { cel: 2, okresOd: 7, kwotaNieobjeta: 300 }), stawka(0.5));
    expect(w.kwota99).toBe(301);
    expect(w.raty.every((r) => r === null || r >= 0)).toBe(true);
    expect(suma(w.raty)).toBe(301);
  });

  it('correction from January does not crash and spreads over the whole year', () => {
    const w = obliczDN1(deklaracja(1000, { cel: 2, okresOd: 1, kwotaNieobjeta: 0 }), stawka(0.67));
    expect(w.kwota99).toBe(670);
    expect(suma(w.raty)).toBe(670);
  });

  it('for every period, kind of declaration and amount: rates are whole, non-negative and add up to poz. 99', () => {
    for (const cel of [1, 2] as const) {
      for (let okresOd = 1; okresOd <= 12; okresOd++) {
        for (const powierzchnia of [0.5, 3, 17, 150, 333, 1234.56, 50000]) {
          for (const kwotaNieobjeta of [0, 7, 99.99, 250]) {
            const d = deklaracja(powierzchnia, { cel, okresOd, kwotaNieobjeta });
            const w = obliczDN1(d, stawka(0.89));
            const label = JSON.stringify({ cel, okresOd, powierzchnia, kwotaNieobjeta });
            expect(w.kwota99, label).not.toBeNull();
            const raty = w.raty.filter((r): r is number => r !== null);
            expect(
              raty.every((r) => Number.isInteger(r) && r >= 0),
              label
            ).toBe(true);
            expect(suma(w.raty), label).toBe(w.kwota99);
            if (cel === 1) {
              // A first declaration names no rate before the month it starts in.
              expect(
                w.raty.slice(0, okresOd - 1).every((r) => r === null),
                label
              ).toBe(true);
            }
          }
        }
      }
    }
  });
});
