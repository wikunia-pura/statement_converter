import React, { useState, useEffect } from 'react';
import { ConversionHistory } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import ConversionHistoryTimeline from '../components/ConversionHistoryTimeline';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';

interface HistoryProps {
  language: Language;
  /**
   * Text to search for as soon as the view opens — set by "Pokaż w historii" in
   * the Księgowania tab, so a booking can be traced back to its history entry.
   */
  searchSeed?: string;
}

const History: React.FC<HistoryProps> = ({ language, searchSeed }) => {
  const t = translations[language];
  const notify = useNotify();
  const [history, setHistory] = useState<ConversionHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
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
        notify.success(t.exportHistorySuccess.replace('{count}', String(result.count ?? 0)), {
          file: result.filePath,
        });
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
      <FormSection
        icon="history"
        title={t.recentConversions}
        description={t.historyDesc}
        aside={
          <div className="form-section__actions">
            {/* Clearing is demoted: never the loudest button next to everyday actions. */}
            {history.length > 0 && (
              <>
                <button className="button button-ghost icon-danger" onClick={handleClearHistory}>
                  <Icon name="trash" size={14} />{' '}{t.clearHistory}
                </button>
                <span className="toolbar-divider" aria-hidden="true" />
              </>
            )}
            <button className="button button-import" onClick={handleImportHistory}>
              <Icon name="upload" size={14} />{' '}{t.importFromFile}
            </button>
            <button
              className="button button-export"
              onClick={handleExportHistory}
              disabled={history.length === 0}
            >
              <Icon name="download" size={14} />{' '}{t.exportToFile}
            </button>
          </div>
        }
      >
        <ConversionHistoryTimeline history={history} language={language} searchSeed={searchSeed} />
      </FormSection>
    </div>
  );
};

export default History;
