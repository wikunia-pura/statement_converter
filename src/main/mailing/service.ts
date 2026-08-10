/**
 * One "Wyślij" click, end to end.
 *
 * Every selected community gets its own message: the body carries that
 * community's address, so a shared mail would be wrong for all but one of them.
 * Field values, by contrast, are typed once and reused across the batch — a rate
 * change usually lands the same way everywhere.
 *
 * Rendering is delegated to shared/mailing-template, the same module the send
 * screen previews with, so what the user proofread is what leaves the machine.
 */

import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import {
  Adres,
  MailingAttachment,
  MailingProgressEvent,
  MailingSendResult,
  MailingSzablon,
  MailingPole,
  MailingTyp,
  ZgnJednostka,
} from '../../shared/types';
import {
  buildDocumentHtml,
  collectFieldValues,
  extractUsedFields,
  formatPolishDate,
  htmlToPlainText,
  MailingRenderContext,
  renderHtml,
  renderPlain,
  slugifyForFileName,
} from '../../shared/mailing-template';
import {
  MAILING_LOGO_BASE64,
  MAILING_LOGO_CID,
  MAILING_LOGO_FILE_NAME,
  MAILING_LOGO_MIME,
  MAILING_LOGO_SVG_DATA_URI,
} from '../../shared/mailing-logo';
import DatabaseService from '../database';
import { MailingSender, SmtpCredentials, validateSmtp } from './sender';
import { renderHtmlToPdf } from './pdf';

export interface MailingSendRequest {
  typ: MailingTyp;
  /** Template the text came from — recorded in the history by name. */
  templateId: number;
  /**
   * Subject and body to send. The send screen loads these from the template and
   * lets the user adjust them for this one mailing, so they are the authority
   * here — reading the template again would send text nobody proofread.
   */
  temat: string;
  tresc: string;
  /** Communities to notify — one mail each. */
  adresIds: number[];
  /** Dynamic-field values, keyed by field name. One set for the whole send. */
  values: Record<string, string>;
  /**
   * Fields making up the `{{Tabela pól}}` table in the body, in row order. The
   * send screen ticks them per mailing, so the table's rows change from send to
   * send while the template stays the same. Absent ⇒ no table.
   */
  tableFields?: string[];
  /** Attach the rendered body as a PDF (defaults from the template in the UI). */
  attachPdf: boolean;
  /** Extra files picked by the user; the same set goes to every community. */
  attachments: { fileName: string; filePath: string }[];
}

/** Where generated PDFs and archived attachments live, per send day. */
export function mailingFilesRoot(outputFolder: string): string {
  return path.join(outputFolder, 'mailing');
}

/** Pick a free name in `dir`, appending -1, -2 … when the file already exists. */
function uniquePath(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base}-${i}${ext}`);
  }
  return candidate;
}

/**
 * Copy the user's attachments into the send's archive folder. The history links
 * to these copies, not to the originals — a file the user later moves or deletes
 * from their Desktop would otherwise leave the record unopenable.
 */
function archiveAttachments(
  attachments: { fileName: string; filePath: string }[],
  dir: string,
): { archived: MailingAttachment[]; errors: string[] } {
  const archived: MailingAttachment[] = [];
  const errors: string[] = [];
  for (const attachment of attachments) {
    try {
      if (!fs.existsSync(attachment.filePath)) {
        errors.push(`Załącznik nie istnieje: ${attachment.fileName}`);
        continue;
      }
      const target = uniquePath(dir, attachment.fileName);
      fs.copyFileSync(attachment.filePath, target);
      archived.push({ fileName: attachment.fileName, filePath: target, kind: 'custom' });
    } catch (error: unknown) {
      errors.push(
        `Nie udało się skopiować załącznika ${attachment.fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return { archived, errors };
}

export interface MailingSendDeps {
  database: DatabaseService;
  smtp: SmtpCredentials;
  outputFolder: string;
  onProgress?: (event: MailingProgressEvent) => void;
}

/**
 * Send one mailing. Returns a per-community result list; a failure on one
 * community is recorded and the rest still go out, because a half-finished batch
 * the user can see is far more useful than an all-or-nothing abort.
 */
