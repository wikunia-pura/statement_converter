import React, { useState, useEffect } from 'react';
import { Bank, Converter } from '../../shared/types';
import { translations, Language } from '../translations';

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

  const handleDarkModeToggle = async () => {
    const newValue = !darkMode;
    await window.electronAPI.setDarkMode(newValue);
    onDarkModeChange(newValue);
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
          loadData();
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
        {/* Appearance Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '20px' }}>{t.appearance}</h2>
          
          <div className="settings-row">
            <div className="settings-label">
              <span className="settings-label-main">🌙 {t.darkMode}</span>
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
              <span className="settings-label-main">🌍 {t.language}</span>
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
                  return (
                    <tr key={bank.id}>
                      <td>{bank.name}</td>
                      <td>{converter?.name || bank.converterId}</td>
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
              <div className="empty-state-icon">🏦</div>
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
              {converters.map((converter) => (
                <tr key={converter.id}>
                  <td>{converter.name}</td>
                  <td style={{ color: '#7f8c8d' }}>{converter.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Export/Import Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '20px' }}>📦 Zarządzanie ustawieniami</h2>
          <p style={{ color: '#6c757d', fontSize: '14px', marginBottom: '20px' }}>
            Eksportuj lub importuj swoje ustawienia, w tym listę banków i preferencje aplikacji.
          </p>
          <div className="button-group" style={{ marginTop: 0 }}>
            <button className="button button-primary" onClick={handleExportSettings}>
              📄 Eksportuj ustawienia
            </button>
            <button className="button button-secondary" onClick={handleImportSettings}>
              📂 Importuj ustawienia
            </button>
          </div>
        </div>

        {/* Updates */}
        <div className="card">
          <h2 style={{ marginBottom: '20px' }}>🔄 {t.checkForUpdates}</h2>
          <p style={{ color: '#6c757d', fontSize: '14px', marginBottom: '20px' }}>
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
              📋 Pokaż logi
            </button>
          </div>
          <p style={{ color: '#6c757d', fontSize: '12px', fontStyle: 'italic' }}>
            💡 Jeśli aktualizacja nie działa, sprawdź logi aby zobaczyć szczegóły błędu.
          </p>
        </div>
    </div>
  );
};

export default Settings;
