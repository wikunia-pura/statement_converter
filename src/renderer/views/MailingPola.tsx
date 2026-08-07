import React, { useEffect, useState } from 'react';
import { MailingPole } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import ModalDismiss from '../components/Modal';
import {
  BUILTIN_MAILING_FIELDS,
  fieldPlaceholder,
  normalizeFieldName,
} from '../../shared/mailing-template';

interface Props {
  language: Language;
}

interface FieldFormModalProps {
  language: Language;
  /** Field being edited, or null when adding a new one. */
  editing: MailingPole | null;
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (name clash, API failure). */
  error: string | null;
  onSubmit: (data: { nazwa: string; tekst: string }) => void;
  onCancel: () => void;
}

/**
 * Add/edit form for a single dynamic field, in a modal like the account types —
 * the list stays the whole view, and it is never ambiguous whether the inputs
 * above it are creating a field or editing the one you clicked.
 */
const FieldFormModal: React.FC<FieldFormModalProps> = ({
  language,
  editing,
  isSaving,
  error,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [nazwa, setNazwa] = useState(editing?.nazwa || '');
  const [tekst, setTekst] = useState(editing?.tekst || '');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const n = nazwa.trim();
    if (!n) {
      setLocalError(t.mailingFieldNameRequired);
      return;
    }
    onSubmit({ nazwa: n, tekst });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <ModalDismiss onClose={onCancel} />
        <div className="modal-header">{editing ? t.edit : t.mailingFieldAdd}</div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t.mailingFieldName} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={nazwa}
              onChange={(e) => { setNazwa(e.target.value); if (localError) setLocalError(null); }}
              placeholder={t.mailingFieldNamePlaceholder}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>{t.mailingFieldText}</label>
            <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
              {t.mailingFieldTextHint}
            </div>
            <input
              type="text"
              value={tekst}
              onChange={(e) => setTekst(e.target.value)}
              placeholder={t.mailingFieldTextPlaceholder}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>

          {(nazwa.trim() || tekst.trim()) && (
            <div style={{ fontSize: '12px', opacity: 0.75 }}>
              {t.mailingFieldPreview}: <code>{fieldPlaceholder(nazwa || '…')}</code> →{' '}
              <em>{[tekst.trim(), t.mailingFieldValueSample].filter(Boolean).join(' ')}</em>
            </div>
          )}

          {(localError || error) && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>
              {localError || error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onCancel} disabled={isSaving}>
            <Icon name="x" size={14} />{' '}{t.cancel}
          </button>
          <button
            className="button button-success"
            onClick={handleSubmit}
            disabled={isSaving || !nazwa.trim()}
          >
            <Icon name="save" size={14} />{' '}{editing ? t.update : t.add}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Dictionary of dynamic fields. A field pairs a name (what you insert into a
 * template) with the fixed sentence it renders; the number completing that
 * sentence is typed once per send, so one field covers every month.
 */
const MailingPola: React.FC<Props> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [pola, setPola] = useState<MailingPole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { editing: null } = add; { editing: <pole> } = edit.
  const [formState, setFormState] = useState<{ editing: MailingPole | null } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setIsLoading(true);
    try {
      setPola(await window.electronAPI.mailingGetPola());
    } catch (err) {
      notify.error(t.mailingLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = async (data: { nazwa: string; tekst: string }) => {
    const editingId = formState?.editing?.id ?? null;
    // The name is the placeholder key, so a clash would make one of the two
    // fields unreachable — and silently substitute the wrong sentence.
    const clash = pola.some(
      (p) => p.id !== editingId && normalizeFieldName(p.nazwa) === normalizeFieldName(data.nazwa),
    );
    const builtinClash = BUILTIN_MAILING_FIELDS.some(
      (b) => normalizeFieldName(b.nazwa) === normalizeFieldName(data.nazwa),
    );
    if (clash || builtinClash) {
      setError(t.mailingFieldNameTaken);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (editingId !== null) {
        await window.electronAPI.mailingUpdatePole(editingId, data.nazwa, data.tekst);
      } else {
        await window.electronAPI.mailingAddPole(data.nazwa, data.tekst);
      }
      setFormState(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (pole: MailingPole) => {
    if (!(await notify.confirm(t.mailingFieldConfirmDelete, { danger: true }))) return;
    try {
      await window.electronAPI.mailingDeletePole(pole.id);
      if (formState?.editing?.id === pole.id) setFormState(null);
      await load();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Unknown error');
    }
  };

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
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '15px',
          }}
        >
          <div>
            <h2 style={{ margin: '0 0 8px' }}>{t.mailingFieldsTitle}</h2>
            <div style={{ fontSize: '13px', opacity: 0.75, maxWidth: '80ch' }}>
              {t.mailingFieldsHint}
            </div>
          </div>
          <button
            className="button button-primary"
            onClick={() => { setError(null); setFormState({ editing: null }); }}
            disabled={isSaving}
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="plus" size={14} />{' '}{t.mailingFieldAdd}
          </button>
        </div>

        {error && !formState && (
          <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '10px' }}>{error}</div>
        )}

        {pola.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>{t.mailingFieldName}</th>
                <th>{t.mailingFieldPlaceholder}</th>
                <th>{t.mailingFieldText}</th>
                <th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {pola.map((p) => (
                <tr key={p.id}>
                  <td>{p.nazwa}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                    {fieldPlaceholder(p.nazwa)}
                  </td>
                  <td>{p.tekst || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="button button-small button-primary"
                        onClick={() => { setError(null); setFormState({ editing: p }); }}
                        disabled={isSaving}
                      >
                        <Icon name="edit" size={13} />{' '}{t.edit}
                      </button>
                      <button
                        className="button button-small button-danger"
                        onClick={() => handleDelete(p)}
                        disabled={isSaving}
                      >
                        <Icon name="trash" size={13} />{' '}{t.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">{t.mailingNoFields}</div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon name="sparkles" size={18} /> {t.mailingBuiltinFields}
        </h2>
        <div style={{ fontSize: '13px', opacity: 0.75, marginBottom: '14px', maxWidth: '80ch' }}>
          {t.mailingBuiltinFieldsHint}
        </div>
        <table>
          <thead>
            <tr>
              <th>{t.mailingFieldPlaceholder}</th>
              <th>{t.description}</th>
            </tr>
          </thead>
          <tbody>
            {BUILTIN_MAILING_FIELDS.map((f) => (
              <tr key={f.nazwa}>
                <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                  {fieldPlaceholder(f.nazwa)}
                </td>
                <td>{f.opis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formState && (
        <FieldFormModal
          language={language}
          editing={formState.editing}
          isSaving={isSaving}
          error={error}
          onSubmit={handleFormSubmit}
          onCancel={() => { setFormState(null); setError(null); }}
        />
      )}
    </div>
  );
};

export default MailingPola;
