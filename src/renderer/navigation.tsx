import React, { createContext, useContext, useMemo } from 'react';
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
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export const NavigationProvider: React.FC<
  NavigationContextValue & { children: React.ReactNode }
> = ({ children, ...value }) => (
  <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
);

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
        title={title(labels.back, backLabel, 'Alt+←')}
        aria-label={labels.back}
      >
        <Icon name="chevron-left" size={16} />
      </button>
      <button
        type="button"
        className="header-nav__btn"
        onClick={goForward}
        disabled={!canGoForward}
        title={title(labels.forward, forwardLabel, 'Alt+→')}
        aria-label={labels.forward}
      >
        <Icon name="chevron-right" size={16} />
      </button>
    </div>
  );
};
