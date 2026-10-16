/**
 * A refresh asked for by hand. The main process keeps the meetings, entries,
 * cards and people it read in the last minute, and drops them on every write
 * made here — but not on a write made on another computer. Clicking "Odśwież"
 * means "show me what the others changed", so the cached lists go first.
 */
export async function reloadFromServer(reload: () => Promise<unknown>): Promise<void> {
  try {
    await window.electronAPI.invalidateDataCache();
  } catch {
    // The reload still runs; it may only be up to a minute behind.
  }
  await reload();
}
