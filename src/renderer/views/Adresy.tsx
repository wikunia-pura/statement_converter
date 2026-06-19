import React, { useState, useEffect } from 'react';
import { Adres, Bank, ApartmentMapping } from '../../shared/types';
import { translations, Language } from '../translations';
import { normalizeAccount } from '../../shared/account-extractor';

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
            {t.cancel}
          </button>
          <button
            className="button button-success"
            onClick={handleSubmit}
            disabled={isSaving || !matchText.trim() || !apartmentNumber.trim()}
          >
            {editing ? t.update : t.add}
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
    if (!confirm(t.confirmDeleteAdres)) return;
    await persist(mappings.filter(m => m.id !== id));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
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
            >
              + {t.addApartmentMapping}
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
                        >
                          {t.edit}
                        </button>
                        <button
                          className="button button-small button-danger"
                          onClick={() => handleDelete(m.id)}
                          disabled={isSaving}
                        >
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
            {t.cancel}
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

interface AdresyProps {
  language: Language;
  /** When set, opens the "add address" modal with this account number pre-filled. The parent should clear it once consumed. */
  prefillAccountNumber?: string | null;
  onPrefillConsumed?: () => void;
}

const Adresy: React.FC<AdresyProps> = ({ language, prefillAccountNumber, onPrefillConsumed }) => {
  const t = translations[language];
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [showAddAdres, setShowAddAdres] = useState(false);
  const [editingAdres, setEditingAdres] = useState<Adres | null>(null);
  const [newNazwa, setNewNazwa] = useState('');
  const [newAlternativeNames, setNewAlternativeNames] = useState<string[]>([]);
  const [newAlternativeName, setNewAlternativeName] = useState('');
  const [newSwrkIdentifiers, setNewSwrkIdentifiers] = useState<string[]>([]);
  const [newSwrkIdentifier, setNewSwrkIdentifier] = useState('');
  const [newAccountNumbers, setNewAccountNumbers] = useState<string[]>([]);
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
      const [adresyData, banksData] = await Promise.all([
        window.electronAPI.getAdresy(),
        window.electronAPI.getBanks(),
      ]);
      setAdresy(adresyData);
      setBanks(banksData);
    } catch (error) {
      console.error('Error loading adresy:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAdres = async () => {
    if (!newNazwa) {
      alert(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive)
    const duplicateExists = adresy.some(
      a => a.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      alert(t.duplicateAdresName);
      return;
    }

    try {
      await window.electronAPI.addAdres(
        newNazwa,
        newAlternativeNames,
        newSwrkIdentifiers,
        newBankId,
        newAccountNumbers,
      );
      resetForm();
      setShowAddAdres(false);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t.errorAddingAdres}: ${errorMessage}`);
    }
  };

  const handleUpdateAdres = async () => {
    if (!editingAdres || !newNazwa) {
      alert(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive), excluding current adres
    const duplicateExists = adresy.some(
      a => a.id !== editingAdres.id && a.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      alert(t.duplicateAdresName);
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
      );
      resetForm();
      setEditingAdres(null);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t.errorUpdatingAdres}: ${errorMessage}`);
    }
  };

  const handleDeleteAdres = async (id: number) => {
    if (confirm(t.confirmDeleteAdres)) {
      try {
        await window.electronAPI.deleteAdres(id);
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        alert(`${t.errorDeletingAdres}: ${errorMessage}`);
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
    setNewAccountNumber('');
    setAccountNumberError(null);
    setNewBankId(null);
  };

  const handleEditAdres = (adres: Adres) => {
    setEditingAdres(adres);
    setNewNazwa(adres.nazwa);
    setNewAlternativeNames(adres.alternativeNames || []);
    setNewAlternativeName('');
    setNewSwrkIdentifiers(adres.swrkIdentifiers || []);
    setNewSwrkIdentifier('');
    setNewAccountNumbers(adres.accountNumbers || []);
    setNewAccountNumber('');
    setAccountNumberError(null);
    setNewBankId(adres.bankId ?? null);
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
    setNewAccountNumber('');
    setAccountNumberError(null);
  };

  const handleRemoveAccountNumber = (index: number) => {
    setNewAccountNumbers(newAccountNumbers.filter((_, i) => i !== index));
  };

  const handleImportFromFile = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importAdresyFromFile();
      if (result.success) {
        alert(t.importAdresySuccess.replace('{count}', result.count.toString()));
        loadData();
      } else if (result.error) {
        alert(`${t.importAdresyError}: ${result.error}`);
      }
    } catch (error) {
      alert(t.importAdresyError);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportToFile = async () => {
    try {
      const result = await window.electronAPI.exportAdresyToFile();
      if (result.success) {
        alert(t.exportAdresySuccess.replace('{count}', result.count.toString()));
      } else if (result.error) {
        alert(`${t.exportAdresyError}: ${result.error}`);
      }
    } catch (error) {
      alert(t.exportAdresyError);
    }
  };

  const handleDeleteAll = async () => {
    if (confirm(t.confirmDeleteAllAdresy)) {
      try {
        await window.electronAPI.deleteAllAdresy();
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        alert(`${t.errorDeletingAdres}: ${errorMessage}`);
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

  const filteredAdresy = adresy.filter((a) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    if (a.nazwa.toLowerCase().includes(q)) return true;
    if (a.alternativeNames?.some((n) => n.toLowerCase().includes(q))) return true;
    if (a.swrkIdentifiers?.some((s) => s.toLowerCase().includes(q))) return true;
    if (a.accountNumbers?.some((acc) => acc.includes(q.replace(/\s/g, '')))) return true;
    return false;
  });

  return (
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
          <div style={{ display: 'flex', gap: '10px' }}>
            {adresy.length > 0 && (
              <button
                className="button button-danger"
                onClick={handleDeleteAll}
              >
                {t.deleteAllAdresy}
              </button>
            )}
            <button
              className="button button-secondary"
              onClick={handleImportFromFile}
              disabled={isImporting}
            >
              {t.importFromFile}
            </button>
            <button
              className="button button-secondary"
              onClick={handleExportToFile}
              disabled={adresy.length === 0}
            >
              {t.exportToFile}
            </button>
            <button
              className="button button-primary"
              onClick={() => setShowAddAdres(true)}
              disabled={showAddAdres || editingAdres !== null}
            >
              {t.addAdres}
            </button>
          </div>
        </div>

        {(showAddAdres || editingAdres) && (
          <div className="modal-overlay" onClick={handleCancelEdit}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
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
                  <select
                    value={newBankId ?? ''}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      setNewBankId(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">{t.adresNoBank}</option>
                    {banks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
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
                    >
                      + {t.addAlternativeName}
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
                    >
                      + {t.addSwrkIdentifier}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label>{t.accountNumbers}</label>
                  <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                    {t.accountNumbersHint}
                  </div>
                  {newAccountNumbers.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      {newAccountNumbers.map((acc, index) => (
                        <div key={index} className="alternative-name-tag">
                          <span style={{ fontFamily: 'monospace' }}>{acc}</span>
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
                    >
                      + {t.addAccountNumber}
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
                  {t.cancel}
                </button>
                <button
                  className="button button-success"
                  onClick={editingAdres ? handleUpdateAdres : handleAddAdres}
                >
                  {editingAdres ? t.update : t.add}
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
                        ? adres.accountNumbers.join(', ')
                        : '—'}
                    </td>
                    <td>
                      <button
                        className="button button-small button-secondary"
                        onClick={() => setMappingsAdres(adres)}
                        title={t.apartmentMappingsTitle}
                      >
                        {t.apartmentMappings} ({adres.apartmentMappings?.length ?? 0})
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="button button-small button-primary"
                          onClick={() => handleEditAdres(adres)}
                        >
                          {t.edit}
                        </button>
                        <button
                          className="button button-small button-danger"
                          onClick={() => handleDeleteAdres(adres.id)}
                        >
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

      {mappingsAdres && (
        <ApartmentMappingsModal
          adres={mappingsAdres}
          language={language}
          onClose={() => setMappingsAdres(null)}
          onSaved={loadData}
        />
      )}
    </div>
  );
};

export default Adresy;
