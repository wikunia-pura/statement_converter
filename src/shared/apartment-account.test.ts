import { describe, it, expect } from 'vitest';
import {
  HELD_BACK_CONFIDENCE,
  apartmentGlueInText,
  apartmentSplitInText,
  apartmentWidthImplausible,
  composeApartmentAccount,
  isAccountSymbol,
  isLetteredApartment,
  letteredApartmentInText,
  needsExplicitAccount,
  resolveApartmentAccount,
  stripAddressCodes,
} from './apartment-account';

describe('isAccountSymbol — a well-formed symbol, not "anything with a dash"', () => {
  it.each(['204-000017', '204-00017A', '235-1', '20-1', '2040-1-2', ' 204-000017 '])(
    '%s is a symbol',
    (v) => {
      expect(isAccountSymbol(v)).toBe(true);
    }
  );

  it.each([
    '12-',
    '-5',
    '204-',
    '204--1',
    '1-1',
    '12345-1',
    'abc-1',
    '17',
    '17A',
    'ZGN',
    '',
    '204-1 2',
    null,
    undefined,
  ])('%s is not', (v) => {
    expect(isAccountSymbol(v)).toBe(false);
  });
});

describe('resolveApartmentAccount', () => {
  it('a plain number gets the convention, zero-padded to six', () => {
    expect(resolveApartmentAccount('17', null, '204')).toBe('204-000017');
    expect(resolveApartmentAccount(' 5 ', undefined, '205')).toBe('205-000005');
  });

  it('ZGN books to the all-zeros account', () => {
    expect(resolveApartmentAccount('zgn', null, '204')).toBe('204-000000');
  });

  it('a lettered apartment is never given an account we made up', () => {
    expect(resolveApartmentAccount('17A', null, '204')).toBeNull();
    expect(resolveApartmentAccount('5b', '', '204')).toBeNull();
  });

  it('an already-resolved symbol passes untouched, a malformed one does not', () => {
    expect(resolveApartmentAccount('235-1', null, '204')).toBe('235-1');
    expect(resolveApartmentAccount('12-', null, '204')).toBeNull();
    expect(resolveApartmentAccount('-5', null, '204')).toBeNull();
    expect(resolveApartmentAccount('17AB', null, '204')).toBeNull();
    expect(resolveApartmentAccount('', null, '204')).toBeNull();
  });

  it('an explicit override wins; an override that is no symbol blocks instead of falling back', () => {
    expect(resolveApartmentAccount('17A', '204-00017A', '204')).toBe('204-00017A');
    expect(resolveApartmentAccount('17', '204-00017A', '204')).toBe('204-00017A');
    expect(resolveApartmentAccount('17', '17A', '204')).toBeNull();
  });
});

describe('composeApartmentAccount', () => {
  it('prefix + typed suffix, used exactly as typed', () => {
    expect(composeApartmentAccount('204', '17A')).toBe('204-17A');
    expect(composeApartmentAccount('204', '00017A')).toBe('204-00017A');
  });
  it('the whole symbol pasted in is tolerated', () => {
    expect(composeApartmentAccount('204', '204-00017A')).toBe('204-00017A');
  });
  it('empty or unusable suffix → null', () => {
    expect(composeApartmentAccount('204', '  ')).toBeNull();
    expect(composeApartmentAccount('204', '17 A')).toBeNull();
    expect(composeApartmentAccount('204', '-')).toBeNull();
  });
});

