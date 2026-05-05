import React from 'react';

const BankIllustration: React.FC = () => {
  return (
    <div className="bank-illustration" aria-hidden="true">
      <svg
        viewBox="0 0 240 200"
        xmlns="http://www.w3.org/2000/svg"
        className="bank-illustration-svg"
      >
        {/* Falling coins (above the piggy, drop into slot) */}
        <g className="bank-coin bank-coin-1">
          <circle cx="120" cy="18" r="13" fill="#f6cf4a" stroke="#c08c1a" strokeWidth="2.5" />
          <circle cx="120" cy="18" r="8" fill="none" stroke="#c08c1a" strokeWidth="0.8" opacity="0.5" />
          <text
            x="120"
            y="22.5"
            textAnchor="middle"
            fontSize="12"
            fontWeight="800"
            fill="#7a5407"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
          >
            zł
          </text>
        </g>
        <g className="bank-coin bank-coin-2">
          <circle cx="120" cy="18" r="13" fill="#f6cf4a" stroke="#c08c1a" strokeWidth="2.5" />
          <circle cx="120" cy="18" r="8" fill="none" stroke="#c08c1a" strokeWidth="0.8" opacity="0.5" />
          <text
            x="120"
            y="22.5"
            textAnchor="middle"
            fontSize="13"
            fontWeight="800"
            fill="#7a5407"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
          >
            €
          </text>
        </g>
        <g className="bank-coin bank-coin-3">
          <circle cx="120" cy="18" r="13" fill="#f6cf4a" stroke="#c08c1a" strokeWidth="2.5" />
          <circle cx="120" cy="18" r="8" fill="none" stroke="#c08c1a" strokeWidth="0.8" opacity="0.5" />
          <text
            x="120"
            y="22.5"
            textAnchor="middle"
            fontSize="13"
            fontWeight="800"
            fill="#7a5407"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
          >
            $
          </text>
        </g>

        {/* Ground shadow */}
        <ellipse cx="125" cy="172" rx="80" ry="6" fill="#000" opacity="0.08" />

        {/* Piggy body group — breathes */}
        <g className="bank-piggy">
          {/* Back legs (slightly darker, behind) */}
          <rect x="68" y="138" width="16" height="24" rx="5" fill="#d96996" />
          <rect x="158" y="138" width="16" height="24" rx="5" fill="#d96996" />
          {/* Tiny hooves */}
          <ellipse cx="76" cy="162" rx="9" ry="3" fill="#a44a73" />
          <ellipse cx="166" cy="162" rx="9" ry="3" fill="#a44a73" />

          {/* Curly tail (behind body) */}
          <path
            d="M 188 92 Q 204 85, 198 102 Q 192 114, 204 116"
            stroke="#d96996"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
            className="bank-piggy-tail"
          />

          {/* Body */}
          <ellipse cx="125" cy="100" rx="72" ry="46" fill="#f29bbe" />

          {/* Belly highlight */}
          <ellipse cx="125" cy="116" rx="50" ry="24" fill="#ffd0e1" opacity="0.8" />

          {/* Front legs (lighter, in front) */}
          <rect x="92" y="138" width="16" height="24" rx="5" fill="#f29bbe" />
          <rect x="138" y="138" width="16" height="24" rx="5" fill="#f29bbe" />
          {/* Front hooves */}
          <ellipse cx="100" cy="162" rx="9" ry="3" fill="#a44a73" />
          <ellipse cx="146" cy="162" rx="9" ry="3" fill="#a44a73" />

          {/* Coin slot */}
          <rect x="106" y="60" width="38" height="8" rx="4" fill="#7a3a55" />
          <rect x="108" y="62" width="34" height="2.5" rx="1.2" fill="#3d1d2a" />

          {/* Ear (with inner) */}
          <path d="M 86 62 Q 91 46, 102 56 L 96 76 Z" fill="#d96996" />
          <path d="M 89 62 Q 92 52, 99 58 L 95 72 Z" fill="#ffb9d3" />

          {/* Snout (left side, since piggy faces left) */}
          <ellipse cx="50" cy="104" rx="18" ry="14" fill="#e87aa9" />
          <ellipse cx="50" cy="104" rx="16" ry="12" fill="none" stroke="#c95a89" strokeWidth="0.8" opacity="0.5" />
          {/* Nostrils */}
          <ellipse cx="44" cy="100" rx="2" ry="3" fill="#7a3a55" />
          <ellipse cx="56" cy="100" rx="2" ry="3" fill="#7a3a55" />

          {/* Cheek blush */}
          <ellipse cx="64" cy="108" rx="6" ry="3.5" fill="#ff8eb0" opacity="0.55" />

          {/* Eye */}
          <ellipse cx="76" cy="84" rx="5" ry="5.5" fill="#1a1a1a" className="bank-piggy-eye" />
          <circle cx="78" cy="82" r="1.8" fill="#fff" />
          <circle cx="74.5" cy="86" r="0.9" fill="#fff" opacity="0.7" />

          {/* Eyebrow / brow line */}
          <path
            d="M 70 76 Q 76 73, 82 76"
            stroke="#a44a73"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            opacity="0.5"
          />

          {/* Smile under snout */}
          <path
            d="M 38 110 Q 44 116, 50 112"
            stroke="#7a3a55"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
};

export default BankIllustration;
