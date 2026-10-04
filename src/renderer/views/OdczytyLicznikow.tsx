import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import { ModalFooter } from '../components/Modal';
import OdczytySkippedModal, { OdczytySkippedGroup } from '../components/OdczytySkippedModal';
import OdczytyHistoryTimeline from '../components/OdczytyHistoryTimeline';
import { OdczytyHistoryEntry } from '../../shared/types';
import {
  OdczytyAnalyzedFile,
  OdczytyConvertResult,
  OdczytySkipped,
} from '../electronAPI';

export interface OdczytyFileEntry {
  filePath: string;
  fileName: string;
  status: 'analyzing' | 'ready' | 'error';
  supplierLabel: string | null;
  communities: string[];
  latestDate: string | null;
  readingCount: number;
  skippedCount: number;
  skipped: OdczytySkipped[];
  error?: string;
}

interface Props {
  language: Language;
  files: OdczytyFileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<OdczytyFileEntry[]>>;
  /** Clicking "Full history" in the recent-activity panel switches to the Historia tab. */
  onNavigateToHistory?: () => void;
}

function applyAnalyzed(
  prev: OdczytyFileEntry,
  data: OdczytyAnalyzedFile,
): OdczytyFileEntry {
  return {
    ...prev,
    status: 'ready',
    supplierLabel: data.supplierLabel,
    communities: data.communities,
    latestDate: data.latestDate,
    readingCount: data.readingCount,
    skippedCount: data.skippedCount,
    skipped: data.skipped,
    error: undefined,
  };
}