describe('letter guard', () => {
  it('lettered apartments are told from plain ones', () => {
    expect(isLetteredApartment('17A')).toBe(true);
    expect(isLetteredApartment('5b')).toBe(true);
    expect(isLetteredApartment('17')).toBe(false);
    expect(isLetteredApartment('17AB')).toBe(false);
    expect(isLetteredApartment('204-17A')).toBe(false);
  });

  it('a letter is read from the text only where it reads as an apartment', () => {
    expect(letteredApartmentInText('CZYNSZ TESTOWA 1/17a')).toBe('17A');
    expect(letteredApartmentInText('OPLATA LOK. 5b STYCZEN')).toBe('5B');
    expect(letteredApartmentInText('CZYNSZ ZA M-C VII/2026r.')).toBeNull();
    expect(letteredApartmentInText('CZYNSZ TESTOWA 1 M 17')).toBeNull();
    expect(letteredApartmentInText(null)).toBeNull();
  });

  it('needsExplicitAccount holds the 17-vs-17A mis-booking and doubtful answers', () => {
    expect(needsExplicitAccount('17A', null, '')).toBe(true);
    // The matcher said 17, the text says 17A: the letter was lost.
    expect(needsExplicitAccount('17', null, 'CZYNSZ TESTOWA 1/17A')).toBe(true);
    // A range from the AI looks like a symbol by shape alone.
    expect(needsExplicitAccount('12-14', null, '')).toBe(true);
    expect(needsExplicitAccount('17', null, 'CZYNSZ TESTOWA 1/17 ZA 07/2026')).toBe(false);
    expect(needsExplicitAccount('ZGN', null, '')).toBe(false);
    expect(needsExplicitAccount('', null, 'TESTOWA 1/17A')).toBe(false);
  });

  it('an explicit account answers the question', () => {
    expect(needsExplicitAccount('17', '204-00017A', 'CZYNSZ TESTOWA 1/17A')).toBe(false);
  });
});

describe('glue guard — address codes and glued text', () => {
  it('postal codes and dashed NIPs are taken out before reading the apartment', () => {
    // "M.202-620" is apartment 2 in 02-620, not apartment 202.
    expect(stripAddressCodes('TESTOWA 5 M.202-620 WARSZAWA')).toBe('TESTOWA 5 M.2  WARSZAWA');
    // The NIP goes first, so its dashes do not form a false postal code.
    expect(stripAddressCodes('NIP 123-456-32-18 LOK 7')).toBe('NIP   LOK 7');
    expect(stripAddressCodes(null)).toBe('');
  });

  it('text glued to the number is reported, a clean end is not', () => {
    expect(apartmentGlueInText('CZYNSZ LOK.12WARSZAWA', '12')).toBe('WARSZAWA');
    expect(apartmentGlueInText('CZYNSZ LOK. 12, WARSZAWA', '12')).toBeNull();
    expect(apartmentGlueInText('TESTOWA 5 M.202-620 WARSZAWA', '2')).toBeNull();
  });

  it('the number must be the whole digit run, and absence is not evidence', () => {
    expect(apartmentGlueInText('CZYNSZ LOK. 25X', '2')).toBeNull();
    expect(apartmentGlueInText('TESTOWA 116 10', '10')).toBeNull();
    expect(apartmentGlueInText('LOK.12WARSZAWA', 'ZGN')).toBeNull();
  });
});

describe('split guard — a number cut in two by line wrapping', () => {
  it('"lok1 0" and "114/1 2" are reported', () => {
    expect(apartmentSplitInText('CZYNSZ LOK1 0 STYCZEN', '1')).toBe('0');
    expect(apartmentSplitInText('TESTOWA 114/1 2', '1')).toBe('2');
  });

  it('a following date, amount or year is not a tail', () => {
    expect(apartmentSplitInText('M. 5 08.2026', '5')).toBeNull();
    expect(apartmentSplitInText('LOKAL 3 150,00', '3')).toBeNull();
    expect(apartmentSplitInText('LOK 5 2026', '5')).toBeNull();
    expect(apartmentSplitInText('M. 5 7/2026', '5')).toBeNull();
  });

  it('a long reference after the number is not one number in two pieces', () => {
    expect(apartmentSplitInText('M. 12 260826109199', '12')).toBeNull();
  });

  it('a lettered apartment has no tail', () => {
    expect(apartmentSplitInText('LOK 1A 0', '1A')).toBeNull();
  });
});

describe('width guard', () => {
  it('four digits and more is no apartment anyone lives at', () => {
    expect(apartmentWidthImplausible('1000')).toBe(true);
    expect(apartmentWidthImplausible('20262')).toBe(true);
    expect(apartmentWidthImplausible('1000A')).toBe(true);
    expect(apartmentWidthImplausible('999')).toBe(false);
    expect(apartmentWidthImplausible('17A')).toBe(false);
    expect(apartmentWidthImplausible('ZGN')).toBe(false);
    expect(apartmentWidthImplausible(null)).toBe(false);
  });

  it('a held-back reading sits under any review threshold', () => {
    expect(HELD_BACK_CONFIDENCE).toBeLessThan(50);
  });
});
