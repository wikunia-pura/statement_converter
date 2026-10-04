import React, { useMemo, useRef, useState, useEffect } from 'react';
import { translations, Language } from '../translations';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import { ModalFooter } from '../components/Modal';

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

  const statusLabel = (status: NotyFileEntry['status']) =>
    status === 'done' ? t.success : status === 'error' ? t.error : status === 'running' ? t.notyStatusConverting : t.pending;
  const statusClass = (status: NotyFileEntry['status']) =>
    status === 'done' ? 'status-success' : status === 'error' ? 'status-error' : 'status-pending';

  return (
    <div className="content-body">
      <div className="page-form">
        <FormSection icon="file-text" title={t.notyTitle} description={t.notySubtitle}>
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
        </FormSection>

        <FormSection
          icon="folder"
          title={t.files}
          description={files.length > 0 ? t.convFilesDesc : undefined}
          aside={
            files.length > 0 ? (
              <button className="button button-ghost icon-danger" onClick={clearAll} disabled={isProcessing}>
                <Icon name="trash" size={14} /> {t.convClear}
              </button>
            ) : undefined
          }
        >
          {files.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="data-table__index">#</th>
                  <th>{t.notyFile}</th>
                  <th>{t.notyStatus}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, idx) => (
                  <tr key={f.filePath} className={f.status === 'running' ? 'processing-row' : ''}>
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
                        <td className="data-table__index">{idx + 1}</td>
                        <td className="data-table__name">
                          <span className="cell-title">{f.fileName}</span>
                        </td>
                        <td>
                          <span className={`status-badge ${statusClass(f.status)}`}>{statusLabel(f.status)}</span>
                          {f.error && (
                            <button
                              type="button"
                              className="cell-error-detail"
                              onClick={() => navigator.clipboard.writeText(f.error || '')}
                              title={`${t.convErrorCopy}\n\n${f.error}`}
                            >
                              {f.error.slice(0, 120)}
                            </button>
                          )}
                        </td>
                        <td className="data-table__actions">
                          <div className="row-actions">
                            {f.status === 'done' ? (
                              <>
                                <button
                                  type="button"
                                  className="button button-small button-secondary"
                                  onClick={() => openOutput(f.outputPath)}
                                >
                                  <Icon name="folder" size={13} /> {t.openFile}
                                </button>
                                <button
                                  type="button"
                                  className="button button-small button-subtle"
                                  onClick={() => convertOne(f.filePath)}
                                  disabled={isProcessing}
                                >
                                  <Icon name="refresh" size={13} /> {t.notyConvertAgain}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="button button-small button-secondary"
                                onClick={() => convertOne(f.filePath)}
                                disabled={isProcessing}
                              >
                                <Icon name="arrow-right" size={13} /> {t.notyConvert}
                              </button>
                            )}
                            <button
                              type="button"
                              className="button button-ghost button-icon icon-danger"
                              onClick={() => removeFile(f.filePath)}
                              disabled={isProcessing}
                              title={t.remove}
                              aria-label={`${t.remove}: ${f.fileName}`}
                            >
                              <Icon name="trash" size={15} />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="form-empty">
              <Icon name="file-text" size={16} />
              {t.notyNoFiles}
            </div>
          )}
        </FormSection>

        {statusMessage && (
          <div className={`callout callout--${statusIsError ? 'danger' : 'success'}`} role="status">
            <Icon name={statusIsError ? 'alert-triangle' : 'check-circle'} size={16} />
            <div className="callout__body callout__body--path">{statusMessage}</div>
          </div>
        )}

        <ModalFooter
          className="page-action-bar"
          onSubmit={convertAll}
          submitLabel={isProcessing ? t.notyConverting : t.notyConvertAll}
          submitIcon="bar-chart"
          submitDisabled={!anyPending}
          submitTitle={t.notyNothingToProcess}
          busy={isProcessing}
        />
      </div>
    </div>
  );
};

export default NotySwiadczenia;
