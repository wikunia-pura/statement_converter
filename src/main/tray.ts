import { Menu, Notification, Tray, nativeImage } from 'electron';
import Store from 'electron-store';
import { TRAY_ICON_PNG_BASE64 } from './trayIcon';

/**
 * The app's presence in the system tray, and the one-time hint about it.
 *
 * Closing the window does not end FileFunky any more — it hides the window and
 * the app keeps running, because everything that must happen while nobody is
 * looking (the task notifications above all) runs in this process. The tray icon
 * is how the person finds it again, and the only way to really quit it.
 */

interface Deps {
  /** Bring the window back (creating it if it is gone). */
  showWindow: () => void;
  /** Really quit: runs the exit backup, then ends the process. */
  quit: () => void;
  getLanguage: () => 'pl' | 'en';
}

const TEXT = {
  pl: {
    tooltip: 'FileFunky',
    open: 'Otwórz FileFunky',
    quit: 'Zamknij FileFunky',
    hintTitle: 'FileFunky działa w tle',
    hintBodyWin:
      'Zamknięcie okna nie kończy aplikacji — powiadomienia o zadaniach nadal będą przychodzić. Ikona jest przy zegarze; zamkniesz ją z jej menu („Zamknij FileFunky”).',
    hintBodyMac:
      'Zamknięcie okna nie kończy aplikacji — powiadomienia o zadaniach nadal będą przychodzić. Ikona jest na pasku menu; zamkniesz ją z jej menu („Zamknij FileFunky”).',
  },
  en: {
    tooltip: 'FileFunky',
    open: 'Open FileFunky',
    quit: 'Quit FileFunky',
    hintTitle: 'FileFunky keeps running in the background',
    hintBodyWin:
      'Closing the window does not quit the app — task notifications will keep arriving. The icon is by the clock; quit from its menu ("Quit FileFunky").',
    hintBodyMac:
      'Closing the window does not quit the app — task notifications will keep arriving. The icon is in the menu bar; quit from its menu ("Quit FileFunky").',
  },
} as const;

let tray: Tray | null = null;

const hintStore = new Store<{ hintShown: boolean }>({
  name: 'tray',
  defaults: { hintShown: false },
});

export function createTray(deps: Deps): void {
  if (tray) return;
  const text = () => TEXT[deps.getLanguage()];
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64'), {
    scaleFactor: 2,
  });
  tray = new Tray(icon);
  tray.setToolTip(text().tooltip);

  // Rebuilt on every right-click so a language change shows without a restart.
  const buildMenu = () =>
    Menu.buildFromTemplate([
      { label: text().open, click: () => deps.showWindow() },
      { type: 'separator' },
      { label: text().quit, click: () => deps.quit() },
    ]);
  tray.setContextMenu(buildMenu());
  tray.on('right-click', () => tray?.setContextMenu(buildMenu()));
  // Windows: a click on the icon is "open it". (macOS opens the menu instead.)
  tray.on('click', () => deps.showWindow());
  tray.on('double-click', () => deps.showWindow());
}

/**
 * Say, once per machine, that the window closing did not close the app. The
 * first time someone presses X on an app that then stays alive is exactly when
 * they would otherwise wonder where it went.
 */
export function announceBackgroundOnce(language: 'pl' | 'en'): void {
  if (hintStore.get('hintShown') || !Notification.isSupported()) return;
  hintStore.set('hintShown', true);
  const t = TEXT[language];
  new Notification({
    title: t.hintTitle,
    body: process.platform === 'darwin' ? t.hintBodyMac : t.hintBodyWin,
  }).show();
}
