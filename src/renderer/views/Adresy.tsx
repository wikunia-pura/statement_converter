import React, { useState, useEffect, useMemo } from 'react';
import { Adres, Bank, ApartmentMapping, KontoTyp, ZgnJednostka, ZgnPelnomocnik, ZarzadOsoba } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import { formatAccount, normalizeAccount } from '../../shared/account-extractor';
import { buildApartmentMapping, mappingTargets } from '../../shared/apartment-mapping';
import ApartmentTargetsEditor, {
  ApartmentTargetDraft,
  apartmentTargetDrafts,
  apartmentTargetsFromDrafts,
  validateApartmentTargets,
} from '../components/ApartmentTargetsEditor';
import CheckList, { CheckListItem } from '../components/CheckList';
import { FormField, FormRow, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import Loader, { BusyOverlay } from '../components/Loader';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import ModuleTabs from '../components/ModuleTabs';
import Select from '../components/Select';
import { plural } from '../plural';
import TagInput from '../components/TagInput';

interface AccountTypeFormModalProps {
  language: Language;
  /** Type being edited, or null when adding a new one. */
  editing: KontoTyp | null;
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (e.g. API failure). */
  error: string | null;
  onSubmit: (data: { name: string; bankAccountSymbol: string; apartmentPrefix: string; isDefault: boolean }) => void;
  onCancel: () => void;
}

/**
 * Standalone add/edit form for a single account type. Kept separate from the
 * list modal (mirrors ApartmentMappingFormModal) so the list stays scannable
 * and it's always unambiguous whether you're adding or editing.
 */
const AccountTypeFormModal: React.FC<AccountTypeFormModalProps> = ({
  language,
  editing,
  isSaving,
  error,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [name, setName] = useState(editing?.name || '');
  const [bankAccountSymbol, setBankAccountSymbol] = useState(editing?.bankAccountSymbol || '');
  const [apartmentPrefix, setApartmentPrefix] = useState(editing?.apartmentPrefix || '');
  const [isDefault, setIsDefault] = useState(editing?.isDefault || false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const n = name.trim();
    const s = bankAccountSymbol.trim();
    const p = apartmentPrefix.trim();
    if (!n || !s || !p) {
      setLocalError(t.fillAllFields);
      return;
    }
    onSubmit({ name: n, bankAccountSymbol: s, apartmentPrefix: p, isDefault });
  };

  const unchanged =
    !!editing &&
    name.trim() === editing.name &&
    bankAccountSymbol.trim() === editing.bankAccountSymbol &&
    apartmentPrefix.trim() === editing.apartmentPrefix &&
    isDefault === editing.isDefault;
  const clearError = () => { if (localError) setLocalError(null); };

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex: 1100 }}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} />
        <ModalHeader
          icon="wallet"
          title={editing ? t.accountTypeEdit : t.addAccountType}
          subtitle={editing ? editing.name : t.accountTypeFormSubtitle}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="wallet" title={t.accountTypeSection} description={t.accountTypeSectionDesc}>
            <FormField label={t.accountTypeName} htmlFor="konto-typ-name" required>
              <input
                id="konto-typ-name"
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); clearError(); }}
                placeholder={t.accountTypeNamePlaceholder}
                autoFocus
              />
            </FormField>
            <FormRow>
              <FormField label={t.accountTypeBankSymbol} htmlFor="konto-typ-symbol" required>
                <input
                  id="konto-typ-symbol"
                  type="text"
                  className="input-mono"
                  value={bankAccountSymbol}
                  onChange={(e) => { setBankAccountSymbol(e.target.value); clearError(); }}
                  placeholder={t.accountTypeBankSymbolPlaceholder}
                />
              </FormField>
              <FormField label={t.accountTypeApartmentPrefix} htmlFor="konto-typ-prefix" required>
                <input
                  id="konto-typ-prefix"
                  type="text"
                  className="input-mono"
                  value={apartmentPrefix}
                  onChange={(e) => { setApartmentPrefix(e.target.value); clearError(); }}
                  placeholder={t.accountTypeApartmentPrefixPlaceholder}
                />
              </FormField>
            </FormRow>
            <label className="switch-row">
              <span className="switch-row__text">
                <span className="switch-row__label">{t.accountTypeIsDefault}</span>
                <span className="switch-row__hint">{t.accountTypeIsDefaultHint}</span>
              </span>
              <span className="toggle-switch">
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                <span className="toggle-slider"></span>
              </span>
            </label>
            {(localError || error) && (
              <div className="callout callout--danger" role="alert">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">{localError || error}</div>
              </div>
            )}
          </FormSection>
        </div>
        <ModalFooter
          note={<RequiredNote label={t.formRequiredNote} />}
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.addAccountType}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={unchanged || !name.trim() || !bankAccountSymbol.trim() || !apartmentPrefix.trim()}
          submitTitle={unchanged ? t.noChangesToSave : t.fillAllFields}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

interface AccountTypesPanelProps {
  language: Language;
  kontoTypy: KontoTyp[];
  onSaved: () => void;
}

/**
 * Global configuration of account types. Each type maps to a pair of accounting
 * symbols (community bank-account side + apartment-account prefix). Exactly one
 * type is the default (used when an account number has no explicit type).
 */
