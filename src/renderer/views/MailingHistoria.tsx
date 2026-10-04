import React, { useEffect, useMemo, useState } from 'react';
import { MailingHistoryEntry, MailingTypDef } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import MailingDetailsModal, { formatDateTime } from '../components/MailingDetailsModal';
import { MailingOdbiorcyList } from '../components/MailingRecipientsEditor';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  language: Language;
}

/** History of the Mailing module — one row per (send, community). */
const MailingHistoria: React.FC<Props> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [history, setHistory] = useState<MailingHistoryEntry[]>([]);
  /** Kinds, to show a row's kind by name — the row stores only its key. */
  const [typy, setTypy] = useState<MailingTypDef[]>([]);
  const [filesInfo, setFilesInfo] = useState<{ dir: string; fileCount: number; totalBytes: number }>(
    { dir: '', fileCount: 0, totalBytes: 0 },
  );
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [details, setDetails] = useState<MailingHistoryEntry | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setIsLoading(true);
    try {
      const [historyData, info, typyData] = await Promise.all([
        window.electronAPI.mailingGetHistory(),
        window.electronAPI.mailingGetFilesInfo(),
        // A failure here only costs the kind names; the history still shows.
        window.electronAPI.mailingGetTypy().catch(() => [] as MailingTypDef[]),
      ]);
      setHistory(historyData);
      setFilesInfo(info);
      setTypy(typyData);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (!(await notify.confirm(t.mailingConfirmClearHistory, { danger: true }))) return;
    await window.electronAPI.mailingClearHistory();
    await load();
  };

  const handleCleanupFiles = async () => {
    const message = t.mailingConfirmCleanupFiles
      .replace('{count}', String(filesInfo.fileCount))
      .replace('{size}', formatBytes(filesInfo.totalBytes));
    if (!(await notify.confirm(message, { danger: true }))) return;
    const result = await window.electronAPI.mailingCleanupFiles();
    if (result.error) {
      notify.error(`${t.mailingCleanupError}: ${result.error}`);
      return;
    }
    notify.success(
      t.mailingCleanupDone
        .replace('{count}', String(result.removedFiles ?? 0))
        .replace('{size}', formatBytes(result.freedBytes ?? 0)),
    );
    await load();
  };

  /** Kind name by key; a deleted kind falls back to its key. */
  const typName = useMemo(() => {
    const byKey = new Map(typy.map((k) => [k.klucz, k.nazwa]));
    return (typ: string) => byKey.get(typ) ?? typ;
  }, [typy]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) =>
      [
        h.adresNazwa,
        h.jednostkaNazwa,
        h.jednostkaEmail,
        h.subject,
        h.templateName,
        h.bodyText,
        typName(h.typ),
        ...(h.odbiorcy ?? []).map((o) => `${o.nazwa} ${o.email}`),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [history, search, typName]);

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
        title={t.mailingHistoryTitle}
        description={t.mailingHistoryDesc}
        aside={
          <div className="form-section__actions">
            {/* Clearing is demoted: never the loudest button next to everyday actions. */}
            {history.length > 0 && (
              <button className="button button-ghost icon-danger" onClick={handleClearHistory}>
                <Icon name="trash" size={14} /> {t.mailingClearHistory}
              </button>
            )}
            {filesInfo.fileCount > 0 && (
              <button
                className="button button-secondary"
                onClick={handleCleanupFiles}
                title={t.mailingFilesLocation.replace('{dir}', filesInfo.dir)}
              >
                <Icon name="paperclip" size={14} /> {t.mailingCleanupFiles} ({filesInfo.fileCount} · {formatBytes(filesInfo.totalBytes)})
              </button>
            )}
          </div>
        }
      >
        {history.length > 0 ? (
          <>
            <div className="list-filter">
              <div className="input-icon">
                <Icon name="search" size={15} />
                <input
                  type="text"
                  placeholder={t.mailingSearchHistory}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t.mailingSearchHistory}
                />
              </div>
              <span className="list-filter__count">
                {t.mailingHistoryCount}: <strong>{filtered.length}</strong> / {history.length}
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.mailingHistorySentAt}</th>
                  <th>{t.mailingResultAddress}</th>
                  <th>{t.mailingResultRecipient}</th>
                  <th>{t.mailingSubject}</th>
                  <th>{t.mailingResultAttachments}</th>
                  <th>{t.mailingResultStatus}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => (
                  <tr key={h.id}>
                    <td className="nowrap">{formatDateTime(h.sentAt, language)}</td>
                    <td>{h.adresNazwa ? <span className="cell-title">{h.adresNazwa}</span> : <span className="cell-empty">—</span>}</td>
                    <td className="form-table__sub">
                      {/* Older rows carry only the one city unit, not the list. */}
                      {h.odbiorcy && h.odbiorcy.length > 0 ? (
                        <MailingOdbiorcyList language={language} odbiorcy={h.odbiorcy} limit={3} />
                      ) : (
                        <>
                          <div>{h.jednostkaNazwa || '—'}</div>
                          {h.jednostkaEmail && <div>{h.jednostkaEmail}</div>}
                        </>
                      )}
                    </td>
                    <td>
                      <div>{h.subject || <span className="cell-empty">—</span>}</div>
                      <div className="form-table__sub">{typName(h.typ)}</div>
                    </td>
                    <td>
                      {h.attachments.length > 0 ? (
                        <span className="cell-icon-count" title={h.attachments.map((a) => a.fileName).join('\n')}>
                          <Icon name="paperclip" size={13} /> {h.attachments.length}
                        </span>
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td>
                      {h.status === 'success' ? (
                        <span className="result-status is-ok">
                          <Icon name="check-circle" size={14} /> {t.mailingStatusSent}
                        </span>
                      ) : (
                        <span className="result-status is-error" title={h.errorMessage}>
                          <Icon name="x-circle" size={14} /> {t.mailingStatusError}
                        </span>
                      )}
                    </td>
                    <td className="data-table__actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() => setDetails(h)}
                        >
                          <Icon name="eye" size={13} /> {t.mailingShowDetails}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="form-empty">
            <Icon name="history" size={16} />
            {t.mailingNoHistory}
          </div>
        )}
      </FormSection>

      {details && (
        <MailingDetailsModal
          entry={details}
          language={language}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
};

export default MailingHistoria;
