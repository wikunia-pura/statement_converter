/**
 * Apartment number → accounting account symbol.
 *
 * This lives in one place because getting it wrong books somebody's money onto
 * somebody else's apartment. Every converter's csv-exporter used to carry its
 * own private copy of this logic — seven byte-for-byte identical methods — and
 * therefore seven copies of the same defect: the "not pure digits ⇒ it must
 * already be an account symbol" branch happily wrote a bare apartment number
 * like "17A" straight into k_ma.
 *
 * The rule that matters here: **a lettered apartment never gets an account
 * derived by us.** Communities number 17A differently (204-00017A, 204-000017A,
 * or a wholly unrelated symbol), so there is no convention to guess from. Such a
 * transaction is left unrecognized and the user assigns the account explicitly —
 * either per transaction in the review screen, or once and for all via an
 * apartment rule with its own `kontoLokalu`.
 */

/** Marker meaning "Zakład Gospodarki Nieruchomościami" — booked to the all-zeros account. */
const ZGN_MARKER = 'ZGN';

/**
 * A bare apartment number carrying a letter: 17A, 5b, 128C.
 *
 * Exactly one trailing letter and no dash, so this can never collide with a
 * real account symbol (those always contain a dash: 235-1, 204-00017A).
 */
const LETTERED_APARTMENT = /^\d{1,6}[A-Za-z]$/;

/** A full account symbol as written in the chart of accounts: 204-000017, 204-00017A, 235-1. */
const ACCOUNT_SYMBOL = /^\d{2,4}-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/;

/**
 * A lettered apartment mentioned in transaction text, in a position that reads as
 * an apartment: right after a slash or an explicit apartment marker.
 *
 * Years are excluded, because "za m-c VII/2026r." is a date and not apartment 2026r.
 */
const LETTERED_APARTMENT_IN_TEXT =
  /(?:\/|\bm\.?\s*|\blok\.?\s*|\bloc\.?\s*|\blokal\s*|\blokalu[:\s]*|\bmieszkanie\s*)(?!(?:19|20)\d{2})(\d{1,4}[A-Za-z])(?![A-Za-z])/i;

/**
 * True for an apartment number that carries a letter (17A) — i.e. a real
 * apartment, distinct from 17, whose account symbol we must not invent.
 */
export function isLetteredApartment(value: string | null | undefined): boolean {
  return LETTERED_APARTMENT.test((value ?? '').trim());
}

/** True when `value` looks like a chart-of-accounts symbol the exporters can emit as-is. */
export function isAccountSymbol(value: string | null | undefined): boolean {
  return ACCOUNT_SYMBOL.test((value ?? '').trim());
}

/**
 * The lettered apartment the text mentions ("17A"), or null if it mentions none.
 *
 * This is a cross-check, not an extractor, and it is the part of the fix that does
 * not depend on any extractor getting the letter right. Whoever produced the
 * number — regex, AI, or the cache — a missed letter looks exactly like a correct
 * plain number, so the evidence has to be re-read from the text itself.
 */
export function letteredApartmentInText(text: string | null | undefined): string | null {
  const match = (text ?? '').match(LETTERED_APARTMENT_IN_TEXT);
  return match ? match[1].toUpperCase() : null;
}

/**
 * True when the recognized apartment must not be booked without the user naming an
 * account: either it carries a letter itself, or the text shows a lettered
 * apartment while the recognized number has no letter (the mis-booking case).
 *
 * An explicit account override answers the question, so it clears the flag.
 */
export function needsExplicitAccount(
  apartmentNumber: string | null | undefined,
  accountOverride: string | null | undefined,
  text: string | null | undefined
): boolean {
  const apartment = (apartmentNumber ?? '').trim();
  if (!apartment) return false;
  if ((accountOverride ?? '').trim()) return false;
  if (isLetteredApartment(apartment)) return true;
  return letteredApartmentInText(text) !== null;
}

/**
 * Resolve the account symbol to write into the accounting file, or null when the
 * transaction must stay unrecognized.
 *
 * Priority: an explicit override (from an apartment rule's "konto lokalu", or
 * typed by the user in the review screen) always wins over the derived default.
 *
 * @param apartmentNumber What the matcher recognized: "17", "17A", "ZGN", or an
 *   already-resolved symbol such as "235-1" (clarification account) or a
 *   contractor account from "Pozostałe przychody".
 * @param accountOverride  Explicit account symbol chosen by the user, if any.
 * @param prefix           Apartment-account prefix from the KontoTyp ("204", "205").
 */
export function resolveApartmentAccount(
  apartmentNumber: string | null | undefined,
  accountOverride: string | null | undefined,
  prefix: string
): string | null {
  const override = (accountOverride ?? '').trim();
  if (override) {
    // An override we cannot honour blocks the booking instead of quietly falling
    // back to the derived default: the user reached for this field precisely
    // because the default does not apply to this apartment, so guessing here
    // would produce the very mis-booking the field exists to prevent.
    return isAccountSymbol(override) ? override : null;
  }

  const apartment = (apartmentNumber ?? '').trim();
  if (!apartment) return null;

  // 17A — recognized correctly, deliberately not bookable without an override.
  if (isLetteredApartment(apartment)) return null;

  if (apartment.toUpperCase() === ZGN_MARKER) return `${prefix}-000000`;

  // Plain apartment number — the one case where the convention is known.
  if (/^\d+$/.test(apartment)) return `${prefix}-${apartment.padStart(6, '0')}`;

  // Already a symbol (235-1, a contractor account) — emit untouched.
  if (apartment.includes('-')) return apartment;

  // Anything else (e.g. "17AB") is neither a number we can map nor a symbol we
  // can trust. Refusing beats writing a made-up account into the books.
  return null;
}

/**
 * Compose a full account symbol from the prefix and the suffix the user typed in
 * the review screen's "Konto lokalu" field. Returns null when the suffix is empty
 * or the result would not be a valid symbol.
 *
 * The suffix is used exactly as typed — deliberately not zero-padded. Lettered
 * apartments are the reason this field exists, and their numbering varies between
 * communities, so padding would be a guess. The UI shows the composed symbol back
 * to the user instead.
 */
export function composeApartmentAccount(prefix: string, suffix: string): string | null {
  const s = (suffix ?? '').trim();
  if (!s) return null;
  // Tolerate the user pasting the whole symbol including the prefix.
  const composed = s.startsWith(`${prefix}-`) ? s : `${prefix}-${s}`;
  return isAccountSymbol(composed) ? composed : null;
}
