import React, { useState, useEffect, useRef } from 'react';
import { FileEntry, Bank } from '../../shared/types';

declare global {
  interface Window {
    electronAPI: any;
  }
}

const Converter: React.FC = () => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [selectedBank, setSelectedBank] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBanks();
  }, []);

  const loadBanks = async () => {
    const banksData = await window.electronAPI.getBanks();
    setBanks(banksData);
  };

  const handleFileSelect = async () => {
    const selectedFiles = await window.electronAPI.selectFiles();
    if (selectedFiles.length > 0 && selectedBank) {
      addFiles(selectedFiles, selectedBank);
    }
  };

  const addFiles = (newFiles: { fileName: string; filePath: string }[], bankId: number) => {
    const bank = banks.find((b) => b.id === bankId);
    const fileEntries: FileEntry[] = newFiles.map((file) => ({
      id: Math.random().toString(36).substr(2, 9),
      fileName: file.fileName,
      filePath: file.filePath,
      bankId: bankId,
      bankName: bank?.name || null,
      status: 'pending',
    }));
    setFiles([...files, ...fileEntries]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    if (!selectedBank) {
      alert('Please select a bank first');
      return;
    }

    const droppedFiles = Array.from(e.dataTransfer.files).map((file) => ({
      fileName: file.name,
      filePath: file.path,
    }));

    addFiles(droppedFiles, selectedBank);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleBankChange = (fileId: string, bankId: number) => {
    setFiles(
      files.map((file) => {
        if (file.id === fileId) {
          const bank = banks.find((b) => b.id === bankId);
          return { ...file, bankId, bankName: bank?.name || null };
        }
        return file;
      })
    );
  };

  const handleConvert = async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file || !file.bankId) return;

    // Update status to processing
    setFiles(
      files.map((f) => (f.id === fileId ? { ...f, status: 'processing' as const } : f))
    );

    try {
      const result = await window.electronAPI.convertFile(
        file.filePath,
        file.bankId,
        file.fileName
      );

      if (result.success) {
        setFiles(
          files.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  status: 'success' as const,
                  errorMessage: result.duplicateWarning
                    ? 'File existed - saved with timestamp'
                    : undefined,
                }
              : f
          )
        );

        if (result.duplicateWarning) {
          alert('A file with this name already exists. Saved with timestamp.');
        }
      } else {
        setFiles(
          files.map((f) =>
            f.id === fileId
              ? { ...f, status: 'error' as const, errorMessage: result.error }
              : f
          )
        );
        alert(`Conversion failed: ${result.error}\nPlease check if the bank/converter is properly assigned.`);
      }
    } catch (error: any) {
      setFiles(
        files.map((f) =>
          f.id === fileId
            ? { ...f, status: 'error' as const, errorMessage: error.message }
            : f
        )
      );
      alert(`Conversion failed: ${error.message}`);
    }
  };

  const handleConvertAll = async () => {
    for (const file of files) {
      if (file.status === 'pending' || file.status === 'error') {
        await handleConvert(file.id);
      }
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles(files.filter((f) => f.id !== fileId));
  };

  const handleClearAll = () => {
    setFiles([]);
  };

  const handleOpenFile = async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (file && file.status === 'success') {
      const settings = await window.electronAPI.getSettings();
      const baseFileName = file.fileName.substring(0, file.fileName.lastIndexOf('.'));
      const outputPath = `${settings.outputFolder}/${baseFileName}.txt`;
      await window.electronAPI.openFile(outputPath);
    }
  };

  return (
    <>
      <div className="content-header">
        <h1>File Converter</h1>
      </div>
      <div className="content-body">
        <div className="card">
          <h2 style={{ marginBottom: '15px' }}>Add Files</h2>
          <div className="form-group">
            <label>Select Bank</label>
            <select
              value={selectedBank || ''}
              onChange={(e) => setSelectedBank(Number(e.target.value))}
            >
              <option value="">Choose a bank...</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleFileSelect}
          >
            <div className="drop-zone-icon">📁</div>
            <div className="drop-zone-text">
              Drag & drop files here or click to select
            </div>
            {!selectedBank && (
              <div style={{ color: '#e74c3c', marginTop: '10px', fontSize: '14px' }}>
                Please select a bank first
              </div>
            )}
          </div>
        </div>

        {files.length > 0 && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2>Files</h2>
              <div className="button-group" style={{ margin: 0 }}>
                <button className="button button-success" onClick={handleConvertAll}>
                  Convert All
                </button>
                <button className="button button-secondary" onClick={handleClearAll}>
                  Clear All
                </button>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>File Name</th>
                  <th>Bank</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file, index) => (
                  <tr key={file.id}>
                    <td>{index + 1}</td>
                    <td>{file.fileName}</td>
                    <td>
                      <select
                        value={file.bankId || ''}
                        onChange={(e) => handleBankChange(file.id, Number(e.target.value))}
                      >
                        <option value="">Choose bank...</option>
                        {banks.map((bank) => (
                          <option key={bank.id} value={bank.id}>
                            {bank.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        className={`status-badge status-${
                          file.status === 'success'
                            ? 'success'
                            : file.status === 'error'
                            ? 'error'
                            : 'pending'
                        }`}
                      >
                        {file.status}
                      </span>
                      {file.errorMessage && (
                        <div style={{ fontSize: '12px', color: '#7f8c8d', marginTop: '4px' }}>
                          {file.errorMessage}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {file.status === 'success' && (
                          <>
                            <button
                              className="button button-small button-primary"
                              onClick={() => handleOpenFile(file.id)}
                            >
                              Open
                            </button>
                            <button
                              className="button button-small button-secondary"
                              onClick={() => handleConvert(file.id)}
                            >
                              Convert Again
                            </button>
                          </>
                        )}
                        {(file.status === 'pending' || file.status === 'error') && (
                          <button
                            className="button button-small button-success"
                            onClick={() => handleConvert(file.id)}
                            disabled={!file.bankId}
                          >
                            Convert
                          </button>
                        )}
                        <button
                          className="button button-small button-danger"
                          onClick={() => handleRemoveFile(file.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {files.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">📄</div>
            <div className="empty-state-text">No files added yet</div>
          </div>
        )}
      </div>
    </>
  );
};

export default Converter;
