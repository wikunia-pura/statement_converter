import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import Select from '../components/Select';
import type {
  ZaliczkiCategory,
  ZaliczkiEditedFile,
  ZaliczkiExtractionResult,
  ZaliczkiProgress,
  ZaliczkiPropertyData,
} from '../electronAPI';

export interface ZaliczkiFileEntry {
  fileName: string;
  filePath: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: ZaliczkiExtractionResult;
  error?: string;
}

interface Props {
  language: Language;
  files: ZaliczkiFileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<ZaliczkiFileEntry[]>>;
  generatedFilePath: string | null;
  setGeneratedFilePath: React.Dispatch<React.SetStateAction<string | null>>;
}

const CATEGORIES: ZaliczkiCategory[] = [
  'zaliczka_utrzymanie',
  'co_zmienna',
  'co_stala',
  'ciepla_woda_licznik',
  'ciepla_woda_ryczalt',
  'zw_kanalizacja_licznik',
  'zw_kanalizacja_ryczalt',
  'woda_gospodarcza',
  'razem_swiadczenia',
  'odpady_komunalne',
  'fundusz_remontowy',
  'razem_total',
];

const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze',
                     'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/**
 * Files handled at once. Pages within a file are dispatched by the main process,
 * which caps page requests globally — so this only controls how many files show
 * progress at the same time, not how much load reaches the API.
 */
const OCR_CONCURRENCY = 4;

const ROMAN_TO_MONTH: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
  VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

function monthFromFilename(name: string): { month: number | null; year: number | null } {
  // Keep in sync with monthFromFilename in main/zaliczki/extractor.ts. Longest
  // first, so XII/XI win before X; bare `X` (October) used to be missing.
  const m = name.match(/\b(XII|XI|X|IX|VIII|VII|VI|IV|V|III|II|I)[ .\-_]*(\d{4})/);
  if (!m) return { month: null, year: null };
  return { month: ROMAN_TO_MONTH[m[1]] ?? null, year: parseInt(m[2], 10) };
}

type FileEntry = ZaliczkiFileEntry;

