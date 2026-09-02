import React from 'react';

/**
 * The small scene on the dashboard's meetings banner.
 *
 * Drawn in the same spirit as `MonthIllustration` — a disc silhouette, thick
 * rounded strokes, explicit colours rather than tokens (a drawing has colours,
 * and tokens would wash it out), one gentle float — so the two banners on the
 * dashboard read as the same family rather than as a designed one and a plain
 * one beside it.
 *
 * What it shows is what the section is about: a day on a wall calendar that
 * somebody has ringed, an envelope for the papers that have to go out before
 * it, and a clock for the deadline between the two.
 */

const PAPER = '#fbfbfd';
const PAPER_EDGE = '#c9cfd8';
const INK = '#3d4657';

const MeetingsIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={`month-art ${className ?? ''}`.trim()}
    viewBox="0 0 96 72"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Same disc as the month scenes, so both banners share a silhouette. */}
    <circle cx="48" cy="34" r="33" fill="#e6e8fb" opacity="0.7" />

    <g className="month-art__scene">
      {/* The calendar sheet. */}
      <rect
        x="18"
        y="16"
        width="46"
        height="42"
        rx="5"
        fill={PAPER}
        stroke={PAPER_EDGE}
        strokeWidth="2"
      />
      {/* Its header band — the one solid block of brand colour in the scene. */}
      <path d="M18 21a5 5 0 0 1 5-5h36a5 5 0 0 1 5 5v6H18z" fill="#5b5ff6" />
      {/* Two rings over the band. */}
      <path d="M29 12v7M53 12v7" stroke={INK} strokeWidth="3" strokeLinecap="round" />

      {/* A fortnight of days, and the one that is ringed. */}
      <g fill="#c9cfd8">
        <rect x="24" y="32" width="7" height="5" rx="1.5" />
        <rect x="35" y="32" width="7" height="5" rx="1.5" />
        <rect x="57" y="32" width="4" height="5" rx="1.5" />
        <rect x="24" y="41" width="7" height="5" rx="1.5" />
        <rect x="57" y="41" width="4" height="5" rx="1.5" />
        <rect x="24" y="50" width="7" height="5" rx="1.5" />
        <rect x="35" y="50" width="7" height="5" rx="1.5" />
      </g>
      {/* The meeting itself: filled, and circled by hand. */}
      <rect x="46" y="32" width="7" height="5" rx="1.5" fill="#5b5ff6" />
      <ellipse
        cx="49.5"
        cy="34.5"
        rx="8.5"
        ry="6.5"
        fill="none"
        stroke="#e0663c"
        strokeWidth="2.2"
        strokeLinecap="round"
        transform="rotate(-8 49.5 34.5)"
      />
      {/* Two lines of "what it is about". */}
      <path d="M35 42.5h7" stroke="#aab2bf" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 42.5h7M46 51h7" stroke="#aab2bf" strokeWidth="3" strokeLinecap="round" />

      {/* The papers that have to go out first. */}
      <g transform="rotate(-7 70 48)">
        <rect
          x="58"
          y="42"
          width="26"
          height="18"
          rx="2.5"
          fill={PAPER}
          stroke={PAPER_EDGE}
          strokeWidth="2"
        />
        <path
          d="M58.5 43.5L71 52l12.5-8.5"
          fill="none"
          stroke="#5b5ff6"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>

      {/* And the clock that runs between them. */}
      <circle cx="72" cy="24" r="10" fill={PAPER} stroke={INK} strokeWidth="2.2" />
      <path d="M72 18v6.5l4 2.5" stroke={INK} strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </g>
  </svg>
);

export default MeetingsIllustration;
