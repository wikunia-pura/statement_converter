import React, { useState, useEffect } from 'react';
import { Adres } from '../../shared/types';
import { translations, Language } from '../translations';

interface AdresyProps {
  language: Language;
}

const Adresy: React.FC<AdresyProps> = ({ language }) => {
  const t = translations[language];
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [showAddAdres, setShowAddAdres] = useState(false);
  const [editingAdres, setEditingAdres] = useState<Adres | null>(null);
  const [newNazwa, setNewNazwa] = useState('');
  const [newAlternativeNames, setNewAlternativeNames] = useState<string[]>([]);
  const [newAlternativeName, setNewAlternativeName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const adresyData = await window.electronAPI.getAdresy();
      setAdresy(adresyData);
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

    try {
      await window.electronAPI.addAdres(newNazwa, newAlternativeNames);
      setNewNazwa('');
      setNewAlternativeNames([]);
      setNewAlternativeName('');
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

    try {
      await window.electronAPI.updateAdres(editingAdres.id, newNazwa, newAlternativeNames);
      setNewNazwa('');
      setNewAlternativeNames([]);
      setNewAlternativeName('');
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

  const handleEditAdres = (adres: Adres) => {
    setEditingAdres(adres);
    setNewNazwa(adres.nazwa);
    setNewAlternativeNames(adres.alternativeNames || []);
    setNewAlternativeName('');
  };

  const handleCancelEdit = () => {
    setEditingAdres(null);
    setShowAddAdres(false);
    setNewNazwa('');
    setNewAlternativeNames([]);
    setNewAlternativeName('');
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

  const filteredAdresy = adresy.filter(a =>
    a.nazwa.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          <div className="bank-form">
            <h3 style={{ marginBottom: '10px' }}>
              {editingAdres ? t.editAdres : t.addNewAdres}
            </h3>
            <div className="form-group">
              <label>{t.nazwa}</label>
              <input
                type="text"
                value={newNazwa}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNazwa(e.target.value)}
                placeholder="np. Joliot-Curie"
              />
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
            <div className="button-group button-group-separator" style={{ marginTop: '20px', paddingTop: '15px' }}>
              <button
                className="button button-success"
                onClick={editingAdres ? handleUpdateAdres : handleAddAdres}
                style={{ fontSize: '15px', padding: '10px 24px' }}
              >
                {editingAdres ? t.update : t.add}
              </button>
              <button 
                className="button button-secondary" 
                onClick={handleCancelEdit}
                style={{ fontSize: '15px', padding: '10px 24px' }}
              >
                {t.cancel}
              </button>
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
    </div>
  );
};

export default Adresy;
