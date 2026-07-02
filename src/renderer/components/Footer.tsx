import React, { useState, useRef, useEffect } from 'react';
import { translations, Language } from '../translations';

interface FooterProps {
  language: Language;
  appVersion: string;
}

const Footer: React.FC<FooterProps> = ({ language, appVersion }) => {
  const t = translations[language];
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending "checking" reset timer if the component unmounts first.
  useEffect(() => () => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
  }, []);

  const handleZoomIn = async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.zoomIn();
      }
    } catch (error) {
      // Silently fail - zoom is non-critical feature
    }
  };

  const handleZoomOut = async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.zoomOut();
      }
    } catch (error) {
      // Silently fail - zoom is non-critical feature
    }
  };

  const handleZoomReset = async () => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.zoomReset();
      }
    } catch (error) {
      // Silently fail - zoom is non-critical feature
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      if (window.electronAPI && window.electronAPI.checkForUpdates) {
        await window.electronAPI.checkForUpdates();
        // The UpdateNotification component will show if update is available
        checkTimerRef.current = setTimeout(() => {
          setCheckingUpdate(false);
        }, 2000);
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="app-footer">
      <div className="footer-cat" aria-hidden="true">
        <svg
          viewBox="0 0 80 50"
          xmlns="http://www.w3.org/2000/svg"
          className="footer-cat-svg"
        >
          {/* Tail (left side, base attached to body's rear) */}
          <g className="footer-cat-tail">
            <path
              d="M 18 24 Q 4 14, 9 3"
              stroke="#e8853a"
              strokeWidth="4.5"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="9" cy="3" r="2.4" fill="#e8853a" />
          </g>

          {/* Back legs */}
          <g className="footer-cat-leg footer-cat-leg-b1">
            <rect x="22" y="32" width="4" height="11" rx="2" fill="#d97624" />
          </g>
          <g className="footer-cat-leg footer-cat-leg-b2">
            <rect x="29" y="32" width="4" height="11" rx="2" fill="#f29f3f" />
          </g>

          {/* Body */}
          <ellipse cx="40" cy="25" rx="22" ry="11" fill="#f29f3f" />
          {/* Tabby stripes */}
          <path d="M 28 17 Q 30 14, 33 17" stroke="#c66816" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M 38 16 Q 40 13, 43 16" stroke="#c66816" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M 48 17 Q 50 14, 53 17" stroke="#c66816" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          {/* Belly highlight */}
          <ellipse cx="40" cy="30" rx="14" ry="5" fill="#ffd29a" opacity="0.7" />

          {/* Front legs */}
          <g className="footer-cat-leg footer-cat-leg-f1">
            <rect x="50" y="32" width="4" height="11" rx="2" fill="#d97624" />
          </g>
          <g className="footer-cat-leg footer-cat-leg-f2">
            <rect x="57" y="32" width="4" height="11" rx="2" fill="#f29f3f" />
          </g>

          {/* Head */}
          <circle cx="62" cy="20" r="9.5" fill="#f29f3f" />
          {/* Inner cheek/muzzle */}
          <ellipse cx="68" cy="23" rx="4.5" ry="3" fill="#ffd29a" />

          {/* Ears */}
          <path d="M 54 12 L 56 4 L 60.5 11.5 Z" fill="#e8853a" />
          <path d="M 54.7 11.5 L 56.5 6 L 59.5 11 Z" fill="#ffb18a" />
          <path d="M 63.5 11.5 L 67 4 L 70 12 Z" fill="#e8853a" />
          <path d="M 64.5 11 L 67 6 L 69 11.5 Z" fill="#ffb18a" />

          {/* Eye */}
          <circle cx="65" cy="19" r="2" fill="#1a1a1a" />
          <circle cx="65.6" cy="18.4" r="0.7" fill="#ffffff" />

          {/* Nose */}
          <path d="M 70.5 21.5 L 72.5 21.5 L 71.5 23 Z" fill="#d4495a" />

          {/* Mouth */}
          <path d="M 71.5 23 Q 70 25, 68.5 24" stroke="#5a3a1a" strokeWidth="0.7" fill="none" strokeLinecap="round" />
          <path d="M 71.5 23 Q 73 25, 74.5 24" stroke="#5a3a1a" strokeWidth="0.7" fill="none" strokeLinecap="round" />

          {/* Whiskers */}
          <line x1="69" y1="22.5" x2="74.5" y2="21" stroke="#5a3a1a" strokeWidth="0.6" strokeLinecap="round" />
          <line x1="69" y1="23.5" x2="75" y2="23.5" stroke="#5a3a1a" strokeWidth="0.6" strokeLinecap="round" />
          <line x1="69" y1="24.5" x2="74.5" y2="26" stroke="#5a3a1a" strokeWidth="0.6" strokeLinecap="round" />
        </svg>
      </div>

      <div className="footer-piggy" aria-hidden="true">
        <svg
          viewBox="0 0 80 50"
          xmlns="http://www.w3.org/2000/svg"
          className="footer-piggy-svg"
        >
          {/* Curly tail (right side, where her rear is) */}
          <g className="footer-piggy-tail">
            <path
              d="M 62 24 Q 73 21, 70 30 Q 66 36, 73 37"
              stroke="#d96996"
              strokeWidth="3.2"
              fill="none"
              strokeLinecap="round"
            />
          </g>

          {/* Back legs (right side) */}
          <g className="footer-piggy-leg footer-piggy-leg-b1">
            <rect x="48" y="32" width="4" height="11" rx="2" fill="#c25a86" />
          </g>
          <g className="footer-piggy-leg footer-piggy-leg-b2">
            <rect x="55" y="32" width="4" height="11" rx="2" fill="#f29bbe" />
          </g>

          {/* Body */}
          <ellipse cx="40" cy="25" rx="22" ry="11" fill="#f29bbe" />
          {/* Belly highlight */}
          <ellipse cx="40" cy="30" rx="14" ry="5" fill="#ffd0e1" opacity="0.75" />
          {/* Coin slot on top */}
          <rect x="33" y="14.5" width="14" height="2.6" rx="1.3" fill="#7a3a55" />

          {/* Front legs (left side, under snout) */}
          <g className="footer-piggy-leg footer-piggy-leg-f1">
            <rect x="22" y="32" width="4" height="11" rx="2" fill="#c25a86" />
          </g>
          <g className="footer-piggy-leg footer-piggy-leg-f2">
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
      </div>

      <div className="footer-left">
        <span className="footer-copyright">
          © 2026 FileFunky
        </span>
        <span className="footer-version">
          v{appVersion}
        </span>
      </div>

      <div className="footer-center">
        <button
          type="button"
          className="footer-button"
          onClick={handleCheckForUpdates}
          disabled={checkingUpdate}
          title={t.checkForUpdates}
          aria-label={t.checkForUpdates}
        >
          {checkingUpdate ? '⟳ ' : ''}{t.checkForUpdates}
        </button>
      </div>

      <div className="footer-right">
        <div className="footer-zoom-controls">
          <button
            type="button"
            className="footer-zoom-button"
            onClick={handleZoomOut}
            title={t.zoomOut}
            aria-label={t.zoomOut}
          >
            −
          </button>
          <button
            type="button"
            className="footer-zoom-button"
            onClick={handleZoomReset}
            title={t.zoomReset}
            aria-label={t.zoomReset}
          >
            100%
          </button>
          <button
            type="button"
            className="footer-zoom-button"
            onClick={handleZoomIn}
            title={t.zoomIn}
            aria-label={t.zoomIn}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
};

export default Footer;
