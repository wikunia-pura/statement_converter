import React, { useEffect, useMemo, useState } from 'react';
import { MailingHistoryEntry } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import MailingDetailsModal, { formatDateTime } from '../components/MailingDetailsModal';

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
      const [historyData, info] = await Promise.all([
        window.electronAPI.mailingGetHistory(),
        window.electronAPI.mailingGetFilesInfo(),
      ]);
      setHistory(historyData);
      setFilesInfo(info);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) =>
      [h.adresNazwa, h.jednostkaNazwa, h.jednostkaEmail, h.subject, h.templateName, h.bodyText]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [history, search]);

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
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ margin: 0 }}>{t.mailingHistoryTitle}</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {filesInfo.fileCount > 0 && (
              <button className="button button-secondary" onClick={handleCleanupFiles}>
                {t.mailingCleanupFiles} ({filesInfo.fileCount} · {formatBytes(filesInfo.totalBytes)})
              </button>
            )}
            {history.length > 0 && (
              <button className="button button-danger" onClick={handleClearHistory}>
                {t.mailingClearHistory}
              </button>
            )}
          </div>
        </div>

        {filesInfo.fileCount > 0 && (
          <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '12px' }}>
            {t.mailingFilesLocation.replace('{dir}', filesInfo.dir)}
          </div>
        )}

        {history.length > 0 && (
          <div className="form-group" style={{ marginBottom: '15px' }}>
            <input
              type="text"
              placeholder={t.mailingSearchHistory}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {history.length > 0 ? (
          <>
            <div style={{ marginBottom: '10px', fontSize: '14px', opacity: 0.7 }}>
              {filtered.length} / {history.length}
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t.mailingHistorySentAt}</th>
                  <th>{t.mailingResultAddress}</th>
                  <th>{t.mailingResultRecipient}</th>
                  <th>{t.mailingSubject}</th>
                  <th>{t.mailingResultAttachments}</th>
                  <th>{t.mailingResultStatus}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((h) => (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(h.sentAt, language)}</td>
                    <td>{h.adresNazwa || '—'}</td>
                    <td style={{ fontSize: '12px' }}>
                      <div>{h.jednostkaNazwa || '—'}</div>
                      {h.jednostkaEmail && (
                        <div style={{ opacity: 0.7, wordBreak: 'break-all' }}>{h.jednostkaEmail}</div>
                      )}
                    </td>
                    <td style={{ fontSize: '12px' }}>{h.subject || '—'}</td>
                    <td style={{ fontSize: '12px' }}>{h.attachments.length || '—'}</td>
                    <td>
                      {h.status === 'success' ? (
                        <span style={{ color: 'var(--success)' }}>
                          <Icon name="check-circle" size={14} /> {t.mailingStatusSent}
                        </span>
                      ) : (
                        <span
                          style={{ color: 'var(--danger)', fontSize: '12px' }}
                          title={h.errorMessage}
                        >
                          <Icon name="x-circle" size={14} /> {t.mailingStatusError}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="button button-small button-primary"
                        onClick={() => setDetails(h)}
                      >
                        {t.mailingShowDetails}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="empty-state">{t.mailingNoHistory}</div>
        )}
      </div>

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
