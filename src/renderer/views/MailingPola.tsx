import React, { useEffect, useState } from 'react';
import { MailingPole, MailingPoleTyp } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import { FormField, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import {
  BUILTIN_MAILING_FIELDS,
  fieldPlaceholder,
  formatFieldValue,
  kalendarzFieldOf,
  normalizeFieldName,
} from '../../shared/mailing-template';

interface Props {
  language: Language;
}

/** What the add/edit form submits — one dictionary entry, minus its id. */
interface FieldFormData {
  nazwa: string;
  tekst: string;
  jednostka: string;
  typWartosci: MailingPoleTyp;
}

/** The value kinds, in the order the switch offers them. */
const VALUE_TYPES: MailingPoleTyp[] = ['tekst', 'data', 'godzina'];

/** The user-facing name of a value kind, in the app's language. */
function valueTypeLabel(
  typWartosci: MailingPoleTyp,
  t: (typeof translations)[Language],
): string {
  if (typWartosci === 'data') return t.mailingFieldValueTypeDate;
  if (typWartosci === 'godzina') return t.mailingFieldValueTypeTime;
  return t.mailingFieldValueTypeText;
}

interface FieldFormModalProps {
  language: Language;
  /** Field being edited, or null when adding a new one. */
  editing: MailingPole | null;
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (name clash, API failure). */
  error: string | null;
  onSubmit: (data: FieldFormData) => void;
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
  const [jednostka, setJednostka] = useState(editing?.jednostka || '');
  const [typWartosci, setTypWartosci] = useState<MailingPoleTyp>(
    editing?.typWartosci || 'tekst',
  );
  const [localError, setLocalError] = useState<string | null>(null);

  /** A unit after a date or an hour would be nonsense, so it is text-only. */
  const usesUnit = typWartosci === 'tekst';

  /**
   * The sample value as the letter will show it. A field with a unit gets the
   * bare number — the default sample already says "zł", and "350,00 zł zł/m²"
   * would teach the user to type the currency twice.
   */
  const valueSample =
    typWartosci === 'data'
      ? t.mailingFieldValueSampleDate
      : typWartosci === 'godzina'
        ? t.mailingFieldValueSampleTime
        : jednostka.trim()
          ? formatFieldValue(t.mailingFieldValueSampleBare, { jednostka })
          : t.mailingFieldValueSample;

  const handleSubmit = () => {
    const n = nazwa.trim();
    if (!n) {
      setLocalError(t.mailingFieldNameRequired);
      return;
    }
    // The unit is dropped rather than kept hidden: a field switched to a date
    // must not carry a "zł/m²" that reappears if it is switched back later.
    onSubmit({ nazwa: n, tekst, jednostka: usesUnit ? jednostka.trim() : '', typWartosci });
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };
  const errorText = localError || error;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} />
        <ModalHeader
          icon="sparkles"
          title={editing ? t.mailingFieldEdit : t.mailingFieldAdd}
          subtitle={editing ? editing.nazwa : t.mailingFieldFormSubtitleAdd}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="sparkles" title={t.mailingFieldSection} description={t.mailingFieldSectionDesc}>
            <FormField label={t.mailingFieldName} htmlFor="pole-name" required error={errorText}>
              <input
                id="pole-name"
                type="text"
                value={nazwa}
                onChange={(e) => { setNazwa(e.target.value); if (localError) setLocalError(null); }}
                placeholder={t.mailingFieldNamePlaceholder}
                autoFocus
              />
            </FormField>
            <FormField label={t.mailingFieldText} htmlFor="pole-text" hint={t.mailingFieldTextHint}>
              <input
                id="pole-text"
                type="text"
                value={tekst}
                onChange={(e) => setTekst(e.target.value)}
                placeholder={t.mailingFieldTextPlaceholder}
                onKeyDown={submitOnEnter}
              />
            </FormField>
          </FormSection>

          <FormSection icon="edit" title={t.mailingFieldSectionValue} description={t.mailingFieldSectionValueDesc}>
            <FormField label={t.mailingFieldValueType} hint={t.mailingFieldValueTypeHint}>
              {/* The same segmented switch as the editor's "Wstaw" control — one
                  visual language for "pick one of a few" inside the module. */}
              <div className="zad-seg" role="radiogroup" aria-label={t.mailingFieldValueType}>
                {VALUE_TYPES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={typWartosci === option}
                    className={`zad-seg__btn${typWartosci === option ? ' is-active' : ''}`}
                    onClick={() => setTypWartosci(option)}
                  >
                    {valueTypeLabel(option, t)}
                  </button>
                ))}
              </div>
            </FormField>
            {usesUnit && (
              <FormField label={t.mailingFieldUnit} htmlFor="pole-unit" hint={t.mailingFieldUnitHint}>
                <div className="form-inline form-inline--narrow">
                  <input
                    id="pole-unit"
                    type="text"
                    value={jednostka}
                    onChange={(e) => setJednostka(e.target.value)}
                    placeholder={t.mailingFieldUnitPlaceholder}
                    onKeyDown={submitOnEnter}
                  />
                </div>
              </FormField>
            )}
          </FormSection>

          {(nazwa.trim() || tekst.trim() || (usesUnit && jednostka.trim())) && (
            <FormSection icon="eye" title={t.mailingFieldPreview}>
              {/* The two halves separately — this is where a user meets them, and
                  seeing what each resolves to is shorter than explaining it. */}
              <dl className="placeholder-preview">
                <dt><code className="code-chip">{fieldPlaceholder(nazwa || '…')}</code></dt>
                <dd>{[tekst.trim(), valueSample].filter(Boolean).join(' ')}</dd>
                <dt><code className="code-chip">{fieldPlaceholder(nazwa || '…', 'label')}</code></dt>
                <dd>{tekst.trim() || nazwa.trim() || '…'}</dd>
                <dt><code className="code-chip">{fieldPlaceholder(nazwa || '…', 'value')}</code></dt>
                <dd>{valueSample}</dd>
              </dl>
            </FormSection>
          )}
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.mailingFieldAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={!nazwa.trim()}
          submitTitle={t.mailingFieldNameRequired}
          busy={isSaving}
        />
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
    try {
      setPola(await window.electronAPI.mailingGetPola());
    } catch (err) {
      notify.error(t.mailingLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = async (data: FieldFormData) => {
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
        await window.electronAPI.mailingUpdatePole(
          editingId,
          data.nazwa,
          data.tekst,
          data.jednostka,
          data.typWartosci,
        );
      } else {
        await window.electronAPI.mailingAddPole(
          data.nazwa,
          data.tekst,
          data.jednostka,
          data.typWartosci,
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
      <FormSection
        icon="sparkles"
        title={t.mailingFieldsTitle}
        description={t.mailingFieldsHint}
        aside={
          <button
            className="button button-primary"
            onClick={() => { setError(null); setFormState({ editing: null }); }}
            disabled={isSaving}
          >
            <Icon name="plus" size={14} />{' '}{t.mailingFieldAdd}
          </button>
        }
      >
        <div className="callout callout--info">
          <Icon name="info" size={16} />
          <div className="callout__body">{t.mailingFieldPlaceholderPartsHint}</div>
        </div>

        {error && !formState && (
          <div className="callout callout--danger" role="alert">
            <Icon name="alert-triangle" size={16} />
            <div className="callout__body">{error}</div>
          </div>
        )}

        {pola.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.mailingFieldName}</th>
                <th>{t.mailingFieldPlaceholder}</th>
                <th>{t.mailingFieldText}</th>
                <th>{t.mailingFieldUnit}</th>
                <th className="data-table__actions">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {pola.map((p) => (
                <tr key={p.id}>
                  <td className="data-table__name">
                    <span className="cell-with-badge">
                      <span className="cell-title">{p.nazwa}</span>
                      {/* Only the non-default kinds are called out — a dictionary
                          of text fields labelled "tekst" fifty times says nothing. */}
                      {p.typWartosci !== 'tekst' && (
                        <span className="form-section__badge is-neutral">{valueTypeLabel(p.typWartosci, t)}</span>
                      )}
                    </span>
                  </td>
                  <td>
                    <div className="code-stack">
                      <code className="code-chip">{fieldPlaceholder(p.nazwa)}</code>
                      <code className="code-chip is-quiet">{fieldPlaceholder(p.nazwa, 'label')}</code>
                      <code className="code-chip is-quiet">{fieldPlaceholder(p.nazwa, 'value')}</code>
                    </div>
                  </td>
                  <td>{p.tekst || <span className="cell-empty">—</span>}</td>
                  <td>{p.jednostka || <span className="cell-empty">—</span>}</td>
                  <td className="data-table__actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => { setError(null); setFormState({ editing: p }); }}
                        disabled={isSaving}
                      >
                        <Icon name="edit" size={13} />{' '}{t.edit}
                      </button>
                      <button
                        type="button"
                        className="button button-ghost button-icon icon-danger"
                        onClick={() => handleDelete(p)}
                        disabled={isSaving}
                        title={t.delete}
                        aria-label={`${t.delete}: ${p.nazwa}`}
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
            <Icon name="sparkles" size={16} />
            {t.mailingNoFields}
          </div>
        )}
      </FormSection>

      <FormSection icon="sparkles" title={t.mailingBuiltinFields} description={t.mailingBuiltinFieldsHint}>
        {/* The calendar fields are the one exception to "fills itself in": without
            a meeting behind the letter they are typed at send time, so say so
            where the user meets them first. */}
        <div className="callout callout--muted">
          <Icon name="calendar" size={16} />
          <div className="callout__body">{t.mveBuiltinCalendarNote}</div>
        </div>
        <table className="form-table">
          <thead>
            <tr>
              <th>{t.mailingFieldPlaceholder}</th>
              <th>{t.description}</th>
            </tr>
          </thead>
          <tbody>
            {BUILTIN_MAILING_FIELDS.map((f) => (
              <tr key={f.nazwa}>
                <td>
                  <code className="code-chip">{fieldPlaceholder(f.nazwa)}</code>
                </td>
                <td>
                  {f.opis}
                  {kalendarzFieldOf(f.nazwa) && (
                    <div className="form-table__sub">
                      <Icon name="calendar" size={12} /> {t.mveBuiltinCalendarBadge}
                      {' · '}
                      {valueTypeLabel(kalendarzFieldOf(f.nazwa)!.typWartosci, t)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </FormSection>

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
