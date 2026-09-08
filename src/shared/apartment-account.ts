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
 * Postal code and dashed NIP — the fixed-shape tokens a bank glues onto an
 * apartment number when it writes a fixed-width address field with no separator.
 *
 * "M.202-620 WARSZAWA" is apartment 2 in 02-620, not apartment 202. The dash of a
 * Polish postal code sits at a fixed offset, so the two digits in front of it
 * always belong to the code and whatever precedes them is the apartment. That
 * makes the split deterministic rather than a guess, and independent of how large
 * the building is: apartment 702 in the same code reads back as "M.70202-620" and
 * splits just as cleanly.
 *
 * Two details below look like defects and are load-bearing:
 *
 *  - **NIP is removed first.** Its dashes form a false postal code — scanning
 *    "521-332-10-09" finds "21-332" and shreds the number. Taking the whole NIP
 *    out first leaves nothing for the postal pattern to misread.
 *  - **POSTAL_CODE has no left-hand boundary.** A `\b` or `(?<!\d)` there is the
 *    intuitive guard and breaks the exact case this exists for: in "M.202-620" the
 *    digit in front of the code *is* the apartment number.
 */
const NIP_DASHED = /\b\d{3}-\d{3}-\d{2}-\d{2}\b/g;
const POSTAL_CODE = /\d{2}-\d{3}(?!\d)/g;

/**
 * Transaction text with the address codes taken out, for apartment and address
 * extraction only.
 *
 * Removed rather than spaced apart, because re-separating the fields fixes the
 * glued case and leaves its mirror image: a bare postal code behind a building
 * number ("Puławska 116 02-620") is otherwise read as apartment 02, which books a
 * payment onto lokal 2. Both readings die with the code itself.
 */
export function stripAddressCodes(text: string | null | undefined): string {
  return (text ?? '').replace(NIP_DASHED, ' ').replace(POSTAL_CODE, ' ');
}

/** A number in a position that reads as an apartment: after a slash or a marker. */
const APARTMENT_MARKER = String.raw`(?:\/|\bm\.?\s*|\blok\.?\s*|\bloc\.?\s*|\blokal\s*|\blokalu[:\s]*|\bmieszkanie\s*)`;

/** Characters that legitimately end an apartment number. */
const APARTMENT_END = /[\s,.;:|)]/;

/**
 * The text glued to the right of the recognized apartment number, or null when
 * the number ends cleanly.
 *
 * This is the net for glue we have *not* taught stripAddressCodes to remove. The
 * bank separates fields with a separator or with nothing at all, so a number that
 * runs straight into a letter is standing on a field boundary we failed to split,
 * and the digits we took may belong to two fields. What is glued does not matter
 * and is not guessed — only that something is.
 *
 * Deliberately conservative in three ways, all to keep it from firing on correct
 * readings:
 *
 *  - It runs on the *stripped* text, so a postal code we already removed is not
 *    re-reported as glue. Reading the raw text here would flag every correct
 *    answer for the very payers this fix repairs.
 *  - `(?![0-9])` pins the match to an occurrence where the number is the whole
 *    digit run, so apartment 2 is not "found" inside "lok. 25". Digits glued to
 *    digits need no coverage here: a greedy `\d+` swallows them, and the
 *    over-wide result is what apartmentWidthImplausible() is for.
 *  - A number it cannot find at all is reported clean, not suspicious. An
 *    apartment can reach us from the known-address path with no marker in front
 *    of it ("Puławska 116 10"), and absence of evidence is not evidence.
 */
export function apartmentGlueInText(
  text: string | null | undefined,
  apartmentNumber: string | null | undefined
): string | null {
  const apartment = (apartmentNumber ?? '').trim();
  // Digits plus at most one letter — never ZGN or an account symbol like 235-1,
  // and safe to interpolate into a pattern for that same reason.
  if (!/^\d+[A-Za-z]?$/.test(apartment)) return null;

  const scan = stripAddressCodes(text);
  const match = scan.match(new RegExp(`${APARTMENT_MARKER}${apartment}(?![0-9])`, 'i'));
  if (!match || match.index === undefined) return null;

  const rest = scan.slice(match.index + match[0].length);
  if (rest === '' || APARTMENT_END.test(rest[0])) return null;
  return rest.slice(0, 12);
}

