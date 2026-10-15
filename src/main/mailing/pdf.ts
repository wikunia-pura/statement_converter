/**
 * HTML → PDF using Chromium's own print pipeline (`webContents.printToPDF`).
 * Electron already ships the engine, so this needs no PDF library and — crucially
 * for Polish letters — no font embedding work: whatever renders on screen renders
 * in the file, diacritics included.
 *
 * ── One window, reused ────────────────────────────────────────────────────────
 * A send generates one PDF per community, so this used to create and destroy a
 * hidden BrowserWindow per letter. That turned out to be unreliable: the first
 * render succeeded and the second failed with `ERR_FAILED` while loading its own
 * temp file — reproducibly, and independent of the window's webPreferences. Every
 * mailing to more than one community would have gone out with the PDF missing
 * from all but the first message.
 *
 * Reusing a single window renders any number of letters in a row, and it is the
 * cheaper design anyway: window creation is by far the most expensive part of a
 * render, and a batch now pays it once.
 */

import { BrowserWindow, PrintToPDFOptions, app, session } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import log from 'electron-log';

/** The reusable renderer. Created on first use, dropped when it goes away. */
let sharedWindow: BrowserWindow | null = null;

/**
 * Serializes renders. One window can only hold one document at a time, so two
 * overlapping calls would print each other's letter — the kind of mix-up that
 * would be invisible until a city unit received the wrong community's PDF.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * The render window's own in-memory session. A letter's HTML is user-written
 * (templates, resolutions), so this window may load exactly one thing: the temp
 * file being printed. Everything else — a `file://` image pointing at the user's
 * documents, an `http(s)` tracker, a meta refresh to another file that would then
 * be printed instead of the letter — is cancelled here. The letterhead and the
 * fonts are `data:` URIs, which never reach the network layer.
 *
 * A separate partition, because a filter on the default session would apply to
 * the main window too.
 */
const RENDER_PARTITION = 'ff-pdf-render';

/** The temp file currently being printed — the only page the render window may load. */
let allowedFile: string | null = null;

/**
 * Compared as paths, not URL strings: Electron builds the `file://` URL for
 * `loadFile` itself, and how it escapes a space or a Polish letter in the user's
 * temp folder is not worth betting a mailing's PDFs on.
 */
function isAllowedPage(url: string): boolean {
  if (!allowedFile || !url.startsWith('file:')) return false;
  try {
    const requested = path.resolve(fileURLToPath(url));
    const allowed = path.resolve(allowedFile);
    return process.platform === 'linux' ? requested === allowed : requested.toLowerCase() === allowed.toLowerCase();
  } catch {
    return false;
  }
}

let renderSessionReady = false;

function lockRenderSession(): void {
  if (renderSessionReady) return;
  renderSessionReady = true;
  const ses = session.fromPartition(RENDER_PARTITION);
  ses.webRequest.onBeforeRequest((details, callback) => {
    // `data:` should never get here; allowed anyway, so a change in that never
    // costs the letters their letterhead — the CSP below confines it.
    const allowed =
      details.url.startsWith('data:') || (details.resourceType === 'mainFrame' && isAllowedPage(details.url));
    if (!allowed) log.warn('[PDF] blocked a resource in a rendered document:', details.url.slice(0, 200));
    callback({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

/**
 * Belt and braces for the session filter: a Content-Security-Policy as the first
 * thing in the document, allowing only inline styles and `data:` images/fonts.
 * Inserted after `<head>` — never before the doctype, which would drop the
 * document into quirks mode and change the layout.
 */
const RENDER_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
  "base-uri 'none'; form-action 'none'";

function withRenderCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return doctype[0] + meta + html.slice(doctype[0].length);
  return meta + html;
}

function getWindow(): BrowserWindow {
  if (sharedWindow && !sharedWindow.isDestroyed()) return sharedWindow;
  lockRenderSession();
  // Script-free: this window only ever loads our own generated markup, and
  // nothing in a letter needs to execute.
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, partition: RENDER_PARTITION },
  });
  // No navigating away from the letter and no new windows, whatever its markup says.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    if (sharedWindow === win) sharedWindow = null;
  });
  sharedWindow = win;
  return win;
}

// Without this the hidden window keeps the app alive after the last real window
// closes, and quitting would hang.
app.on('will-quit', () => {
  if (sharedWindow && !sharedWindow.isDestroyed()) sharedWindow.destroy();
  sharedWindow = null;
});

/**
 * The letter's print settings: edge-to-edge, because the mail's tinted page is
 * the design. A multi-page document passes its own (margins, a page footer).
 */
const LETTER_PRINT: PrintToPDFOptions = {
  pageSize: 'A4',
  // Backgrounds are the design here, not decoration: without this the tinted
  // page and the letterhead band would print as blank white.
  printBackground: true,
  // No page margins: the tint has to reach the paper edge, or the letter
  // would read as a grey box floating in a white frame. The white space
  // around the card comes from the shell's own padding instead.
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
};

async function renderNow(html: string, outPath: string, print: PrintToPDFOptions): Promise<void> {
  // The markup goes to a temp file rather than a `data:` URL: a short letter
  // would fit, but a long one would hit the URL-length limit and fail in a way
  // that is tedious to diagnose.
  const tempDir = fs.mkdtempSync(path.join(app?.getPath?.('temp') ?? os.tmpdir(), 'ff-mailing-'));
  const tempHtml = path.join(tempDir, 'mail.html');
  fs.writeFileSync(tempHtml, withRenderCsp(html), 'utf8');

  try {
    const win = getWindow();
    allowedFile = tempHtml;
    await win.loadFile(tempHtml);
    const data = await win.webContents.printToPDF(print);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, data);
  } finally {
    allowedFile = null;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error: unknown) {
      // A leftover temp file is harmless; losing the PDF over it would not be.
      log.warn('[MAILING] temp cleanup failed:', error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Render a complete HTML document to a PDF file at `outPath` — with the
 * letter's edge-to-edge settings unless `print` says otherwise.
 */
export function renderHtmlToPdf(html: string, outPath: string, print: PrintToPDFOptions = LETTER_PRINT): Promise<void> {
  // Chain onto the queue whether the previous render succeeded or failed, so one
  // bad letter cannot block the rest of the batch.
  const run = queue.then(
    () => renderNow(html, outPath, print),
    () => renderNow(html, outPath, print),
  );
  queue = run.catch(() => undefined);
  return run;
}
