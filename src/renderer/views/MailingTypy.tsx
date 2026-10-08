import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_MAILING_ADRESACI,
  MailingAdresaci,
  MailingSzablon,
  MailingTypDef,
} from '../../shared/types';
import { isValidEmail } from '../../shared/mailing-recipients';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import { FormField, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import MailingRecipientsEditor, { adresaciSummary } from '../components/MailingRecipientsEditor';

interface Props {
  language: Language;
}

/** What the add/edit form submits — one kind, minus what the server owns. */
interface TypFormData {
  nazwa: string;
  opis: string;
  adresaci: MailingAdresaci;
}

/** Case- and whitespace-insensitive, so "Ogłoszenie" and "ogłoszenie " clash. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface TypFormModalProps {
  language: Language;
  /** Kind being edited, or null when adding a new one. */
  editing: MailingTypDef | null;
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (name clash, API failure). */
  error: string | null;
  onSubmit: (data: TypFormData) => void;
  onCancel: () => void;
}

/**
 * Add/edit form for one mailing kind. The default recipients use the very
 * editor the send screen shows, in its "groups only" mode (no community to
 * resolve against), so what is set here looks exactly like what a send starts
 * from.
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
  const builtin = editing?.systemowy ?? false;
  const [nazwa, setNazwa] = useState(editing?.nazwa || '');
  const [opis, setOpis] = useState(editing?.opis || '');
  const [adresaci, setAdresaci] = useState<MailingAdresaci>(
    editing?.adresaci ?? { ...DEFAULT_MAILING_ADRESACI, wlasne: [] },
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const n = nazwa.trim();
    if (!n && !builtin) {
      setLocalError(t.mailingTypyNameRequired);
      return;
    }
    const invalid = (adresaci.wlasne ?? []).filter((e) => !isValidEmail(e));
    if (invalid.length > 0) {
      setLocalError(t.mailingTypyInvalidEmails.replace('{emails}', invalid.join(', ')));
      return;
    }
    // A kind that resolves to nobody would make every send of it fail per
    // community — better said here, once, than at every send.
    if (!adresaci.zgn && !adresaci.pelnomocnik && !adresaci.zarzad && adresaci.wlasne.length === 0) {
      setLocalError(t.mailingTypyNoRecipients);
      return;
    }
    onSubmit({ nazwa: builtin ? editing!.nazwa : n, opis: opis.trim(), adresaci });
  };

  const errorText = localError || error;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} ariaLabel={t.close} />
        <ModalHeader
          icon="clipboard"
          title={editing ? t.mailingTypyEdit : t.mailingTypyNew}
          subtitle={editing ? editing.nazwa : t.mailingTypyFormSubtitleAdd}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection
            icon="clipboard"
            title={t.mailingTypySection}
            description={t.mailingTypySectionDesc}
            badge={
              builtin ? (
                <span title={t.mailingTypyBuiltinHint}>
                  <Icon name="shield" size={11} /> {t.mailingTypyBuiltin}
                </span>
              ) : undefined
            }
          >
            <FormField
              label={t.mailingTypyName}
              htmlFor="mailing-typ-name"
              required={!builtin}
              hint={builtin ? t.mailingTypyBuiltinNameLocked : undefined}
            >
              <input
                id="mailing-typ-name"
                type="text"
                value={nazwa}
                disabled={builtin}
                onChange={(e) => {
                  setNazwa(e.target.value);
                  if (localError) setLocalError(null);
                }}
                placeholder={t.mailingTypyNamePlaceholder}
                autoFocus={!builtin}
              />
            </FormField>
            <FormField label={t.mailingTypyDesc} htmlFor="mailing-typ-desc">
              <textarea
                id="mailing-typ-desc"
                value={opis}
                rows={2}
                onChange={(e) => setOpis(e.target.value)}
                placeholder={t.mailingTypyDescPlaceholder}
              />
            </FormField>
          </FormSection>

          <FormSection icon="users" title={t.mailingTypySectionRecipients} description={t.mailingTypyRecipientsHint}>
            <MailingRecipientsEditor
              language={language}
              adresaci={adresaci}
              onAdresaciChange={(next) => {
                setAdresaci(next);
                if (localError) setLocalError(null);
              }}
              // Nothing is unticked in a default: there is no letter yet.
              wykluczeni={[]}
              onWykluczeniChange={() => undefined}
              lookup={null}
              disabled={isSaving}
            />
          </FormSection>

          {errorText && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{errorText}</div>
            </div>
          )}
        </div>
        <ModalFooter
          note={builtin ? undefined : <RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.mailingTypyNew}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={!builtin && !nazwa.trim()}
          submitTitle={t.mailingTypyNameRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

/**
 * Dictionary of mailing kinds (Mailing → Typy mailingu). A kind groups the
 * templates written for one purpose and says who its mail goes to by default;
 * the send screen starts from that and may change it for one send.
 *
 * One kind is built in — the meeting notice the Kalendarz and Zebrania look
 * their templates up by — so it is listed first, cannot be deleted or renamed,
 * and says so instead of offering buttons that would only be refused.
 */
