import { describe, it, expect } from 'vitest';
import { planDoDruku, pozycjePlanu } from './plan-gospodarczy';
import { PlanGospodarczy, PlanPozycja, Sprawozdanie, SprawozdanieWiersz } from './types';

const w = (nazwa: string, kwoty: (number | null)[], extra: Partial<SprawozdanieWiersz> = {}): SprawozdanieWiersz => ({
  nazwa,
  kwoty,
  podsumowanie: false,
  wyroznienie: false,
  ...extra,
});

const spr = (wiersze: SprawozdanieWiersz[]): Sprawozdanie => ({
  nrWsp: 1,
  nazwa: 'Wspólnota Mieszkaniowa Testowa 1',
  okresOd: '2025-01-01',
  okresDo: '2025-12-31',
  powierzchnia: 1000,
  powierzchniaCo: null,
  sredniaLiczbaOsob: null,
  sekcje: [{ tytul: '2. Koszty eksploatacji', kolumny: ['Przychody', 'Koszty'], kwotaNaglowka: null, wiersze }],
  wydruk: '',
});

describe('pozycjePlanu — nothing is planned for what came to zero', () => {
  it('leaves out an item that is zero', () => {
    const pozycje = pozycjePlanu(spr([w('Energia', [null, 1200]), w('Odsetki od kredytu', [null, 0])]), null);
    expect(pozycje.map((z) => z.nazwa)).toEqual(['Energia']);
  });

  it('keeps a merge whole, its zero parts included', () => {
    const printed = spr([w('Woda', [null, 300]), w('Ścieki', [null, 0])]);
    const merged: Sprawozdanie = {
      ...printed,
      sekcje: [{ ...printed.sekcje[0], wiersze: [w('Media', [null, 300], { polaczone: ['Woda', 'Ścieki'] })] }],
    };
    const [z] = pozycjePlanu(printed, merged);
    expect(z.wiersze).toEqual(['Woda', 'Ścieki']);
    expect(z.kwotaRoczna).toBe(300);
  });

  it('leaves out a merge that sums to zero', () => {
    const printed = spr([w('Zwrot', [null, -50]), w('Naprawa', [null, 50])]);
    const merged: Sprawozdanie = {
      ...printed,
      sekcje: [{ ...printed.sekcje[0], wiersze: [w('Razem naprawy', [null, 0], { polaczone: ['Zwrot', 'Naprawa'] })] }],
    };
    expect(pozycjePlanu(printed, merged)).toEqual([]);
  });
});

describe('planDoDruku — the documents leave out positions planned at zero', () => {
  const poz = (nazwa: string, kwota: number): PlanPozycja => ({
    id: nazwa,
    strona: 'koszt',
    nazwa,
    wiersze: [],
    grupa: '',
    kwotaRoczna: kwota,
    kwota,
  });

  it('drops only the zero ones', () => {
    const plan = { pozycje: [poz('Energia', 1200), poz('Kredyt', 0), poz('Grosze', 0.001)] } as PlanGospodarczy;
    expect(planDoDruku(plan).pozycje.map((z) => z.nazwa)).toEqual(['Energia']);
  });
});
