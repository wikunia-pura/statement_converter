import React, { useState } from 'react';
import { translations, Language } from '../translations';

interface FooterProps {
  language: Language;
  appVersion: string;
}

const Footer: React.FC<FooterProps> = ({ language, appVersion }) => {
  const t = translations[language];
  const [checkingUpdate, setCheckingUpdate] = useState(false);

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
        setTimeout(() => {
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
