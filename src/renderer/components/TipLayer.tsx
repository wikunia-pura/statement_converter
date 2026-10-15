import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The app's one plain-text tooltip. Any element with `data-tip="…"` shows that
 * text in the `.tip` card — the look `Tip` has — instead of the browser's
 * native `title` box, which the app never uses. Mounted once, at the root.
 *
 * Nothing is added to the anchor: no wrapper, no tab stop, no cursor, no
 * listener per element. A handful of document listeners find the anchor with
 * `closest('[data-tip]')`, so the attribute alone is the whole API, and a hint
 * that changes or disappears with a re-render is picked up from the DOM.
 *
 * Disabled buttons (a modal's Save that explains why it is greyed out): a
 * disabled form control never gets click/mousedown, and older Chromium sent it
 * no mouse events at all (newer versions send mouseover/mousemove) — whereas
 * pointer events (`pointerover`/`pointermove`) reach it in either. So the layer
 * listens to pointer events, plus mouseover for hints set in `onMouseEnter`.
 * As a second net, when a pointer crosses into an element that has no hint in
 * its chain, `elementFromPoint` asks hit-testing directly — hit-testing returns
 * a disabled control whatever event dispatch does.
 *
 * Shown after a short pause like the native tooltip, at once on keyboard focus
 * (after a key press and where `:focus-visible` holds — a click shows nothing), and
 * gone on leave, blur, scroll, any press or key, or when the anchor leaves the
 * DOM or drops its hint. Rich content (lists, JSX) stays with `Tip`.
 */

/** Keep in step with `.tip { max-width }` and Tip.tsx. */
const TIP_MAX_WIDTH = 380;
/** Close to the native tooltip's pause, so the app feels the same as before. */
const SHOW_DELAY_MS = 400;
const GAP = 8;

type Source = 'pointer' | 'focus';

interface Shown {
  text: string;
  /** The anchor's rectangle in viewport coordinates. */
  rect: { top: number; bottom: number; left: number; width: number };
}

const tipOf = (el: Element | null): string => el?.getAttribute('data-tip')?.trim() ?? '';

const anchorFrom = (node: EventTarget | null): Element | null =>
  node instanceof Element ? node.closest('[data-tip]') : null;

const TipLayer: React.FC = () => {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let anchor: Element | null = null;
    let source: Source | null = null;
    let visible = false;
    let timer: number | undefined;
    // The anchor a press, key or scroll just dismissed: as with the native
    // tooltip, it stays quiet until the pointer has left it.
    let suppressed: Element | null = null;
    // Whether the last input was a key. A text field matches `:focus-visible`
    // even when clicked; a click must not pop its hint up the way Tab does.
    let keyboard = false;
    let attrObserver: MutationObserver | null = null;
    let treeObserver: MutationObserver | null = null;

    const stopWatching = () => {
      attrObserver?.disconnect();
      treeObserver?.disconnect();
      attrObserver = null;
      treeObserver = null;
    };

    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      stopWatching();
      anchor = null;
      source = null;
      if (visible) {
        visible = false;
        setShown(null);
      }
    };

    const show = () => {
      timer = undefined;
      const el = anchor;
      const text = tipOf(el);
      if (!el || !text || !el.isConnected) {
        hide();
        return;
      }
      const r = el.getBoundingClientRect();
      // A hint on something not laid out (display: none) has nowhere to point.
      if (r.width === 0 && r.height === 0) {
        hide();
        return;
      }
      visible = true;
      setShown({ text, rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width } });

      // Only while a tip is up: follow the hint's text, and drop the tip when
      // the anchor is removed (a row deleted, a modal closed under the pointer).
      stopWatching();
      attrObserver = new MutationObserver(() => {
        if (anchor !== el) return;
        if (!tipOf(el)) hide();
        else show();
      });
      attrObserver.observe(el, { attributes: true, attributeFilter: ['data-tip'] });
      treeObserver = new MutationObserver(() => {
        if (anchor === el && !el.isConnected) hide();
      });
      treeObserver.observe(document.body, { childList: true, subtree: true });
    };

    /** Point the layer at a new anchor (or none); same anchor = nothing to do. */
    const target = (next: Element | null, from: Source, immediate: boolean) => {
      if (from === 'pointer') {
        if (next && next === suppressed) return;
        suppressed = null;
      }
      if (next === anchor) return;
      const wasVisible = visible;
      hide();
      if (!next || !tipOf(next)) return;
      anchor = next;
      source = from;
      // Moving straight from one hint to the next shows it at once, as native does.
      if (immediate || wasVisible) show();
      else timer = window.setTimeout(show, SHOW_DELAY_MS);
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      let next = anchorFrom(e.target);
      if (!next) next = anchorFrom(document.elementFromPoint(e.clientX, e.clientY));
      if (next) target(next, 'pointer', false);
      else {
        suppressed = null;
        if (source === 'pointer') hide();
      }
    };

    // Moves within one element: catches a hint set after the pointer arrived
    // (a value found truncated on mouseenter) and leaving a disabled control
    // whose own pointerout may never come. Hit-testing only on that way out —
    // once, while a tip is pending or up — never on ordinary moves.
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const next = anchorFrom(e.target);
      if (next) {
        target(next, 'pointer', false);
        return;
      }
      suppressed = null;
      if (source === 'pointer' && anchorFrom(document.elementFromPoint(e.clientX, e.clientY)) !== anchor) hide();
    };

    // Mouse events too: a hint set in a React `onMouseEnter` exists only once
    // mouseover reaches the document.
    const onMouseOver = (e: MouseEvent) => {
      const next = anchorFrom(e.target);
      if (next) target(next, 'pointer', false);
    };

    const onPointerOut = (e: PointerEvent) => {
      // Left the window.
      if (e.relatedTarget === null && source === 'pointer') hide();
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      if (!keyboard) {
        if (source === 'focus') hide();
        return;
      }
      let focusVisible = false;
      try {
        focusVisible = el.matches(':focus-visible');
      } catch {
        focusVisible = false;
      }
      const next = focusVisible ? anchorFrom(el) : null;
      if (next) target(next, 'focus', true);
      else if (source === 'focus') hide();
    };

    const onFocusOut = () => {
      if (source === 'focus') hide();
    };

    const dismiss = (pressed: Element | null = null) => {
      suppressed = pressed ?? anchor;
      hide();
    };
    const onAnyPress = () => dismiss();
    const onPointerDown = (e: PointerEvent) => {
      keyboard = false;
      dismiss(anchorFrom(e.target));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keyboard = true;
      // Tab moves the focus; the next element's focusin decides what shows.
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      dismiss();
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    // Capture: a press inside a component that stops propagation still hides it.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    // Scroll does not bubble; capture sees every scrolling panel.
    document.addEventListener('scroll', onAnyPress, true);
    document.addEventListener('wheel', onAnyPress, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onAnyPress);
    window.addEventListener('resize', onAnyPress);
    return () => {
      hide();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onAnyPress, true);
      document.removeEventListener('wheel', onAnyPress, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onAnyPress);
      window.removeEventListener('resize', onAnyPress);
    };
  }, []);

  // Placed like `Tip`: centred under the anchor, never closer to a side than
  // half the widest card. Measured before paint so a hint near the bottom of
  // the window (the footer's buttons) flips above its anchor instead of
  // hanging off the screen.
  useLayoutEffect(() => {
    if (!shown) {
      setPos(null);
      return;
    }
    const { rect } = shown;
    const half = TIP_MAX_WIDTH / 2 + GAP;
    const left = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half);
    const height = cardRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + GAP;
    const top =
      below + height > window.innerHeight - GAP && rect.top - GAP - height >= GAP ? rect.top - GAP - height : below;
    setPos({ left, top });
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div
      ref={cardRef}
      className="tip tip--text"
      role="tooltip"
      // First layout pass is only for measuring; hidden until placed.
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {shown.text}
    </div>,
    document.body,
  );
};

export default TipLayer;
