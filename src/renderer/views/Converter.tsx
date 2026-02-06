import React, { useState, useEffect, useRef } from 'react';
import { FileEntry, Bank } from '../../shared/types';
import { translations, Language } from '../translations';

interface ConverterProps {
  language: Language;
  files: FileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  selectedBank: number | null;
  setSelectedBank: React.Dispatch<React.SetStateAction<number | null>>;
}

const Converter: React.FC<ConverterProps> = ({ language, files, setFiles, selectedBank, setSelectedBank }) => {
  const t = translations[language];
  const [banks, setBanks] = useState<Bank[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<FileEntry[]>(files);

  // Keep ref in sync with state
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    loadBanks();
  }, []);

  const loadBanks = async () => {
    setIsLoading(true);
    try {
      const banksData = await window.electronAPI.getBanks();
      setBanks(banksData);
    } finally {
      setIsLoading(false);
    }
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
      alert(t.pleaseSelectBank);
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
    // Get file from ref to ensure we have latest state
    const currentFile = filesRef.current.find((f) => f.id === fileId);
    
    if (!currentFile || !currentFile.bankId) return;

    // Update status to processing
    setFiles((prevFiles) =>
      prevFiles.map((f) => (f.id === fileId ? { ...f, status: 'processing' as const } : f))
    );

    try {
      const result = await window.electronAPI.convertFile(
        currentFile.filePath,
        currentFile.bankId,
        currentFile.fileName
      );

      if (result.success) {
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  status: 'success' as const,
                  errorMessage: result.duplicateWarning
                    ? t.fileExistsTimestamp
                    : undefined,
                }
              : f
          )
        );
      } else {
        setFiles((prevFiles) =>
          prevFiles.map((f) =>
            f.id === fileId
              ? { ...f, status: 'error' as const, errorMessage: result.error }
              : f
          )
        );
        alert(`${t.conversionFailed}: ${result.error}\n${t.checkBankConverter}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setFiles((prevFiles) =>
        prevFiles.map((f) =>
          f.id === fileId
            ? { ...f, status: 'error' as const, errorMessage }
            : f
        )
      );
      alert(`${t.conversionFailed}: ${errorMessage}`);
    }
  };

  const handleConvertAll = async () => {
    // Get IDs of files that need conversion from current ref state
    const fileIds = filesRef.current
      .filter((f) => (f.status === 'pending' || f.status === 'error') && f.bankId)
      .map((f) => f.id);
    
    // Convert each file sequentially
    for (const fileId of fileIds) {
      await handleConvert(fileId);
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
    <div className="content-body">
        {isLoading ? (
          <div className="card">
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              Loading...
            </div>
          </div>
        ) : !selectedBank ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🏦</div>
            <h2 style={{ marginBottom: '10px', fontSize: '24px', color: '#667eea' }}>
              {t.selectBank}
            </h2>
            <p style={{ color: '#7b87a1', marginBottom: '30px', fontSize: '16px' }}>
              Wybierz bank, aby rozpocząć konwersję plików
            </p>
            <div style={{ maxWidth: '400px', margin: '0 auto' }}>
              <select
                value={selectedBank || ''}
                onChange={(e) => setSelectedBank(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  fontSize: '16px',
                  borderRadius: '12px',
                  border: '2px solid #e8ecf1',
                  cursor: 'pointer',
                }}
              >
                <option value="">{t.chooseBank}</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            <div className="card">
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ marginBottom: '15px', fontSize: '18px', color: '#667eea' }}>{t.addFiles}</h2>
            <div className="bank-selector-inline">
              <label style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px', display: 'block' }}>
                {t.selectBank}
              </label>
              <select
                value={selectedBank || ''}
                onChange={(e) => setSelectedBank(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '15px',
                  borderRadius: '10px',
                  border: '2px solid #e8ecf1',
                  cursor: 'pointer',
                  fontWeight: '500',
                }}
              >
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </div>
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
              {t.dragDropFiles}
            </div>
          </div>
        </div>

        {files.length > 0 && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2>{t.files}</h2>
              <div className="button-group" style={{ margin: 0 }}>
                <button 
                  className="button button-success" 
                  onClick={handleConvertAll}
                  disabled={files.every(f => f.status === 'success')}
                  title={files.every(f => f.status === 'success') ? 'Wszystkie pliki są już skonwertowane' : ''}
                  style={files.every(f => f.status === 'success') ? { 
                    opacity: 0.5, 
                    cursor: 'not-allowed' 
                  } : {}}
                >
                  {t.convertAll}
                </button>
                <button className="button button-secondary" onClick={handleClearAll}>
                  {t.clearAll}
                </button>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t.fileName}</th>
                  <th>{t.bank}</th>
                  <th>{t.status}</th>
                  <th>{t.actions}</th>
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
                        <option value="">{t.chooseBank}</option>
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
                        {file.status === 'success' ? t.success : file.status === 'error' ? t.error : file.status === 'processing' ? t.processing : t.pending}
                      </span>
                      {file.errorMessage && (
                        <div style={{ fontSize: '12px', color: '#7f8c8d', marginTop: '10px' }}>
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
                              {t.open}
                            </button>
                            <button
                              className="button button-small button-secondary"
                              onClick={() => handleConvert(file.id)}
                            >
                              {t.convertAgain}
                            </button>
                          </>
                        )}
                        {(file.status === 'pending' || file.status === 'error') && (
                          <button
                            className="button button-small button-success"
                            onClick={() => handleConvert(file.id)}
                            disabled={!file.bankId}
                          >
                            {t.convert}
                          </button>
                        )}
                        <button
                          className="button button-small button-danger"
                          onClick={() => handleRemoveFile(file.id)}
                        >
                          {t.remove}
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
            <div className="empty-state-text">{t.noFilesAdded}</div>
          </div>
        )}
          </>
        )}
    </div>
  );
};

export default Converter;
