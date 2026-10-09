import React, { useMemo, useRef, useState } from 'react';
import {
  MailingExportResult,
  MailingPole,
  MailingSzablon,
  MAILING_TYP_UCHWALA,
  Zebranie,
  ZebranieMaterial,
  ZebranieWersja,
} from '../../shared/types';
import { ZebranieDane, uchwalaMissing, wersjaLabel } from '../../shared/zebrania';
import { buildKalendarzContext } from '../../shared/mailing-template';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import Icon from './Icon';
import MailingVisualEditor from './MailingVisualEditor';
import MailingSaveTemplateModal from './MailingSaveTemplateModal';
import { downloadUchwalaPdf, fileBaseName } from './uchwalaPdf';


/** What the user edits — everything a save writes, without the bookkeeping. */
const content = (m: ZebranieMaterial) =>
  JSON.stringify({
    szablonId: m.szablonId,
    szablonNazwa: m.szablonNazwa,
    temat: m.temat,
    tresc: m.tresc,
    values: m.values,
    tableFields: m.tableFields,
  });

/**
 * One resolution, edited in place: the document as it will read, with the
 * meeting's date, time and place already in it from the calendar, and a side
 * panel saying what is still blank, what was downloaded and when.
 *
 * Smaller than the notice's editor on purpose — a resolution is not mailed, so
 * there are no recipients and no .eml, only the text and the PDF.
 */
