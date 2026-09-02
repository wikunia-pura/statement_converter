import React, { useState, useEffect } from 'react';
import Converter from './views/Converter';
import Settings from './views/Settings';
import History from './views/History';
import Ksiegowania from './views/Ksiegowania';
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
import Kalendarz from './views/Kalendarz';
import KalendarzTypy from './views/KalendarzTypy';
import ModuleTabs from './components/ModuleTabs';
import CoNowego from './views/CoNowego';
import Login from './views/Login';
import Logo from './components/Logo';
import SplashScreen from './components/SplashScreen';
import SidebarWelcome from './components/SidebarWelcome';
import Footer from './components/Footer';
import Icon from './components/Icon';
import UpdateNotification from './components/UpdateNotification';
import BackupNotifier from './components/BackupNotifier';
import WhatsNewModal from './components/WhatsNewModal';
import { NotificationProvider } from './components/Notifications';
import { translations, Language } from './translations';
import { AppUser, FileEntry } from '../shared/types';
import { BookingFilter, currentMonthKey } from '../shared/bookings';
import { releaseForVersion, shouldShowWhatsNew } from '../shared/release-notes';
import { greetingName } from '../shared/app-users';

interface NavItemProps {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  active?: boolean;
  onClick: () => void;
  /** Tooltip — defaults to the label (useful when the sidebar is collapsed to icons). */
  title?: string;
  /** Unread marker (small dot) — stays visible when the rail is collapsed. */
  badge?: boolean;
  style?: React.CSSProperties;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick, title, badge, style }) => (
  <div
    className={`nav-item ${active ? 'active' : ''}`}
    onClick={onClick}
    title={title ?? label}
    style={style}
  >
    <Icon name={icon} />
    <span className="nav-label">{label}</span>
    {badge && <span className="nav-dot" aria-hidden="true" />}
  </div>
);

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
  | 'conowego';

