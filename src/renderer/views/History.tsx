import React, { useState, useEffect } from 'react';
import { ConversionHistory } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import ConversionHistoryTimeline from '../components/ConversionHistoryTimeline';

interface HistoryProps {
  language: Language;
}

const History: React.FC<HistoryProps> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [history, setHistory] = useState<ConversionHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const historyData = await window.electronAPI.getHistory();
      setHistory(historyData);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (await notify.confirm(t.confirmClearHistory, { danger: true })) {
      await window.electronAPI.clearHistory();
      loadHistory();
    }
  };

  const handleImportHistory = async () => {
    try {
      const result = await window.electronAPI.importHistoryFromFile();
      if (result.success) {
        notify.success(
          t.importHistorySuccess
            .replace('{added}', String(result.added ?? 0))
            .replace('{skipped}', String(result.skipped ?? 0)),
        );
        loadHistory();
      } else if (result.error) {
        notify.error(`${t.importHistoryError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(t.importHistoryError);
    }
  };

  const handleExportHistory = async () => {
    try {
      const result = await window.electronAPI.exportHistoryToFile();
      if (result.success) {
        notify.success(t.exportHistorySuccess.replace('{count}', String(result.count ?? 0)));
      } else if (result.error) {
        notify.error(`${t.exportHistoryError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(t.exportHistoryError);
    }
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  return (
    <div className="content-body">
      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px',
          }}
        >
          <h2 style={{ margin: 0 }}>{t.recentConversions}</h2>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {history.length > 0 && (
              <button className="button button-danger" onClick={handleClearHistory}>
                {t.clearHistory}
              </button>
            )}
            <button className="button button-import" onClick={handleImportHistory}>
              {t.importFromFile}
            </button>
            <button
              className="button button-export"
              onClick={handleExportHistory}
              disabled={history.length === 0}
            >
              {t.exportToFile}
            </button>
          </div>
        </div>

        <ConversionHistoryTimeline history={history} language={language} />
      </div>
    </div>
  );
};

export default History;
