import { dialog, BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron';
import path from 'path';

/**
 * The folder the last open dialog was left in, for this run of the app.
 *
 * Until Electron 43 a dialog given no `defaultPath` opened where the system last
 * left it — usually the folder the previous statement came from, where the next
 * one sits too. Electron 43 opens such a dialog in Downloads instead, so the
 * app keeps that place itself.
 */
let lastFolder: string | undefined;

/** `dialog.showOpenDialog`, starting where the previous open dialog was left unless told otherwise. */
export async function showOpenDialog(
  win: BrowserWindow,
  options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  const result = await dialog.showOpenDialog(win, {
    ...options,
    defaultPath: options.defaultPath ?? lastFolder,
  });
  const first = result.canceled ? undefined : result.filePaths[0];
  // The folder the pick was made in, as the system dialog remembered it — for a
  // picked folder that is its parent, not the folder itself.
  if (first) lastFolder = path.dirname(first);
  return result;
}
