/**
 * Pure, dependency-free helpers for resolving the destination paths of generated
 * files. Preview (podglad) and accounting files live in dedicated subfolders
 * ("podglad" / "accounting") of the configured output folder.
 *
 * Kept free of the Node `path` module so it can be shared with the renderer.
 * Handles both POSIX ("/") and Windows ("\\") separators.
 */

function splitPath(outputPath: string): { dir: string; fileName: string; sep: string } {
  const lastSlash = Math.max(outputPath.lastIndexOf('/'), outputPath.lastIndexOf('\\'));
  const sep = outputPath.includes('\\') ? '\\' : '/';
  if (lastSlash < 0) {
    return { dir: '', fileName: outputPath, sep };
  }
  return {
    dir: outputPath.slice(0, lastSlash),
    fileName: outputPath.slice(lastSlash + 1),
    sep,
  };
}

function buildSubfolderPath(outputPath: string, subfolder: string, suffix: string): string {
  const { dir, fileName, sep } = splitPath(outputPath);
  const base = fileName.replace(/\.[^.]+$/, '') + suffix;
  return dir ? `${dir}${sep}${subfolder}${sep}${base}` : `${subfolder}${sep}${base}`;
}

/** Destination path for the preview (podglad) file, inside the "podglad" subfolder. */
export function podgladOutputPath(outputPath: string): string {
  return buildSubfolderPath(outputPath, 'podglad', '-podglad.txt');
}

/** Destination path for the accounting file, inside the "accounting" subfolder. */
export function accountingOutputPath(outputPath: string): string {
  return buildSubfolderPath(outputPath, 'accounting', '-accounting.txt');
}

/** Convenience resolver used by the renderer's file-open handlers. */
export function resolveOutputFilePath(outputPath: string, type: 'preview' | 'accounting'): string {
  return type === 'preview' ? podgladOutputPath(outputPath) : accountingOutputPath(outputPath);
}

/**
 * Address part of a generated output filename, sanitized for the filesystem.
 * Shared with the main process (which builds the names) so the renderer can
 * read an address back out of a historical `outputPath` — see
 * `adresPartOfOutputPath`.
 */
export function sanitizeForFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
    .replace(/\s+/g, '_')          // Replace spaces with underscores
    .replace(/_+/g, '_')           // Collapse multiple underscores
    .replace(/^_|_$/g, '')         // Remove leading/trailing underscores
    .substring(0, 50);             // Limit length
}

/**
 * Inverse of the `{address}_{YYYYMMDD}_{HHMMSS}.txt` naming used for generated
 * files: returns the sanitized address part, or null when the name doesn't
 * follow that shape. Used to attribute history rows written before the address
 * was stored alongside them.
 */
export function adresPartOfOutputPath(outputPath: string): string | null {
  if (!outputPath) return null;
  const { fileName } = splitPath(outputPath);
  const base = fileName.replace(/\.[^.]+$/, '');
  const match = base.match(/^(.*)_\d{8}_\d{6}$/);
  const part = match?.[1]?.trim();
  return part ? part : null;
}
