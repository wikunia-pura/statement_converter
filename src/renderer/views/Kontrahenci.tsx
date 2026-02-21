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
  const [isLoading, setIsLoading] = useState(true);
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

    try {
      await window.electronAPI.addKontrahent(newNazwa, newKontoKontrahenta);
      setNewNazwa('');
      setNewKontoKontrahenta('');
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

    try {
      await window.electronAPI.updateKontrahent(editingKontrahent.id, newNazwa, newKontoKontrahenta);
      setNewNazwa('');
      setNewKontoKontrahenta('');
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
  };

  const handleCancelEdit = () => {
    setEditingKontrahent(null);
    setShowAddKontrahent(false);
    setNewNazwa('');
    setNewKontoKontrahenta('');
  };

  const handleImportFromFile = async () => {
    try {
      const result = await window.electronAPI.importKontrahenciFromFile();
      if (result.success) {
        alert(t.importKontrahenciSuccess.replace('{count}', result.count.toString()));
        loadData();
      } else if (result.error) {
        alert(`${t.importKontrahenciError}: ${result.error}`);
      }
    } catch (error) {
      alert(t.importKontrahenciError);
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

  const filteredKontrahenci = kontrahenci.filter(k =>
    k.nazwa.toLowerCase().includes(searchTerm.toLowerCase()) ||
    k.kontoKontrahenta.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="content-body">
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
            <button
              className="button button-secondary"
              onClick={handleImportFromFile}
            >
              {t.importFromFile}
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
            <div className="button-group" style={{ marginTop: '10px' }}>
              <button
                className="button button-success"
                onClick={editingKontrahent ? handleUpdateKontrahent : handleAddKontrahent}
              >
                {editingKontrahent ? t.update : t.add}
              </button>
              <button className="button button-secondary" onClick={handleCancelEdit}>
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

        {kontrahenci.length > 0 && (
          <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="button button-danger"
              onClick={handleDeleteAll}
            >
              {t.deleteAllKontrahenci}
            </button>
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
                  <th>{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredKontrahenci.map((kontrahent) => (
                  <tr key={kontrahent.id}>
                    <td>{kontrahent.nazwa}</td>
                    <td>{kontrahent.kontoKontrahenta}</td>
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
