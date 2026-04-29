import React, { useEffect, useMemo, useRef, useState } from 'react';
import { translations, Language } from '../translations';
import Icon from '../components/Icon';
import {
  ScalanieAnalyzedFile,
  ScalanieMergeFileInput,
  ScalanieMergeGroupResult,
} from '../electronAPI';

export interface ScalanieFileEntry {
  filePath: string;
  fileName: string;
  status: 'analyzing' | 'ready' | 'error';
  date: string | null;
  detectedAddress: string | null;
  detectedAdresId: number | null;
  /** Stable cross-file identifier (typically the receiver IBAN repeated in content). Used to share detection between sibling files for the same community. */
  accountKey: string | null;
  /** What we'll write into the filename. User can override. */
  communityLabel: string;
  /** Stable group key — the user-edited communityLabel (trimmed, lowercased). */
  communityKey: string;
  lineCount: number;
  error?: string;
}

interface Props {
  language: Language;
  files: ScalanieFileEntry[];
  setFiles: React.Dispatch<React.SetStateAction<ScalanieFileEntry[]>>;
}

function communityKeyOf(label: string): string {
  return label.trim().toLowerCase();
}

function applyAnalyzed(
  prev: ScalanieFileEntry,
  data: ScalanieAnalyzedFile,
): ScalanieFileEntry {
  const label = data.detectedAddress ?? '';
  return {
    ...prev,
    status: 'ready',
    date: data.date,
    detectedAddress: data.detectedAddress,
    detectedAdresId: data.detectedAdresId,
    accountKey: data.accountKey,
    communityLabel: label,
    communityKey: communityKeyOf(label),
    lineCount: data.lineCount,
    error: undefined,
  };
}

/**
 * Fill empty communityLabel for files whose accountKey matches a sibling
 * that does have a label. The label propagates from any ready file with
 * the same accountKey — we count occurrences and pick the most common, so
 * a single mis-detection in one file can't override consensus.
 */
