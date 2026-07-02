import React, { useEffect, useState } from 'react';
import logoImage from '../assets/logo.png';

interface SplashScreenProps {
  /** Called once the exit animation has finished and the splash can unmount. */
  onDone: () => void;
}

// A few hand-placed sparkles around the logo. Positions are % of the stage,
// each with its own delay/size so the twinkle feels organic rather than a grid.
const SPARKLES = [
  { top: '12%', left: '18%', size: 14, delay: 0.15 },
  { top: '22%', left: '80%', size: 20, delay: 0.45 },
  { top: '68%', left: '12%', size: 16, delay: 0.3 },
  { top: '74%', left: '84%', size: 22, delay: 0.6 },
  { top: '40%', left: '6%', size: 12, delay: 0.8 },
  { top: '52%', left: '92%', size: 12, delay: 0.5 },
  { top: '8%', left: '52%', size: 10, delay: 0.9 },
  { top: '86%', left: '48%', size: 14, delay: 0.7 },
];

/**
 * Full-screen intro shown once when the app opens. Plays a short funky entrance
 * (disco rays + twinkling stars + a light sweep across the logo), then fades out
 * and calls onDone. Honors prefers-reduced-motion by skipping straight through.
 */
const SplashScreen: React.FC<SplashScreenProps> = ({ onDone }) => {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const holdMs = reduce ? 250 : 2200;
    const exitMs = reduce ? 200 : 650;

    const leaveTimer = setTimeout(() => setLeaving(true), holdMs);
    const doneTimer = setTimeout(onDone, holdMs + exitMs);
    return () => {
      clearTimeout(leaveTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div className={`splash ${leaving ? 'splash--leaving' : ''}`} aria-hidden="true">
      <div className="splash__rays" />
      <div className="splash__glow" />

      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className="splash__sparkle"
          style={{
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}

      <div className="splash__logo-wrap">
        <img src={logoImage} alt="FileFunky" className="splash__logo" />
        <span className="splash__shine" />
      </div>
    </div>
  );
};

export default SplashScreen;
