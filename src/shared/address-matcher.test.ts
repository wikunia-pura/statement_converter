import { describe, expect, it } from 'vitest';
import { AddressMatcher } from './address-matcher';
import type { Adres } from './types';

const community = (nazwa: string) => ({ id: 1, nazwa, alternativeNames: [], apartmentMappings: [] }) as unknown as Adres;

/** What a converter hands the matcher: the title, then the counterparty. */
const match = (m: AddressMatcher, title: string, counterparty: string) => m.match(`${title} ${counterparty}`, counterparty);

describe('AddressMatcher — a building numbered "5/7"', () => {
  const m = new AddressMatcher([community('Jadźwingów 5/7'), community('Lotników 5')]);

  it('reads the apartment after the whole building number', () => {
    for (const [title, apt] of [
      ['Czynsz Jadźwingów 5/7 m. 11', '11'],
      ['za Jadźwingów 5/7/39 za czerwiec', '39'],
      ['Opłata mieszkanie Jadźwingów 5/7lok. 79, 02-692 Warszawa', '79'],
      ['Jadźwingów 5/7m. 135', '135'],
      ['Czynsz Jadźwingów 5 / 7 m. 12', '12'],
    ] as const) {
      const r = match(m, title, 'JAN NOWAK');
      expect(r.apartmentNumber, title).toBe(apt);
      expect(r.confidence.overall, title).toBeGreaterThanOrEqual(85);
    }
  });

  it('never reads the building number itself as building 5, apartment 7', () => {
    for (const counterparty of [
      'JAN NOWAK 02-692 WARSZAWA UL. JADŹWINGÓW 5/7',
      'JAN NOWAK UL JADŹWINGÓW 5/7 M',
      'WSPÓLNOTA MIESZKANIOWA UL.JADŹWINGÓW 5/7',
      'JAN NOWAK UL. JADŻWINGÓW 5/7',
      'JAN NOWAK UL. JADŹWINGÓW 5 / 7',
    ]) {
      expect(match(m, 'OPŁATA ZA CZYNSZ ZA 06.2026', counterparty).apartmentNumber, counterparty).toBeNull();
    }
  });

  it('takes the apartment glued to the building number in the payer address, and no lettered "7M" from it', () => {
    const r = match(m, 'jadźwingów 5/7 m 143', 'JAN NOWAK 02-692 WARSZAWA UL JADŹWINGÓW 5/7M143');
    expect(r.apartmentNumber).toBe('143');
    expect(r.needsAccount).toBe(false);
  });

  it('recognises the street when the payer bank put "?" in place of its Polish letter', () => {
    const r = match(m, 'Czynsz Jad?wingów 5/7 m. 11', 'JAN NOWAK');
    expect(r.apartmentNumber).toBe('11');
    expect(r.confidence.overall).toBeGreaterThanOrEqual(85);
  });

  it('accepts a payer address the bank cut to "Jadźwingów 5" as this community', () => {
    const r = match(m, 'CZYNSZ ID. LOKALU 22/97', 'JAN NOWAK 02-692 WARSZAWA UL. JADŹWINGÓW 5');
    expect(r.apartmentNumber).toBe('97');
    expect(r.confidence.address).toBe(95);
  });

  it('leaves "5/7" of a plain building as building 5, apartment 7', () => {
    expect(match(m, 'Czynsz Lotników 5/7', 'JAN NOWAK').apartmentNumber).toBe('7');
  });
});
