import React, { useState, useEffect } from 'react';
import Converter from './views/Converter';
import Settings from './views/Settings';
import History from './views/History';
import Ksiegowania, { bookingTileOrderItems } from './views/Ksiegowania';
import Kontrahenci from './views/Kontrahenci';
import Adresy from './views/Adresy';
import Banki from './views/Banki';
import PodsumowanieZaliczek, { ZaliczkiFileEntry } from './views/PodsumowanieZaliczek';
import NotySwiadczenia, { NotyFileEntry } from './views/NotySwiadczenia';
import ScalanieWplat, { ScalanieFileEntry } from './views/ScalanieWplat';
import Homebanking, { HomebankingFileEntry } from './views/Homebanking';
import OdczytyLicznikow, { OdczytyFileEntry } from './views/OdczytyLicznikow';
import OdczytyHistoria from './views/OdczytyHistoria';
import Mailing, { MailingDraft, emptyMailingDraft } from './views/Mailing';
import MailingSzablony from './views/MailingSzablony';
import MailingPola from './views/MailingPola';
import MailingHistoria from './views/MailingHistoria';
import MailingTypy from './views/MailingTypy';
import Kalendarz from './views/Kalendarz';
import KalendarzTypy from './views/KalendarzTypy';
import KalendarzLokalizacje from './views/KalendarzLokalizacje';
import Zebrania, { ZebranieTab } from './views/Zebrania';
import Sprawozdania from './views/Sprawozdania';
import PlanyGospodarcze from './views/PlanyGospodarcze';
import PodatkiNieruchomosci from './views/PodatkiNieruchomosci';
import PodatkiCit from './views/PodatkiCit';
import PodatkiPit from './views/PodatkiPit';
import PodpisPdf, { PodpisPlikEntry } from './views/PodpisPdf';
import PodpisHistoria from './views/PodpisHistoria';
import Zadania from './views/Zadania';
import ZadaniaPulpit from './components/ZadaniaPulpit';
import ModuleTabs from './components/ModuleTabs';
import CoNowego from './views/CoNowego';
import Login from './views/Login';
import Logo from './components/Logo';
import SplashScreen from './components/SplashScreen';
import SidebarWelcome from './components/SidebarWelcome';
import NotificationBell from './components/NotificationBell';
import SidebarOrderModal, { SIDEBAR_DIVIDER } from './components/SidebarOrderModal';
import Footer from './components/Footer';
import Icon from './components/Icon';
import UpdateNotification from './components/UpdateNotification';
import BackupNotifier from './components/BackupNotifier';
import WhatsNewModal from './components/WhatsNewModal';
import { NotificationProvider } from './components/Notifications';
import { translations, Language } from './translations';
import { AppUser, FileEntry, NotificationTarget } from '../shared/types';
import {
  BookingFilter,
  DEFAULT_BOOKING_TILE_ORDER,
  currentMonthKey,
  resolveBookingTileOrder,
} from '../shared/bookings';
import { SpotkanieStateFilter, monthOfDayKey, toDayKey } from '../shared/calendar';
import { DEFAULT_ZADANIA_FILTER, ZadaniaFilterSeed } from '../shared/zadania';
import { releaseForVersion, shouldShowWhatsNew } from '../shared/release-notes';
import { greetingName } from '../shared/app-users';
import { NavigationProvider, HeaderNav } from './navigation';

interface NavItemProps {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  active?: boolean;
  onClick: () => void;
  /** Tooltip — defaults to the label (useful when the sidebar is collapsed to icons). */
  title?: string;
  /** Unread marker (small dot) — stays visible when the rail is collapsed. */
  badge?: boolean;
  className?: string;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick, title, badge, className }) => (
  <div
    className={`nav-item ${active ? 'active' : ''}${className ? ` ${className}` : ''}`}
    onClick={onClick}
    title={title ?? label}
  >
    <Icon name={icon} />
    <span className="nav-label">{label}</span>
    {badge && <span className="nav-dot" aria-hidden="true" />}
  </div>
);

/** A menu entry as the sidebar draws it. */
interface SidebarItem {
  id: MenuView;
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  title?: string;
  badge?: boolean;
  onClick: () => void;
}

/**
 * The order the menu has until somebody arranges it. `divider` is a separator
 * line: unlike a view it may appear any number of times, and it moves, is added
 * and is removed in the same dialog as the views — that is how sections work.
 */
const DEFAULT_SIDEBAR_ORDER = [
  'pulpit',
  'zadania',
  'kalendarz',
  'divider',
  'zebrania',
  'sprawozdania',
  'plany',
  'podatki',
  'podpis',
  'divider',
  'converter',
  'podsumowanie',
  'noty',
  'scalanie',
  'homebanking',
  'odczyty',
  'mailing',
  'divider',
  'adresy',
  'kontrahenci',
  'banki',
  'divider',
  'conowego',
  'settings',
] as const;

type MenuView = Exclude<(typeof DEFAULT_SIDEBAR_ORDER)[number], typeof SIDEBAR_DIVIDER>;

/**
 * The saved order made safe to draw: ids this build does not know are dropped,
 * repeats are ignored, and a view the saved order never heard of (added by a
 * later release) joins right after the view it follows in the default order —
 * Sprawozdania next to Zebrania, not under Ustawienia — or at the end when
 * that one is not in the menu either.
 */
function resolveSidebarOrder(saved: string[] | null): (MenuView | typeof SIDEBAR_DIVIDER)[] {
  const known = new Set<string>(DEFAULT_SIDEBAR_ORDER);
  const seen = new Set<string>();
  const order: (MenuView | typeof SIDEBAR_DIVIDER)[] = [];
  for (const id of saved ?? DEFAULT_SIDEBAR_ORDER) {
    if (id === SIDEBAR_DIVIDER) order.push(SIDEBAR_DIVIDER);
    else if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id as MenuView);
    }
  }
  let previous: MenuView | null = null;
  for (const id of DEFAULT_SIDEBAR_ORDER) {
    if (id === SIDEBAR_DIVIDER) continue;
    if (!seen.has(id)) {
      const at = previous ? order.indexOf(previous) : -1;
      if (at >= 0) order.splice(at + 1, 0, id);
      else order.push(id);
      seen.add(id);
    }
    previous = id;
  }
  return order;
}

