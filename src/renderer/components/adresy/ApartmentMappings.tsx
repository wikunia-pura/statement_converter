import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Adres, ApartmentMapping } from '../../../shared/types';
import { translations, Language } from '../../translations';
import { useNotify } from '../Notifications';
import { buildApartmentMapping, mappingTargets } from '../../../shared/apartment-mapping';
import ApartmentTargetsEditor, {
  ApartmentTargetDraft,
  apartmentTargetDrafts,
  apartmentTargetsFromDrafts,
  validateApartmentTargets,
} from '../ApartmentTargetsEditor';
import { FormField, FormSection, RequiredNote } from '../FormSection';
import Icon from '../Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../Modal';

const newMappingId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface ApartmentMappingFormModalProps {
  language: Language;
  /** Mapping being edited, or null when adding a new one. */
  editing: ApartmentMapping | null;
  /** Existing mappings — used to block duplicate matchText. */
  existing: ApartmentMapping[];
  isSaving: boolean;
  onSubmit: (entry: ApartmentMapping) => void;
  onCancel: () => void;
}

/**
 * Standalone add/edit form modal for a single apartment-number rule. Kept
 * separate from the list modal so the two views don't crowd each other.
 */
const ApartmentMappingFormModal: React.FC<ApartmentMappingFormModalProps> = ({
  language,
  editing,
  existing,
  isSaving,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [matchText, setMatchText] = useState(editing?.matchText || '');
  const [targets, setTargets] = useState<ApartmentTargetDraft[]>(
    apartmentTargetDrafts(editing ? mappingTargets(editing) : []),
  );
  const [note, setNote] = useState(editing?.note || '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const mt = matchText.trim();
    if (!mt) {
      setError(t.fillAllFields);
      return;
    }
    const duplicate = existing.some(
      m => m.id !== editing?.id && m.matchText.toLowerCase() === mt.toLowerCase(),
    );
    if (duplicate) {
      setError(t.apartmentMappingDuplicate);
      return;
    }
    const targetsError = validateApartmentTargets(targets, language);
    if (targetsError) {
      setError(targetsError);
      return;
    }
    const mapping = buildApartmentMapping(
      { id: editing?.id || newMappingId(), matchText: mt, note },
      apartmentTargetsFromDrafts(targets),
    );
    if (!mapping) {
      setError(t.fillAllFields);
      return;
    }
    onSubmit(mapping);
  };

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex: 1100 }}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} />
        <ModalHeader
          icon="clipboard"
          title={editing ? t.apartmentMappingEdit : t.addApartmentMapping}
          subtitle={editing ? editing.matchText : undefined}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="search" title={t.apartmentMappingSectionMatch} description={t.apartmentMappingSectionMatchDesc}>
            <FormField label={t.apartmentMappingMatchText} htmlFor="apt-rule-match" required>
              <input
                id="apt-rule-match"
                type="text"
                value={matchText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setMatchText(e.target.value); if (error) setError(null); }}
                placeholder={t.apartmentMappingMatchTextPlaceholder}
                autoFocus
              />
            </FormField>
            <FormField label={t.apartmentMappingNote} htmlFor="apt-rule-note">
              <input
                id="apt-rule-note"
                type="text"
                value={note}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
                placeholder={t.apartmentMappingNotePlaceholder}
              />
            </FormField>
          </FormSection>
          <FormSection icon="home" title={t.apartmentMappingSectionTargets} description={t.apartmentMappingSectionTargetsDesc}>
            <ApartmentTargetsEditor
              language={language}
              drafts={targets}
              onChange={(next) => { setTargets(next); if (error) setError(null); }}
              accountPlaceholder={t.apartmentMappingAccountPlaceholder}
            />
            <div className="form-field__hint">{t.apartmentMappingApartmentsHint}</div>
            <div className="form-field__hint">{t.apartmentMappingAccountHint}</div>
          </FormSection>
          {error && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{error}</div>
            </div>
          )}
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.addApartmentMapping}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={!matchText.trim() || apartmentTargetsFromDrafts(targets).length === 0}
          submitTitle={t.fillAllFields}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

interface ApartmentMappingsEditorProps {
  language: Language;
  mappings: ApartmentMapping[];
  /** Takes the whole new list — saved at once by the rules modal, kept until "Zapisz" by the address form. */
  onChange: (next: ApartmentMapping[]) => boolean | Promise<boolean>;
  isSaving?: boolean;
  error?: string | null;
  /** Inside a larger form: the add button follows the list, quieter than the form's own save. */
  inForm?: boolean;
}

/**
 * An address's apartment-number rules as an editable list. Adding/editing a
 * rule happens in ApartmentMappingFormModal so the list stays readable. Shared
 * by the rules modal on the address list and the address form.
 */
