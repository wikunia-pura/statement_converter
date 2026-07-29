import React, { useEffect } from 'react';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';

interface BackupNotifierProps {
  language: Language;
}

/**
 * Invisible bridge: listens for the main process's "auto backup written"
 * push and surfaces it as an in-app toast. Fired after the startup backup
 * and on exit — the main process holds the window open for a moment after
 * the exit backup so this toast is actually seen before the app closes.
 *
 * The toast also reports the off-site push, so "saved locally" and "saved
 * locally AND copied to the backups repo" are distinguishable without
 * digging through main.log. A failed push downgrades the toast to a warning;
 * machines with no upload config say nothing about it at all.
 */
const BackupNotifier: React.FC<BackupNotifierProps> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();

  useEffect(() => {
    return window.electronAPI.onBackupCreated(info => {
      const offsite =
        info.upload === 'uploaded' ? t.backupOffsiteOk
        : info.upload === 'failed' ? t.backupOffsiteFailed
        : '';
      const message = (info.trigger === 'quit' ? t.backupExitCreated : t.backupAutoCreated)
        .replace('{date}', info.date)
        .replace('{offsite}', offsite);
      if (info.upload === 'failed') notify.warning(message);
      else notify.success(message);
    });
  }, [language]);

  return null;
};

export default BackupNotifier;
