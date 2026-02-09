import React, { useState, useEffect } from 'react';
import { ConversionHistory } from '../../shared/types';
import { translations, Language } from '../translations';
import { formatDate } from '../../shared/utils';

interface HistoryProps {
  language: Language;
}

const History: React.FC<HistoryProps> = ({ language }) => {
  const t = translations[language];
  const [history, setHistory] = useState<ConversionHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

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
    if (confirm(t.confirmClearHistory)) {
      await window.electronAPI.clearHistory();
      loadHistory();
    }
  };

  const handleOpenFile = async (filePath: string) => {
    await window.electronAPI.openFile(filePath);
  };

  // Pagination logic
  const totalPages = Math.ceil(history.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = history.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    return pages;
  };

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
            <div>
              <h2 style={{ marginBottom: '5px' }}>{t.recentConversions}</h2>
              {history.length > 0 && (
                <p style={{ fontSize: '14px', color: '#6c757d', margin: 0 }}>
                  Wpisy {startIndex + 1}-{Math.min(endIndex, history.length)} z {history.length}
                </p>
              )}
            </div>
            {history.length > 0 && (
              <button className="button button-danger" onClick={handleClearHistory}>
                {t.clearHistory}
              </button>
            )}
          </div>

          {history.length > 0 ? (
            <>
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
                  {currentItems.map((entry) => (
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

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="pagination-button"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    ← Poprzednia
                  </button>
                  
                  <div className="pagination-numbers">
                    {getPageNumbers().map((page, index) => (
                      typeof page === 'number' ? (
                        <button
                          key={index}
                          className={`pagination-number ${
                            currentPage === page ? 'active' : ''
                          }`}
                          onClick={() => goToPage(page)}
                        >
                          {page}
                        </button>
                      ) : (
                        <span key={index} className="pagination-ellipsis">
                          {page}
                        </span>
                      )
                    ))}
                  </div>

                  <button
                    className="pagination-button"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Następna →
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-text">{t.noConversionHistory}</div>
            </div>
          )}
        </div>
    </div>
  );
};

export default History;
