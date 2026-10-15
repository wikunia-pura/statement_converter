import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import nodePath from 'path';
import {
  checkLocalPathString,
  checkOpenablePath,
  isExecutableName,
  isInsideDir,
  safeFileName,
} from './pathGuards';

const win32 = nodePath.win32;
const posix = nodePath.posix;

describe('checkLocalPathString — Windows paths', () => {
  const opts = { impl: win32 };

  it('a local absolute path passes, normalized', () => {
    expect(checkLocalPathString('C:\\Wyciagi\\2026\\wyciag.pdf', opts)).toBe(
      'C:\\Wyciagi\\2026\\wyciag.pdf'
    );
    expect(checkLocalPathString('  C:/Wyciagi/wyciag.pdf ', opts)).toBe('C:\\Wyciagi\\wyciag.pdf');
  });

  it('a UNC host nobody configured is refused before the file system is touched', () => {
    expect(checkLocalPathString('\\\\evil-host\\share\\wyciag.pdf', opts)).toBeNull();
    expect(checkLocalPathString('//evil-host/share/wyciag.pdf', opts)).toBeNull();
  });

  it('a UNC path under a configured network folder passes — and only under it', () => {
    const withRoot = { ...opts, networkRoots: ['\\\\nas\\wyciagi'] };
    expect(checkLocalPathString('\\\\nas\\wyciagi\\2026\\wyciag.pdf', withRoot)).toBe(
      '\\\\nas\\wyciagi\\2026\\wyciag.pdf'
    );
    expect(checkLocalPathString('\\\\NAS\\Wyciagi\\wyciag.pdf', withRoot)).not.toBeNull();
    expect(checkLocalPathString('\\\\nas\\wyciagi-inne\\wyciag.pdf', withRoot)).toBeNull();
    expect(checkLocalPathString('\\\\nas\\inne\\wyciag.pdf', withRoot)).toBeNull();
  });

  it('device and raw-volume forms are never documents', () => {
    const withRoot = { ...opts, networkRoots: ['\\\\?\\C:\\'] };
    expect(checkLocalPathString('\\\\?\\C:\\wyciag.pdf', withRoot)).toBeNull();
    expect(checkLocalPathString('\\\\.\\PhysicalDrive0', withRoot)).toBeNull();
  });

  it('a path climbing out with ".." is refused', () => {
    expect(checkLocalPathString('C:\\Wyciagi\\..\\Windows\\system.ini', opts)).toBeNull();
    expect(checkLocalPathString('C:/Wyciagi/../x.pdf', opts)).toBeNull();
  });

  it('an NTFS alternate data stream is another file behind the name', () => {
    expect(checkLocalPathString('C:\\Wyciagi\\wyciag.pdf:ukryty.exe', opts)).toBeNull();
    expect(checkLocalPathString('C:\\Wyciagi\\wyciag.pdf::$DATA', opts)).toBeNull();
  });

  it('relative, drive-relative, URL-like and non-string input is refused', () => {
    expect(checkLocalPathString('wyciag.pdf', opts)).toBeNull();
    expect(checkLocalPathString('C:wyciag.pdf', opts)).toBeNull();
    expect(checkLocalPathString('file:///C:/wyciag.pdf', opts)).toBeNull();
    expect(checkLocalPathString('smb://nas/wyciagi/wyciag.pdf', opts)).toBeNull();
    expect(checkLocalPathString('', opts)).toBeNull();
    expect(checkLocalPathString('C:\\a\0.pdf', opts)).toBeNull();
    expect(checkLocalPathString(42, opts)).toBeNull();
    expect(checkLocalPathString(null, opts)).toBeNull();
  });
});

describe('checkLocalPathString — POSIX paths', () => {
  const opts = { impl: posix };
  it('absolute passes; relative, "..", URL and double-slash host forms do not', () => {
    expect(checkLocalPathString('/Users/test/Wyciagi/wyciag.pdf', opts)).toBe(
      '/Users/test/Wyciagi/wyciag.pdf'
    );
    expect(checkLocalPathString('Wyciagi/wyciag.pdf', opts)).toBeNull();
    expect(checkLocalPathString('/Users/test/../../etc/hosts', opts)).toBeNull();
    expect(checkLocalPathString('smb://nas/wyciagi', opts)).toBeNull();
    expect(checkLocalPathString('//nas/wyciagi/wyciag.pdf', opts)).toBeNull();
  });
});

