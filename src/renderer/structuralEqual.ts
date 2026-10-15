/**
 * Whether two JSON-shaped values hold the same data — the question a form's
 * "unsaved changes" asks on every keystroke.
 *
 * It used to be answered by `JSON.stringify` of both sides, which for a tax
 * return means serializing the whole attached financial statement per key
 * pressed. This walks the two values instead and stops at the first object the
 * two share by reference: an edit made with spreads (`{ ...d, nip }`) keeps
 * every untouched branch identical, so the walk only visits what was changed.
 *
 * Same answer as comparing the JSON: a key holding `undefined` counts as absent,
 * and key order does not matter. `ignore` drops top-level keys from the
 * comparison (what the form's snapshot used to blank out).
 */
export function structuralEqual(a: unknown, b: unknown, ignore: readonly string[] = []): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    // JSON writes NaN as null too; nothing in the forms produces it, but the two
    // ways of comparing should not disagree over it.
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!structuralEqual(a[i], other[i])) return false;
    }
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const key of Object.keys(x)) {
    if (ignore.includes(key)) continue;
    if (!structuralEqual(x[key], y[key])) return false;
  }
  for (const key of Object.keys(y)) {
    if (ignore.includes(key) || key in x) continue;
    if (y[key] !== undefined) return false;
  }
  return true;
}
