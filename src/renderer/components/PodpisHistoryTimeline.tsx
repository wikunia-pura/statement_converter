import React, { useMemo, useState } from 'react';
import { PodpisHistoriaEntry, PodpisHistoriaPlik } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import Icon from './Icon';
import { plural } from '../plural';

interface Props {
  history: PodpisHistoriaEntry[];
  language: Language;
}

/** Local YYYY-MM-DD key for grouping, independent of timezone printing quirks. */
function dayKeyOf(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface DayGroup {
  key: string;
  sortTs: number;
  entries: PodpisHistoriaEntry[];
  podpisanych: number;
}

const STATUS_CLASS: Record<PodpisHistoriaPlik['status'], string> = {
  podpisany: 'status-success',
  pominiety: 'status-error',
  niepodpisany: 'status-pending',
};

/**
 * History of the Podpis module, grouped by day. One entry is one run of "Podpisz
 * zaznaczone" — one PIN, one certificate — and expands to the files it handled:
 * the original and the signed copy each open in place, the ones that were not
 * signed with the reason.
 */
const PodpisHistoryTimeline: React.FC<Props> = ({ history, language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [searchTerm, setSearchTerm] = useState('');
  const [dayOverrides, setDayOverrides] = useState<Record<string, boolean>>({});

  const locale = language === 'en' ? 'en-US' : 'pl-PL';
  const searchActive = searchTerm.trim().length > 0;

  const statusLabel: Record<PodpisHistoriaPlik['status'], string> = {
    podpisany: t.podSumSigned,
    pominiety: t.podSumSkipped,
    niepodpisany: t.podSumUnsigned,
  };

  const filtered = useMemo(() => {
    const terms = searchTerm.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return history;
    return history.filter((entry) => {
      const haystack = [
        entry.signedBy,
        entry.podpis?.podmiot,
        entry.podpis?.wystawca,
        entry.podpis?.numerSeryjny,
        entry.przerwano,
        ...entry.pliki.flatMap((p) => [p.nazwa, p.zrodlo, p.wynik, p.powod]),
        new Date(entry.signedAt).toLocaleString(locale),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [history, searchTerm, locale]);

  const days = useMemo<DayGroup[]>(() => {
    const dayMap = new Map<string, PodpisHistoriaEntry[]>();
    for (const entry of filtered) {
      const key = dayKeyOf(entry.signedAt);
      const bucket = dayMap.get(key);
      if (bucket) bucket.push(entry);
      else dayMap.set(key, [entry]);
    }
    return [...dayMap.entries()]
      .map(([key, entries]) => ({
        key,
        sortTs: Math.max(...entries.map((e) => new Date(e.signedAt).getTime())),
        entries: entries.sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime()),
        podpisanych: entries.reduce((sum, e) => sum + e.podpisanych, 0),
      }))
      .sort((a, b) => b.sortTs - a.sortTs);
  }, [filtered]);

  const todayKey = dayKeyOf(new Date());
  const yesterdayKey = useMemo(() => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return dayKeyOf(y);
  }, []);

  const dayLabel = (key: string, ts: number): string => {
    const formatted = new Date(ts).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (key === todayKey) return `${t.today} · ${formatted}`;
    if (key === yesterdayKey) return `${t.yesterday} · ${formatted}`;
    return formatted;
  };

  // The latest day starts open: it is what somebody comes to the tab to check.
  const isOpen = (index: number, key: string): boolean => searchActive || (key in dayOverrides ? dayOverrides[key] : index === 0);

  const toggleDay = (index: number, key: string) =>
    setDayOverrides((prev) => ({ ...prev, [key]: !(key in prev ? prev[key] : index === 0) }));

  const openPath = async (p: string) => {
    if (!(await window.electronAPI.openFile(p))) notify.error(t.fileNotFound);
  };

  if (history.length === 0) {
    return (
      <div className="form-empty">
        <Icon name="history" size={16} />
        {t.podpisPdfNoHistory}
      </div>
    );
  }

  return (
    <div className="history-timeline">
      <div className="list-filter">
        <div className="input-icon">
          <Icon name="search" size={15} />
          <input
            type="text"
            placeholder={t.podpisPdfSearchHistory}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label={t.podpisPdfSearchHistory}
          />
        </div>
      </div>

      {days.length === 0 ? (
        <div className="form-empty">
          <Icon name="search" size={16} />
          {t.noHistoryResults}
        </div>
      ) : (
        days.map((day, dayIndex) => {
          const expanded = isOpen(dayIndex, day.key);
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
                  {plural(day.podpisanych, language, ['podpisany plik', 'podpisane pliki', 'podpisanych plików'], ['signed file', 'signed files'])}
                </span>
              </button>

              {expanded && (
                <div className="history-day-body">
                  {day.entries.map((entry) => (
                    <div className="odczyty-history-entry" key={entry.id}>
                      <div className="odczyty-history-entry-head">
                        <span className="history-entry-time">
                          {new Date(entry.signedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="odczyty-history-entry-summary">
                          {entry.podpis ? t.podpisPdfHistoryCert.replace('{kto}', entry.podpis.podmiot) : '—'}
                          {entry.podpis?.wystawca && ` · ${t.podpisPdfHistoryIssuer.replace('{issuer}', entry.podpis.wystawca)}`}
                          {' · '}
                          {plural(entry.podpisanych, language, ['plik', 'pliki', 'plików'], ['file', 'files'])}
                        </span>
                        <span className={`status-badge ${entry.podpisanych > 0 ? 'status-success' : 'status-error'}`}>
                          {entry.podpisanych === entry.pliki.length ? t.success : `${entry.podpisanych}/${entry.pliki.length}`}
                        </span>
                      </div>
                      {entry.signedBy && <div className="odczyty-history-entry-sources">{t.podpisPdfHistoryBy.replace('{kto}', entry.signedBy)}</div>}
                      {entry.przerwano && (
                        <div className="history-entry-error">{t.podpisPdfHistoryStopped.replace('{reason}', entry.przerwano)}</div>
                      )}
                      <table className="odczyty-history-outputs">
                        <tbody>
                          {entry.pliki.map((p) => (
                            <tr key={p.zrodlo + p.wynik}>
                              <td className="cell-wrap form-table__label">
                                {p.nazwa}
                                {p.powod && <div className="cell-warning is-danger cell-wrap">{p.powod}</div>}
                              </td>
                              <td className="nowrap">
                                <span className={`status-badge ${STATUS_CLASS[p.status]}`}>{statusLabel[p.status]}</span>
                              </td>
                              <td className="data-table__actions">
                                <div className="row-actions">
                                  <button
                                    type="button"
                                    className="button button-small button-subtle"
                                    onClick={() => void openPath(p.zrodlo)}
                                    title={p.zrodlo}
                                  >
                                    <Icon name="file-text" size={13} /> {t.podpisPdfHistoryOriginal}
                                  </button>
                                  {p.wynik && (
                                    <button
                                      type="button"
                                      className="button button-small button-secondary"
                                      onClick={() => void openPath(p.wynik)}
                                      title={p.wynik}
                                    >
                                      <Icon name="signature" size={13} /> {t.podpisPdfHistorySigned}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default PodpisHistoryTimeline;
