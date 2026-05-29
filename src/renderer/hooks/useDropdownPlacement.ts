import { useState, useLayoutEffect, RefObject } from 'react';

export interface DropdownPlacement {
  /** Spread directly onto the dropdown panel's inline style. */
  top?: string;
  bottom?: string;
  marginTop?: string;
  marginBottom?: string;
  maxHeight: number;
}

const VIEWPORT_MARGIN = 8; // keep at least this much space from the window edge
const GAP = 2; // gap between the trigger and the dropdown panel
const MIN_HEIGHT = 120; // never shrink the panel below this

/**
 * Decides whether a dropdown panel should open downward or flip upward based on
 * the space available around its trigger, and clamps its height so it never gets
 * cut off by the window edge. Measure happens in a layout effect (before paint),
 * so there is no visible flicker.
 *
 * Pass the ref of the trigger's relative container (the same element the panel is
 * absolutely positioned against). Spread the returned object onto the panel style.
 */
export function useDropdownPlacement(
  triggerRef: RefObject<HTMLElement>,
  isOpen: boolean,
  preferredMaxHeight: number = 250,
): DropdownPlacement {
  const [placement, setPlacement] = useState<DropdownPlacement>({
    top: '100%',
    marginTop: `${GAP}px`,
    maxHeight: preferredMaxHeight,
  });

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - GAP;
      const spaceAbove = rect.top - VIEWPORT_MARGIN - GAP;

      // Flip up only when there isn't enough room below and above is roomier.
      if (spaceBelow < preferredMaxHeight && spaceAbove > spaceBelow) {
        setPlacement({
          bottom: '100%',
          marginBottom: `${GAP}px`,
          maxHeight: Math.max(MIN_HEIGHT, Math.min(preferredMaxHeight, spaceAbove)),
        });
      } else {
        setPlacement({
          top: '100%',
          marginTop: `${GAP}px`,
          maxHeight: Math.max(MIN_HEIGHT, Math.min(preferredMaxHeight, spaceBelow)),
        });
      }
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isOpen, triggerRef, preferredMaxHeight]);

  return placement;
}
