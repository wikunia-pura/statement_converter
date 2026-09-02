import React, { useState, useEffect } from 'react';
import { translations, Language } from '../translations';
import Icon from './Icon';

interface UpdateNotificationProps {
  language: Language;
}

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ language }) => {
  const t = translations[language];
  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [platform, setPlatform] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [macReleaseOpened, setMacReleaseOpened] = useState(false);
  // Shown when the user waves the update away: they get told once, plainly,
  // what running an old build risks. Main re-checks every hour, so the card
  // comes back on its own until the update is actually installed.
  const [showRequiredNotice, setShowRequiredNotice] = useState(false);

  useEffect(() => {
    // Listen for update events. Each subscription returns an unsubscribe fn;
    // collect them and tear down on unmount so listeners don't accumulate across
    // login/logout remounts (each remount previously leaked 4 IPC listeners).
    if (typeof window === 'undefined' || !window.electronAPI) return;

    const unsubscribers = [
      window.electronAPI.onUpdateAvailable((info: any) => {
        console.log('Update available:', info);
        setUpdateAvailable(true);
        setUpdateInfo(info);
        // An hourly re-announcement puts the offer back on screen rather than
        // the warning the user has already read.
        setShowRequiredNotice(false);
      }),
      window.electronAPI.onUpdateDownloaded((info: any) => {
        console.log('Update downloaded:', info);
        setUpdateDownloaded(true);
        setDownloading(false);
        setUpdateInfo(info);
        setPlatform(info.platform || '');
      }),
      window.electronAPI.onUpdateError((err: string) => {
        console.error('Update error:', err);
        setError(err);
        setDownloading(false);
      }),
      window.electronAPI.onDownloadProgress((progress: any) => {
        console.log('Download progress:', progress.percent);
        setDownloadProgress(Math.round(progress.percent || 0));
      }),
    ];

    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  const handleDownload = async () => {
    console.log('Starting download...');
    setError('');
    if (isMac) {
      // macOS: niepodpisana aplikacja — handler IPC otworzy stronę Release
      // w przeglądarce zamiast pobierać przez electron-updater (i tak by się
      // wywaliło na weryfikacji podpisu).
      try {
        const result = await window.electronAPI.downloadUpdate();
        if (result.success && result.openedRelease) {
          setMacReleaseOpened(true);
        } else if (result.error) {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
      return;
    }
    setDownloading(true);
    setDownloadProgress(0);
    try {
      const result = await window.electronAPI.downloadUpdate();
      console.log('Download result:', result);
      if (result.success) {
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
    setMacReleaseOpened(false);
    setShowRequiredNotice(false);
    setError('');
  };

  /**
   * "Później" on a pending update. The update is not optional — an old build
   * writes accounting files against yesterday's rules — so instead of silently
   * closing, the card turns into the warning and offers the update again.
   */
  const handleLater = () => {
    setShowRequiredNotice(true);
  };

  const handleUpdateNow = () => {
    setShowRequiredNotice(false);
    void handleDownload();
  };

  if (!updateAvailable && !updateDownloaded && !error && !macReleaseOpened) {
    return null;
  }

  return (
    <div className="update-notification">
      {showRequiredNotice ? (
        <div className="update-content update-required">
          <div className="update-icon" style={{ color: 'var(--warning)' }}>
            <Icon name="alert-triangle" size={24} />
          </div>
          <div className="update-text">
            <strong>{t.updateRequiredTitle}</strong>
            <p>{t.updateRequiredMessage}</p>
          </div>
          <div className="update-actions">
            {updateDownloaded && platform !== 'win32' ? (
              <button className="button button-primary" onClick={handleOpenDownloads}>
                <Icon name="folder" size={14} />{' '}
                {language === 'pl' ? 'Otwórz folder Pobrane' : 'Open Downloads'}
              </button>
            ) : (
              <button className="button button-primary" onClick={handleUpdateNow}>
                <Icon name="download" size={14} />{' '}{t.updateNow}
              </button>
            )}
            <button className="button button-secondary" onClick={handleDismiss}>
              <Icon name="x" size={14} />{' '}{t.updateLaterAnyway}
            </button>
          </div>
        </div>
      ) : macReleaseOpened ? (
        <div className="update-content">
          <div className="update-icon" style={{ color: 'var(--success)' }}><Icon name="sparkles" size={24} /></div>
          <div className="update-text">
            <strong>{t.macReleasePageOpened}</strong>
            <p>{t.macUpdateInstructions}</p>
          </div>
          <div className="update-actions">
            <button className="button button-secondary" onClick={handleDismiss}>
              <Icon name="x" size={14} />{' '}{t.close}
            </button>
          </div>
        </div>
      ) : updateDownloaded ? (
        <div className="update-content">
          <div className="update-icon" style={{ color: 'var(--success)' }}><Icon name="sparkles" size={24} /></div>
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
                <Icon name="folder" size={14} />{' '}{language === 'pl' ? 'Otwórz folder Pobrane' : 'Open Downloads'}
              </button>
            )}
            <button className="button button-secondary" onClick={handleLater}>
              <Icon name="x" size={14} />{' '}{t.later}
            </button>
          </div>
        </div>
      ) : updateAvailable ? (
        <div className="update-content">
          <div className="update-icon" style={{ color: 'var(--info)' }}><Icon name="refresh" size={24} /></div>
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
                  <Icon name="download" size={14} />{' '}{isMac ? t.openDownloadPage : t.download}
                </button>
                <button className="button button-secondary" onClick={handleLater}>
                  <Icon name="x" size={14} />{' '}{t.later}
                </button>
              </>
            )}
          </div>
        </div>
      ) : error ? (
        <div className="update-content update-error">
          <div className="update-icon" style={{ color: 'var(--danger)' }}><Icon name="alert-triangle" size={24} /></div>
          <div className="update-text">
            <strong>{t.updateError}</strong>
            <p>{error}</p>
          </div>
          <div className="update-actions">
            <button className="button button-secondary" onClick={handleDismiss}>
              <Icon name="x" size={14} />{' '}{t.close}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UpdateNotification;
