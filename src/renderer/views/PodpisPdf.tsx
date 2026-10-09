import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PodatkiPodpisPostep, PodpisPdfWynik, PodpisWybor } from '../../shared/types';
import { translations, Language } from '../translations';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import { PodpisKartaModal } from '../components/PodpisKarta';
import { useNotify } from '../components/Notifications';
import { plural } from '../plural';

type T = (typeof translations)['pl'];

/** One PDF on the Podpis screen. Lives in the app shell, so the list survives a switch of module. */
export interface PodpisPlikEntry {
  filePath: string;
  fileName: string;
  /** `blocked`: the check found it cannot be signed (see `blokada`); `signed`: its signed copy is `signedPath`. */
  status: 'analyzing' | 'ready' | 'blocked' | 'signed';
  rozmiar: number;
  strony: number | null;
  blokada: string | null;
  /** Why the last attempt to sign it failed — the file stays signable, so it can be tried again. */
  ostatniBlad?: string;
  signedPath?: string;
  zaznaczony: boolean;
}

interface Props {
  language: Language;
  files: PodpisPlikEntry[];
  setFiles: React.Dispatch<React.SetStateAction<PodpisPlikEntry[]>>;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ileDokumentow = (n: number, language: Language): string =>
  plural(n, language, ['plik', 'pliki', 'plików'], ['file', 'files']);

// ------------------------------------------------------------------ summary

const Licznik: React.FC<{ value: number; label: string; tone: 'success' | 'warning' | 'danger' }> = ({ value, label, tone }) => (
  <div className={`podpis-sum__stat is-${value > 0 ? tone : 'neutral'}`}>
    <span className="podpis-sum__stat-value">{value}</span>
    <span className="podpis-sum__stat-label">{label}</span>
  </div>
);

/**
 * After "Podpisz zaznaczone": what one PIN signed — each file one click from
 * opening — what was skipped and why, and what a stop left unsigned, which can
 * be ticked again in the list in one go.
 */
const PodsumowaniePodpisow: React.FC<{
  t: T;
  wynik: PodpisPdfWynik;
  onZaznacz: (zrodla: string[]) => void;
  onClose: () => void;
}> = ({ t, wynik, onZaznacz, onClose }) => {
  const notify = useNotify();
  const { podpis, podpisane, pominiete, niepodpisane, przerwano } = wynik;
  const wszystko = podpisane.length > 0 && pominiete.length === 0 && niepodpisane.length === 0 && !przerwano;
  const otworz = async (sciezka: string) => {
    if (!(await window.electronAPI.openFile(sciezka))) notify.error(t.podSumFileMissing);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader
          icon={wszystko ? 'check-circle' : 'alert-triangle'}
          tone={podpisane.length === 0 ? 'danger' : 'accent'}
          title={t.podSumTitle}
          subtitle={podpis ? t.podpisPdfSumSubtitle.replace('{kto}', podpis.podmiot) : t.podpisPdfSumSubtitleNone}
        />
        <div className="modal-body modal-body--sectioned">
          <div className="podpis-sum__stats">
            <Licznik value={podpisane.length} label={t.podSumSigned} tone="success" />
            <Licznik value={pominiete.length} label={t.podSumSkipped} tone="warning" />
            <Licznik value={niepodpisane.length} label={t.podSumUnsigned} tone="danger" />
          </div>
          {wszystko && (
            <div className="callout callout--success">
              <Icon name="check-circle" size={16} />
              <div className="callout__body">{t.podSumAllOk}</div>
            </div>
          )}
          {podpisane.length === 0 && (
            <div className="callout callout--danger" role="alert">
              <Icon name="alert-circle" size={16} />
              <div className="callout__body">{t.podSumNothing}</div>
            </div>
          )}
          {przerwano && (
            <div className="callout callout--warning">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{t.podSumStopped.replace('{reason}', przerwano)}</div>
            </div>
          )}

          {podpisane.length > 0 && (
            <FormSection
              icon="signature"
              title={t.podSumSignedList.replace('{n}', String(podpisane.length))}
              description={t.podSumSignedDesc}
            >
              <ul className="podpis-sum__list">
                {podpisane.map((p) => (
                  <li key={p.zrodlo}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                    <button type="button" className="podpis-sum__file" onClick={() => void otworz(p.sciezka)} title={p.sciezka}>
                      <Icon name="file-text" size={13} /> {p.sciezka.split(/[\\/]/).pop()}
                    </button>
                  </li>
                ))}
              </ul>
            </FormSection>
          )}

          {pominiete.length > 0 && (
            <FormSection
              icon="alert-triangle"
              title={t.podSumSkippedList.replace('{n}', String(pominiete.length))}
              description={t.podpisPdfSumSkippedDesc}
            >
              <ul className="podpis-sum__list">
                {pominiete.map((p) => (
                  <li key={p.zrodlo}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                    <span className="podpis-sum__reason">{p.powod}</span>
                  </li>
                ))}
              </ul>
            </FormSection>
          )}

          {niepodpisane.length > 0 && (
            <FormSection
              icon="clock"
              title={t.podSumUnsignedList.replace('{n}', String(niepodpisane.length))}
              description={t.podSumUnsignedDesc}
            >
              <ul className="podpis-sum__list">
                {niepodpisane.map((p) => (
                  <li key={p.zrodlo}>
                    <span className="podpis-sum__name">{p.nazwa}</span>
                  </li>
                ))}
              </ul>
            </FormSection>
          )}
        </div>
        <ModalFooter
          onCancel={onClose}
          cancelLabel={t.close}
          secondaryAction={
            niepodpisane.length > 0 ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  onZaznacz(niepodpisane.map((p) => p.zrodlo));
                  onClose();
                }}
              >
                <Icon name="check-circle" size={14} /> {t.podSumSelectRest.replace('{n}', String(niepodpisane.length))}
              </button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ screen

/**
 * Podpis kwalifikowany → Podpisywanie: PDFs dropped in, ticked, and signed with
 * the Szafir card on one PIN. The signed copy is written next to the original;
 * what ran lands in the module's Historia tab.
 */
const PodpisPdf: React.FC<Props> = ({ language, files, setFiles }) => {
  const t = translations[language];
  const notify = useNotify();
  const [dragOver, setDragOver] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  /** The files the signing window is about, fixed when it opens (a row's own button, or the ticked ones); null = closed. */
  const [doPodpisu, setDoPodpisu] = useState<string[] | null>(null);
  const modalOpen = doPodpisu !== null;
  const [postep, setPostep] = useState<PodatkiPodpisPostep | null>(null);
  const [podsumowanie, setPodsumowanie] = useState<PodpisPdfWynik | null>(null);
  const filesRef = useRef(files);
  const lastTickedRef = useRef<string | null>(null);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => window.electronAPI.onPodpisPdfPostep(setPostep), []);

  const patch = (filePath: string, change: Partial<PodpisPlikEntry>) =>
    setFiles((prev) => prev.map((f) => (f.filePath === filePath ? { ...f, ...change } : f)));

  const analyzeOne = async (filePath: string) => {
    try {
      const a = await window.electronAPI.podpisAnalizujPdf(filePath);
      patch(filePath, {
        status: a.blokada ? 'blocked' : 'ready',
        rozmiar: a.rozmiar,
        strony: a.strony,
        blokada: a.blokada,
      });
    } catch (error: unknown) {
      patch(filePath, { status: 'blocked', blokada: error instanceof Error ? error.message : String(error) });
    }
  };

  const addFiles = async (incoming: { fileName: string; filePath: string }[]) => {
    const pdfs = incoming.filter((f) => /\.pdf$/i.test(f.fileName));
    setInfo(pdfs.length < incoming.length ? t.podpisPdfOnlyPdf : null);
    const known = new Set(filesRef.current.map((f) => f.filePath));
    const fresh = pdfs.filter((f) => !known.has(f.filePath));
    if (fresh.length === 0) return;
    setFiles((prev) => [
      ...prev,
      ...fresh.map<PodpisPlikEntry>((f) => ({
        filePath: f.filePath,
        fileName: f.fileName,
        status: 'analyzing',
        rozmiar: 0,
        strony: null,
        blokada: null,
        zaznaczony: false,
      })),
    ]);
    for (const f of fresh) await analyzeOne(f.filePath);
  };

  const handlePick = async () => {
    const picked = await window.electronAPI.podpisWybierzPdf();
    if (picked.length > 0) await addFiles(picked);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files)
      .map((file) => ({ fileName: file.name, filePath: (file as unknown as { path: string }).path }))
      .filter((f) => f.filePath);
    if (dropped.length > 0) await addFiles(dropped);
  };