export const ApartmentMappingsEditor: React.FC<ApartmentMappingsEditorProps> = ({
  language,
  mappings,
  onChange,
  isSaving = false,
  error,
  inForm = false,
}) => {
  const t = translations[language];
  const notify = useNotify();
  // null = closed; { editing: null } = add; { editing: <m> } = edit.
  const [formState, setFormState] = useState<{ editing: ApartmentMapping | null } | null>(null);

  const handleFormSubmit = async (entry: ApartmentMapping) => {
    const exists = mappings.some(m => m.id === entry.id);
    const next = exists
      ? mappings.map(m => (m.id === entry.id ? entry : m))
      : [...mappings, entry];
    if (await onChange(next)) setFormState(null);
  };

  const handleDelete = async (m: ApartmentMapping) => {
    if (!(await notify.confirm(t.apartmentMappingConfirmDelete.replace('{name}', m.matchText), { danger: true }))) {
      return;
    }
    await onChange(mappings.filter(x => x.id !== m.id));
  };

  const addButton = (
    <button
      type="button"
      className={inForm ? 'button button-small button-subtle' : 'button button-primary'}
      onClick={() => setFormState({ editing: null })}
      disabled={isSaving}
    >
      <Icon name="plus" size={inForm ? 13 : 14} />{' '}{t.addApartmentMapping}
    </button>
  );

  return (
    <>
      {!inForm && <div className="panel-intro panel-intro--end">{addButton}</div>}

      {error && (
        <div className="callout callout--danger" role="alert">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{error}</div>
        </div>
      )}

      {mappings.length > 0 ? (
        /* One card-row per rule: the phrase (a whole payer name plus address —
           it needs the width, so it gets the row's main line), then the
           apartments it points at, each with its account, and the note. */
        <ul className="record-list">
          {mappings.map((m) => {
            const targets = mappingTargets(m);
            return (
              <li key={m.id} className="record-row record-row--top">
                {/* The apartment leads the row, in a column of its own, so the numbers line up and the long phrase does not push them around. */}
                <div className="record-row__lead">
                  {targets.map((target) => (
                    <span key={target.apartmentNumber} className="apt-chip">
                      <Icon name="home" size={12} />
                      <b>{target.apartmentNumber}</b>
                      {target.kontoLokalu && <span className="apt-chip__account">{target.kontoLokalu}</span>}
                    </span>
                  ))}
                </div>
                <div className="record-row__main">
                  <div className="record-row__title record-row__title--wrap">{m.matchText}</div>
                  {m.note && <div className="record-row__note">{m.note}</div>}
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="button button-small button-secondary"
                    onClick={() => setFormState({ editing: m })}
                    disabled={isSaving}
                  >
                    <Icon name="edit" size={13} />{' '}{t.edit}
                  </button>
                  <button
                    type="button"
                    className="button button-ghost button-icon icon-danger"
                    onClick={() => void handleDelete(m)}
                    disabled={isSaving}
                    aria-label={`${t.delete}: ${m.matchText}`}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="form-empty">
          <Icon name="clipboard" size={16} />
          {t.noApartmentMappings}
        </div>
      )}

      {inForm && <div>{addButton}</div>}

      {/* In the body: inside a form the editor sits in a scrolling modal body. */}
      {formState &&
        createPortal(
          <ApartmentMappingFormModal
            language={language}
            editing={formState.editing}
            existing={mappings}
            isSaving={isSaving}
            onSubmit={(entry) => void handleFormSubmit(entry)}
            onCancel={() => setFormState(null)}
          />,
          document.body,
        )}
    </>
  );
};

interface ApartmentMappingsModalProps {
  adres: Adres;
  language: Language;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Per-address modal listing all apartment-number rules, opened from the
 * address list. Saves through updateAdres (re-sending the address's other fields).
 */
export const ApartmentMappingsModal: React.FC<ApartmentMappingsModalProps> = ({
  adres,
  language,
  onClose,
  onSaved,
}) => {
  const t = translations[language];
  const [mappings, setMappings] = useState<ApartmentMapping[]>(adres.apartmentMappings || []);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const persist = async (next: ApartmentMapping[]) => {
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.updateAdres(
        adres.id,
        adres.nazwa,
        adres.alternativeNames || [],
        adres.swrkIdentifiers || [],
        adres.bankId ?? null,
        adres.accountNumbers || [],
        next,
      );
      setMappings(next);
      onSaved();
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--2xl" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} />
        <ModalHeader icon="clipboard" title={t.apartmentMappingsTitle} subtitle={adres.nazwa} />
        <div className="modal-body modal-body--sectioned">
          <ApartmentMappingsEditor
            language={language}
            mappings={mappings}
            onChange={persist}
            isSaving={isSaving}
            error={error}
          />
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>
    </div>
  );
};