/** What the sidebar draws: no separator first, last, or next to another one. */
function tidyDividers<T>(entries: (T | typeof SIDEBAR_DIVIDER)[]): (T | typeof SIDEBAR_DIVIDER)[] {
  const out: (T | typeof SIDEBAR_DIVIDER)[] = [];
  for (const entry of entries) {
    if (entry === SIDEBAR_DIVIDER && (out.length === 0 || out[out.length - 1] === SIDEBAR_DIVIDER)) {
      continue;
    }
    out.push(entry);
  }
  if (out[out.length - 1] === SIDEBAR_DIVIDER) out.pop();
  return out;
}

type View =
  | 'pulpit'
  | 'converter'
  | 'settings'
  | 'kontrahenci'
  | 'adresy'
  | 'banki'
  | 'podsumowanie'
  | 'noty'
  | 'scalanie'
  | 'homebanking'
  | 'odczyty'
  | 'mailing'
  | 'kalendarz'
  | 'zebrania'
  | 'sprawozdania'
  | 'plany'
  | 'podatki'
  | 'podpis'
  | 'zadania'
  | 'conowego';

/**
 * One place the app can be: a view, plus which of its tabs was open, plus the
 * record open on its own screen (a community's declaration, a meeting).
 *
 * The tab belongs in here because it is navigation — "Pokaż w historii" moves
 * the user as much as clicking Konwerter does, and Back that skipped it would
 * feel like it had missed a step. The record likewise: Back from a meeting's
 * screen goes to the list of meetings, not out of the module.
 */
interface AppLocation {
  view: View;
  tab?: string;
  /** The open record, as the view names it (see `useNavItem`); absent on the list. */
  item?: string;
  /** The record's name, for the Back/Forward tooltips. */
  itemLabel?: string;
}

/** Same place: view, tab and open record — the record's name is only a label. */
const sameLocation = (a: AppLocation, b: AppLocation) =>
  a.view === b.view && a.tab === b.tab && (a.item ?? null) === (b.item ?? null);

/** Deep enough for a day's work; old entries fall off the bottom. */
const NAV_STACK_LIMIT = 50;

interface NavState {
  stack: AppLocation[];
  index: number;
}

/** A new entry after the current one; whatever was ahead of it is gone, as in a browser. */
function pushLocation(prev: NavState, next: AppLocation): NavState {
  const stack = [...prev.stack.slice(0, prev.index + 1), next];
  if (stack.length > NAV_STACK_LIMIT) {
    const trimmed = stack.slice(stack.length - NAV_STACK_LIMIT);
    return { stack: trimmed, index: trimmed.length - 1 };
  }
  return { stack, index: stack.length - 1 };
}

