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

import { BrowserWindow, app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from 'electron-log';

/** The reusable renderer. Created on first use, dropped when it goes away. */
let sharedWindow: BrowserWindow | null = null;

/**
 * Serializes renders. One window can only hold one document at a time, so two
 * overlapping calls would print each other's letter — the kind of mix-up that
 * would be invisible until a city unit received the wrong community's PDF.
 */
let queue: Promise<unknown> = Promise.resolve();

function getWindow(): BrowserWindow {
  if (sharedWindow && !sharedWindow.isDestroyed()) return sharedWindow;
  // Script-free: this window only ever loads our own generated markup, and
  // nothing in a letter needs to execute.
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true },
  });
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

async function renderNow(html: string, outPath: string): Promise<void> {
  // The markup goes to a temp file rather than a `data:` URL: a short letter
  // would fit, but a long one would hit the URL-length limit and fail in a way
  // that is tedious to diagnose.
  const tempDir = fs.mkdtempSync(path.join(app?.getPath?.('temp') ?? os.tmpdir(), 'ff-mailing-'));
  const tempHtml = path.join(tempDir, 'mail.html');
  fs.writeFileSync(tempHtml, html, 'utf8');

  try {
    const win = getWindow();
    await win.loadFile(tempHtml);
    const data = await win.webContents.printToPDF({
      pageSize: 'A4',
      // Backgrounds are the design here, not decoration: without this the tinted
      // page and the letterhead band would print as blank white.
      printBackground: true,
      // No page margins: the tint has to reach the paper edge, or the letter
      // would read as a grey box floating in a white frame. The white space
      // around the card comes from the shell's own padding instead.
      margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, data);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error: unknown) {
      // A leftover temp file is harmless; losing the PDF over it would not be.
      log.warn('[MAILING] temp cleanup failed:', error instanceof Error ? error.message : error);
    }
  }
}

/** Render a complete HTML document to a PDF file at `outPath`. */
export function renderHtmlToPdf(html: string, outPath: string): Promise<void> {
  // Chain onto the queue whether the previous render succeeded or failed, so one
  // bad letter cannot block the rest of the batch.
  const run = queue.then(
    () => renderNow(html, outPath),
    () => renderNow(html, outPath),
  );
  queue = run.catch(() => undefined);
  return run;
}
