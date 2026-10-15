/**
 * What the user reads when an IPC call fails. Electron wraps every rejection
 * from `ipcMain.handle` as "Error invoking remote method 'db:…': Error: <message>"
 * — the channel name means nothing to the user, the main process's own message
 * does. Every `notify.error` fed from a caught IPC error goes through this.
 */

const ELECTRON_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;

/** The main process's message without Electron's prefix; `fallback` when there is none. */
export function ipcErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return raw.replace(ELECTRON_PREFIX, '').trim() || fallback;
}
