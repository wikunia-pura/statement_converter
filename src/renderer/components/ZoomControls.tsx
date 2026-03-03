import React from 'react';
import { translations, Language } from '../translations';

// Ensure Window interface is available with electronAPI
/// <reference types="../electronAPI.d.ts" />

interface ZoomControlsProps {
  language: Language;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({ language }) => {
  const t = translations[language];

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

  return (
    <div className="zoom-controls">
      <button 
        type="button"
        className="zoom-button" 
        onClick={handleZoomIn}
        title={t.zoomIn}
        aria-label={t.zoomIn}
      >
        +
      </button>
      <button 
        type="button"
        className="zoom-button" 
        onClick={handleZoomOut}
        title={t.zoomOut}
        aria-label={t.zoomOut}
      >
        −
      </button>
      <button 
        type="button"
        className="zoom-button" 
        onClick={handleZoomReset}
        title={t.zoomReset}
        aria-label={t.zoomReset}
      >
        100%
      </button>
    </div>
  );
};

export default ZoomControls;
