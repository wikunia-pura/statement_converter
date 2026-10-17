import type { Zebranie, ZebranieMaterial, ZebranieWersja } from '../shared/types';
import { isIpcError } from './ipcError';

/** How many times a change lost to somebody else's write is made again on the fresh version. */
const ATTEMPTS = 3;

/**
 * Change a version's materials on top of what is stored NOW — the notice, the
 * resolutions, a template applied — keeping the revision's note and every
 * other material as they are stored.
 *
 * The version is read fresh and written back only if nobody wrote it in
 * between (its `updatedAt`); otherwise it is read again and `change` applied
 * again, so a material somebody else saved in that moment is never lost under
 * this one. `change` may therefore run more than once.
 *
 * Null when the version (or its meeting) is gone.
 */
export async function changeWersjaMaterialy(
  zebranieId: number,
  wersjaId: number,
  change: (current: ZebranieMaterial[], wersja: ZebranieWersja) => ZebranieMaterial[],
): Promise<{ zebranie: Zebranie; wersja: ZebranieWersja; materialy: ZebranieMaterial[] } | null> {
  for (let attempt = 1; ; attempt++) {
    const zebranie = await window.electronAPI.getZebranie(zebranieId);
    const wersja = zebranie?.wersje.find((w) => w.id === wersjaId);
    if (!zebranie || !wersja) return null;
    const materialy = change(wersja.materialy, wersja);
    try {
      await window.electronAPI.updateZebranieWersja(wersjaId, { opis: wersja.opis, materialy }, wersja.updatedAt);
      return { zebranie, wersja, materialy };
    } catch (err: unknown) {
      if (attempt >= ATTEMPTS || !isIpcError(err, 'concurrentEdit')) throw err;
    }
  }
}
