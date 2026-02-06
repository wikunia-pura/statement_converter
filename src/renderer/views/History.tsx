import React, { useState, useEffect } from 'react';
import { ConversionHistory } from '../../shared/types';

declare global {
  interface Window {
    electronAPI: any;
  }
}

const History: React.FC = () => {
  const [history, setHistory] = useState<ConversionHistory[]>([]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const historyData = await window.electronAPI.getHistory();
    setHistory(historyData);
  };

  const handleClearHistory = async () => {
    if (confirm('Are you sure you want to clear all history?')) {
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
        <h1>Conversion History</h1>
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
            <h2>Recent Conversions</h2>
            {history.length > 0 && (
              <button className="button button-danger" onClick={handleClearHistory}>
                Clear History
              </button>
            )}
          </div>

          {history.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>File Name</th>
                  <th>Bank</th>
                  <th>Converter</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                        {entry.status}
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
                          Open File
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
              <div className="empty-state-text">No conversion history yet</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default History;
