import React from 'react';

/**
 * A small seasonal scene for the month bar of the Księgowania dashboard — one
 * per month, so the header tells you *which* month you are looking at before
 * you read a single word, and switching months is visibly a switch.
 *
 * Inline SVG in the same hand-drawn spirit as BankIllustration: explicit colors
 * (a season has colors; tokens would wash them out), thick rounded strokes, and
 * one gentle float animation. Each month also names an accent used to tint the
 * bar behind it — see `monthAccent`.
 */

interface MonthArt {
  /** Tint for the bar behind the scene (both themes handle it via opacity). */
  accent: string;
  scene: React.ReactNode;
}

/* Shared bits ------------------------------------------------------------- */

const SNOW = '#f4f8fd';
const SNOW_EDGE = '#c3d7ea';
const SKY = '#dcebf7';

/** Ground line every scene sits on, so the twelve share a baseline. */
const ground = (fill: string) => <path d="M6 60h84" stroke={fill} strokeWidth="4" strokeLinecap="round" />;

const sun = (cx: number, cy: number, r: number, fill = '#f5c53d') => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill={fill} />
    <g stroke={fill} strokeWidth="2.6" strokeLinecap="round">
      <path d={`M${cx} ${cy - r - 6}v4`} />
      <path d={`M${cx} ${cy + r + 2}v4`} />
      <path d={`M${cx - r - 6} ${cy}h4`} />
      <path d={`M${cx + r + 2} ${cy}h4`} />
      <path d={`M${cx - r - 5} ${cy - r - 5}l3 3`} />
      <path d={`M${cx + r + 2} ${cy + r + 2}l3 3`} />
      <path d={`M${cx + r + 5} ${cy - r - 5}l-3 3`} />
      <path d={`M${cx - r - 2} ${cy + r + 2}l-3 3`} />
    </g>
  </g>
);

const snowflake = (cx: number, cy: number, s: number, color = '#8dc0e8') => (
  <g stroke={color} strokeWidth="2.2" strokeLinecap="round" transform={`translate(${cx} ${cy}) scale(${s})`}>
    <path d="M0 -9V9" />
    <path d="M-8 -4.5L8 4.5" />
    <path d="M-8 4.5L8 -4.5" />
    <path d="M0 -9l-3 3M0 -9l3 3" />
    <path d="M0 9l-3 -3M0 9l3 -3" />
  </g>
);

const cloud = (x: number, y: number, fill = '#cfdbe8') => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="0" rx="15" ry="9" fill={fill} />
    <circle cx="-10" cy="1" r="7" fill={fill} />
    <circle cx="8" cy="-2" r="9" fill={fill} />
  </g>
);

const drops = (x: number, y: number, color = '#6fb0dd') => (
  <g stroke={color} strokeWidth="2.6" strokeLinecap="round">
    <path d={`M${x - 8} ${y}v6`} />
    <path d={`M${x} ${y + 3}v7`} />
    <path d={`M${x + 8} ${y}v6`} />
  </g>
);

const leaf = (x: number, y: number, rot: number, color: string) => (
  <g transform={`translate(${x} ${y}) rotate(${rot})`}>
    <path d="M0 0C8 -10 18 -10 22 0C18 10 8 10 0 0Z" fill={color} />
    <path d="M1 0h20" stroke="#8a4a1c" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
  </g>
);

/* The twelve months ------------------------------------------------------- */

