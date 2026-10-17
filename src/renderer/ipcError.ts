/**
 * What the user reads when an IPC call fails. Electron wraps every rejection
 * from `ipcMain.handle` as "Error invoking remote method 'db:…': Error: <message>"
 * — the channel name means nothing to the user, the main process's own message
 * does. Every `notify.error` fed from a caught IPC error goes through this.
 *
 * A refusal the main process raised as an `AppError` (shared/app-errors.ts)
 * carries a code: it is shown in the app's language, and `isIpcError` lets a
 * view react to one refusal (a save conflict) without matching its text.
 */
import { AppErrorCode, hasAppErrorCode, localizeEmbeddedErrors, localizeErrorMessage } from '../shared/app-errors';
import type { Language } from './translations';

const ELECTRON_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;

// The app's language, set by App whenever it changes — the helpers below are
// called from event handlers all over the renderer, which have no hook to read it.
let errorLanguage: Language = 'pl';

export function setIpcErrorLanguage(language: Language): void {
  errorLanguage = language;
}

function rawMessage(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : '';
}

/** The main process's message without Electron's prefix, in the app's language; `fallback` when there is none. */
export function ipcErrorMessage(err: unknown, fallback: string): string {
  const raw = rawMessage(err);
  return localizeErrorMessage(raw.replace(ELECTRON_PREFIX, ''), errorLanguage).trim() || fallback;
}

/**
 * A text about to be shown, with any coded refusal inside it worded in the
 * app's language — the notifications' last guard, so a message built from a
 * raw `err.message` never shows the code marker.
 */
export function shownText(text: string): string {
  return localizeEmbeddedErrors(text, errorLanguage);
}

/** Whether the failure is the main process's refusal `code`. */
export function isIpcError(err: unknown, code: AppErrorCode): boolean {
  return hasAppErrorCode(rawMessage(err), code);
}
