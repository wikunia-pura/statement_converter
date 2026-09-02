import React, { useEffect, useMemo, useState } from 'react';
import { Spotkanie, SpotkanieLokalizacja } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import ModalDismiss from '../components/Modal';

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

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <ModalDismiss onClose={onCancel} ariaLabel={t.close} />
        <div className="modal-header">{editing ? t.kalLokEdit : t.kalLokAdd}</div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="lok-nazwa">{t.kalLokName}</label>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="lok-adres">{t.kalLokAddress}</label>
            <input
              id="lok-adres"
              type="text"
              value={adres}
              placeholder={t.kalLokAddressPlaceholder}
              disabled={isSaving}
              onChange={(e) => setAdres(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
            <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>
              {t.kalLokAddressHint}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="lok-opis">{t.kalLokDesc}</label>
            <textarea
              id="lok-opis"
              rows={3}
              value={opis}
              placeholder={t.kalLokDescPlaceholder}
              disabled={isSaving}
              onChange={(e) => setOpis(e.target.value)}
            />
          </div>
          {message && <div style={{ fontSize: '12px', color: 'var(--danger)' }}>{message}</div>}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onCancel} disabled={isSaving}>
            {t.cancel}
          </button>
          <button className="button button-primary" onClick={handleSubmit} disabled={isSaving}>
            <Icon name="save" size={14} /> {isSaving ? t.loading : t.save}
          </button>
        </div>
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
            <h2 style={{ margin: '0 0 8px' }}>{t.kalLokTitle}</h2>
            <div style={{ fontSize: '13px', opacity: 0.75, maxWidth: '80ch' }}>{t.kalLokHint}</div>
          </div>
          <button
            className="button button-primary"
            onClick={() => {
              setError(null);
              setFormState({ editing: null });
            }}
            disabled={isSaving}
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="plus" size={14} /> {t.kalLokAdd}
          </button>
        </div>

        {error && !formState && (
          <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '10px' }}>
            {error}
          </div>
        )}

        {lokalizacje.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>{t.kalLokName}</th>
                <th>{t.kalLokAddress}</th>
                <th>{t.kalLokDesc}</th>
                <th>{t.kalLokUsage}</th>
                <th>{t.actions}</th>
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
                  <td>{lok.adres || '—'}</td>
                  <td>{lok.opis || '—'}</td>
                  <td>{usageById.get(lok.id) ?? 0}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="button button-small button-primary"
                        onClick={() => {
                          setError(null);
                          setFormState({ editing: lok });
                        }}
                        disabled={isSaving}
                      >
                        <Icon name="edit" size={13} /> {t.edit}
                      </button>
                      <button
                        className="button button-small button-danger"
                        onClick={() => handleDelete(lok)}
                        disabled={isSaving}
                      >
                        <Icon name="trash" size={13} /> {t.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">{t.kalLokEmpty}</div>
        )}
      </div>

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
