import React, { useEffect, useMemo, useState } from 'react';
import { Spotkanie, SpotkanieTyp } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import { FormField, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import {
  DEFAULT_TYP_COLOR,
  TYP_COLORS,
  normalizeHexColor,
} from '../../shared/calendar';

interface Props {
  language: Language;
}

/** What the add/edit form submits — one dictionary entry, minus its id. */
interface TypFormData {
  nazwa: string;
  kolor: string;
  opis: string;
  /** Days before the meeting its documents are due; null = this kind has no rule. */
  dniNaDokumenty: number | null;
}

/** Case- and whitespace-insensitive, so "Zebranie" and "zebranie " clash. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface TypFormModalProps {
  language: Language;
  /** Type being edited, or null when adding a new one. */
  editing: SpotkanieTyp | null;
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (name clash, API failure). */
  error: string | null;
  onSubmit: (data: TypFormData) => void;
  onCancel: () => void;
}

/**
 * Add/edit form for one meeting type, in a modal like the other dictionaries —
 * the list stays the whole view, and it is never ambiguous whether the inputs
 * are creating a type or editing the one you clicked.
 */
const TypFormModal: React.FC<TypFormModalProps> = ({
  language,
  editing,
  isSaving,
  error,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [nazwa, setNazwa] = useState(editing?.nazwa || '');
  const [kolor, setKolor] = useState(
    editing ? normalizeHexColor(editing.kolor) : DEFAULT_TYP_COLOR,
  );
  const [opis, setOpis] = useState(editing?.opis || '');
  // Held as the raw text, so an empty box stays "no rule" instead of becoming 0.
  const [dni, setDni] = useState(
    editing?.dniNaDokumenty != null ? String(editing.dniNaDokumenty) : '',
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const n = nazwa.trim();
    if (!n) {
      setLocalError(t.kalTypNameRequired);
      return;
    }
    // Empty means "no rule" — a real answer, so it is not defaulted to a number.
    const trimmedDni = dni.trim();
    let dniNaDokumenty: number | null = null;
    if (trimmedDni) {
      const parsed = Number(trimmedDni);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
        setLocalError(t.kalTypDaysInvalid);
        return;
      }
      dniNaDokumenty = parsed;
    }
    onSubmit({
      nazwa: n,
      kolor: normalizeHexColor(kolor),
      opis: opis.trim(),
      dniNaDokumenty,
    });
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} ariaLabel={t.close} />
        <ModalHeader
          icon="calendar"
          title={editing ? t.kalTypEdit : t.kalTypAdd}
          subtitle={editing ? editing.nazwa : t.kalTypFormSubtitleAdd}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="calendar" title={t.kalTypSection} description={t.kalTypSectionDesc}>
            <FormField label={t.kalTypName} htmlFor="kal-typ-name" required error={localError || error}>
              <input
                id="kal-typ-name"
                type="text"
                value={nazwa}
                onChange={(e) => {
                  setNazwa(e.target.value);
                  if (localError) setLocalError(null);
                }}
                placeholder={t.kalTypNamePlaceholder}
                autoFocus
                onKeyDown={submitOnEnter}
              />
            </FormField>
            <FormField label={t.kalTypDesc} htmlFor="kal-typ-desc">
              <input
                id="kal-typ-desc"
                type="text"
                value={opis}
                onChange={(e) => setOpis(e.target.value)}
                placeholder={t.kalTypDescPlaceholder}
              />
            </FormField>
          </FormSection>

          <FormSection icon="eye" title={t.kalTypSectionLook} description={t.kalTypSectionLookDesc}>
            <FormField label={t.kalTypColor}>
              <div className="kal-swatches">
                {TYP_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`kal-swatch${kolor === option ? ' is-active' : ''}`}
                    style={{ ['--swatch' as string]: option }}
                    onClick={() => setKolor(option)}
                    aria-pressed={kolor === option}
                    aria-label={option}
                    title={option}
                  />
                ))}
                {/* The palette covers the common case; the native picker is there
                    for a team that wants its own colour. */}
                <input
                  type="color"
                  className="kal-swatch-custom"
                  value={kolor}
                  onChange={(e) => setKolor(e.target.value)}
                  aria-label={t.kalTypColorCustom}
                  title={t.kalTypColorCustom}
                />
              </div>
            </FormField>
            <div className="preview-line">
              <span className="preview-line__label">{t.kalTypPreview}</span>
              <span className="kal-chip" style={{ ['--chip' as string]: normalizeHexColor(kolor) }}>
                <span className="kal-chip__dot" />
                <span className="kal-chip__time">10:00</span>
                <span className="kal-chip__name">{nazwa.trim() || t.kalTypPreviewMeeting}</span>
              </span>
            </div>
          </FormSection>

          {/* The notice period. Left empty for a kind of meeting that has none —
              and then nothing about deadlines applies to its meetings. */}
          <FormSection icon="clock" title={t.kalTypSectionDocs} description={t.kalTypSectionDocsDesc}>
            <FormField label={t.kalTypDays} htmlFor="kal-typ-days" hint={t.kalTypDaysHint}>
              <div className="form-inline form-inline--narrow">
                <input
                  id="kal-typ-days"
                  type="number"
                  min={1}
                  max={365}
                  value={dni}
                  placeholder={t.kalTypDaysPlaceholder}
                  onChange={(e) => {
                    setDni(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                  onKeyDown={submitOnEnter}
                />
              </div>
            </FormField>
          </FormSection>
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.kalTypAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={!nazwa.trim()}
          submitTitle={t.kalTypNameRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

/**
 * Dictionary of meeting types, defined by the user rather than shipped with the
 * app: what counts as a kind of meeting is a property of how this office works,
 * not of the software. Each type owns a colour, which is what turns a month full
 * of meetings into something scannable.
 */
const KalendarzTypy: React.FC<Props> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [typy, setTypy] = useState<SpotkanieTyp[]>([]);
  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { editing: null } = add; { editing: <typ> } = edit.
  const [formState, setFormState] = useState<{ editing: SpotkanieTyp | null } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      // The meetings are read only to count them per type — deleting a type
      // untyped the meetings that used it, and the user deserves to know how
      // many before confirming.
      const [typyData, spotkaniaData] = await Promise.all([
        window.electronAPI.getSpotkaniaTypy(),
        window.electronAPI.getSpotkania(),
      ]);
      setTypy(typyData);
      setSpotkania(spotkaniaData);
    } catch (err) {
      notify.error(t.kalLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  const usageByTyp = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of spotkania) {
      if (s.typId === null) continue;
      counts.set(s.typId, (counts.get(s.typId) ?? 0) + 1);
    }
    return counts;
  }, [spotkania]);

  const handleFormSubmit = async (data: TypFormData) => {
    const editingId = formState?.editing?.id ?? null;
    // Two types with the same name are indistinguishable in every picker.
    const clash = typy.some(
      (typ) => typ.id !== editingId && normalizeName(typ.nazwa) === normalizeName(data.nazwa),
    );
    if (clash) {
      setError(t.kalTypNameTaken);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (editingId !== null) {
        await window.electronAPI.updateSpotkanieTyp(
          editingId,
          data.nazwa,
          data.kolor,
          data.opis,
          data.dniNaDokumenty,
        );
      } else {
        await window.electronAPI.addSpotkanieTyp(
          data.nazwa,
          data.kolor,
          data.opis,
          data.dniNaDokumenty,
        );
      }
      setFormState(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (typ: SpotkanieTyp) => {
    const used = usageByTyp.get(typ.id) ?? 0;
    const message =
      used > 0
        ? t.kalTypConfirmDeleteUsed.replace('{name}', typ.nazwa).replace('{count}', String(used))
        : t.kalTypConfirmDelete.replace('{name}', typ.nazwa);
    if (!(await notify.confirm(message, { danger: true }))) return;
    try {
      await window.electronAPI.deleteSpotkanieTyp(typ.id);
      if (formState?.editing?.id === typ.id) setFormState(null);
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
        icon="clipboard"
        title={t.kalTypyTitle}
        description={t.kalTypyHint}
        aside={
          <button
            className="button button-primary"
            onClick={() => {
              setError(null);
              setFormState({ editing: null });
            }}
            disabled={isSaving}
          >
            <Icon name="plus" size={14} /> {t.kalTypAdd}
          </button>
        }
      >
        {error && !formState && (
          <div className="callout callout--danger" role="alert">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">{error}</div>
          </div>
        )}

        {typy.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.kalTypName}</th>
                <th>{t.kalTypDesc}</th>
                <th>{t.kalTypDaysColumn}</th>
                <th>{t.kalTypUsage}</th>
                <th className="data-table__actions">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {typy.map((typ) => (
                <tr key={typ.id}>
                  <td>
                    <span
                      className="kal-chip"
                      style={{ ['--chip' as string]: normalizeHexColor(typ.kolor) }}
                    >
                      <span className="kal-chip__dot" />
                      <span className="kal-chip__name">{typ.nazwa}</span>
                    </span>
                  </td>
                  <td>{typ.opis || <span className="cell-empty">—</span>}</td>
                  <td>
                    {typ.dniNaDokumenty != null ? (
                      <span className="kal-days">
                        <Icon name="clock" size={12} />
                        {t.kalTypDaysValue.replace('{days}', String(typ.dniNaDokumenty))}
                      </span>
                    ) : (
                      <span className="cell-empty">{t.kalTypDaysNone}</span>
                    )}
                  </td>
                  <td>{usageByTyp.get(typ.id) ?? 0}</td>
                  <td className="data-table__actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => {
                          setError(null);
                          setFormState({ editing: typ });
                        }}
                        disabled={isSaving}
                      >
                        <Icon name="edit" size={13} /> {t.edit}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-icon icon-danger"
                        onClick={() => handleDelete(typ)}
                        disabled={isSaving}
                        title={t.delete}
                        aria-label={`${t.delete}: ${typ.nazwa}`}
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
            <Icon name="clipboard" size={16} />
            {t.kalNoTypy}
          </div>
        )}
      </FormSection>

      {formState && (
        <TypFormModal
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

export default KalendarzTypy;
