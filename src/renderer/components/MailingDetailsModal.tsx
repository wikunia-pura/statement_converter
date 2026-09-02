import React from 'react';
import { MailingHistoryEntry } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import Icon from './Icon';
import ModalDismiss from './Modal';
import { buildMailShell, formatFieldValue } from '../../shared/mailing-template';
import { MAILING_LOGO_SVG_DATA_URI } from '../../shared/mailing-logo';
import { MAILING_TYPE_OPTIONS } from '../views/Mailing';

/**
 * One send, in full — extracted from the Mailing history so the Kalendarz can
 * open the same window. A mailing recorded against a meeting has to be readable
 * from the meeting; showing it a second, different way would be two answers to
 * one question.
 */

/** Shared with the history table, hence exported rather than duplicated. */
export function formatDateTime(iso: string, language: Language): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(language === 'pl' ? 'pl-PL' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface DetailsModalProps {
  entry: MailingHistoryEntry;
  language: Language;
  onClose: () => void;
}

/**
 * Everything that went out for one community: the subject and body exactly as
 * sent, the field values behind them, and links to the attachment files.
 */
const MailingDetailsModal: React.FC<DetailsModalProps> = ({ entry, language, onClose }) => {
  const t = translations[language];
  const notify = useNotify();

  const openAttachment = async (filePath: string) => {
    const ok = await window.electronAPI.openFile(filePath);
    if (!ok) notify.error(t.mailingFileMissing);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <ModalDismiss onClose={onClose} />
        <div className="modal-header">{t.mailingDetailsTitle}</div>
        <div className="modal-body">
          <table style={{ marginBottom: '18px' }}>
            <tbody>
              <tr>
                <th style={{ width: '32%' }}>{t.mailingHistorySentAt}</th>
                <td>{formatDateTime(entry.sentAt, language)}</td>
              </tr>
              <tr>
                <th>{t.mailingType}</th>
                <td>
                  {MAILING_TYPE_OPTIONS.find((o) => o.value === entry.typ)?.label ?? entry.typ}
                </td>
              </tr>
              <tr>
                <th>{t.mailingTemplate}</th>
                <td>{entry.templateName || '—'}</td>
              </tr>
              <tr>
                <th>{t.mailingResultAddress}</th>
                <td>{entry.adresNazwa || '—'}</td>
              </tr>
              <tr>
                <th>{t.mailingResultRecipient}</th>
                <td>
                  {entry.jednostkaNazwa || '—'}
                  {entry.jednostkaEmail && (
                    <div style={{ opacity: 0.7, fontSize: '12px' }}>{entry.jednostkaEmail}</div>
                  )}
                </td>
              </tr>
              <tr>
                <th>{t.mailingHistoryFrom}</th>
                <td>{entry.sentFrom || '—'}</td>
              </tr>
              <tr>
                <th>{t.mailingResultStatus}</th>
                <td>
                  {entry.status === 'success' ? (
                    <span style={{ color: 'var(--success)' }}>{t.mailingStatusSent}</span>
                  ) : (
                    <span style={{ color: 'var(--danger)' }}>
                      {entry.errorMessage ?? t.mailingStatusError}
                    </span>
                  )}
                  {entry.status === 'success' && entry.errorMessage && (
                    <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '4px' }}>
                      {entry.errorMessage}
                    </div>
                  )}
                </td>
              </tr>
              <tr>
                <th>{t.mailingSubject}</th>
                <td>{entry.subject || '—'}</td>
              </tr>
            </tbody>
          </table>

          {entry.fieldValues.length > 0 && (
            <>
              <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>{t.mailingValuesTitle}</h3>
              <table style={{ marginBottom: '18px' }}>
                <thead>
                  <tr>
                    <th>{t.mailingFieldName}</th>
                    <th>{t.mailingFieldText}</th>
                    <th>{t.mailingFieldValue}</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.fieldValues.map((f) => (
                    <tr key={f.nazwa}>
                      <td>{f.nazwa}</td>
                      <td>{f.tekst || '—'}</td>
                      {/* With the unit, exactly as the sent letter read it. */}
                      <td>{formatFieldValue(f.wartosc, f) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>{t.mailingBody}</h3>
          <div
            className="mailing-preview"
            style={{ marginBottom: '18px' }}
            // Stored body of a message this user composed and already sent, with
            // the letterhead re-added so the record looks like what went out.
            dangerouslySetInnerHTML={{
              __html: buildMailShell(entry.bodyHtml, MAILING_LOGO_SVG_DATA_URI),
            }}
          />

          <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>{t.mailingAttachmentsTitle}</h3>
          {entry.attachments.length > 0 ? (
            <div>
              {entry.attachments.map((a) => (
                <div
                  key={a.filePath}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}
                >
                  <Icon name={a.kind === 'pdf' ? 'file-text' : 'clipboard'} size={14} />
                  <button
                    className="button button-small button-secondary"
                    onClick={() => openAttachment(a.filePath)}
                    title={a.filePath}
                  >
                    {a.fileName}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '13px', opacity: 0.7 }}>{t.mailingNoAttachments}</div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MailingDetailsModal;