function propagateByAccountKey(files: ScalanieFileEntry[]): ScalanieFileEntry[] {
  const labelByKey = new Map<string, Map<string, number>>();
  for (const f of files) {
    if (!f.accountKey || !f.communityLabel) continue;
    const inner = labelByKey.get(f.accountKey) ?? new Map<string, number>();
    inner.set(f.communityLabel, (inner.get(f.communityLabel) ?? 0) + 1);
    labelByKey.set(f.accountKey, inner);
  }
  const winners = new Map<string, string>();
  for (const [key, inner] of labelByKey) {
    let best = '';
    let bestCount = 0;
    for (const [label, count] of inner) {
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    }
    if (best) winners.set(key, best);
  }
  return files.map((f) => {
    if (f.communityLabel || !f.accountKey) return f;
    const inherited = winners.get(f.accountKey);
    if (!inherited) return f;
    return { ...f, communityLabel: inherited, communityKey: communityKeyOf(inherited) };
  });
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
    setFiles((prev) => {
      const updated = prev.map((f) => {
        if (f.filePath !== filePath) return f;
        if (res.error || !res.data) {
          return { ...f, status: 'error' as const, error: res.error ?? 'Unknown error' };
        }
        return applyAnalyzed(f, res.data);
      });
      return propagateByAccountKey(updated);
    });
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
        detectedAddress: null,
        detectedAdresId: null,
        communityLabel: '',
        communityKey: '',
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
  };

  const updateCommunityLabel = (filePath: string, label: string) => {
    setFiles((prev) => {
      const updated = prev.map((f) =>
        f.filePath === filePath
          ? { ...f, communityLabel: label, communityKey: communityKeyOf(label) }
          : f,
      );
      return propagateByAccountKey(updated);
    });
  };

  const groups = useMemo(() => {
    const map = new Map<string, ScalanieFileEntry[]>();
    for (const f of files) {
      if (!f.communityKey) continue;
      const arr = map.get(f.communityKey) ?? [];
      arr.push(f);
      map.set(f.communityKey, arr);
    }
    return map;
  }, [files]);

  const missingCommunityCount = useMemo(
    () => files.filter((f) => f.status === 'ready' && !f.communityKey).length,
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
    missingCommunityCount === 0 &&
    files.every((f) => f.status === 'ready');

  const openOutput = (p: string) => window.electronAPI.openFile(p);

  const [lastResults, setLastResults] = useState<ScalanieMergeGroupResult[]>([]);

  const mergeWithResults = async () => {
    const ready = filesRef.current.filter((f) => f.status === 'ready' && f.communityKey);
    if (ready.length === 0) {
      setStatusMessage(t.scalanieNothingToMerge);
      setStatusIsError(true);
      return;
    }
    const outputDir = await window.electronAPI.scalanieSelectOutputDir();
    if (!outputDir) return;

    setIsProcessing(true);
    setStatusMessage('');
    setLastResults([]);
    const payload: ScalanieMergeFileInput[] = ready.map((f) => ({
      filePath: f.filePath,
      communityKey: f.communityKey,
      communityLabel: f.communityLabel,
      date: f.date,
    }));
    const res = await window.electronAPI.scalanieMerge(payload, outputDir);
    setIsProcessing(false);
    if (res.error) {
      setStatusMessage(`${t.scalanieMergeError}: ${res.error}`);
      setStatusIsError(true);
      return;
    }
    setLastResults(res.results ?? []);
    const groupCount = res.results?.length ?? 0;
    setStatusMessage(
      `${t.scalanieMergeSuccess}: ${groupCount} ${t.scalanieGroupsSummary.toLowerCase()} → ${outputDir}`,
    );
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
                onClick={mergeWithResults}
                disabled={!canMerge}
                title={
                  missingCommunityCount > 0
                    ? t.scalanieMissingCommunityBanner
                    : ''
                }
                style={!canMerge ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
              >
                <Icon name="bar-chart" size={14} />{' '}
                {isProcessing ? t.scalanieMerging : t.scalanieMergeAll}
              </button>
              <button
                className="button button-secondary"
                onClick={clearAll}
                disabled={isProcessing}
              >
                <Icon name="trash" size={14} /> {t.scalanieClearAll}
              </button>
            </div>
          </div>

          {missingCommunityCount > 0 && (
            <div
              className="zaliczki-status zaliczki-status-error"
              style={{ marginBottom: '15px' }}
            >
              <span style={{ flex: 1 }}>{t.scalanieMissingCommunityBanner}</span>
            </div>
          )}

          {groups.size > 0 && (
            <div style={{ marginBottom: '15px', fontSize: '13px', opacity: 0.8 }}>
              {t.scalanieGroupsSummary}: {groups.size}
              {' — '}
              {Array.from(groups.entries())
                .map(
                  ([, entries]) =>
                    `${entries[0].communityLabel} (${entries.length} ${t.scalanieFilesPerGroup})`,
                )
                .join(', ')}
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                <th>{t.scalanieFile}</th>
                <th style={{ width: '110px' }}>{t.scalanieDate}</th>
                <th style={{ width: '32%' }}>{t.scalanieCommunity}</th>
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
                    ) : (
                      f.date ?? '—'
                    )}
                  </td>
                  <td>
                    {f.status === 'analyzing' ? (
                      <span style={{ opacity: 0.6 }}>{t.scalanieDetectingAddress}</span>
                    ) : f.status === 'error' ? (
                      <span className="status-badge status-error">{f.error ?? t.error}</span>
                    ) : (
                      <input
                        type="text"
                        value={f.communityLabel}
                        onChange={(e) => updateCommunityLabel(f.filePath, e.target.value)}
                        placeholder={t.scalanieEditCommunity}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          border: f.communityLabel
                            ? '1px solid var(--border)'
                            : '1px solid var(--error)',
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                        }}
                      />
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

          {statusMessage && (
            <div
              className={`zaliczki-status ${
                statusIsError ? 'zaliczki-status-error' : 'zaliczki-status-success'
              }`}
              style={{ marginTop: '15px', marginBottom: 0 }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>{statusMessage}</span>
            </div>
          )}

          {lastResults.length > 0 && (
            <div style={{ marginTop: '15px' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t.scalanieCommunity}</th>
                    <th style={{ width: '90px' }}>{t.scalanieFilesPerGroup}</th>
                    <th>{t.scalanieDate}</th>
                    <th style={{ textAlign: 'right' }}>{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {lastResults.map((r) => (
                    <tr key={r.outputPath}>
                      <td>{r.communityLabel}</td>
                      <td>{r.fileCount}</td>
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
