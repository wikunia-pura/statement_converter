import React from 'react';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
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
        className="modal modal--xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.whatsNewModalTitle}
      >
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon="sparkles" title={t.whatsNewModalTitle} subtitle={t.whatsNewModalIntro} />
        <div className="modal-body wn-modal__body">
          <ReleaseNotesBody release={release} language={language} compactHero />
        </div>
        <ModalFooter
          note={
            <button type="button" className="button button-small button-subtle" onClick={onOpenFullView}>
              <Icon name="file-text" size={13} /> {t.whatsNewSeeAll}
            </button>
          }
          onCancel={onClose}
          cancelLabel={t.whatsNewGotIt}
          autoFocus="cancel"
        />
      </div>
    </div>
  );
};

export default WhatsNewModal;
