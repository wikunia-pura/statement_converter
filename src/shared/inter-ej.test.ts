import { describe, it, expect } from 'vitest';
import {
  nazwaInterEj,
  ukryteKwotyInterEj,
  wierszInterEj,
  wspominaInterEj,
  zakazInterEj,
} from './inter-ej';
import { SprawozdanieWiersz } from './types';

const w = (nazwa: string, extra: Partial<SprawozdanieWiersz> = {}): SprawozdanieWiersz => ({
  nazwa,
  kwoty: [100],
  podsumowanie: false,
  wyroznienie: false,
  ...extra,
});

describe('nazwaInterEj — however the name was typed', () => {
  it.each([
    'INTER-EJ',
    'Inter EJ',
    'InterEJ',
    'inter_ej',
    'Inter–EJ',
    'Inter.EJ',
    'Wynagrodzenie INTER-EJ sp. z o.o.',
  ])('%s is INTER-EJ', (nazwa) => expect(nazwaInterEj(nazwa)).toBe(true));

  it.each(['Internet', 'Interes wspólnoty', 'Koszty zarządu', 'EJ Inter'])('%s is not', (nazwa) =>
    expect(nazwaInterEj(nazwa)).toBe(false)
  );
});

describe('wierszInterEj', () => {
  it('a merged row is INTER-EJ when one of the rows it sums is', () => {
    expect(wierszInterEj(w('Obsługa', { polaczone: ['Księgowość', 'Inter-EJ zarządzanie'] }))).toBe(
      true
    );
    expect(wierszInterEj(w('Obsługa', { polaczone: ['Księgowość', 'Sprzątanie'] }))).toBe(false);
    expect(wierszInterEj(w('Obsługa'))).toBe(false);
  });
});

describe('ukryteKwotyInterEj — which amounts must never be mentioned', () => {
  it('INTER-EJ rows, and a subcategory heading over one; never a summary row', () => {
    const sekcja = {
      wiersze: [
        w('Woda'), // 0
        w('Zarząd', { podkategoria: 'naglowek' }), // 1 — heads an INTER-EJ item
        w('INTER-EJ wynagrodzenie', { podkategoria: 'pozycja' }), // 2
        w('Inne', { podkategoria: 'pozycja' }), // 3
        w('Usługi Inter EJ'), // 4 — a row of the section
        w('Remonty', { podkategoria: 'naglowek' }), // 5 — heads no INTER-EJ item
        w('Dach', { podkategoria: 'pozycja' }), // 6
        w('Obsługa', { polaczone: ['Księgowość', 'InterEJ'] }), // 7 — merged
        w('Razem (w tym INTER-EJ)', { podsumowanie: true }), // 8
      ],
    };
    expect([...ukryteKwotyInterEj(sekcja)].sort((a, b) => a - b)).toEqual([1, 2, 4, 7]);
  });

  it('an INTER-EJ row after the subcategory ended does not hide the old heading', () => {
    const sekcja = {
      wiersze: [
        w('Zarząd', { podkategoria: 'naglowek' }),
        w('Księgowość', { podkategoria: 'pozycja' }),
        w('INTER-EJ'),
      ],
    };
    expect([...ukryteKwotyInterEj(sekcja)]).toEqual([2]);
  });

  it('a section without INTER-EJ hides nothing', () => {
    expect(ukryteKwotyInterEj({ wiersze: [w('Woda'), w('Prąd')] }).size).toBe(0);
  });
});

describe('zakazInterEj — an AI answer that brings INTER-EJ up is refused', () => {
  it('throws on any spelling, passes text without it', () => {
    expect(() => zakazInterEj('Koszt Inter EJ wyniósł 1 200,00 zł.')).toThrow(/INTER-EJ/);
    expect(() => zakazInterEj('Koszty zarządu wyniosły 1 200,00 zł.')).not.toThrow();
    expect(wspominaInterEj('interej')).toBe(true);
  });
});
