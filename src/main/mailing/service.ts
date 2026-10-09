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
import os from 'os';
import path from 'path';
import log from 'electron-log';
import MailComposer from 'nodemailer/lib/mail-composer';
import {
  Adres,
  DEFAULT_MAILING_ADRESACI,
  MailingAdresaci,
  MailingAttachment,
  MailingExportRequest,
  MailingExportResult,
  MailingKalendarzContext,
  MailingOdbiorca,
  MailingOdbiorcaRodzaj,
  MailingProgressEvent,
  MailingSendResult,
  MailingPole,
  MailingTyp,
  MAILING_TYP_UCHWALA,
  Spotkanie,
} from '../../shared/types';
import {
  formatAddressHeader,
  resolveOdbiorcy,
  summarizeOdbiorcy,
} from '../../shared/mailing-recipients';
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
  /**
   * The meeting this send was triggered from, when the user came here from the
   * Kalendarz. Recorded on every history row the send produces, which is what
   * lets the meeting list what actually went out for it. Its proxy and board
   * members are also who the "pełnomocnik" / "zarząd" groups resolve to.
   */
  spotkanieId?: number | null;
  /**
   * Recipient groups for this send — the kind's default, possibly changed on
   * the send screen. Absent (a caller from before kinds had recipients) ⇒ the
   * kind's stored default.
   */
  adresaci?: MailingAdresaci;
  /** Mailboxes (lower-cased) unticked on the send screen, across every community. */
  wykluczeni?: string[];
  /** What the meeting fills the calendar fields with, when sent from one. */
  kalendarz?: MailingKalendarzContext | null;
}

/** Why a group the user asked for produced nobody, in Polish — for the history row. */
const BRAK_ODBIORCY: Record<MailingOdbiorcaRodzaj, string> = {
  zgn: 'adres nie ma przypisanej jednostki ZGN (Adresy → edycja adresu)',
  pelnomocnik: 'jednostka ZGN nie ma pełnomocnika z adresem e-mail',
  zarzad: 'nikt z zarządu nie ma adresu e-mail',
  wlasne: 'brak własnych adresów',
};

function noRecipientsMessage(braki: MailingOdbiorcaRodzaj[]): string {
  const why = braki.map((b) => BRAK_ODBIORCY[b]).join('; ');
  return why ? `Brak adresatów: ${why}.` : 'Brak adresatów — wybierz, do kogo ma trafić mail.';
}

/** The kind's stored recipient groups, or "the city unit" when the kind is unknown. */
async function defaultAdresaci(
  database: DatabaseService,
  typ: MailingTyp,
): Promise<MailingAdresaci> {
  try {
    const def = (await database.getMailingTypy()).find((t) => t.klucz === typ);
    return def?.adresaci ?? DEFAULT_MAILING_ADRESACI;
  } catch (error: unknown) {
    log.warn(
      '[MAILING] kinds read failed, sending to the city unit:',
      error instanceof Error ? error.message : error,
    );
    return DEFAULT_MAILING_ADRESACI;
  }
}

async function findSpotkanie(
  database: DatabaseService,
  spotkanieId: number | null | undefined,
): Promise<Spotkanie | null> {
  if (spotkanieId == null) return null;
  return (await database.getSpotkania()).find((s) => s.id === spotkanieId) ?? null;
}

/** Where generated PDFs and archived attachments live, per send day. */
export function mailingFilesRoot(outputFolder: string): string {
  return path.join(outputFolder, 'mailing');
}

