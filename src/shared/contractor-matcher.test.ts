import { describe, it, expect, vi } from 'vitest';

vi.mock('./logger', () => {
  const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: quiet, logger: quiet };
});

import { ContractorMatcher } from './contractor-matcher';
import { EXPENSE_MATCH_TYPES } from './expense-ai-matcher';
import { AITransaction } from './ai-types';
import { Kontrahent, KontrahentTyp } from './types';

/** The income side's pool, as BaseConverter passes it (INCOME_MATCH_TYPES). */
const INCOME: KontrahentTyp[] = ['Pozostałe przychody'];

let nextId = 1;
function k(nazwa: string, extra: Partial<Kontrahent> = {}): Kontrahent {
  return {
    id: nextId++,
    nazwa,
    kontoKontrahenta: `201-${nextId}`,
    typy: ['Kontrahent'],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

const tx = (descBase: string, descOpt = ''): AITransaction => ({
  descBase,
  descOpt,
  exeDate: '2026-01-05',
  value: -100,
});

const matched = (m: ContractorMatcher, t: AITransaction, types?: KontrahentTyp[]) =>
  m.match(t, types).contractor?.nazwa ?? null;

describe('ContractorMatcher — whole words only', () => {
  const serwis = k('Serwis');
  const m = new ContractorMatcher([serwis]);

  it('a name glued into a longer word does not match ("FVSERWIS")', () => {
    expect(matched(m, tx('FVSERWIS 12/2026'))).toBeNull();
    expect(matched(m, tx('SERWISANT DOMOFONOW'))).toBeNull();
  });

  it('the same name standing as a word matches, punctuation is a separator', () => {
    expect(matched(m, tx('FV SERWIS 12/2026'))).toBe('Serwis');
    expect(matched(m, tx('FV/SERWIS/12/2026'))).toBe('Serwis');
  });

  it('confidence follows where the name stands', () => {
    expect(m.match(tx('SERWIS')).confidence).toBe(100);
    expect(m.match(tx('SERWIS FV 1/2026')).confidence).toBe(95);
    expect(m.match(tx('FV 1/2026 SERWIS')).confidence).toBe(90);
  });
});

describe('ContractorMatcher — short names are hints, empty ones never match', () => {
  it('a two-character name matches only as a whole word, and only as a hint (60)', () => {
    const m = new ContractorMatcher([k('FR', { kontoKontrahenta: '850-2' })]);
    const hit = m.match(tx('PRZELEW NA FR ZA WRZESIEN'));
    expect(hit.contractor?.nazwa).toBe('FR');
    expect(hit.confidence).toBe(60);
    // Inside a longer word it is not a match at all.
    expect(matched(m, tx('FRANCUSKA 5 OPLATA'))).toBeNull();
  });

  it('a surer match in the other field beats a two-character hint', () => {
    // An overnight deposit: the community's own street "Fr. Joliot-Curie" sits in
    // the counterparty field, the deposit's own name in the title.
    const m = new ContractorMatcher([
      k('FR', { kontoKontrahenta: '850-2' }),
      k('Założenie lokaty Overnight', { kontoKontrahenta: '135-1' }),
    ]);
    const hit = m.match(tx('ZALOZENIE LOKATY OVERNIGHT', 'WSPOLNOTA TESTOWA UL. FR.JOLIOT-CURIE 9'));
    expect(hit.contractor?.nazwa).toBe('Założenie lokaty Overnight');
    expect(hit.confidence).toBe(100);
  });

  it('a single-character name is never matched', () => {
    const m = new ContractorMatcher([k('Firma Testowa', { alternativeNames: ['X'] })]);
    expect(matched(m, tx('FAKTURA X 12/2026'))).toBeNull();
  });

  it('a name of punctuation only ("-") normalizes to nothing and matches nothing', () => {
    // It used to match every description, at 95%, straight into the books.
    const m = new ContractorMatcher([k('-', { alternativeNames: ['-', '***', ' . '] })]);
    expect(matched(m, tx('PRZELEW - OPLATA *** ZA . STYCZEN'))).toBeNull();
    expect(m.getTopCandidates(tx('PRZELEW - OPLATA'), 10)).toEqual([]);
  });

  it('an empty name or description matches nothing', () => {
    const m = new ContractorMatcher([k(''), k('Energia Testowa')]);
    expect(matched(m, tx(''))).toBeNull();
    expect(matched(m, tx('   '))).toBeNull();
  });
});

describe('ContractorMatcher — digits glued to a name', () => {
  it('an invoice number glued to the name still lets the name match as words', () => {
    const m = new ContractorMatcher([k('ENERGIA ELEKTRYCZNA', { kontoKontrahenta: '425-2' })]);
    expect(matched(m, tx('Faktura VAT nr 123456789012energia elektryczna za 9/2026'))).toBe('ENERGIA ELEKTRYCZNA');
  });

  it('a name with digits of its own keeps matching ("M3 Serwis")', () => {
    const m = new ContractorMatcher([k('M3 Serwis')]);
    expect(matched(m, tx('FV 12/2026 M3 SERWIS SP Z O O'))).toBe('M3 Serwis');
    expect(matched(m, tx('FV 12/2026 M3SERWIS'))).toBe('M3 Serwis');
  });
});

describe('ContractorMatcher — diacritics fold', () => {
  it('"Usługi Wodne Łódź" matches a bank that writes "USLUGI WODNE LODZ", and back', () => {
    const m = new ContractorMatcher([k('Usługi Wodne Łódź')]);
    expect(matched(m, tx('FV 7/2026 USLUGI WODNE LODZ'))).toBe('Usługi Wodne Łódź');
    const back = new ContractorMatcher([k('USLUGI WODNE')]);
    expect(matched(back, tx('Usługi wodne za styczeń'))).toBe('USLUGI WODNE');
  });
});

describe('ContractorMatcher — NIP and wrapped names', () => {
  it('a NIP in the description matches, with or without dashes', () => {
    const m = new ContractorMatcher([k('Dostawca Testowy', { nip: '123-456-32-18' })]);
    expect(m.match(tx('FV 1/2026 NIP 1234563218')).confidence).toBe(98);
    expect(m.match(tx('FV 1/2026 NIP 123-456-32-18')).contractor?.nip).toBe('123-456-32-18');
  });

  it('a name cut by line wrapping ("DUD ZINSKI") still matches, but not glued into a longer word', () => {
    const m = new ContractorMatcher([k('Dudzinski Instalacje')]);
    const wrapped = m.match(tx('FV 3/2026 DUD ZINSKI INSTALACJE'));
    expect(wrapped.contractor?.nazwa).toBe('Dudzinski Instalacje');
    expect(wrapped.confidence).toBe(88);
    expect(matched(m, tx('FV 3/2026 XDUDZINSKIINSTALACJEX'))).toBeNull();
  });

  it('the counterparty field is tried first', () => {
    const m = new ContractorMatcher([k('Energia Testowa'), k('Woda Testowa')]);
    const r = m.match(tx('WODA TESTOWA FV 1', 'ENERGIA TESTOWA'));
    expect(r.contractor?.nazwa).toBe('Energia Testowa');
    expect(r.matchedIn).toBe('desc-opt');
  });
});

describe('ContractorMatcher — typ gates the direction', () => {
  const przychod = k('Najem Reklamy', { typy: ['Pozostałe przychody'] });
  const koszt = k('Sprzatanie Testowe', { typy: ['Pozostałe koszty'] });
  const kontrahent = k('Energia Testowa', { typy: [] }); // empty typy reads as 'Kontrahent'
  const oba = k('Firma Dwurola', { typy: ['Kontrahent', 'Pozostałe przychody'] });
  const m = new ContractorMatcher([przychod, koszt, kontrahent, oba]);

  it('the expense pool is Kontrahent + Pozostałe koszty', () => {
    expect([...EXPENSE_MATCH_TYPES].sort()).toEqual(['Kontrahent', 'Pozostałe koszty']);
  });

  it('"Pozostałe przychody" matches only income', () => {
    expect(matched(m, tx('NAJEM REKLAMY 01/2026'), INCOME)).toBe('Najem Reklamy');
    expect(matched(m, tx('NAJEM REKLAMY 01/2026'), EXPENSE_MATCH_TYPES)).toBeNull();
  });

  it('"Pozostałe koszty" and "Kontrahent" match only expenses', () => {
    expect(matched(m, tx('SPRZATANIE TESTOWE FV 1'), EXPENSE_MATCH_TYPES)).toBe(
      'Sprzatanie Testowe'
    );
    expect(matched(m, tx('SPRZATANIE TESTOWE FV 1'), INCOME)).toBeNull();
    expect(matched(m, tx('ENERGIA TESTOWA FV 2'), EXPENSE_MATCH_TYPES)).toBe('Energia Testowa');
    expect(matched(m, tx('ENERGIA TESTOWA FV 2'), INCOME)).toBeNull();
  });

  it('a contractor with both roles qualifies for both sides', () => {
    expect(matched(m, tx('FIRMA DWUROLA'), INCOME)).toBe('Firma Dwurola');
    expect(matched(m, tx('FIRMA DWUROLA'), EXPENSE_MATCH_TYPES)).toBe('Firma Dwurola');
  });

  it('the AI candidate list, the full pool and the id lookup honour the same gate', () => {
    const t = tx('NAJEM REKLAMY SPRZATANIE TESTOWE ENERGIA TESTOWA');
    expect(m.getTopCandidates(t, 10, EXPENSE_MATCH_TYPES).map((c) => c.id)).not.toContain(
      przychod.id
    );
    expect(m.getTopCandidates(t, 10, INCOME).map((c) => c.id)).toEqual([przychod.id]);
    expect(
      m
        .getAllByTypes(INCOME)
        .map((c) => c.id)
        .sort()
    ).toEqual([przychod.id, oba.id].sort());
    expect(m.getById(przychod.id, EXPENSE_MATCH_TYPES)).toBeUndefined();
    expect(m.getById(kontrahent.id, INCOME)).toBeUndefined();
    expect(m.getById(kontrahent.id, EXPENSE_MATCH_TYPES)?.id).toBe(kontrahent.id);
  });
});
