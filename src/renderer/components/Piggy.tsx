import React from 'react';

interface PiggyProps {
  /**
   * Prefix of the class hooks the parts carry (`<prefix>-svg`, `<prefix>-tail`,
   * `<prefix>-leg <prefix>-leg-f1`), so the place that shows her decides how
   * she moves — the footer walks her.
   */
  prefix: string;
}

/**
 * The app's piggy bank, side view, facing left, with the coin slot on her back
 * (x 33–47, y 14.5 of the 80×50 view box).
 */
const Piggy: React.FC<PiggyProps> = ({ prefix: p }) => (
  <svg viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg" className={`${p}-svg`}>
    {/* Curly tail (right side, where her rear is) */}
    <g className={`${p}-tail`}>
      <path
        d="M 62 24 Q 73 21, 70 30 Q 66 36, 73 37"
        stroke="#d96996"
        strokeWidth="3.2"
        fill="none"
        strokeLinecap="round"
      />
    </g>

    {/* Back legs (right side) */}
    <g className={`${p}-leg ${p}-leg-b1`}>
      <rect x="48" y="32" width="4" height="11" rx="2" fill="#c25a86" />
    </g>
    <g className={`${p}-leg ${p}-leg-b2`}>
      <rect x="55" y="32" width="4" height="11" rx="2" fill="#f29bbe" />
    </g>

    {/* Body */}
    <ellipse cx="40" cy="25" rx="22" ry="11" fill="#f29bbe" />
    {/* Belly highlight */}
    <ellipse cx="40" cy="30" rx="14" ry="5" fill="#ffd0e1" opacity="0.75" />
    {/* Coin slot on top */}
    <rect x="33" y="14.5" width="14" height="2.6" rx="1.3" fill="#7a3a55" />

    {/* Front legs (left side, under snout) */}
    <g className={`${p}-leg ${p}-leg-f1`}>
      <rect x="22" y="32" width="4" height="11" rx="2" fill="#c25a86" />
    </g>
    <g className={`${p}-leg ${p}-leg-f2`}>
      <rect x="29" y="32" width="4" height="11" rx="2" fill="#f29bbe" />
    </g>

    {/* Ear */}
    <path d="M 28 16 Q 31 9, 38 13 L 35 21 Z" fill="#d96996" />
    <path d="M 30 15.5 Q 32 11, 36 14 L 34 19 Z" fill="#ffb9d3" />

    {/* Snout (left side, since piggy faces left) */}
    <ellipse cx="13" cy="26" rx="6.5" ry="5" fill="#e87aa9" />
    <ellipse cx="10.5" cy="25" rx="0.9" ry="1.4" fill="#7a3a55" />
    <ellipse cx="15.5" cy="25" rx="0.9" ry="1.4" fill="#7a3a55" />

    {/* Cheek blush */}
    <ellipse cx="22" cy="29" rx="2.6" ry="1.5" fill="#ff8eb0" opacity="0.5" />

    {/* Eye */}
    <circle cx="22" cy="20" r="1.8" fill="#1a1a1a" />
    <circle cx="22.6" cy="19.4" r="0.7" fill="#fff" />

    {/* Smile */}
    <path
      d="M 8 28.5 Q 12 31.5, 16 28.5"
      stroke="#7a3a55"
      strokeWidth="0.7"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

export default Piggy;
