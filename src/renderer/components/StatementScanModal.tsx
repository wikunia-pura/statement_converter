import React, { useEffect, useRef, useState } from 'react';
import {
  ScanConflict,
  ScanDecision,
  ScanFoundFile,
  ScanProblem,
  ScanProgress,
  ScanReport,
  ScanUnrecognized,
} from '../../shared/types';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss, { ModalHeader } from './Modal';
import { useNotify } from './Notifications';
import { joinScanPath } from '../../shared/statement-scan';

type Trans = (typeof translations)['pl' | 'en'];
type IconName = React.ComponentProps<typeof Icon>['name'];

/** `2026-08-31` → `31.08.2026`. */
export function formatIsoDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

export function formatPeriod(from: string | null, to: string | null): string {
  if (!from || !to) return '';
  return from === to ? formatIsoDay(from) : `${formatIsoDay(from)} – ${formatIsoDay(to)}`;
}

/** Heading and advice for one kind of miss — explicit, so both languages stay type-checked. */
function problemCopy(problem: ScanProblem, t: Trans): { title: string; advice: string } {
  switch (problem) {
    case 'unknown-account':
      return { title: t.ksScanPhUnknownAccount, advice: t.ksScanPaUnknownAccount };
    case 'no-account':
      return { title: t.ksScanPhNoAccount, advice: t.ksScanPaNoAccount };
    case 'ambiguous-account':
      return { title: t.ksScanPhAmbiguous, advice: t.ksScanPaAmbiguous };
    case 'no-period':
      return { title: t.ksScanPhNoPeriod, advice: t.ksScanPaNoPeriod };
    case 'unknown-bank':
      return { title: t.ksScanPhUnknownBank, advice: t.ksScanPaUnknownBank };
    case 'no-bank-row':
      return { title: t.ksScanPhNoBankRow, advice: t.ksScanPaNoBankRow };
    case 'unsupported-format':
      return { title: t.ksScanPhUnsupported, advice: t.ksScanPaUnsupported };
    case 'parse-failed':
      return { title: t.ksScanPhParseFailed, advice: t.ksScanPaParseFailed };
    case 'pdf-no-text':
      return { title: t.ksScanPhPdfNoText, advice: t.ksScanPaPdfNoText };
    case 'read-failed':
    default:
      return { title: t.ksScanPhReadFailed, advice: t.ksScanPaReadFailed };
  }
}