describe('isExecutableName', () => {
  it.each([
    'faktura.exe',
    'FAKTURA.EXE',
    'faktura.pdf.lnk',
    'skrypt.ps1',
    'Narzedzie.app',
    'run.command',
    'x.sh',
    'obraz.dmg',
  ])('%s would be run, not opened', (name) => expect(isExecutableName(name, posix)).toBe(true));

  it('trailing dots and spaces are dropped, as Windows does ("faktura.exe." runs)', () => {
    expect(isExecutableName('faktura.exe.', win32)).toBe(true);
    expect(isExecutableName('faktura.exe . ', win32)).toBe(true);
  });

  it.each(['wyciag.pdf', 'raport.xlsx', 'wyciag.mt940', 'wyciag.xml', 'katalog'])(
    '%s is a document',
    (name) => expect(isExecutableName(name, posix)).toBe(false)
  );
});

describe('isInsideDir', () => {
  it('lexical containment, not string prefix', () => {
    expect(isInsideDir('/data/wyciagi/2026/a.pdf', '/data/wyciagi', posix)).toBe(true);
    expect(isInsideDir('/data/wyciagi', '/data/wyciagi/', posix)).toBe(true);
    expect(isInsideDir('/data/wyciagi-inne/a.pdf', '/data/wyciagi', posix)).toBe(false);
    expect(isInsideDir('/data/wyciagi/../inne/a.pdf', '/data/wyciagi', posix)).toBe(false);
    expect(isInsideDir('', '/data', posix)).toBe(false);
  });

  it('Windows paths compare without case', () => {
    expect(isInsideDir('C:\\Wyciagi\\A.pdf', 'c:\\wyciagi', win32)).toBe(true);
  });
});

describe('checkOpenablePath — on a real folder', () => {
  let dir = '';
  // Creating a symlink needs developer mode or admin rights on Windows.
  let symlinkOk = false;
  const at = (name: string) => nodePath.join(dir, name);

  beforeAll(() => {
    dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'pathguards-'));
    fs.writeFileSync(at('wyciag.pdf'), 'x');
    fs.writeFileSync(at('run.sh'), '#!/bin/sh\n');
    fs.mkdirSync(at('Wyniki'));
    fs.mkdirSync(at('Narzedzie.app'));
    // A harmless name pointing at a script: judged by its real target.
    try {
      fs.symlinkSync(at('run.sh'), at('faktura.pdf'));
      symlinkOk = true;
    } catch {
      symlinkOk = false;
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an existing document or folder opens', () => {
    expect(checkOpenablePath(at('wyciag.pdf'))).toBe(at('wyciag.pdf'));
    expect(checkOpenablePath(at('Wyniki'))).toBe(at('Wyniki'));
  });

  it('a path that does not exist is refused', () => {
    expect(checkOpenablePath(at('brak.pdf'))).toBeNull();
  });

  it('a script or an app bundle is refused unless only revealed', () => {
    expect(checkOpenablePath(at('run.sh'))).toBeNull();
    expect(checkOpenablePath(at('Narzedzie.app'))).toBeNull();
    expect(checkOpenablePath(at('run.sh'), { allowExecutable: true })).toBe(at('run.sh'));
  });

  it('a link with a document name is judged by its real target', (ctx) => {
    if (!symlinkOk) ctx.skip();
    expect(checkOpenablePath(at('faktura.pdf'))).toBeNull();
    expect(checkOpenablePath(at('faktura.pdf'), { allowExecutable: true })).toBe(at('faktura.pdf'));
  });

  it('".." is refused even when the target exists', () => {
    // Built by hand: path.join would resolve the '..' away.
    expect(
      checkOpenablePath(`${dir}${nodePath.sep}Wyniki${nodePath.sep}..${nodePath.sep}wyciag.pdf`)
    ).toBeNull();
  });
});

describe('safeFileName', () => {
  it('keeps only the last part and drops what Windows forbids', () => {
    expect(safeFileName('../../etc/passwd', 'plik')).toBe('passwd');
    expect(safeFileName('C:\\Wyciagi\\faktura?.pdf', 'plik')).toBe('faktura_.pdf');
    expect(safeFileName('wyciag<1>:"|*.pdf', 'plik')).toBe('wyciag_1_____.pdf');
    expect(safeFileName('plik\u0000\u001f.pdf', 'plik')).toBe('plik.pdf');
    expect(safeFileName('faktura.exe. ', 'plik')).toBe('faktura.exe');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeFileName('..', 'plik')).toBe('plik');
    expect(safeFileName('', 'plik')).toBe('plik');
    expect(safeFileName(null, 'plik')).toBe('plik');
    expect(safeFileName('dir/', 'plik')).toBe('plik');
  });

  it('a very long name keeps its last 200 characters (the extension survives)', () => {
    const name = `${'a'.repeat(300)}.pdf`;
    const safe = safeFileName(name, 'plik');
    expect(safe).toHaveLength(200);
    expect(safe.endsWith('.pdf')).toBe(true);
  });
});