const OdczytyLicznikow: React.FC<Props> = ({
  language,
  files,
  setFiles,
  onNavigateToHistory,
}) => {
  const t = translations[language];
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lastResult, setLastResult] = useState<OdczytyConvertResult | null>(null);
  const [skippedModal, setSkippedModal] = useState<OdczytySkippedGroup[] | null>(null);
  /** Path of the file currently converting on its own, for the per-row button. */
  const [convertingPath, setConvertingPath] = useState<string | null>(null);
  const [history, setHistory] = useState<OdczytyHistoryEntry[]>([]);
  const filesRef = useRef<OdczytyFileEntry[]>(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const loadHistory = async () => {
    try {
      setHistory(await window.electronAPI.odczytyGetHistory());
    } catch (error) {
      console.error('Error loading odczyty history:', error);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  // Recent-activity panel: only the last 30 days, so the conversion view stays a
  // quick reference rather than a second full history.
  const recentHistory = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return history.filter((entry) => new Date(entry.convertedAt).getTime() >= cutoff);
  }, [history]);

  const analyzeOne = async (filePath: string) => {
    const res = await window.electronAPI.odczytyAnalyzeFile(filePath);
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath) return f;
        if (res.error || !res.data) {
          return { ...f, status: 'error' as const, error: res.error ?? t.odczytyUnknownSupplier };
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
      ...uniqueFiles.map<OdczytyFileEntry>((p) => ({
        filePath: p.filePath,
        fileName: p.fileName,
        status: 'analyzing',
        supplierLabel: null,
        communities: [],
        latestDate: null,
        readingCount: 0,
        skippedCount: 0,
        skipped: [],
      })),
    ]);
    for (const f of uniqueFiles) {
      await analyzeOne(f.filePath);
    }
  };

  const handlePickFiles = async () => {
    const picked = await window.electronAPI.odczytySelectFiles();
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
    setSkippedModal(null);
  };

  const showSkipped = (entries: OdczytyFileEntry[]) => {
    const groups = entries
      .filter((f) => f.skipped.length > 0)
      .map<OdczytySkippedGroup>((f) => ({ fileName: f.fileName, rows: f.skipped }));
    if (groups.length > 0) setSkippedModal(groups);
  };

  const anyAnalyzing = useMemo(
    () => files.some((f) => f.status === 'analyzing'),
    [files],
  );

  const readyFiles = useMemo(
    () => files.filter((f) => f.status === 'ready' && f.readingCount > 0),
    [files],
  );

  const canConvert = !isProcessing && !anyAnalyzing && readyFiles.length > 0;

  const openOutput = (p: string) => window.electronAPI.openFile(p);

  /**
   * Convert `entries` — the whole ready set from the toolbar button, or a single
   * file from its row button.
   */
  const convert = async (entries: OdczytyFileEntry[], singlePath?: string) => {
    if (entries.length === 0) {
      setStatusMessage(t.odczytyNothingToConvert);
      setStatusIsError(true);
      return;
    }
    // The IMPEX folder is the module's home. Only when it isn't configured do we
    // fall back to asking, so the usual run stays a single click.
    const settings = await window.electronAPI.getSettings();
    let outputDir: string | null = null;
    if (!settings.impexFolder?.trim()) {
      setStatusMessage(t.odczytyImpexMissing);
      setStatusIsError(true);
      outputDir = await window.electronAPI.odczytySelectOutputDir();
      if (!outputDir) return;
    }

    setIsProcessing(true);
    setConvertingPath(singlePath ?? null);
    setStatusMessage('');
    setLastResult(null);
    const res = await window.electronAPI.odczytyConvert(
      entries.map((f) => f.filePath),
      outputDir,
    );
    setIsProcessing(false);
    setConvertingPath(null);
    if (res.error || !res.result) {
      setStatusMessage(`${t.odczytyError}: ${res.error ?? 'unknown'}`);
      setStatusIsError(true);
      return;
    }
    setLastResult(res.result);
    setStatusMessage(`${t.odczytySuccess} → ${res.result.outputDir}`);
    setStatusIsError(false);
    // The operation was just recorded server-side; refresh the panel below.
    void loadHistory();
  };

  const convertAll = () =>
    convert(filesRef.current.filter((f) => f.status === 'ready' && f.readingCount > 0));

  const convertOne = (entry: OdczytyFileEntry) => convert([entry], entry.filePath);

  return (
    <div className="content-body">
      {skippedModal && (
        <OdczytySkippedModal
          language={language}
          groups={skippedModal}
          onClose={() => setSkippedModal(null)}
        />
      )}
      <div className="page-form">
        <FormSection icon="zap" title={t.odczytyTitle} description={t.odczytySubtitle}>
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
                  <th>{t.odczytyFile}</th>
                  <th>{t.odczytySupplier}</th>
                  <th>{t.odczytyCommunities}</th>
                  <th>{t.odczytyDate}</th>
                  <th>{t.odczytyReadings}</th>
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
                    <td>
                      {f.status === 'analyzing' ? (
                        <span className="cell-empty">{t.odczytyAnalyzing}</span>
                      ) : f.status === 'error' ? (
                        <span className="status-badge status-error">{t.error}</span>
                      ) : (
                        <span className="status-badge status-success">{f.supplierLabel}</span>
                      )}
                    </td>
                    <td>
                      {f.status === 'error' ? (
                        <span className="cell-warning is-danger cell-wrap">{f.error}</span>
                      ) : (
                        f.communities.join(', ') || <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td className="nowrap">{f.latestDate ?? <span className="cell-empty">—</span>}</td>
                    <td className="nowrap">
                      {f.status === 'ready' ? (
                        <>
                          {f.readingCount}
                          {f.skippedCount > 0 && (
                            <button
                              type="button"
                              className="button button-small button-subtle cell-inline-action"
                              onClick={() => showSkipped([f])}
                              title={`${t.odczytySkipped}: ${f.skippedCount} — ${t.odczytySkippedShowDetails}`}
                            >
                              (−{f.skippedCount})
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td className="data-table__actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() => convertOne(f)}
                          disabled={isProcessing || f.status !== 'ready' || f.readingCount === 0}
                          title={t.odczytyConvertOne}
                        >
                          <Icon name="arrow-right" size={13} />{' '}
                          {convertingPath === f.filePath ? t.odczytyConverting : t.convert}
                        </button>
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
              <Icon name="zap" size={16} />
              {t.odczytyNoFiles}
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
              <button
                type="button"
                className="button button-small button-subtle"
                onClick={() => openOutput(lastResult.outputDir)}
                title={lastResult.outputDir}
              >
                <Icon name="folder" size={13} /> {t.openOutputFolder}
              </button>
            }
          >
            <table className="form-table">
              <thead>
                <tr>
                  <th>{t.odczytyCommunity}</th>
                  <th>{t.odczytyOutputFile}</th>
                  <th>{t.odczytyDate}</th>
                  <th>{t.odczytyReadings}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {lastResult.files.map((f) => (
                  <tr key={f.outputPath}>
                    <td className="form-table__label">{f.wm}</td>
                    <td className="cell-wrap">{f.fileName}</td>
                    <td className="nowrap">{f.date}</td>
                    <td>{f.readingCount}</td>
                    <td className="data-table__actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() => openOutput(f.outputPath)}
                        >
                          <Icon name="folder" size={13} /> {t.openFile}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lastResult.skippedCount > 0 && (
              <div className="callout callout--warning" role="status">
                <Icon name="alert-triangle" size={16} />
                <div className="callout__body">
                  {t.odczytySkipped}: {lastResult.skippedCount}
                </div>
                <button
                  type="button"
                  className="button button-small button-subtle"
                  onClick={() =>
                    setSkippedModal(
                      lastResult.sources
                        .filter((src) => src.skipped.length > 0)
                        .map((src) => ({ fileName: src.fileName, rows: src.skipped })),
                    )
                  }
                >
                  {t.odczytySkippedShowDetails}
                </button>
              </div>
            )}
          </FormSection>
        )}

        <ModalFooter
          className="page-action-bar"
          onSubmit={convertAll}
          submitLabel={isProcessing ? t.odczytyConverting : t.odczytyConvertAll}
          submitIcon="arrow-right"
          submitDisabled={!canConvert}
          busy={isProcessing}
        />

        {/* Recent activity — last 30 days, same timeline as the Historia tab. */}
        <FormSection
          icon="history"
          title={t.odczytyHistoryLast30Days}
          aside={
            onNavigateToHistory ? (
              <button type="button" className="button button-small button-subtle" onClick={onNavigateToHistory}>
                {t.goToFullHistory} <Icon name="arrow-right" size={13} />
              </button>
            ) : undefined
          }
        >
          <OdczytyHistoryTimeline history={recentHistory} language={language} showSearch={false} />
        </FormSection>
      </div>
    </div>
  );
};

export default OdczytyLicznikow;
