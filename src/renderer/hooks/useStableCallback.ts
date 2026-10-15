import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A function whose identity never changes but which always runs the latest
 * render's version of `fn`.
 *
 * For handlers handed to memoized rows: a list of a hundred `memo` rows only
 * pays off when the props it compares stay the same, and a handler that closes
 * over the view's state is a new function on every render. This keeps the
 * closure fresh without making it a new prop.
 *
 * Not for calling during render — the ref is updated in a layout effect, so it
 * is current for every event handler and effect, which is all it is for.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
