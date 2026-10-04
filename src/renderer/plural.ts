import { Language } from './translations';

/** Polish plural: [one, few (2-4), many]. English: [singular, plural]. */
export function plural(n: number, language: Language, pl: [string, string, string], en: [string, string]): string {
  if (language === 'en') return `${n} ${n === 1 ? en[0] : en[1]}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (n === 1) word = pl[0];
  else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) word = pl[1];
  else word = pl[2];
  return `${n} ${word}`;
}
