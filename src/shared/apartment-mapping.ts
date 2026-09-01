/**
 * Reading and building the apartment list of an ApartmentMapping rule.
 *
 * A rule may name several apartments, because one payer often owns several of
 * them and pays for all with the same description from the same account. The
 * storage shape keeps the first apartment in `apartmentNumber`/`kontoLokalu` and
 * the rest in `additionalApartments`, so every rule written before this existed
 * — and every reader that only knows about the single-apartment fields — keeps
 * working untouched.
 *
 * That shape is awkward to read, so nothing reads it directly: `mappingTargets`
 * returns the whole list (primary first) and `buildApartmentMapping` writes it
 * back. The database sanitizer, both rule forms and the matcher all go through
 * these two functions, which is what keeps one apartment and five apartments
 * from being two different code paths.
 */

import { ApartmentMapping, ApartmentMappingTarget } from './types';
import { isAccountSymbol } from './apartment-account';

/** Case-insensitive identity of an apartment number, for dedupe. */
const key = (apartmentNumber: string): string => apartmentNumber.trim().toUpperCase();

/**
 * Every apartment the rule points at, primary first: trimmed, deduplicated, and
 * carrying only account symbols that really are symbols (a bare "17A" in that
 * field would name the apartment while claiming to be its account).
 */
export function mappingTargets(mapping: ApartmentMapping): ApartmentMappingTarget[] {
  const raw: ApartmentMappingTarget[] = [
    { apartmentNumber: mapping.apartmentNumber, kontoLokalu: mapping.kontoLokalu },
    ...(mapping.additionalApartments ?? []),
  ];

  const out: ApartmentMappingTarget[] = [];
  const seen = new Set<string>();
  for (const target of raw) {
    const apartmentNumber = (target?.apartmentNumber ?? '').trim();
    if (!apartmentNumber) continue;
    if (seen.has(key(apartmentNumber))) continue;
    seen.add(key(apartmentNumber));
    const konto = (target?.kontoLokalu ?? '').trim();
    out.push({
      apartmentNumber,
      ...(isAccountSymbol(konto) ? { kontoLokalu: konto } : {}),
    });
  }
  return out;
}

/**
 * True when the rule names more than one apartment, so the phrase says *who*
 * paid but not *for which* apartment — only the user can close that gap, on the
 * acceptance screen.
 */
export function hasApartmentChoice(mapping: ApartmentMapping): boolean {
  return mappingTargets(mapping).length > 1;
}

/**
 * Assemble a storable rule from a phrase and a list of apartments, or null when
 * the list holds no usable apartment (then there is no rule to save).
 *
 * The first usable apartment becomes the primary one; the rest go to
 * `additionalApartments`, which is omitted entirely for a single-apartment rule
 * so those rows stay byte-for-byte what they were before this feature.
 */
export function buildApartmentMapping(
  base: { id: string; matchText: string; note?: string },
  targets: ApartmentMappingTarget[],
): ApartmentMapping | null {
  const matchText = base.matchText.trim();
  if (!matchText) return null;

  const cleaned = mappingTargets({
    id: base.id,
    matchText,
    apartmentNumber: targets[0]?.apartmentNumber ?? '',
    kontoLokalu: targets[0]?.kontoLokalu,
    additionalApartments: targets.slice(1),
  });
  const [primary, ...extras] = cleaned;
  if (!primary) return null;

  const note = (base.note ?? '').trim();
  return {
    id: base.id,
    matchText,
    apartmentNumber: primary.apartmentNumber,
    ...(primary.kontoLokalu ? { kontoLokalu: primary.kontoLokalu } : {}),
    ...(extras.length > 0 ? { additionalApartments: extras } : {}),
    ...(note ? { note } : {}),
  };
}

// ── Address-book TXT format ────────────────────────────────────────────────
//
//   MAP: <phrase> => <apartments> [| KONTO: <symbol>] [| <note>]
//
// <apartments> is one apartment, or several separated by ";", each able to carry
// its own account after "=":
//
//   MAP: ANNA ZWYKLA => 25 | KONTO: 204-000025 | wpłaca z konta w AT
//   MAP: JAN NOWAK => 12; 14; 17A=204-00017A | dwa lokale i strych
//
// A one-apartment rule is written exactly as it was before rules could hold more
// than one, account in its own "KONTO:" segment — so files exported by this build
// still import into older ones, and files exported by older ones still import
// here. The account segment is recognised by its tag rather than by position,
// because in files older still that slot holds the note.

const MAPPING_LINE = /^\s*MAP:\s*(.+)=>\s*([^|]+?)((?:\s*\|\s*[^|]+)*)$/;

/** The `MAP:` line for one rule, without the leading indent. */
export function formatApartmentMappingLine(mapping: ApartmentMapping): string {
  const targets = mappingTargets(mapping);
  const multi = targets.length > 1;
  const apartments = multi
    ? targets
        .map(t => (t.kontoLokalu ? `${t.apartmentNumber}=${t.kontoLokalu}` : t.apartmentNumber))
        .join('; ')
    : targets[0]?.apartmentNumber ?? mapping.apartmentNumber;
  const segments = [
    ...(!multi && targets[0]?.kontoLokalu ? [`KONTO: ${targets[0].kontoLokalu}`] : []),
    ...(mapping.note ? [mapping.note] : []),
  ];
  const suffix = segments.length > 0 ? ` | ${segments.join(' | ')}` : '';
  return `MAP: ${mapping.matchText} => ${apartments}${suffix}`;
}

/**
 * Read a `MAP:` line back into a rule, or null when the line is not one (or names
 * no usable apartment). `id` is left empty — the database layer assigns a stable
 * one when the address is saved.
 */
export function parseApartmentMappingLine(line: string): ApartmentMapping | null {
  const match = line.match(MAPPING_LINE);
  if (!match) return null;

  const segments = (match[3] || '')
    .split('|')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  const kontoSegment = segments.find(part => /^KONTO:/i.test(part));
  const kontoLokalu = kontoSegment?.replace(/^KONTO:\s*/i, '').trim();
  const note = segments.filter(part => part !== kontoSegment).join(' | ').trim();

  const targets: ApartmentMappingTarget[] = match[2]
    .split(';')
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .map(item => {
      const [apartmentNumber, inlineKonto] = item.split('=').map(part => part.trim());
      return { apartmentNumber, ...(inlineKonto ? { kontoLokalu: inlineKonto } : {}) };
    });
  // A trailing "KONTO:" segment belongs to the first apartment — that is where it
  // sat when a rule could only have one.
  if (kontoLokalu && targets[0] && !targets[0].kontoLokalu) {
    targets[0] = { ...targets[0], kontoLokalu };
  }

  return buildApartmentMapping({ id: '', matchText: match[1].trim(), note }, targets);
}
