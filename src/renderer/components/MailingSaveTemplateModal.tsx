import React, { useEffect, useState } from 'react';
import { MailingSzablon, MailingTyp } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import { FormField, FormSection, RequiredNote } from './FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import Icon from './Icon';

/**
 * "Zapisz jako szablon": keep the text edited for one letter as a template —
 * overwriting the template it came from, or as a new template of the same kind.
 *
 * CONTRACT (stable — the Mailing send screen and the Zebrania notice editor both
 * use it): the modal does the IPC save itself (mailingUpdateSzablon /
 * mailingAddSzablon) and reports the stored template through `onSaved`.
 */
export interface MailingSaveTemplateModalProps {
  language: Language;
  open: boolean;
  onClose: () => void;
  typ: MailingTyp;
  temat: string;
  tresc: string;
  attachPdf: boolean;
  tableFields: string[];
  /** The template the text was loaded from — offered for overwriting. Null ⇒ only "new". */
  sourceTemplate: MailingSzablon | null;
  onSaved: (saved: MailingSzablon, mode: 'overwrite' | 'new') => void;
}

type SaveMode = 'overwrite' | 'new';

/**
 * Two choices, as two large cards rather than a pair of radio dots: the person
 * using this is often not someone who thinks in "templates" at all, and the one
 * thing that must not happen by accident — replacing a template the whole office
 * sends from — has to read as a deliberate choice with its consequence spelled
 * out next to it.
 *
 * "New" is the default even when a source exists. It is the choice that cannot
 * lose anything; overwriting is one click away and says what it does.
 */
const MailingSaveTemplateModal: React.FC<MailingSaveTemplateModalProps> = ({
  language,
  open,
  onClose,
  typ,
  temat,
  tresc,
  attachPdf,
  tableFields,
  sourceTemplate,
  onSaved,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [mode, setMode] = useState<SaveMode>('new');
  const [nazwa, setNazwa] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Fresh state every time the modal opens: a name typed for an earlier save (or
  // the overwrite choice) carried over silently is exactly the kind of leftover
  // that ends in a template overwritten by mistake.
  useEffect(() => {
    if (!open) return;
    setMode('new');
    setNazwa(
      sourceTemplate
        ? `${sourceTemplate.nazwa} ${t.mailingSaveTplCopySuffix}`
        : t.mailingSaveTplDefaultName,
    );
    setError(null);
    setIsSaving(false);
  }, [open, sourceTemplate, t]);

  if (!open) return null;

  const close = () => {
    if (!isSaving) onClose();
  };

  const handleSave = async () => {
    if (!temat.trim()) {
      setError(t.mailingTemplateSubjectRequired);
      return;
    }
    const effectiveMode: SaveMode = mode === 'overwrite' && sourceTemplate ? 'overwrite' : 'new';
    const name = effectiveMode === 'overwrite' ? sourceTemplate!.nazwa : nazwa.trim();
    if (!name) {
      setError(t.mailingTemplateNameRequired);
      return;
    }
    const data: Omit<MailingSzablon, 'id' | 'createdAt'> = {
      nazwa: name,
      typ,
      temat,
      tresc,
      attachPdf,
      tableFields,
    };
    setIsSaving(true);
    setError(null);
    try {
      if (effectiveMode === 'overwrite' && sourceTemplate) {
        await window.electronAPI.mailingUpdateSzablon(sourceTemplate.id, data);
        notify.success(t.mailingSaveTplSavedOverwrite.replace('{name}', name));
        onSaved({ ...sourceTemplate, ...data }, 'overwrite');
      } else {
        const saved = await window.electronAPI.mailingAddSzablon(data);
        notify.success(t.mailingSaveTplSavedNew.replace('{name}', saved.nazwa));
        onSaved(saved, 'new');
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(message ? `${t.mailingSaveTplError} ${message}` : t.mailingSaveTplError);
    } finally {
      setIsSaving(false);
    }
  };

  const overwriting = mode === 'overwrite' && !!sourceTemplate;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={close} ariaLabel={t.close} />
        <ModalHeader icon="save" title={t.mailingSaveTplTitle} subtitle={t.mailingSaveTplIntro} />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="file-text" title={t.mailingSaveTplSection}>
            <div className="mailing-save-tpl__choices" role="radiogroup" aria-label={t.mailingSaveTplTitle}>
              {sourceTemplate && (
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === 'overwrite'}
                  className={`mailing-save-tpl__choice${mode === 'overwrite' ? ' is-active' : ''}`}
                  onClick={() => {
                    setMode('overwrite');
                    setError(null);
                  }}
                  disabled={isSaving}
                >
                  <span className="mailing-save-tpl__choice-title">
                    <Icon name="refresh" size={15} />
                    {t.mailingSaveTplOverwrite.replace('{name}', sourceTemplate.nazwa)}
                  </span>
                  <span className="mailing-save-tpl__choice-hint">{t.mailingSaveTplOverwriteHint}</span>
                </button>
              )}
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'new'}
                className={`mailing-save-tpl__choice${mode === 'new' ? ' is-active' : ''}`}
                onClick={() => {
                  setMode('new');
                  setError(null);
                }}
                disabled={isSaving}
              >
                <span className="mailing-save-tpl__choice-title">
                  <Icon name="plus" size={15} />
                  {t.mailingSaveTplNew}
                </span>
                <span className="mailing-save-tpl__choice-hint">
                  {sourceTemplate ? t.mailingSaveTplNewHint : t.mailingSaveTplNewHintNoSource}
                </span>
              </button>
            </div>

            {mode === 'new' && (
              <FormField label={t.mailingSaveTplName} htmlFor="save-tpl-name" required>
                <input
                  id="save-tpl-name"
                  type="text"
                  value={nazwa}
                  onChange={(e) => {
                    setNazwa(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleSave();
                    }
                  }}
                  autoFocus
                  disabled={isSaving}
                />
              </FormField>
            )}

            {/* Said in so many words, right above the button: the old wording is
                gone for everyone once this is confirmed. */}
            {overwriting && (
              <div className="callout callout--warning" role="status">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">
                  {t.mailingSaveTplOverwriteWarning.replace('{name}', sourceTemplate!.nazwa)}
                </div>
              </div>
            )}

            {error && (
              <div className="callout callout--danger" role="alert">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">{error}</div>
              </div>
            )}
          </FormSection>
        </div>
        <ModalFooter
          note={mode === 'new' ? <RequiredNote label={t.formRequiredNote} /> : undefined}
          onCancel={close}
          cancelLabel={t.cancel}
          onSubmit={() => void handleSave()}
          submitLabel={
            isSaving
              ? t.mailingSaveTplSaving
              : overwriting
                ? t.mailingSaveTplConfirmOverwrite
                : t.mailingSaveTplConfirmNew
          }
          submitIcon="save"
          submitTone={overwriting ? 'danger' : 'success'}
          submitDisabled={mode === 'new' && !nazwa.trim()}
          submitTitle={t.mailingTemplateNameRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

export default MailingSaveTemplateModal;
