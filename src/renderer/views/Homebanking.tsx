import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import Icon from '../components/Icon';
import {
  HomebankingAnalyzedFile,
  HomebankingBankHit,
  HomebankingMergeFileInput,
  HomebankingMergeGroupResult,
} from '../electronAPI';

export interface HomebankingFileEntry {
  filePath: string;
  fileName: string;
  status: 'analyzing' | 'ready' | 'error';
  date: string | null;
  bankHits: HomebankingBankHit[];
  /** User-selected subset of `bankHits.bankId`. Defaults to all detected. */
  selectedBankIds: number[];
  addressHits: { label: string; lineCount: number }[];
  lineCount: number;
  splitByAddress: boolean;
  error?: string;
}

interface Props {
  language: Language;
  files: HomebankingFileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<HomebankingFileEntry[]>>;
}

function applyAnalyzed(
  prev: HomebankingFileEntry,
  data: HomebankingAnalyzedFile,
): HomebankingFileEntry {
  // Single-bank files: auto-select that bank — no UI choice to make.
  // Multi-bank files: leave everything unchecked so the user picks explicitly.
  const selectedBankIds =
    data.bankHits.length === 1 ? [data.bankHits[0].bankId] : [];
  return {
    ...prev,
    status: 'ready',
    date: data.date,
    bankHits: data.bankHits,
    selectedBankIds,
    addressHits: data.addressHits,
    lineCount: data.lineCount,
    error: undefined,
  };
}

