/**
 * Errors the main process raises for the person to read, as codes with a Polish
 * and an English text — so a refusal reads in the app's language, and the
 * renderer can tell a conflict from any other failure without matching text.
 *
 * Electron hands the renderer only the `message` of a rejected `ipcMain.handle`,
 * so the code rides inside it: the Polish text (what the log shows), then a
 * marker `[[app-error:<code>:<params>]]`. `ipcErrorMessage` in the renderer
 * finds the marker anywhere in the message — a caller that prefixed it
 * (`${op}: ${message}`) still works — and shows the text in the app's language.
 *
 * Technical failures (`${op}: ${error.message}` from Supabase, a file system
 * error) stay plain `Error`s: they have no text worth translating, and the
 * renderer shows them after its own sentence ("Nie udało się zapisać: …").
 *
 * A text's `{name}` placeholders are filled from the params given at the throw.
 */

type ErrorText = { pl: string; en: string };

export const APP_ERRORS = {
  // ---------------- Concurrent edits ----------------
  concurrentEdit: {
    pl: 'Te dane zmieniły się w międzyczasie (ktoś inny je zapisał). Odśwież widok i wprowadź zmiany ponownie.',
    en: 'This data changed in the meantime (somebody else saved it). Refresh the view and make your changes again.',
  },
  concurrentRetriesExhausted: {
    pl: 'Zapis się nie udał — te dane zmieniały się w tym czasie kilka razy z rzędu. Spróbuj ponownie.',
    en: 'The save did not go through — this data changed several times in a row meanwhile. Try again.',
  },
  zadanieConflict: {
    pl: 'To zadanie zmieniło się w międzyczasie (ktoś inny je zapisał). Otwórz je ponownie, żeby zobaczyć aktualną wersję.',
    en: 'This task changed in the meantime (somebody else saved it). Open it again to see the current version.',
  },
} satisfies Record<string, ErrorText>;

export type AppErrorCode = keyof typeof APP_ERRORS;

export type AppErrorParams = Record<string, string | number>;

const MARKER = /\[\[app-error:([A-Za-z0-9_]+):([^\]]*)\]\]/;

function fill(text: string, params: AppErrorParams | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}

/** The text of `code` in `language`, its placeholders filled. */
export function appErrorText(code: AppErrorCode, params: AppErrorParams | undefined, language: 'pl' | 'en'): string {
  const entry: ErrorText = APP_ERRORS[code];
  return fill(entry[language] ?? entry.pl, params);
}

/** A refusal the person reads: `message` is the Polish text plus the code marker. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly params: AppErrorParams | undefined;

  constructor(code: AppErrorCode, params?: AppErrorParams) {
    super(`${appErrorText(code, params, 'pl')} [[app-error:${code}:${encodeURIComponent(JSON.stringify(params ?? {}))}]]`);
    this.name = 'AppError';
    this.code = code;
    this.params = params;
  }
}

/** The code and params carried by a message (an IPC rejection, a stored error), if it has them. */
export function parseAppError(message: string): { code: AppErrorCode; params: AppErrorParams } | null {
  const m = MARKER.exec(message);
  if (!m || !(m[1] in APP_ERRORS)) return null;
  let params: AppErrorParams = {};
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(m[2]));
    if (parsed && typeof parsed === 'object') params = parsed as AppErrorParams;
  } catch {
    // A mangled marker still names its code; the text shows with its placeholders.
  }
  return { code: m[1] as AppErrorCode, params };
}

/** Whether `err` (or a message) carries `code` — for a caller that reacts to one refusal in particular. */
export function hasAppErrorCode(err: unknown, code: AppErrorCode): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return parseAppError(message)?.code === code;
}

/**
 * A message as the person reads it in `language`: a coded refusal in that
 * language, anything else as it is, with any marker left in it removed.
 */
export function localizeErrorMessage(message: string, language: 'pl' | 'en'): string {
  const parsed = parseAppError(message);
  if (!parsed) return message;
  return appErrorText(parsed.code, parsed.params, language);
}
