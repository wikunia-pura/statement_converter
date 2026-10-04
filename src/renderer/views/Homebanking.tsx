import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import { ModalFooter } from '../components/Modal';
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
      <div className="page-form">
        <FormSection icon="building" title={t.homebankingTitle} description={t.homebankingSubtitle}>
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
          <div className="form-field__hint">{t.homebankingSplitByAddressHint}</div>
        </FormSection>

        <FormSection
          icon="folder"
          title={t.inputFilesTitle}
          description={
            bankGroups.size > 0
              ? `${t.homebankingBanksSummary}: ${Array.from(bankGroups.values())
                  .map((g) => `${g.bankName} (${g.fileCount} ${t.homebankingFilesPerBank})`)
                  .join(', ')}`
              : undefined
          }
          aside={
            files.length > 0 ? (
              <button className="button button-ghost icon-danger" onClick={clearAll} disabled={isProcessing}>
                <Icon name="trash" size={14} /> {t.convClear}
              </button>
            ) : undefined
          }
        >
          {noSelectionCount > 0 && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.homebankingMissingBankBanner}</div>
            </div>
          )}

          {files.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="data-table__index">#</th>
                  <th>{t.homebankingFile}</th>
                  <th>{t.homebankingDate}</th>
                  <th>{t.homebankingDetectedBank}</th>
                  <th>{t.homebankingAddresses}</th>
                  <th>{t.homebankingLines}</th>
                  <th className="data-table__center">{t.homebankingSplitByAddress}</th>
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
                        <span className="cell-empty">{t.homebankingAnalyzing}</span>
                      ) : (
                        f.date ?? <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td>
                      {f.status === 'analyzing' ? (
                        <span className="cell-empty">{t.homebankingDetectingBank}</span>
                      ) : f.status === 'error' ? (
                        <span className="status-badge status-error">{f.error ?? t.error}</span>
                      ) : f.bankHits.length === 0 ? (
                        <span className="status-badge status-error">{t.homebankingUnknownBank}</span>
                      ) : f.bankHits.length === 1 ? (
                        <span>{f.bankHits[0].bankName}</span>
                      ) : (
                        <div className="cell-checks">
                          {f.bankHits.map((hit) => {
                            const on = f.selectedBankIds.includes(hit.bankId);
                            return (
                              <label key={hit.bankId} className={`cell-check${isProcessing ? ' is-disabled' : ''}`}>
                                <span className={`ks-check ks-check--sm${on ? ' is-on' : ''}`}>
                                  <input
                                    type="checkbox"
                                    className="ks-check__input"
                                    checked={on}
                                    onChange={() => toggleBankSelection(f.filePath, hit.bankId)}
                                    disabled={isProcessing}
                                  />
                                  <span className="ks-check__box" aria-hidden="true">
                                    <Icon name="check" size={10} strokeWidth={3} />
                                  </span>
                                </span>
                                <span>
                                  {hit.bankName} <span className="cell-empty">({hit.lineCount})</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="form-table__sub">
                      {f.status === 'ready' && f.addressHits.length > 0
                        ? f.addressHits.map((h) => `${h.label} (${h.lineCount})`).join(', ')
                        : <span className="cell-empty">—</span>}
                    </td>
                    <td>{f.status === 'ready' ? f.lineCount : <span className="cell-empty">—</span>}</td>
                    <td className="data-table__center">
                      <label className="toggle-switch" title={t.homebankingSplitByAddressHint}>
                        <input
                          type="checkbox"
                          checked={f.splitByAddress}
                          onChange={() => toggleSplitByAddress(f.filePath)}
                          disabled={f.status !== 'ready' || isProcessing}
                          aria-label={`${t.homebankingSplitByAddress}: ${f.fileName}`}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </td>
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
              <Icon name="building" size={16} />
              {t.homebankingNoFiles}
            </div>
          )}
        </FormSection>

        {statusMessage && (
          <div className={`callout callout--${statusIsError ? 'danger' : 'success'}`} role="status">
            <Icon name={statusIsError ? 'alert-triangle' : 'check-circle'} size={16} />
            <div className="callout__body callout__body--path">{statusMessage}</div>
          </div>
        )}

        {!statusIsError && lastResults.length > 0 && (
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
                  <th>{t.homebankingDetectedBank}</th>
                  <th>{t.homebankingResultAddress}</th>
                  <th>{t.homebankingFilesPerBank}</th>
                  <th>{t.homebankingLines}</th>
                  <th>{t.homebankingDate}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {lastResults.map((r) => (
                  <tr key={r.outputPath}>
                    <td className="form-table__label">{r.bankName}</td>
                    <td>{r.addressLabel ?? <span className="cell-empty">—</span>}</td>
                    <td>{r.fileCount}</td>
                    <td>{r.lineCount}</td>
                    <td className="nowrap">
                      {r.startDate && r.endDate
                        ? r.startDate === r.endDate
                          ? r.startDate
                          : `${r.startDate} → ${r.endDate}`
                        : '—'}
                    </td>
                    <td className="data-table__actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() => openOutput(r.outputPath)}
                        >
                          <Icon name="folder" size={13} /> {t.openFile}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </FormSection>
        )}

        <ModalFooter
          className="page-action-bar"
          onSubmit={mergeWithResults}
          submitLabel={isProcessing ? t.homebankingMerging : t.homebankingMergeAll}
          submitIcon="bar-chart"
          submitDisabled={!canMerge}
          submitTitle={t.homebankingNothingToMerge}
          busy={isProcessing}
        />
      </div>
    </div>
  );
};

export default Homebanking;
