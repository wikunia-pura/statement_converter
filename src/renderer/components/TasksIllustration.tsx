import React from 'react';

/**
 * The small scene on the dashboard's tasks banner: a board of three columns with
 * a card or two in each, topped in the same grey / blue / green the real board
 * uses for its status stripes.
 *
 * Built like `MeetingsIllustration` — the same disc silhouette, explicit colours
 * (a drawing has colours, and tokens would wash it out), the same gentle float —
 * so the dashboard's banners read as one family.
 */

const PAPER = '#fbfbfd';
const PAPER_EDGE = '#c9cfd8';
const INK = '#3d4657';
const GREY = '#8b919c';
const BLUE = '#3b8fd0';
const GREEN = '#3f9d6a';

const TasksIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={`month-art ${className ?? ''}`.trim()}
    viewBox="0 0 96 72"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle cx="48" cy="34" r="33" fill="#dcebf7" opacity="0.7" />

    <g className="month-art__scene">
      {/* The board. */}
      <rect x="14" y="16" width="68" height="44" rx="5" fill={PAPER} stroke={PAPER_EDGE} strokeWidth="1.6" />

      {/* Three columns, each with the stripe colour of its status. */}
      {[
        { x: 19, color: GREY, cards: 2 },
        { x: 40, color: BLUE, cards: 1 },
        { x: 61, color: GREEN, cards: 2 },
      ].map((col) => (
        <g key={col.x}>
          <rect x={col.x} y="21" width="16" height="3" rx="1.5" fill={col.color} />
          {Array.from({ length: col.cards }).map((_, i) => (
            <g key={i}>
              <rect
                x={col.x}
                y={27 + i * 13}
                width="16"
                height="10"
                rx="2"
                fill="#ffffff"
                stroke={PAPER_EDGE}
                strokeWidth="1"
              />
              <rect x={col.x} y={27 + i * 13} width="2.4" height="10" rx="1" fill={col.color} />
              <rect x={col.x + 5} y={30 + i * 13} width="9" height="1.8" rx="0.9" fill={INK} opacity="0.55" />
              <rect x={col.x + 5} y={33.4 + i * 13} width="6" height="1.6" rx="0.8" fill={INK} opacity="0.25" />
            </g>
          ))}
        </g>
      ))}
    </g>
  </svg>
);

export default TasksIllustration;
