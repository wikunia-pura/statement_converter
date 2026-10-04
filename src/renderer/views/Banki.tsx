import React, { useEffect, useState } from 'react';
import { Bank, Converter } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import { FormField, FormRow, FormSection, RequiredNote } from '../components/FormSection';
import Icon from '../components/Icon';
import Loader, { BusyOverlay } from '../components/Loader';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import Select from '../components/Select';
import TagInput from '../components/TagInput';

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
        notify.success(t.exportBanksSuccess.replace('{count}', String(result.count)), {
          file: result.filePath,
        });
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
      {isImporting && <BusyOverlay label={t.importing} />}
      <FormSection
        icon="building"
        title={t.banki}
        description={t.bankiListDesc}
        aside={
          <div className="form-section__actions">
            {/* Mass delete is demoted: never the loudest button next to everyday actions. */}
            {banks.length > 0 && (
              <>
                <button className="button button-ghost icon-danger" onClick={handleDeleteAll}>
                  <Icon name="trash" size={14} />{' '}{t.deleteAllBanks}
                </button>
                <span className="toolbar-divider" aria-hidden="true" />
              </>
            )}
            <button className="button button-import" onClick={handleImport} disabled={isImporting}>
              <Icon name="upload" size={14} />{' '}{t.importFromFile}
            </button>
            <button className="button button-export" onClick={handleExport} disabled={banks.length === 0}>
              <Icon name="download" size={14} />{' '}{t.exportToFile}
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                setEditing(null);
                setShowAdd(true);
                setName('');
                setConverterId('');
                setAccountPrefixes([]);
              }}
              disabled={showAdd || editing !== null}
            >
              <Icon name="plus" size={14} />{' '}{t.addBank}
            </button>
          </div>
        }
      >
        {(showAdd || editing) && (
          <div className="modal-overlay" onClick={resetForm}>
            <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
              <ModalDismiss onClose={resetForm} />
              <ModalHeader
                icon="building"
                title={editing ? t.editBank : t.addNewBankView}
                subtitle={editing ? editing.name : t.bankFormSubtitleAdd}
              />
              <div className="modal-body modal-body--sectioned">
                <FormSection icon="building" title={t.bankSection} description={t.bankSectionDesc}>
                  <FormRow>
                    <FormField label={t.bankName} htmlFor="bank-name" required>
                      <input
                        id="bank-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="np. ING Bank"
                        autoFocus={!editing}
                      />
                    </FormField>
                    <FormField label={t.converterType} hint={t.bankConverterHint}>
                      <Select
                        overlay
                        value={converterId}
                        onChange={(v) => setConverterId(v)}
                        placeholder={t.chooseConverter}
                        options={converters.map((c) => ({ value: String(c.id), label: c.name }))}
                        ariaLabel={t.converterType}
                      />
                    </FormField>
                  </FormRow>
                </FormSection>
                <FormSection icon="search" title={t.bankSectionMatching} description={t.bankSectionMatchingDesc}>
                  <FormField label={t.accountPrefixes} htmlFor="bank-prefixes" hint={t.accountPrefixesHint}>
                    <TagInput
                      id="bank-prefixes"
                      values={accountPrefixes}
                      onChange={setAccountPrefixes}
                      placeholder={t.accountPrefixPlaceholder}
                      addLabel={t.add}
                      removeLabel={t.remove}
                      monospace
                    />
                  </FormField>
                </FormSection>
              </div>
              <ModalFooter
                note={<RequiredNote label={t.formRequiredNote} />}
                onCancel={resetForm}
                cancelLabel={t.cancel}
                onSubmit={editing ? handleUpdate : handleAdd}
                submitLabel={editing ? t.save : t.addNewBankView}
                submitIcon={editing ? 'save' : 'plus'}
                submitDisabled={!name.trim()}
                submitTitle={t.fillAllFields}
              />
            </div>
          </div>
        )}

        {banks.length > 0 ? (
          <>
            <div className="list-filter">
              <div className="input-icon">
                <Icon name="search" size={15} />
                <input
                  type="text"
                  placeholder={t.searchBanks}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label={t.searchBanks}
                />
              </div>
              <span className="list-filter__count">
                {t.totalBanks}: <strong>{filteredBanks.length}</strong> / {banks.length}
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.bankName}</th>
                  <th>{t.converterType}</th>
                  <th>{t.accountPrefixes}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredBanks.map((bank) => {
                  const converter = converters.find((c) => c.id === bank.converterId);
                  // Brak `converterId` jest dozwolony (bank tylko do Homebankingu); wartość przypisana, ale nieznana = błąd konfiguracji.
                  const converterMissing = !!bank.converterId && !converter;
                  return (
                    <tr key={bank.id}>
                      <td className="data-table__name">
                        <span className="cell-title">{bank.name}</span>
                      </td>
                      <td>
                        {converter ? (
                          converter.name
                        ) : converterMissing ? (
                          <span className="cell-warning is-danger" title={t.bankConverterMissing}>
                            <Icon name="alert-triangle" size={13} />
                            {bank.converterId}
                          </span>
                        ) : (
                          <span className="cell-empty">—</span>
                        )}
                      </td>
                      <td className="cell-mono">
                        {bank.accountPrefixes && bank.accountPrefixes.length > 0
                          ? bank.accountPrefixes.join(', ')
                          : <span className="cell-empty">—</span>}
                      </td>
                      <td className="data-table__actions">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="button button-small button-secondary"
                            onClick={() => handleEdit(bank)}
                          >
                            <Icon name="edit" size={13} />{' '}{t.edit}
                          </button>
                          <button
                            type="button"
                            className="button button-ghost button-icon icon-danger"
                            onClick={() => handleDelete(bank.id)}
                            title={t.delete}
                            aria-label={`${t.delete}: ${bank.name}`}
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
            <Icon name="building" size={16} />
            {t.noBanksConfigured}
          </div>
        )}
      </FormSection>
    </div>
  );
};

export default Banki;