const MONTHS: MonthArt[] = [
  // 1 — styczeń: bałwan
  {
    accent: '#6ea8d8',
    scene: (
      <>
        {snowflake(18, 16, 0.8)}
        {snowflake(80, 24, 0.6)}
        <circle cx="48" cy="46" r="14" fill={SNOW} stroke={SNOW_EDGE} strokeWidth="2" />
        <circle cx="48" cy="26" r="10" fill={SNOW} stroke={SNOW_EDGE} strokeWidth="2" />
        <path d="M38 18h20" stroke="#3d4657" strokeWidth="4" strokeLinecap="round" />
        <path d="M42 18v-6h12v6" fill="#3d4657" />
        <circle cx="44.5" cy="25" r="1.6" fill="#3d4657" />
        <circle cx="51.5" cy="25" r="1.6" fill="#3d4657" />
        <path d="M48 28l7 2-7 2z" fill="#e8873c" />
        <path d="M34 42l-9-5M62 42l9-5" stroke="#a2703f" strokeWidth="2.6" strokeLinecap="round" />
        {ground(SNOW)}
      </>
    ),
  },
  // 2 — luty: płatek i serce
  {
    accent: '#8aa9e0',
    scene: (
      <>
        {snowflake(34, 30, 1.5, '#7fb3e0')}
        {snowflake(72, 20, 0.7)}
        {snowflake(20, 48, 0.6)}
        <path
          d="M64 52c-9-6-13-11-13-16 0-4 3-7 7-7 3 0 5 2 6 4 1-2 3-4 6-4 4 0 7 3 7 7 0 5-4 10-13 16z"
          fill="#e2718d"
        />
        {ground(SNOW)}
      </>
    ),
  },
  // 3 — marzec: krokusy przebijające się przez śnieg
  {
    accent: '#8a6fd0',
    scene: (
      <>
        {sun(76, 18, 8)}
        <path d="M38 56V30M56 56V36" stroke="#4f9a63" strokeWidth="3" strokeLinecap="round" />
        <path d="M32 30c0-7 3-11 6-11s6 4 6 11c0 4-3 6-6 6s-6-2-6-6z" fill="#8a6fd0" />
        <path d="M38 30c-4-2-6-6-6-9 4 0 6 4 6 9zM38 30c4-2 6-6 6-9-4 0-6 4-6 9z" fill="#9d85d8" />
        <path d="M50 36c0-6 3-9 6-9s6 3 6 9c0 3-3 5-6 5s-6-2-6-5z" fill="#7a5fc0" />
        <path d="M30 48c5-2 8 0 9 4M64 50c-5-2-8 0-9 4" stroke="#4f9a63" strokeWidth="3" strokeLinecap="round" fill="none" />
        {/* the snow the flowers came through */}
        <ellipse cx="48" cy="59" rx="36" ry="7" fill={SNOW} />
        <ellipse cx="26" cy="55" rx="11" ry="4" fill={SNOW} />
        {ground(SNOW_EDGE)}
      </>
    ),
  },
  // 4 — kwiecień plecień: chmura z deszczem i słońce
  {
    accent: '#6fb3d8',
    scene: (
      <>
        {sun(74, 20, 9)}
        {cloud(38, 26)}
        {drops(38, 38)}
        {drops(56, 44)}
        <path d="M20 46c4-4 9-4 13 0" stroke="#84c08c" strokeWidth="3" strokeLinecap="round" fill="none" />
        {ground('#84c08c')}
      </>
    ),
  },
  // 5 — maj: tulipany
  {
    accent: '#7fc46e',
    scene: (
      <>
        {sun(78, 16, 8)}
        <path d="M32 58V32M50 58V26M66 58V36" stroke="#4f9a63" strokeWidth="3" strokeLinecap="round" />
        <path d="M26 32c0-6 3-9 6-9s6 3 6 9c0 4-3 6-6 6s-6-2-6-6z" fill="#e2718d" />
        <path d="M44 26c0-6 3-9 6-9s6 3 6 9c0 4-3 6-6 6s-6-2-6-6z" fill="#e8a33c" />
        <path d="M60 36c0-5 3-8 6-8s6 3 6 8c0 4-3 5-6 5s-6-1-6-5z" fill="#d4585f" />
        <path d="M32 48c-6-2-9-6-9-9 5 0 9 3 9 9zM50 44c6-2 9-6 9-9-5 0-9 3-9 9z" fill="#4f9a63" />
        {ground('#84c08c')}
      </>
    ),
  },
  // 6 — czerwiec: pełne słońce nad łąką
  {
    accent: '#f0b429',
    scene: (
      <>
        {sun(48, 26, 14)}
        <circle cx="48" cy="26" r="9" fill="#ffe07a" opacity="0.7" />
        <path d="M18 52c3-5 7-5 10 0M68 52c3-5 7-5 10 0" stroke="#84c08c" strokeWidth="3" strokeLinecap="round" fill="none" />
        <circle cx="34" cy="50" r="3" fill="#e2718d" />
        <circle cx="60" cy="52" r="3" fill="#f5f0a8" />
        {ground('#84c08c')}
      </>
    ),
  },
  // 7 — lipiec: parasol plażowy
  {
    accent: '#f08a3c',
    scene: (
      <>
        {sun(22, 18, 8)}
        <path d="M64 24v34" stroke="#a2703f" strokeWidth="3" strokeLinecap="round" />
        <path d="M42 24a22 22 0 0 1 44 0z" fill="#e05a63" />
        {/* Two light wedges out of the canopy — a parasol, not a red dome. */}
        <path d="M64 24L48.4 8.4L64 2Z" fill={SNOW} />
        <path d="M64 24L79.6 8.4L64 2Z" fill={SNOW} />
        <ellipse cx="34" cy="54" rx="12" ry="4" fill="#f2dcae" />
        <circle cx="34" cy="48" r="6" fill="#6fb0dd" />
        {ground('#f2dcae')}
      </>
    ),
  },
  // 8 — sierpień: kłosy zboża
  {
    accent: '#e0a83c',
    scene: (
      <>
        {sun(76, 18, 8)}
        <g stroke="#c8912f" strokeWidth="3" strokeLinecap="round">
          <path d="M34 58V26" />
          <path d="M50 58V20" />
          <path d="M66 58V30" />
        </g>
        <g fill="#e8bd54">
          <ellipse cx="34" cy="26" rx="5" ry="9" />
          <ellipse cx="50" cy="20" rx="5" ry="10" />
          <ellipse cx="66" cy="30" rx="5" ry="8" />
        </g>
        <g stroke="#c8912f" strokeWidth="2" strokeLinecap="round">
          <path d="M34 20v-5M50 13v-5M66 25v-5" />
        </g>
        {ground('#dcc07a')}
      </>
    ),
  },
  // 9 — wrzesień: liście i jabłko
  {
    accent: '#d97b3c',
    scene: (
      <>
        {leaf(14, 24, -20, '#e08a3c')}
        {leaf(58, 18, 25, '#d4a33c')}
        <circle cx="46" cy="46" r="13" fill="#d9524f" />
        <path d="M46 33c0-4 3-6 6-6-1 4-3 6-6 6z" fill="#4f9a63" />
        <path d="M46 33v-6" stroke="#8a4a1c" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M40 41c1-2 3-3 5-3" stroke="#f2b3b1" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
        {ground('#c9a06a')}
      </>
    ),
  },
  // 10 — październik: dynia
  {
    accent: '#c96a2a',
    scene: (
      <>
        {leaf(12, 20, -15, '#c05f2a')}
        {leaf(64, 22, 30, '#d98a3c')}
        {/* Lobes as fills, not outlines — a pumpkin, not an orange ball. */}
        <ellipse cx="48" cy="44" rx="20" ry="15" fill="#c8641c" />
        <ellipse cx="39" cy="44" rx="9" ry="15" fill="#e07f2a" />
        <ellipse cx="57" cy="44" rx="9" ry="15" fill="#e07f2a" />
        <ellipse cx="48" cy="44" rx="10" ry="15" fill="#f0913c" />
        <rect x="45.5" y="24" width="5" height="6" rx="1.6" fill="#4f9a63" />
        <path d="M50 25c4 0 5-3 8-3" stroke="#4f9a63" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        {ground('#c9a06a')}
      </>
    ),
  },
  // 11 — listopad: bezlistne drzewo we mgle
  {
    accent: '#8c8f9a',
    scene: (
      <>
        {cloud(60, 20, '#c2c7d0')}
        {drops(60, 32, '#9aa3b0')}
        <path d="M34 58V30" stroke="#8a5f3c" strokeWidth="4" strokeLinecap="round" />
        <path d="M34 36l-10-8M34 32l10-9M34 42l-8-4" stroke="#8a5f3c" strokeWidth="2.6" strokeLinecap="round" />
        {leaf(44, 48, 40, '#b0733c')}
        <path d="M12 50h14M70 52h16" stroke="#b6bcc6" strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
        {ground('#a9a294')}
      </>
    ),
  },
  // 12 — grudzień: choinka
  {
    accent: '#3f9d6b',
    scene: (
      <>
        {snowflake(18, 20, 0.7)}
        {snowflake(78, 30, 0.55)}
        <path d="M48 12l12 16H36z" fill="#3f8f5f" />
        <path d="M48 24l15 18H33z" fill="#489b68" />
        <path d="M48 36l18 20H30z" fill="#52a873" />
        <path d="M45 56h6v5h-6z" fill="#8a5f3c" />
        <path d="M48 6l1.8 4 4 .6-3 2.8.8 4L48 15.4 44.4 17.4l.8-4-3-2.8 4-.6z" fill="#f5c53d" />
        <circle cx="42" cy="34" r="2.2" fill="#e05a63" />
        <circle cx="55" cy="44" r="2.2" fill="#6fb0dd" />
        <circle cx="46" cy="47" r="2.2" fill="#f5c53d" />
        {ground(SNOW)}
      </>
    ),
  },
];

/** Tint of the month bar — the season's own colour, used at low opacity. */
export function monthAccent(month: number): string {
  return MONTHS[clampMonth(month)].accent;
}

function clampMonth(month: number): number {
  if (!Number.isFinite(month)) return 0;
  const index = Math.round(month) - 1;
  return Math.min(11, Math.max(0, index));
}

interface Props {
  /** 1–12. */
  month: number;
  className?: string;
}

const MonthIllustration: React.FC<Props> = ({ month, className }) => {
  const art = MONTHS[clampMonth(month)];
  return (
    <svg
      className={`month-art ${className ?? ''}`.trim()}
      viewBox="0 0 96 72"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Sky disc, so every scene has the same silhouette in the bar. */}
      <circle cx="48" cy="34" r="33" fill={SKY} opacity="0.55" />
      <g className="month-art__scene">{art.scene}</g>
    </svg>
  );
};

export default MonthIllustration;
