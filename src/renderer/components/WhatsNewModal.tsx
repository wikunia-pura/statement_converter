import React from 'react';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss from './Modal';
import ReleaseNotesBody from './ReleaseNotes';
import { Release } from '../../shared/release-notes';

interface WhatsNewModalProps {
  release: Release;
  language: Language;
  /** Dismiss and remember this version as read. */
  onClose: () => void;
  /** Dismiss, remember, and open the full "Co nowego" view. */
  onOpenFullView: () => void;
}

/**
 * Shown once after an update (and on the very first run): the same release
 * notes as the "Co nowego" view, wrapped in a modal the user has to close.
 * Closing — by button, X or Escape — is what marks the version as read.
 */
const WhatsNewModal: React.FC<WhatsNewModalProps> = ({
  release,
  language,
  onClose,
  onOpenFullView,
}) => {
  const t = translations[language];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal wn-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.whatsNewModalTitle}
      >
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <div className="modal-header wn-modal__header">
          <Icon name="sparkles" size={18} /> {t.whatsNewModalTitle}
        </div>
        <div className="modal-body wn-modal__body">
          <p className="wn-modal__intro">{t.whatsNewModalIntro}</p>
          <ReleaseNotesBody release={release} language={language} compactHero />
        </div>
        <div className="modal-footer">
          <button type="button" className="button button-secondary" onClick={onOpenFullView}>
            <Icon name="file-text" size={14} />{' '}{t.whatsNewSeeAll}
          </button>
          <button type="button" className="button button-primary" onClick={onClose}>
            <Icon name="check" size={14} />{' '}{t.whatsNewGotIt}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhatsNewModal;
