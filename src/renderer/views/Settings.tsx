import React, { useState, useEffect } from 'react';
import { Bank, Converter } from '../../shared/types';

declare global {
  interface Window {
    electronAPI: any;
  }
}

const Settings: React.FC = () => {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [converters, setConverters] = useState<Converter[]>([]);
  const [outputFolder, setOutputFolder] = useState('');
  const [showAddBank, setShowAddBank] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);
  const [newBankName, setNewBankName] = useState('');
  const [newBankConverter, setNewBankConverter] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [banksData, convertersData, settings] = await Promise.all([
      window.electronAPI.getBanks(),
      window.electronAPI.getConverters(),
      window.electronAPI.getSettings(),
    ]);
    setBanks(banksData);
    setConverters(convertersData);
    setOutputFolder(settings.outputFolder);
  };

  const handleSelectOutputFolder = async () => {
    const folder = await window.electronAPI.selectOutputFolder();
    if (folder) {
      await window.electronAPI.setOutputFolder(folder);
      setOutputFolder(folder);
    }
  };

  const handleAddBank = async () => {
    if (!newBankName || !newBankConverter) {
      alert('Please fill in all fields');
      return;
    }

    try {
      await window.electronAPI.addBank(newBankName, newBankConverter);
      setNewBankName('');
      setNewBankConverter('');
      setShowAddBank(false);
      loadData();
    } catch (error: any) {
      alert(`Error adding bank: ${error.message}`);
    }
  };

  const handleUpdateBank = async () => {
    if (!editingBank || !newBankName || !newBankConverter) {
      alert('Please fill in all fields');
      return;
    }

    try {
      await window.electronAPI.updateBank(editingBank.id, newBankName, newBankConverter);
      setNewBankName('');
      setNewBankConverter('');
      setEditingBank(null);
      loadData();
    } catch (error: any) {
      alert(`Error updating bank: ${error.message}`);
    }
  };

  const handleDeleteBank = async (id: number) => {
    if (confirm('Are you sure you want to delete this bank?')) {
      try {
        await window.electronAPI.deleteBank(id);
        loadData();
      } catch (error: any) {
        alert(`Error deleting bank: ${error.message}`);
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

  return (
    <>
      <div className="content-header">
        <h1>Settings</h1>
      </div>
      <div className="content-body">
        {/* Output Folder Settings */}
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>Output Folder</h2>
          <div className="form-group">
            <label>Converted files will be saved to:</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input type="text" value={outputFolder} readOnly />
              <button className="button button-primary" onClick={handleSelectOutputFolder}>
                Change
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
            <h2>Banks</h2>
            <button
              className="button button-primary"
              onClick={() => setShowAddBank(true)}
              disabled={showAddBank || editingBank !== null}
            >
              Add Bank
            </button>
          </div>

          {(showAddBank || editingBank) && (
            <div
              style={{
                background: '#f8f9fa',
                padding: '15px',
                borderRadius: '4px',
                marginBottom: '15px',
              }}
            >
              <h3 style={{ marginBottom: '10px' }}>
                {editingBank ? 'Edit Bank' : 'Add New Bank'}
              </h3>
              <div className="form-group">
                <label>Bank Name</label>
                <input
                  type="text"
                  value={newBankName}
                  onChange={(e) => setNewBankName(e.target.value)}
                  placeholder="e.g., ING Bank"
                />
              </div>
              <div className="form-group">
                <label>Converter</label>
                <select
                  value={newBankConverter}
                  onChange={(e) => setNewBankConverter(e.target.value)}
                >
                  <option value="">Choose converter...</option>
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
                  {editingBank ? 'Update' : 'Add'}
                </button>
                <button className="button button-secondary" onClick={handleCancelEdit}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {banks.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Bank Name</th>
                  <th>Converter</th>
                  <th>Actions</th>
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
                            Edit
                          </button>
                          <button
                            className="button button-small button-danger"
                            onClick={() => handleDeleteBank(bank.id)}
                          >
                            Delete
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
              <div className="empty-state-text">No banks configured yet</div>
            </div>
          )}
        </div>

        {/* Available Converters Info */}
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>Available Converters</h2>
          <table>
            <thead>
              <tr>
                <th>Converter Name</th>
                <th>Description</th>
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
      </div>
    </>
  );
};

export default Settings;