/** Keep first-seen order — the scan lists files in the folder's order. */
function groupBy<T>(items: T[], keyOf: (item: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return [...out.entries()];
}

/** The folder part of a relative path, shown under the file name. */
function folderOf(relPath: string): string {
  const cut = relPath.lastIndexOf('/');
  return cut < 0 ? '' : relPath.slice(0, cut);
}

/**
 * One block of the report: a tinted icon, a title with its count, and the
 * content folded under it. Problems open by default; the list of what went
 * well opens only when it is short enough to read at a glance.
 */
const ReportSection: React.FC<{
  tone: 'ok' | 'err' | 'warn';
  icon: IconName;
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}> = ({ tone, icon, title, count, defaultOpen, children }) => (
  <details className={`ks-rep-section ks-rep-section--${tone}`} open={defaultOpen}>
    <summary className="ks-rep-section__head">
      <span className="ks-rep-section__icon">
        <Icon name={icon} size={16} />
      </span>
      <span className="ks-rep-section__title">{title}</span>
      <span className="ks-rep-section__count">{count}</span>
      <Icon name="chevron-down" size={16} className="ks-rep-section__chev" />
    </summary>
    <div className="ks-rep-section__body">{children}</div>
  </details>
);

type Step = 'loading' | 'setup' | 'running' | 'conflicts' | 'report';

/** How long the "Szukam plików…" state stays up at the least, so it reads as a step rather than a flicker. */
const MIN_LOADER_MS = 700;

/**
 * "Znajdź pliki księgowe": runs the folder scan for the month on screen, asks
 * about newer files (one decision per file, nothing replaced on its own), and
 * ends on a report of what was pinned, what failed and what was not
 * recognised. The dashboard reloads its files when the dialog closes.
 */
const StatementScanModal: React.FC<{
  language: Language;
  monthKey: string;
  monthLabel: string;
  locale: string;
  /** `changed` — something may have been pinned or replaced; reload. */
  onClose: (changed: boolean) => void;
}> = ({ language, monthKey, monthLabel, locale, onClose }) => {
  const t = translations[language];
  const notify = useNotify();
  const [step, setStep] = useState<Step>('loading');
  const [folder, setFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ScanDecision>>({});
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ applied: number; failed: { relPath: string; message: string }[] } | null>(
    null,
  );
  const changed = useRef(false);
  // StrictMode runs mount effects twice: the scan must start once, and only the
  // latest run may write its result — a second request answered "busy" would
  // otherwise land after the real report and replace it with an error.
  const autoStarted = useRef(false);
  const runId = useRef(0);

  useEffect(() => {
    const off = window.electronAPI.onScanProgress((p) => setProgress(p));
    if (!autoStarted.current) {
      autoStarted.current = true;
      void (async () => {
        const settings = await window.electronAPI.getSettings();
        const root = settings.statementsFolder ?? '';
        setFolder(root);
        // The folder is known: the click on the banner WAS the request — start.
        if (root) void run();
        else setStep('setup');
      })();
    }
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    const id = ++runId.current;
    setError(null);
    setProgress(null);
    setStep('running');
    const startedAt = Date.now();
    try {
      // Paint the loader first: once the scan starts, the main process is busy.
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const result = await window.electronAPI.scanKsiegowaniaPliki(monthKey);
      // A scan of a small folder takes a moment; the loader should not just flash.
      const shownFor = Date.now() - startedAt;
      if (shownFor < MIN_LOADER_MS) await new Promise((resolve) => setTimeout(resolve, MIN_LOADER_MS - shownFor));
      if (id !== runId.current) return;
      if (!result.success) {
        setError(
          result.error === 'no-folder'
            ? t.ksScanErrNoFolder
            : result.error === 'folder-missing'
              ? t.ksScanErrMissing.replace('{folder}', result.folder ?? '')
              : result.error === 'busy'
                ? t.ksScanErrBusy
                : `${t.ksScanErrGeneric}: ${result.error}`,
        );
        setStep('setup');
        return;
      }
      changed.current = true;
      setReport(result.report);
      // Default answer: swap in a newer copy of a statement nobody converted
      // yet; anything that would outdate an accounting file, or that only
      // overlaps, waits for an explicit choice.
      setDecisions(
        Object.fromEntries(
          result.report.conflicts.map((c) => [
            c.id,
            c.kind === 'version' && !c.existingConverted ? 'replace' : 'keep',
          ]),
        ),
      );
      setStep(result.report.conflicts.length > 0 ? 'conflicts' : 'report');
    } catch (e) {
      if (id !== runId.current) return;
      setError(`${t.ksScanErrGeneric}: ${e instanceof Error ? e.message : String(e)}`);
      setStep('setup');
    }
  };

  const pickFolder = async () => {
    const picked = await window.electronAPI.selectOutputFolder();
    if (!picked) return;
    await window.electronAPI.setStatementsFolder(picked);
    setFolder(picked);
    setError(null);
  };

  const apply = async () => {
    if (!report) return;
    setApplying(true);
    try {
      const result = await window.electronAPI.resolveKsiegowaniaScan(
        report.conflicts.map((c) => ({ id: c.id, decision: decisions[c.id] ?? 'keep' })),
      );
      setApplied(result);
      setStep('report');
    } finally {
      setApplying(false);
    }
  };

  const close = () => {
    if (step === 'running' || step === 'loading' || applying) return;
    onClose(changed.current);
  };

  const formatStamp = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  /* -------------------------------- Pieces -------------------------------- */

  /**
   * One way into every file the report lists: "Podgląd" reads a PDF without
   * leaving the dialog, "Otwórz plik" opens anything else (a bank file) in the
   * program the system has for it.
   */
  const previewButton = (relPath: string) => {
    if (!folder) return null;
    const path = joinScanPath(folder, relPath);
    return (
      <span className="ks-rep-file__actions">
        {/\.pdf$/i.test(relPath) ? (
          <button
            type="button"
            className="button button-small button-ghost ks-rep-file__preview"
            title={t.ksScanPreviewHint}
            onClick={async () => {
              const ok = await window.electronAPI.previewPdf(path);
              if (!ok) notify.error(t.fileNotFound);
            }}
          >
            <Icon name="eye" size={13} /> {t.ksScanPreview}
          </button>
        ) : (
          <button
            type="button"
            className="button button-small button-ghost ks-rep-file__preview"
            title={t.ksScanOpenFileHint}
            onClick={async () => {
              const ok = await window.electronAPI.openFile(path);
              if (!ok) notify.error(t.fileNotFound);
            }}
          >
            <Icon name="file-text" size={13} /> {t.ksScanOpenFile}
          </button>
        )}
        {/* Where the file lies — an icon only, the row has no room for a word. */}
        <button
          type="button"
          className="button button-small button-ghost button-icon ks-rep-file__reveal"
          title={t.ksScanShowInFolder}
          aria-label={t.ksScanShowInFolder}
          onClick={async () => {
            const ok = await window.electronAPI.showInFolder(path);
            if (!ok) notify.error(t.fileNotFound);
          }}
        >
          <Icon name="folder" size={14} />
        </button>
      </span>
    );
  };

  /** The whole statements folder, in Finder / Explorer — left in the footer. */
  const folderButton = folder ? (
    <div className="modal-footer__note">
      <button
        type="button"
        className="button button-secondary"
        title={folder}
        onClick={async () => {
          const ok = await window.electronAPI.openFile(folder);
          if (!ok) notify.error(t.fileNotFound);
        }}
      >
        <Icon name="folder" size={14} /> {t.openOutputFolder}
      </button>
    </div>
  ) : null;

  const kindPill = (kind: 'statement' | 'pdf') => (
    <span className={`ks-scan-kind ks-scan-kind--${kind}`}>
      {kind === 'pdf' ? t.ksScanKindPdf : t.ksScanKindStatement}
    </span>
  );

  /** One file under its community: what it is, which days, and where it lies. */
  const fileRow = (f: ScanFoundFile) => (
    <li key={`${f.kind}:${f.relPath}`} className="ks-rep-file">
      {kindPill(f.kind)}
      <div className="ks-rep-file__main">
        <div className="ks-rep-file__line">
          {f.accountTypeName && <span className="ks-rep-file__type">{f.accountTypeName}</span>}
          {f.periodFrom && <span className="ks-rep-file__period">{formatPeriod(f.periodFrom, f.periodTo)}</span>}
        </div>
        <div className="ks-rep-file__name" title={f.relPath}>
          {f.fileName}
          {f.originalName && f.originalName !== f.fileName && (
            <span className="ks-rep-file__was"> ← {f.originalName}</span>
          )}
        </div>
        {f.errorMessage && <div className="ks-rep-file__error">{f.errorMessage}</div>}
        {folderOf(f.relPath) && (
          <div className="ks-rep-file__folder">
            <Icon name="folder" size={11} /> {folderOf(f.relPath)}
          </div>
        )}
      </div>
      {previewButton(f.relPath)}
    </li>
  );

  /** Files grouped under their community, statements first. */
  const byCommunity = (files: ScanFoundFile[]) =>
    groupBy(files, (f) => f.adresNazwa)
      .sort((a, b) => a[0].localeCompare(b[0], locale))
      .map(([nazwa, list]) => {
        const sorted = [...list].sort(
          (a, b) => (a.kind === b.kind ? (a.periodFrom ?? '').localeCompare(b.periodFrom ?? '') : a.kind === 'statement' ? -1 : 1),
        );
        const statements = list.filter((f) => f.kind === 'statement').length;
        return (
          <div key={nazwa} className="ks-rep-group">
            <div className="ks-rep-group__head">
              <Icon name="map-pin" size={14} />
              <b>{nazwa}</b>
              <span>
                {t.ksScanGroupFiles
                  .replace('{s}', String(statements))
                  .replace('{p}', String(list.length - statements))}
              </span>
            </div>
            <ul className="ks-rep-files">{sorted.map(fileRow)}</ul>
          </div>
        );
      });

  const conflictCard = (c: ScanConflict) => {
    const choice = decisions[c.id] ?? 'keep';
    const options: { value: ScanDecision; label: string }[] = [
      { value: 'replace', label: t.ksScanReplace },
      { value: 'keep', label: t.ksScanKeep },
      ...(c.kind === 'overlap' ? [{ value: 'add' as const, label: t.ksScanAdd }] : []),
    ];
    return (
      <li key={c.id} className="ks-scan-conflict">
        <div className="ks-scan-conflict__head">
          {kindPill(c.found.kind)}
          <b>{c.found.adresNazwa}</b>
          {c.found.accountTypeName && <span className="ks-rep-file__type">{c.found.accountTypeName}</span>}
          <span className="ks-scan-conflict__kind">
            {c.kind === 'version' ? t.ksScanConflictVersion : t.ksScanConflictOverlap}
          </span>
        </div>
        <div className="ks-scan-conflict__compare">
          <div className="ks-scan-conflict__side">
            <span className="ks-scan-conflict__label">{t.ksScanCurrent}</span>
            <span className="ks-rep-file__name" title={c.existing.relPath}>{c.existing.fileName}</span>
            <span className="ks-rep-file__period">
              {formatPeriod(c.existing.periodFrom, c.existing.periodTo)} ·{' '}
              {t.ksScanModified.replace('{date}', formatStamp(c.existing.fileMtime))}
            </span>
            {/* Both versions can be opened, to compare them before choosing. */}
            {previewButton(c.existing.relPath)}
          </div>
          <Icon name="arrow-right" size={16} />
          <div className="ks-scan-conflict__side ks-scan-conflict__side--new">
            <span className="ks-scan-conflict__label">{t.ksScanFound}</span>
            <span className="ks-rep-file__name" title={c.found.relPath}>{c.found.fileName}</span>
            <span className="ks-rep-file__period">
              {formatPeriod(c.found.periodFrom, c.found.periodTo)} ·{' '}
              {t.ksScanModified.replace('{date}', formatStamp(c.found.fileMtime))}
            </span>
            {/* Both versions can be opened, to compare them before choosing. */}
            {previewButton(c.found.relPath)}
          </div>
        </div>
        {c.existingConverted && (
          <p className="ks-scan-conflict__warn">
            <Icon name="alert-triangle" size={14} /> {t.ksScanConvertedWarn}
          </p>
        )}
        <div className="ks-scan-choice" role="radiogroup">
          {options.map((o) => (
            <label key={o.value} className={`ks-scan-choice__opt${choice === o.value ? ' is-on' : ''}`}>
              <input
                type="radio"
                name={`conflict-${c.id}`}
                checked={choice === o.value}
                onChange={() => setDecisions((prev) => ({ ...prev, [c.id]: o.value }))}
              />
              {o.label}
            </label>
          ))}
        </div>
      </li>
    );
  };

  /* -------------------------------- Screens -------------------------------- */

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (step === 'loading' || step === 'running') {
    const reading = progress?.phase === 'read' && progress.total > 0;
    body = (
      <div className="ks-scan-loading" role="status" aria-live="polite">
        <div className="loader-spinner" />
        <b>{t.ksScanLoading.replace('{month}', monthLabel)}</b>
        <span className="ks-scan-loading__step">
          {reading
            ? t.ksScanReading.replace('{done}', String(progress!.done)).replace('{total}', String(progress!.total))
            : progress
              ? t.ksScanWalking.replace('{n}', String(progress.done))
              : ' '}
        </span>
        <div className={`ks-scan-bar${reading ? '' : ' is-indeterminate'}`}>
          <span style={reading ? { width: `${Math.round((progress!.done / progress!.total) * 100)}%` } : undefined} />
        </div>
      </div>
    );
  } else if (step === 'setup') {
    body = (
      <>
        <p className="ks-scan-intro">{t.ksScanIntro.replace('{month}', monthLabel)}</p>
        <div className="ks-scan-folder">
          <span className="ks-scan-folder__label">
            <Icon name="folder" size={14} /> {t.ksScanFolderLabel}
          </span>
          <code className={folder ? '' : 'is-empty'}>{folder || t.ksScanFolderNone}</code>
          <button type="button" className="button button-small button-secondary" onClick={() => void pickFolder()}>
            {t.ksScanFolderPick}
          </button>
        </div>
        {error && (
          <p className="ks-scan-error">
            <Icon name="alert-circle" size={14} /> {error}
          </p>
        )}
      </>
    );
    footer = (
      <>
        <button type="button" className="button button-secondary" onClick={close}>
          {t.cancel}
        </button>
        <button type="button" className="button button-success" disabled={!folder} onClick={() => void run()}>
          <Icon name="search" size={14} /> {t.ksScanStart}
        </button>
      </>
    );
  } else if (step === 'conflicts' && report) {
    body = (
      <>
        <p className="ks-scan-intro">{t.ksScanConflictsIntro}</p>
        <ul className="ks-scan-conflicts">{report.conflicts.map(conflictCard)}</ul>
      </>
    );
    footer = (
      <>
        {folderButton}
        <button
          type="button"
          className="button button-secondary"
          disabled={applying}
          onClick={() =>
            setDecisions(Object.fromEntries(report.conflicts.map((c) => [c.id, 'replace' as ScanDecision])))
          }
        >
          {t.ksScanReplaceAll}
        </button>
        <button type="button" className="button button-success" disabled={applying} onClick={() => void apply()}>
          <Icon name="check" size={14} /> {t.ksScanApply}
        </button>
      </>
    );
  } else if (step === 'report' && report) {
    const missCount = report.unrecognized.length + report.renameFailures.length + (applied?.failed.length ?? 0);
    const unrecognizedGroups = groupBy(report.unrecognized, (u) => u.problem);
    const stats: { tone: string; icon: IconName; value: number; label: string }[] = [
      { tone: 'ok', icon: 'check-circle', value: report.added.length, label: t.ksScanSumAdded },
      { tone: 'neutral', icon: 'file-check', value: report.unchanged, label: t.ksScanSumUnchanged },
      { tone: report.errors.length > 0 ? 'err' : 'neutral', icon: 'alert-triangle', value: report.errors.length, label: t.ksScanSumErrors },
      { tone: missCount > 0 ? 'warn' : 'neutral', icon: 'search', value: report.unrecognized.length, label: t.ksScanSumUnrecognized },
    ];
    const notes = [
      applied && applied.applied > 0 ? t.ksScanReplaced.replace('{n}', String(applied.applied)) : null,
      report.duplicates > 0 ? t.ksScanDuplicates.replace('{n}', String(report.duplicates)) : null,
      report.skippedBooked > 0 ? t.ksScanSkippedBooked.replace('{n}', String(report.skippedBooked)) : null,
    ].filter((n): n is string => !!n);
    const nothingNew = report.added.length === 0 && report.errors.length === 0 && report.unrecognized.length === 0;
    const nothingAtAll =
      nothingNew &&
      report.conflicts.length === 0 &&
      report.renameFailures.length === 0 &&
      !(applied && applied.failed.length > 0);

    body = nothingAtAll ? (
      // Nothing new, nothing wrong: one plain answer instead of a report of zeros.
      <div className="ks-rep-none">
        <span className="ks-rep-none__icon">
          <Icon name={report.unchanged > 0 ? 'check-circle' : 'folder'} size={28} />
        </span>
        <b>{t.ksScanEmptyTitle.replace('{month}', monthLabel)}</b>
        <p>
          {report.unchanged > 0
            ? t.ksScanEmptyAssigned.replace('{n}', String(report.unchanged))
            : t.ksScanEmptyNone}
        </p>
        <span className="ks-rep-none__meta">
          {t.ksScanExamined.replace('{n}', String(report.examined))}
          {folder && <> · {folder}</>}
        </span>
        {notes.map((n) => (
          <span key={n} className="ks-rep-none__meta">
            <Icon name="info" size={12} /> {n}
          </span>
        ))}
      </div>
    ) : (
      <div className="ks-rep">
        <div className="ks-rep-stats">
          {stats.map((s) => (
            <div key={s.label} className={`ks-rep-stat ks-rep-stat--${s.tone}`}>
              <Icon name={s.icon} size={16} />
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className="ks-rep-meta">
          <span>{t.ksScanExamined.replace('{n}', String(report.examined))}</span>
          {folder && <span className="ks-rep-meta__folder">{t.ksScanFolderIn.replace('{folder}', folder)}</span>}
          {notes.map((n) => (
            <span key={n} className="ks-rep-meta__note">
              <Icon name="info" size={12} /> {n}
            </span>
          ))}
        </div>

        {nothingNew && <p className="ks-rep-empty">{t.ksScanNothing}</p>}

        {applied && applied.failed.length > 0 && (
          <ReportSection
            tone="err"
            icon="x-circle"
            title={t.ksScanApplyFailed.replace('{n}', String(applied.failed.length))}
            count={applied.failed.length}
            defaultOpen
          >
            <ul className="ks-rep-files">
              {applied.failed.map((f) => (
                <li key={f.relPath} className="ks-rep-file">
                  <div className="ks-rep-file__main">
                    <div className="ks-rep-file__name">{f.relPath}</div>
                    <div className="ks-rep-file__error">{f.message}</div>
                  </div>
                </li>
              ))}
            </ul>
          </ReportSection>
        )}

        {report.errors.length > 0 && (
          <ReportSection
            tone="err"
            icon="alert-triangle"
            title={t.ksScanErrorsHeading}
            count={report.errors.length}
            defaultOpen
          >
            {byCommunity(report.errors)}
          </ReportSection>
        )}

        {report.unrecognized.length > 0 && (
          <ReportSection
            tone="warn"
            icon="search"
            title={t.ksScanUnrecognizedHeading}
            count={report.unrecognized.length}
            defaultOpen
          >
            {unrecognizedGroups.map(([problem, items]) => {
              const copy = problemCopy(problem as ScanProblem, t);
              return (
                <div key={problem} className="ks-rep-group">
                  <div className="ks-rep-group__head">
                    <b>{copy.title}</b>
                    <span>{items.length}</span>
                  </div>
                  <p className="ks-rep-group__advice">{copy.advice}</p>
                  <ul className="ks-rep-files">
                    {items.map((u: ScanUnrecognized) => (
                      <li key={u.relPath} className="ks-rep-file">
                        <div className="ks-rep-file__main">
                          <div className="ks-rep-file__name" title={u.relPath}>
                            {u.fileName}
                          </div>
                          {(u.adresNazwa || u.detail) && (
                            <div className="ks-rep-file__line">
                              {u.adresNazwa && <span className="ks-rep-file__type">{u.adresNazwa}</span>}
                              {u.detail && <span className="ks-rep-file__detail">{u.detail}</span>}
                            </div>
                          )}
                          {folderOf(u.relPath) && (
                            <div className="ks-rep-file__folder">
                              <Icon name="folder" size={11} /> {folderOf(u.relPath)}
                            </div>
                          )}
                        </div>
                        {previewButton(u.relPath)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </ReportSection>
        )}

        {report.renameFailures.length > 0 && (
          <ReportSection
            tone="warn"
            icon="edit"
            title={t.ksScanRenameFailedHeading}
            count={report.renameFailures.length}
            defaultOpen
          >
            <ul className="ks-rep-files">
              {report.renameFailures.map((f) => (
                <li key={f.relPath} className="ks-rep-file">
                  <div className="ks-rep-file__main">
                    <div className="ks-rep-file__name">{f.relPath}</div>
                    <div className="ks-rep-file__error">{f.message}</div>
                  </div>
                </li>
              ))}
            </ul>
          </ReportSection>
        )}

        {report.added.length > 0 && (
          <ReportSection
            tone="ok"
            icon="check-circle"
            title={t.ksScanAddedHeading}
            count={report.added.length}
            defaultOpen={new Set(report.added.map((f) => f.adresNazwa)).size <= 6}
          >
            {byCommunity(report.added)}
          </ReportSection>
        )}

        {!nothingNew && missCount === 0 && report.errors.length === 0 && (
          <p className="ks-rep-allgood">
            <Icon name="check-circle" size={14} /> {t.ksScanAllGood}
          </p>
        )}
      </div>
    );
    footer = (
      <>
        {folderButton}
        <button type="button" className="button button-success" onClick={close}>
          <Icon name="check" size={14} /> {t.ksScanDone}
        </button>
      </>
    );
  }

  const title =
    step === 'report'
      ? t.ksScanReportTitle.replace('{month}', monthLabel)
      : step === 'conflicts'
        ? t.ksScanConflictsTitle
        : `${t.ksScanTitle} · ${monthLabel}`;

  const busy = step === 'running' || step === 'loading' || applying;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal ks-scan-modal" onClick={(e) => e.stopPropagation()}>
        {!busy && <ModalDismiss onClose={close} ariaLabel={t.close} />}
        <ModalHeader icon="search" title={title} />
        <div className="modal-body">{body}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

export default StatementScanModal;
