import { app, net } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

/**
 * "Pobierz" in Settings: the installer of the newest release (Windows .exe,
 * macOS .dmg) saved to the Downloads folder — whatever version this app is.
 *
 * Deliberately separate from electron-updater: its downloadUpdate() fires
 * `update-downloaded`, which on Windows quits and installs two seconds later.
 * This only leaves a file for the user to run, keep, or hand to someone else.
 */

const RELEASES_LATEST_API =
  'https://api.github.com/repos/wikunia-pura/statement_converter/releases/latest';

export type InstallerDownloadResult =
  | { success: true; filePath: string; fileName: string; version: string; alreadyDownloaded: boolean }
  | { success: false; error: string; unsupported?: boolean };

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

/** The installer asset for this platform, or null where none is published. */
function pickInstallerAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  if (process.platform === 'win32') {
    return assets.find((a) => a.name.toLowerCase().endsWith('.exe')) ?? null;
  }
  if (process.platform === 'darwin') {
    // The .zip next to it is the updater's payload, not something to install by hand.
    const dmgs = assets.filter((a) => a.name.toLowerCase().endsWith('.dmg'));
    return dmgs.find((a) => a.name.includes(process.arch)) ?? dmgs[0] ?? null;
  }
  return null;
}

async function download(onProgress: (percent: number) => void): Promise<InstallerDownloadResult> {
  // net.fetch goes through Chromium's network stack, so it honours the system
  // proxy the same way electron-updater does — Node's global fetch would not.
  const releaseResponse = await net.fetch(RELEASES_LATEST_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'FileFunky-installer',
    },
  });
  if (!releaseResponse.ok) {
    throw new Error(`GitHub ${releaseResponse.status} ${releaseResponse.statusText}`);
  }
  const release = (await releaseResponse.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
  const version = (release.tag_name ?? '').replace(/^v/, '');
  const asset = pickInstallerAsset(release.assets ?? []);
  if (!asset) {
    return { success: false, unsupported: true, error: `No installer for ${process.platform} in ${version}` };
  }

  const downloadsDir = app.getPath('downloads');
  const filePath = path.join(downloadsDir, asset.name);
  // The file name carries the version, so a file of the right size is this exact installer.
  if (fs.existsSync(filePath) && fs.statSync(filePath).size === asset.size) {
    log.info(`[INSTALLER] ${asset.name} already in Downloads — not downloading again`);
    return { success: true, filePath, fileName: asset.name, version, alreadyDownloaded: true };
  }

  log.info(`[INSTALLER] Downloading ${asset.name} (${asset.size} B) to ${downloadsDir}`);
  const response = await net.fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'FileFunky-installer' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const total = Number(response.headers.get('content-length')) || asset.size;
  let received = 0;
  let lastPercent = -1;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
      callback(null, chunk);
    },
  });

  // Written under a .part name first: a half-finished download must never sit
  // in Downloads looking like a runnable installer.
  const partPath = `${filePath}.part`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      counter,
      fs.createWriteStream(partPath),
    );
    fs.renameSync(partPath, filePath);
  } catch (error) {
    fs.rmSync(partPath, { force: true });
    throw error;
  }

  log.info(`[INSTALLER] Saved ${filePath}`);
  return { success: true, filePath, fileName: asset.name, version, alreadyDownloaded: false };
}

/** A second click while a download runs joins it rather than starting another. */
let inFlight: Promise<InstallerDownloadResult> | null = null;

export function downloadLatestInstaller(
  onProgress: (percent: number) => void,
): Promise<InstallerDownloadResult> {
  if (!inFlight) {
    inFlight = download(onProgress)
      .catch((error): InstallerDownloadResult => {
        log.error('[INSTALLER] Download failed:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