const AccountTypesPanel: React.FC<AccountTypesPanelProps> = ({ language, kontoTypy, onSaved }) => {
  const t = translations[language];
  const notify = useNotify();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { editing: null } = add; { editing: <typ> } = edit.
  const [formState, setFormState] = useState<{ editing: KontoTyp | null } | null>(null);

  const handleFormSubmit = async (data: {
    name: string;
    bankAccountSymbol: string;
    apartmentPrefix: string;
    isDefault: boolean;
  }) => {
    setIsSaving(true);
    setError(null);
    try {
      const editing = formState?.editing;
      if (editing) {
        await window.electronAPI.updateKontoTyp(editing.id, data.name, data.bankAccountSymbol, data.apartmentPrefix, data.isDefault);
      } else {
        await window.electronAPI.addKontoTyp(data.name, data.bankAccountSymbol, data.apartmentPrefix, data.isDefault);
      }
      onSaved();
      setFormState(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!(await notify.confirm(t.confirmDeleteAccountType, { danger: true }))) return;
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.deleteKontoTyp(id);
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleImport = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.importKontoTypyFromFile();
      if (result.success) {
        notify.success(
          t.importKontoTypySuccess
            .replace('{added}', String(result.added ?? 0))
            .replace('{updated}', String(result.updated ?? 0)),
        );
        onSaved();
      } else if (result.error) {
        setError(result.error);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async () => {
    try {
      const result = await window.electronAPI.exportKontoTypyToFile();
      if (result.success) {
        notify.success(t.exportKontoTypySuccess.replace('{count}', String(result.count ?? 0)));
      } else if (result.error) {
        setError(result.error);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  };

  return (
    <FormSection
      icon="settings"
      title={t.accountTypesTitle}
      description={t.accountTypesHint}
      aside={
        <div className="form-section__actions">
          <button className="button button-import" onClick={handleImport} disabled={isSaving}>
            <Icon name="upload" size={14} />{' '}{t.importFromFile}
          </button>
          <button
            className="button button-export"
            onClick={handleExport}
            disabled={isSaving || kontoTypy.length === 0}
          >
            <Icon name="download" size={14} />{' '}{t.exportToFile}
          </button>
          <button
            className="button button-primary"
            onClick={() => { setError(null); setFormState({ editing: null }); }}
            disabled={isSaving}
          >
            <Icon name="plus" size={14} />{' '}{t.addAccountType}
          </button>
        </div>
      }
    >
      {error && !formState && (
        <div className="callout callout--danger" role="alert">
          <Icon name="alert-triangle" size={16} />
          <div className="callout__body">{error}</div>
        </div>
      )}

      {kontoTypy.length > 0 ? (
        <table className="form-table">
          <thead>
            <tr>
              <th>{t.accountTypeName}</th>
              <th>{t.accountTypeBankSymbol}</th>
              <th>{t.accountTypeApartmentPrefix}</th>
              <th className="data-table__actions">{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {kontoTypy.map((typ) => (
              <tr key={typ.id}>
                <td>
                  <span className="cell-with-badge">
                    <span className="form-table__label">{typ.name}</span>
                    {typ.isDefault && <span className="form-section__badge is-accent">{t.accountTypeDefaultBadge}</span>}
                  </span>
                </td>
                <td className="cell-mono">{typ.bankAccountSymbol}</td>
                <td className="cell-mono">{typ.apartmentPrefix}</td>
                <td className="data-table__actions">
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button-small button-secondary"
                      onClick={() => { setError(null); setFormState({ editing: typ }); }}
                      disabled={isSaving}
                    >
                      <Icon name="edit" size={13} />{' '}{t.edit}
                    </button>
                    <button
                      type="button"
                      className="button button-ghost button-icon icon-danger"
                      onClick={() => handleDelete(typ.id)}
                      disabled={isSaving}
                      title={t.delete}
                      aria-label={`${t.delete}: ${typ.name}`}
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
          <Icon name="wallet" size={16} />
          {t.noAccountTypes}
        </div>
      )}

      {formState && (
        <AccountTypeFormModal
          language={language}
          editing={formState.editing}
          isSaving={isSaving}
          error={error}
          onSubmit={handleFormSubmit}
          onCancel={() => { setFormState(null); setError(null); }}
        />
      )}
    </FormSection>
  );
};

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

/**
 * A community's board, in a modal like the apartment rules: the list of people,
 * each with edit and delete, and "add" on top. Every change saves the whole list
 * at once — it is one value on the address.
 */
const ZarzadModal: React.FC<{
  adres: Adres;
  language: Language;
  onClose: () => void;
  onSaved: () => void;
}> = ({ adres, language, onClose, onSaved }) => {
  const t = translations[language];
  const notify = useNotify();
  const [members, setMembers] = useState<ZarzadOsoba[]>(adres.zarzad || []);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formState, setFormState] = useState<{ editing: ZarzadOsoba | null } | null>(null);

  const persist = async (next: ZarzadOsoba[]) => {
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.setAdresZarzad(adres.id, next);
      setMembers(next);
      onSaved();
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormSubmit = async (data: { imieNazwisko: string; email: string }) => {
    const editing = formState?.editing;
    const next = editing
      ? members.map((m) => (m.id === editing.id ? { ...m, ...data } : m))
      : [...members, { id: `z${Date.now().toString(36)}`, ...data }];
    if (await persist(next)) setFormState(null);
  };

  const handleDelete = async (m: ZarzadOsoba) => {
    if (!(await notify.confirm(t.zarzadConfirmDelete.replace('{name}', m.imieNazwisko), { danger: true }))) {
      return;
    }
    await persist(members.filter((x) => x.id !== m.id));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} />
        <ModalHeader icon="users" title={t.zarzadTitle} subtitle={adres.nazwa} />
        <div className="modal-body modal-body--sectioned">
          <div className="panel-intro">
            <p className="panel-intro__text">{t.zarzadHint}</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setFormState({ editing: null })}
              disabled={isSaving}
            >
              <Icon name="plus" size={14} />{' '}{t.zarzadAdd}
            </button>
          </div>

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
                      title={t.delete}
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
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>

      {formState && (
        <ZarzadPersonFormModal
          key={formState.editing ? `edit-${formState.editing.id}` : 'new'}
          language={language}
          adresNazwa={adres.nazwa}
          editing={formState.editing}
          isSaving={isSaving}
          onSubmit={(data) => void handleFormSubmit(data)}
          onCancel={() => setFormState(null)}
        />
      )}
    </div>
  );
};

interface ApartmentMappingsModalProps {
  adres: Adres;
  language: Language;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Per-address modal listing all apartment-number rules. Adding/editing a rule
 * happens in a separate ApartmentMappingFormModal so the list stays readable.
 * Saves through updateAdres (re-sending the address's other fields).
 */
const ApartmentMappingsModal: React.FC<ApartmentMappingsModalProps> = ({
  adres,
  language,
  onClose,
  onSaved,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [mappings, setMappings] = useState<ApartmentMapping[]>(adres.apartmentMappings || []);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // null = closed; { editing: null } = add; { editing: <m> } = edit.
  const [formState, setFormState] = useState<{ editing: ApartmentMapping | null } | null>(null);

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

  const handleFormSubmit = async (entry: ApartmentMapping) => {
    const exists = mappings.some(m => m.id === entry.id);
    const next = exists
      ? mappings.map(m => (m.id === entry.id ? entry : m))
      : [...mappings, entry];
    const ok = await persist(next);
    if (ok) setFormState(null);
  };

  const handleDelete = async (id: string) => {
    if (!(await notify.confirm(t.confirmDeleteAdres, { danger: true }))) return;
    await persist(mappings.filter(m => m.id !== id));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} />
        <ModalHeader icon="clipboard" title={t.apartmentMappingsTitle} subtitle={adres.nazwa} />
        <div className="modal-body modal-body--sectioned">
          <div className="panel-intro">
            <p className="panel-intro__text">{t.apartmentMappingsHint}</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setFormState({ editing: null })}
              disabled={isSaving}
            >
              <Icon name="plus" size={14} />{' '}{t.addApartmentMapping}
            </button>
          </div>

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
                    <div className="record-row__main">
                      <div className="record-row__title record-row__title--wrap">{m.matchText}</div>
                      <div className="record-row__chips">
                        {targets.map((target) => (
                          <span key={target.apartmentNumber} className="apt-chip">
                            <Icon name="home" size={12} />
                            <b>{target.apartmentNumber}</b>
                            {target.kontoLokalu && <span className="apt-chip__account">{target.kontoLokalu}</span>}
                          </span>
                        ))}
                      </div>
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
                        onClick={() => handleDelete(m.id)}
                        disabled={isSaving}
                        title={t.delete}
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
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>

      {formState && (
        <ApartmentMappingFormModal
          language={language}
          editing={formState.editing}
          existing={mappings}
          isSaving={isSaving}
          onSubmit={handleFormSubmit}
          onCancel={() => setFormState(null)}
        />
      )}
    </div>
  );
};

interface ZgnUnitFormModalProps {
  language: Language;
  /** Unit being edited, or null when adding a new one. */
  editing: ZgnJednostka | null;
  /** All communities — the ones this unit serves are ticked in the form. */
  adresy: Adres[];
  /** All units, to name the one a community would be taken over from. */
  jednostki: ZgnJednostka[];
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (e.g. API failure). */
  error: string | null;
  /** Stack above the units modal when the dictionary itself is a modal. */
  zIndex?: number;
  onSubmit: (data: { nazwa: string; email: string; adresIds: number[]; assignmentChanged: boolean }) => void;
  onCancel: () => void;
}

/**
 * Add/edit form for a single city unit: its name and mailbox, and the
 * communities it serves — ticked right here, so a new unit does not send the
 * user through every address afterwards.
 */
const ZgnUnitFormModal: React.FC<ZgnUnitFormModalProps> = ({
  language,
  editing,
  adresy,
  jednostki,
  isSaving,
  error,
  zIndex = 1100,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [nazwa, setNazwa] = useState(editing?.nazwa || '');
  const [email, setEmail] = useState(editing?.email || '');
  const [localError, setLocalError] = useState<string | null>(null);
  // What the unit serves when the form opens — the baseline for the change summary.
  const [initialIds] = useState<number[]>(() =>
    editing ? adresy.filter((a) => a.zgnJednostkaId === editing.id).map((a) => a.id) : [],
  );
  const [adresIds, setAdresIds] = useState<number[]>(initialIds);

  const added = adresIds.filter((id) => !initialIds.includes(id)).length;
  const removed = initialIds.filter((id) => !adresIds.includes(id)).length;
  const assignmentChanged = added > 0 || removed > 0;
  const emailChanged = !!editing && email.trim() !== editing.email;
  const unchanged = !!editing && nazwa.trim() === editing.nazwa && !emailChanged && !assignmentChanged;

  const items: CheckListItem[] = useMemo(() => {
    const unitName = (id: number) => jednostki.find((j) => j.id === id)?.nazwa ?? '';
    return adresy.map((a) => {
      const on = adresIds.includes(a.id);
      const other = a.zgnJednostkaId && a.zgnJednostkaId !== editing?.id ? unitName(a.zgnJednostkaId) : '';
      if (on && other) {
        return { id: a.id, label: a.nazwa, note: t.zgnPickTakesOver.replace('{name}', other), noteTone: 'warning' };
      }
      if (!on && initialIds.includes(a.id)) {
        return { id: a.id, label: a.nazwa, note: t.zgnPickDetaches, noteTone: 'danger' };
      }
      return { id: a.id, label: a.nazwa, note: other || undefined, noteTone: 'muted' };
    });
  }, [adresy, jednostki, adresIds, initialIds, editing, t]);

  const handleSubmit = () => {
    const n = nazwa.trim();
    const e = email.trim();
    if (!n || !e) {
      setLocalError(t.fillAllFields);
      return;
    }
    // Deliberately loose: a corporate mailbox can look unusual, and refusing to
    // save is worse than sending to an address the user can see and correct.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setLocalError(t.zgnEmailInvalid);
      return;
    }
    onSubmit({ nazwa: n, email: e, adresIds, assignmentChanged });
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex }}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} />
        <ModalHeader
          icon="building"
          title={editing ? t.zgnUnitEdit : t.zgnUnitAdd}
          subtitle={editing ? editing.nazwa : t.zgnUnitFormSubtitle}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="building" title={t.zgnSectionUnit} description={t.zgnSectionUnitDesc}>
            <FormRow>
              <FormField label={t.zgnUnitName} htmlFor="zgn-unit-name" required>
                <input
                  id="zgn-unit-name"
                  type="text"
                  value={nazwa}
                  onChange={(e) => { setNazwa(e.target.value); if (localError) setLocalError(null); }}
                  placeholder={t.zgnUnitNamePlaceholder}
                  onKeyDown={submitOnEnter}
                  autoFocus
                />
              </FormField>
              <FormField
                label={t.zgnUnitEmail}
                htmlFor="zgn-unit-email"
                required
                hint={t.zgnUnitEmailHint}
                error={localError || error}
              >
                <div className="input-icon">
                  <Icon name="mail" size={15} />
                  <input
                    id="zgn-unit-email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (localError) setLocalError(null); }}
                    placeholder="np. zgn@um.example.pl"
                    onKeyDown={submitOnEnter}
                  />
                </div>
              </FormField>
            </FormRow>
            {emailChanged && adresIds.length > 0 && (
              <div className="callout callout--warning" role="status">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">
                  {t.zgnUnitEmailChangeImpact.replace(
                    '{count}',
                    plural(adresIds.length, language, ['wspólnoty', 'wspólnot', 'wspólnot'], ['community', 'communities']),
                  )}
                </div>
              </div>
            )}
          </FormSection>

          <FormSection
            icon="home"
            title={t.zgnSectionCommunities}
            description={t.zgnSectionCommunitiesDesc}
          >
            <CheckList
              items={items}
              selected={adresIds}
              onChange={setAdresIds}
              searchPlaceholder={t.zgnPickSearch}
              onlySelectedLabel={t.pickOnlySelected}
              emptyLabel={t.zgnPickEmpty}
            />
          </FormSection>
        </div>
        <ModalFooter
          note={
            assignmentChanged ? (
              <span className="change-summary">
                {t.zgnAssignChanges}:
                {added > 0 && <span className="change-summary__add">+{added}</span>}
                {removed > 0 && <span className="change-summary__remove">−{removed}</span>}
              </span>
            ) : (
              <RequiredNote label={t.formRequiredNote} />
            )
          }
          onCancel={onCancel}
          cancelLabel={t.cancel}
          onSubmit={handleSubmit}
          submitLabel={editing ? t.save : t.zgnUnitAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={unchanged || !nazwa.trim() || !email.trim()}
          submitTitle={unchanged ? t.noChangesToSave : t.fillAllFields}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

interface ZgnProxyFormModalProps {
  language: Language;
  /** The unit the proxy acts for — named in the header. */
  jednostka: ZgnJednostka;
  /** Proxy being edited, or null when adding one. */
  editing: ZgnPelnomocnik | null;
  isSaving: boolean;
  error: string | null;
  zIndex?: number;
  onSubmit: (data: { imieNazwisko: string; email: string }) => void;
  onCancel: () => void;
}

/** Add/edit one proxy of a unit: a name, and a mailbox if there is one. */
const ZgnProxyFormModal: React.FC<ZgnProxyFormModalProps> = ({
  language,
  jednostka,
  editing,
  isSaving,
  error,
  zIndex = 1100,
  onSubmit,
  onCancel,
}) => {
  const t = translations[language];
  const [imieNazwisko, setImieNazwisko] = useState(editing?.imieNazwisko || '');
  const [email, setEmail] = useState(editing?.email || '');
  const unchanged =
    !!editing && imieNazwisko.trim() === editing.imieNazwisko && email.trim() === (editing.email || '');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const n = imieNazwisko.trim();
    const e = email.trim();
    if (!n) {
      setLocalError(t.zgnProxyNameRequired);
      return;
    }
    // Optional, and as loose as the unit's own check when it is given.
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

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex }}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onCancel} />
        <ModalHeader
          icon={editing ? 'users' : 'user-plus'}
          title={editing ? t.zgnProxyEdit : t.zgnProxyAdd}
          subtitle={jednostka.nazwa}
        />
        <div className="modal-body modal-body--sectioned">
          <FormSection icon="users" title={t.zgnSectionProxy} description={t.zgnSectionProxyDesc}>
            <FormRow>
              <FormField label={t.zgnProxyName} htmlFor="zgn-proxy-name" required>
                <input
                  id="zgn-proxy-name"
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
                htmlFor="zgn-proxy-email"
                hint={t.zgnProxyEmailHint}
                error={localError || error}
              >
                <div className="input-icon">
                  <Icon name="mail" size={15} />
                  <input
                    id="zgn-proxy-email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (localError) setLocalError(null); }}
                    placeholder="np. jan.kowalski@um.example.pl"
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
          submitLabel={editing ? t.save : t.zgnProxyAdd}
          submitIcon={editing ? 'save' : 'plus'}
          submitDisabled={unchanged || !imieNazwisko.trim()}
          submitTitle={unchanged ? t.noChangesToSave : t.zgnProxyNameRequired}
          busy={isSaving}
        />
      </div>
    </div>
  );
};

interface ZgnUnitsPanelProps {
  language: Language;
  jednostki: ZgnJednostka[];
  adresy: Adres[];
  onSaved: () => void;
  /** Raised when the panel itself sits in a modal, so its form lands on top. */
  formZIndex?: number;
}

/**
 * Dictionary of city units ("jednostki ZGN") the Mailing module writes to. One
 * unit usually serves many communities, so it lives here once and each address
 * points at it — changing the unit's mailbox fixes every community at once.
 *
 * Rendered as its own tab, and reused inside a modal (`ZgnUnitsModal`) for the
 * one place that needs it without leaving what it is doing: the address form,
 * where a missing unit blocks the field being filled in.
 */
const ZgnUnitsPanel: React.FC<ZgnUnitsPanelProps> = ({
  language,
  jednostki,
  adresy,
  onSaved,
  formZIndex,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = closed; { editing: null } = add; { editing: <jednostka> } = edit.
  const [formState, setFormState] = useState<{ editing: ZgnJednostka | null } | null>(null);
  // Proxies of every unit, loaded here: they are only ever managed in this panel.
  const [pelnomocnicy, setPelnomocnicy] = useState<ZgnPelnomocnik[]>([]);
  const [proxyForm, setProxyForm] = useState<{
    jednostka: ZgnJednostka;
    editing: ZgnPelnomocnik | null;
  } | null>(null);

  const loadPelnomocnicy = async () => {
    try {
      setPelnomocnicy(await window.electronAPI.getZgnPelnomocnicy());
    } catch {
      setPelnomocnicy([]);
    }
  };

  // Again whenever the units change: deleting one takes its proxies with it.
  useEffect(() => {
    void loadPelnomocnicy();
  }, [jednostki]);

  const proxiesOf = (jednostkaId: number) =>
    pelnomocnicy.filter((p) => p.jednostkaId === jednostkaId);

  const handleProxySubmit = async (data: { imieNazwisko: string; email: string }) => {
    if (!proxyForm) return;
    setIsSaving(true);
    setError(null);
    try {
      if (proxyForm.editing) {
        await window.electronAPI.updateZgnPelnomocnik(
          proxyForm.editing.id,
          data.imieNazwisko,
          data.email,
        );
      } else {
        await window.electronAPI.addZgnPelnomocnik(
          proxyForm.jednostka.id,
          data.imieNazwisko,
          data.email,
        );
      }
      setProxyForm(null);
      await loadPelnomocnicy();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleProxyDelete = async (p: ZgnPelnomocnik) => {
    if (!(await notify.confirm(t.zgnProxyConfirmDelete.replace('{name}', p.imieNazwisko), { danger: true }))) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.deleteZgnPelnomocnik(p.id);
      await loadPelnomocnicy();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormSubmit = async (data: {
    nazwa: string;
    email: string;
    adresIds: number[];
    assignmentChanged: boolean;
  }) => {
    setIsSaving(true);
    setError(null);
    try {
      const editing = formState?.editing;
      let jednostkaId: number;
      if (editing) {
        await window.electronAPI.mailingUpdateZgn(editing.id, data.nazwa, data.email);
        jednostkaId = editing.id;
      } else {
        jednostkaId = (await window.electronAPI.mailingAddZgn(data.nazwa, data.email)).id;
      }
      if (data.assignmentChanged) {
        await window.electronAPI.setZgnAdresy(jednostkaId, data.adresIds);
      }
      setFormState(null);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (jednostka: ZgnJednostka) => {
    const used = adresy.filter((a) => a.zgnJednostkaId === jednostka.id).length;
    const proxies = proxiesOf(jednostka.id).length;
    const message =
      (used > 0
        ? t.zgnConfirmDeleteUsed.replace('{count}', String(used))
        : t.zgnConfirmDelete) +
      (proxies > 0 ? ` ${t.zgnConfirmDeleteProxies.replace('{count}', String(proxies))}` : '');
    if (!(await notify.confirm(message, { danger: true }))) return;
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.mailingDeleteZgn(jednostka.id);
      if (formState?.editing?.id === jednostka.id) setFormState(null);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="panel-intro">
        <p className="panel-intro__text">{t.zgnUnitsHint}</p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => { setError(null); setFormState({ editing: null }); }}
          disabled={isSaving}
        >
          <Icon name="plus" size={14} />{' '}{t.zgnUnitAdd}
        </button>
      </div>

      {error && !formState && !proxyForm && (
        <div className="form-field__error" role="alert">
          <Icon name="alert-circle" size={13} />
          {error}
        </div>
      )}

      {jednostki.length > 0 ? (
        <div className="zgn-units">
          {jednostki.map((j) => {
            const used = adresy.filter((a) => a.zgnJednostkaId === j.id).length;
            const proxies = proxiesOf(j.id);
            return (
              <article key={j.id} className="zgn-unit">
                <header className="zgn-unit__header">
                  <span className="form-section__icon" aria-hidden="true">
                    <Icon name="building" size={16} />
                  </span>
                  <div className="zgn-unit__heading">
                    <h3 className="zgn-unit__name">{j.nazwa}</h3>
                    <div className="zgn-unit__meta">
                      <span className="zgn-unit__meta-item zgn-unit__email" title={t.zgnUnitEmail}>
                        <Icon name="mail" size={13} />
                        {j.email}
                      </span>
                      <span className="zgn-unit__meta-item">
                        <Icon name="home" size={13} />
                        {t.zgnUnitUsedByLabel}: <strong>{used}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="zgn-unit__actions">
                    <button
                      type="button"
                      className="button button-small button-secondary"
                      onClick={() => { setError(null); setFormState({ editing: j }); }}
                      disabled={isSaving}
                    >
                      <Icon name="edit" size={13} />{' '}{t.edit}
                    </button>
                    <button
                      type="button"
                      className="button button-ghost button-icon icon-danger"
                      onClick={() => handleDelete(j)}
                      disabled={isSaving}
                      title={t.delete}
                      aria-label={`${t.delete}: ${j.nazwa}`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </header>
                <div className="zgn-unit__proxies">
                  <div className="zgn-unit__proxies-head">
                    <div className="zgn-unit__proxies-title">{t.zgnProxies}</div>
                    <button
                      type="button"
                      className="button button-small button-subtle"
                      onClick={() => { setError(null); setProxyForm({ jednostka: j, editing: null }); }}
                      disabled={isSaving}
                    >
                      <Icon name="plus" size={13} />{' '}{t.zgnProxyAdd}
                    </button>
                  </div>
                  {proxies.length > 0 && (
                    <ul className="zgn-proxy-list">
                      {proxies.map((p) => (
                        <li key={p.id} className="zgn-proxy-row">
                          <span className="zgn-proxy-row__name">{p.imieNazwisko}</span>
                          <span className={`zgn-proxy-row__email${p.email ? '' : ' is-missing'}`}>
                            {p.email || t.zgnProxyNoEmail}
                          </span>
                          <span className="zgn-proxy-row__actions">
                            <button
                              type="button"
                              className="button button-ghost button-icon"
                              onClick={() => { setError(null); setProxyForm({ jednostka: j, editing: p }); }}
                              disabled={isSaving}
                              title={t.edit}
                              aria-label={`${t.edit}: ${p.imieNazwisko}`}
                            >
                              <Icon name="edit" size={13} />
                            </button>
                            <button
                              type="button"
                              className="button button-ghost button-icon icon-danger"
                              onClick={() => void handleProxyDelete(p)}
                              disabled={isSaving}
                              title={t.delete}
                              aria-label={`${t.delete}: ${p.imieNazwisko}`}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="form-empty">
          <Icon name="building" size={16} />
          {t.zgnNoUnits}
        </div>
      )}

      {formState && (
        <ZgnUnitFormModal
          language={language}
          editing={formState.editing}
          isSaving={isSaving}
          error={error}
          zIndex={formZIndex}
          adresy={adresy}
          jednostki={jednostki}
          onSubmit={(data) => void handleFormSubmit(data)}
          onCancel={() => { setFormState(null); setError(null); }}
        />
      )}

      {proxyForm && (
        <ZgnProxyFormModal
          key={proxyForm.editing ? `edit-${proxyForm.editing.id}` : `new-${proxyForm.jednostka.id}`}
          language={language}
          jednostka={proxyForm.jednostka}
          editing={proxyForm.editing}
          isSaving={isSaving}
          error={error}
          zIndex={formZIndex}
          onSubmit={(data) => void handleProxySubmit(data)}
          onCancel={() => { setProxyForm(null); setError(null); }}
        />
      )}
    </>
  );
};

interface ZgnUnitsModalProps extends ZgnUnitsPanelProps {
  onClose: () => void;
}

/**
 * The units dictionary in a modal, for the address form: a unit added there must
 * be pickable without closing the half-filled address first, so it opens above it
 * instead of switching tabs and discarding the form.
 */
const ZgnUnitsModal: React.FC<ZgnUnitsModalProps> = ({ onClose, ...panelProps }) => {
  const t = translations[panelProps.language];
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} />
        <ModalHeader icon="building" title={t.zgnUnitsTitle} subtitle={t.zgnUnitsModalSubtitle} />
        <div className="modal-body modal-body--sectioned">
          {/* One layer above this modal, which already sits above the address form. */}
          <ZgnUnitsPanel {...panelProps} formZIndex={1200} />
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>
    </div>
  );
};

interface AdresyProps {
  language: Language;
  /** When set, opens the "add address" modal with this account number pre-filled. The parent should clear it once consumed. */
  prefillAccountNumber?: string | null;
  onPrefillConsumed?: () => void;
}

/** Tabs of the Adresy module: the communities themselves plus their dictionaries. */
type AdresyTab = 'lista' | 'typy' | 'zgn';

const Adresy: React.FC<AdresyProps> = ({ language, prefillAccountNumber, onPrefillConsumed }) => {
  const t = translations[language];
  const notify = useNotify();
  const [tab, setTab] = useState<AdresyTab>('lista');
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [kontoTypy, setKontoTypy] = useState<KontoTyp[]>([]);
  const [zgnJednostki, setZgnJednostki] = useState<ZgnJednostka[]>([]);
  const [showZgnUnitsModal, setShowZgnUnitsModal] = useState(false);
  const [newZgnJednostkaId, setNewZgnJednostkaId] = useState<number | null>(null);
  const [showAddAdres, setShowAddAdres] = useState(false);
  const [editingAdres, setEditingAdres] = useState<Adres | null>(null);
  const [newNazwa, setNewNazwa] = useState('');
  const [newAlternativeNames, setNewAlternativeNames] = useState<string[]>([]);
  const [newSwrkIdentifiers, setNewSwrkIdentifiers] = useState<string[]>([]);
  const [newAccountNumbers, setNewAccountNumbers] = useState<string[]>([]);
  const [newAccountTypes, setNewAccountTypes] = useState<Record<string, number>>({});
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [accountNumberError, setAccountNumberError] = useState<string | null>(null);
  const [newBankId, setNewBankId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // By id, not the row itself: saving reloads the list (and shows the loader,
  // which remounts the modal), so the modal must pick up the fresh row — a kept
  // copy would reopen showing the list as it was before the save.
  const [mappingsAdresId, setMappingsAdresId] = useState<number | null>(null);
  const [zarzadAdresId, setZarzadAdresId] = useState<number | null>(null);
  const mappingsAdres = adresy.find((a) => a.id === mappingsAdresId) ?? null;
  const zarzadAdres = adresy.find((a) => a.id === zarzadAdresId) ?? null;

  // Honor incoming prefill from the Converter: open the "add" modal with the
  // detected account pre-loaded so the user only needs to type the nazwa.
  useEffect(() => {
    if (!prefillAccountNumber) return;
    const canonical = normalizeAccount(prefillAccountNumber);
    if (!canonical) return;
    setTab('lista');
    setShowAddAdres(true);
    setEditingAdres(null);
    setNewAccountNumbers([canonical]);
    onPrefillConsumed?.();
  }, [prefillAccountNumber, onPrefillConsumed]);

  useEffect(() => {
    loadData();
  }, []);

  // The units modal opens over this form, and its unit form can re-assign this
  // very address. Follow such a change, so saving the address does not quietly
  // put the old unit back.
  useEffect(() => {
    if (!editingAdres) return;
    const fresh = adresy.find((a) => a.id === editingAdres.id);
    if (fresh && (fresh.zgnJednostkaId ?? null) !== (editingAdres.zgnJednostkaId ?? null)) {
      setNewZgnJednostkaId(fresh.zgnJednostkaId ?? null);
      setEditingAdres(fresh);
    }
  }, [adresy]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [adresyData, banksData, kontoTypyData, zgnData] = await Promise.all([
        window.electronAPI.getAdresy(),
        window.electronAPI.getBanks(),
        window.electronAPI.getKontoTypy(),
        window.electronAPI.mailingGetZgn(),
      ]);
      setAdresy(adresyData);
      setBanks(banksData);
      setKontoTypy(kontoTypyData);
      setZgnJednostki(zgnData);
    } catch (error) {
      console.error('Error loading adresy:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAdres = async () => {
    if (!newNazwa) {
      notify.warning(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive)
    const duplicateExists = adresy.some(
      a => a.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      notify.warning(t.duplicateAdresName);
      return;
    }

    try {
      await window.electronAPI.addAdres(
        newNazwa,
        newAlternativeNames,
        newSwrkIdentifiers,
        newBankId,
        newAccountNumbers,
        undefined,
        newAccountTypes,
        newZgnJednostkaId,
      );
      resetForm();
      setShowAddAdres(false);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      notify.error(`${t.errorAddingAdres}: ${errorMessage}`);
    }
  };

  const handleUpdateAdres = async () => {
    if (!editingAdres || !newNazwa) {
      notify.warning(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive), excluding current adres
    const duplicateExists = adresy.some(
      a => a.id !== editingAdres.id && a.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      notify.warning(t.duplicateAdresName);
      return;
    }

    try {
      await window.electronAPI.updateAdres(
        editingAdres.id,
        newNazwa,
        newAlternativeNames,
        newSwrkIdentifiers,
        newBankId,
        newAccountNumbers,
        undefined, // apartment mappings unchanged here (managed in their own modal)
        newAccountTypes,
        newZgnJednostkaId,
      );
      resetForm();
      setEditingAdres(null);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      notify.error(`${t.errorUpdatingAdres}: ${errorMessage}`);
    }
  };

  const handleDeleteAdres = async (id: number) => {
    if (await notify.confirm(t.confirmDeleteAdres, { danger: true })) {
      try {
        await window.electronAPI.deleteAdres(id);
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        notify.error(`${t.errorDeletingAdres}: ${errorMessage}`);
      }
    }
  };

  const resetForm = () => {
    setNewNazwa('');
    setNewAlternativeNames([]);
    setNewSwrkIdentifiers([]);
    setNewAccountNumbers([]);
    setNewAccountTypes({});
    setNewAccountNumber('');
    setAccountNumberError(null);
    setNewBankId(null);
    setNewZgnJednostkaId(null);
  };

  const handleEditAdres = (adres: Adres) => {
    setEditingAdres(adres);
    setNewNazwa(adres.nazwa);
    setNewAlternativeNames(adres.alternativeNames || []);
    setNewSwrkIdentifiers(adres.swrkIdentifiers || []);
    setNewAccountNumbers(adres.accountNumbers || []);
    setNewAccountTypes(adres.accountTypes || {});
    setNewAccountNumber('');
    setAccountNumberError(null);
    setNewBankId(adres.bankId ?? null);
    setNewZgnJednostkaId(adres.zgnJednostkaId ?? null);
  };

  const handleCancelEdit = () => {
    setEditingAdres(null);
    setShowAddAdres(false);
    resetForm();
  };

  const handleAddAccountNumber = () => {
    const canonical = normalizeAccount(newAccountNumber);
    if (!canonical) {
      setAccountNumberError(t.accountNumberInvalid);
      return;
    }
    if (newAccountNumbers.includes(canonical)) {
      setAccountNumberError(t.accountNumberDuplicateLocal);
      return;
    }
    setNewAccountNumbers([...newAccountNumbers, canonical]);
    // Default the new account to the default type (if one is configured).
    const defaultType = kontoTypy.find((k) => k.isDefault) ?? kontoTypy[0];
    if (defaultType) {
      setNewAccountTypes((prev) => ({ ...prev, [canonical]: defaultType.id }));
    }
    setNewAccountNumber('');
    setAccountNumberError(null);
  };

  const handleRemoveAccountNumber = (index: number) => {
    const removed = newAccountNumbers[index];
    setNewAccountNumbers(newAccountNumbers.filter((_, i) => i !== index));
    if (removed) {
      setNewAccountTypes((prev) => {
        const next = { ...prev };
        delete next[removed];
        return next;
      });
    }
  };

  const handleAccountTypeChange = (account: string, typeId: number) => {
    setNewAccountTypes((prev) => ({ ...prev, [account]: typeId }));
  };

  const handleImportFromFile = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importAdresyFromFile();
      if (result.success) {
        notify.success(t.importAdresySuccess.replace('{count}', String(result.count ?? 0)));
        if (result.errors && result.errors.length > 0) {
          notify.error(
            t.importAdresyPartialErrors.replace('{count}', String(result.errors.length)) +
              '\n' + result.errors.join('\n'),
          );
        }
        loadData();
      } else if (result.error) {
        notify.error(`${t.importAdresyError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(t.importAdresyError);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportToFile = async () => {
    try {
      const result = await window.electronAPI.exportAdresyToFile();
      if (result.success) {
        notify.success(t.exportAdresySuccess.replace('{count}', String(result.count ?? 0)));
      } else if (result.error) {
        notify.error(`${t.exportAdresyError}: ${result.error}`);
      }
    } catch (error) {
      notify.error(t.exportAdresyError);
    }
  };

  const handleDeleteAll = async () => {
    if (await notify.confirm(t.confirmDeleteAllAdresy, { danger: true })) {
      try {
        await window.electronAPI.deleteAllAdresy();
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        notify.error(`${t.errorDeletingAdres}: ${errorMessage}`);
      }
    }
  };

  const filteredAdresy = useMemo(() => adresy.filter((a) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    if (a.nazwa.toLowerCase().includes(q)) return true;
    if (a.alternativeNames?.some((n) => n.toLowerCase().includes(q))) return true;
    if (a.swrkIdentifiers?.some((s) => s.toLowerCase().includes(q))) return true;
    if (a.accountNumbers?.some((acc) => acc.includes(q.replace(/\s/g, '')))) return true;
    return false;
  }), [adresy, searchTerm]);

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  return (
    <>
      <ModuleTabs
        tabs={[
          { id: 'lista', label: t.adresyTabList, icon: 'map-pin' },
          { id: 'typy', label: t.accountTypesTitle, icon: 'settings' },
          { id: 'zgn', label: t.zgnUnitsTitle, icon: 'building' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as AdresyTab)}
      />
      <div className="content-body">
        {isImporting && <BusyOverlay label={t.importing} />}
        {tab === 'lista' && (
          <FormSection
            icon="map-pin"
            title={t.adresy}
            description={t.adresyListDesc}
            aside={
              <div className="form-section__actions">
                {/* Mass delete is demoted: never the loudest button next to everyday actions. */}
                {adresy.length > 0 && (
                  <>
                    <button
                      className="button button-ghost icon-danger"
                      onClick={handleDeleteAll}
                    >
                      <Icon name="trash" size={14} />{' '}{t.deleteAllAdresy}
                    </button>
                    <span className="toolbar-divider" aria-hidden="true" />
                  </>
                )}
                <button
                  className="button button-import"
                  onClick={handleImportFromFile}
                  disabled={isImporting}
                >
                  <Icon name="upload" size={14} />{' '}{t.importFromFile}
                </button>
                <button
                  className="button button-export"
                  onClick={handleExportToFile}
                  disabled={adresy.length === 0}
                >
                  <Icon name="download" size={14} />{' '}{t.exportToFile}
                </button>
                <button
                  className="button button-primary"
                  onClick={() => setShowAddAdres(true)}
                  disabled={showAddAdres || editingAdres !== null}
                >
                  <Icon name="plus" size={14} />{' '}{t.addAdres}
                </button>
              </div>
            }
          >

            {(showAddAdres || editingAdres) && (
              <div className="modal-overlay" onClick={handleCancelEdit}>
                <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
                  <ModalDismiss onClose={handleCancelEdit} />
                  <ModalHeader
                    icon="map-pin"
                    title={editingAdres ? t.editAdres : t.addNewAdres}
                    subtitle={editingAdres ? editingAdres.nazwa : t.adresFormSubtitleAdd}
                  />
                  <div className="modal-body modal-body--sectioned">
                    <FormSection
                      icon="home"
                      title={t.adresSectionBasic}
                      description={t.adresSectionBasicDesc}
                    >
                      <FormRow>
                        <FormField label={t.nazwa} htmlFor="adres-nazwa" required>
                          <input
                            id="adres-nazwa"
                            type="text"
                            value={newNazwa}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNazwa(e.target.value)}
                            placeholder={t.adresNamePlaceholder}
                            autoFocus={!editingAdres}
                            required
                          />
                        </FormField>
                        <FormField label={t.adresBank} hint={t.adresBankHintShort}>
                          <Select
                            overlay
                            value={newBankId ?? ''}
                            onChange={(v) => setNewBankId(v ? Number(v) : null)}
                            options={[
                              { value: '', label: t.adresNoBank },
                              ...banks.map((bank) => ({ value: String(bank.id), label: bank.name })),
                            ]}
                          />
                        </FormField>
                      </FormRow>
                    </FormSection>

                    <FormSection
                      icon="wallet"
                      title={t.adresSectionAccounts}
                      description={t.adresSectionAccountsDesc}
                    >
                      {newAccountNumbers.length > 0 ? (
                        <div className={`account-list${kontoTypy.length === 0 ? ' account-list--untyped' : ''}`}>
                          <div className="account-list__head">
                            <span>{t.adresAccountNumberColumn}</span>
                            {kontoTypy.length > 0 && <span>{t.accountTypeColumn}</span>}
                            <span aria-hidden="true" />
                          </div>
                          {newAccountNumbers.map((acc, index) => (
                            <div key={acc} className="account-list__row">
                              <span className="account-list__number">{formatAccount(acc)}</span>
                              {kontoTypy.length > 0 && (
                                <Select
                                  overlay
                                  size="sm"
                                  value={newAccountTypes[acc] ?? ''}
                                  onChange={(v) => handleAccountTypeChange(acc, Number(v))}
                                  options={kontoTypy.map((typ) => ({
                                    value: String(typ.id),
                                    label: `${typ.name} (${typ.bankAccountSymbol})`,
                                  }))}
                                  ariaLabel={t.accountTypeColumn}
                                />
                              )}
                              <button
                                type="button"
                                className="button button-ghost button-icon icon-danger"
                                onClick={() => handleRemoveAccountNumber(index)}
                                aria-label={`${t.remove}: ${formatAccount(acc)}`}
                                title={t.remove}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="form-empty">
                          <Icon name="wallet" size={16} />
                          {t.adresAccountsEmpty}
                        </div>
                      )}
                      <FormField
                        label={t.adresAccountAddLabel}
                        htmlFor="adres-account-new"
                        hint={t.adresAccountHintShort}
                        error={accountNumberError}
                      >
                        <div className="form-inline">
                          <input
                            id="adres-account-new"
                            type="text"
                            className="input-mono"
                            value={newAccountNumber}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              setNewAccountNumber(e.target.value);
                              if (accountNumberError) setAccountNumberError(null);
                            }}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddAccountNumber();
                              }
                            }}
                            placeholder={t.accountNumberPlaceholder}
                            aria-invalid={accountNumberError ? true : undefined}
                          />
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={handleAddAccountNumber}
                            disabled={!newAccountNumber.trim()}
                          >
                            <Icon name="plus" size={14} />{' '}{t.add}
                          </button>
                        </div>
                      </FormField>
                    </FormSection>

                    <FormSection
                      icon="search"
                      title={t.adresSectionMatching}
                      description={t.adresSectionMatchingDesc}
                    >
                      <FormField
                        label={t.alternativeNames}
                        htmlFor="adres-alt-names"
                        hint={t.adresAltNamesHintShort}
                      >
                        <TagInput
                          id="adres-alt-names"
                          values={newAlternativeNames}
                          onChange={setNewAlternativeNames}
                          placeholder={t.adresAltNamesPlaceholder}
                          addLabel={t.add}
                          removeLabel={t.remove}
                        />
                      </FormField>
                      <FormField
                        label={t.swrkIdentifiers}
                        htmlFor="adres-swrk"
                        hint={t.adresSwrkHintShort}
                      >
                        <TagInput
                          id="adres-swrk"
                          values={newSwrkIdentifiers}
                          onChange={setNewSwrkIdentifiers}
                          placeholder={t.swrkPlaceholder}
                          addLabel={t.add}
                          removeLabel={t.remove}
                          monospace
                        />
                      </FormField>
                    </FormSection>

                    <FormSection
                      icon="mail"
                      title={t.adresSectionMailing}
                      description={t.adresSectionMailingDesc}
                    >
                      <FormField label={t.zgnUnit}>
                        <div className="form-inline">
                          <Select
                            overlay
                            value={newZgnJednostkaId ?? ''}
                            onChange={(v) => setNewZgnJednostkaId(v ? Number(v) : null)}
                            options={[
                              { value: '', label: t.zgnUnitNone },
                              ...zgnJednostki.map((j) => ({
                                value: String(j.id),
                                label: `${j.nazwa} — ${j.email}`,
                              })),
                            ]}
                            ariaLabel={t.zgnUnit}
                            style={{ flex: 1, minWidth: 0 }}
                          />
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => setShowZgnUnitsModal(true)}
                            title={t.zgnUnitsTitle}
                          >
                            <Icon name="settings" size={14} />{' '}{t.zgnManageUnits}
                          </button>
                        </div>
                      </FormField>
                    </FormSection>
                  </div>
                  <ModalFooter
                    note={<RequiredNote label={t.formRequiredNote} />}
                    onCancel={handleCancelEdit}
                    cancelLabel={t.cancel}
                    onSubmit={editingAdres ? handleUpdateAdres : handleAddAdres}
                    submitLabel={editingAdres ? t.save : t.addAdres}
                    submitIcon={editingAdres ? 'save' : 'plus'}
                  />
                </div>
              </div>
            )}

            {adresy.length > 0 ? (
              <>
                <div className="list-filter">
                  <div className="input-icon">
                    <Icon name="search" size={15} />
                    <input
                      type="text"
                      placeholder={t.searchAdresy}
                      value={searchTerm}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                      aria-label={t.searchAdresy}
                    />
                  </div>
                  <span className="list-filter__count">
                    {t.totalAdresy}: <strong>{filteredAdresy.length}</strong> / {adresy.length}
                  </span>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t.nazwa}</th>
                      <th>{t.adresBank}</th>
                      <th>{t.adresAccountsColumn}</th>
                      <th>{t.adresSwrkColumn}</th>
                      <th>{t.zgnUnit}</th>
                      <th>{t.zarzadTitle}</th>
                      <th>{t.apartmentMappings}</th>
                      <th className="data-table__actions">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdresy.map((adres) => {
                      const altNames = adres.alternativeNames ?? [];
                      const swrk = adres.swrkIdentifiers ?? [];
                      const accounts = adres.accountNumbers ?? [];
                      const bank = adres.bankId ? banks.find((b) => b.id === adres.bankId) : undefined;
                      const jednostka = zgnJednostki.find((j) => j.id === adres.zgnJednostkaId);
                      const zarzadCount = adres.zarzad?.length ?? 0;
                      const mappingsCount = adres.apartmentMappings?.length ?? 0;
                      return (
                        <tr key={adres.id}>
                          <td className="data-table__name">
                            {/* Spelling variants are for matching, not for reading the list —
                                on hover only (search still finds them). */}
                            <span
                              className="cell-title"
                              title={altNames.length > 0 ? `${t.alternativeNames}:\n${altNames.join('\n')}` : undefined}
                            >
                              {adres.nazwa}
                            </span>
                          </td>
                          <td className="nowrap">
                            {bank ? bank.name : <span className="cell-empty">—</span>}
                          </td>
                          <td>
                            {accounts.length > 0 ? (
                              <div className="adres-accounts">
                                {accounts.map((acc) => {
                                  const typ = kontoTypy.find((k) => k.id === adres.accountTypes?.[acc]);
                                  return (
                                    <React.Fragment key={acc}>
                                      <span className="adres-account__number">{formatAccount(acc)}</span>
                                      <span
                                        className="adres-account__type"
                                        title={typ ? `${typ.name} (${typ.bankAccountSymbol})` : undefined}
                                      >
                                        {typ?.name ?? ''}
                                      </span>
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="cell-warning" title={t.adresNoAccountHint}>
                                <Icon name="alert-triangle" size={13} />
                                {t.adresNoAccount}
                              </span>
                            )}
                          </td>
                          <td>
                            {swrk.length > 0 ? (
                              <span className="adres-swrk">{swrk.join(', ')}</span>
                            ) : (
                              <span className="cell-empty">—</span>
                            )}
                          </td>
                          <td>
                            {jednostka ? (
                              <span className="adres-zgn" title={jednostka.email}>{jednostka.nazwa}</span>
                            ) : (
                              <span className="cell-empty">—</span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`button button-small button-ghost count-button${zarzadCount === 0 ? ' is-zero' : ''}`}
                              onClick={() => setZarzadAdresId(adres.id)}
                              title={
                                zarzadCount > 0
                                  ? adres.zarzad!.map((m) => m.imieNazwisko).join(', ')
                                  : t.zarzadTitle
                              }
                              aria-label={`${t.zarzadTitle}: ${zarzadCount}`}
                            >
                              {zarzadCount > 0 ? (
                                <><Icon name="users" size={13} />{zarzadCount}</>
                              ) : (
                                <><Icon name="plus" size={13} />{t.add}</>
                              )}
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`button button-small button-ghost count-button${mappingsCount === 0 ? ' is-zero' : ''}`}
                              onClick={() => setMappingsAdresId(adres.id)}
                              title={t.apartmentMappingsTitle}
                              aria-label={`${t.apartmentMappings}: ${mappingsCount}`}
                            >
                              {mappingsCount > 0 ? (
                                <><Icon name="clipboard" size={13} />{mappingsCount}</>
                              ) : (
                                <><Icon name="plus" size={13} />{t.add}</>
                              )}
                            </button>
                          </td>
                          <td className="data-table__actions">
                            <div className="row-actions">
                              <button
                                type="button"
                                className="button button-small button-secondary"
                                onClick={() => handleEditAdres(adres)}
                              >
                                <Icon name="edit" size={13} />{' '}{t.edit}
                              </button>
                              <button
                                type="button"
                                className="button button-ghost button-icon icon-danger"
                                onClick={() => handleDeleteAdres(adres.id)}
                                title={t.delete}
                                aria-label={`${t.delete}: ${adres.nazwa}`}
                              >
                                <Icon name="trash" size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="form-empty">
                <Icon name="map-pin" size={16} />
                {t.noAdresyConfigured}
              </div>
            )}
          </FormSection>
        )}

        {tab === 'typy' && (
          <AccountTypesPanel language={language} kontoTypy={kontoTypy} onSaved={loadData} />
        )}

        {tab === 'zgn' && (
          <FormSection icon="building" title={t.zgnUnitsTitle}>
            <ZgnUnitsPanel
              language={language}
              jednostki={zgnJednostki}
              adresy={adresy}
              onSaved={loadData}
            />
          </FormSection>
        )}

        {zarzadAdres && (
          <ZarzadModal
            adres={zarzadAdres}
            language={language}
            onClose={() => setZarzadAdresId(null)}
            onSaved={loadData}
          />
        )}

        {mappingsAdres && (
          <ApartmentMappingsModal
            adres={mappingsAdres}
            language={language}
            onClose={() => setMappingsAdresId(null)}
            onSaved={loadData}
          />
        )}

        {showZgnUnitsModal && (
          <ZgnUnitsModal
            language={language}
            jednostki={zgnJednostki}
            adresy={adresy}
            onClose={() => setShowZgnUnitsModal(false)}
            onSaved={loadData}
          />
        )}

      </div>
    </>
  );
};

export default Adresy;
