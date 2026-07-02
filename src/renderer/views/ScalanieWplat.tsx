import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import Icon from '../components/Icon';
import {
  ScalanieAnalyzedFile,
  ScalanieMergeFileInput,
  ScalanieMergeResult,
} from '../electronAPI';

export interface ScalanieFileEntry {
  filePath: string;
  fileName: string;
  status: 'analyzing' | 'ready' | 'error';
  date: string | null;
  lineCount: number;
  error?: string;
}

interface Props {
  language: Language;
  files: ScalanieFileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<ScalanieFileEntry[]>>;
}

function applyAnalyzed(
  prev: ScalanieFileEntry,
  data: ScalanieAnalyzedFile,
): ScalanieFileEntry {
  return {
    ...prev,
    status: 'ready',
    date: data.date,
    lineCount: data.lineCount,
    error: undefined,
  };
}

const ScalanieWplat: React.FC<Props> = ({ language, files, setFiles }) => {
  const t = translations[language];
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const filesRef = useRef<ScalanieFileEntry[]>(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const analyzeOne = async (filePath: string) => {
    const res = await window.electronAPI.scalanieAnalyzeFile(filePath);
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath) return f;
        if (res.error || !res.data) {
          return { ...f, status: 'error' as const, error: res.error ?? 'Unknown error' };
        }
        return applyAnalyzed(f, res.data);
      }),
    );
  };

  const addFiles = async (newFiles: { fileName: string; filePath: string }[]) => {
    const existingPaths = new Set(filesRef.current.map((f) => f.filePath));
    const uniqueFiles = newFiles.filter((f) => !existingPaths.has(f.filePath));
    if (uniqueFiles.length === 0) return;
    setFiles((prev) => [
      ...prev,
      ...uniqueFiles.map<ScalanieFileEntry>((p) => ({
        filePath: p.filePath,
        fileName: p.fileName,
        status: 'analyzing',
        date: null,
        lineCount: 0,
      })),
    ]);
    for (const f of uniqueFiles) {
      // sequential is fine — analyzing one file is fast
      await analyzeOne(f.filePath);
    }
  };

  const handlePickFiles = async () => {
    const picked = await window.electronAPI.scalanieSelectFiles();
    if (picked && picked.length > 0) await addFiles(picked);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files)
      .map((file) => ({
        fileName: file.name,
        filePath: (file as unknown as { path: string }).path,
      }))
      .filter((f) => f.filePath);
    if (dropped.length > 0) await addFiles(dropped);
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
    setLastResult(null);
    setLastOutputDir('');
  };

  const anyAnalyzing = useMemo(
    () => files.some((f) => f.status === 'analyzing'),
    [files],
  );

  const canMerge =
    !isProcessing &&
    !anyAnalyzing &&
    files.length > 0 &&
    files.every((f) => f.status === 'ready');

  const openOutput = (p: string) => window.electronAPI.openFile(p);

  const [lastResult, setLastResult] = useState<ScalanieMergeResult | null>(null);
  const [lastOutputDir, setLastOutputDir] = useState('');

  const mergeWithResults = async () => {
    const ready = filesRef.current.filter((f) => f.status === 'ready');
    if (ready.length === 0) {
      setStatusMessage(t.scalanieNothingToMerge);
      setStatusIsError(true);
      return;
    }
    // Use the configured "Folder SWRK" silently when set; otherwise prompt.
    const settings = await window.electronAPI.getSettings();
    const outputDir = settings.swrkFolder?.trim()
      ? settings.swrkFolder.trim()
      : await window.electronAPI.scalanieSelectOutputDir();
    if (!outputDir) return;

    setIsProcessing(true);
    setStatusMessage('');
    setLastResult(null);
    setLastOutputDir(outputDir);
    const payload: ScalanieMergeFileInput[] = ready.map((f) => ({
      filePath: f.filePath,
      date: f.date,
    }));
    const res = await window.electronAPI.scalanieMerge(payload, outputDir);
    setIsProcessing(false);
    if (res.error || !res.result) {
      setStatusMessage(`${t.scalanieMergeError}: ${res.error ?? 'unknown'}`);
      setStatusIsError(true);
      return;
    }
    setLastResult(res.result);
    setStatusMessage(`${t.scalanieMergeSuccess} → ${outputDir}`);
    setStatusIsError(false);
  };

  return (
    <div className="content-body">
      <div className="card">
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ marginBottom: '4px', fontSize: '18px', color: 'var(--accent)' }}>
            {t.scalanieTitle}
          </h2>
          <div style={{ fontSize: '13px', opacity: 0.7 }}>{t.scalanieSubtitle}</div>
        </div>

        <div
          className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handlePickFiles}
        >
          <div className="drop-zone-icon"><Icon name="upload" size={40} /></div>
          <div className="drop-zone-text">{t.dragDropFiles}</div>
        </div>
      </div>

      {!statusIsError && (statusMessage || lastResult) && (
        <div className="card" style={{ borderTop: '3px solid var(--success, #10b981)' }}>
          {statusMessage && (
            <div
              className="zaliczki-status zaliczki-status-success"
              style={{ marginBottom: lastResult ? '15px' : 0 }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>{statusMessage}</span>
            </div>
          )}

          {lastResult && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <h2 style={{ margin: 0 }}>{t.outputFilesTitle}</h2>
                {lastOutputDir && (
                  <button
                    className="button button-secondary"
                    onClick={() => openOutput(lastOutputDir)}
                    title={lastOutputDir}
                  >
                    <Icon name="folder" size={14} /> {t.openOutputFolder}
                  </button>
                )}
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '90px' }}>{t.scalanieFilesPerGroup}</th>
                    <th>{t.scalanieDate}</th>
                    <th style={{ textAlign: 'right' }}>{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{lastResult.fileCount}</td>
                    <td>
                      {lastResult.startDate && lastResult.endDate
                        ? lastResult.startDate === lastResult.endDate
                          ? lastResult.startDate
                          : `${lastResult.startDate} → ${lastResult.endDate}`
                        : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="button button-small button-primary"
                        onClick={() => openOutput(lastResult.outputPath)}
                      >
                        {t.notyOpenFile}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

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
            <h2>{t.inputFilesTitle}</h2>
            <div className="button-group" style={{ margin: 0 }}>
              <button
                className="button button-success"
                onClick={mergeWithResults}
                disabled={!canMerge}
                style={!canMerge ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              >
                <Icon name="bar-chart" size={14} />{' '}
                {isProcessing ? t.scalanieMerging : t.scalanieMergeAll}
              </button>
              <button
                className="button button-danger"
                onClick={clearAll}
                disabled={isProcessing}
              >
                <Icon name="trash" size={14} /> {t.scalanieClearAll}
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>{t.scalanieFile}</th>
                <th style={{ width: '110px' }}>{t.scalanieDate}</th>
                <th style={{ width: '70px' }}>{t.scalanieLines}</th>
                <th style={{ textAlign: 'right' }}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, idx) => (
                <tr key={f.filePath}>
                  <td>{idx + 1}</td>
                  <td style={{ wordBreak: 'break-all' }}>{f.fileName}</td>
                  <td>
                    {f.status === 'analyzing' ? (
                      <span style={{ opacity: 0.6 }}>{t.scalanieAnalyzing}</span>
                    ) : f.status === 'error' ? (
                      <span className="status-badge status-error">{f.error ?? t.error}</span>
                    ) : (
                      f.date ?? '—'
                    )}
                  </td>
                  <td>{f.status === 'ready' ? f.lineCount : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="button button-small button-danger"
                      onClick={() => removeFile(f.filePath)}
                      disabled={isProcessing}
                    >
                      {t.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {statusMessage && statusIsError && (
            <div
              className="zaliczki-status zaliczki-status-error"
              style={{ marginTop: '15px', marginBottom: 0 }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>{statusMessage}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="wallet" size={48} /></div>
          <div className="empty-state-text">{t.scalanieNoFiles}</div>
        </div>
      )}
    </div>
  );
};

export default ScalanieWplat;
