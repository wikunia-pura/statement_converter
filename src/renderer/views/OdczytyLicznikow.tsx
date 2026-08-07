import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import Icon from '../components/Icon';
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
      <div className="card">
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ marginBottom: '4px', fontSize: '18px', color: 'var(--accent)' }}>
            {t.odczytyTitle}
          </h2>
          <div style={{ fontSize: '13px', opacity: 0.7 }}>{t.odczytySubtitle}</div>
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
                <button
                  className="button button-secondary"
                  onClick={() => openOutput(lastResult.outputDir)}
                  title={lastResult.outputDir}
                >
                  <Icon name="folder" size={14} /> {t.openOutputFolder}
                </button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>{t.odczytyCommunity}</th>
                    <th>{t.odczytyOutputFile}</th>
                    <th style={{ width: '110px' }}>{t.odczytyDate}</th>
                    <th style={{ width: '90px' }}>{t.odczytyReadings}</th>
                    <th style={{ textAlign: 'right' }}>{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {lastResult.files.map((f) => (
                    <tr key={f.outputPath}>
                      <td>{f.wm}</td>
                      <td style={{ wordBreak: 'break-all' }}>{f.fileName}</td>
                      <td>{f.date}</td>
                      <td>{f.readingCount}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="button button-small button-primary"
                          onClick={() => openOutput(f.outputPath)}
                        ><Icon name="folder" size={13} />{' '}
                          {t.openFile}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lastResult.skippedCount > 0 && (
                <div style={{ marginTop: '10px', fontSize: '13px' }}>
                  <Icon name="alert-triangle" size={14} />{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      setSkippedModal(
                        lastResult.sources
                          .filter((s) => s.skipped.length > 0)
                          .map((s) => ({ fileName: s.fileName, rows: s.skipped })),
                      )
                    }
                  >
                    {t.odczytySkipped}: {lastResult.skippedCount} — {t.odczytySkippedShowDetails}
                  </button>
                </div>
              )}
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
                onClick={convertAll}
                disabled={!canConvert}
                style={!canConvert ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              >
                <Icon name="arrow-right" size={14} />{' '}
                {isProcessing ? t.odczytyConverting : t.odczytyConvertAll}
              </button>
              <button
                className="button button-danger"
                onClick={clearAll}
                disabled={isProcessing}
              >
                <Icon name="trash" size={14} /> {t.odczytyClearAll}
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>{t.odczytyFile}</th>
                <th style={{ width: '90px' }}>{t.odczytySupplier}</th>
                <th>{t.odczytyCommunities}</th>
                <th style={{ width: '110px' }}>{t.odczytyDate}</th>
                <th style={{ width: '80px' }}>{t.odczytyReadings}</th>
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
                      <span style={{ opacity: 0.6 }}>{t.odczytyAnalyzing}</span>
                    ) : f.status === 'error' ? (
                      <span className="status-badge status-error">{t.error}</span>
                    ) : (
                      <span className="status-badge status-success">{f.supplierLabel}</span>
                    )}
                  </td>
                  <td>
                    {f.status === 'error' ? (
                      <span style={{ color: 'var(--danger, #ef4444)' }}>{f.error}</span>
                    ) : (
                      f.communities.join(', ') || '—'
                    )}
                  </td>
                  <td>{f.latestDate ?? '—'}</td>
                  <td>
                    {f.status === 'ready' ? (
                      <>
                        {f.readingCount}
                        {f.skippedCount > 0 && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => showSkipped([f])}
                            title={`${t.odczytySkipped}: ${f.skippedCount} — ${t.odczytySkippedShowDetails}`}
                            style={{ marginLeft: 4 }}
                          >
                            (−{f.skippedCount})
                          </button>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="button button-small button-success"
                      onClick={() => convertOne(f)}
                      disabled={isProcessing || f.status !== 'ready' || f.readingCount === 0}
                      title={t.odczytyConvertOne}
                      style={{ marginRight: 6 }}
                    ><Icon name="arrow-right" size={13} />{' '}
                      {convertingPath === f.filePath ? t.odczytyConverting : t.convert}
                    </button>
                    <button
                      className="button button-small button-danger"
                      onClick={() => removeFile(f.filePath)}
                      disabled={isProcessing}
                    ><Icon name="trash" size={13} />{' '}
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
          <div className="empty-state-icon"><Icon name="zap" size={48} /></div>
          <div className="empty-state-text">{t.odczytyNoFiles}</div>
        </div>
      )}

      {/* Recent activity — last 30 days, same timeline as the Historia tab. */}
      <div className="card recent-activity-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px',
            gap: '12px',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Icon name="history" size={18} /> {t.odczytyHistoryLast30Days}
          </h2>
          {onNavigateToHistory && (
            <button className="button button-small button-secondary" onClick={onNavigateToHistory}>
              <Icon name="history" size={13} />{' '}{t.goToFullHistory} →
            </button>
          )}
        </div>
        <OdczytyHistoryTimeline
          history={recentHistory}
          language={language}
          showSearch={false}
        />
      </div>
    </div>
  );
};

export default OdczytyLicznikow;
