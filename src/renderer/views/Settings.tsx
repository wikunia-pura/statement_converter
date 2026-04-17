import React, { useState, useEffect } from 'react';
import { Bank, Converter } from '../../shared/types';
import { translations, Language } from '../translations';
import Icon from '../components/Icon';

interface SettingsProps {
  darkMode: boolean;
  language: Language;
  onDarkModeChange: (enabled: boolean) => void;
  onLanguageChange: (language: Language) => void;
}

const Settings: React.FC<SettingsProps> = ({ darkMode, language, onDarkModeChange, onLanguageChange }) => {
  const t = translations[language];
  const [banks, setBanks] = useState<Bank[]>([]);
  const [converters, setConverters] = useState<Converter[]>([]);
  const [outputFolder, setOutputFolder] = useState('');
  const [impexFolder, setImpexFolder] = useState('');
  const [skipUserApproval, setSkipUserApproval] = useState(false);
  const [showAddBank, setShowAddBank] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);
  const [newBankName, setNewBankName] = useState('');
  const [newBankConverter, setNewBankConverter] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [banksData, convertersData, settings] = await Promise.all([
        window.electronAPI.getBanks(),
        window.electronAPI.getConverters(),
        window.electronAPI.getSettings(),
      ]);
      setBanks(banksData);
      setConverters(convertersData);
      setOutputFolder(settings.outputFolder);
      setImpexFolder(settings.impexFolder || '');
      setSkipUserApproval(settings.skipUserApproval ?? false);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectOutputFolder = async () => {
    const folder = await window.electronAPI.selectOutputFolder();
    if (folder) {
      await window.electronAPI.setOutputFolder(folder);
      setOutputFolder(folder);
    }
  };

  const handleSelectImpexFolder = async () => {
    const folder = await window.electronAPI.selectOutputFolder();
    if (folder) {
      await window.electronAPI.setImpexFolder(folder);
      setImpexFolder(folder);
    }
  };

  const handleDarkModeToggle = async () => {
    const newValue = !darkMode;
    await window.electronAPI.setDarkMode(newValue);
    onDarkModeChange(newValue);
  };

  const handleSkipUserApprovalToggle = async () => {
    const newValue = !skipUserApproval;
    
    // If enabling, show warning dialogs
    if (newValue) {
      // First warning
      const firstConfirm = window.confirm(
        `${t.skipApprovalWarningTitle}\n\n${t.skipApprovalWarningMessage}\n\nKliknij OK aby kontynuować lub Anuluj aby wrócić.`
      );
      
      if (!firstConfirm) {
        return; // User cancelled
      }
      
      // Second confirmation
      const secondConfirm = window.confirm(
        `${t.skipApprovalConfirmTitle}\n\n${t.skipApprovalConfirmMessage}`
      );
      
      if (!secondConfirm) {
        return; // User cancelled again
      }
    }
    
    await window.electronAPI.setSkipUserApproval(newValue);
    setSkipUserApproval(newValue);
  };

  const handleLanguageChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = e.target.value as Language;
    await window.electronAPI.setLanguage(newLanguage);
    onLanguageChange(newLanguage);
  };

  const handleAddBank = async () => {
    if (!newBankName || !newBankConverter) {
      alert(t.fillAllFields);
      return;
    }

    try {
      await window.electronAPI.addBank(newBankName, newBankConverter);
      setNewBankName('');
      setNewBankConverter('');
      setShowAddBank(false);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t.errorAddingBank}: ${errorMessage}`);
    }
  };

  const handleUpdateBank = async () => {
    if (!editingBank || !newBankName || !newBankConverter) {
      alert(t.fillAllFields);
      return;
    }

    try {
      await window.electronAPI.updateBank(editingBank.id, newBankName, newBankConverter);
      setNewBankName('');
      setNewBankConverter('');
      setEditingBank(null);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t.errorUpdatingBank}: ${errorMessage}`);
    }
  };

  const handleDeleteBank = async (id: number) => {
    if (confirm(t.confirmDeleteBank)) {
      try {
        await window.electronAPI.deleteBank(id);
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        alert(`${t.errorDeletingBank}: ${errorMessage}`);
      }
    }
  };

  const handleEditBank = (bank: Bank) => {
    setEditingBank(bank);
    setNewBankName(bank.name);
    setNewBankConverter(bank.converterId);
  };

  const handleCancelEdit = () => {
    setEditingBank(null);
    setShowAddBank(false);
    setNewBankName('');
    setNewBankConverter('');
  };

  const handleExportSettings = async () => {
    try {
      const result = await window.electronAPI.exportSettings();
      if (result.success) {
        alert(t.exportSuccess);
      }
    } catch (error) {
      alert(t.exportError);
    }
  };

  const handleImportSettings = async () => {
    if (confirm(t.importConfirm)) {
      try {
        const result = await window.electronAPI.importSettings();
        if (result.success) {
          alert(t.importSuccess);
          
          // Reload all data and settings
          await loadData();
          
          // Explicitly sync settings with parent component
          const settings = await window.electronAPI.getSettings();
          
          // Sync darkMode
          if (settings.darkMode !== darkMode) {
            onDarkModeChange(settings.darkMode);
          }
          
          // Sync language
          if (settings.language !== language) {
            onLanguageChange(settings.language);
          }
          
          // Explicitly update outputFolder in local state
          setOutputFolder(settings.outputFolder || '');
          setImpexFolder(settings.impexFolder || '');
          setSkipUserApproval(settings.skipUserApproval ?? false);
        } else if (result.error) {
          alert(`${t.importError}: ${result.error}`);
        }
      } catch (error) {
        alert(t.importError);
      }
    }
  };

  return (
    <div className="content-body">
        {/* Updates */}
        <div className="card">
          <h2 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="refresh" size={20} /> {t.checkForUpdates}
          </h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginBottom: '20px' }}>
            Sprawdź czy dostępna jest nowa wersja aplikacji.
          </p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button 
              className="button button-primary" 
              onClick={async () => {
                const result = await window.electronAPI.checkForUpdates();
                if (result.message) {
                  alert(result.message);
                } else if (result.error) {
                  alert(`Błąd: ${result.error}`);
                } else if (result.available) {
                  alert('Dostępna nowa wersja! Pojawi się powiadomienie.');
                } else {
                  alert('Nie znaleziono aktualizacji');
                }
              }}
            >
              Sprawdź aktualizacje
            </button>
            <button 
              className="button button-secondary" 
              onClick={async () => {
                const result = await window.electronAPI.openLogsFolder();
                if (result.success && result.logPath) {
                  console.log('Log file:', result.logPath);
                }
              }}
              title="Otwórz folder z logami aplikacji - pomaga w diagnozowaniu problemów z aktualizacjami"
            >
              <Icon name="clipboard" size={14} /> Pokaż logi
            </button>
          </div>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="info" size={12} /> Jeśli aktualizacja nie działa, sprawdź logi aby zobaczyć szczegóły błędu.
          </p>
        </div>

        {/* Appearance Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '20px' }}>{t.appearance}</h2>
          
          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main">{t.darkMode}</span>
              <span className="settings-label-sub">
                {darkMode ? 'Ciemny motyw jest włączony' : 'Jasny motyw jest włączony'}
              </span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={darkMode}
                onChange={handleDarkModeToggle}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main">{t.language}</span>
              <span className="settings-label-sub">Wybierz preferowany język</span>
            </div>
            <select value={language} onChange={handleLanguageChange} style={{ minWidth: '150px' }}>
              <option value="pl">{t.polish}</option>
              <option value="en">{t.english}</option>
            </select>
          </div>
        </div>

        {/* Output Folder Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>{t.outputFolder}</h2>
          <div className="form-group">
            <label>{t.convertedFilesSaved}</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input type="text" value={outputFolder} readOnly />
              <button className="button button-primary" onClick={handleSelectOutputFolder}>
                {t.change}
              </button>
            </div>
          </div>
        </div>

        {/* IMPEX Folder Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="folder" size={20} /> Folder IMPEX
          </h2>
          <div className="form-group">
            <label>
              Opcjonalna ścieżka dla dodatkowej kopii plików accounting
              <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '5px' }}>
                Jeśli ustawiona, każdy plik accounting będzie dodatkowo zapisany w tym folderze
              </span>
            </label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input 
                type="text" 
                value={impexFolder} 
                readOnly 
                placeholder="Nie ustawiono (opcjonalnie)"
              />
              <button className="button button-primary" onClick={handleSelectImpexFolder}>
                {t.change}
              </button>
              {impexFolder && (
                <button 
                  className="button button-secondary" 
                  onClick={async () => {
                    await window.electronAPI.setImpexFolder('');
                    setImpexFolder('');
                  }}
                  title="Wyczyść ścieżkę IMPEX"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Banks Management */}
        <div className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '15px',
            }}
          >
            <h2>{t.banks}</h2>
            <button
              className="button button-primary"
              onClick={() => setShowAddBank(true)}
              disabled={showAddBank || editingBank !== null}
            >
              {t.addBank}
            </button>
          </div>

          {(showAddBank || editingBank) && (
            <div className="bank-form">
              <h3 style={{ marginBottom: '10px' }}>
                {editingBank ? t.editBank : t.addNewBank}
              </h3>
              <div className="form-group">
                <label>{t.bankName}</label>
                <input
                  type="text"
                  value={newBankName}
                  onChange={(e) => setNewBankName(e.target.value)}
                  placeholder="e.g., ING Bank"
                />
              </div>
              <div className="form-group">
                <label>{t.converterType}</label>
                <select
                  value={newBankConverter}
                  onChange={(e) => setNewBankConverter(e.target.value)}
                >
                  <option value="">{t.chooseConverter}</option>
                  {converters.map((converter) => (
                    <option key={converter.id} value={converter.id}>
                      {converter.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="button-group" style={{ marginTop: '10px' }}>
                <button
                  className="button button-success"
                  onClick={editingBank ? handleUpdateBank : handleAddBank}
                >
                  {editingBank ? t.update : t.add}
                </button>
                <button className="button button-secondary" onClick={handleCancelEdit}>
                  {t.cancel}
                </button>
              </div>
            </div>
          )}

          {banks.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>{t.bankName}</th>
                  <th>{t.converterType}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {banks.map((bank) => {
                  const converter = converters.find((c) => c.id === bank.converterId);
                  const hasInvalidConverter = !converter;
                  return (
                    <tr key={bank.id} style={hasInvalidConverter ? { backgroundColor: 'rgba(220, 53, 69, 0.1)' } : {}}>
                      <td>
                        {bank.name}
                        {hasInvalidConverter && (
                          <span style={{ color: 'var(--danger)', marginLeft: '8px', display: 'inline-flex', alignItems: 'center' }} title="Konwerter nie istnieje">
                            <Icon name="alert-triangle" size={14} />
                          </span>
                        )}
                      </td>
                      <td>
                        {converter?.name || (
                          <span style={{ color: 'var(--danger)' }}>
                            {bank.converterId} (nie znaleziono)
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="button button-small button-primary"
                            onClick={() => handleEditBank(bank)}
                          >
                            {t.edit}
                          </button>
                          <button
                            className="button button-small button-danger"
                            onClick={() => handleDeleteBank(bank.id)}
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
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon"><Icon name="building" size={48} /></div>
              <div className="empty-state-text">{t.noBanksConfigured}</div>
            </div>
          )}
        </div>

        {/* Available Converters Info */}
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>{t.availableConverters}</h2>
          <table>
            <thead>
              <tr>
                <th>{t.converterName}</th>
                <th>{t.description}</th>
              </tr>
            </thead>
            <tbody>
              {converters.filter(c => c && c.id).map((converter) => (
                <tr key={converter.id}>
                  <td>{converter.name || converter.id}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{converter.description || 'No description'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Export/Import Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '20px' }}>📦 Zarządzanie ustawieniami</h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginBottom: '20px' }}>
            Eksportuj lub importuj swoje ustawienia, w tym listę banków i preferencje aplikacji.
          </p>
          <div className="button-group" style={{ marginTop: 0 }}>
            <button className="button button-primary" onClick={handleExportSettings}>
              <Icon name="download" size={14} /> Eksportuj ustawienia
            </button>
            <button className="button button-secondary" onClick={handleImportSettings}>
              <Icon name="upload" size={14} /> Importuj ustawienia
            </button>
          </div>
        </div>

        {/* Developer-only section - Skip Approval */}
        <div className="card" style={{ borderColor: 'var(--danger)', backgroundColor: 'rgba(220, 53, 69, 0.05)' }}>
          <h2 style={{ marginBottom: '20px', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="alert-triangle" size={20} /> {t.doNotUseSkipApproval}
          </h2>
          <p style={{ color: 'var(--danger)', fontSize: '14px', marginBottom: '15px', fontWeight: 'bold' }}>
            {t.skipApprovalWarningMessage}
          </p>
          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main" style={{ color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="alert-circle" size={14} /> {t.skipUserApproval}
              </span>
              <span className="settings-label-sub" style={{ color: 'var(--text-tertiary)' }}>
                {t.skipUserApprovalDesc}
              </span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={skipUserApproval}
                onChange={handleSkipUserApprovalToggle}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
    </div>
  );
};

export default Settings;
