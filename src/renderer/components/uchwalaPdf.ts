import { MailingExportResult, Zebranie, ZebranieMaterial, ZebranieWersja } from '../../shared/types';
import { ZebranieDane } from '../../shared/zebrania';
import { buildKalendarzContext } from '../../shared/mailing-template';

export const fileBaseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export type UchwalaPdfResult =
  | { ok: true; files: MailingExportResult['files']; entry: { at: string; by: string; pliki: string[] } }
  | { ok: false; error: string };

/**
 * Write one resolution's PDF to Downloads and note the download on it — the one
 * way a resolution is downloaded, from the list and from the editor alike. The
 * meeting's data goes in as the calendar context, so the file carries the date
 * and place the meeting has NOW, not the ones a draft was written with.
 *
 * The caller checks for blank fields first (it can say which); a failure of the
 * record alone never fails the download — the file is in Downloads either way.
 */
export async function downloadUchwalaPdf(
  zebranie: Zebranie,
  wersja: ZebranieWersja,
  dane: ZebranieDane,
  uchwala: ZebranieMaterial,
  who: string,
): Promise<UchwalaPdfResult> {
  const result = await window.electronAPI.mailingExport({
    typ: uchwala.typ,
    templateName: uchwala.szablonNazwa,
    temat: uchwala.temat,
    tresc: uchwala.tresc,
    values: uchwala.values,
    tableFields: uchwala.tableFields,
    kalendarz: buildKalendarzContext(dane),
    adresId: dane.adresId,
    adresNazwa: dane.adresNazwa,
    spotkanieId: zebranie.spotkanieId,
    adresaci: uchwala.adresaci,
    wykluczeni: uchwala.wykluczeni,
    formats: ['pdf'],
    attachPdf: false,
  });
  if (!result.success) return { ok: false, error: result.error };
  const pliki = result.files.map((f) => fileBaseName(f.filePath));
  const entry = { at: new Date().toISOString(), by: who, pliki };
  try {
    await window.electronAPI.recordZebraniePobranie(wersja.id, uchwala.id, pliki);
  } catch {
    // Only the record is missing.
  }
  return { ok: true, files: result.files, entry };
}
