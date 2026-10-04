import React, { useEffect, useMemo, useState } from 'react';
import { Spotkanie, SpotkanieLokalizacja } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import { FormField, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';

interface Props {
  language: Language;
}

/** What the add/edit form submits — one dictionary entry, minus its id. */
interface LokalizacjaFormData {
  nazwa: string;
  adres: string;
  opis: string;
}

/** Case- and whitespace-insensitive, so "Biuro ZGN" and "biuro zgn " clash. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface FormModalProps {
  language: Language;
  /** Location being edited, or null when adding a new one. */
  editing: SpotkanieLokalizacja | null;
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (name clash, API failure). */
  error: string | null;
  onSubmit: (data: LokalizacjaFormData) => void;
  onCancel: () => void;
}

/**
 * Add/edit form for one location, in a modal like the other dictionaries — the
 * list stays the whole view, and it is never ambiguous whether the inputs are
 * creating an entry or editing the one you clicked.
 */
const LokalizacjaFormModal: React.FC<FormModalProps> = ({
  language,
  editing,
  isSaving,
  error,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [nazwa, setNazwa] = useState(editing?.nazwa || '');
  const [adres, setAdres] = useState(editing?.adres || '');
  const [opis, setOpis] = useState(editing?.opis || '');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const trimmed = nazwa.trim();
    if (!trimmed) {
      setLocalError(t.kalLokNameRequired);
      return;
    }
    onSubmit({ nazwa: trimmed, adres: adres.trim(), opis: opis.trim() });
  };

  const message = localError ?? error;

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };
  const unchanged =
    !!editing &&
    nazwa.trim() === editing.nazwa &&
    adres.trim() === (editing.adres || '') &&
    opis.trim() === (editing.opis || '');

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} ariaLabel={t.close} />
        <ModalHeader
          icon="map-pin"
          title={editing ? t.kalLokEdit : t.kalLokAdd}
          subtitle={editing ? editing.nazwa : t.kalLokFormSubtitleAdd}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="map-pin" title={t.kalLokSection} description={t.kalLokSectionDesc}>
            <FormField label={t.kalLokName} htmlFor="lok-nazwa" required error={message}>
              <input
                id="lok-nazwa"
                type="text"
                value={nazwa}
                placeholder={t.kalLokNamePlaceholder}
                autoFocus
                disabled={isSaving}
                onChange={(e) => {
                  setNazwa(e.target.value);
                  if (localError) setLocalError(null);
                }}
                onKeyDown={submitOnEnter}
              />
            </FormField>
            <FormField label={t.kalLokAddress} htmlFor="lok-adres" hint={t.kalLokAddressHint}>
              <input
                id="lok-adres"
                type="text"
                value={adres}
                placeholder={t.kalLokAddressPlaceholder}
                disabled={isSaving}
                onChange={(e) => setAdres(e.target.value)}
                onKeyDown={submitOnEnter}
              />
            </FormField>
            <FormField label={t.kalLokDesc} htmlFor="lok-opis">
              <textarea
                id="lok-opis"
                rows={3}
                value={opis}
                placeholder={t.kalLokDescPlaceholder}
                disabled={isSaving}
                onChange={(e) => setOpis(e.target.value)}
              />
            </FormField>
          </FormSection>
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.kalLokAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={unchanged || !nazwa.trim()}
          submitTitle={unchanged ? t.noChangesToSave : t.kalLokNameRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

/**
 * "Lokalizacje spotkań" — where meetings are held, as a dictionary.
 *
 * The same shape as the meeting types, and for the same reason: where this
 * office meets is a short, stable list (a community's own building, the ZGN
 * office, the accountant's room), and typing it again on every meeting is how
 * three spellings of one address end up in the calendar.
 */
const KalendarzLokalizacje: React.FC<Props> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [lokalizacje, setLokalizacje] = useState<SpotkanieLokalizacja[]>([]);
  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { editing: null } = add; { editing: <lok> } = edit.
  const [formState, setFormState] = useState<{ editing: SpotkanieLokalizacja | null } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setIsLoading(true);
    try {
      // The meetings are read only to count them per location — deleting one
      // leaves those meetings without a link, and the user deserves to know how
      // many before confirming.
      const [lokalizacjeData, spotkaniaData] = await Promise.all([
        window.electronAPI.getSpotkaniaLokalizacje(),
        window.electronAPI.getSpotkania(),
      ]);
      setLokalizacje(lokalizacjeData);
      setSpotkania(spotkaniaData);
    } catch (err) {
      notify.error(t.kalLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  const usageById = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of spotkania) {
      if (s.lokalizacjaId === null) continue;
      counts.set(s.lokalizacjaId, (counts.get(s.lokalizacjaId) ?? 0) + 1);
    }
    return counts;
  }, [spotkania]);

  const handleFormSubmit = async (data: LokalizacjaFormData) => {
    const editingId = formState?.editing?.id ?? null;
    // Two locations with the same name are indistinguishable in every picker.
    const clash = lokalizacje.some(
      (lok) => lok.id !== editingId && normalizeName(lok.nazwa) === normalizeName(data.nazwa)
    );
    if (clash) {
      setError(t.kalLokNameTaken);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (editingId !== null) {
        await window.electronAPI.updateSpotkanieLokalizacja(
          editingId,
          data.nazwa,
          data.adres,
          data.opis
        );
      } else {
        await window.electronAPI.addSpotkanieLokalizacja(data.nazwa, data.adres, data.opis);
      }
      setFormState(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (lok: SpotkanieLokalizacja) => {
    const used = usageById.get(lok.id) ?? 0;
    const message =
      used > 0
        ? t.kalLokConfirmDeleteUsed.replace('{name}', lok.nazwa).replace('{count}', String(used))
        : t.kalLokConfirmDelete.replace('{name}', lok.nazwa);
    if (!(await notify.confirm(message, { danger: true }))) return;
    try {
      await window.electronAPI.deleteSpotkanieLokalizacja(lok.id);
      if (formState?.editing?.id === lok.id) setFormState(null);
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
      <FormSection
        icon="map-pin"
        title={t.kalLokTitle}
        description={t.kalLokHint}
        aside={
          <button
            className="button button-primary"
            onClick={() => {
              setError(null);
              setFormState({ editing: null });
            }}
            disabled={isSaving}
          >
            <Icon name="plus" size={14} /> {t.kalLokAdd}
          </button>
        }
      >
        {error && !formState && (
          <div className="callout callout--danger" role="alert">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">{error}</div>
          </div>
        )}

        {lokalizacje.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.kalLokName}</th>
                <th>{t.kalLokAddress}</th>
                <th>{t.kalLokDesc}</th>
                <th>{t.kalLokUsage}</th>
                <th className="data-table__actions">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {lokalizacje.map((lok) => (
                <tr key={lok.id}>
                  <td>
                    <span className="kal-place">
                      <Icon name="map-pin" size={13} />
                      <strong>{lok.nazwa}</strong>
                    </span>
                  </td>
                  <td>{lok.adres || <span className="cell-empty">—</span>}</td>
                  <td>{lok.opis || <span className="cell-empty">—</span>}</td>
                  <td>{usageById.get(lok.id) ?? 0}</td>
                  <td className="data-table__actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => {
                          setError(null);
                          setFormState({ editing: lok });
                        }}
                        disabled={isSaving}
                      >
                        <Icon name="edit" size={13} /> {t.edit}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-icon icon-danger"
                        onClick={() => handleDelete(lok)}
                        disabled={isSaving}
                        title={t.delete}
                        aria-label={`${t.delete}: ${lok.nazwa}`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="form-empty">
            <Icon name="map-pin" size={16} />
            {t.kalLokEmpty}
          </div>
        )}
      </FormSection>

      {formState && (
        <LokalizacjaFormModal
          language={language}
          editing={formState.editing}
          isSaving={isSaving}
          error={error}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setFormState(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
};

export default KalendarzLokalizacje;
