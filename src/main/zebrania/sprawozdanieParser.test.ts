import { describe, it, expect } from 'vitest';
import { PdfLine, parseAmount, parseSprawozdaniaLines } from './sprawozdanieParser';

/** Amounts end at this column, as vDom right-aligns them. */
const RIGHT = 48;

let y = 800;
const line = (text: string, size = 10): PdfLine => ({
  page: 1,
  y: (y -= 12),
  x: 0,
  size,
  cw: 1,
  text,
});
/** A label with its amount right-aligned to RIGHT. */
const row = (label: string, amount: string) => line(label.padEnd(RIGHT - amount.length) + amount);

describe('parseAmount', () => {
  it('reads vDom amounts: dots for thousands, comma for decimals, a leading minus', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('-12,00')).toBe(-12);
    expect(parseAmount(' -1.000.000,01')).toBe(-1000000.01);
    expect(parseAmount('0,99')).toBe(0.99);
  });
});

describe('parseSprawozdaniaLines — amount pattern', () => {
  const lines = [
    line('Sprawozdanie Wspólnoty Mieszkaniowej', 18),
    line('Testowa 1', 18),
    line('Za okres od 2026.01.01 do 2026.09.30'),
    line('1. Koszty eksploatacji'.padEnd(RIGHT - 5) + 'Kwota'),
    line('-'.repeat(RIGHT)),
    row('Woda', '1.234,56'),
    // Digits without thousand dots are not this format: left unread, not cut to 345,67.
    row('Prad', '12345,67'),
    row('Gaz', '-12,00'),
    row('Wywoz smieci', '999,00'),
    line('-'.repeat(RIGHT)),
    row('Razem', '2.221,56'),
    line('4. Środki pieniężne'.padEnd(RIGHT - 9) + '98.472,96'),
  ];
  const [spr] = parseSprawozdaniaLines(lines);

  it('reads the statement header', () => {
    expect(spr.nazwa).toBe('Testowa 1');
    expect(spr.okresOd).toBe('2026-01-01');
    expect(spr.okresDo).toBe('2026-09-30');
  });

  it('reads dotted amounts under their column and keeps the sign', () => {
    const [koszty] = spr.sekcje;
    expect(koszty.tytul).toBe('1. Koszty eksploatacji');
    expect(koszty.kolumny).toEqual(['Kwota']);
    const byName = Object.fromEntries(
      koszty.wiersze.map((r) => [r.nazwa.split(' ')[0], r.kwoty[0]])
    );
    expect(byName.Woda).toBe(1234.56);
    expect(byName.Gaz).toBe(-12);
    expect(byName.Wywoz).toBe(999);
  });

  it('a run of digits without thousand dots ("12345,67") is not read from its middle', () => {
    const prad = spr.sekcje[0].wiersze.find((r) => r.nazwa.startsWith('Prad'))!;
    expect(prad.kwoty).toEqual([null]);
    expect(prad.kwoty).not.toContain(345.67);
  });

  it('rows after the second rule are the summary', () => {
    const razem = spr.sekcje[0].wiersze.find((r) => r.nazwa === 'Razem')!;
    expect(razem.podsumowanie).toBe(true);
    expect(razem.kwoty).toEqual([2221.56]);
  });

  it('an amount on the heading line is the section total', () => {
    expect(spr.sekcje[1].tytul).toBe('4. Środki pieniężne');
    expect(spr.sekcje[1].kwotaNaglowka).toBe(98472.96);
  });
});
