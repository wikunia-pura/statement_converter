import { useLayoutEffect, useState, RefObject } from 'react';

const VIEWPORT_MARGIN = 8;

/**
 * A dropdown menu is as wide as its longest option (never narrower than its
 * field), so near the window's right edge it can hang off the screen. This
 * measures the open menu before paint and returns how far to pull it left to
 * keep it inside the window. Spread `{ transform: translateX(-shift px) }`.
 */
export function useMenuInViewport(
  menuRef: RefObject<HTMLElement>,
  isOpen: boolean,
  /** Anything that changes the menu's width or position: options, anchor, query. */
  deps: unknown[] = [],
): number {
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    if (!isOpen) {
      setShift(0);
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    // Measured without the current shift, so a narrower menu can move back.
    const rect = el.getBoundingClientRect();
    const naturalRight = rect.right + shift;
    const naturalLeft = rect.left + shift;
    const overflow = naturalRight - (window.innerWidth - VIEWPORT_MARGIN);
    const next = overflow > 0 ? Math.min(overflow, Math.max(0, naturalLeft - VIEWPORT_MARGIN)) : 0;
    if (next !== shift) setShift(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ...deps]);

  return shift;
}

/**
 * The full text as a hover hint (`data-tip`, drawn by TipLayer) for an element
 * whose text is cut with an ellipsis — and only then. Measured on hover, since
 * only layout knows whether it is cut; call it from `onMouseEnter`.
 */
export function tipIfTruncated(el: HTMLElement): void {
  const target = (el.querySelector('.ui-select__value, .ui-select__option-label') as HTMLElement | null) ?? el;
  if (target.scrollWidth > target.clientWidth && target.textContent) el.dataset.tip = target.textContent;
  else delete el.dataset.tip;
}
