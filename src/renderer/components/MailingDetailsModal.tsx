import React, { useEffect, useState } from 'react';
import { MailingHistoryEntry, MailingTypDef } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import Icon from './Icon';
import { FormSection } from './FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { buildMailShell, formatFieldValue } from '../../shared/mailing-template';
import { sanitizeHtml } from '../sanitize';
import { MAILING_LOGO_SVG_DATA_URI } from '../../shared/mailing-logo';
import { MailingOdbiorcyList } from './MailingRecipientsEditor';
import { formatDateTime } from '../../shared/format';

/**
 * One send, in full — extracted from the Mailing history so the Kalendarz can
 * open the same window. A mailing recorded against a meeting has to be readable
 * from the meeting; showing it a second, different way would be two answers to
 * one question.
 */

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
  /**
   * Kinds, for the kind's display name. Loaded here rather than passed in: the
   * modal is opened from the history and from the Kalendarz alike, and a row
   * stores only the kind's key. Until they arrive (or for a deleted kind) the
   * key itself is shown.
   */
  const [typy, setTypy] = useState<MailingTypDef[]>([]);

  useEffect(() => {
    let alive = true;
    window.electronAPI
      .mailingGetTypy()
      .then((data) => {
        if (alive) setTypy(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // A partly sent mail: the server refused some recipients (stored as a success — see MailingOdbiorca.odrzucony).
  const odrzuceni = (entry.odbiorcy ?? []).filter((o) => o.odrzucony);

  const openAttachment = async (filePath: string) => {
    const ok = await window.electronAPI.openFile(filePath);
    if (!ok) notify.error(t.mailingFileMissing);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} />
        <ModalHeader
          icon="mail"
          title={t.mailingDetailsTitle}
          subtitle={[entry.adresNazwa, formatDateTime(entry.sentAt, language)].filter(Boolean).join(' · ')}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="mail" title={t.mailingDetailsSectionSend}>
            <dl className="facts">
              <dt>{t.mailingHistorySentAt}</dt>
              <dd>{formatDateTime(entry.sentAt, language)}</dd>
              <dt>{t.mailingType}</dt>
              <dd>{typy.find((k) => k.klucz === entry.typ)?.nazwa ?? entry.typ}</dd>
              <dt>{t.mailingTemplate}</dt>
              <dd>{entry.templateName || '—'}</dd>
              <dt>{t.mailingResultAddress}</dt>
              <dd>{entry.adresNazwa || '—'}</dd>
              <dt>{t.mailingHistoryFrom}</dt>
              <dd>{entry.sentFrom || '—'}</dd>
              <dt>{t.mailingResultStatus}</dt>
              <dd>
                {entry.status === 'success' && odrzuceni.length > 0 ? (
                  <span className="status-badge status-pending">{t.mailingStatusPartial}</span>
                ) : entry.status === 'success' ? (
                  <span className="result-status is-ok">
                    <Icon name="check-circle" size={14} /> {t.mailingStatusSent}
                  </span>
                ) : (
                  <span className="result-status is-error">
                    <Icon name="x-circle" size={14} /> {entry.errorMessage ?? t.mailingStatusError}
                  </span>
                )}
                {entry.status === 'success' && entry.errorMessage && (
                  <div className="form-field__error">{entry.errorMessage}</div>
                )}
              </dd>
            </dl>
          </FormSection>

          <FormSection icon="users" title={t.mailingResultRecipient}>
            {odrzuceni.length > 0 && (
              <div className="callout callout--warning">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">
                  {t.mailingRejectedCallout.replace('{list}', odrzuceni.map((o) => o.email).join(', '))}
                </div>
              </div>
            )}
            {/* Rows written since kinds have recipients list every addressee
                with its group; older rows only know the one city unit. */}
            {entry.odbiorcy && entry.odbiorcy.length > 0 ? (
              <MailingOdbiorcyList language={language} odbiorcy={entry.odbiorcy} showGroup />
            ) : (
              <div>
                {entry.jednostkaNazwa || '—'}
                {entry.jednostkaEmail && <div className="form-table__sub">{entry.jednostkaEmail}</div>}
              </div>
            )}
          </FormSection>

          <FormSection icon="file-text" title={t.mailingDetailsSectionContent}>
            <dl className="facts">
              <dt>{t.mailingSubject}</dt>
              <dd>{entry.subject || '—'}</dd>
            </dl>
            <div
              className="mailing-preview"
              // Stored body of a sent message, with the letterhead re-added so the
              // record looks like what went out. The row is shared data, so the
              // body is sanitized; the shell around it is our own constant markup.
              dangerouslySetInnerHTML={{
                __html: buildMailShell(sanitizeHtml(entry.bodyHtml), MAILING_LOGO_SVG_DATA_URI),
              }}
            />
          </FormSection>

          {entry.fieldValues.length > 0 && (
            <FormSection icon="edit" title={t.mailingValuesTitle}>
              <table className="form-table">
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
                      <td className="form-table__label">{f.nazwa}</td>
                      <td>{f.tekst || <span className="cell-empty">—</span>}</td>
                      {/* With the unit, exactly as the sent letter read it. */}
                      <td>{formatFieldValue(f.wartosc, f) || <span className="cell-empty">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </FormSection>
          )}

          <FormSection icon="paperclip" title={t.mailingAttachmentsTitle}>
            {entry.attachments.length > 0 ? (
              <div className="file-list">
                {entry.attachments.map((a) => (
                  <div key={a.filePath} className="file-list__row">
                    <Icon name={a.kind === 'pdf' ? 'file-text' : 'paperclip'} size={14} />
                    <button
                      type="button"
                      className="file-list__name file-list__name--link"
                      onClick={() => openAttachment(a.filePath)}
                      data-tip={a.filePath}
                    >
                      {a.fileName}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="form-empty">
                <Icon name="paperclip" size={16} />
                {t.mailingNoAttachments}
              </div>
            )}
          </FormSection>
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>
    </div>
  );
};

export default MailingDetailsModal;
