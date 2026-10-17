import React, { useState } from 'react';
import { KontoTyp } from '../../../shared/types';
import { translations, Language } from '../../translations';
import { useNotify } from '../Notifications';
import { FormField, FormRow, FormSection, RequiredNote } from '../FormSection';
import Icon from '../Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../Modal';

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
export const AccountTypesPanel: React.FC<AccountTypesPanelProps> = ({ language, kontoTypy, onSaved }) => {
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
        notify.success(t.exportKontoTypySuccess.replace('{count}', String(result.count ?? 0)), {
          file: result.filePath,
        });
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
                      data-tip={t.delete}
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