/** Pick a free name in `dir`, appending -1, -2 … when the file already exists. */
export function uniquePath(dir: string, fileName: string): string {
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

  const [szablony, pola, adresy, jednostki, pelnomocnicy, spotkanie, adresaci] = await Promise.all([
    database.getMailingSzablony(),
    database.getMailingPola(),
    database.getAllAdresy(),
    database.getZgnJednostki(),
    database.getZgnPelnomocnicy(),
    findSpotkanie(database, request.spotkanieId),
    request.adresaci ? Promise.resolve(request.adresaci) : defaultAdresaci(database, request.typ),
  ]);

  const template = szablony.find((s) => s.id === request.templateId);
  if (!template) return { error: 'Wybrany szablon nie istnieje — odśwież listę szablonów.' };

  const adresById = new Map<number, Adres>(adresy.map((a) => [a.id, a]));

  const dateText = formatPolishDate(new Date());
  const stamp = new Date().toISOString().slice(0, 10);
  const filesDir = path.join(mailingFilesRoot(outputFolder), stamp);
  fs.mkdirSync(filesDir, { recursive: true });

  const { archived: customAttachments, errors: attachmentErrors } = archiveAttachments(
    request.attachments,
    filesDir,
  );
  if (
    attachmentErrors.length > 0 &&
    customAttachments.length === 0 &&
    request.attachments.length > 0
  ) {
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

      // The meeting's own proxy and board apply to the meeting's community only;
      // another community in the same batch keeps its own.
      const meetingHere = spotkanie && spotkanie.adresId === adresId ? spotkanie : null;
      const resolved = resolveOdbiorcy(
        { adres: adres ?? null, spotkanie: meetingHere, jednostki, pelnomocnicy },
        adresaci,
        request.wykluczeni ?? [],
      );
      const odbiorcy = resolved.odbiorcy;
      const summary = summarizeOdbiorcy(odbiorcy);

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
            spotkanieId: request.spotkanieId ?? null,
            odbiorcy: result.odbiorcy ?? [],
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

      if (odbiorcy.length === 0) {
        await record(
          {
            status: 'error',
            errorMessage: noRecipientsMessage(resolved.braki),
            jednostkaNazwa: '',
            jednostkaEmail: '',
            subject: '',
            attachments: [],
            odbiorcy: [],
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
        kalendarz: request.kalendarz ?? null,
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
          to: odbiorcy.map(formatAddressHeader).join(', '),
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
            ...summary,
            subject,
            attachments,
            odbiorcy,
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
            ...summary,
            subject,
            attachments,
            odbiorcy,
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

export interface MailingExportDeps {
  database: DatabaseService;
  /** Where the files land — the user's Downloads folder. */
  downloadsDir: string;
  /** The configured sender, for the .eml's From header; empty ⇒ none written. */
  fromAddress: string;
  fromName: string;
}

/** `Zawiadomienie-o-zebraniu-Pulawska-116-14.10.2026` — readable in a Downloads list. */
function exportBaseName(
  request: MailingExportRequest,
  adresNazwa: string,
  typNazwa: string,
): string {
  // Several resolutions of one meeting share a kind, a community and a date: the
  // template's name is what tells their files apart in a Downloads list.
  const what = slugifyForFileName(
    (request.typ === MAILING_TYP_UCHWALA ? request.templateName : '') || typNazwa || request.templateName || 'mail',
  );
  const where = adresNazwa ? `-${slugifyForFileName(adresNazwa)}` : '';
  const when = request.kalendarz?.dataText ? `-${request.kalendarz.dataText}` : '';
  return `${what}${where}${when}`;
}

/** What one letter is rendered from — a download's request without its formats. */
export type MailingLetterRequest = Omit<MailingExportRequest, 'formats' | 'attachPdf'>;

/**
 * One letter rendered exactly as a send would: its subject and body with every
 * field filled in, and the recipients it resolves to.
 */
async function prepareLetter(database: DatabaseService, request: MailingLetterRequest) {
  const [pola, adresy, jednostki, pelnomocnicy, spotkanie, typy] = await Promise.all([
    database.getMailingPola(),
    database.getAllAdresy(),
    database.getZgnJednostki(),
    database.getZgnPelnomocnicy(),
    findSpotkanie(database, request.spotkanieId),
    database.getMailingTypy().catch(() => []),
  ]);

  const adres =
    request.adresId != null ? (adresy.find((a) => a.id === request.adresId) ?? null) : null;
  const adresNazwa = adres?.nazwa ?? (request.adresNazwa ?? '').trim();
  const typNazwa = typy.find((t) => t.klucz === request.typ)?.nazwa ?? '';

  const ctx: MailingRenderContext = {
    adresNazwa,
    dateText: formatPolishDate(new Date()),
    pola: pola as MailingPole[],
    values: request.values ?? {},
    tableFields: request.tableFields ?? [],
    kalendarz: request.kalendarz ?? null,
  };
  // Same rule as a send: the meeting's own proxy and board apply to its community.
  const meetingHere =
    spotkanie && (adres == null || spotkanie.adresId === adres.id) ? spotkanie : null;
  const odbiorcy: MailingOdbiorca[] = resolveOdbiorcy(
    { adres, spotkanie: meetingHere, jednostki, pelnomocnicy },
    request.adresaci ?? DEFAULT_MAILING_ADRESACI,
    request.wykluczeni ?? [],
  ).odbiorcy;
  return {
    adresNazwa,
    typNazwa,
    subject: renderPlain(request.temat, ctx),
    renderedBody: renderHtml(request.tresc, ctx),
    odbiorcy,
  };
}

/** A letter's PDF, as "Pobierz PDF" writes it — for documents that carry it inside them. */
export async function renderLetterPdf(
  database: DatabaseService,
  request: MailingLetterRequest,
  outPath: string,
): Promise<{ subject: string }> {
  const { subject, renderedBody } = await prepareLetter(database, request);
  await renderHtmlToPdf(buildDocumentHtml(renderedBody, { forPdf: true, logoSrc: MAILING_LOGO_SVG_DATA_URI }), outPath);
  return { subject };
}

/**
 * "Pobierz jako e-mail / PDF": render one letter exactly as a send would and
 * save it to the Downloads folder — a PDF, and/or an .eml the user's mail program
 * opens as a ready-to-send draft (`X-Unsent: 1`): recipients, subject, the HTML
 * body with its letterhead, and the PDF attached. Nothing goes over SMTP and
 * nothing is written to the mailing history — this is a file, not a send.
 */
export async function exportMailing(
  deps: MailingExportDeps,
  request: MailingExportRequest,
): Promise<MailingExportResult> {
  const { database } = deps;
  if (!request.formats || request.formats.length === 0) {
    throw new Error('Wybierz, w jakiej postaci pobrać wiadomość.');
  }
  const { adresNazwa, typNazwa, subject, renderedBody, odbiorcy } = await prepareLetter(database, request);

  const dir = deps.downloadsDir;
  fs.mkdirSync(dir, { recursive: true });
  const base = exportBaseName(request, adresNazwa, typNazwa);
  const pdfHtml = buildDocumentHtml(renderedBody, {
    forPdf: true,
    logoSrc: MAILING_LOGO_SVG_DATA_URI,
  });

  const files: MailingExportResult['files'] = [];
  let pdfPath: string | null = null;
  const ensurePdf = async (): Promise<string> => {
    if (pdfPath) return pdfPath;
    if (request.formats.includes('pdf')) {
      pdfPath = uniquePath(dir, `${base}.pdf`);
    } else {
      // Only the .eml was asked for: the PDF it carries is rendered to a temp
      // folder, so Downloads gets exactly the files the user picked.
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-mailing-eml-'));
      pdfPath = path.join(tempDir, `${base}.pdf`);
    }
    await renderHtmlToPdf(pdfHtml, pdfPath);
    return pdfPath;
  };

  try {
    for (const format of request.formats) {
      if (format === 'pdf') {
        files.push({ format: 'pdf', filePath: await ensurePdf() });
        continue;
      }
      const attachPdf = request.attachPdf !== false;
      const pdfForMail = attachPdf ? await ensurePdf() : null;
      const from = deps.fromAddress.trim()
        ? deps.fromName.trim()
          ? `"${deps.fromName.replace(/"/g, '').trim()}" <${deps.fromAddress.trim()}>`
          : deps.fromAddress.trim()
        : undefined;
      const composer = new MailComposer({
        ...(from ? { from } : {}),
        to: odbiorcy.map(formatAddressHeader).join(', ') || undefined,
        subject,
        text: htmlToPlainText(renderedBody),
        html: buildDocumentHtml(renderedBody, { logoSrc: `cid:${MAILING_LOGO_CID}` }),
        // Outlook and Apple Mail open a message carrying this as an unsent draft,
        // with the Send button — which is the whole point of the file.
        headers: { 'X-Unsent': '1' },
        attachments: [
          ...(pdfForMail ? [{ filename: path.basename(pdfForMail), path: pdfForMail }] : []),
          {
            filename: MAILING_LOGO_FILE_NAME,
            content: Buffer.from(MAILING_LOGO_BASE64, 'base64'),
            contentType: MAILING_LOGO_MIME,
            cid: MAILING_LOGO_CID,
            contentDisposition: 'inline' as const,
          },
        ],
      });
      const message: Buffer = await new Promise((resolve, reject) =>
        composer.compile().build((error, built) => (error ? reject(error) : resolve(built))),
      );
      const emlPath = uniquePath(dir, `${base}.eml`);
      fs.writeFileSync(emlPath, message);
      files.push({ format: 'eml', filePath: emlPath });
    }
  } finally {
    // The temp PDF (eml-only export) has done its job once it is inside the
    // message — or is worthless when the export failed half-way.
    if (pdfPath && !request.formats.includes('pdf')) {
      try {
        fs.rmSync(path.dirname(pdfPath), { recursive: true, force: true });
      } catch (error: unknown) {
        log.warn('[MAILING] temp cleanup failed:', error instanceof Error ? error.message : error);
      }
    }
  }

  return { files, odbiorcy };
}

/**
 * The recipients a letter would go to — what the send screen and the notice
 * editor list before anything is sent. Same resolution as `sendMailing`.
 */
export async function previewOdbiorcy(
  database: DatabaseService,
  request: {
    adresId: number | null;
    spotkanieId?: number | null;
    adresaci: MailingAdresaci;
    wykluczeni?: string[];
  },
) {
  const [adresy, jednostki, pelnomocnicy, spotkanie] = await Promise.all([
    database.getAllAdresy(),
    database.getZgnJednostki(),
    database.getZgnPelnomocnicy(),
    findSpotkanie(database, request.spotkanieId),
  ]);
  const adres =
    request.adresId != null ? (adresy.find((a) => a.id === request.adresId) ?? null) : null;
  const meetingHere =
    spotkanie && (adres == null || spotkanie.adresId === adres.id) ? spotkanie : null;
  return resolveOdbiorcy(
    { adres, spotkanie: meetingHere, jednostki, pelnomocnicy },
    request.adresaci,
    request.wykluczeni ?? [],
  );
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
