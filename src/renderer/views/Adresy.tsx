import React, { useState, useEffect, useMemo } from 'react';
import { Adres, Bank, ApartmentMapping, KontoTyp, ZgnJednostka } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import { normalizeAccount } from '../../shared/account-extractor';
import Icon from '../components/Icon';
import Loader from '../components/Loader';
import ModalDismiss from '../components/Modal';
import ModuleTabs from '../components/ModuleTabs';
import Select from '../components/Select';

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

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex: 1100 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <ModalDismiss onClose={onCancel} />
        <div className="modal-header">
          {editing ? t.edit : t.addAccountType}
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t.accountTypeName} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (localError) setLocalError(null); }}
              placeholder={t.accountTypeNamePlaceholder}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>{t.accountTypeBankSymbol} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={bankAccountSymbol}
              onChange={(e) => { setBankAccountSymbol(e.target.value); if (localError) setLocalError(null); }}
              placeholder={t.accountTypeBankSymbolPlaceholder}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <div className="form-group">
            <label>{t.accountTypeApartmentPrefix} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={apartmentPrefix}
              onChange={(e) => { setApartmentPrefix(e.target.value); if (localError) setLocalError(null); }}
              placeholder={t.accountTypeApartmentPrefixPlaceholder}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{t.accountTypeIsDefault}</span>
            <label className="toggle-switch">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              <span className="toggle-slider"></span>
            </label>
          </div>
          {(localError || error) && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>{localError || error}</div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onCancel} disabled={isSaving}>
            <Icon name="x" size={14} />{' '}{t.cancel}
          </button>
          <button
            className="button button-success"
            onClick={handleSubmit}
            disabled={isSaving || !name.trim() || !bankAccountSymbol.trim() || !apartmentPrefix.trim()}
          >
            <Icon name="save" size={14} />{' '}{editing ? t.update : t.add}
          </button>
        </div>
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
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 6px' }}>{t.accountTypesTitle}</h2>
          <div style={{ fontSize: '12px', opacity: 0.7, maxWidth: '80ch' }}>{t.accountTypesHint}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="button button-import"
            onClick={handleImport}
            disabled={isSaving}
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="upload" size={14} />{' '}{t.importFromFile}
          </button>
          <button
            className="button button-export"
            onClick={handleExport}
            disabled={isSaving || kontoTypy.length === 0}
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="download" size={14} />{' '}{t.exportToFile}
          </button>
          <button
            className="button button-primary"
            onClick={() => { setError(null); setFormState({ editing: null }); }}
            disabled={isSaving}
            style={{ whiteSpace: 'nowrap' }}
          ><Icon name="plus" size={14} />{' '}{t.addAccountType}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '8px' }}>{error}</div>
      )}

      {kontoTypy.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>{t.accountTypeName}</th>
              <th>{t.accountTypeBankSymbol}</th>
              <th>{t.accountTypeApartmentPrefix}</th>
              <th>{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {kontoTypy.map((typ) => (
              <tr key={typ.id}>
                <td>
                  {typ.name}
                  {typ.isDefault && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent)' }}>
                      ({t.accountTypeDefaultBadge})
                    </span>
                  )}
                </td>
                <td style={{ fontFamily: 'monospace' }}>{typ.bankAccountSymbol}</td>
                <td style={{ fontFamily: 'monospace' }}>{typ.apartmentPrefix}</td>
                <td>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="button button-small button-primary" onClick={() => { setError(null); setFormState({ editing: typ }); }} disabled={isSaving}><Icon name="edit" size={13} />{' '}
                      {t.edit}
                    </button>
                    <button className="button button-small button-danger" onClick={() => handleDelete(typ.id)} disabled={isSaving}><Icon name="trash" size={13} />{' '}
                      {t.delete}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty-state">{t.noAccountTypes}</div>
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
    </div>
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
  const [apartmentNumber, setApartmentNumber] = useState(editing?.apartmentNumber || '');
  const [note, setNote] = useState(editing?.note || '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const mt = matchText.trim();
    const apt = apartmentNumber.trim();
    if (!mt || !apt) {
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
    onSubmit({
      id: editing?.id || newMappingId(),
      matchText: mt,
      apartmentNumber: apt,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex: 1100 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <ModalDismiss onClose={onCancel} />
        <div className="modal-header">
          {editing ? t.edit : t.addApartmentMapping}
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t.apartmentMappingMatchText} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={matchText}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setMatchText(e.target.value); if (error) setError(null); }}
              placeholder={t.apartmentMappingMatchTextPlaceholder}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>{t.apartmentMappingApartment} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={apartmentNumber}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setApartmentNumber(e.target.value); if (error) setError(null); }}
              placeholder={t.apartmentMappingApartmentPlaceholder}
            />
          </div>
          <div className="form-group">
            <label>{t.apartmentMappingNote}</label>
            <input
              type="text"
              value={note}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
              placeholder={t.apartmentMappingNotePlaceholder}
            />
          </div>
          {error && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '8px' }}>{error}</div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onCancel} disabled={isSaving}>
            <Icon name="x" size={14} />{' '}{t.cancel}
          </button>
          <button
            className="button button-success"
            onClick={handleSubmit}
            disabled={isSaving || !matchText.trim() || !apartmentNumber.trim()}
          >
            <Icon name="save" size={14} />{' '}{editing ? t.update : t.add}
          </button>
        </div>
      </div>
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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <ModalDismiss onClose={onClose} />
        <div className="modal-header">
          {t.apartmentMappingsTitle} — {adres.nazwa}
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>
              {t.apartmentMappingsHint}
            </div>
            <button
              className="button button-primary"
              onClick={() => setFormState({ editing: null })}
              disabled={isSaving}
              style={{ whiteSpace: 'nowrap' }}
            ><Icon name="plus" size={14} />{' '}{t.addApartmentMapping}
            </button>
          </div>

          {error && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '8px' }}>{error}</div>
          )}

          {mappings.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>{t.apartmentMappingMatchText}</th>
                  <th>{t.apartmentMappingApartment}</th>
                  <th>{t.apartmentMappingNote}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td style={{ wordBreak: 'break-word' }}>{m.matchText}</td>
                    <td style={{ fontWeight: 600 }}>{m.apartmentNumber}</td>
                    <td style={{ wordBreak: 'break-word', opacity: 0.8 }}>{m.note || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="button button-small button-primary"
                          onClick={() => setFormState({ editing: m })}
                          disabled={isSaving}
                        ><Icon name="edit" size={13} />{' '}
                          {t.edit}
                        </button>
                        <button
                          className="button button-small button-danger"
                          onClick={() => handleDelete(m.id)}
                          disabled={isSaving}
                        ><Icon name="trash" size={13} />{' '}
                          {t.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">{t.noApartmentMappings}</div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onClose}>
            <Icon name="x" size={14} />{' '}{t.close}
          </button>
        </div>
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
  isSaving: boolean;
  /** Submit-time error surfaced from the parent (e.g. API failure). */
  error: string | null;
  /** Stack above the units modal when the dictionary itself is a modal. */
  zIndex?: number;
  onSubmit: (data: { nazwa: string; email: string }) => void;
  onCancel: () => void;
}

/**
 * Add/edit form for a single city unit, in a modal like the account types — the
 * dictionary stays a plain list, and the form always says which unit it is
 * editing instead of quietly re-filling the inputs above the table.
 */
const ZgnUnitFormModal: React.FC<ZgnUnitFormModalProps> = ({
  language,
  editing,
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
    onSubmit({ nazwa: n, email: e });
  };

  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }} style={{ zIndex }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <ModalDismiss onClose={onCancel} />
        <div className="modal-header">{editing ? t.edit : t.zgnUnitAdd}</div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t.zgnUnitName} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={nazwa}
              onChange={(e) => { setNazwa(e.target.value); if (localError) setLocalError(null); }}
              placeholder={t.zgnUnitNamePlaceholder}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>{t.zgnUnitEmail} <span style={{ color: 'red' }}>*</span></label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (localError) setLocalError(null); }}
              placeholder="np. zgn@um.example.pl"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>
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
            disabled={isSaving || !nazwa.trim() || !email.trim()}
          >
            <Icon name="save" size={14} />{' '}{editing ? t.update : t.add}
          </button>
        </div>
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

  const handleFormSubmit = async (data: { nazwa: string; email: string }) => {
    setIsSaving(true);
    setError(null);
    try {
      const editing = formState?.editing;
      if (editing) {
        await window.electronAPI.mailingUpdateZgn(editing.id, data.nazwa, data.email);
      } else {
        await window.electronAPI.mailingAddZgn(data.nazwa, data.email);
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
    const message =
      used > 0
        ? t.zgnConfirmDeleteUsed.replace('{count}', String(used))
        : t.zgnConfirmDelete;
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <div style={{ fontSize: '12px', opacity: 0.7, maxWidth: '80ch' }}>{t.zgnUnitsHint}</div>
        <button
          type="button"
          className="button button-primary"
          onClick={() => { setError(null); setFormState({ editing: null }); }}
          disabled={isSaving}
          style={{ whiteSpace: 'nowrap' }}
        >
          <Icon name="plus" size={14} />{' '}{t.zgnUnitAdd}
        </button>
      </div>

      {error && !formState && (
        <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '8px' }}>{error}</div>
      )}

      {jednostki.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>{t.zgnUnitName}</th>
              <th>{t.zgnUnitEmail}</th>
              <th>{t.zgnUnitUsedBy}</th>
              <th>{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {jednostki.map((j) => (
              <tr key={j.id}>
                <td>{j.nazwa}</td>
                <td style={{ wordBreak: 'break-all' }}>{j.email}</td>
                <td>{adresy.filter((a) => a.zgnJednostkaId === j.id).length}</td>
                <td>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="button button-small button-primary"
                      onClick={() => { setError(null); setFormState({ editing: j }); }}
                      disabled={isSaving}
                    >
                      <Icon name="edit" size={13} />{' '}{t.edit}
                    </button>
                    <button
                      className="button button-small button-danger"
                      onClick={() => handleDelete(j)}
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
        <div className="empty-state">{t.zgnNoUnits}</div>
      )}

      {formState && (
        <ZgnUnitFormModal
          language={language}
          editing={formState.editing}
          isSaving={isSaving}
          error={error}
          zIndex={formZIndex}
          onSubmit={handleFormSubmit}
          onCancel={() => { setFormState(null); setError(null); }}
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
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <ModalDismiss onClose={onClose} />
        <div className="modal-header">{t.zgnUnitsTitle}</div>
        <div className="modal-body">
          {/* One layer above this modal, which already sits above the address form. */}
          <ZgnUnitsPanel {...panelProps} formZIndex={1200} />
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onClose}>
            {t.close}
          </button>
        </div>
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
  const [newAlternativeName, setNewAlternativeName] = useState('');
  const [newSwrkIdentifiers, setNewSwrkIdentifiers] = useState<string[]>([]);
  const [newSwrkIdentifier, setNewSwrkIdentifier] = useState('');
  const [newAccountNumbers, setNewAccountNumbers] = useState<string[]>([]);
  const [newAccountTypes, setNewAccountTypes] = useState<Record<string, number>>({});
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [accountNumberError, setAccountNumberError] = useState<string | null>(null);
  const [newBankId, setNewBankId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [mappingsAdres, setMappingsAdres] = useState<Adres | null>(null);

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
    setNewAlternativeName('');
    setNewSwrkIdentifiers([]);
    setNewSwrkIdentifier('');
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
    setNewAlternativeName('');
    setNewSwrkIdentifiers(adres.swrkIdentifiers || []);
    setNewSwrkIdentifier('');
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

  const handleAddAlternativeName = () => {
    if (newAlternativeName.trim()) {
      setNewAlternativeNames([...newAlternativeNames, newAlternativeName.trim()]);
      setNewAlternativeName('');
    }
  };

  const handleRemoveAlternativeName = (index: number) => {
    setNewAlternativeNames(newAlternativeNames.filter((_, i) => i !== index));
  };

  const handleAddSwrkIdentifier = () => {
    const trimmed = newSwrkIdentifier.trim();
    if (trimmed && !newSwrkIdentifiers.includes(trimmed)) {
      setNewSwrkIdentifiers([...newSwrkIdentifiers, trimmed]);
      setNewSwrkIdentifier('');
    }
  };

  const handleRemoveSwrkIdentifier = (index: number) => {
    setNewSwrkIdentifiers(newSwrkIdentifiers.filter((_, i) => i !== index));
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
        {isImporting && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              border: '6px solid #f3f3f3',
              borderTop: '6px solid #3498db',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
            <div style={{
              marginTop: '20px',
              color: 'white',
              fontSize: '18px',
              fontWeight: 'bold',
            }}>
              {t.importing}
            </div>
          </div>
        )}
        {tab === 'lista' && (
          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px',
              }}
            >
              <h2>{t.adresy}</h2>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {adresy.length > 0 && (
                  <button
                    className="button button-danger"
                    onClick={handleDeleteAll}
                  >
                    <Icon name="trash" size={14} />{' '}{t.deleteAllAdresy}
                  </button>
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
                ><Icon name="plus" size={14} />{' '}
                  {t.addAdres}
                </button>
              </div>
            </div>

            {(showAddAdres || editingAdres) && (
              <div className="modal-overlay" onClick={handleCancelEdit}>
                <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <ModalDismiss onClose={handleCancelEdit} />
                  <div className="modal-header">
                    {editingAdres ? t.editAdres : t.addNewAdres}
                  </div>
                  <div className="modal-body">
                    <div className="form-group">
                      <label>{t.nazwa} <span style={{ color: 'red' }}>*</span></label>
                      <input
                        type="text"
                        value={newNazwa}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNazwa(e.target.value)}
                        placeholder="np. Joliot-Curie"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>{t.adresBank}</label>
                      <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                        {t.adresBankHint}
                      </div>
                      <Select
                        value={newBankId ?? ''}
                        onChange={(v) => setNewBankId(v ? Number(v) : null)}
                        options={[
                          { value: '', label: t.adresNoBank },
                          ...banks.map((bank) => ({ value: String(bank.id), label: bank.name })),
                        ]}
                      />
                    </div>
                    <div className="form-group">
                      <label>{t.zgnUnit}</label>
                      <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                        {t.zgnUnitHint}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Select
                          value={newZgnJednostkaId ?? ''}
                          onChange={(v) => setNewZgnJednostkaId(v ? Number(v) : null)}
                          options={[
                            { value: '', label: t.zgnUnitNone },
                            ...zgnJednostki.map((j) => ({
                              value: String(j.id),
                              label: `${j.nazwa} — ${j.email}`,
                            })),
                          ]}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => setShowZgnUnitsModal(true)}
                          title={t.zgnUnitsTitle}
                        >
                          {t.zgnManageUnits}
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>{t.alternativeNames}</label>
                      <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                        {t.alternativeNamesHint}
                      </div>
                      {newAlternativeNames.length > 0 && (
                        <div style={{ marginBottom: '8px' }}>
                          {newAlternativeNames.map((name, index) => (
                            <div key={index} className="alternative-name-tag">
                              <span>{name}</span>
                              <button
                                onClick={() => handleRemoveAlternativeName(index)}
                                className="alternative-name-remove"
                                type="button"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={newAlternativeName}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewAlternativeName(e.target.value)}
                          onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddAlternativeName();
                            }
                          }}
                          placeholder="np. Joliot Curie, ul. Joliot-Curie"
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={handleAddAlternativeName}
                          disabled={!newAlternativeName.trim()}
                        ><Icon name="plus" size={14} />{' '}{t.addAlternativeName}
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>{t.swrkIdentifiers}</label>
                      <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                        {t.swrkIdentifiersHint}
                      </div>
                      {newSwrkIdentifiers.length > 0 && (
                        <div style={{ marginBottom: '8px' }}>
                          {newSwrkIdentifiers.map((id, index) => (
                            <div key={index} className="alternative-name-tag">
                              <span>{id}</span>
                              <button
                                onClick={() => handleRemoveSwrkIdentifier(index)}
                                className="alternative-name-remove"
                                type="button"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={newSwrkIdentifier}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setNewSwrkIdentifier(e.target.value)
                          }
                          onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddSwrkIdentifier();
                            }
                          }}
                          placeholder={t.swrkPlaceholder}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={handleAddSwrkIdentifier}
                          disabled={!newSwrkIdentifier.trim()}
                        ><Icon name="plus" size={14} />{' '}{t.addSwrkIdentifier}
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>{t.accountNumbers}</label>
                      <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                        {t.accountNumbersHint}
                      </div>
                      {newAccountNumbers.length > 0 && (
                        <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {newAccountNumbers.map((acc, index) => (
                            <div
                              key={index}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                flexWrap: 'wrap',
                                padding: '6px 8px',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '6px',
                              }}
                            >
                              <span style={{ fontFamily: 'monospace', flex: '1 1 200px', wordBreak: 'break-all' }}>{acc}</span>
                              {kontoTypy.length > 0 && (
                                <Select
                                  size="sm"
                                  value={newAccountTypes[acc] ?? ''}
                                  onChange={(v) => handleAccountTypeChange(acc, Number(v))}
                                  options={kontoTypy.map((typ) => ({
                                    value: String(typ.id),
                                    label: `${typ.name} (${typ.bankAccountSymbol})`,
                                  }))}
                                  style={{ flex: '0 1 200px' }}
                                  title={t.accountTypeForNumber}
                                />
                              )}
                              <button
                                onClick={() => handleRemoveAccountNumber(index)}
                                className="alternative-name-remove"
                                type="button"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={newAccountNumber}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setNewAccountNumber(e.target.value);
                            if (accountNumberError) setAccountNumberError(null);
                          }}
                          onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddAccountNumber();
                            }
                          }}
                          placeholder={t.accountNumberPlaceholder}
                          style={{ flex: 1, fontFamily: 'monospace' }}
                        />
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={handleAddAccountNumber}
                          disabled={!newAccountNumber.trim()}
                        ><Icon name="plus" size={14} />{' '}{t.addAccountNumber}
                        </button>
                      </div>
                      {accountNumberError && (
                        <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '6px' }}>
                          {accountNumberError}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button
                      className="button button-secondary"
                      onClick={handleCancelEdit}
                    >
                      <Icon name="x" size={14} />{' '}{t.cancel}
                    </button>
                    <button
                      className="button button-success"
                      onClick={editingAdres ? handleUpdateAdres : handleAddAdres}
                    >
                      <Icon name="save" size={14} />{' '}{editingAdres ? t.update : t.add}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {adresy.length > 0 && (
              <div className="form-group" style={{ marginBottom: '15px' }}>
                <input
                  type="text"
                  placeholder={t.searchAdresy}
                  value={searchTerm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                />
              </div>
            )}

            {adresy.length > 0 ? (
              <>
                <div style={{ marginBottom: '10px', fontSize: '14px', opacity: 0.7 }}>
                  {t.totalAdresy}: {filteredAdresy.length} / {adresy.length}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>{t.nazwa}</th>
                      <th>{t.adresBank}</th>
                      <th>{t.swrkIdentifiers}</th>
                      <th>{t.accountNumbers}</th>
                      <th>{t.zgnUnit}</th>
                      <th>{t.apartmentMappings}</th>
                      <th>{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdresy.map((adres) => (
                      <tr key={adres.id}>
                        <td>
                          <div>{adres.nazwa}</div>
                          {adres.alternativeNames && adres.alternativeNames.length > 0 && (
                            <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>
                              {adres.alternativeNames.join(', ')}
                            </div>
                          )}
                        </td>
                        <td>
                          {adres.bankId
                            ? banks.find((b) => b.id === adres.bankId)?.name ?? '—'
                            : '—'}
                        </td>
                        <td style={{ wordBreak: 'break-all' }}>
                          {adres.swrkIdentifiers && adres.swrkIdentifiers.length > 0
                            ? adres.swrkIdentifiers.join(', ')
                            : '—'}
                        </td>
                        <td style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '11px' }}>
                          {adres.accountNumbers && adres.accountNumbers.length > 0
                            ? adres.accountNumbers.map((acc) => {
                                const typeId = adres.accountTypes?.[acc];
                                const typ = kontoTypy.find((k) => k.id === typeId);
                                return (
                                  <div key={acc} style={{ marginBottom: '2px' }}>
                                    {acc}
                                    {typ && (
                                      <span style={{ color: 'var(--accent)', marginLeft: '6px' }}>
                                        · {typ.name} ({typ.bankAccountSymbol})
                                      </span>
                                    )}
                                  </div>
                                );
                              })
                            : '—'}
                        </td>
                        <td style={{ fontSize: '12px' }}>
                          {(() => {
                            const jednostka = zgnJednostki.find((j) => j.id === adres.zgnJednostkaId);
                            if (!jednostka) return '—';
                            return (
                              <>
                                <div>{jednostka.nazwa}</div>
                                <div style={{ opacity: 0.6, wordBreak: 'break-all' }}>{jednostka.email}</div>
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          <button
                            className="button button-small button-secondary"
                            onClick={() => setMappingsAdres(adres)}
                            title={t.apartmentMappingsTitle}
                          ><Icon name="clipboard" size={13} />{' '}
                            {t.apartmentMappings} ({adres.apartmentMappings?.length ?? 0})
                          </button>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              className="button button-small button-primary"
                              onClick={() => handleEditAdres(adres)}
                            ><Icon name="edit" size={13} />{' '}
                              {t.edit}
                            </button>
                            <button
                              className="button button-small button-danger"
                              onClick={() => handleDeleteAdres(adres.id)}
                            ><Icon name="trash" size={13} />{' '}
                              {t.delete}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="empty-state">{t.noAdresyConfigured}</div>
            )}
          </div>
        )}

        {tab === 'typy' && (
          <AccountTypesPanel language={language} kontoTypy={kontoTypy} onSaved={loadData} />
        )}

        {tab === 'zgn' && (
          <div className="card">
            <h2 style={{ margin: '0 0 12px' }}>{t.zgnUnitsTitle}</h2>
            <ZgnUnitsPanel
              language={language}
              jednostki={zgnJednostki}
              adresy={adresy}
              onSaved={loadData}
            />
          </div>
        )}

        {mappingsAdres && (
          <ApartmentMappingsModal
            adres={mappingsAdres}
            language={language}
            onClose={() => setMappingsAdres(null)}
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