export async function sendMailing(
  deps: MailingSendDeps,
  request: MailingSendRequest,
): Promise<{ results: MailingSendResult[] } | { error: string }> {
  const { database, smtp, outputFolder } = deps;

  const smtpError = validateSmtp(smtp);
  if (smtpError) return { error: smtpError };
  if (!outputFolder.trim()) {
    return { error: 'Folder wyjściowy nie jest ustawiony (Ustawienia → Folder wyjściowy).' };
  }
  if (request.adresIds.length === 0) return { error: 'Nie wybrano żadnej wspólnoty.' };

  const [szablony, pola, adresy, jednostki] = await Promise.all([
    database.getMailingSzablony(),
    database.getMailingPola(),
    database.getAllAdresy(),
    database.getZgnJednostki(),
  ]);

  const template = szablony.find((s) => s.id === request.templateId);
  if (!template) return { error: 'Wybrany szablon nie istnieje — odśwież listę szablonów.' };

  const adresById = new Map<number, Adres>(adresy.map((a) => [a.id, a]));
  const jednostkaById = new Map<number, ZgnJednostka>(jednostki.map((j) => [j.id, j]));

  const dateText = formatPolishDate(new Date());
  const stamp = new Date().toISOString().slice(0, 10);
  const filesDir = path.join(mailingFilesRoot(outputFolder), stamp);
  fs.mkdirSync(filesDir, { recursive: true });

  const { archived: customAttachments, errors: attachmentErrors } = archiveAttachments(
    request.attachments,
    filesDir,
  );
  if (attachmentErrors.length > 0 && customAttachments.length === 0 && request.attachments.length > 0) {
    return { error: attachmentErrors.join('\n') };
  }

  const usedFields = extractUsedFields(request.temat, request.tresc);
  const sender = new MailingSender(smtp);
  const results: MailingSendResult[] = [];

  try {
    let done = 0;
    for (const adresId of request.adresIds) {
      const adres = adresById.get(adresId);
      const adresNazwa = adres?.nazwa ?? `#${adresId}`;
      deps.onProgress?.({ done, total: request.adresIds.length, adresNazwa });
      done++;

      const jednostka = adres?.zgnJednostkaId != null ? jednostkaById.get(adres.zgnJednostkaId) : undefined;

      const record = async (
        result: Omit<MailingSendResult, 'adresId' | 'adresNazwa'>,
        fieldValues: ReturnType<typeof collectFieldValues>,
        bodyHtml: string,
        bodyText: string,
      ) => {
        results.push({ adresId, adresNazwa, ...result });
        // History is a record, not the deliverable: a failed write here must not
        // turn a delivered mail into a reported failure.
        try {
          await database.addMailingHistory({
            typ: request.typ,
            templateName: template.nazwa,
            status: result.status,
            errorMessage: result.errorMessage,
            adresId,
            adresNazwa,
            jednostkaNazwa: result.jednostkaNazwa,
            jednostkaEmail: result.jednostkaEmail,
            subject: result.subject,
            bodyHtml,
            bodyText,
            fieldValues,
            attachments: result.attachments,
            sentFrom: sender.from,
          });
        } catch (error: unknown) {
          log.error(
            '[MAILING] history write failed:',
            error instanceof Error ? error.message : String(error),
          );
        }
      };

      if (!adres) {
        await record(
          {
            status: 'error',
            errorMessage: 'Adres nie istnieje — mógł zostać usunięty.',
            jednostkaNazwa: '',
            jednostkaEmail: '',
            subject: '',
            attachments: [],
          },
          [],
          '',
          '',
        );
        continue;
      }

      if (!jednostka) {
        await record(
          {
            status: 'error',
            errorMessage: 'Adres nie ma przypisanej jednostki ZGN (Adresy → edycja adresu).',
            jednostkaNazwa: '',
            jednostkaEmail: '',
            subject: '',
            attachments: [],
          },
          [],
          '',
          '',
        );
        continue;
      }

      const ctx: MailingRenderContext = {
        adresNazwa: adres.nazwa,
        dateText,
        pola: pola as MailingPole[],
        values: request.values,
        tableFields: request.tableFields ?? [],
      };
      const subject = renderPlain(request.temat, ctx);
      const renderedBody = renderHtml(request.tresc, ctx);
      // The mail points at the logo by cid (clients block `data:` sources); the
      // history keeps the bare body and re-adds the letterhead when displaying,
      // so 50 kB of base64 isn't stored on every row.
      const bodyHtml = buildDocumentHtml(renderedBody, { logoSrc: `cid:${MAILING_LOGO_CID}` });
      const bodyText = htmlToPlainText(renderedBody);
      const fieldValues = collectFieldValues(usedFields, ctx);

      const attachments: MailingAttachment[] = [...customAttachments];
      try {
        if (request.attachPdf) {
          const pdfName = `${slugifyForFileName(adres.nazwa)}-${slugifyForFileName(
            template.nazwa,
          )}.pdf`;
          const pdfPath = uniquePath(filesDir, pdfName);
          // The PDF gets the vector artwork: Chromium carries SVG through the
          // print pipeline as paths, so a printed letter stays sharp instead of
          // upscaling a bitmap ~3x at 300 DPI.
          await renderHtmlToPdf(
            buildDocumentHtml(renderedBody, { forPdf: true, logoSrc: MAILING_LOGO_SVG_DATA_URI }),
            pdfPath,
          );
          attachments.unshift({
            fileName: path.basename(pdfPath),
            filePath: pdfPath,
            kind: 'pdf',
          });
        }

        await sender.send({
          to: jednostka.email,
          subject,
          html: bodyHtml,
          text: bodyText,
          attachments,
          inlineImages: [
            {
              cid: MAILING_LOGO_CID,
              fileName: MAILING_LOGO_FILE_NAME,
              content: Buffer.from(MAILING_LOGO_BASE64, 'base64'),
              contentType: MAILING_LOGO_MIME,
            },
          ],
        });

        await record(
          {
            status: 'success',
            // Surfaced even on success: the mail went out, but the user should
            // know one of the files they picked never made it in.
            errorMessage: attachmentErrors.length > 0 ? attachmentErrors.join('\n') : undefined,
            jednostkaNazwa: jednostka.nazwa,
            jednostkaEmail: jednostka.email,
            subject,
            attachments,
          },
          fieldValues,
          renderedBody,
          bodyText,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[MAILING] send failed for ${adres.nazwa}:`, message);
        await record(
          {
            status: 'error',
            errorMessage: message,
            jednostkaNazwa: jednostka.nazwa,
            jednostkaEmail: jednostka.email,
            subject,
            attachments,
          },
          fieldValues,
          renderedBody,
          bodyText,
        );
      }
    }

    deps.onProgress?.({
      done: request.adresIds.length,
      total: request.adresIds.length,
      adresNazwa: '',
    });
    return { results };
  } finally {
    sender.close();
  }
}

/** Size of the module's file archive, for the "clean up files" affordance. */
export function getMailingFilesInfo(outputFolder: string): {
  dir: string;
  fileCount: number;
  totalBytes: number;
} {
  const dir = mailingFilesRoot(outputFolder);
  let fileCount = 0;
  let totalBytes = 0;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        fileCount++;
        totalBytes += fs.statSync(full).size;
      }
    }
  };
  if (outputFolder.trim() && fs.existsSync(dir)) walk(dir);
  return { dir, fileCount, totalBytes };
}

/**
 * Delete the generated PDFs and archived attachments. The history rows stay —
 * subject, body and field values are what the record is for; the files are the
 * bulky, reproducible part. Opening a purged attachment afterwards simply
 * reports that the file is gone.
 */
export function cleanupMailingFiles(outputFolder: string): {
  removedFiles: number;
  freedBytes: number;
} {
  const { dir, fileCount, totalBytes } = getMailingFilesInfo(outputFolder);
  if (fileCount === 0) return { removedFiles: 0, freedBytes: 0 };
  fs.rmSync(dir, { recursive: true, force: true });
  return { removedFiles: fileCount, freedBytes: totalBytes };
}

/** Human-readable size for the UI, without pulling in a formatting library. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