const MailingTypy: React.FC<Props> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [typy, setTypy] = useState<MailingTypDef[]>([]);
  const [szablony, setSzablony] = useState<MailingSzablon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { editing: null } = add; { editing: <typ> } = edit.
  const [formState, setFormState] = useState<{ editing: MailingTypDef | null } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      // Templates are read only to count them per kind — a kind still used by
      // templates cannot be deleted, and the count tells the user why up front.
      const [typyData, szablonyData] = await Promise.all([
        window.electronAPI.mailingGetTypy(),
        window.electronAPI.mailingGetSzablony(),
      ]);
      setTypy(typyData);
      setSzablony(szablonyData);
    } catch (err) {
      notify.error(t.mailingLoadError);
    } finally {
      setIsLoading(false);
    }
  };

  const usageByTyp = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of szablony) counts.set(s.typ, (counts.get(s.typ) ?? 0) + 1);
    return counts;
  }, [szablony]);

  const handleFormSubmit = async (data: TypFormData) => {
    const editingId = formState?.editing?.id ?? null;
    // Two kinds with the same name are indistinguishable in every picker.
    const clash = typy.some(
      (typ) => typ.id !== editingId && normalizeName(typ.nazwa) === normalizeName(data.nazwa),
    );
    if (clash) {
      setError(t.mailingTypyNameTaken);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (editingId !== null) {
        await window.electronAPI.mailingUpdateTyp(editingId, data.nazwa, data.opis, data.adresaci);
      } else {
        await window.electronAPI.mailingAddTyp(data.nazwa, data.opis, data.adresaci);
      }
      setFormState(null);
      notify.success(t.mailingTypySaved);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (typ: MailingTypDef) => {
    if (!(await notify.confirm(t.mailingTypyConfirmDelete.replace('{name}', typ.nazwa), { danger: true }))) {
      return;
    }
    try {
      // Refusals (templates still use it) come back as a message, not a throw.
      const result = await window.electronAPI.mailingDeleteTyp(typ.id);
      if (result.error) {
        notify.error(result.error);
        return;
      }
      if (formState?.editing?.id === typ.id) setFormState(null);
      notify.success(t.mailingTypyDeleted);
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
        title={t.mailingTypyTitle}
        description={t.mailingTypyHint}
        aside={
          <button
            className="button button-primary"
            onClick={() => {
              setError(null);
              setFormState({ editing: null });
            }}
            disabled={isSaving}
          >
            <Icon name="plus" size={14} /> {t.mailingTypyAdd}
          </button>
        }
      >
        {typy.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.mailingTypyName}</th>
                <th>{t.mailingTypyDesc}</th>
                <th>{t.mailingTypyRecipients}</th>
                <th>{t.mailingTypyTemplates}</th>
                <th className="data-table__actions">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {typy.map((typ) => (
                <tr key={typ.id}>
                  <td className="data-table__name">
                    <span className="cell-with-badge">
                      <span className="cell-title">{typ.nazwa}</span>
                      {typ.systemowy && (
                        <span className="form-section__badge is-accent" title={t.mailingTypyBuiltinHint}>
                          <Icon name="shield" size={11} /> {t.mailingTypyBuiltin}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>{typ.opis || <span className="cell-empty">—</span>}</td>
                  <td>{adresaciSummary(t, typ.adresaci)}</td>
                  <td>{usageByTyp.get(typ.klucz) ?? 0}</td>
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
                      {/* No delete button for the built-in kind at all: one that
                          is always refused only teaches people to distrust it. The
                          empty slot keeps the Edit buttons in one column. */}
                      {typ.systemowy ? (
                        <span className="row-actions__slot" aria-hidden="true" />
                      ) : (
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
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="form-empty">
            <Icon name="clipboard" size={16} />
            {t.mailingTypyNone}
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

export default MailingTypy;
