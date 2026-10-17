import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Adres, ZarzadOsoba } from '../../../shared/types';
import { translations, Language } from '../../translations';
import { useNotify } from '../Notifications';
import { FormField, FormRow, FormSection, RequiredNote } from '../FormSection';
import Icon from '../Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../Modal';
import { ipcErrorMessage } from '../../ipcError';

interface ZarzadPersonFormModalProps {
  language: Language;
  /** The community, named under the title. */
  adresNazwa: string;
  /** Person being edited, or null when adding one. */
  editing: ZarzadOsoba | null;
  isSaving: boolean;
  onSubmit: (data: { imieNazwisko: string; email: string }) => void;
  onCancel: () => void;
}

/** Add/edit one board member: a name, and a mailbox if there is one. */
const ZarzadPersonFormModal: React.FC<ZarzadPersonFormModalProps> = ({
  language,
  adresNazwa,
  editing,
  isSaving,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [imieNazwisko, setImieNazwisko] = useState(editing?.imieNazwisko || '');
  const [email, setEmail] = useState(editing?.email || '');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const n = imieNazwisko.trim();
    const e = email.trim();
    if (!n) {
      setLocalError(t.zarzadNameRequired);
      return;
    }
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setLocalError(t.zgnEmailInvalid);
      return;
    }
    onSubmit({ imieNazwisko: n, email: e });
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const unchanged =
    !!editing && imieNazwisko.trim() === editing.imieNazwisko && email.trim() === (editing.email || '');

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex: 1100 }}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} />
        <ModalHeader
          icon={editing ? 'users' : 'user-plus'}
          title={editing ? t.zarzadEdit : t.zarzadAdd}
          subtitle={adresNazwa}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="users" title={t.zarzadSection} description={t.zarzadSectionDesc}>
            <FormRow>
              <FormField label={t.zgnProxyName} htmlFor="zarzad-name" required>
                <input
                  id="zarzad-name"
                  type="text"
                  value={imieNazwisko}
                  onChange={(e) => { setImieNazwisko(e.target.value); if (localError) setLocalError(null); }}
                  placeholder={t.zgnProxyNamePlaceholder}
                  onKeyDown={submitOnEnter}
                  autoFocus
                />
              </FormField>
              <FormField
                label={t.zgnUnitEmail}
                htmlFor="zarzad-email"
                hint={t.zarzadEmailHint}
                error={localError}
              >
                <div className="input-icon">
                  <Icon name="mail" size={15} />
                  <input
                    id="zarzad-email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (localError) setLocalError(null); }}
                    placeholder="np. jan.kowalski@example.pl"
                    onKeyDown={submitOnEnter}
                  />
                </div>
              </FormField>
            </FormRow>
          </FormSection>
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.zarzadAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={unchanged || !imieNazwisko.trim()}
          submitTitle={unchanged ? t.noChangesToSave : t.zarzadNameRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

interface ZarzadEditorProps {
  language: Language;
  /** The community, named under the person form's title. */
  adresNazwa: string;
  members: ZarzadOsoba[];
  /**
   * Takes the whole new list — the board is one value on the address. The board
   * modal saves it at once and answers whether that worked (a failed save keeps
   * the person form open); the address form keeps it until "Zapisz".
   */
  onChange: (next: ZarzadOsoba[]) => boolean | Promise<boolean>;
  isSaving?: boolean;
  error?: string | null;
  /** Inside a larger form: the add button follows the list, quieter than the form's own save. */
  inForm?: boolean;
}

/**
 * A community's board as an editable list: each person with edit and delete,
 * and "add". The same editor serves the board modal on the address list and
 * the address form, so both offer the same.
 */
export const ZarzadEditor: React.FC<ZarzadEditorProps> = ({
  language,
  adresNazwa,
  members,
  onChange,
  isSaving = false,
  error,
  inForm = false,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [formState, setFormState] = useState<{ editing: ZarzadOsoba | null } | null>(null);

  const handleFormSubmit = async (data: { imieNazwisko: string; email: string }) => {
    const editing = formState?.editing;
    const next = editing
      ? members.map((m) => (m.id === editing.id ? { ...m, ...data } : m))
      : [...members, { id: `z${Date.now().toString(36)}`, ...data }];
    if (await onChange(next)) setFormState(null);
  };

  const handleDelete = async (m: ZarzadOsoba) => {
    if (!(await notify.confirm(t.zarzadConfirmDelete.replace('{name}', m.imieNazwisko), { danger: true }))) {
      return;
    }
    await onChange(members.filter((x) => x.id !== m.id));
  };

  const addButton = (
    <button
      type="button"
      className={inForm ? 'button button-small button-subtle' : 'button button-primary'}
      onClick={() => setFormState({ editing: null })}
      disabled={isSaving}
    >
      <Icon name="plus" size={inForm ? 13 : 14} />{' '}{t.zarzadAdd}
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

      {members.length > 0 ? (
        <ul className="record-list">
          {members.map((m) => (
            <li key={m.id} className="record-row">
              <span className="record-row__icon" aria-hidden="true">
                <Icon name="users" size={15} />
              </span>
              <div className="record-row__main">
                <div className="record-row__title">{m.imieNazwisko}</div>
                <div className={`record-row__meta${m.email ? '' : ' is-missing'}`}>
                  <Icon name="mail" size={12} />
                  {m.email || t.noEmail}
                </div>
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
                  aria-label={`${t.delete}: ${m.imieNazwisko}`}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="form-empty">
          <Icon name="users" size={16} />
          {t.zarzadEmpty}
        </div>
      )}

      {inForm && <div>{addButton}</div>}

      {/* In the body: inside a form the editor sits in a scrolling modal body. */}
      {formState &&
        createPortal(
          <ZarzadPersonFormModal
            key={formState.editing ? `edit-${formState.editing.id}` : 'new'}
            language={language}
            adresNazwa={adresNazwa}
            editing={formState.editing}
            isSaving={isSaving}
            onSubmit={(data) => void handleFormSubmit(data)}
            onCancel={() => setFormState(null)}
          />,
          document.body,
        )}
    </>
  );
};

/**
 * A community's board, in a modal like the apartment rules, opened from the
 * address list. Every change saves the whole list at once.
 */
export const ZarzadModal: React.FC<{
  adres: Adres;
  language: Language;
  onClose: () => void;
  onSaved: () => void;
}> = ({ adres, language, onClose, onSaved }) => {
  const t = translations[language];
  const [members, setMembers] = useState<ZarzadOsoba[]>(adres.zarzad || []);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const persist = async (next: ZarzadOsoba[]) => {
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.setAdresZarzad(adres.id, next);
      setMembers(next);
      onSaved();
      return true;
    } catch (e: unknown) {
      setError(ipcErrorMessage(e, t.errorUnexpected));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} />
        <ModalHeader icon="users" title={t.zarzadTitle} subtitle={adres.nazwa} />
        <div className="modal-body modal-body--sectioned">
          <ZarzadEditor
            language={language}
            adresNazwa={adres.nazwa}
            members={members}
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
