import { Language } from './translations';

/**
 * Which of Polish's three plural forms a count takes: 0 — one ("1 uchwała"),
 * 1 — few ("3 uchwały", "22 uchwały"), 2 — many ("5 uchwał", "12 uchwał").
 * For counts whose words live in translation keys rather than in `plural`'s arrays.
 */
export function pluralFormPl(n: number): 0 | 1 | 2 {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return 0;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 1;
  return 2;
}

/** Polish plural: [one, few (2-4), many]. English: [singular, plural]. */
export function plural(n: number, language: Language, pl: [string, string, string], en: [string, string]): string {
  if (language === 'en') return `${n} ${n === 1 ? en[0] : en[1]}`;
  return `${n} ${pl[pluralFormPl(n)]}`;
}
