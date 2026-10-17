/** What a folded section holds, in a few words: "A, B +3" — or the empty-state line. */
export const foldSummary = (items: string[], empty: string, max = 2): string =>
  items.length === 0
    ? empty
    : items.slice(0, max).join(', ') + (items.length > max ? ` +${items.length - max}` : '');
