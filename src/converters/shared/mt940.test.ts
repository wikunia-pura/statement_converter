import { describe, it, expect } from 'vitest';
import { line61Excerpt, parseLine61, walkMt940Entries } from './mt940';

describe('parseLine61', () => {
  it('reads value date, entry date, side, amount with a comma, and the rest', () => {
    expect(parseLine61('2601050105C431,14NU13NONREF//5010000000001')).toEqual({
      valueDate: '260105',
      entryDate: '0105',
      reversal: false,
      debitCredit: 'C',
      fundsCode: '',
      amountText: '431,14',
      amount: 431.14,
      rest: 'NU13NONREF//5010000000001',
    });
  });

  it('entry date is optional', () => {
    const l = parseLine61('260105D12,00S020REF');
    expect(l?.valueDate).toBe('260105');
    expect(l?.entryDate).toBe('');
    expect(l?.debitCredit).toBe('D');
    expect(l?.amount).toBe(12);
  });

  it('a funds code after the mark no longer empties the amount ("CN653,00")', () => {
    const l = parseLine61('2607010701CN653,00NTRFNONREF//1');
    expect(l?.fundsCode).toBe('N');
    expect(l?.debitCredit).toBe('C');
    expect(l?.amount).toBe(653);
    expect(l?.rest).toBe('NTRFNONREF//1');
  });

  it('a storno turns the side over: RC takes money out (D), RD brings it back (C)', () => {
    const rc = parseLine61('2601100110RC100,00S020REF');
    expect(rc?.reversal).toBe(true);
    expect(rc?.debitCredit).toBe('D');
    expect(rc?.amount).toBe(100);

    const rd = parseLine61('2601100110RDN25,50NTRF');
    expect(rd?.reversal).toBe(true);
    expect(rd?.debitCredit).toBe('C');
    expect(rd?.fundsCode).toBe('N');
    expect(rd?.amount).toBe(25.5);
  });

  it('whole amounts and a bare trailing comma read', () => {
    expect(parseLine61('260105C653S020')?.amount).toBe(653);
    expect(parseLine61('260105C653,S020')?.amount).toBe(653);
  });

  it('an amount that does not read comes back null — never 0,00', () => {
    // A dot right after the digits: "1.000,00" is not an MT940 amount.
    const dotted = parseLine61('2601070107D1.000,00S020REF');
    expect(dotted).not.toBeNull();
    expect(dotted?.amount).toBeNull();
    // Two commas.
    expect(parseLine61('2601070107D1,000,00S020')?.amount).toBeNull();
  });

  it('a line not shaped like :61: is null', () => {
    expect(parseLine61('')).toBeNull();
    expect(parseLine61('C260105PLN100,00')).toBeNull();
    expect(parseLine61('26010X0105C100,00')).toBeNull();
    expect(parseLine61('2601050105X100,00')).toBeNull();
  });

  it('reads only the first line of a multi-line value', () => {
    const l = parseLine61('2601050105C10,00S020REF\nCONTINUATION 999,99');
    expect(l?.amount).toBe(10);
    expect(l?.rest).toBe('S020REF');
  });

  it('excerpt is the trimmed first line, at most 80 characters', () => {
    expect(line61Excerpt('  2601050105C10,00 \nsecond')).toBe('2601050105C10,00');
    expect(line61Excerpt('X'.repeat(100))).toHaveLength(80);
  });
});

describe('walkMt940Entries — :61: and :86: paired in file order', () => {
  const FILE = [
    ':20:TEST',
    ':25:/PL00000000000000000000000000',
    ':60F:C260101PLN1000,00',
    ':61:2601050105C100,00S020REF1',
    ':86:~20Opis pierwszy',
    ':61:2601060106D50,00S020REF2',
    ':86:',
    ':61:2601070107C25,00S020REF3',
    ':86:~20Opis trzeci',
    '~21ciag dalszy',
    ':62F:C260131PLN1075,00',
    ':86:NAME ACCOUNT OWNER:WSPOLNOTA TESTOWA 1',
    '-',
  ].join('\n');

  it('an empty :86: stays an empty description and does not shift the next one', () => {
    const entries = walkMt940Entries(FILE);
    expect(entries).toEqual([
      { field61: '2601050105C100,00S020REF1', field86s: ['~20Opis pierwszy'] },
      { field61: '2601060106D50,00S020REF2', field86s: [''] },
      { field61: '2601070107C25,00S020REF3', field86s: ['~20Opis trzeci\n~21ciag dalszy'] },
    ]);
  });

  it('a :61: without any :86: gets none, and the next transaction keeps its own', () => {
    const entries = walkMt940Entries(
      [':61:2601050105C1,00S020A', ':61:2601060106C2,00S020B', ':86:~20B'].join('\n')
    );
    expect(entries.map((e) => e.field86s)).toEqual([[], ['~20B']]);
  });

  it('several :86: after one :61: all belong to it, in order (ING writes two)', () => {
    const entries = walkMt940Entries(
      [':61:2601050105C1,00S020A', ':86:020', ':86:020~00PRZELEW~20Opis'].join('\n')
    );
    expect(entries).toEqual([
      { field61: '2601050105C1,00S020A', field86s: ['020', '020~00PRZELEW~20Opis'] },
    ]);
  });

  it('the statement-level :86: after :62F: belongs to no transaction', () => {
    const entries = walkMt940Entries(FILE);
    expect(entries.flatMap((e) => e.field86s).some((v) => v.includes('ACCOUNT OWNER'))).toBe(false);
  });

  it('continuation lines of :61: are kept, the "-" and "-}" terminators are not', () => {
    const entries = walkMt940Entries(
      [':61:2601050105C1,00S020A', 'MORE', ':86:<20Opis', '-}'].join('\n')
    );
    expect(entries).toEqual([{ field61: '2601050105C1,00S020A\nMORE', field86s: ['<20Opis'] }]);
  });
});
