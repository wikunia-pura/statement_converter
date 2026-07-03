import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ConversionHistory } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import Icon from './Icon';
import { useDropdownPlacement } from '../hooks/useDropdownPlacement';
import { resolveOutputFilePath } from '../../shared/outputPaths';

interface ConversionHistoryTimelineProps {
  history: ConversionHistory[];
  language: Language;
  /** Show the free-text search box above the timeline. */
  showSearch?: boolean;
  /** How many of the most-recent days start expanded (default 0 — all collapsed). */
  initialExpandedDays?: number;
}

/** Local YYYY-MM-DD key for grouping, independent of timezone printing quirks. */
function dayKeyOf(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Polish plural: [one, few (2-4), many]. English: [singular, plural]. */
function plural(n: number, language: Language, pl: [string, string, string], en: [string, string]): string {
  if (language === 'en') return `${n} ${n === 1 ? en[0] : en[1]}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (n === 1) word = pl[0];
  else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) word = pl[1];
  else word = pl[2];
  return `${n} ${word}`;
}

interface BankGroup {
  bankName: string;
  entries: ConversionHistory[];
  errorCount: number;
}

interface DayGroup {
  key: string;
  /** Timestamp of the most recent entry in the day, for label + ordering. */
  sortTs: number;
  banks: BankGroup[];
  total: number;
  errorCount: number;
}

const ConversionHistoryTimeline: React.FC<ConversionHistoryTimelineProps> = ({
  history,
  language,
  showSearch = true,
  initialExpandedDays = 0,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [searchTerm, setSearchTerm] = useState('');
  // Explicit user overrides only; untouched days fall back to the index default.
  const [dayOverrides, setDayOverrides] = useState<Record<string, boolean>>({});
  // Banks start collapsed; this holds the ids the user has expanded.
  const [expandedBanks, setExpandedBanks] = useState<Set<string>>(new Set());
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(document.body.classList.contains('dark-mode'));
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuPlacement = useDropdownPlacement(dropdownRef, openDropdownId !== null, 120);

  const locale = language === 'en' ? 'en-US' : 'pl-PL';

  // Detect dark mode changes (inline dropdown styling depends on it).
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.body.classList.contains('dark-mode'));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Close the open-file dropdown when clicking outside it.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdownId(null);
      }
    };
    if (openDropdownId !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openDropdownId]);

  const searchActive = searchTerm.trim().length > 0;

  // Filter first (search across the same fields as the classic table), then group.
  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return history;
    const terms = q.split(/\s+/);
    return history.filter((entry) => {
      const statusLabel = entry.status === 'success' ? t.success : t.error;
      const haystack = [
        entry.fileName,
        entry.bankName,
        entry.converterName,
        entry.status,
        statusLabel,
        entry.errorMessage,
        entry.inputPath,
        entry.outputPath,
        entry.convertedAt,
        new Date(entry.convertedAt).toLocaleString(locale),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [history, searchTerm, t, locale]);

  // Group filtered entries by day → bank, both ordered most-recent-first.
  const days = useMemo<DayGroup[]>(() => {
    const dayMap = new Map<string, ConversionHistory[]>();
    for (const entry of filtered) {
      const key = dayKeyOf(entry.convertedAt);
      const bucket = dayMap.get(key);
      if (bucket) bucket.push(entry);
      else dayMap.set(key, [entry]);
    }

    const result: DayGroup[] = [];
    for (const [key, entries] of dayMap) {
      const bankMap = new Map<string, ConversionHistory[]>();
      for (const entry of entries) {
        const name = entry.bankName || '—';
        const bucket = bankMap.get(name);
        if (bucket) bucket.push(entry);
        else bankMap.set(name, [entry]);
      }
      const banks: BankGroup[] = [...bankMap.entries()]
        .map(([bankName, bankEntries]) => ({
          bankName,
          entries: bankEntries.sort(
            (a, b) => new Date(b.convertedAt).getTime() - new Date(a.convertedAt).getTime()
          ),
          errorCount: bankEntries.filter((e) => e.status === 'error').length,
        }))
        .sort((a, b) => a.bankName.localeCompare(b.bankName, locale));

      result.push({
        key,
        sortTs: Math.max(...entries.map((e) => new Date(e.convertedAt).getTime())),
        banks,
        total: entries.length,
        errorCount: entries.filter((e) => e.status === 'error').length,
      });
    }
    return result.sort((a, b) => b.sortTs - a.sortTs);
  }, [filtered, locale]);

  const todayKey = dayKeyOf(new Date());
  const yesterdayKey = useMemo(() => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return dayKeyOf(y);
  }, []);

  const dayLabel = (key: string, ts: number): string => {
    const formatted = new Date(ts).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    if (key === todayKey) return `${t.today} · ${formatted}`;
    if (key === yesterdayKey) return `${t.yesterday} · ${formatted}`;
    return formatted;
  };

  const isDayExpanded = (index: number, key: string): boolean => {
    if (searchActive) return true; // surface all matches while searching
    if (key in dayOverrides) return dayOverrides[key];
    return index < initialExpandedDays;
  };

  const toggleDay = (index: number, key: string) => {
    setDayOverrides((prev) => {
      const currentlyOpen = key in prev ? prev[key] : index < initialExpandedDays;
      return { ...prev, [key]: !currentlyOpen };
    });
  };

  const isBankExpanded = (dayKey: string, bankName: string): boolean => {
    if (searchActive) return true;
    return expandedBanks.has(`${dayKey}::${bankName}`);
  };

  const toggleBank = (dayKey: string, bankName: string) => {
    const id = `${dayKey}::${bankName}`;
    setExpandedBanks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allBanksExpanded = (day: DayGroup): boolean =>
    day.banks.every((b) => expandedBanks.has(`${day.key}::${b.bankName}`));

  const toggleAllBanks = (day: DayGroup) => {
    const collapse = allBanksExpanded(day);
    setExpandedBanks((prev) => {
      const next = new Set(prev);
      for (const b of day.banks) {
        const id = `${day.key}::${b.bankName}`;
        if (collapse) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const handleOpenFile = async (outputPath: string, type: 'preview' | 'accounting') => {
    const filePath = resolveOutputFilePath(outputPath, type);
    const result = await window.electronAPI.openFile(filePath);
    if (!result) notify.error(t.fileNotFound);
    setOpenDropdownId(null);
  };

  const daySummary = (day: DayGroup): string => {
    const parts = [
      plural(day.total, language, ['plik', 'pliki', 'plików'], ['file', 'files']),
      plural(day.banks.length, language, ['bank', 'banki', 'banków'], ['bank', 'banks']),
    ];
    if (day.errorCount > 0) {
      parts.push(plural(day.errorCount, language, ['błąd', 'błędy', 'błędów'], ['error', 'errors']));
    }
    return parts.join(' · ');
  };

  if (history.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><Icon name="history" size={48} /></div>
        <div className="empty-state-text">{t.noConversionHistory}</div>
      </div>
    );
  }

  return (
    <div className="history-timeline">
      {showSearch && (
        <div className="form-group" style={{ marginBottom: '15px' }}>
          <input
            type="text"
            placeholder={t.searchHistory}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      )}

      {days.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="search" size={48} /></div>
          <div className="empty-state-text">{t.noHistoryResults}</div>
        </div>
      ) : (
        days.map((day, dayIndex) => {
          const expanded = isDayExpanded(dayIndex, day.key);
          return (
            <div className={`history-day ${expanded ? 'is-open' : ''}`} key={day.key}>
              <button
                type="button"
                className="history-day-header"
                onClick={() => toggleDay(dayIndex, day.key)}
                aria-expanded={expanded}
              >
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={18} />
                <span className="history-day-title">{dayLabel(day.key, day.sortTs)}</span>
                <span className="history-day-summary">
                  {daySummary(day)}
                  {day.errorCount > 0 && <span className="history-day-error-dot" />}
                </span>
              </button>

              {expanded && (
                <div className="history-day-body">
                  {!searchActive && day.banks.length > 1 && (
                    <button
                      type="button"
                      className="history-day-toggle-all"
                      onClick={() => toggleAllBanks(day)}
                    >
                      {allBanksExpanded(day) ? t.collapseAll : t.expandAll}
                    </button>
                  )}
                  {day.banks.map((bank) => {
                    const bankOpen = isBankExpanded(day.key, bank.bankName);
                    return (
                      <div className={`history-bank ${bankOpen ? 'is-open' : ''}`} key={bank.bankName}>
                        <button
                          type="button"
                          className="history-bank-header"
                          onClick={() => toggleBank(day.key, bank.bankName)}
                          aria-expanded={bankOpen}
                        >
                          <Icon name={bankOpen ? 'chevron-down' : 'chevron-right'} size={15} />
                          <span className="history-bank-name">{bank.bankName}</span>
                          <span className="history-bank-count">
                            {plural(bank.entries.length, language, ['plik', 'pliki', 'plików'], ['file', 'files'])}
                          </span>
                          {bank.errorCount > 0 && (
                            <span className="status-badge status-error history-bank-badge">
                              {plural(bank.errorCount, language, ['błąd', 'błędy', 'błędów'], ['error', 'errors'])}
                            </span>
                          )}
                        </button>

                        {bankOpen && (
                          <div className="history-bank-body">
                            {bank.entries.map((entry) => (
                              <div className="history-entry" key={entry.id}>
                                <span className="history-entry-time">
                                  {new Date(entry.convertedAt).toLocaleTimeString(locale, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                <div className="history-entry-main">
                                  <span className="history-entry-file" title={entry.fileName}>
                                    {entry.fileName}
                                  </span>
                                  {entry.converterName && (
                                    <span className="history-entry-converter">{entry.converterName}</span>
                                  )}
                                  {entry.status === 'error' && entry.errorMessage && (
                                    <span className="history-entry-error">{entry.errorMessage}</span>
                                  )}
                                </div>
                                <span
                                  className={`status-badge status-${entry.status === 'success' ? 'success' : 'error'}`}
                                >
                                  {entry.status === 'success' ? t.success : t.error}
                                </span>
                                <div className="history-entry-actions">
                                  {entry.status === 'success' && entry.outputPath && (
                                    <div
                                      style={{ position: 'relative', display: 'inline-block' }}
                                      ref={openDropdownId === entry.id ? dropdownRef : undefined}
                                    >
                                      <button
                                        className="button button-small button-primary"
                                        onClick={() =>
                                          setOpenDropdownId(openDropdownId === entry.id ? null : entry.id)
                                        }
                                      >
                                        {t.open} ▾
                                      </button>
                                      {openDropdownId === entry.id && (
                                        <div
                                          style={{
                                            position: 'absolute',
                                            top: menuPlacement.top,
                                            bottom: menuPlacement.bottom,
                                            marginTop: menuPlacement.marginTop,
                                            marginBottom: menuPlacement.marginBottom,
                                            right: 0,
                                            backgroundColor: 'var(--bg-surface)',
                                            border: '1px solid var(--border-default)',
                                            borderRadius: '4px',
                                            boxShadow: isDarkMode
                                              ? '0 2px 8px rgba(0,0,0,0.4)'
                                              : '0 2px 8px rgba(0,0,0,0.15)',
                                            zIndex: 1000,
                                            minWidth: '150px',
                                          }}
                                        >
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
                                              color: 'var(--text-primary)',
                                            }}
                                            onClick={() => handleOpenFile(entry.outputPath, 'preview')}
                                            onMouseEnter={(e) =>
                                              (e.currentTarget.style.background = 'var(--bg-surface-sunken)')
                                            }
                                            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
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
                                              color: 'var(--text-primary)',
                                            }}
                                            onClick={() => handleOpenFile(entry.outputPath, 'accounting')}
                                            onMouseEnter={(e) =>
                                              (e.currentTarget.style.background = 'var(--bg-surface-sunken)')
                                            }
                                            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                          >
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                              <Icon name="bar-chart" size={13} /> {t.openAccounting}
                                            </span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default ConversionHistoryTimeline;
