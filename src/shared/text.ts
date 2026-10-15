/**
 * Text folding shared by every place that compares names and phrases — the
 * contractor matcher on bank text as much as the search boxes in the renderer.
 *
 * One definition, because two of them drift: the contractor matcher used to
 * compare raw lower-case text while the address matcher folded diacritics, so a
 * contractor named "Usługi" never matched a bank that wrote "USLUGI".
 */

/** Lower-case, no Polish diacritics, single spaces — how names and phrases are compared. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    // "ł" has no decomposition, so NFD alone would keep it.
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The key two names clash on — "Zebranie" and "zebranie " are one type, one
 * location, one community: case and spacing ignored, diacritics kept (they
 * tell names apart).
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
