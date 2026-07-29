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
 */
const BackupNotifier: React.FC<BackupNotifierProps> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();

  useEffect(() => {
    return window.electronAPI.onBackupCreated(info => {
      const message = info.trigger === 'quit' ? t.backupExitCreated : t.backupAutoCreated;
      notify.success(message.replace('{date}', info.date));
    });
  }, [language]);

  return null;
};

export default BackupNotifier;
