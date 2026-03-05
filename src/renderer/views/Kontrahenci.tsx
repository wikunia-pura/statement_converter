import React, { useState, useEffect } from 'react';
import { Kontrahent } from '../../shared/types';
import { translations, Language } from '../translations';

interface KontrahenciProps {
  language: Language;
}

const Kontrahenci: React.FC<KontrahenciProps> = ({ language }) => {
  const t = translations[language];
  const [kontrahenci, setKontrahenci] = useState<Kontrahent[]>([]);
  const [showAddKontrahent, setShowAddKontrahent] = useState(false);
  const [editingKontrahent, setEditingKontrahent] = useState<Kontrahent | null>(null);
  const [newNazwa, setNewNazwa] = useState('');
  const [newKontoKontrahenta, setNewKontoKontrahenta] = useState('');
  const [newNip, setNewNip] = useState('');
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
      const kontrahenciData = await window.electronAPI.getKontrahenci();
      setKontrahenci(kontrahenciData);
    } catch (error) {
      console.error('Error loading kontrahenci:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddKontrahent = async () => {
    if (!newNazwa || !newKontoKontrahenta) {
      alert(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive)
    const duplicateExists = kontrahenci.some(
      k => k.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      alert(t.duplicateKontrahentName);
      return;
    }

    try {
      await window.electronAPI.addKontrahent(newNazwa, newKontoKontrahenta, newNip || undefined, newAlternativeNames);
      setNewNazwa('');
      setNewKontoKontrahenta('');
      setNewNip('');
      setNewAlternativeNames([]);
      setNewAlternativeName('');
      setShowAddKontrahent(false);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t.errorAddingKontrahent}: ${errorMessage}`);
    }
  };

  const handleUpdateKontrahent = async () => {
    if (!editingKontrahent || !newNazwa || !newKontoKontrahenta) {
      alert(t.fillAllFields);
      return;
    }

    // Check for duplicate name (case-insensitive), excluding current kontrahent
    const duplicateExists = kontrahenci.some(
      k => k.id !== editingKontrahent.id && k.nazwa.toLowerCase() === newNazwa.toLowerCase()
    );
    if (duplicateExists) {
      alert(t.duplicateKontrahentName);
      return;
    }

    try {
      await window.electronAPI.updateKontrahent(editingKontrahent.id, newNazwa, newKontoKontrahenta, newNip || undefined, newAlternativeNames);
      setNewNazwa('');
      setNewKontoKontrahenta('');
      setNewNip('');
      setNewAlternativeNames([]);
      setNewAlternativeName('');
      setEditingKontrahent(null);
      loadData();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`${t.errorUpdatingKontrahent}: ${errorMessage}`);
    }
  };

  const handleDeleteKontrahent = async (id: number) => {
    if (confirm(t.confirmDeleteKontrahent)) {
      try {
        await window.electronAPI.deleteKontrahent(id);
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        alert(`${t.errorDeletingKontrahent}: ${errorMessage}`);
      }
    }
  };

  const handleEditKontrahent = (kontrahent: Kontrahent) => {
    setEditingKontrahent(kontrahent);
    setNewNazwa(kontrahent.nazwa);
    setNewKontoKontrahenta(kontrahent.kontoKontrahenta);
    setNewNip(kontrahent.nip || '');
    setNewAlternativeNames(kontrahent.alternativeNames || []);
    setNewAlternativeName('');
  };

  const handleCancelEdit = () => {
    setEditingKontrahent(null);
    setShowAddKontrahent(false);
    setNewNazwa('');
    setNewKontoKontrahenta('');
    setNewNip('');
    setNewAlternativeNames([]);
    setNewAlternativeName('');
  };

  const handleImportFromFileFunky = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importKontrahenciFromFile();
      console.log('[UI] Import result:', result);
      if (result.success) {
        const message = t.importKontrahenciFromFileFunkySuccess
          .replace('{added}', result.added?.toString() || '0')
          .replace('{updated}', result.updated?.toString() || '0');
        alert(message);
        loadData();
      } else if (result.error) {
        alert(`${t.importKontrahenciError}: ${result.error}`);
      }
    } catch (error) {
      alert(t.importKontrahenciError);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromDOM = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.importKontrahenciFromDOM();
      if (result.success) {
        const message = t.importKontrahenciFromDOMSuccess
          .replace('{added}', result.added?.toString() || '0')
          .replace('{updated}', result.updated?.toString() || '0');
        alert(message);
        loadData();
      } else if (result.error) {
        alert(`${t.importKontrahenciError}: ${result.error}`);
      }
      // If success is false but no error, user canceled - do nothing
    } catch (error) {
      console.error('Error importing from DOM:', error);
      alert(`${t.importKontrahenciError}: ${error}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportToFile = async () => {
    try {
      const result = await window.electronAPI.exportKontrahenciToFile();
      if (result.success) {
        alert(t.exportKontrahenciSuccess.replace('{count}', result.count.toString()));
      } else if (result.error) {
        alert(`${t.exportKontrahenciError}: ${result.error}`);
      }
    } catch (error) {
      alert(t.exportKontrahenciError);
    }
  };

  const handleDeleteAll = async () => {
    if (confirm(t.confirmDeleteAllKontrahenci)) {
      try {
        await window.electronAPI.deleteAllKontrahenci();
        loadData();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        alert(`${t.errorDeletingKontrahent}: ${errorMessage}`);
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

  const filteredKontrahenci = kontrahenci.filter(k =>
    k.nazwa.toLowerCase().includes(searchTerm.toLowerCase()) ||
    k.kontoKontrahenta.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (k.nip && k.nip.toLowerCase().includes(searchTerm.toLowerCase()))
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
          <h2>{t.kontrahenci}</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {kontrahenci.length > 0 && (
              <button
                className="button button-danger"
                onClick={handleDeleteAll}
              >
                {t.deleteAllKontrahenci}
              </button>
            )}
            <button
              className="button button-secondary"
              onClick={handleImportFromFileFunky}
              disabled={isImporting}
            >
              {t.importFromFileFunky}
            </button>
            <button
              className="button button-secondary"
              onClick={handleImportFromDOM}
              disabled={isImporting}
            >
              {t.importFromDOM}
            </button>
            <button
              className="button button-secondary"
              onClick={handleExportToFile}
              disabled={kontrahenci.length === 0}
            >
              {t.exportToFile}
            </button>
            <button
              className="button button-primary"
              onClick={() => setShowAddKontrahent(true)}
              disabled={showAddKontrahent || editingKontrahent !== null}
            >
              {t.addKontrahent}
            </button>
          </div>
        </div>

        {(showAddKontrahent || editingKontrahent) && (
          <div className="bank-form">
            <h3 style={{ marginBottom: '10px' }}>
              {editingKontrahent ? t.editKontrahent : t.addNewKontrahent}
            </h3>
            <div className="form-group">
              <label>{t.nazwa}</label>
              <input
                type="text"
                value={newNazwa}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNazwa(e.target.value)}
                placeholder="np. Miasto Stołeczne Warszawa"
              />
            </div>
            <div className="form-group">
              <label>{t.kontoKontrahenta}</label>
              <input
                type="text"
                value={newKontoKontrahenta}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKontoKontrahenta(e.target.value)}
                placeholder="np. 201-00001"
              />
            </div>
            <div className="form-group">
              <label>{t.nip}</label>
              <input
                type="text"
                value={newNip}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewNip(e.target.value)}
                placeholder="np. 1234567890"
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
                  placeholder="np. Tech-Home, TECH HOME"
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
                onClick={editingKontrahent ? handleUpdateKontrahent : handleAddKontrahent}
                style={{ fontSize: '15px', padding: '10px 24px' }}
              >
                {editingKontrahent ? t.update : t.add}
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

        {kontrahenci.length > 0 && (
          <div className="form-group" style={{ marginBottom: '15px' }}>
            <input
              type="text"
              placeholder={t.searchKontrahenci}
              value={searchTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
            />
          </div>
        )}

        {kontrahenci.length > 0 ? (
          <>
            <div style={{ marginBottom: '10px', fontSize: '14px', opacity: 0.7 }}>
              {t.totalKontrahenci}: {filteredKontrahenci.length} / {kontrahenci.length}
            </div>
            <table>
              <thead>
                <tr>
                  <th>{t.nazwa}</th>
                  <th>{t.kontoKontrahenta}</th>
                  <th>{t.nip}</th>
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredKontrahenci.map((kontrahent) => (
                  <tr key={kontrahent.id}>
                    <td>
                      <div>{kontrahent.nazwa}</div>
                      {kontrahent.alternativeNames && kontrahent.alternativeNames.length > 0 && (
                        <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>
                          {kontrahent.alternativeNames.join(', ')}
                        </div>
                      )}
                    </td>
                    <td>{kontrahent.kontoKontrahenta}</td>
                    <td>{kontrahent.nip || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          className="button button-small button-primary"
                          onClick={() => handleEditKontrahent(kontrahent)}
                        >
                          {t.edit}
                        </button>
                        <button
                          className="button button-small button-danger"
                          onClick={() => handleDeleteKontrahent(kontrahent.id)}
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
          <div className="empty-state">{t.noKontrahenciConfigured}</div>
        )}
      </div>
    </div>
  );
};

export default Kontrahenci;
