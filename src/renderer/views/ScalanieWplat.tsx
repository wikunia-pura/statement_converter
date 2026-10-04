import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import { ModalFooter } from '../components/Modal';
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
      <div className="page-form">
        <FormSection icon="wallet" title={t.scalanieTitle} description={t.scalanieSubtitle}>
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
        </FormSection>

        <FormSection
          icon="folder"
          title={t.inputFilesTitle}
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
                  <th>{t.scalanieFile}</th>
                  <th>{t.scalanieDate}</th>
                  <th>{t.scalanieLines}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, idx) => (
                  <tr key={f.filePath}>
                    <td className="data-table__index">{idx + 1}</td>
                    <td className="data-table__name">
                      <span className="cell-title cell-wrap">{f.fileName}</span>
                    </td>
                    <td className="nowrap">
                      {f.status === 'analyzing' ? (
                        <span className="cell-empty">{t.scalanieAnalyzing}</span>
                      ) : f.status === 'error' ? (
                        <span className="status-badge status-error">{f.error ?? t.error}</span>
                      ) : (
                        f.date ?? <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td>{f.status === 'ready' ? f.lineCount : <span className="cell-empty">—</span>}</td>
                    <td className="data-table__actions">
                      <div className="row-actions">
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
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="form-empty">
              <Icon name="wallet" size={16} />
              {t.scalanieNoFiles}
            </div>
          )}
        </FormSection>

        {statusMessage && (
          <div className={`callout callout--${statusIsError ? 'danger' : 'success'}`} role="status">
            <Icon name={statusIsError ? 'alert-triangle' : 'check-circle'} size={16} />
            <div className="callout__body callout__body--path">{statusMessage}</div>
          </div>
        )}

        {!statusIsError && lastResult && (
          <FormSection
            icon="check-circle"
            title={t.outputFilesTitle}
            aside={
              lastOutputDir ? (
                <button
                  type="button"
                  className="button button-small button-subtle"
                  onClick={() => openOutput(lastOutputDir)}
                  title={lastOutputDir}
                >
                  <Icon name="folder" size={13} /> {t.openOutputFolder}
                </button>
              ) : undefined
            }
          >
            <table className="form-table">
              <thead>
                <tr>
                  <th>{t.scalanieFilesPerGroup}</th>
                  <th>{t.scalanieDate}</th>
                  <th className="data-table__actions">{t.actions}</th>
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
                  <td className="data-table__actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        onClick={() => openOutput(lastResult.outputPath)}
                      >
                        <Icon name="folder" size={13} /> {t.openFile}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </FormSection>
        )}

        <ModalFooter
          className="page-action-bar"
          onSubmit={mergeWithResults}
          submitLabel={isProcessing ? t.scalanieMerging : t.scalanieMergeAll}
          submitIcon="bar-chart"
          submitDisabled={!canMerge}
          submitTitle={t.scalanieNothingToMerge}
          busy={isProcessing}
        />
      </div>
    </div>
  );
};

export default ScalanieWplat;
