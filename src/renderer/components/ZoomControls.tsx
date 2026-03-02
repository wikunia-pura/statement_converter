import React from 'react';
import { translations, Language } from '../translations';

interface ZoomControlsProps {
  language: Language;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({ language }) => {
  const t = translations[language];

  const handleZoomIn = async () => {
    console.log('=== ZOOM IN BUTTON CLICKED ===');
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        console.log('Calling window.electronAPI.zoomIn()');
        const result = await window.electronAPI.zoomIn();
        console.log('Zoom in result:', result);
      } else {
        console.error('window.electronAPI not available');
      }
    } catch (error) {
      console.error('Error zooming in:', error);
    }
  };

  const handleZoomOut = async () => {
    console.log('=== ZOOM OUT BUTTON CLICKED ===');
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        console.log('Calling window.electronAPI.zoomOut()');
        const result = await window.electronAPI.zoomOut();
        console.log('Zoom out result:', result);
      } else {
        console.error('window.electronAPI not available');
      }
    } catch (error) {
      console.error('Error zooming out:', error);
    }
  };

  const handleZoomReset = async () => {
    console.log('=== ZOOM RESET BUTTON CLICKED ===');
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        console.log('Calling window.electronAPI.zoomReset()');
        const result = await window.electronAPI.zoomReset();
        console.log('Zoom reset result:', result);
      } else {
        console.error('window.electronAPI not available');
      }
    } catch (error) {
      console.error('Error resetting zoom:', error);
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
