/**
 * Checks for file paths that arrive from the renderer — and so, through it, from
 * the shared database: a history row's output path, a mailing's archived
 * attachment, a scanned statement's relative path. Every account of the team can
 * write those rows, so a path is data to be checked before the main process hands
 * it to the shell, not an instruction.
 *
 * Deliberately no directory allowlist: statements and their outputs live wherever
 * the office keeps them. What is refused is what is never a document: a network
 * host nobody configured (on Windows merely touching `\\host\share` sends the
 * user's NTLM hash to it), a path climbing out with `..`, and anything the system
 * would run rather than open.
 *
 * No `electron` import, so the pure parts can be exercised with plain `tsx`.
 */

import fs from 'fs';
import nodePath from 'path';

type PathImpl = typeof nodePath.posix;

/**
 * Extensions the system runs, installs, mounts or follows instead of opening as a
 * document. Checked on the path and on its real target, and on folders too: a
 * macOS `.app` is a folder that `openPath` launches.
 */
const EXECUTABLE_EXTENSIONS = new Set([
  // Windows
  '.exe', '.bat', '.cmd', '.com', '.msi', '.msp', '.msc', '.lnk', '.url', '.scr', '.pif', '.cpl',
  '.hta', '.reg', '.inf', '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.jar', '.appref-ms', '.application', '.gadget', '.settingcontent-ms', '.library-ms',
  '.search-ms', '.xll', '.iso', '.img', '.vhd', '.vhdx',
  // macOS
  '.app', '.command', '.tool', '.scpt', '.scptd', '.applescript', '.pkg', '.mpkg', '.dmg',
  '.workflow', '.action', '.terminal', '.webloc', '.inetloc', '.prefpane', '.saver',
  // Scripts and Linux launchers
  '.sh', '.bash', '.zsh', '.csh', '.py', '.pyw', '.rb', '.pl', '.appimage', '.run', '.desktop',
]);

/** `\\server\share`, `//server/share`, and the `\\?\` / `\\.\` device forms. */
function isNetworkOrDevicePath(p: string): boolean {
  return /^[\\/]{2}/.test(p);
}

/** `smb://`, `file://`, `https://` … — but not a Windows drive (`C:\`). */
function isUrlLike(p: string): boolean {
  return /^[a-z][a-z0-9+.-]+:/i.test(p);
}

function hasParentSegment(p: string): boolean {
  return p.split(/[\\/]+/).includes('..');
}

/**
 * The extension as the system sees it. Windows drops trailing dots and spaces
 * ("faktura.exe." runs as an .exe), so they are dropped here too.
 */
export function effectiveExtension(p: string, impl: PathImpl = nodePath): string {
  return impl.extname(p.replace(/[. ]+$/, '')).toLowerCase();
}

export function isExecutableName(p: string, impl: PathImpl = nodePath): boolean {
  return EXECUTABLE_EXTENSIONS.has(effectiveExtension(p, impl));
}

/** True when `child` is `dir` itself or lies under it. Lexical — resolve symlinks first if that matters. */
export function isInsideDir(child: string, dir: string, impl: PathImpl = nodePath): boolean {
  if (!child || !dir) return false;
  const caseless = impl === nodePath.win32 || process.platform === 'win32' || process.platform === 'darwin';
  const norm = (p: string) => {
    const resolved = impl.resolve(p);
    return caseless ? resolved.toLowerCase() : resolved;
  };
  const c = norm(child);
  const d = norm(dir);
  if (c === d) return true;
  return c.startsWith(d.endsWith(impl.sep) ? d : d + impl.sep);
}

export interface LocalPathOptions {
  /**
   * Folders a network path may lie under — the ones configured in Settings on
   * this machine (the shared statements folder, say). Any other `\\host` is
   * refused before the file system is touched.
   */
  networkRoots?: string[];
  /** Platform path flavour; the real one unless a check is being tested. */
  impl?: PathImpl;
}

/**
 * The string-only half of the check: no file-system access, so it is safe to run
 * on anything. Returns the normalized path, or null when the path is refused.
 */
export function checkLocalPathString(raw: unknown, options: LocalPathOptions = {}): string | null {
  const impl = options.impl ?? nodePath;
  if (typeof raw !== 'string') return null;
  const p = raw.trim();
  if (!p || p.includes('\0')) return null;
  if (hasParentSegment(p)) return null;
  if (isUrlLike(p)) return null;
  if (isNetworkOrDevicePath(p)) {
    // `\\?\` and `\\.\` reach devices and raw volumes — never a document path.
    if (/^[\\/]{2}[?.][\\/]/.test(p)) return null;
    const roots = (options.networkRoots ?? []).filter((r) => r && isNetworkOrDevicePath(r));
    if (!roots.some((root) => isInsideDir(p, root, impl))) return null;
  }
  if (!impl.isAbsolute(p)) return null;
  // An NTFS alternate stream ("plik.pdf:zz.exe") is another file behind the name.
  if (impl === nodePath.win32 && p.indexOf(':', 2) !== -1) return null;
  return impl.normalize(p);
}

export interface OpenablePathOptions extends LocalPathOptions {
  /** Revealing in Finder/Explorer runs nothing, so it may point at a program. */
  allowExecutable?: boolean;
}

/**
 * A path the shell may open or reveal: absolute, local (or under a configured
 * network folder), no `..`, an existing regular file or folder, and — unless
 * `allowExecutable` — nothing the system would execute, judged on the path and
 * on its real target. Returns the normalized path, or null.
 *
 * Folders pass on purpose: the UI opens output folders through the same call.
 */
export function checkOpenablePath(raw: unknown, options: OpenablePathOptions = {}): string | null {
  const p = checkLocalPathString(raw, options);
  if (!p) return null;
  if (!options.allowExecutable && isExecutableName(p)) return null;
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile() && !stat.isDirectory()) return null;
    if (!options.allowExecutable && isExecutableName(fs.realpathSync(p))) return null;
  } catch {
    return null;
  }
  return p;
}

/**
 * A file name safe to use as the last part of a path: whatever came before the
 * last separator is dropped, control and Windows-reserved characters go, and a
 * name that ends up empty (or `.`/`..`) falls back to `fallback`.
 */
export function safeFileName(name: unknown, fallback: string): string {
  const last = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = last
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned.length > 200 ? cleaned.slice(cleaned.length - 200) : cleaned;
}
