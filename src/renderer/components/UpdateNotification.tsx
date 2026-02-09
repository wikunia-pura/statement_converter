import React, { useState, useEffect } from 'react';
import { translations, Language } from '../translations';

interface UpdateNotificationProps {
  language: Language;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ language }) => {
  const t = translations[language];
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Listen for update events
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.onUpdateAvailable((info: any) => {
        setUpdateAvailable(true);
        setUpdateInfo(info);
      });

      window.electronAPI.onUpdateDownloaded((info: any) => {
        setUpdateDownloaded(true);
        setDownloading(false);
        setUpdateInfo(info);
      });

      window.electronAPI.onUpdateError((err: string) => {
        setError(err);
        setDownloading(false);
      });
    }
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    const result = await window.electronAPI.downloadUpdate();
    if (!result.success && result.error) {
      setError(result.error);
      setDownloading(false);
    }
  };

  const handleInstall = () => {
    window.electronAPI.installUpdate();
  };

  const handleDismiss = () => {
    setUpdateAvailable(false);
    setUpdateDownloaded(false);
    setError('');
  };

  if (!updateAvailable && !updateDownloaded && !error) {
    return null;
  }

  return (
    <div className="update-notification">
      {updateDownloaded ? (
        <div className="update-content">
          <div className="update-icon">🎉</div>
          <div className="update-text">
            <strong>{t.updateReadyTitle}</strong>
            <p>{t.updateReadyMessage}</p>
          </div>
          <div className="update-actions">
            <button className="button button-primary" onClick={handleInstall}>
              {t.installNow}
            </button>
            <button className="button button-secondary" onClick={handleDismiss}>
              {t.later}
            </button>
          </div>
        </div>
      ) : updateAvailable ? (
        <div className="update-content">
          <div className="update-icon">🔄</div>
          <div className="update-text">
            <strong>{t.updateAvailableTitle}</strong>
            <p>
              {t.newVersion}: {updateInfo?.version}
            </p>
          </div>
          <div className="update-actions">
            {downloading ? (
              <div className="update-progress">
                <div className="spinner"></div>
                <span>{t.downloading}</span>
              </div>
            ) : (
              <>
                <button className="button button-primary" onClick={handleDownload}>
                  {t.download}
                </button>
                <button className="button button-secondary" onClick={handleDismiss}>
                  {t.skip}
                </button>
              </>
            )}
          </div>
        </div>
      ) : error ? (
        <div className="update-content update-error">
          <div className="update-icon">⚠️</div>
          <div className="update-text">
            <strong>{t.updateError}</strong>
            <p>{error}</p>
          </div>
          <div className="update-actions">
            <button className="button button-secondary" onClick={handleDismiss}>
              {t.close}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UpdateNotification;