  const remove = (filePath: string) => setFiles((prev) => prev.filter((f) => f.filePath !== filePath));

  const clearAll = () => {
    setFiles([]);
    setInfo(null);
    lastTickedRef.current = null;
  };

  // Only a file that is ready can be ticked — a signed one is done, a blocked one cannot be.
  const tickable = useMemo(() => files.filter((f) => f.status === 'ready'), [files]);
  const zaznaczone = useMemo(() => tickable.filter((f) => f.zaznaczony), [tickable]);
  const allTicked = tickable.length > 0 && zaznaczone.length === tickable.length;
  const someTicked = zaznaczone.length > 0 && !allTicked;

  const toggle = (filePath: string, range: boolean) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.filePath === filePath);
      if (!target) return prev;
      const on = !target.zaznaczony;
      const ready = prev.filter((f) => f.status === 'ready');
      const from = range && lastTickedRef.current ? ready.findIndex((f) => f.filePath === lastTickedRef.current) : -1;
      const to = ready.findIndex((f) => f.filePath === filePath);
      const inRange = new Set(
        from >= 0 ? ready.slice(Math.min(from, to), Math.max(from, to) + 1).map((f) => f.filePath) : [filePath],
      );
      return prev.map((f) => (inRange.has(f.filePath) ? { ...f, zaznaczony: on } : f));
    });
    lastTickedRef.current = filePath;
  };

  const toggleAll = () => {
    setFiles((prev) => prev.map((f) => (f.status === 'ready' ? { ...f, zaznaczony: !allTicked } : f)));
    lastTickedRef.current = null;
  };

  const tickOnly = (zrodla: string[]) => {
    const only = new Set(zrodla);
    setFiles((prev) => prev.map((f) => ({ ...f, zaznaczony: f.status === 'ready' && only.has(f.filePath) })));
    lastTickedRef.current = null;
  };

  const open = async (p: string) => {
    if (!(await window.electronAPI.openFile(p))) notify.error(t.fileNotFound);
  };

  const wybrane = useMemo(
    () => (doPodpisu ? files.filter((f) => f.status === 'ready' && doPodpisu.includes(f.filePath)) : []),
    [files, doPodpisu],
  );

  const podpiszWybrane = async (wybor: PodpisWybor) => {
    setPostep(null);
    const wynik = await window.electronAPI.podpisPodpiszPdf(
      wybrane.map((f) => f.filePath),
      wybor,
    );
    setDoPodpisu(null);
    setPostep(null);
    const signed = new Map(wynik.podpisane.map((p) => [p.zrodlo, p.sciezka]));
    const failed = new Map(wynik.pominiete.map((p) => [p.zrodlo, p.powod]));
    setFiles((prev) =>
      prev.map((f) => {
        const sciezka = signed.get(f.filePath);
        if (sciezka) return { ...f, status: 'signed', signedPath: sciezka, zaznaczony: false, ostatniBlad: undefined };
        const powod = failed.get(f.filePath);
        if (powod) return { ...f, zaznaczony: false, ostatniBlad: powod };
        return f;
      }),
    );
    setPodsumowanie(wynik);
  };

  return (
    <div className="content-body">
      <div className="page-form">
        <FormSection icon="signature" title={t.podpisPdfTitle} description={t.podpisPdfSubtitle}>
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={handlePick}
          >
            <div className="drop-zone-icon">
              <Icon name="upload" size={40} />
            </div>
            <div className="drop-zone-text">{t.podpisPdfDrop}</div>
          </div>
          {info && (
            <div className="callout callout--warning" role="status">
              <Icon name="alert-triangle" size={16} />
              <div className="callout__body">{info}</div>
            </div>
          )}
        </FormSection>

        <FormSection
          icon="folder"
          title={t.podpisPdfFilesTitle}
          description={files.length > 0 ? t.podpisPdfFilesDesc : undefined}
          aside={
            files.length > 0 ? (
              <button className="button button-ghost icon-danger" onClick={clearAll} disabled={modalOpen}>
                <Icon name="trash" size={14} /> {t.convClear}
              </button>
            ) : undefined
          }
        >
          {files.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="data-table__index">
                    <label className={`ks-check${allTicked ? ' is-on' : ''}${someTicked ? ' is-mixed' : ''}`}>
                      <input
                        type="checkbox"
                        className="ks-check__input"
                        checked={allTicked}
                        disabled={tickable.length === 0}
                        ref={(el) => {
                          if (el) el.indeterminate = someTicked;
                        }}
                        onChange={toggleAll}
                        aria-label={allTicked ? t.ksSelectNone : t.ksSelectAll}
                        title={t.ksSelectRangeHint}
                      />
                      <span className="ks-check__box" aria-hidden="true">
                        <Icon name={someTicked ? 'minus' : 'check'} size={12} strokeWidth={3} />
                      </span>
                    </label>
                  </th>
                  <th>{t.podpisPdfColFile}</th>
                  <th>{t.podpisPdfColPages}</th>
                  <th>{t.podpisPdfColSize}</th>
                  <th>{t.podpisPdfColState}</th>
                  <th className="data-table__actions">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.filePath} className={f.zaznaczony ? 'is-selected' : undefined}>
                    <td className="data-table__index">
                      <label
                        className={`ks-check${f.zaznaczony ? ' is-on' : ''}`}
                        title={t.ksSelectRangeHint}
                        // Shift+click selects a range; without this it also selects text.
                        onMouseDown={(e) => {
                          if (e.shiftKey) e.preventDefault();
                        }}
                      >
                        <input
                          type="checkbox"
                          className="ks-check__input"
                          checked={f.zaznaczony}
                          disabled={f.status !== 'ready'}
                          onChange={(e) => toggle(f.filePath, (e.nativeEvent as MouseEvent).shiftKey === true)}
                          aria-label={f.fileName}
                        />
                        <span className="ks-check__box" aria-hidden="true">
                          <Icon name="check" size={12} strokeWidth={3} />
                        </span>
                      </label>
                    </td>
                    <td className="data-table__name">
                      <span className="cell-title cell-wrap" title={f.filePath}>
                        {f.fileName}
                      </span>
                      {f.status === 'blocked' && f.blokada && <span className="cell-warning is-danger cell-wrap">{f.blokada}</span>}
                      {f.ostatniBlad && <span className="cell-warning is-danger cell-wrap">{f.ostatniBlad}</span>}
                    </td>
                    <td className="nowrap">{f.strony ?? <span className="cell-empty">—</span>}</td>
                    <td className="nowrap">{f.rozmiar > 0 ? formatSize(f.rozmiar) : <span className="cell-empty">—</span>}</td>
                    <td className="nowrap">
                      {f.status === 'analyzing' ? (
                        <span className="cell-empty">{t.podpisPdfAnalyzing}</span>
                      ) : f.status === 'blocked' ? (
                        <span className="status-badge status-error">{t.podpisPdfBlocked}</span>
                      ) : f.status === 'signed' ? (
                        <span className="status-badge status-success">{t.podpisPdfSigned}</span>
                      ) : (
                        <span className="status-badge status-neutral">{t.podpisPdfReady}</span>
                      )}
                    </td>
                    <td className="data-table__actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button-ghost button-icon icon-danger"
                          onClick={() => remove(f.filePath)}
                          disabled={modalOpen}
                          title={t.remove}
                          aria-label={`${t.remove}: ${f.fileName}`}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() => void open(f.status === 'signed' && f.signedPath ? f.signedPath : f.filePath)}
                        >
                          <Icon name="file-text" size={13} />{' '}
                          {f.status === 'signed' ? t.podpisPdfOpenSigned : t.podpisPdfOpenOriginal}
                        </button>
                        {f.status === 'ready' && (
                          <button
                            type="button"
                            className="button button-small button-primary"
                            onClick={() => setDoPodpisu([f.filePath])}
                            disabled={modalOpen}
                            title={t.podpisPdfSignOneHint}
                          >
                            <Icon name="signature" size={13} /> {t.podpisSign}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="form-empty">
              <Icon name="signature" size={16} />
              {t.podpisPdfNoFiles}
            </div>
          )}
        </FormSection>

        {/* Ticked files, acted on together: floats at the bottom, as on the Pulpit. */}
        {zaznaczone.length > 0 && (
          <div className="ksieg-selbar">
            <Icon name="check-circle" size={16} />
            <span className="ksieg-selbar__text">{t.podpisPdfSelectionBar.replace('{n}', String(zaznaczone.length))}</span>
            <button type="button" className="ksieg-selbar__clear" onClick={() => tickOnly([])}>
              {t.ksSelectClear}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={modalOpen}
              onClick={() => setDoPodpisu(zaznaczone.map((f) => f.filePath))}
              title={t.podpisPdfSignHint}
            >
              <Icon name="signature" size={14} /> {t.podpisPdfSignBtn.replace('{n}', String(zaznaczone.length))}
            </button>
          </div>
        )}
      </div>

      {modalOpen && (
        <PodpisKartaModal
          language={language}
          title={t.podpisPdfModalTitle}
          subtitle={t.podpisPdfModalSubtitle}
          extra={() => (
            <div className="podpis-gotowosc">
              <div className="podpis-gotowosc__count">
                {t.podpisPdfReadyHead.replace('{n}', ileDokumentow(wybrane.length, language))}
              </div>
              <div className="callout callout--muted">
                <Icon name="info" size={16} />
                <div className="callout__body">{t.podpisPdfInvisibleNote}</div>
              </div>
            </div>
          )}
          submitLabel={t.podpisPdfModalSubmit.replace('{n}', ileDokumentow(wybrane.length, language))}
          submitDisabled={wybrane.length === 0}
          pinHint={t.podpisPdfPinHint.replace('{n}', String(wybrane.length))}
          postep={postep}
          onPrzerwij={() => void window.electronAPI.podpisPrzerwijPdf()}
          onPodpisz={podpiszWybrane}
          onClose={() => setDoPodpisu(null)}
        />
      )}
      {podsumowanie && (
        <PodsumowaniePodpisow t={t} wynik={podsumowanie} onZaznacz={tickOnly} onClose={() => setPodsumowanie(null)} />
      )}
    </div>
  );
};

export default PodpisPdf;