const PodsumowanieZaliczek: React.FC<Props> = ({
  language,
  files,
  setFiles,
  generatedFilePath,
  setGeneratedFilePath,
}) => {
  const t = translations[language];
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [duplicateFiles, setDuplicateFiles] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, ZaliczkiProgress>>({});
  const [cacheInfo, setCacheInfo] = useState<{ entries: number; bytes: number } | null>(null);
  const filesRef = useRef<FileEntry[]>(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const refreshCacheInfo = () => {
    window.electronAPI.zaliczkiCacheStats().then(setCacheInfo).catch(() => setCacheInfo(null));
  };

  useEffect(() => {
    refreshCacheInfo();
    // Per-page progress arrives from the main process, which owns page dispatch.
    return window.electronAPI.onZaliczkiProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.filePath]: p }));
    });
  }, []);

  const checkForDuplicates = (newFiles: { fileName: string; filePath: string }[]) => {
    const existingPaths = new Set(filesRef.current.map((f) => f.filePath));
    const existingNames = new Set(filesRef.current.map((f) => f.fileName.toLowerCase()));
    const duplicates: string[] = [];
    const uniqueFiles: { fileName: string; filePath: string }[] = [];
    for (const file of newFiles) {
      if (existingPaths.has(file.filePath) || existingNames.has(file.fileName.toLowerCase())) {
        duplicates.push(file.fileName);
      } else {
        uniqueFiles.push(file);
      }
    }
    return { duplicates, uniqueFiles };
  };

  const addFiles = (newFiles: { fileName: string; filePath: string }[]) => {
    const { duplicates, uniqueFiles } = checkForDuplicates(newFiles);
    if (duplicates.length > 0) {
      setDuplicateFiles(duplicates);
      setShowDuplicatesModal(true);
    }
    if (uniqueFiles.length > 0) {
      setFiles((prev) => [
        ...prev,
        ...uniqueFiles.map<FileEntry>((p) => ({
          fileName: p.fileName,
          filePath: p.filePath,
          status: 'pending',
        })),
      ]);
    }
  };

  const handlePickPdfs = async () => {
    const picked = await window.electronAPI.zaliczkiSelectPdfs();
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
    setGeneratedFilePath(null);
  };

  const updateProperty = (
    filePath: string,
    propIdx: number,
    field: 'property' | ZaliczkiCategory,
    value: string,
  ) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath || !f.result) return f;
        const properties = f.result.properties.slice();
        const current = { ...properties[propIdx] };
        if (field === 'property') {
          current.property = value;
        } else {
          const v = value.trim();
          current.values = {
            ...current.values,
            [field]: v === '' ? null : Number.isFinite(parseFloat(v)) ? parseFloat(v) : null,
          };
        }
        properties[propIdx] = current;
        return { ...f, result: { ...f.result, properties } };
      }),
    );
  };

  const deletePropertyRow = (filePath: string, propIdx: number) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath || !f.result) return f;
        const properties = f.result.properties.filter((_, i) => i !== propIdx);
        return { ...f, result: { ...f.result, properties } };
      }),
    );
  };

  const addPropertyRow = (filePath: string) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath || !f.result) return f;
        const empty: ZaliczkiPropertyData = {
          property: '',
          values: Object.fromEntries(CATEGORIES.map((c) => [c, null])) as Partial<Record<ZaliczkiCategory, number | null>>,
        };
        return { ...f, result: { ...f.result, properties: [...f.result.properties, empty] } };
      }),
    );
  };

  const runOcrForFiles = async (targets: FileEntry[], force = false) => {
    if (targets.length === 0) return;
    setIsProcessing(true);
    setStatusMessage('');
    setGeneratedFilePath(null);

    const processOne = async (entry: FileEntry) => {
      setFiles((prev) =>
        prev.map((f) => (f.filePath === entry.filePath ? { ...f, status: 'running' } : f)),
      );
      const resp = await window.electronAPI.zaliczkiExtractPdf(entry.filePath, force);
      setFiles((prev) =>
        prev.map((f) => {
          if (f.filePath !== entry.filePath) return f;
          if (resp.error) {
            return { ...f, status: 'error', error: resp.error };
          }
          const result = resp.data!;
          if (result.month === null) {
            const { month, year: y } = monthFromFilename(f.fileName);
            result.month = month;
            result.year = y ?? result.year;
          }
          return { ...f, status: 'done', result, error: undefined };
        }),
      );
    };

    // Process up to OCR_CONCURRENCY PDFs in parallel. Anthropic 429 retry is
    // handled in the main process; the cap balances throughput against tier
    // input-token-per-minute limits.
    const queue = [...targets];
    const workers = Array.from({ length: Math.min(OCR_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        await processOne(next);
      }
    });
    await Promise.all(workers);

    setIsProcessing(false);
    refreshCacheInfo();
  };

  const runOcrAll = () => {
    const toProcess = filesRef.current.filter((f) => f.status === 'pending' || f.status === 'error');
    if (toProcess.length === 0) {
      setStatusMessage(t.zaliczkiNothingToProcess);
      setStatusIsError(true);
      return;
    }
    return runOcrForFiles(toProcess);
  };

  /**
   * `force` re-asks the model instead of reusing cached pages. Only the explicit
   * "OCR ponownie" action passes it — a first run on an already-seen page should
   * stay free.
   */
  const runOcrOne = (filePath: string, force = false) => {
    const entry = filesRef.current.find((f) => f.filePath === filePath);
    if (entry) return runOcrForFiles([entry], force);
  };

  const clearOcrCache = async () => {
    const { removed } = await window.electronAPI.zaliczkiClearCache();
    setStatusMessage(`${t.zaliczkiCacheCleared} (${removed})`);
    setStatusIsError(false);
    refreshCacheInfo();
  };

  const doneFiles = useMemo(() => files.filter((f) => f.status === 'done' && f.result), [files]);
  const missingMonthCount = useMemo(
    () => doneFiles.filter((f) => !f.result!.month || !f.result!.year).length,
    [doneFiles],
  );
  const canGenerateExcel = doneFiles.length > 0 && missingMonthCount === 0;
  const anyPending = useMemo(
    () => files.some((f) => f.status === 'pending' || f.status === 'error'),
    [files],
  );

  const updateFileMonthYear = (filePath: string, patch: { month?: number | null; year?: number | null }) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.filePath !== filePath || !f.result) return f;
        return {
          ...f,
          result: {
            ...f.result,
            month: patch.month !== undefined ? patch.month : f.result.month,
            year: patch.year !== undefined ? patch.year : f.result.year,
          },
        };
      }),
    );
  };

  const generateExcel = async () => {
    setIsGenerating(true);
    setStatusMessage('');
    setGeneratedFilePath(null);
    const done = files.filter((f) => f.status === 'done' && f.result);
    const payload: ZaliczkiEditedFile[] = done.map((f) => ({
      filename: f.fileName,
      month: f.result!.month,
      year: f.result!.year,
      properties: f.result!.properties
        .filter((p) => p.property && p.property.trim())
        .map((p) => ({
          property: p.property.trim(),
          values: Object.fromEntries(
            CATEGORIES.map((c) => [c, p.values[c] ?? null]),
          ) as Partial<Record<ZaliczkiCategory, number | null>>,
        })),
    }));

    const derivedYear =
      done.map((f) => f.result!.year).find((y): y is number => typeof y === 'number') ??
      new Date().getFullYear();

    const res = await window.electronAPI.zaliczkiGenerateXlsx(payload, derivedYear);
    setIsGenerating(false);
    if (res.canceled) return;
    if (res.error) {
      setStatusMessage(`${t.zaliczkiGenerateError}: ${res.error}`);
      setStatusIsError(true);
      return;
    }
    if (res.success && res.filePath) {
      setStatusMessage(`${t.zaliczkiGenerateSuccess}: ${res.filePath}`);
      setStatusIsError(false);
      setGeneratedFilePath(res.filePath);
    }
  };

  const openGeneratedFile = () => {
    if (generatedFilePath) {
      window.electronAPI.openFile(generatedFilePath);
    }
  };

  return (
    <div className="content-body">
      <div className="page-form">
        <FormSection icon="bar-chart" title={t.zaliczkiTitle} description={t.zaliczkiSubtitle}>
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
          aside={
            files.length > 0 ? (
              <div className="form-section__actions">
                <button className="button button-ghost icon-danger" onClick={clearAll} disabled={isProcessing}>
                  <Icon name="trash" size={14} /> {t.convClear}
                </button>
                <span className="toolbar-divider" aria-hidden="true" />
                <button
                  className="button button-secondary"
                  onClick={runOcrAll}
                  disabled={isProcessing || !anyPending}
                  title={!anyPending ? t.zaliczkiNothingToProcess : undefined}
                >
                  <Icon name={isProcessing ? 'loader' : 'search'} size={14} className={isProcessing ? 'icon-spin' : undefined} />{' '}
                  {isProcessing ? t.zaliczkiOcrRunning : t.zaliczkiRunOcrAll}
                </button>
              </div>
            ) : undefined
          }
        >
          {files.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="data-table__index">#</th>
                  <th>{t.zaliczkiFile}</th>
                  <th>{t.zaliczkiMonth}</th>
                  <th>{t.zaliczkiStatus}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, idx) => {
                  const { month, year: fy } = monthFromFilename(f.fileName);
                  const badgeClass =
                    f.status === 'done' ? 'status-success' : f.status === 'error' ? 'status-error' : 'status-pending';
                  const badgeText =
                    f.status === 'done'
                      ? t.success
                      : f.status === 'error'
                        ? t.error
                        : f.status === 'running'
                          ? t.zaliczkiStatusRunning
                          : t.pending;
                  return (
                    <tr key={f.filePath} className={f.status === 'running' ? 'processing-row' : ''}>
                      {f.status === 'running' ? (
                        <td colSpan={5}>
                          <div className="processing-loader">
                            <div className="loader-spinner"></div>
                            <div className="loader-content">
                              <span className="loader-text">
                                {t.zaliczkiStatusRunning}: <strong>{f.fileName}</strong>
                              </span>
                              <span className="loader-subtext">{describeProgress(progress[f.filePath], t)}</span>
                            </div>
                          </div>
                        </td>
                      ) : (
                        <>
                          <td className="data-table__index">{idx + 1}</td>
                          <td className="data-table__name">
                            <span className="cell-title cell-wrap">{f.fileName}</span>
                          </td>
                          <td>
                            {f.status === 'done' && f.result ? (
                              <MonthYearPicker
                                month={f.result.month}
                                year={f.result.year}
                                onMonthChange={(m) => updateFileMonthYear(f.filePath, { month: m })}
                                onYearChange={(y) => updateFileMonthYear(f.filePath, { year: y })}
                                missingLabel={t.zaliczkiMissingMonth}
                              />
                            ) : month ? (
                              `${MONTH_SHORT[month - 1]} ${fy}`
                            ) : (
                              <span className="cell-empty">—</span>
                            )}
                          </td>
                          <td>
                            <span className={`status-badge ${badgeClass}`}>{badgeText}</span>
                            {f.error && (
                              <button
                                type="button"
                                className="cell-error-detail"
                                onClick={() => navigator.clipboard.writeText(f.error || '')}
                                title={`${t.convErrorCopy}\n\n${f.error}`}
                              >
                                {f.error.slice(0, 80)}
                              </button>
                            )}
                          </td>
                          <td className="data-table__actions">
                            <div className="row-actions">
                              {(f.status === 'pending' || f.status === 'error') && (
                                <button
                                  type="button"
                                  className="button button-small button-secondary"
                                  onClick={() => runOcrOne(f.filePath)}
                                  disabled={isProcessing}
                                >
                                  <Icon name="bot" size={13} /> {t.zaliczkiRunOcr}
                                </button>
                              )}
                              {f.status === 'done' && (
                                <button
                                  type="button"
                                  className="button button-small button-subtle"
                                  onClick={() => runOcrOne(f.filePath, true)}
                                  disabled={isProcessing}
                                >
                                  <Icon name="refresh" size={13} /> {t.zaliczkiRunOcrAgain}
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
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="form-empty">
              <Icon name="file-text" size={16} />
              {t.zaliczkiNoFiles}
            </div>
          )}
          {missingMonthCount > 0 && (
            <div className="callout callout--warning" role="status">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">
                {t.zaliczkiMissingMonthBanner} ({missingMonthCount})
              </div>
            </div>
          )}
        </FormSection>

        {files.filter((f) => f.status === 'done' && f.result).map((f) => {
          const warnings = f.result!.warnings ?? [];
          const errors = warnings.filter((w) => w.severity === 'error');
          const notices = warnings.filter((w) => w.severity === 'warning');
          // Properties the checks flagged, so the reviewer can find them in a
          // 28-row table instead of re-reading every number.
          const flagged = new Set(errors.map((w) => w.property));
          const stats = f.result!.stats;
          const tone = errors.length > 0 ? 'danger' : notices.length > 0 ? 'warning' : 'success';
          return (
            <FormSection
              key={`edit-${f.filePath}`}
              icon="table"
              title={`${f.fileName}${f.result?.month ? ` — ${MONTH_SHORT[f.result.month - 1]} ${f.result.year}` : ''}`}
              description={
                stats
                  ? [
                      `${stats.pages} ${t.zaliczkiStatsPages}`,
                      stats.fromCache > 0 ? `${stats.fromCache} ${t.zaliczkiStatsCached}` : null,
                      stats.escalated > 0 ? `${stats.escalated} ${t.zaliczkiStatsEscalated}` : null,
                      stats.failed > 0 ? `${stats.failed} ${t.zaliczkiStatsFailed}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : undefined
              }
              collapsible
              collapsedSummary={warnings.length === 0 ? t.zaliczkiChecksAllOk : `${t.zaliczkiChecksTitle}: ${warnings.length}`}
            >
              <div className={`callout callout--${tone}`} role="status">
                <Icon name={tone === 'success' ? 'check-circle' : 'alert-triangle'} size={16} />
                <div className="callout__body">
                  <div className="callout__title">{t.zaliczkiChecksTitle}</div>
                  {warnings.length === 0 ? (
                    <div>{t.zaliczkiChecksAllOk}</div>
                  ) : (
                    <ul className="callout__list">
                      {[...errors, ...notices].map((w, i) => (
                        <li key={i}>
                          <strong>{w.property}</strong> — {w.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="form-field__hint">{t.zaliczkiEditHint}</div>
              <div className="table-scroll">
                <table className="zaliczki-edit-table">
                  <thead>
                    <tr>
                      <th className="zaliczki-edit-table__property">{t.zaliczkiProperty}</th>
                      {CATEGORIES.map((c) => (
                        <th key={c} className="zaliczki-edit-table__value" title={c}>
                          {shortCat(c)}
                        </th>
                      ))}
                      <th className="zaliczki-edit-table__remove" aria-hidden="true"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.result!.properties.map((p, idx) => (
                      <tr key={idx}>
                        <td>
                          <input
                            type="text"
                            value={p.property}
                            onChange={(e) => updateProperty(f.filePath, idx, 'property', e.target.value)}
                            aria-invalid={flagged.has(p.property) ? true : undefined}
                            title={
                              flagged.has(p.property)
                                ? errors.find((w) => w.property === p.property)?.message
                                : undefined
                            }
                          />
                        </td>
                        {CATEGORIES.map((c) => (
                          <td key={c}>
                            <input
                              type="number"
                              step="0.01"
                              value={p.values[c] ?? ''}
                              onChange={(e) => updateProperty(f.filePath, idx, c, e.target.value)}
                              aria-label={`${p.property}: ${shortCat(c)}`}
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="button button-ghost button-icon icon-danger"
                            onClick={() => deletePropertyRow(f.filePath, idx)}
                            title={t.remove}
                            aria-label={`${t.remove}: ${p.property}`}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <button
                  type="button"
                  className="button button-small button-subtle"
                  onClick={() => addPropertyRow(f.filePath)}
                >
                  <Icon name="plus" size={13} /> {t.zaliczkiAddRow}
                </button>
              </div>
            </FormSection>
          );
        })}

        {statusMessage && (
          <div className={`callout callout--${statusIsError ? 'danger' : 'success'}`} role="status">
            <Icon name={statusIsError ? 'alert-triangle' : 'check-circle'} size={16} />
            <div className="callout__body callout__body--path">{statusMessage}</div>
            {generatedFilePath && !statusIsError && (
              <button type="button" className="button button-small button-subtle" onClick={openGeneratedFile}>
                <Icon name="folder" size={13} /> {t.zaliczkiOpenFile}
              </button>
            )}
          </div>
        )}

        <ModalFooter
          className="page-action-bar"
          note={
            missingMonthCount > 0 ? (
              <span className="action-note action-note--warning">
                <Icon name="alert-triangle" size={13} />
                {t.zaliczkiMissingMonthTooltip} ({missingMonthCount})
              </span>
            ) : undefined
          }
          onSubmit={generateExcel}
          submitLabel={isGenerating ? t.zaliczkiGenerating : t.zaliczkiGenerateExcel}
          submitIcon="bar-chart"
          submitDisabled={!canGenerateExcel}
          submitTitle={missingMonthCount > 0 ? `${t.zaliczkiMissingMonthTooltip} (${missingMonthCount})` : undefined}
          busy={isGenerating}
        />

        {cacheInfo && cacheInfo.entries > 0 && (
          <div className="callout callout--muted">
            <Icon name="archive" size={16} />
            <div className="callout__body">
              <div className="callout__title">
                {t.zaliczkiCacheInfo}: {cacheInfo.entries} {t.zaliczkiStatsPages} (
                {Math.max(1, Math.round(cacheInfo.bytes / 1024))} KB)
              </div>
              <div>{t.zaliczkiCacheHint}</div>
            </div>
            <button
              type="button"
              className="button button-small button-subtle"
              onClick={clearOcrCache}
              disabled={isProcessing}
            >
              <Icon name="trash" size={13} /> {t.zaliczkiCacheClear}
            </button>
          </div>
        )}
      </div>

      {showDuplicatesModal && (
        <div className="modal-overlay" onClick={() => setShowDuplicatesModal(false)}>
          <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
            <ModalDismiss onClose={() => setShowDuplicatesModal(false)} />
            <ModalHeader icon="alert-triangle" title={t.zaliczkiDuplicatesTitle} subtitle={t.zaliczkiDuplicatesMessage} />
            <div className="modal-body modal-body--sectioned">
              <ul className="record-list">
                {duplicateFiles.map((fileName, index) => (
                  <li key={index} className="record-row">
                    <span className="record-row__icon" aria-hidden="true">
                      <Icon name="file-text" size={15} />
                    </span>
                    <div className="record-row__main">
                      <div className="record-row__title record-row__title--wrap">{fileName}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <ModalFooter onCancel={() => setShowDuplicatesModal(false)} cancelLabel={t.zaliczkiDuplicatesOk} />
          </div>
        </div>
      )}
    </div>
  );
};

interface MonthYearPickerProps {
  month: number | null;
  year: number | null;
  onMonthChange: (m: number | null) => void;
  onYearChange: (y: number | null) => void;
  missingLabel: string;
}

const MonthYearPicker: React.FC<MonthYearPickerProps> = ({
  month, year, onMonthChange, onYearChange, missingLabel,
}) => {
  const missing = !month || !year;
  const thisYear = new Date().getFullYear();
  const yearOptions = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1];
  return (
    <div className="month-year-picker">
      <div className="month-year-picker__row">
        <Select
          size="sm"
          value={month ?? ''}
          onChange={(v) => onMonthChange(v === '' ? null : parseInt(v, 10))}
          options={[
            { value: '', label: '—' },
            ...MONTH_SHORT.map((m, i) => ({ value: String(i + 1), label: m })),
          ]}
          className="month-year-picker__month"
        />
        <Select
          size="sm"
          value={year ?? ''}
          onChange={(v) => onYearChange(v === '' ? null : parseInt(v, 10))}
          options={[
            { value: '', label: '—' },
            ...yearOptions.map((y) => ({ value: String(y), label: String(y) })),
          ]}
          className="month-year-picker__year"
        />
      </div>
      {missing && (
        <div className="form-field__error">
          <Icon name="alert-circle" size={12} /> {missingLabel}
        </div>
      )}
    </div>
  );
};

/**
 * "strona 7/28 · 3 z pamięci" — the file-level spinner used to say only "OCR
 * w toku…" for the whole document, which on a 28-page scan looked like a hang.
 */
function describeProgress(
  p: ZaliczkiProgress | undefined,
  t: (typeof translations)[Language],
): string {
  if (!p || p.stage === 'splitting') return t.zaliczkiSplitting;
  if (p.totalPages <= 1) return t.zaliczkiOcrRunning;
  const cached = p.fromCache > 0 ? ` · ${p.fromCache} ${t.zaliczkiFromCacheShort}` : '';
  return `${t.zaliczkiPageProgress} ${Math.min(p.donePages + 1, p.totalPages)}/${p.totalPages}${cached}`;
}

function shortCat(c: ZaliczkiCategory): string {
  const map: Record<ZaliczkiCategory, string> = {
    zaliczka_utrzymanie: 'Zal. utrz.',
    co_zmienna: 'CO zm.',
    co_stala: 'CO st.',
    ciepla_woda_licznik: 'C. woda licz.',
    ciepla_woda_ryczalt: 'C. woda rycz.',
    zw_kanalizacja_licznik: 'Z.W.+kanal. licz.',
    zw_kanalizacja_ryczalt: 'Z.W.+kanal. rycz.',
    woda_gospodarcza: 'Woda gosp.',
    razem_swiadczenia: 'Razem św.',
    odpady_komunalne: 'Odpady',
    fundusz_remontowy: 'Fundusz rem.',
    razem_total: 'RAZEM',
  };
  return map[c];
}

export default PodsumowanieZaliczek;
