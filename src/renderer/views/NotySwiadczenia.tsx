import React, { useMemo, useRef, useState, useEffect } from 'react';
import { translations, Language } from '../translations';
import Icon from '../components/Icon';

export interface NotyFileEntry {
  fileName: string;
  filePath: string;
  status: 'pending' | 'running' | 'done' | 'error';
  outputPath?: string;
  error?: string;
}

interface Props {
  language: Language;
  files: NotyFileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<NotyFileEntry[]>>;
}

const NotySwiadczenia: React.FC<Props> = ({ language, files, setFiles }) => {
  const t = translations[language];
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const filesRef = useRef<NotyFileEntry[]>(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const addFiles = (newFiles: { fileName: string; filePath: string }[]) => {
    const existingPaths = new Set(filesRef.current.map((f) => f.filePath));
    const uniqueFiles = newFiles.filter((f) => !existingPaths.has(f.filePath));
    if (uniqueFiles.length === 0) return;
    setFiles((prev) => [
      ...prev,
      ...uniqueFiles.map<NotyFileEntry>((p) => ({
        fileName: p.fileName,
        filePath: p.filePath,
        status: 'pending',
      })),
    ]);
  };

  const handlePickPdfs = async () => {
    const picked = await window.electronAPI.notySelectPdfs();
    if (picked && picked.length > 0) addFiles(picked);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files)
      .filter((file) => file.name.toLowerCase().endsWith('.pdf'))
      .map((file) => ({
        fileName: file.name,
        filePath: (file as unknown as { path: string }).path,
      }))
      .filter((f) => f.filePath);
    if (dropped.length > 0) addFiles(dropped);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const removeFile = (filePath: string) => {
    setFiles((prev) => prev.filter((f) => f.filePath !== filePath));
  };

  const clearAll = () => {
    setFiles([]);
    setStatusMessage('');
  };

  const convertOne = async (filePath: string) => {
    setIsProcessing(true);
    setStatusMessage('');
    setFiles((prev) =>
      prev.map((f) => (f.filePath === filePath ? { ...f, status: 'running' } : f)),
    );
    const res = await window.electronAPI.notyConvert(filePath, null);
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath) return f;
        if (res.canceled) return { ...f, status: 'pending' };
        if (res.error) return { ...f, status: 'error', error: res.error };
        return { ...f, status: 'done', outputPath: res.filePath, error: undefined };
      }),
    );
    if (res.success && res.filePath) {
      setStatusMessage(`${t.notyConvertSuccess}: ${res.filePath}`);
      setStatusIsError(false);
    } else if (res.error) {
      setStatusMessage(`${t.notyConvertError}: ${res.error}`);
      setStatusIsError(true);
    }
    setIsProcessing(false);
  };

  const convertAll = async () => {
    const toProcess = filesRef.current.filter(
      (f) => f.status === 'pending' || f.status === 'error',
    );
    if (toProcess.length === 0) {
      setStatusMessage(t.notyNothingToProcess);
      setStatusIsError(true);
      return;
    }
    const outputDir = await window.electronAPI.notySelectOutputDir();
    if (!outputDir) return;

    setIsProcessing(true);
    setStatusMessage('');
    let okCount = 0;
    let errCount = 0;
    for (const entry of toProcess) {
      setFiles((prev) =>
        prev.map((f) => (f.filePath === entry.filePath ? { ...f, status: 'running' } : f)),
      );
      const res = await window.electronAPI.notyConvert(entry.filePath, outputDir);
      setFiles((prev) =>
        prev.map((f) => {
          if (f.filePath !== entry.filePath) return f;
          if (res.error) {
            errCount++;
            return { ...f, status: 'error', error: res.error };
          }
          okCount++;
          return { ...f, status: 'done', outputPath: res.filePath, error: undefined };
        }),
      );
    }
    setIsProcessing(false);
    if (errCount === 0) {
      setStatusMessage(`${t.notyConvertSuccess}: ${okCount} → ${outputDir}`);
      setStatusIsError(false);
    } else {
      setStatusMessage(`${okCount} OK, ${errCount} ${t.error.toLowerCase()}`);
      setStatusIsError(errCount > 0);
    }
  };

  const openOutput = (p?: string) => {
    if (p) window.electronAPI.openFile(p);
  };

  const anyPending = useMemo(
    () => files.some((f) => f.status === 'pending' || f.status === 'error'),
    [files],
  );

  return (
    <div className="content-body">
      <div className="card">
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ marginBottom: '4px', fontSize: '18px', color: 'var(--accent)' }}>
            {t.notyTitle}
          </h2>
          <div style={{ fontSize: '13px', opacity: 0.7 }}>{t.notySubtitle}</div>
        </div>

        <div
          className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handlePickPdfs}
        >
          <div className="drop-zone-icon"><Icon name="upload" size={40} /></div>
          <div className="drop-zone-text">{t.dragDropFiles}</div>
        </div>
      </div>

      {files.length > 0 ? (
        <div className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '15px',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <h2>{t.files}</h2>
            <div className="button-group" style={{ margin: 0 }}>
              <button
                className="button button-success"
                onClick={convertAll}
                disabled={isProcessing || !anyPending}
                title={!anyPending ? t.notyNothingToProcess : ''}
                style={!anyPending || isProcessing ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              >
                <Icon name="bar-chart" size={14} />{' '}
                {isProcessing ? t.notyConverting : t.notyConvertAll}
              </button>
              <button
                className="button button-secondary"
                onClick={clearAll}
                disabled={isProcessing}
              >
                <Icon name="trash" size={14} /> {t.notyClearAll}
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th style={{ width: '30%' }}>{t.notyFile}</th>
                <th style={{ width: '160px' }}>{t.notyStatus}</th>
                <th style={{ textAlign: 'right' }}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, idx) => {
                const badgeClass =
                  f.status === 'done'
                    ? 'status-success'
                    : f.status === 'error'
                    ? 'status-error'
                    : 'status-pending';
                const badgeText =
                  f.status === 'done'
                    ? t.success
                    : f.status === 'error'
                    ? t.error
                    : f.status === 'running'
                    ? t.notyStatusConverting
                    : t.pending;
                return (
                  <tr
                    key={f.filePath}
                    className={f.status === 'running' ? 'processing-row' : ''}
                  >
                    {f.status === 'running' ? (
                      <td colSpan={4}>
                        <div className="processing-loader">
                          <div className="loader-spinner"></div>
                          <div className="loader-content">
                            <span className="loader-text">
                              {t.notyStatusConverting}: <strong>{f.fileName}</strong>
                            </span>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td>{idx + 1}</td>
                        <td>{f.fileName}</td>
                        <td>
                          <span className={`status-badge ${badgeClass}`}>{badgeText}</span>
                          {f.error && (
                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--text-tertiary)',
                                marginTop: '6px',
                                cursor: 'pointer',
                                wordBreak: 'break-word',
                              }}
                              onClick={() => navigator.clipboard.writeText(f.error || '')}
                              title={f.error}
                            >
                              {f.error.slice(0, 120)}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                            {f.status === 'done' ? (
                              <>
                                <button
                                  className="button button-small button-primary"
                                  onClick={() => openOutput(f.outputPath)}
                                  style={{ whiteSpace: 'nowrap' }}
                                >
                                  {t.notyOpenFile}
                                </button>
                                <button
                                  className="button button-small button-secondary"
                                  onClick={() => convertOne(f.filePath)}
                                  disabled={isProcessing}
                                  style={{ whiteSpace: 'nowrap' }}
                                >
                                  {t.notyConvertAgain}
                                </button>
                              </>
                            ) : (
                              <button
                                className="button button-small button-success"
                                onClick={() => convertOne(f.filePath)}
                                disabled={isProcessing}
                                style={{ whiteSpace: 'nowrap' }}
                              >
                                {t.notyConvert}
                              </button>
                            )}
                            <button
                              className="button button-small button-danger"
                              onClick={() => removeFile(f.filePath)}
                              disabled={isProcessing}
                            >
                              {t.remove}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {statusMessage && (
            <div
              className={`zaliczki-status ${statusIsError ? 'zaliczki-status-error' : 'zaliczki-status-success'}`}
              style={{ marginTop: '15px', marginBottom: 0 }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>{statusMessage}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="file-text" size={48} /></div>
          <div className="empty-state-text">{t.notyNoFiles}</div>
        </div>
      )}
    </div>
  );
};

export default NotySwiadczenia;