const App: React.FC = () => {
  // The dashboard is where the app opens: the month's bookings are the question
  // the user comes here with, and converting files is the answer to it.
  const [currentView, setCurrentView] = useState<View>('pulpit');
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState<Language>('pl');
  // Sidebar starts collapsed (icon-only rail); the user can pin it expanded and
  // the choice persists via settings. Default true so it's collapsed on first run.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedBank, setSelectedBank] = useState<number | null>(null);
  const [zaliczkiFiles, setZaliczkiFiles] = useState<ZaliczkiFileEntry[]>([]);
  const [zaliczkiGeneratedPath, setZaliczkiGeneratedPath] = useState<string | null>(null);
  const [notyFiles, setNotyFiles] = useState<NotyFileEntry[]>([]);
  const [scalanieFiles, setScalanieFiles] = useState<ScalanieFileEntry[]>([]);
  const [homebankingFiles, setHomebankingFiles] = useState<HomebankingFileEntry[]>([]);
  const [odczytyFiles, setOdczytyFiles] = useState<OdczytyFileEntry[]>([]);
  // Each module keeps its own Konwersja/Historia tab, so switching modules and
  // coming back lands where the user left off.
  const [converterTab, setConverterTab] = useState<'convert' | 'bookings' | 'history'>('convert');
  // Księgowania: month + filter live here so a detour to Konwersja or Historia
  // comes back to the same month, and "Pokaż w historii" can seed the search.
  const [ksiegMonth, setKsiegMonth] = useState<string>(() => currentMonthKey());
  const [ksiegFilter, setKsiegFilter] = useState<BookingFilter>('all');
  const [historySearchSeed, setHistorySearchSeed] = useState<string>('');
  const [odczytyTab, setOdczytyTab] = useState<'convert' | 'history'>('convert');
  const [mailingTab, setMailingTab] = useState<'send' | 'templates' | 'fields' | 'history'>('send');
  const [kalendarzTab, setKalendarzTab] = useState<'calendar' | 'types'>('calendar');
  // Kalendarz: the month lives here so a detour to "Typy spotkań" — or to any
  // other module — comes back to the month the user was looking at.
  const [kalMonth, setKalMonth] = useState<string>(() => currentMonthKey());
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

  const t = translations[language];

  // Who the app is talking to. The user list is the authority on names; before
  // anyone is named — or while the list is still loading — the mailbox stands
  // in, so the greeting is never blank and never a placeholder.
  const me = profile ?? { email: session?.email ?? '' };
  const myName = greetingName(me);

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

  const splash = showSplash ? (
    <SplashScreen onDone={() => setShowSplash(false)} />
  ) : null;

  if (!sessionChecked) {
    return (
      <NotificationProvider errorTitle={t.error} okLabel="OK" cancelLabel={t.cancel} dismissLabel={t.close}>
        {splash}
        <div className="app" />
      </NotificationProvider>
    );
  }

  if (!session) {
    return (
      <NotificationProvider errorTitle={t.error} okLabel="OK" cancelLabel={t.cancel} dismissLabel={t.close}>
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
    <NotificationProvider errorTitle={t.error} okLabel="OK" cancelLabel={t.cancel} dismissLabel={t.close}>
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
          <Logo />
          {/* The welcome, right under the logo: the first thing read on opening
              the app, and the one place that addresses the person rather than
              the data. Held back until the name is known, so it cannot greet a
              mailbox for a beat and then correct itself. */}
          {profileChecked && (
            <SidebarWelcome language={language} name={myName} email={session.email} />
          )}
        </div>
        <div className="sidebar-nav">
          <NavItem
            icon="home"
            label={t.pulpit}
            active={currentView === 'pulpit'}
            onClick={() => setCurrentView('pulpit')}
          />
          <NavItem
            icon="calendar"
            label={t.kalendarz}
            active={currentView === 'kalendarz'}
            onClick={() => setCurrentView('kalendarz')}
          />
          <div className="nav-divider" />
          <NavItem
            icon="folder"
            label={t.converter}
            active={currentView === 'converter'}
            onClick={() => setCurrentView('converter')}
          />
          <NavItem
            icon="bar-chart"
            label={t.podsumowanieZaliczek}
            active={currentView === 'podsumowanie'}
            onClick={() => setCurrentView('podsumowanie')}
          />
          <NavItem
            icon="file-text"
            label={t.notySwiadczenia}
            active={currentView === 'noty'}
            onClick={() => setCurrentView('noty')}
          />
          <NavItem
            icon="wallet"
            label={t.scalanieWplat}
            active={currentView === 'scalanie'}
            onClick={() => setCurrentView('scalanie')}
          />
          <NavItem
            icon="briefcase"
            label={t.homebanking}
            active={currentView === 'homebanking'}
            onClick={() => setCurrentView('homebanking')}
          />
          <NavItem
            icon="zap"
            label={t.odczyty}
            active={currentView === 'odczyty'}
            onClick={() => setCurrentView('odczyty')}
          />
          <NavItem
            icon="mail"
            label={t.mailing}
            active={currentView === 'mailing'}
            onClick={() => setCurrentView('mailing')}
          />
          <div className="nav-divider" />
          <NavItem
            icon="map-pin"
            label={t.adresy}
            active={currentView === 'adresy'}
            onClick={() => setCurrentView('adresy')}
          />
          <NavItem
            icon="users"
            label={t.kontrahenci}
            active={currentView === 'kontrahenci'}
            onClick={() => setCurrentView('kontrahenci')}
          />
          <NavItem
            icon="building"
            label={t.banki}
            active={currentView === 'banki'}
            onClick={() => setCurrentView('banki')}
          />
          <div className="nav-divider" />
          <NavItem
            icon="sparkles"
            label={t.whatsNew}
            title={hasUnreadRelease ? t.whatsNewNavDot : t.whatsNew}
            badge={hasUnreadRelease}
            active={currentView === 'conowego'}
            onClick={() => {
              setCurrentView('conowego');
              markReleaseSeen();
            }}
          />
          <NavItem
            icon="settings"
            label={t.settings}
            active={currentView === 'settings'}
            onClick={() => setCurrentView('settings')}
          />
          <div className="nav-divider" />
          {/* Who is signed in belongs to the welcome panel at the top; what is
              left down here is the one action — and its own target, so reading
              your name and ending your session are no longer one click. */}
          <NavItem
            icon="arrow-right"
            label={t.signOut}
            title={session.email}
            onClick={handleSignOut}
            style={{ fontSize: 12, opacity: 0.7 }}
          />
        </div>
      </div>

      <div className="main-content">
        {currentView === 'pulpit' && (
          <Ksiegowania
            language={language}
            monthKey={ksiegMonth}
            setMonthKey={setKsiegMonth}
            filter={ksiegFilter}
            setFilter={setKsiegFilter}
            userEmail={session.email}
            onShowInHistory={(query) => {
              setHistorySearchSeed(query);
              setConverterTab('history');
              setCurrentView('converter');
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
              onChange={(id) => setConverterTab(id as 'convert' | 'bookings' | 'history')}
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
                  setCurrentView('adresy');
                }}
                onNavigateToHistory={() => setConverterTab('history')}
              />
            )}
            {converterTab === 'bookings' && (
              <Ksiegowania
                language={language}
                monthKey={ksiegMonth}
                setMonthKey={setKsiegMonth}
                filter={ksiegFilter}
                setFilter={setKsiegFilter}
                userEmail={session.email}
                onShowInHistory={(query) => {
                  setHistorySearchSeed(query);
                  setConverterTab('history');
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
              onChange={(id) => setOdczytyTab(id as 'convert' | 'history')}
            />
            {odczytyTab === 'convert' ? (
              <OdczytyLicznikow
                language={language}
                files={odczytyFiles}
                setFiles={setOdczytyFiles}
                onNavigateToHistory={() => setOdczytyTab('history')}
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
                { id: 'fields', label: t.mailingTabFields, icon: 'sparkles' },
                { id: 'history', label: t.tabHistory, icon: 'history' },
              ]}
              active={mailingTab}
              onChange={(id) => setMailingTab(id as 'send' | 'templates' | 'fields' | 'history')}
            />
            {mailingTab === 'send' && (
              <Mailing
                language={language}
                draft={mailingDraft}
                setDraft={setMailingDraft}
                onNavigateToHistory={() => setMailingTab('history')}
                onNavigateToTemplates={() => setMailingTab('templates')}
              />
            )}
            {mailingTab === 'templates' && <MailingSzablony language={language} />}
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
              ]}
              active={kalendarzTab}
              onChange={(id) => setKalendarzTab(id as 'calendar' | 'types')}
            />
            {kalendarzTab === 'calendar' ? (
              <Kalendarz
                language={language}
                monthKey={kalMonth}
                setMonthKey={setKalMonth}
                userEmail={session.email}
                onManageTypes={() => setKalendarzTab('types')}
              />
            ) : (
              <KalendarzTypy language={language} />
            )}
          </>
        )}
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
          />
        )}
      </div>
      </div>
      <Footer language={language} appVersion={appVersion} />
    </div>
    </NotificationProvider>
  );
};

export default App;
