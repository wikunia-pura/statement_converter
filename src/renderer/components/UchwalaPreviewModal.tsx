import React, { useMemo } from 'react';
import { MailingPole, ZebranieMaterial } from '../../shared/types';
import { ZebranieDane, uchwalaMissing, uchwalaTytul } from '../../shared/zebrania';
import { buildKalendarzContext } from '../../shared/mailing-template';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import Icon from './Icon';
import MailingVisualEditor from './MailingVisualEditor';

/**
 * A resolution as it will print: the template's text with the meeting's data
 * and the typed values in it, read-only. Built from the same rendering as the
 * editor and the PDF, so what is previewed is what is downloaded.
 */
const UchwalaPreviewModal: React.FC<{
  language: Language;
  locale: string;
  uchwala: ZebranieMaterial;
  lp: number;
  dane: ZebranieDane;
  pola: MailingPole[];
  onEdit: () => void;
  onClose: () => void;
}> = ({ language, locale, uchwala, lp, dane, pola, onEdit, onClose }) => {
  const t = translations[language];
  const kalendarz = useMemo(() => buildKalendarzContext(dane), [dane]);
  const missing = useMemo(() => uchwalaMissing(uchwala, dane, pola), [uchwala, dane, pola]);
  const noop = () => undefined;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--xl uch-preview" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon="eye"
          title={`${t.uchPreviewTitle} · ${lp}`}
          subtitle={uchwalaTytul(uchwala, dane, pola)}
        />
        <div className="modal-body uch-preview__body">
          {missing.length > 0 && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                {t.uchMissingFields.replace('{fields}', missing.join(', '))} {t.uchPreviewHint}
              </div>
            </div>
          )}
          <MailingVisualEditor
            language={language}
            temat={uchwala.temat}
            tresc={uchwala.tresc}
            onTrescChange={noop}
            values={uchwala.values}
            onValuesChange={noop}
            pola={pola}
            adresNazwa={dane.adresNazwa}
            kalendarz={kalendarz}
            tableFields={uchwala.tableFields}
            readOnly
            hideHint
          />
        </div>
        <ModalFooter
          note={
            <span className="zeb-muted">
              {uchwala.updatedAt
                ? t.uchChanged.replace('{when}', formatStamp(uchwala.updatedAt, locale)).replace('{who}', uchwala.updatedBy || '—')
                : ''}
            </span>
          }
          onCancel={onClose}
          cancelLabel={t.close}
          onSubmit={onEdit}
          submitLabel={t.uchEdit}
          submitIcon="edit"
          submitTone="success"
        />
      </div>
    </div>
  );
};

export default UchwalaPreviewModal;
