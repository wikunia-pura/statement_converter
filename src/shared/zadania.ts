/**
 * Dates and attachment rules of the "Zadania" board — one place, because the
 * renderer (badges, the dashboard's three groups) and the main process (the
 * overdue notification, input validation) must agree on what "today" and "too
 * big" mean.
 */
import type { Zadanie } from './types';

/** An attachment may not exceed this; the Supabase bucket enforces the same number. */
export const ZADANIE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The due date as it is stored and compared: `YYYY-MM-DD`, in the machine's own
 * calendar. A task's deadline is a day, not an instant, so there is no time zone
 * to convert — "due on the 3rd" is the 3rd for whoever is looking.
 */
export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True for a real calendar day written as `YYYY-MM-DD` (rejects 2026-02-31). */
export function isValidDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export type ZadanieDueBucket = 'overdue' | 'today' | 'upcoming';

/**
 * Where a deadline stands against today. Lexical comparison is exact for
 * `YYYY-MM-DD`, and avoids a Date round-trip per card.
 */
export function dueBucket(termin: string | null | undefined, today: string): ZadanieDueBucket | null {
  if (!termin) return null;
  if (termin < today) return 'overdue';
  if (termin === today) return 'today';
  return 'upcoming';
}

/** A finished task is never late, however old its date. */
export function isOverdue(z: Pick<Zadanie, 'termin' | 'status'>, today: string): boolean {
  return z.status !== 'done' && dueBucket(z.termin, today) === 'overdue';
}

/** `2026-10-03` → `03.10.2026` (pl) / `03/10/2026` (en). */
export function formatDayKey(value: string, locale: 'pl' | 'en'): string {
  const [y, m, d] = value.split('-');
  return locale === 'en' ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Storage object keys are minted by the main process: a uuid plus a short lowercase extension. */
export const ZADANIE_STORAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$/;

/**
 * A filter the dashboard hands to the board when one of its tiles is clicked:
 * whose tasks, and whether only the overdue ones. The board's own filter bar is
 * the same two questions, so a tile lands on a view the person can read straight
 * off the chips.
 */
export interface ZadaniaFilterSeed {
  who: 'all' | 'mine';
  overdue: boolean;
}

export const DEFAULT_ZADANIA_FILTER: ZadaniaFilterSeed = { who: 'all', overdue: false };
