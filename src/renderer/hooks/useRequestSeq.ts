import { useMemo, useRef } from 'react';

/**
 * Tickets for overlapping reloads of one view: only the newest ticket's answer
 * may land.
 *
 * A refresh after every small write means two loads can be in flight at once —
 * one from a click a second ago, one from now — and the older one can answer
 * last. Without this, the screen would quietly go back to the data from before
 * the second write.
 */
export function useRequestSeq(): { next: () => number; isLatest: (ticket: number) => boolean } {
  const seq = useRef(0);
  return useMemo(
    () => ({
      next: () => ++seq.current,
      isLatest: (ticket: number) => ticket === seq.current,
    }),
    [],
  );
}
