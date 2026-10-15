/**
 * Money and date formatting — one definition per format, so an amount or a
 * timestamp reads the same in every view, PDF, mail and AI prompt. Shared by
 * the renderer and the main process, so no renderer types here.
 *
 * Tax forms are the deliberate exception: `plNumber`/`formatZl`/`formatStawka`
 * in podatki.ts print what the official form expects (pl-PL's own grouping,
 * which leaves 4-digit numbers ungrouped — "6609", "12 345"), and they stay
 * as they are so a declaration's PDF never changes under a refactor.
 */

/** The app's UI languages — the renderer's `Language`, restated so shared code needs no renderer import. */
export type AppLanguage = 'pl' | 'en';

/** The Intl locale a UI language formats with: "15.10.2026" in Polish, "15/10/2026" in English. */
export const localeOf = (language: AppLanguage): 'pl-PL' | 'en-GB' => (language === 'en' ? 'en-GB' : 'pl-PL');

const kwotaFormats = new Map<number, Intl.NumberFormat>();

/**
 * pl-PL with thousands always grouped: Polish style leaves four-digit numbers
 * ungrouped ("6609,10"), which reads as a misprint in a column of "16 669,33"s.
 */
function kwotaFormat(decimals: number): Intl.NumberFormat {
  let f = kwotaFormats.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: 'always',
    } as unknown as Intl.NumberFormatOptions);
    kwotaFormats.set(decimals, f);
  }
  return f;
}

/**
 * An amount as reports, meeting documents and the screens around them print it:
 * "6 609,10" (two decimals unless told otherwise), a plain space between
 * thousands, `suffix` after a space ("6 609,10 zł"). Empty for no number.
 */
export function formatKwota(
  n: number | null | undefined,
  options: { decimals?: number; suffix?: string } = {},
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const decimals = options.decimals ?? 2;
  // A float sum that is zero up to rounding (0.3 - 0.1 - 0.2) must not print as "-0,00".
  const value = Math.round(n * 10 ** decimals) === 0 ? 0 : n;
  // Intl puts a (narrow) no-break space between thousands; documents use a plain one.
  const text = kwotaFormat(decimals).format(value).replace(/[  ]/g, ' ');
  return options.suffix ? `${text} ${options.suffix}` : text;
}

/** "15.10.2026, 14:05" — a moment something happened. `year: false` drops the year ("15.10, 14:05"). */
export function formatDateTime(iso: string, language: AppLanguage, options: { year?: boolean } = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(localeOf(language), {
    day: '2-digit',
    month: '2-digit',
    ...(options.year === false ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A day in the locale's short form ("5.10.2026" / "05/10/2026"), or as asked by `options`. */
export function formatDate(iso: string, language: AppLanguage, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(localeOf(language), options);
}
