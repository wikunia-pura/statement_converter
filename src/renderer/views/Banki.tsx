import React, { useEffect, useState } from 'react';
import { Bank, Converter } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Icon from '../components/Icon';
import Loader from '../components/Loader';
import ModalDismiss from '../components/Modal';
import Select from '../components/Select';

interface BankiProps {
  language: Language;
}

const Banki: React.FC<BankiProps> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [converters, setConverters] = useState<Converter[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Bank | null>(null);
  const [name, setName] = useState('');
  const [converterId, setConverterId] = useState('');
  const [accountPrefixes, setAccountPrefixes] = useState<string[]>([]);
  const [newAccountPrefix, setNewAccountPrefix] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      await loadData();
      setIsLoading(false);
    })();
  }, []);

  const loadData = async () => {
    const [banksData, convertersData] = await Promise.all([
      window.electronAPI.getBanks(),
      window.electronAPI.getConverters(),
    ]);
    setBanks(banksData);
    setConverters(convertersData);
  };

  const resetForm = () => {
    setName('');
    setConverterId('');
    setAccountPrefixes([]);
    setNewAccountPrefix('');
    setEditing(null);
    setShowAdd(false);
  };

  const handleAdd = async () => {
    if (!name) {
      notify.warning(t.fillAllFields);
      return;
    }
    const duplicate = banks.some((b) => b.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      notify.warning(t.duplicateBankName);
      return;
    }
    try {
      await window.electronAPI.addBank(name, converterId, accountPrefixes);
      resetForm();
      loadData();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      notify.error(`${t.errorAddingBank}: ${msg}`);
    }
  };

  const handleUpdate = async () => {
    if (!editing || !name) {
      notify.warning(t.fillAllFields);
      return;
    }
    const duplicate = banks.some(
      (b) => b.id !== editing.id && b.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      notify.warning(t.duplicateBankName);
      return;
    }
    try {
      await window.electronAPI.updateBank(editing.id, name, converterId, accountPrefixes);
      resetForm();
      loadData();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      notify.error(`${t.errorUpdatingBank}: ${msg}`);
    }
  };

  const handleDelete = async (id: number) => {
    if (!(await notify.confirm(t.confirmDeleteBank, { danger: true }))) return;
    try {
      await window.electronAPI.deleteBank(id);
      loadData();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      notify.error(`${t.errorDeletingBank}: ${msg}`);
    }
  };

  const handleDeleteAll = async () => {
    if (!(await notify.confirm(t.confirmDeleteAllBanks, { danger: true }))) return;
    try {
      await window.electronAPI.deleteAllBanks();
      loadData();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      notify.error(`${t.errorDeletingBank}: ${msg}`);
    }
  };

  const handleEdit = (bank: Bank) => {
    setEditing(bank);
    setShowAdd(false);
    setName(bank.name);
    setConverterId(bank.converterId);
    setAccountPrefixes(bank.accountPrefixes || []);
    setNewAccountPrefix('');
  };

  const handleAddAccountPrefix = () => {
    const trimmed = newAccountPrefix.trim();
    if (trimmed && !accountPrefixes.includes(trimmed)) {
      setAccountPrefixes([...accountPrefixes, trimmed]);
      setNewAccountPrefix('');
    }
  };

  const handleRemoveAccountPrefix = (index: number) => {
    setAccountPrefixes(accountPrefixes.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importBanksFromFile();
      if (result.success && typeof result.count === 'number') {
        notify.success(t.importBanksSuccess.replace('{count}', String(result.count)));
        loadData();
      } else if (result.error) {
        notify.error(`${t.importBanksError}: ${result.error}`);
      }
    } catch {
      notify.error(t.importBanksError);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async () => {
    try {
      const result = await window.electronAPI.exportBanksToFile();
      if (result.success && typeof result.count === 'number') {
        notify.success(t.exportBanksSuccess.replace('{count}', String(result.count)));
      } else if (result.error) {
        notify.error(`${t.exportBanksError}: ${result.error}`);
      }
    } catch {
      notify.error(t.exportBanksError);
    }
  };

  const filteredBanks = banks.filter((b) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    if (b.name.toLowerCase().includes(q)) return true;
    if (b.converterId.toLowerCase().includes(q)) return true;
    if (b.accountPrefixes?.some((p) => p.toLowerCase().includes(q))) return true;
    return false;
  });

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  return (
    <div className="content-body">
      {isImporting && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center', alignItems: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            width: '60px', height: '60px',
            border: '6px solid #f3f3f3',
            borderTop: '6px solid #3498db',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <div style={{ marginTop: '20px', color: 'white', fontSize: '18px', fontWeight: 'bold' }}>
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
          <h2>{t.banki}</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {banks.length > 0 && (
              <button className="button button-danger" onClick={handleDeleteAll}>
                {t.deleteAllBanks}
              </button>
            )}
            <button
              className="button button-import"
              onClick={handleImport}
              disabled={isImporting}
            >
              {t.importFromFile}
            </button>
            <button
              className="button button-export"
              onClick={handleExport}
              disabled={banks.length === 0}
            >
              {t.exportToFile}
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                setEditing(null);
                setShowAdd(true);
                setName('');
                setConverterId('');
                setAccountPrefixes([]);
                setNewAccountPrefix('');
              }}
              disabled={showAdd || editing !== null}
            >
              {t.addBank}
            </button>
          </div>
        </div>

        {(showAdd || editing) && (
          <div className="modal-overlay" onClick={resetForm}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <ModalDismiss onClose={resetForm} />
              <div className="modal-header">
                {editing ? t.editBank : t.addNewBankView}
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label>{t.bankName} <span style={{ color: 'red' }}>*</span></label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="np. ING Bank"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>{t.converterType}</label>
                  <Select
                    value={converterId}
                    onChange={(v) => setConverterId(v)}
                    placeholder={t.chooseConverter}
                    options={converters.map((c) => ({ value: String(c.id), label: c.name }))}
                  />
                </div>
                <div className="form-group">
                  <label>{t.accountPrefixes}</label>
                  <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                    {t.accountPrefixesHint}
                  </div>
                  {accountPrefixes.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      {accountPrefixes.map((p, idx) => (
                        <div key={idx} className="alternative-name-tag">
                          <span>{p}</span>
                          <button
                            onClick={() => handleRemoveAccountPrefix(idx)}
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
                      value={newAccountPrefix}
                      onChange={(e) => setNewAccountPrefix(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddAccountPrefix();
                        }
                      }}
                      placeholder={t.accountPrefixPlaceholder}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={handleAddAccountPrefix}
                      disabled={!newAccountPrefix.trim()}
                    >
                      + {t.addAccountPrefix}
                    </button>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="button button-secondary"
                  onClick={resetForm}
                >
                  {t.cancel}
                </button>
                <button
                  className="button button-success"
                  onClick={editing ? handleUpdate : handleAdd}
                >
                  {editing ? t.update : t.add}
                </button>
              </div>
            </div>
          </div>
        )}

        {banks.length > 0 && (
          <div className="form-group" style={{ marginBottom: '15px' }}>
            <input
              type="text"
              placeholder={t.searchBanks}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        )}

        {banks.length > 0 ? (
          <>
            <div style={{ marginBottom: '10px', fontSize: '14px', opacity: 0.7 }}>
              {t.totalBanks}: {filteredBanks.length} / {banks.length}
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t.bankName}</th>
                  <th>{t.converterType}</th>
                  <th>{t.accountPrefixes}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredBanks.map((bank) => {
                  const converter = converters.find((c) => c.id === bank.converterId);
                  // Brak `converterId` jest dozwolony (bank tylko do Homebankingu); wartość przypisana, ale nieznana = błąd konfiguracji.
                  const converterMissing = !!bank.converterId && !converter;
                  return (
                    <tr
                      key={bank.id}
                      style={converterMissing ? { backgroundColor: 'rgba(220, 53, 69, 0.1)' } : {}}
                    >
                      <td>
                        {bank.name}
                        {converterMissing && (
                          <span
                            style={{
                              color: 'var(--danger)',
                              marginLeft: '8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                            title="Konwerter nie istnieje"
                          >
                            <Icon name="alert-triangle" size={14} />
                          </span>
                        )}
                      </td>
                      <td>
                        {converter?.name ||
                          (bank.converterId ? (
                            <span style={{ color: 'var(--danger)' }}>{bank.converterId}</span>
                          ) : (
                            '—'
                          ))}
                      </td>
                      <td style={{ wordBreak: 'break-all' }}>
                        {bank.accountPrefixes && bank.accountPrefixes.length > 0
                          ? bank.accountPrefixes.join(', ')
                          : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="button button-small button-primary"
                            onClick={() => handleEdit(bank)}
                          >
                            {t.edit}
                          </button>
                          <button
                            className="button button-small button-danger"
                            onClick={() => handleDelete(bank.id)}
                          >
                            {t.delete}
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
          <div className="empty-state">
            <div className="empty-state-icon"><Icon name="building" size={48} /></div>
            <div className="empty-state-text">{t.noBanksConfigured}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Banki;
