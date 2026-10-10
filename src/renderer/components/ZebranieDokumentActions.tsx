import React, { useState } from 'react';
import { DokumentPobranie, ZebranieDokument, ZebranieDokumentFormat } from '../../shared/types';
import { formatStamp } from '../../shared/calendar';
import { translations, Language } from '../translations';
import { useNotify } from './Notifications';
import Icon from './Icon';

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** What a file is built from: a meeting version's document, a library statement, or a module plan (or its statement). */
export type DokumentZrodlo =
  | { wersjaId: number; dokument: ZebranieDokument; dataZebrania: string | null }
  | { sprawozdanieId: number }
  | { planId: number; dokument?: 'plan' | 'sprawozdanie' };

/**
 * "Pobierz PDF" / "Pobierz Excel" for one document — of one version, a
 * statement straight from the library (Sprawozdania) or a plan of Plany
 * gospodarcze. The file is built by the
 * main process from what is stored and lands in Downloads; the last one can
 * be shown in its folder.
 */
const ZebranieDokumentActions: React.FC<{
  language: Language;
  locale: string;
  zrodlo: DokumentZrodlo;
  /** Downloads recorded on the document; a library statement keeps none. */
  pobrania?: DokumentPobranie[];
  /** The statement's PDF: open with the introduction (default yes). */
  wstep?: boolean;
  disabled?: boolean;
  /** After a download — the record of it is in the stored version now. */
  onDownloaded?: () => void;
}> = ({ language, locale, zrodlo, pobrania = [], wstep, disabled, onDownloaded }) => {
  const t = translations[language];
  const notify = useNotify();
  const [busy, setBusy] = useState<ZebranieDokumentFormat | null>(null);
  const [lastFile, setLastFile] = useState<string | null>(null);
  const last = pobrania.length > 0 ? pobrania[pobrania.length - 1] : null;

  const download = async (format: ZebranieDokumentFormat) => {
    setBusy(format);
    try {
      const { filePath } =
        'sprawozdanieId' in zrodlo
          ? await window.electronAPI.exportSprawozdanie({ sprawozdanieId: zrodlo.sprawozdanieId, format, wstep })
          : 'planId' in zrodlo
            ? await window.electronAPI.exportPlanWlasny({ planId: zrodlo.planId, format, dokument: zrodlo.dokument, wstep })
            : await window.electronAPI.exportZebranieDokument({ ...zrodlo, format, wstep });
      setLastFile(filePath);
      notify.success(t.zfinDownloaded.replace('{file}', baseName(filePath)), { file: filePath });
      onDownloaded?.();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : String(err), t.zfinDownloadError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="zeb-doc-actions">
      <div className="zeb-doc-actions__buttons">
        <button
          type="button"
          className="button button-small button-primary"
          onClick={() => void download('pdf')}
          disabled={disabled || busy !== null}
        >
          <Icon name={busy === 'pdf' ? 'loader' : 'download'} size={13} /> {t.zfinDownloadPdf}
        </button>
        <button
          type="button"
          className="button button-small button-secondary"
          onClick={() => void download('xlsx')}
          disabled={disabled || busy !== null}
        >
          <Icon name={busy === 'xlsx' ? 'loader' : 'table'} size={13} /> {t.zfinDownloadXlsx}
        </button>
        {lastFile && (
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={() => void window.electronAPI.mailingShowInFolder(lastFile)}
          >
            <Icon name="folder" size={13} /> {t.zfinShowInFolder}
          </button>
        )}
      </div>
      {last && (
        <span className="zeb-muted">
          {t.zfinLastDownload.replace('{when}', formatStamp(last.at, locale)).replace('{who}', last.by || '—')}
        </span>
      )}
    </div>
  );
};

export default ZebranieDokumentActions;
