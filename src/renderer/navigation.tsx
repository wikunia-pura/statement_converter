import React, { createContext, useContext, useEffect, useMemo } from 'react';
import Icon from './components/Icon';

/**
 * Back and forward, for an app with no address bar.
 *
 * The shell owns the history (see `App.tsx`); this file is only how the rest of
 * the app reaches it — a context so a view can render the two buttons without
 * being handed four props it does nothing else with.
 */
interface NavigationContextValue {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  /** Label of the place Back would take you to, for the button's tooltip. */
  backLabel: string | null;
  forwardLabel: string | null;
  /** Localized chrome, so this file needs no translations of its own. */
  labels: { back: string; forward: string; group: string };
  /** The record open in the current view (see `useNavItem`), or null on its list. */
  item: string | null;
  /** Open a record as a new history entry — or, with `replace`, in place of the current one. */
  openItem: (item: string, label: string, replace: boolean) => void;
  /** Back to the view's list: the entry behind, when that is the list. */
  closeItem: () => void;
  /** The open screen's question before the shell takes the user elsewhere (see `useLeaveGuard`). */
  leaveGuard: React.MutableRefObject<LeaveCheck | null>;
}

/** Asks about unsaved edits; resolves false when the user stays. */
export type LeaveCheck = () => Promise<boolean>;

const NavigationContext = createContext<NavigationContextValue | null>(null);

export const NavigationProvider: React.FC<
  NavigationContextValue & { children: React.ReactNode }
> = ({
  children,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  backLabel,
  forwardLabel,
  labels,
  item,
  openItem,
  closeItem,
  leaveGuard,
}) => {
  // One value per actual change: a fresh object on every render of the shell
  // would re-render every view reading it (`useNavItem`), keystroke by keystroke.
  const value = useMemo<NavigationContextValue>(
    () => ({ canGoBack, canGoForward, goBack, goForward, backLabel, forwardLabel, labels, item, openItem, closeItem, leaveGuard }),
    [canGoBack, canGoForward, goBack, goForward, backLabel, forwardLabel, labels, item, openItem, closeItem, leaveGuard],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};

export const useNavigation = (): NavigationContextValue | null => useContext(NavigationContext);

/**
 * A view's open record — a community's declaration, a meeting — as a step of
 * the app's history. Opening one is an entry of its own, so Back (the button,
 * Alt+←, the mouse) returns to the list rather than leaving the module, and
 * Forward opens it again. `label` names the record in the buttons' tooltips.
 *
 * `replace` swaps the record shown without a new step: switching to another
 * community inside the record's screen, or a new record that got its id on save.
 */
export function useNavItem(): {
  item: string | null;
  open: (item: string, label: string) => void;
  replace: (item: string, label: string) => void;
  close: () => void;
} {
  const ctx = useContext(NavigationContext);
  return useMemo(
    () => ({
      item: ctx?.item ?? null,
      open: (item: string, label: string) => ctx?.openItem(item, label, false),
      replace: (item: string, label: string) => ctx?.openItem(item, label, true),
      close: () => ctx?.closeItem(),
    }),
    [ctx],
  );
}

/**
 * A screen with unsaved edits, guarding the ways off it the screen does not own:
 * the sidebar, Back/Forward (buttons, Alt+←/→, the mouse) and links to other
 * modules. The shell runs `check` first and moves only when it resolves true;
 * null — nothing to lose — lets it move at once.
 *
 * The screen's own exits (its back button, `useNavItem().close()`) are not
 * guarded here — the screen asks before taking them, so this would ask twice.
 */
export function useLeaveGuard(check: LeaveCheck | null): void {
  const guard = useContext(NavigationContext)?.leaveGuard;
  useEffect(() => {
    if (!guard || !check) return;
    guard.current = check;
    return () => {
      if (guard.current === check) guard.current = null;
    };
  });
}

/**
 * The two buttons, for a view's own header.
 *
 * Renders nothing outside a provider, so a view that carries it is safe to
 * mount anywhere — including the login screen, where there is no history.
 */
export const HeaderNav: React.FC = () => {
  const ctx = useContext(NavigationContext);
  if (!ctx) return null;
  const { canGoBack, canGoForward, goBack, goForward, backLabel, forwardLabel, labels } = ctx;

  // The destination in the tooltip, not just "Wstecz": in an app whose history
  // is invisible, knowing where the button goes is the whole point.
  const title = (base: string, where: string | null, keys: string) =>
    where ? `${base}: ${where} (${keys})` : `${base} (${keys})`;

  return (
    <div className="header-nav" role="group" aria-label={labels.group}>
      <button
        type="button"
        className="header-nav__btn"
        onClick={goBack}
        disabled={!canGoBack}
        data-tip={title(labels.back, backLabel, 'Alt+←')}
        aria-label={labels.back}
      >
        <Icon name="chevron-left" size={16} />
      </button>
      <button
        type="button"
        className="header-nav__btn"
        onClick={goForward}
        disabled={!canGoForward}
        data-tip={title(labels.forward, forwardLabel, 'Alt+→')}
        aria-label={labels.forward}
      >
        <Icon name="chevron-right" size={16} />
      </button>
    </div>
  );
};