const UchwalaEditorModal: React.FC<{
  language: Language;
  locale: string;
  zebranie: Zebranie;
  wersja: ZebranieWersja;
  dane: ZebranieDane;
  uchwala: ZebranieMaterial;
  /** Its place in the version, for the title. */
  lp: number;
  pola: MailingPole[];
  szablony: MailingSzablon[];
  userEmail: string;
  /** Write the resolution; resolves with what is stored (download record included). */
  onSave: (draft: ZebranieMaterial) => Promise<ZebranieMaterial>;
  /** A download happened and was recorded — the caller reloads. */
  onDownloaded: () => void;
  /** A template was saved from the text — the caller's list of templates changes. */
  onTemplateSaved: (stored: MailingSzablon) => void;
  onClose: () => void;
}> = ({
  language,
  locale,
  zebranie,
  wersja,
  dane,
  uchwala,
  lp,
  pola,
  szablony,
  userEmail,
  onSave,
  onDownloaded,
  onTemplateSaved,
  onClose,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [saved, setSaved] = useState(uchwala);
  const [draft, setDraft] = useState(uchwala);
  const [busy, setBusy] = useState<null | 'save' | 'pdf'>(null);
  const [lastFiles, setLastFiles] = useState<MailingExportResult['files'] | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  /** Escape reaches both the confirm dialog and this modal — see ZawiadomienieModal. */
  const closingRef = useRef(false);

  const kalendarz = useMemo(() => buildKalendarzContext(dane), [dane]);
  const missing = useMemo(() => uchwalaMissing(draft, dane, pola), [draft, dane, pola]);
  const dirty = content(draft) !== content(saved);
  const sourceTemplate = szablony.find((s) => s.id === draft.szablonId) ?? null;
  const recent = [...draft.pobrania].reverse().slice(0, 3);

  const patch = (change: Partial<ZebranieMaterial>) => setDraft((prev) => ({ ...prev, ...change }));

  const saveIfDirty = async (): Promise<ZebranieMaterial> => {
    if (!dirty) return draft;
    const stored = await onSave(draft);
    setSaved(stored);
    setDraft(stored);
    return stored;
  };

  const handleSave = async () => {
    setBusy('save');
    try {
      await saveIfDirty();
      notify.success(t.uchSaved);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.uchSaveError);
    } finally {
      setBusy(null);
    }
  };

  const handlePdf = async () => {
    if (missing.length > 0) {
      notify.error(t.uchMissingBlock.replace('{fields}', missing.join(', ')), t.uchMissingTitle);
      return;
    }
    setBusy('pdf');
    try {
      const material = await saveIfDirty();
      const result = await downloadUchwalaPdf(zebranie, wersja, dane, material, userEmail);
      if (!result.ok) {
        notify.error(result.error, t.zfinDownloadError);
        return;
      }
      setLastFiles(result.files);
      // The main process wrote the record; mirrored here so a later save from
      // this screen does not look like it dropped the download.
      setSaved((prev) => ({ ...prev, pobrania: [...prev.pobrania, result.entry] }));
      setDraft((prev) => ({ ...prev, pobrania: [...prev.pobrania, result.entry] }));
      onDownloaded();
      notify.success(t.zfinDownloaded.replace('{file}', result.entry.pliki[0] ?? ''), {
        file: result.files[0]?.filePath,
      });
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zfinDownloadError);
    } finally {
      setBusy(null);
    }
  };

  const handleClose = async () => {
    if (busy || closingRef.current) return;
    if (dirty) {
      closingRef.current = true;
      const discard = await notify.confirm(t.uchUnsavedConfirm, {
        confirmLabel: t.zawUnsavedDiscard,
        cancelLabel: t.zawUnsavedKeep,
        danger: true,
      });
      setTimeout(() => {
        closingRef.current = false;
      }, 0);
      if (!discard) return;
    }
    onClose();
  };

  const subtitle = (
    <div className="zaw-context">
      <strong>{dane.nazwa || '—'}</strong>
      {dane.startsAt && (
        <span>
          <Icon name="calendar" size={13} /> {formatStamp(dane.startsAt, locale)}
        </span>
      )}
      {dane.adresNazwa && (
        <span>
          <Icon name="building" size={13} /> {dane.adresNazwa}
        </span>
      )}
      <span className="zaw-context__version">{t.zawVersion.replace('{v}', wersjaLabel(wersja))}</span>
    </div>
  );

  return (
    <div className="modal-overlay zaw-overlay">
      <div className="modal zaw-modal" role="dialog" aria-label={t.uchEditTitle}>
        <ModalDismiss onClose={() => void handleClose()} ariaLabel={t.close} />
        <ModalHeader icon="file-text" title={`${t.uchEditTitle} ${lp}`} subtitle={subtitle} />

        <div className="zaw-body">
          <div className="zaw-main">
            <p className="zaw-hint">{t.uchEditHint}</p>
            <MailingVisualEditor
              language={language}
              temat={draft.temat}
              onTematChange={(temat) => patch({ temat })}
              tresc={draft.tresc}
              onTrescChange={(tresc) => patch({ tresc })}
              values={draft.values}
              onValuesChange={(values) => patch({ values })}
              pola={pola}
              adresNazwa={dane.adresNazwa}
              kalendarz={kalendarz}
              tableFields={draft.tableFields}
              onSaveAsTemplate={() => setSaveTemplateOpen(true)}
              hideHint
            />
          </div>

          <aside className="zaw-side">
            <section className={`zaw-panel${missing.length > 0 ? ' is-warning' : ' is-ok'}`}>
              <h4 className="zaw-panel__title">
                <Icon name={missing.length > 0 ? 'alert-triangle' : 'check-circle'} size={15} />
                {t.uchPanelFields}
              </h4>
              {missing.length === 0 ? (
                <p>{t.uchMissingNone}</p>
              ) : (
                <>
                  <p>{t.uchMissingIntro}</p>
                  <ul className="zaw-missing">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="zaw-panel">
              <h4 className="zaw-panel__title">
                <Icon name="download" size={15} /> {t.uchPanelDownload}
              </h4>
              <p className="zaw-panel__hint">{t.uchPanelDownloadHint}</p>
              <div className="zaw-downloads">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handlePdf()}
                  disabled={busy !== null}
                >
                  <Icon name={busy === 'pdf' ? 'loader' : 'file-text'} size={14} />{' '}
                  {busy === 'pdf' ? t.zawDownloading : t.zawDownloadPdf}
                </button>
              </div>

              {lastFiles && lastFiles.length > 0 && (
                <ul className="zaw-files">
                  {lastFiles.map((f) => (
                    <li key={f.filePath} className="zaw-file">
                      <Icon name="file-check" size={14} />
                      <span className="zaw-file__name" title={f.filePath}>
                        {fileBaseName(f.filePath)}
                      </span>
                      <span className="zaw-file__actions">
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() => void window.electronAPI.mailingShowInFolder(f.filePath)}
                        >
                          <Icon name="folder" size={12} /> {t.zawShowInFolder}
                        </button>
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          onClick={() => void window.electronAPI.openFile(f.filePath)}
                        >
                          <Icon name="eye" size={12} /> {t.zawOpenFile}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {recent.length > 0 && (
                <div className="zaw-history">
                  <span className="zaw-history__label">{t.zawLastDownloads}</span>
                  <ul>
                    {recent.map((p, i) => (
                      <li key={`${p.at}-${i}`}>
                        <span>{p.pliki.join(', ')}</span>
                        <span className="zaw-history__when">
                          {t.zawDownloadedBy.replace('{when}', formatStamp(p.at, locale)).replace('{who}', p.by || '—')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </aside>
        </div>

        <ModalFooter
          note={
            <span className="zaw-foot">
              <span className={`zaw-foot__state${dirty ? ' is-dirty' : ''}`}>
                <Icon name={dirty ? 'alert-circle' : 'check'} size={13} />
                {dirty ? t.uchUnsaved : t.uchAllSaved}
              </span>
              {draft.szablonNazwa && (
                <span className="zaw-foot__source">{t.uchFromTemplate.replace('{name}', draft.szablonNazwa)}</span>
              )}
            </span>
          }
          onCancel={() => void handleClose()}
          cancelLabel={t.close}
          onSubmit={() => void handleSave()}
          submitLabel={t.uchSave}
          submitIcon="save"
          submitDisabled={busy !== null || !dirty}
          submitTitle={!dirty ? t.noChangesToSave : undefined}
        />
      </div>

      <MailingSaveTemplateModal
        language={language}
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        typ={draft.typ || MAILING_TYP_UCHWALA}
        temat={draft.temat}
        tresc={draft.tresc}
        attachPdf={sourceTemplate?.attachPdf ?? true}
        // The template's own shortlist for its table — this document's ticks are
        // its own, and writing them back would wipe what every other document picks from.
        tableFields={sourceTemplate?.tableFields ?? draft.tableFields}
        sourceTemplate={sourceTemplate}
        onSaved={(stored) => {
          setSaveTemplateOpen(false);
          onTemplateSaved(stored);
          patch({ szablonId: stored.id, szablonNazwa: stored.nazwa });
          notify.success(t.uchTemplateSaved);
        }}
      />
    </div>
  );
};

export default UchwalaEditorModal;