const Homebanking: React.FC<Props> = ({ language, files, setFiles }) => {
  const t = translations[language];
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lastResults, setLastResults] = useState<HomebankingMergeGroupResult[]>([]);
  const [lastOutputDir, setLastOutputDir] = useState('');
  const filesRef = useRef<HomebankingFileEntry[]>(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const analyzeOne = async (filePath: string) => {
    const res = await window.electronAPI.homebankingAnalyzeFile(filePath);
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
      ...uniqueFiles.map<HomebankingFileEntry>((p) => ({
        filePath: p.filePath,
        fileName: p.fileName,
        status: 'analyzing',
        date: null,
        bankHits: [],
        selectedBankIds: [],
        addressHits: [],
        lineCount: 0,
        splitByAddress: false,
      })),
    ]);
    for (const f of uniqueFiles) {
      await analyzeOne(f.filePath);
    }
  };

  const handlePickFiles = async () => {
    const picked = await window.electronAPI.homebankingSelectFiles();
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

  const toggleSplitByAddress = (filePath: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.filePath === filePath ? { ...f, splitByAddress: !f.splitByAddress } : f,
      ),
    );
  };

  const toggleBankSelection = (filePath: string, bankId: number) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath) return f;
        const has = f.selectedBankIds.includes(bankId);
        const next = has
          ? f.selectedBankIds.filter((id) => id !== bankId)
          : [...f.selectedBankIds, bankId];
        return { ...f, selectedBankIds: next };
      }),
    );
  };

  const clearAll = () => {
    setFiles([]);
    setStatusMessage('');
    setLastResults([]);
    setLastOutputDir('');
  };

  /** Bank id → display name, aggregated from currently-selected banks across all files. */
  const bankGroups = useMemo(() => {
    const map = new Map<number, { bankName: string; fileCount: number }>();
    for (const f of files) {
      if (f.status !== 'ready') continue;
      for (const id of f.selectedBankIds) {
        const hit = f.bankHits.find((h) => h.bankId === id);
        if (!hit) continue;
        const prev = map.get(id);
        if (prev) prev.fileCount += 1;
        else map.set(id, { bankName: hit.bankName, fileCount: 1 });
      }
    }
    return map;
  }, [files]);

  /** Files that ended up with no selected bank — they'd contribute nothing. */
  const noSelectionCount = useMemo(
    () =>
      files.filter((f) => f.status === 'ready' && f.selectedBankIds.length === 0).length,
    [files],
  );

  const anyAnalyzing = useMemo(
    () => files.some((f) => f.status === 'analyzing'),
    [files],
  );

  const canMerge =
    !isProcessing &&
    !anyAnalyzing &&
    files.length > 0 &&
    files.some((f) => f.status === 'ready' && f.selectedBankIds.length > 0);

  const openOutput = (p: string) => window.electronAPI.openFile(p);

  const mergeWithResults = async () => {
    const ready = filesRef.current.filter(
      (f) => f.status === 'ready' && f.selectedBankIds.length > 0,
    );
    if (ready.length === 0) {
      setStatusMessage(t.homebankingNothingToMerge);
      setStatusIsError(true);
      return;
    }
    const outputDir = await window.electronAPI.homebankingSelectOutputDir();
    if (!outputDir) return;

    setIsProcessing(true);
    setStatusMessage('');
    setLastResults([]);
    setLastOutputDir(outputDir);
    const payload: HomebankingMergeFileInput[] = ready.map((f) => ({
      filePath: f.filePath,
      bankIds: f.selectedBankIds,
      date: f.date,
      splitByAddress: f.splitByAddress,
    }));
    const res = await window.electronAPI.homebankingMerge(payload, outputDir);
    setIsProcessing(false);
    if (res.error) {
      setStatusMessage(`${t.homebankingMergeError}: ${res.error}`);
      setStatusIsError(true);
      return;
    }
    setLastResults(res.results ?? []);
    const groupCount = res.results?.length ?? 0;
    setStatusMessage(
      `${t.homebankingMergeSuccess}: ${groupCount} ${t.homebankingBanksSummary.toLowerCase()} → ${outputDir}`,
    );
    setStatusIsError(false);
  };

  return (
    <div className="content-body">
      <div className="card">
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ marginBottom: '4px', fontSize: '18px', color: 'var(--accent)' }}>
            {t.homebankingTitle}
          </h2>
          <div style={{ fontSize: '13px', opacity: 0.7 }}>{t.homebankingSubtitle}</div>
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

        <div style={{ marginTop: '12px', fontSize: '12px', opacity: 0.7 }}>
          {t.homebankingSplitByAddressHint}
        </div>
      </div>

      {!statusIsError && (statusMessage || lastResults.length > 0) && (
        <div className="card" style={{ borderTop: '3px solid var(--success, #10b981)' }}>
          {statusMessage && (
            <div
              className="zaliczki-status zaliczki-status-success"
              style={{ marginBottom: lastResults.length > 0 ? '15px' : 0 }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>{statusMessage}</span>
            </div>
          )}

          {lastResults.length > 0 && (
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
                    <th>{t.homebankingDetectedBank}</th>
                    <th>{t.homebankingResultAddress}</th>
                    <th style={{ width: '90px' }}>{t.homebankingFilesPerBank}</th>
                    <th style={{ width: '90px' }}>{t.homebankingLines}</th>
                    <th>{t.homebankingDate}</th>
                    <th style={{ textAlign: 'right' }}>{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {lastResults.map((r) => (
                    <tr key={r.outputPath}>
                      <td>{r.bankName}</td>
                      <td>{r.addressLabel ?? '—'}</td>
                      <td>{r.fileCount}</td>
                      <td>{r.lineCount}</td>
                      <td>
                        {r.startDate && r.endDate
                          ? r.startDate === r.endDate
                            ? r.startDate
                            : `${r.startDate} → ${r.endDate}`
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="button button-small button-primary"
                          onClick={() => openOutput(r.outputPath)}
                        >
                          {t.notyOpenFile}
                        </button>
                      </td>
                    </tr>
                  ))}
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
                {isProcessing ? t.homebankingMerging : t.homebankingMergeAll}
              </button>
              <button
                className="button button-secondary"
                onClick={clearAll}
                disabled={isProcessing}
              >
                <Icon name="trash" size={14} /> {t.homebankingClearAll}
              </button>
            </div>
          </div>

          {noSelectionCount > 0 && (
            <div
              className="zaliczki-status zaliczki-status-error"
              style={{ marginBottom: '15px' }}
            >
              <span style={{ flex: 1 }}>{t.homebankingMissingBankBanner}</span>
            </div>
          )}

          {bankGroups.size > 0 && (
            <div style={{ marginBottom: '15px', fontSize: '13px', opacity: 0.8 }}>
              {t.homebankingBanksSummary}: {bankGroups.size}
              {' — '}
              {Array.from(bankGroups.values())
                .map(
                  (g) =>
                    `${g.bankName} (${g.fileCount} ${t.homebankingFilesPerBank})`,
                )
                .join(', ')}
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>{t.homebankingFile}</th>
                <th style={{ width: '110px' }}>{t.homebankingDate}</th>
                <th style={{ width: '18%' }}>{t.homebankingDetectedBank}</th>
                <th>{t.homebankingAddresses}</th>
                <th style={{ width: '60px' }}>{t.homebankingLines}</th>
                <th style={{ width: '120px', textAlign: 'center' }}>
                  {t.homebankingSplitByAddress}
                </th>
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
                      <span style={{ opacity: 0.6 }}>{t.homebankingAnalyzing}</span>
                    ) : (
                      f.date ?? '—'
                    )}
                  </td>
                  <td>
                    {f.status === 'analyzing' ? (
                      <span style={{ opacity: 0.6 }}>{t.homebankingDetectingBank}</span>
                    ) : f.status === 'error' ? (
                      <span className="status-badge status-error">{f.error ?? t.error}</span>
                    ) : f.bankHits.length === 0 ? (
                      <span className="status-badge status-error">
                        {t.homebankingUnknownBank}
                      </span>
                    ) : f.bankHits.length === 1 ? (
                      <span>{f.bankHits[0].bankName}</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {f.bankHits.map((hit) => (
                          <label
                            key={hit.bankId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '12px',
                              cursor: isProcessing ? 'default' : 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={f.selectedBankIds.includes(hit.bankId)}
                              onChange={() => toggleBankSelection(f.filePath, hit.bankId)}
                              disabled={isProcessing}
                            />
                            <span>
                              {hit.bankName}{' '}
                              <span style={{ opacity: 0.6 }}>({hit.lineCount})</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: '12px' }}>
                    {f.status === 'ready' && f.addressHits.length > 0
                      ? f.addressHits
                          .map((h) => `${h.label} (${h.lineCount})`)
                          .join(', ')
                      : '—'}
                  </td>
                  <td>{f.status === 'ready' ? f.lineCount : '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <label
                      className="toggle-switch"
                      style={{ display: 'inline-flex', verticalAlign: 'middle' }}
                      title={t.homebankingSplitByAddressHint}
                    >
                      <input
                        type="checkbox"
                        checked={f.splitByAddress}
                        onChange={() => toggleSplitByAddress(f.filePath)}
                        disabled={f.status !== 'ready' || isProcessing}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </td>
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
          <div className="empty-state-icon"><Icon name="building" size={48} /></div>
          <div className="empty-state-text">{t.homebankingNoFiles}</div>
        </div>
      )}
    </div>
  );
};

export default Homebanking;
