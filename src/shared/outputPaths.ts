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