const App: React.FC = () => {
  /**
   * Where the user is, and how they got here. An app with no address bar still
   * owes them Back — this is the whole browser history, in one piece of state.
   */
  const [nav, setNav] = useState<NavState>({ stack: [{ view: 'pulpit' }], index: 0 });
  // The dashboard is where the app opens: the month's bookings are the question
  // the user comes here with, and converting files is the answer to it.
  const currentView = nav.stack[nav.index].view;
  const canGoBack = nav.index > 0;
  const canGoForward = nav.index < nav.stack.length - 1;
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState<Language>('pl');
  // Sidebar starts collapsed (icon-only rail); the user can pin it expanded and
  // the choice persists via settings. Default true so it's collapsed on first run.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  // The order the person arranged the menu in (null = the default), and the
  // dialog that arranges it.
  const [sidebarOrder, setSidebarOrder] = useState<string[] | null>(null);
  const [sidebarOrderOpen, setSidebarOrderOpen] = useState(false);
  const [sidebarOrderSaving, setSidebarOrderSaving] = useState(false);
  // The dashboard's Księgowania area: folded to its month banner, or open. Kept
  // here (and in settings) so it survives navigating away and restarting.
  const [bookingsCollapsed, setBookingsCollapsed] = useState(false);
  const [bookingsTileOrder, setBookingsTileOrder] = useState<string[] | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedBank, setSelectedBank] = useState<number | null>(null);
  const [zaliczkiFiles, setZaliczkiFiles] = useState<ZaliczkiFileEntry[]>([]);
  const [zaliczkiGeneratedPath, setZaliczkiGeneratedPath] = useState<string | null>(null);
  const [notyFiles, setNotyFiles] = useState<NotyFileEntry[]>([]);
  const [scalanieFiles, setScalanieFiles] = useState<ScalanieFileEntry[]>([]);
  const [homebankingFiles, setHomebankingFiles] = useState<HomebankingFileEntry[]>([]);
  const [odczytyFiles, setOdczytyFiles] = useState<OdczytyFileEntry[]>([]);
  const [podpisFiles, setPodpisFiles] = useState<PodpisPlikEntry[]>([]);
  // Each module keeps its own Konwersja/Historia tab, so switching modules and
  // coming back lands where the user left off.
  const [converterTab, setConverterTab] = useState<'convert' | 'bookings' | 'history'>('convert');
  // Księgowania: month + filter live here so a detour to Konwersja or Historia
  // comes back to the same month, and "Pokaż w historii" can seed the search.
  const [ksiegMonth, setKsiegMonth] = useState<string>(() => currentMonthKey());
  const [ksiegFilter, setKsiegFilter] = useState<BookingFilter>('all');
  const [historySearchSeed, setHistorySearchSeed] = useState<string>('');
  const [odczytyTab, setOdczytyTab] = useState<'convert' | 'history'>('convert');
  const [mailingTab, setMailingTab] = useState<'send' | 'templates' | 'types' | 'fields' | 'history'>('send');
  const [kalendarzTab, setKalendarzTab] = useState<'calendar' | 'types' | 'places'>('calendar');
  const [podatkiTab, setPodatkiTab] = useState<'nieruchomosci' | 'cit' | 'pit'>('nieruchomosci');
  const [podpisTab, setPodpisTab] = useState<'sign' | 'history'>('sign');
  // Kalendarz: the month lives here so a detour to "Typy spotkań" — or to any
  // other module — comes back to the month the user was looking at.
  const [kalMonth, setKalMonth] = useState<string>(() => currentMonthKey());
  /**
   * The calendar's "what needs doing" filter, lifted here so the dashboard's
   * tiles can send the user into the calendar with one already applied — a tile
   * that only navigated would leave them to find the twelve meetings it counted.
   */
  const [kalStateFilter, setKalStateFilter] = useState<SpotkanieStateFilter>('all');
  // Where the Zadania filter bar starts: the dashboard's tiles set it, every other
  // way in (the sidebar, a notification) resets it to "everything".
  const [zadaniaSeed, setZadaniaSeed] = useState<ZadaniaFilterSeed>(DEFAULT_ZADANIA_FILTER);
  // A task a notification asked for; the nonce lets the same task be asked for twice.
  const [zadaniaOpen, setZadaniaOpen] = useState<{ id: number; nonce: number } | null>(null);
  // A task's meeting link, followed from the board: the meeting Kalendarz lands on.
  const [kalFocus, setKalFocus] = useState<{
    spotkanieId: number;
    nonce: number;
    edit?: boolean;
  } | null>(null);
  // A meeting's materials entry, followed from its calendar card: what Zebrania opens.
  const [zebraniaOpen, setZebraniaOpen] = useState<{
    id: number;
    nonce: number;
    tab?: ZebranieTab;
  } | null>(null);
  // The send form lives here so a detour to Adresy (to attach a missing city
  // unit) or to the templates tab doesn't throw away a half-filled mailing.
  const [mailingDraft, setMailingDraft] = useState<MailingDraft>(emptyMailingDraft);
  // When the Converter asks "+ Add address with this account", we switch to the
  // Adresy view and pass this value through one render so the modal can prefill it.
  const [adresyPrefillAccount, setAdresyPrefillAccount] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('1.0.0');
  const [session, setSession] = useState<{ email: string; userId: string } | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  // True when the session ended by expiring rather than by the user signing
  // out — the login screen then says so instead of appearing out of nowhere.
  const [sessionExpired, setSessionExpired] = useState(false);
  // The signed-in person's own name, as given in Ustawienia → Użytkownicy. The
  // session only knows a mailbox; the greeting wants a first name.
  const [profile, setProfile] = useState<AppUser | null>(null);
  // Whether the user list has answered yet. The welcome panel waits for it:
  // rendering early would greet the mailbox for a moment and then swap in the
  // real name, and a greeting that changes as you read it is worse than one
  // that arrives a beat later.
  const [profileChecked, setProfileChecked] = useState(false);
  // Funky intro shown once when the app opens; self-dismisses after its animation.
  const [showSplash, setShowSplash] = useState(true);
  // Release notes: the version this machine has already been shown. Undefined
  // until settings load, so the modal can't flash before we know the answer.
  const [lastSeenVersion, setLastSeenVersion] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadAppVersion();
    // Load local settings (dark mode, language) immediately so the login screen
    // respects them — these are machine-local and don't need a session.
    loadSettings();
    void (async () => {
      try {
        const s = await window.electronAPI.authGetSession();
        setSession(s);
        // Started with no session: was it an expiry or a sign-out? The user is
        // owed that difference — an expiry is the app's fault, not theirs.
        if (!s && (await window.electronAPI.authConsumeExpiryNotice())) {
          setSessionExpired(true);
        }
        if (s) void loadProfile();
      } finally {
        setSessionChecked(true);
      }
    })();
  }, []);

  // A notification about Księgowania was clicked: the priorities live on the dashboard.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;
    return window.electronAPI.onOpenKsiegowania(() => navigate('pulpit'));
    // Same reasoning as the effect below: `navigate` is stable enough.
  }, []);

  /** Open the board, on one card when there is one — what a clicked notification asks for. */
  const openZadaniaCard = (zadanieId?: number) => {
    setZadaniaSeed(DEFAULT_ZADANIA_FILTER);
    setZadaniaOpen(zadanieId === undefined ? null : { id: zadanieId, nonce: Date.now() });
    navigate('zadania');
  };

  /** Open Kalendarz on one meeting — it moves to the meeting's month by itself. */
  const openSpotkanie = (spotkanieId: number, edit = false) => {
    setKalFocus({ spotkanieId, nonce: Date.now(), edit });
    navigate('kalendarz', 'calendar');
  };

  /** Open Zebrania on one entry — "Otwórz w Zebraniach" on a meeting card. */
  const openZebranie = (zebranieId: number, tab?: ZebranieTab) => {
    setZebraniaOpen({ id: zebranieId, nonce: Date.now(), tab });
    // Straight onto the meeting's screen, one step: Back returns to where the
    // link was clicked. The view names the entry once the meeting is loaded.
    navigate('zebrania', undefined, { id: String(zebranieId), label: '' });
  };

  /** The bell's list sends a click to the same place its desktop toast would. */
  const openNotificationTarget = (target: NotificationTarget) => {
    if (target.view === 'ksiegowania') navigate('pulpit');
    else if (target.view === 'kalendarz') openSpotkanie(target.spotkanieId);
    else openZadaniaCard(target.zadanieId);
  };

  // A system notification about a meeting was clicked.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;
    return window.electronAPI.onOpenSpotkanie((spotkanieId) => openSpotkanie(spotkanieId));
    // Same reasoning as the effects around it: `navigate` is stable enough.
  }, []);

  // A system notification about a task was clicked: the main process has already
  // brought the window forward, so all that is left is to open the board.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;
    return window.electronAPI.onOpenZadania((zadanieId) => openZadaniaCard(zadanieId));
    // `navigate` only talks to `setNav(prev => …)` and the tab setters, so the
    // first render's copy is as good as any later one.
  }, []);

  // A session can also die mid-work: the refresh token expires or gets revoked,
  // or the machine sleeps through its whole lifetime. Main announces it the
  // moment it happens — before this, the app went on looking logged in while
  // every read from the cloud came back empty and surfaced as a data error
  // ("Bank not found"), and only a manual re-login fixed it.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;
    return window.electronAPI.onSessionExpired(() => {
      setSession(null);
      setSessionExpired(true);
    });
  }, []);

  /* ------------------------------ Navigation ------------------------------ */

  /** The tab a module is currently on, so a history entry can record it. */
  const tabOf = (view: View): string | undefined => {
    if (view === 'converter') return converterTab;
    if (view === 'odczyty') return odczytyTab;
    if (view === 'mailing') return mailingTab;
    if (view === 'kalendarz') return kalendarzTab;
    if (view === 'podatki') return podatkiTab;
    if (view === 'podpis') return podpisTab;
    return undefined;
  };

  /** Put a module on a tab. Tabs that don't belong to the view are ignored. */
  const applyTab = (view: View, tab?: string) => {
    if (!tab) return;
    if (view === 'converter') setConverterTab(tab as typeof converterTab);
    else if (view === 'odczyty') setOdczytyTab(tab as typeof odczytyTab);
    else if (view === 'mailing') setMailingTab(tab as typeof mailingTab);
    else if (view === 'kalendarz') setKalendarzTab(tab as typeof kalendarzTab);
    else if (view === 'podatki') setPodatkiTab(tab as typeof podatkiTab);
    else if (view === 'podpis') setPodpisTab(tab as typeof podpisTab);
  };

  /**
   * Go somewhere, and remember it.
   *
   * Two behaviours worth naming. Navigating to where you already are does
   * nothing, so a second click on the active nav item is not a history entry.
   * And navigating to the entry directly behind the current one is treated as
   * Back rather than as a new entry — that is what lets a view's own "back to
   * the list" button keep the forward history instead of stacking duplicates.
   */
  const navigate = (view: View, tab?: string, item?: { id: string; label: string }) => {
    applyTab(view, tab);
    setNav((prev) => {
      const here = prev.stack[prev.index];
      // Without an explicit tab, staying in the same view keeps the tab the
      // entry already had; arriving from elsewhere picks up the module's own
      // remembered tab, which is what the sidebar has always done. Without a
      // record, it is the view's list — so the sidebar, clicked on a record's
      // screen, goes back to the list.
      const next: AppLocation = {
        view,
        tab: tab ?? (view === here.view ? here.tab : tabOf(view)),
        ...(item ? { item: item.id, itemLabel: item.label } : {}),
      };
      if (sameLocation(here, next)) return prev;
      const behind = prev.index > 0 ? prev.stack[prev.index - 1] : null;
      if (behind && sameLocation(behind, next)) {
        return { ...prev, index: prev.index - 1 };
      }
      return pushLocation(prev, next);
    });
  };

  /**
   * Open a record of the current view on its own screen (`useNavItem`). The
   * same record again only renames it — its name may arrive after its id.
   */
  const openItem = (item: string, label: string, replace: boolean) =>
    setNav((prev) => {
      const here = prev.stack[prev.index];
      const next: AppLocation = { view: here.view, tab: here.tab, item, itemLabel: label };
      if (replace || sameLocation(here, next)) {
        const stack = [...prev.stack];
        stack[prev.index] = next;
        return { ...prev, stack };
      }
      return pushLocation(prev, next);
    });

  /** Leave a record for its view's list: a step back when the list is right behind. */
  const closeItem = () =>
    setNav((prev) => {
      const here = prev.stack[prev.index];
      if (here.item === undefined) return prev;
      const next: AppLocation = { view: here.view, tab: here.tab };
      const behind = prev.index > 0 ? prev.stack[prev.index - 1] : null;
      if (behind && sameLocation(behind, next)) return { ...prev, index: prev.index - 1 };
      return pushLocation(prev, next);
    });

  /** Kept as the old name so every existing call site reads unchanged. */
  const setCurrentView = (view: View) => navigate(view);

  /** The Księgowania month, remembered on this machine for the next visit. */
  const changeKsiegMonth = (monthKey: string) => {
    setKsiegMonth(monthKey);
    void window.electronAPI.setBookingsMonth(monthKey);
  };

  /**
   * Move along the history. Pure updater on purpose — the tab is restored by
   * the effect below rather than from in here, because StrictMode invokes an
   * updater twice and a state write hidden inside one is exactly the kind of
   * side effect that makes the second invocation matter.
   */
  const step = (delta: number) =>
    setNav((prev) => {
      const index = prev.index + delta;
      if (index < 0 || index > prev.stack.length - 1) return prev;
      return { ...prev, index };
    });

  const goBack = () => step(-1);
  const goForward = () => step(1);

  // Whatever moved the history — a button, Alt+←, the mouse — the module ends
  // up on the tab that entry recorded, not on its most recently used one.
  useEffect(() => {
    const loc = nav.stack[nav.index];
    applyTab(loc.view, loc.tab);
  }, [nav]);

  /**
   * Alt+← / Alt+→ and the mouse's own back/forward buttons, the two gestures
   * people already have in their hands. Ignored while typing, so Alt+← in a
   * text field stays a text-field key.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goForward();
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        goBack();
      } else if (event.button === 4) {
        event.preventDefault();
        goForward();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
    // Registered once: both handlers reach the history through `setNav(prev =>
    // …)` and the tab setters, so they hold no state to go stale — and
    // re-subscribing on every render would be two listener swaps per keystroke.
  }, []);

  /**
   * Find the signed-in person in the shared user list. Matched by mailbox,
   * because that is all the session carries — and it is the same key the list
   * itself is keyed by. A failure here costs a first name, never a screen, so
   * it stays quiet and the app falls back to the mailbox.
   */
  const loadProfile = async () => {
    try {
      const email = (await window.electronAPI.authGetSession())?.email;
      if (!email) return;
      const users = await window.electronAPI.getAppUsers();
      setProfile(users.find((u) => u.email === email) ?? null);
    } catch (error) {
      console.error('Error loading user profile:', error);
    } finally {
      // Also on failure: the panel then greets by mailbox, which is the honest
      // answer when the name cannot be read.
      setProfileChecked(true);
    }
  };

  const handleSignOut = async () => {
    await window.electronAPI.authSignOut();
    setSession(null);
    setSessionExpired(false);
    setProfile(null);
    setProfileChecked(false);
  };

  const handleSignedIn = async () => {
    const s = await window.electronAPI.authGetSession();
    setSession(s);
    setSessionExpired(false);
    void loadProfile();
  };

  const loadAppVersion = async () => {
    try {
      const version = await window.electronAPI.getAppVersion();
      setAppVersion(version);
    } catch (error) {
      console.error('Error loading app version:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.getSettings();
      setDarkMode(settings.darkMode);
      setLanguage(settings.language || 'pl');
      setSidebarCollapsed(settings.sidebarCollapsed);
      setSidebarOrder(settings.sidebarOrder ?? null);
      setBookingsCollapsed(settings.bookingsCollapsed);
      setBookingsTileOrder(settings.bookingsTileOrder ?? null);
      // Back on the month the Księgowania view was left on, even after a restart.
      if (/^\d{4}-\d{2}$/.test(settings.bookingsMonth ?? '')) setKsiegMonth(settings.bookingsMonth);
      setLastSeenVersion(settings.lastSeenVersion ?? '');
      applyDarkMode(settings.darkMode);
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const applyDarkMode = (enabled: boolean) => {
    if (enabled) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  };

  const handleDarkModeChange = (enabled: boolean) => {
    setDarkMode(enabled);
    applyDarkMode(enabled);
  };

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
  };

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    void window.electronAPI.setSidebarCollapsed(next);
  };

  const toggleBookings = () => {
    const next = !bookingsCollapsed;
    setBookingsCollapsed(next);
    void window.electronAPI.setBookingsCollapsed(next);
  };

  const t = translations[language];

  // Who the app is talking to. The user list is the authority on names; before
  // anyone is named — or while the list is still loading — the mailbox stands
  // in, so the greeting is never blank and never a placeholder.
  const me = profile ?? { email: session?.email ?? '' };
  const myName = greetingName(me);

  /**
   * What a history entry is called, for the Back/Forward tooltips. In an app
   * whose history is invisible, "Wstecz: Kalendarz → Lokalizacje" is the
   * difference between a button you trust and one you poke at.
   */
  const locationLabel = (loc: AppLocation | undefined): string | null => {
    if (!loc) return null;
    const view: Record<View, string> = {
      pulpit: t.pulpit,
      converter: t.converter,
      settings: t.settings,
      kontrahenci: t.kontrahenci,
      adresy: t.adresy,
      banki: t.banki,
      podsumowanie: t.podsumowanieZaliczek,
      noty: t.notySwiadczenia,
      scalanie: t.scalanieWplat,
      homebanking: t.homebanking,
      odczyty: t.odczyty,
      mailing: t.mailing,
      kalendarz: t.kalendarz,
      zebrania: t.zebrania,
      sprawozdania: t.sprawozdania,
      plany: t.planyGospodarcze,
      podatki: t.podatki,
      podpis: t.podpisTitle,
      zadania: t.zadania,
      conowego: t.whatsNew,
    };
    const tabs: Record<string, string> = {
      convert: t.tabConversion,
      bookings: t.tabBookings,
      history: t.tabHistory,
      send: t.mailingTabSend,
      templates: t.mailingTabTemplates,
      fields: t.mailingTabFields,
      calendar: t.kalTabCalendar,
      types: t.kalTabTypes,
      places: t.kalTabPlaces,
      nieruchomosci: t.podTabNieruchomosci,
      cit: t.citTab,
      sign: t.podpisPdfTabSign,
    };
    const base = view[loc.view];
    // Mailing and Kalendarz both have a 'types' tab; the map above names the
    // Kalendarz one, so the Mailing one is told apart by its view.
    const tab =
      loc.view === 'mailing' && loc.tab === 'types'
        ? t.mailingTypyTab
        : loc.tab
          ? tabs[loc.tab]
          : undefined;
    // View → tab → the open record, by name.
    return [base, tab, loc.itemLabel].filter(Boolean).join(' → ');
  };

  // Release notes for the running build. `unreadRelease` drives both the nav dot
  // and the one-time modal; it stays false while settings are still loading.
  const currentRelease = releaseForVersion(appVersion);
  const hasUnreadRelease =
    lastSeenVersion !== undefined && shouldShowWhatsNew(appVersion, lastSeenVersion);

  /** Remember the shown release as read, so neither the modal nor the dot returns. */
  const markReleaseSeen = () => {
    if (!currentRelease) return;
    setLastSeenVersion(currentRelease.version);
    void window.electronAPI.setLastSeenVersion(currentRelease.version);
  };

  /** Everything the menu can show, by view. The order is decided separately. */
  const navConfig: Record<MenuView, SidebarItem> = {
    pulpit: { id: 'pulpit', icon: 'home', label: t.pulpit, onClick: () => setCurrentView('pulpit') },
    kalendarz: {
      id: 'kalendarz',
      icon: 'calendar',
      label: t.kalendarz,
      onClick: () => setCurrentView('kalendarz'),
    },
    zebrania: {
      id: 'zebrania',
      icon: 'file-check',
      label: t.zebrania,
      onClick: () => {
        setZebraniaOpen(null);
        setCurrentView('zebrania');
      },
    },
    sprawozdania: {
      id: 'sprawozdania',
      icon: 'book',
      label: t.sprawozdania,
      onClick: () => setCurrentView('sprawozdania'),
    },
    plany: {
      id: 'plany',
      icon: 'coins',
      label: t.planyGospodarcze,
      onClick: () => setCurrentView('plany'),
    },
    podatki: {
      id: 'podatki',
      icon: 'landmark',
      label: t.podatki,
      onClick: () => setCurrentView('podatki'),
    },
    podpis: {
      id: 'podpis',
      icon: 'signature',
      label: t.podpisTitle,
      onClick: () => setCurrentView('podpis'),
    },
    zadania: {
      id: 'zadania',
      icon: 'clipboard',
      label: t.zadania,
      onClick: () => {
        setZadaniaSeed(DEFAULT_ZADANIA_FILTER);
        setZadaniaOpen(null);
        setCurrentView('zadania');
      },
    },
    converter: {
      id: 'converter',
      icon: 'folder',
      label: t.converter,
      onClick: () => setCurrentView('converter'),
    },
    podsumowanie: {
      id: 'podsumowanie',
      icon: 'bar-chart',
      label: t.podsumowanieZaliczek,
      onClick: () => setCurrentView('podsumowanie'),
    },
    noty: {
      id: 'noty',
      icon: 'file-text',
      label: t.notySwiadczenia,
      onClick: () => setCurrentView('noty'),
    },
    scalanie: {
      id: 'scalanie',
      icon: 'wallet',
      label: t.scalanieWplat,
      onClick: () => setCurrentView('scalanie'),
    },
    homebanking: {
      id: 'homebanking',
      icon: 'briefcase',
      label: t.homebanking,
      onClick: () => setCurrentView('homebanking'),
    },
    odczyty: { id: 'odczyty', icon: 'zap', label: t.odczyty, onClick: () => setCurrentView('odczyty') },
    mailing: { id: 'mailing', icon: 'mail', label: t.mailing, onClick: () => setCurrentView('mailing') },
    adresy: { id: 'adresy', icon: 'map-pin', label: t.adresy, onClick: () => setCurrentView('adresy') },
    kontrahenci: {
      id: 'kontrahenci',
      icon: 'users',
      label: t.kontrahenci,
      onClick: () => setCurrentView('kontrahenci'),
    },
    banki: { id: 'banki', icon: 'building', label: t.banki, onClick: () => setCurrentView('banki') },
    conowego: {
      id: 'conowego',
      icon: 'sparkles',
      label: t.whatsNew,
      title: hasUnreadRelease ? t.whatsNewNavDot : t.whatsNew,
      badge: hasUnreadRelease,
      onClick: () => {
        setCurrentView('conowego');
        markReleaseSeen();
      },
    },
    settings: {
      id: 'settings',
      icon: 'settings',
      label: t.settings,
      onClick: () => setCurrentView('settings'),
    },
  };
  const sidebarEntries = resolveSidebarOrder(sidebarOrder).map((id) =>
    id === SIDEBAR_DIVIDER ? SIDEBAR_DIVIDER : navConfig[id],
  );

  const [tileOrderOpen, setTileOrderOpen] = useState(false);
  const [tileOrderSaving, setTileOrderSaving] = useState(false);
  const saveBookingsTileOrder = async (order: string[] | null) => {
    setTileOrderSaving(true);
    try {
      await window.electronAPI.setBookingsTileOrder(order);
      setBookingsTileOrder(order);
      setTileOrderOpen(false);
    } finally {
      setTileOrderSaving(false);
    }
  };

  const saveSidebarOrder = async (order: string[] | null) => {
    setSidebarOrderSaving(true);
    try {
      await window.electronAPI.setSidebarOrder(order);
      setSidebarOrder(order);
      setSidebarOrderOpen(false);
    } finally {
      setSidebarOrderSaving(false);
    }
  };

  const splash = showSplash ? (
    <SplashScreen onDone={() => setShowSplash(false)} />
  ) : null;

  if (!sessionChecked) {
    return (
      <NotificationProvider errorTitle={t.error} okLabel={t.errorOk} cancelLabel={t.cancel} dismissLabel={t.close} openFileLabel={t.toastOpenFile} fileMissingLabel={t.toastFileMissing} confirmTitle={t.confirmTitle} confirmDangerTitle={t.confirmDangerTitle} confirmLabel={t.confirmOk} errorSubtitle={t.errorSubtitle} confirmSubtitle={t.confirmSubtitle} confirmDangerSubtitle={t.confirmDangerSubtitle}>
        {splash}
        <div className="app" />
      </NotificationProvider>
    );
  }

  if (!session) {
    return (
      <NotificationProvider errorTitle={t.error} okLabel={t.errorOk} cancelLabel={t.cancel} dismissLabel={t.close} openFileLabel={t.toastOpenFile} fileMissingLabel={t.toastFileMissing} confirmTitle={t.confirmTitle} confirmDangerTitle={t.confirmDangerTitle} confirmLabel={t.confirmOk} errorSubtitle={t.errorSubtitle} confirmSubtitle={t.confirmSubtitle} confirmDangerSubtitle={t.confirmDangerSubtitle}>
        {splash}
        <div className="app">
          <Login
            onSignedIn={handleSignedIn}
            notice={sessionExpired ? t.sessionExpiredNotice : null}
          />
        </div>
      </NotificationProvider>
    );
  }

  return (
    <NotificationProvider errorTitle={t.error} okLabel={t.errorOk} cancelLabel={t.cancel} dismissLabel={t.close} openFileLabel={t.toastOpenFile} fileMissingLabel={t.toastFileMissing} confirmTitle={t.confirmTitle} confirmDangerTitle={t.confirmDangerTitle} confirmLabel={t.confirmOk} errorSubtitle={t.errorSubtitle} confirmSubtitle={t.confirmSubtitle} confirmDangerSubtitle={t.confirmDangerSubtitle}>
    <NavigationProvider
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      goBack={goBack}
      goForward={goForward}
      backLabel={locationLabel(nav.stack[nav.index - 1])}
      forwardLabel={locationLabel(nav.stack[nav.index + 1])}
      labels={{ back: t.navBack, forward: t.navForward, group: t.navHistory }}
      item={nav.stack[nav.index].item ?? null}
      openItem={openItem}
      closeItem={closeItem}
    >
    {splash}
    <div className="app">
      <UpdateNotification language={language} />
      <BackupNotifier language={language} />
      {/* First launch on a new version: greet with the release notes. Waits for
          the splash so the two animations don't fight over the screen. */}
      {currentRelease && hasUnreadRelease && !showSplash && (
        <WhatsNewModal
          release={currentRelease}
          language={language}
          onClose={markReleaseSeen}
          onOpenFullView={() => {
            markReleaseSeen();
            setCurrentView('conowego');
          }}
        />
      )}
      <div className="app-body">
      <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          {/* The window's chrome: collapse the rail, and go back or forward.
              One place for the whole app rather than a pair of buttons in
              fourteen view headers — and it is the one row that is on screen
              whatever the user is looking at. */}
          <div className="sidebar-chrome">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? t.expandSidebar : t.collapseSidebar}
              aria-label={sidebarCollapsed ? t.expandSidebar : t.collapseSidebar}
              aria-expanded={!sidebarCollapsed}
            >
              <Icon name="menu" size={20} />
            </button>
            <HeaderNav />
          </div>
          <Logo />
          {/* The welcome, right under the logo: the first thing read on opening
              the app, and the one place that addresses the person rather than
              the data. Held back until the name is known, so it cannot greet a
              mailbox for a beat and then correct itself. */}
          {profileChecked && (
            <SidebarWelcome
              language={language}
              name={myName}
              email={session.email}
              action={<NotificationBell language={language} onOpenTarget={openNotificationTarget} />}
            />
          )}
        </div>
        <div className="sidebar-nav">
          {tidyDividers(sidebarEntries).map((item, index) =>
            item === SIDEBAR_DIVIDER ? (
              <div key={`divider-${index}`} className="nav-divider" />
            ) : (
              <NavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                title={item.title}
                badge={item.badge}
                active={currentView === item.id}
                onClick={item.onClick}
              />
            ),
          )}
          <div className="nav-divider" />
          {/* Who is signed in belongs to the welcome panel at the top; what is
              left down here is the one action — and its own target, so reading
              your name and ending your session are no longer one click. */}
          <NavItem
            icon="arrow-right"
            label={t.signOut}
            title={session.email}
            onClick={handleSignOut}
            className="nav-item--quiet"
          />
        </div>
      </div>

      <div className="main-content">
        {currentView === 'pulpit' && (
          <Ksiegowania
            language={language}
            monthKey={ksiegMonth}
            setMonthKey={changeKsiegMonth}
            filter={ksiegFilter}
            setFilter={setKsiegFilter}
            userEmail={session.email}
            tileOrder={bookingsTileOrder}
            bookingsCollapsed={bookingsCollapsed}
            onToggleBookings={toggleBookings}
            tasksArea={
              <ZadaniaPulpit
                language={language}
                userEmail={session.email}
                onOpen={(seed) => {
                  setZadaniaSeed(seed);
                  setZadaniaOpen(null);
                  navigate('zadania');
                }}
              />
            }
            onShowInHistory={(query) => {
              setHistorySearchSeed(query);
              navigate('converter', 'history');
            }}
            onShowInCalendar={(filter) => {
              setKalStateFilter(filter);
              // The month too: the tiles count from today on, and the calendar
              // would otherwise open on whatever month it was last left at.
              setKalMonth(currentMonthKey());
              navigate('kalendarz', 'calendar');
            }}
          />
        )}
        {currentView === 'converter' && (
          <>
            <ModuleTabs
              tabs={[
                { id: 'convert', label: t.tabConversion, icon: 'folder' },
                { id: 'bookings', label: t.tabBookings, icon: 'book' },
                { id: 'history', label: t.tabHistory, icon: 'history' },
              ]}
              active={converterTab}
              onChange={(id) => navigate('converter', id)}
            />
            {converterTab === 'convert' && (
              <Converter
                language={language}
                files={files}
                setFiles={setFiles}
                selectedBank={selectedBank}
                setSelectedBank={setSelectedBank}
                onAddAdresWithAccount={(acc) => {
                  setAdresyPrefillAccount(acc);
                  navigate('adresy');
                }}
                onNavigateToHistory={() => navigate('converter', 'history')}
              />
            )}
            {converterTab === 'bookings' && (
              <Ksiegowania
                language={language}
                monthKey={ksiegMonth}
                setMonthKey={changeKsiegMonth}
                filter={ksiegFilter}
                setFilter={setKsiegFilter}
                userEmail={session.email}
                tileOrder={bookingsTileOrder}
                showCalendar={false}
                onShowInHistory={(query) => {
                  setHistorySearchSeed(query);
                  navigate('converter', 'history');
                }}
                onShowInCalendar={(filter) => {
                  setKalStateFilter(filter);
                  setKalMonth(currentMonthKey());
                  navigate('kalendarz', 'calendar');
                }}
              />
            )}
            {converterTab === 'history' && (
              <History language={language} searchSeed={historySearchSeed} />
            )}
          </>
        )}
        {currentView === 'kontrahenci' && <Kontrahenci language={language} />}
        {currentView === 'adresy' && (
          <Adresy
            language={language}
            prefillAccountNumber={adresyPrefillAccount}
            onPrefillConsumed={() => setAdresyPrefillAccount(null)}
          />
        )}
        {currentView === 'banki' && <Banki language={language} />}
        {currentView === 'podsumowanie' && (
          <PodsumowanieZaliczek
            language={language}
            files={zaliczkiFiles}
            setFiles={setZaliczkiFiles}
            generatedFilePath={zaliczkiGeneratedPath}
            setGeneratedFilePath={setZaliczkiGeneratedPath}
          />
        )}
        {currentView === 'noty' && (
          <NotySwiadczenia
            language={language}
            files={notyFiles}
            setFiles={setNotyFiles}
          />
        )}
        {currentView === 'scalanie' && (
          <ScalanieWplat
            language={language}
            files={scalanieFiles}
            setFiles={setScalanieFiles}
          />
        )}
        {currentView === 'homebanking' && (
          <Homebanking
            language={language}
            files={homebankingFiles}
            setFiles={setHomebankingFiles}
          />
        )}
        {currentView === 'odczyty' && (
          <>
            <ModuleTabs
              tabs={[
                { id: 'convert', label: t.tabConversion, icon: 'zap' },
                { id: 'history', label: t.tabHistory, icon: 'history' },
              ]}
              active={odczytyTab}
              onChange={(id) => navigate('odczyty', id)}
            />
            {odczytyTab === 'convert' ? (
              <OdczytyLicznikow
                language={language}
                files={odczytyFiles}
                setFiles={setOdczytyFiles}
                onNavigateToHistory={() => navigate('odczyty', 'history')}
              />
            ) : (
              <OdczytyHistoria language={language} />
            )}
          </>
        )}
        {currentView === 'mailing' && (
          <>
            <ModuleTabs
              tabs={[
                { id: 'send', label: t.mailingTabSend, icon: 'mail' },
                { id: 'templates', label: t.mailingTabTemplates, icon: 'file-text' },
                { id: 'types', label: t.mailingTypyTab, icon: 'clipboard' },
                { id: 'fields', label: t.mailingTabFields, icon: 'sparkles' },
                { id: 'history', label: t.tabHistory, icon: 'history' },
              ]}
              active={mailingTab}
              onChange={(id) => navigate('mailing', id)}
            />
            {mailingTab === 'send' && (
              <Mailing
                language={language}
                draft={mailingDraft}
                setDraft={setMailingDraft}
                onNavigateToHistory={() => navigate('mailing', 'history')}
                onNavigateToTemplates={() => navigate('mailing', 'templates')}
              />
            )}
            {mailingTab === 'templates' && <MailingSzablony language={language} />}
            {mailingTab === 'types' && <MailingTypy language={language} />}
            {mailingTab === 'fields' && <MailingPola language={language} />}
            {mailingTab === 'history' && <MailingHistoria language={language} />}
          </>
        )}
        {currentView === 'kalendarz' && (
          <>
            <ModuleTabs
              tabs={[
                { id: 'calendar', label: t.kalTabCalendar, icon: 'calendar' },
                { id: 'types', label: t.kalTabTypes, icon: 'clipboard' },
                { id: 'places', label: t.kalTabPlaces, icon: 'map-pin' },
              ]}
              active={kalendarzTab}
              onChange={(id) => navigate('kalendarz', id)}
            />
            {kalendarzTab === 'calendar' && (
              <Kalendarz
                language={language}
                monthKey={kalMonth}
                setMonthKey={setKalMonth}
                stateFilter={kalStateFilter}
                setStateFilter={setKalStateFilter}
                userEmail={session.email}
                onOpenZadanie={(id) => openZadaniaCard(id)}
                focusRequest={kalFocus}
                onFocusHandled={() => setKalFocus(null)}
                onManageTypes={() => navigate('kalendarz', 'types')}
                onManagePlaces={() => navigate('kalendarz', 'places')}
                onOpenZebranie={openZebranie}
                onOpenSzablony={() => navigate('mailing', 'templates')}
                onSendDocuments={(ctx) => {
                  // A fresh draft, pre-addressed to the meeting's community and
                  // carrying the meeting so the send records itself against it.
                  setMailingDraft({
                    ...emptyMailingDraft,
                    adresIds: ctx.adresIds,
                    spotkanieId: ctx.spotkanieId,
                    spotkanieNazwa: ctx.spotkanieNazwa,
                  });
                  navigate('mailing', 'send');
                }}
              />
            )}
            {kalendarzTab === 'types' && <KalendarzTypy language={language} />}
            {kalendarzTab === 'places' && <KalendarzLokalizacje language={language} />}
          </>
        )}
        {currentView === 'zebrania' && (
          <Zebrania
            language={language}
            userEmail={session.email}
            openRequest={zebraniaOpen}
            onOpenRequestHandled={() => setZebraniaOpen(null)}
            onOpenSpotkanie={(s) => {
              setKalMonth(monthOfDayKey(toDayKey(s.startsAt)));
              openSpotkanie(s.id);
            }}
            onOpenSzablony={() => navigate('mailing', 'templates')}
          />
        )}
        {currentView === 'sprawozdania' && <Sprawozdania language={language} />}
        {currentView === 'plany' && (
          <PlanyGospodarcze language={language} onOpenZebranie={(id) => openZebranie(id, 'plan')} />
        )}
        {currentView === 'podatki' && (
          <>
            <ModuleTabs
              tabs={[
                { id: 'nieruchomosci', label: t.podTabNieruchomosci, icon: 'building' },
                { id: 'cit', label: t.citTab, icon: 'landmark' },
                { id: 'pit', label: t.pitTab, icon: 'briefcase' },
              ]}
              active={podatkiTab}
              onChange={(id) => navigate('podatki', id)}
            />
            {podatkiTab === 'nieruchomosci' && <PodatkiNieruchomosci language={language} />}
            {podatkiTab === 'cit' && <PodatkiCit language={language} />}
            {podatkiTab === 'pit' && <PodatkiPit language={language} />}
          </>
        )}
        {currentView === 'podpis' && (
          <>
            <ModuleTabs
              tabs={[
                { id: 'sign', label: t.podpisPdfTabSign, icon: 'signature' },
                { id: 'history', label: t.tabHistory, icon: 'history' },
              ]}
              active={podpisTab}
              onChange={(id) => navigate('podpis', id)}
            />
            {podpisTab === 'sign' ? (
              <PodpisPdf language={language} files={podpisFiles} setFiles={setPodpisFiles} />
            ) : (
              <PodpisHistoria language={language} />
            )}
          </>
        )}
        {currentView === 'zadania' && <Zadania
            language={language}
            userEmail={session.email}
            initialFilter={zadaniaSeed}
            openRequest={zadaniaOpen}
            onOpenSpotkanie={(s) => {
              setKalMonth(monthOfDayKey(toDayKey(s.startsAt)));
              openSpotkanie(s.id);
            }}
            onEditSpotkanie={(s) => {
              setKalMonth(monthOfDayKey(toDayKey(s.startsAt)));
              openSpotkanie(s.id, true);
            }}
          />}
        {currentView === 'conowego' && (
          <CoNowego language={language} appVersion={appVersion} />
        )}
        {currentView === 'settings' && (
          <Settings
            darkMode={darkMode}
            language={language}
            onDarkModeChange={handleDarkModeChange}
            onLanguageChange={handleLanguageChange}
            userEmail={session.email}
            onUserNamesChanged={loadProfile}
            onOpenSidebarOrder={() => setSidebarOrderOpen(true)}
            onOpenTileOrder={() => setTileOrderOpen(true)}
            onSettingsRestored={loadSettings}
          />
        )}
      </div>
      </div>
      {sidebarOrderOpen && (
        <SidebarOrderModal
          items={sidebarEntries.map((entry) =>
            entry === SIDEBAR_DIVIDER
              ? { id: SIDEBAR_DIVIDER, label: '', icon: 'align-justify' as const }
              : { id: entry.id, label: entry.label, icon: entry.icon },
          )}
          defaultOrder={[...DEFAULT_SIDEBAR_ORDER]}
          language={language}
          saving={sidebarOrderSaving}
          onSave={(order) => void saveSidebarOrder(order)}
          onClose={() => setSidebarOrderOpen(false)}
        />
      )}
      {tileOrderOpen && (
        <SidebarOrderModal
          items={bookingTileOrderItems(language, resolveBookingTileOrder(bookingsTileOrder))}
          defaultOrder={[...DEFAULT_BOOKING_TILE_ORDER]}
          language={language}
          saving={tileOrderSaving}
          title={t.ksTileOrderTitle}
          subtitle={t.ksTileOrderHint}
          icon="grip"
          allowDividers={false}
          onSave={(order) => void saveBookingsTileOrder(order)}
          onClose={() => setTileOrderOpen(false)}
        />
      )}
      <Footer language={language} appVersion={appVersion} />
    </div>
    </NavigationProvider>
    </NotificationProvider>
  );
};

export default App;
