/**
 * Run `poll` every `ms` while the window is on screen; returns the stop.
 *
 * The app keeps running in the tray, and a board left open there would go on
 * asking the database for notes and comments all night. While the window is
 * hidden or minimized (`visibilityState === 'hidden'`) the timer stops; the
 * moment it is shown again `poll` runs at once, so what the user looks at is
 * never a whole interval old.
 *
 * Meant for an effect: the first load is the effect's own, this takes over the
 * refreshing after it, and the returned function goes into the cleanup.
 */
export function pollWhileVisible(poll: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (timer === null) timer = setInterval(poll, ms);
  };
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      stop();
    } else if (timer === null) {
      poll();
      start();
    }
  };
  if (document.visibilityState !== 'hidden') start();
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
