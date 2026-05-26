/**
 * Pure helpers for community-account matching.
 *
 * Safe to import from the renderer — no Node-only deps. The actual file-reading
 * extractor lives in `./account-extractor-node.ts` and is called via IPC.
 */
import type { Adres } from './types';

/** Canonicalize any user/file-supplied form to bare 26 digits, or null if it doesn't fit. */
export function normalizeAccount(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw
    .replace(/^\//, '')
    .replace(/^PL/i, '')
    .replace(/[\s\-]/g, '')
    .replace(/^PL/i, ''); // a leading slash can hide the PL — re-strip just in case
  if (!/^\d{26}$/.test(digits)) return null;
  return digits;
}

/** True iff the string canonicalizes to a 26-digit Polish bank account number. */
export function isValidAccountFormat(raw: string): boolean {
  return normalizeAccount(raw) !== null;
}

/**
 * Find an Adres by any of the file's detected account numbers.
 *
 * Returns:
 *   { adres }                          — exactly one address matches one of the accounts
 *   { adres: null, candidates: [...] } — multiple addresses match (shouldn't happen with
 *                                         the dup-check on save, but defensive)
 *   { adres: null, candidates: [] }    — no address matches any of the detected accounts
 *
 * When `bankFilter` is set, only addresses linked to that bank (or addresses
 * with no bank link) are considered, mirroring the Converter's dropdown scope.
 */
export function findAdresByAccountNumbers(
  detected: string[],
  adresy: Adres[],
  bankFilter?: number | null,
): { adres: Adres | null; candidates: Adres[] } {
  if (detected.length === 0) return { adres: null, candidates: [] };

  const detectedSet = new Set(detected.map(normalizeAccount).filter((x): x is string => !!x));
  if (detectedSet.size === 0) return { adres: null, candidates: [] };

  const scoped = bankFilter
    ? adresy.filter(a => !a.bankId || a.bankId === bankFilter)
    : adresy;

  const matches: Adres[] = [];
  for (const adres of scoped) {
    const accounts = (adres.accountNumbers ?? [])
      .map(normalizeAccount)
      .filter((x): x is string => !!x);
    if (accounts.some(acc => detectedSet.has(acc))) {
      matches.push(adres);
    }
  }

  if (matches.length === 1) return { adres: matches[0], candidates: matches };
  return { adres: null, candidates: matches };
}
