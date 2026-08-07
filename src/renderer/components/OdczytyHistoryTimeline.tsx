import React, { useMemo, useState } from 'react';
import { OdczytyHistoryEntry } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import Icon from './Icon';
import OdczytySkippedModal, { OdczytySkippedGroup } from './OdczytySkippedModal';

interface Props {
  history: OdczytyHistoryEntry[];
  language: Language;
  /** Show the free-text search box above the timeline. */
  showSearch?: boolean;
  /** How many of the most-recent days start expanded (default 0 — all collapsed). */
  initialExpandedDays?: number;
}

/** Local YYYY-MM-DD key for grouping, independent of timezone printing quirks. */
function dayKeyOf(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Polish plural: [one, few (2-4), many]. English: [singular, plural]. */
function plural(
  n: number,
  language: Language,
  pl: [string, string, string],
  en: [string, string],
): string {
  if (language === 'en') return `${n} ${n === 1 ? en[0] : en[1]}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (n === 1) word = pl[0];
  else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) word = pl[1];
  else word = pl[2];
  return `${n} ${word}`;
}

interface SupplierGroup {
  supplier: string;
  entries: OdczytyHistoryEntry[];
  errorCount: number;
}

interface DayGroup {
  key: string;
  sortTs: number;
  suppliers: SupplierGroup[];
  total: number;
  errorCount: number;
}

/**
 * Operation history of the meter-readings module, grouped day → supplier →
 * operation. One operation is one "Konwertuj" click, so it expands to the source
 * workbooks it read and the IMPEX files it produced, each openable in place.
 */
const OdczytyHistoryTimeline: React.FC<Props> = ({
  history,
  language,
  showSearch = true,
  initialExpandedDays = 0,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [searchTerm, setSearchTerm] = useState('');
  const [dayOverrides, setDayOverrides] = useState<Record<string, boolean>>({});
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [skippedModal, setSkippedModal] = useState<OdczytySkippedGroup[] | null>(null);

  const locale = language === 'en' ? 'en-US' : 'pl-PL';
  const searchActive = searchTerm.trim().length > 0;

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return history;
    const terms = q.split(/\s+/);
    return history.filter((entry) => {
      const haystack = [
        entry.supplier,
        entry.status,
        entry.status === 'success' ? t.success : t.error,
        entry.errorMessage,
        entry.outputDir,
        ...entry.sources.map((s) => s.fileName),
        ...entry.outputs.map((o) => `${o.wm} ${o.fileName} ${o.date}`),
        entry.convertedAt,
        new Date(entry.convertedAt).toLocaleString(locale),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [history, searchTerm, t, locale]);

  const days = useMemo<DayGroup[]>(() => {
    const dayMap = new Map<string, OdczytyHistoryEntry[]>();
    for (const entry of filtered) {
      const key = dayKeyOf(entry.convertedAt);
      const bucket = dayMap.get(key);
      if (bucket) bucket.push(entry);
      else dayMap.set(key, [entry]);
    }

    const result: DayGroup[] = [];
    for (const [key, entries] of dayMap) {
      const supplierMap = new Map<string, OdczytyHistoryEntry[]>();
      for (const entry of entries) {
        const name = entry.supplier || '—';
        const bucket = supplierMap.get(name);
        if (bucket) bucket.push(entry);
        else supplierMap.set(name, [entry]);
      }
      const suppliers: SupplierGroup[] = [...supplierMap.entries()]
        .map(([supplier, supplierEntries]) => ({
          supplier,
          entries: supplierEntries.sort(
            (a, b) => new Date(b.convertedAt).getTime() - new Date(a.convertedAt).getTime(),
          ),
          errorCount: supplierEntries.filter((e) => e.status === 'error').length,
        }))
        .sort((a, b) => a.supplier.localeCompare(b.supplier, locale));

      result.push({
        key,
        sortTs: Math.max(...entries.map((e) => new Date(e.convertedAt).getTime())),
        suppliers,
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
    if (searchActive) return true;
    if (key in dayOverrides) return dayOverrides[key];
    return index < initialExpandedDays;
  };

  const toggleDay = (index: number, key: string) => {
    setDayOverrides((prev) => {
      const currentlyOpen = key in prev ? prev[key] : index < initialExpandedDays;
      return { ...prev, [key]: !currentlyOpen };
    });
  };

  const supplierId = (dayKey: string, supplier: string) => `${dayKey}::${supplier}`;

  const isSupplierExpanded = (dayKey: string, supplier: string): boolean =>
    searchActive || expandedSuppliers.has(supplierId(dayKey, supplier));

  const toggleSupplier = (dayKey: string, supplier: string) => {
    const id = supplierId(dayKey, supplier);
    setExpandedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openPath = async (path: string) => {
    const ok = await window.electronAPI.openFile(path);
    if (!ok) notify.error(t.fileNotFound);
  };

  const showSkipped = (entry: OdczytyHistoryEntry) => {
    const groups = entry.sources
      .filter((s) => s.skipped && s.skipped.length > 0)
      .map<OdczytySkippedGroup>((s) => ({ fileName: s.fileName, rows: s.skipped }));
    if (groups.length > 0) setSkippedModal(groups);
  };

  const daySummary = (day: DayGroup): string => {
    const parts = [
      plural(day.total, language, ['operacja', 'operacje', 'operacji'], ['operation', 'operations']),
      plural(day.suppliers.length, language, ['dostawca', 'dostawców', 'dostawców'], ['supplier', 'suppliers']),
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
        <div className="empty-state-text">{t.odczytyNoHistory}</div>
      </div>
    );
  }

  return (
    <div className="history-timeline">
      {skippedModal && (
        <OdczytySkippedModal
          language={language}
          groups={skippedModal}
          onClose={() => setSkippedModal(null)}
        />
      )}

      {showSearch && (
        <div className="form-group" style={{ marginBottom: '15px' }}>
          <input
            type="text"
            placeholder={t.odczytySearchHistory}
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
                  {day.suppliers.map((group) => {
                    const groupOpen = isSupplierExpanded(day.key, group.supplier);
                    return (
                      <div
                        className={`history-bank ${groupOpen ? 'is-open' : ''}`}
                        key={group.supplier}
                      >
                        <button
                          type="button"
                          className="history-bank-header"
                          onClick={() => toggleSupplier(day.key, group.supplier)}
                          aria-expanded={groupOpen}
                        >
                          <Icon name={groupOpen ? 'chevron-down' : 'chevron-right'} size={15} />
                          <span className="history-bank-name">{group.supplier}</span>
                          <span className="history-bank-count">
                            {plural(
                              group.entries.length,
                              language,
                              ['operacja', 'operacje', 'operacji'],
                              ['operation', 'operations'],
                            )}
                          </span>
                          {group.errorCount > 0 && (
                            <span className="status-badge status-error history-bank-badge">
                              {plural(
                                group.errorCount,
                                language,
                                ['błąd', 'błędy', 'błędów'],
                                ['error', 'errors'],
                              )}
                            </span>
                          )}
                        </button>

                        {groupOpen && (
                          <div className="history-bank-body">
                            {group.entries.map((entry) => (
                              <div className="odczyty-history-entry" key={entry.id}>
                                <div className="odczyty-history-entry-head">
                                  <span className="history-entry-time">
                                    {new Date(entry.convertedAt).toLocaleTimeString(locale, {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                  <span className="odczyty-history-entry-summary">
                                    {plural(
                                      entry.readingCount,
                                      language,
                                      ['odczyt', 'odczyty', 'odczytów'],
                                      ['reading', 'readings'],
                                    )}
                                    {' · '}
                                    {plural(
                                      entry.outputs.length,
                                      language,
                                      ['plik', 'pliki', 'plików'],
                                      ['file', 'files'],
                                    )}
                                  </span>
                                  <span
                                    className={`status-badge status-${
                                      entry.status === 'success' ? 'success' : 'error'
                                    }`}
                                  >
                                    {entry.status === 'success' ? t.success : t.error}
                                  </span>
                                  {entry.outputDir && (
                                    <button
                                      className="button button-small button-secondary"
                                      onClick={() => openPath(entry.outputDir)}
                                      title={entry.outputDir}
                                    >
                                      <Icon name="folder" size={13} /> {t.openOutputFolder}
                                    </button>
                                  )}
                                </div>

                                <div className="odczyty-history-entry-sources">
                                  {t.odczytyHistorySources}:{' '}
                                  {entry.sources.map((s, i) => (
                                    <React.Fragment key={s.filePath || s.fileName}>
                                      {i > 0 && ', '}
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={() => openPath(s.filePath)}
                                        title={s.filePath}
                                      >
                                        {s.fileName}
                                      </button>
                                    </React.Fragment>
                                  ))}
                                </div>

                                {entry.status === 'error' && entry.errorMessage && (
                                  <div className="history-entry-error">{entry.errorMessage}</div>
                                )}

                                {entry.outputs.length > 0 && (
                                  <table className="odczyty-history-outputs">
                                    <tbody>
                                      {entry.outputs.map((o) => (
                                        <tr key={o.outputPath}>
                                          <td>{o.wm}</td>
                                          <td style={{ wordBreak: 'break-all', opacity: 0.75 }}>
                                            {o.fileName}
                                          </td>
                                          <td style={{ whiteSpace: 'nowrap' }}>{o.date}</td>
                                          <td style={{ whiteSpace: 'nowrap' }}>
                                            {plural(
                                              o.readingCount,
                                              language,
                                              ['odczyt', 'odczyty', 'odczytów'],
                                              ['reading', 'readings'],
                                            )}
                                          </td>
                                          <td style={{ textAlign: 'right' }}>
                                            <button
                                              className="button button-small button-primary"
                                              onClick={() => openPath(o.outputPath)}
                                              title={o.outputPath}
                                            ><Icon name="folder" size={13} />{' '}
                                              {t.openFile}
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}

                                {entry.skippedCount > 0 && (
                                  <div className="odczyty-history-entry-skipped">
                                    <Icon name="alert-triangle" size={13} />{' '}
                                    <button
                                      type="button"
                                      className="link-button"
                                      onClick={() => showSkipped(entry)}
                                    >
                                      {t.odczytySkipped}: {entry.skippedCount} —{' '}
                                      {t.odczytySkippedShowDetails}
                                    </button>
                                  </div>
                                )}
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

export default OdczytyHistoryTimeline;
