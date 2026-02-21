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
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [downloadPath, setDownloadPath] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Listen for update events
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.onUpdateAvailable((info: any) => {
        console.log('Update available:', info);
        setUpdateAvailable(true);
        setUpdateInfo(info);
      });

      window.electronAPI.onUpdateDownloaded((info: any) => {
        console.log('Update downloaded:', info);
        setUpdateDownloaded(true);
        setDownloading(false);
        setUpdateInfo(info);
        setDownloadPath(info.downloadPath || '');
        setPlatform(info.platform || '');
      });

      window.electronAPI.onUpdateError((err: string) => {
        console.error('Update error:', err);
        setError(err);
        setDownloading(false);
      });

      window.electronAPI.onDownloadProgress((progress: any) => {
        console.log('Download progress:', progress.percent);
        setDownloadProgress(Math.round(progress.percent || 0));
      });
    }
  }, []);

  const handleDownload = async () => {
    console.log('Starting download...');
    setDownloading(true);
    setError('');
    setDownloadProgress(0);
    try {
      const result = await window.electronAPI.downloadUpdate();
      console.log('Download result:', result);
      if (result.success) {
        setDownloadPath(result.downloadPath || '');
      } else if (result.error) {
        setError(result.error);
        setDownloading(false);
      }
    } catch (err) {
      console.error('Download error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setDownloading(false);
    }
  };

  const handleOpenDownloads = async () => {
    console.log('Opening Downloads folder...');
    await window.electronAPI.openDownloadsFolder();
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
            <strong>{language === 'pl' ? 'Aktualizacja pobrana!' : 'Update Downloaded!'}</strong>
            {platform === 'win32' ? (
              <p>
                {language === 'pl'
                  ? 'Aplikacja zostanie automatycznie zaktualizowana i uruchomiona ponownie.'
                  : 'The app will be automatically updated and restarted.'}
              </p>
            ) : (
              <p>
                {language === 'pl'
                  ? 'Plik instalacyjny został pobrany do folderu Pobrane. Otwórz folder i zainstaluj aktualizację ręcznie.'
                  : 'Installation file has been downloaded to Downloads folder. Open the folder and install the update manually.'}
              </p>
            )}
          </div>
          <div className="update-actions">
            {platform !== 'win32' && (
              <button className="button button-primary" onClick={handleOpenDownloads}>
                {language === 'pl' ? 'Otwórz folder Pobrane' : 'Open Downloads'}
              </button>
            )}
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
                <span>{t.downloading} {downloadProgress > 0 ? `${downloadProgress}%` : ''}</span>
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
