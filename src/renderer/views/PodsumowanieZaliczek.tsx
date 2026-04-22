import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import Icon from '../components/Icon';
import type {
  ZaliczkiCategory,
  ZaliczkiEditedFile,
  ZaliczkiExtractionResult,
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
  'zimna_woda_licznik',
  'zimna_woda_ryczalt',
  'scieki_licznik',
  'scieki_ryczalt',
  'razem_swiadczenia',
  'odpady_komunalne',
  'fundusz_remontowy',
  'razem_total',
];

const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze',
                     'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

const ROMAN_TO_MONTH: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6,
  VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

function monthFromFilename(name: string): { month: number | null; year: number | null } {
  const m = name.match(/\b(XII|XI|IX|VIII|VII|VI|IV|V|III|II|I)[ .\-_]*(\d{4})/);
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
  const [model, setModel] = useState<string>('claude-sonnet-4-6');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [duplicateFiles, setDuplicateFiles] = useState<string[]>([]);
  const filesRef = useRef<FileEntry[]>(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    window.electronAPI.zaliczkiGetModels().then(({ default: def }) => {
      setModel(def);
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

  const runOcrForFiles = async (targets: FileEntry[]) => {
    if (targets.length === 0) return;
    setIsProcessing(true);
    setStatusMessage('');
    setGeneratedFilePath(null);
    for (const entry of targets) {
      setFiles((prev) =>
        prev.map((f) => (f.filePath === entry.filePath ? { ...f, status: 'running' } : f)),
      );
      const resp = await window.electronAPI.zaliczkiExtractPdf(entry.filePath, model);
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
    }
    setIsProcessing(false);
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

  const runOcrOne = (filePath: string) => {
    const entry = filesRef.current.find((f) => f.filePath === filePath);
    if (entry) return runOcrForFiles([entry]);
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
      <div className="card">
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ marginBottom: '4px', fontSize: '18px', color: 'var(--accent)' }}>
            {t.zaliczkiTitle}
          </h2>
          <div style={{ fontSize: '13px', opacity: 0.7 }}>{t.zaliczkiSubtitle}</div>
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
                className="button button-secondary"
                onClick={runOcrAll}
                disabled={isProcessing || !anyPending}
                title={!anyPending ? t.zaliczkiNothingToProcess : ''}
                style={!anyPending ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              >
                <Icon name="search" size={14} /> {isProcessing ? t.zaliczkiOcrRunning : t.zaliczkiRunOcrAll}
              </button>
              <button
                className="button button-success"
                onClick={generateExcel}
                disabled={!canGenerateExcel || isGenerating}
                title={
                  missingMonthCount > 0
                    ? `${t.zaliczkiMissingMonthTooltip} (${missingMonthCount})`
                    : ''
                }
                style={!canGenerateExcel || isGenerating ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              >
                <Icon name="bar-chart" size={14} /> {isGenerating ? t.zaliczkiGenerating : t.zaliczkiGenerateExcel}
              </button>
              <button
                className="button button-secondary"
                onClick={clearAll}
                disabled={isProcessing}
              >
                <Icon name="trash" size={14} /> {t.zaliczkiClearAll}
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>{t.zaliczkiFile}</th>
                <th style={{ width: '190px' }}>{t.zaliczkiMonth}</th>
                <th style={{ width: '220px' }}>{t.zaliczkiStatus}</th>
                <th style={{ textAlign: 'right' }}>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, idx) => {
                const { month, year: fy } = monthFromFilename(f.fileName);
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
                    ? t.zaliczkiStatusRunning
                    : t.pending;
                return (
                  <tr
                    key={f.filePath}
                    className={f.status === 'running' ? 'processing-row' : ''}
                  >
                    {f.status === 'running' ? (
                      <td colSpan={5}>
                        <div className="processing-loader">
                          <div className="loader-spinner"></div>
                          <div className="loader-content">
                            <span className="loader-text">
                              {t.zaliczkiStatusRunning}: <strong>{f.fileName}</strong>
                            </span>
                            <span className="loader-subtext">{t.zaliczkiOcrRunning}</span>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td>{idx + 1}</td>
                        <td>{f.fileName}</td>
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
                            '—'
                          )}
                        </td>
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
                              onClick={() => {
                                navigator.clipboard.writeText(f.error || '');
                              }}
                              title={f.error}
                            >
                              {f.error.slice(0, 80)}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                            {(f.status === 'pending' || f.status === 'error') && (
                              <button
                                className="button button-small button-success"
                                onClick={() => runOcrOne(f.filePath)}
                                disabled={isProcessing}
                                style={{ whiteSpace: 'nowrap' }}
                              >
                                {t.zaliczkiRunOcr}
                              </button>
                            )}
                            {f.status === 'done' && (
                              <button
                                className="button button-small button-secondary"
                                onClick={() => runOcrOne(f.filePath)}
                                disabled={isProcessing}
                                style={{ whiteSpace: 'nowrap' }}
                              >
                                {t.zaliczkiRunOcrAgain}
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

          {missingMonthCount > 0 && (
            <div
              className="zaliczki-status zaliczki-status-warning"
              style={{ marginTop: '15px', marginBottom: 0 }}
            >
              <span style={{ flex: 1 }}>
                ⚠ {t.zaliczkiMissingMonthBanner} ({missingMonthCount})
              </span>
            </div>
          )}

          {statusMessage && (
            <div
              className={`zaliczki-status ${statusIsError ? 'zaliczki-status-error' : 'zaliczki-status-success'}`}
              style={{ marginTop: '15px', marginBottom: 0 }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>{statusMessage}</span>
              {generatedFilePath && !statusIsError && (
                <button
                  className="button button-small button-primary"
                  onClick={openGeneratedFile}
                  style={{ marginLeft: '12px', flexShrink: 0 }}
                >
                  {t.zaliczkiOpenFile}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="file-text" size={48} /></div>
          <div className="empty-state-text">{t.zaliczkiNoFiles}</div>
        </div>
      )}

      {files.filter((f) => f.status === 'done' && f.result).map((f) => (
        <div className="card" key={`edit-${f.filePath}`} style={{ marginTop: '15px' }}>
          <h3 style={{ marginBottom: '10px' }}>
            {f.fileName}
            {f.result?.month ? ` — ${MONTH_SHORT[f.result.month - 1]} ${f.result.year}` : ''}
          </h3>
          <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '10px' }}>
            {t.zaliczkiEditHint}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="zaliczki-edit-table" style={{ fontSize: '12px', minWidth: '1200px' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '240px', textAlign: 'left' }}>{t.zaliczkiProperty}</th>
                  {CATEGORIES.map((c) => (
                    <th key={c} style={{ minWidth: '95px' }} title={c}>
                      {shortCat(c)}
                    </th>
                  ))}
                  <th style={{ width: '50px' }}></th>
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
                        style={{ width: '100%' }}
                      />
                    </td>
                    {CATEGORIES.map((c) => (
                      <td key={c}>
                        <input
                          type="number"
                          step="0.01"
                          value={p.values[c] ?? ''}
                          onChange={(e) => updateProperty(f.filePath, idx, c, e.target.value)}
                          style={{ width: '90px' }}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="button button-small button-danger"
                        onClick={() => deletePropertyRow(f.filePath, idx)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="button button-small button-secondary"
            onClick={() => addPropertyRow(f.filePath)}
            style={{ marginTop: '10px' }}
          >
            + {t.zaliczkiAddRow}
          </button>
        </div>
      ))}

      {showDuplicatesModal && (
        <div className="modal-overlay" onClick={() => setShowDuplicatesModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="alert-triangle" size={20} /> {t.zaliczkiDuplicatesTitle}
              </h2>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ marginBottom: '15px', fontSize: '14px', color: 'var(--text-tertiary)' }}>
                {t.zaliczkiDuplicatesMessage}
              </p>
              <div
                style={{
                  background: 'var(--warning-bg)',
                  border: '1px solid var(--warning-border)',
                  borderRadius: '8px',
                  padding: '15px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                }}
              >
                {duplicateFiles.map((fileName, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '8px 12px',
                      marginBottom: '8px',
                      background: 'var(--bg-surface)',
                      borderRadius: '4px',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Icon name="file-text" size={16} />
                    <span style={{ fontWeight: '500' }}>{fileName}</span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="modal-footer"
              style={{
                padding: '15px 20px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                className="button button-primary"
                onClick={() => setShowDuplicatesModal(false)}
              >
                {t.zaliczkiDuplicatesOk}
              </button>
            </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        <select
          value={month ?? ''}
          onChange={(e) => onMonthChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
          style={{ flex: 1, padding: '4px 6px', fontSize: '12px' }}
        >
          <option value="">—</option>
          {MONTH_SHORT.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          value={year ?? ''}
          onChange={(e) => onYearChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
          style={{ width: '72px', padding: '4px 6px', fontSize: '12px' }}
        >
          <option value="">—</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      {missing && (
        <div style={{ fontSize: '11px', color: 'var(--danger)' }}>⚠ {missingLabel}</div>
      )}
    </div>
  );
};

function shortCat(c: ZaliczkiCategory): string {
  const map: Record<ZaliczkiCategory, string> = {
    zaliczka_utrzymanie: 'Zal. utrz.',
    co_zmienna: 'CO zm.',
    co_stala: 'CO st.',
    ciepla_woda_licznik: 'C. woda licz.',
    ciepla_woda_ryczalt: 'C. woda rycz.',
    zimna_woda_licznik: 'Z. woda licz.',
    zimna_woda_ryczalt: 'Z. woda rycz.',
    scieki_licznik: 'Ścieki licz.',
    scieki_ryczalt: 'Ścieki rycz.',
    razem_swiadczenia: 'Razem św.',
    odpady_komunalne: 'Odpady',
    fundusz_remontowy: 'Fundusz rem.',
    razem_total: 'RAZEM',
  };
  return map[c];
}

export default PodsumowanieZaliczek;
