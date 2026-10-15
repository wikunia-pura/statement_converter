import { describe, it, expect } from 'vitest';
import { foldText } from './text';
import { formatKwota } from './sprawozdanie';

describe('foldText', () => {
  it('lower-cases and drops Polish diacritics, ł included', () => {
    expect(foldText('ZAŻÓŁĆ GĘŚLĄ JAŹŃ')).toBe('zazolc gesla jazn');
    expect(foldText('Usługi Łódź')).toBe('uslugi lodz');
  });

  it('collapses and trims whitespace, tabs and newlines included', () => {
    expect(foldText('  Testowa \t 1\n\nlokal  2 ')).toBe('testowa 1 lokal 2');
  });

  it('the same name typed two ways folds to one', () => {
    expect(foldText('USLUGI WODNE')).toBe(foldText('Usługi  wodne'));
  });

  it('decomposed (NFD) input folds like composed', () => {
    expect(foldText('Żółw')).toBe('zolw');
  });
});

describe('formatKwota', () => {
  it('groups thousands with a plain space, always — four digits too', () => {
    expect(formatKwota(12345.6)).toBe('12 345,60');
    expect(formatKwota(6609.1)).toBe('6 609,10');
    expect(formatKwota(1000000)).toBe('1 000 000,00');
    expect(formatKwota(-1234.5)).toBe('-1 234,50');
    expect(formatKwota(0)).toBe('0,00');
  });

  it('never leaves a no-break space in a document', () => {
    expect(formatKwota(1234567.89)).not.toMatch(/[  ]/);
  });

  it('nothing to print for null, undefined, NaN or Infinity', () => {
    expect(formatKwota(null)).toBe('');
    expect(formatKwota(undefined)).toBe('');
    expect(formatKwota(Number.NaN)).toBe('');
    expect(formatKwota(Number.POSITIVE_INFINITY)).toBe('');
  });

  // Float sums produce such values (0.3 - 0.1 - 0.2 = -2.8e-17); they must not
  // reach a document as "-0,00".
  it('a negative amount that rounds to zero prints as "0,00"', () => {
    expect(formatKwota(0.3 - 0.1 - 0.2)).toBe('0,00');
  });
});
