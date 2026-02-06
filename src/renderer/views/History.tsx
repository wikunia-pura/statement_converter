import React, { useState, useEffect } from 'react';
import { ConversionHistory } from '../../shared/types';
import { translations, Language } from '../translations';

declare global {
  interface Window {
    electronAPI: any;
  }
}

interface HistoryProps {
  language: Language;
}

const History: React.FC<HistoryProps> = ({ language }) => {
  const t = translations[language];
  const [history, setHistory] = useState<ConversionHistory[]>([]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const historyData = await window.electronAPI.getHistory();
    setHistory(historyData);
  };

  const handleClearHistory = async () => {
    if (confirm(t.confirmClearHistory)) {
      await window.electronAPI.clearHistory();
      loadHistory();
    }
  };

  const handleOpenFile = async (filePath: string) => {
    await window.electronAPI.openFile(filePath);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <>
      <div className="content-header">
        <h1>{t.conversionHistory}</h1>
      </div>
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
            <h2>{t.recentConversions}</h2>
            {history.length > 0 && (
              <button className="button button-danger" onClick={handleClearHistory}>
                {t.clearHistory}
              </button>
            )}
          </div>

          {history.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>{t.date}</th>
                  <th>{t.fileName}</th>
                  <th>{t.bank}</th>
                  <th>{t.converter}</th>
                  <th>{t.status}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ fontSize: '12px', color: '#7f8c8d' }}>
                      {formatDate(entry.convertedAt)}
                    </td>
                    <td>{entry.fileName}</td>
                    <td>{entry.bankName}</td>
                    <td style={{ fontSize: '12px', color: '#7f8c8d' }}>
                      {entry.converterName}
                    </td>
                    <td>
                      <span
                        className={`status-badge status-${
                          entry.status === 'success' ? 'success' : 'error'
                        }`}
                      >
                        {entry.status === 'success' ? t.success : t.error}
                      </span>
                      {entry.errorMessage && (
                        <div
                          style={{ fontSize: '11px', color: '#e74c3c', marginTop: '4px' }}
                        >
                          {entry.errorMessage}
                        </div>
                      )}
                    </td>
                    <td>
                      {entry.status === 'success' && entry.outputPath && (
                        <button
                          className="button button-small button-primary"
                          onClick={() => handleOpenFile(entry.outputPath)}
                        >
                          {t.open}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-text">{t.noConversionHistory}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default History;
