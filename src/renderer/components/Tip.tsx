import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A tooltip in the app's own look, for content a native `title` shows badly
 * (a list of problems). Shown on hover and keyboard focus, drawn in the body so
 * no table or card can clip it. Never changes the cursor — no help cursor, no "?".
 */
/** Keep in step with `.tip { max-width }`. */
const TIP_MAX_WIDTH = 380;

const Tip: React.FC<{
  content: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}> = ({ content, className, ariaLabel, children }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Centred under the anchor, but never closer to a window edge than half the
    // card's widest — near the right edge a centred card would be squeezed into
    // a column one word wide.
    const half = TIP_MAX_WIDTH / 2 + 8;
    const x = Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half);
    setPos({ x, y: r.bottom + 8 });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className={className}
      tabIndex={0}
      aria-label={ariaLabel}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div className="tip" role="tooltip" style={{ left: pos.x, top: pos.y }}>
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
};

export default Tip;
