import React, { useState, useEffect, useRef } from 'react';
import { ConversionHistory } from '../../shared/types';
import { translations, Language } from '../translations';
import { formatDate } from '../../shared/utils';
import Icon from '../components/Icon';

interface HistoryProps {
  language: Language;
}

const History: React.FC<HistoryProps> = ({ language }) => {
  const t = translations[language];
  const [history, setHistory] = useState<ConversionHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(document.body.classList.contains('dark-mode'));
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemsPerPage = 100;

  useEffect(() => {
    loadHistory();
  }, []);

  // Detect dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.body.classList.contains('dark-mode'));
    });
    
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
    
    return () => observer.disconnect();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdownId(null);
      }
    };

    if (openDropdownId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openDropdownId]);

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

  const handleOpenFile = async (outputPath: string, type: 'preview' | 'accounting') => {
    const suffix = type === 'preview' ? '-podglad.txt' : '-accounting.txt';
    const filePath = outputPath.replace(/\.txt$/, '') + suffix;
    const result = await window.electronAPI.openFile(filePath);
    if (!result) {
      alert(t.fileNotFound);
    }
    setOpenDropdownId(null);
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
                <p style={{ fontSize: '14px', color: 'var(--text-tertiary)', margin: 0 }}>
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
                    <td style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                      {formatDate(entry.convertedAt)}
                    </td>
                    <td>{entry.fileName}</td>
                    <td>{entry.bankName}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
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
                          style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '4px' }}
                        >
                          {entry.errorMessage}
                        </div>
                      )}
                    </td>
                    <td>
                      {entry.status === 'success' && entry.outputPath && (
                        <div 
                          style={{ position: 'relative', display: 'inline-block' }}
                          ref={openDropdownId === entry.id ? dropdownRef : undefined}
                        >
                          <button
                            className="button button-small button-primary"
                            onClick={() => setOpenDropdownId(openDropdownId === entry.id ? null : entry.id)}
                          >
                            {t.open} ▾
                          </button>
                          {openDropdownId === entry.id && (
                            <div style={{
                              position: 'absolute',
                              top: '100%',
                              left: 0,
                              backgroundColor: isDarkMode ? 'var(--bg-surface)' : 'var(--bg-surface)',
                              border: `1px solid ${isDarkMode ? 'var(--border-default)' : 'var(--border-default)'}`,
                              borderRadius: '4px',
                              boxShadow: isDarkMode ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.15)',
                              zIndex: 1000,
                              minWidth: '120px'
                            }}>
                              <button
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 12px',
                                  border: 'none',
                                  background: 'none',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  color: isDarkMode ? 'var(--text-primary)' : 'inherit',
                                }}
                                onClick={() => handleOpenFile(entry.outputPath, 'preview')}
                                onMouseEnter={(e) => e.currentTarget.style.background = isDarkMode ? 'var(--border-default)' : 'var(--bg-surface-sunken)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                              >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <Icon name="file-text" size={13} /> {t.openPreview}
                                </span>
                              </button>
                              <button
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  padding: '8px 12px',
                                  border: 'none',
                                  background: 'none',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  color: isDarkMode ? 'var(--text-primary)' : 'inherit',
                                }}
                                onClick={() => handleOpenFile(entry.outputPath, 'accounting')}
                                onMouseEnter={(e) => e.currentTarget.style.background = isDarkMode ? 'var(--border-default)' : 'var(--bg-surface-sunken)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                              >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <Icon name="bar-chart" size={13} /> {t.openAccounting}
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
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
              <div className="empty-state-icon"><Icon name="history" size={48} /></div>
              <div className="empty-state-text">{t.noConversionHistory}</div>
            </div>
          )}
        </div>
    </div>
  );
};

export default History;