/**
 * A digit run that reads as the head of a longer token rather than a bare number:
 * a year, or digits about to continue into a date or an amount ("08.2026",
 * "7/2026", "150,00"). Years are excluded the same way the matcher's own
 * patterns exclude them.
 */
const LONGER_TOKEN_HEAD = /^(?:19|20)\d{2}$|^\d+(?=[.,/]\d)/;

/**
 * The digits that continue the recognized apartment number across a space
 * ("lok1 0" → "0", "114/1 2" → "2"), or null when the number stands alone.
 *
 * Mirror image of apartmentGlueInText: that one catches a number the bank failed
 * to separate from its neighbour, this one a number the bank separated from
 * itself. The payer's bank writes a long transfer title into fixed-width lines
 * and the lines come back joined with a space, so a title cut inside "lok10"
 * arrives as "lok1 0" — and "lok1" is a perfectly good apartment 1 to every
 * extractor, at full confidence. Where the cut falls is the sender's business,
 * not ours: 35 characters at one bank, 34 at another (it counts bytes), some
 * other width at a third, and the same position holds a genuine space as often
 * as an inserted one. So nothing here tries to say where the cut was or to undo
 * it. It only notices the shape the cut leaves behind and hands the row to the
 * user, who can see "lok1 0" for what it is.
 *
 * Conservative in the same ways as the glue guard — stripped text, an occurrence
 * where the number is the whole digit run, absence reported clean — and in three
 * more, so that digits which legitimately follow an apartment number in a title
 * do not hold every such payment:
 *
 *  - Only a plain-digit apartment can have a tail; a letter ends the number.
 *  - The tail must be a bare digit run, not the head of a date, amount or year
 *    ("m. 5 08.2026", "lokal 3 150,00", "lok 5 2026") — see LONGER_TOKEN_HEAD.
 *  - Joined together the two runs must still be a plausible apartment number, by
 *    the same line apartmentWidthImplausible draws: "m. 12 260826109199" is a
 *    reference number after apartment 12, not one number in two pieces.
 */
export function apartmentSplitInText(
  text: string | null | undefined,
  apartmentNumber: string | null | undefined
): string | null {
  const apartment = (apartmentNumber ?? '').trim();
  if (!/^\d+$/.test(apartment)) return null;

  const scan = stripAddressCodes(text);
  const match = scan.match(new RegExp(`${APARTMENT_MARKER}${apartment}(?![0-9])`, 'i'));
  if (!match || match.index === undefined) return null;

  const rest = scan.slice(match.index + match[0].length);
  const tail = rest.match(/^\s+(\d+)/);
  if (!tail) return null;

  const afterSpace = rest.trimStart();
  if (LONGER_TOKEN_HEAD.test(afterSpace)) return null;
  if (apartmentWidthImplausible(apartment + tail[1])) return null;

  return tail[1];
}

/**
 * True when the number is too wide to be a real apartment, which means it has
 * absorbed something that was glued to it.
 *
 * Independent of position and of whether any de-gluing worked, so it still holds
 * when a bank invents a shape we have never seen — a postal code written without
 * its dash, say, which leaves no anchor to split on. Four digits is the line:
 * housing communities here run to a few hundred lokale, so 1000+ is not a number
 * anyone lives at.
 */
export function apartmentWidthImplausible(
  apartmentNumber: string | null | undefined
): boolean {
  return /^\d{4,}[A-Za-z]?$/.test((apartmentNumber ?? '').trim());
}

/**
 * Confidence a doubtful reading is capped at — under every review threshold, so
 * such a transaction reaches the user instead of the books.
 */
export const HELD_BACK_CONFIDENCE = 40;

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
