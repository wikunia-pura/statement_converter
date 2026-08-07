import React, { useState, useEffect } from 'react';
import Converter from './views/Converter';
import Settings from './views/Settings';
import History from './views/History';
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
import ModuleTabs from './components/ModuleTabs';
import CoNowego from './views/CoNowego';
import Login from './views/Login';
import Logo from './components/Logo';
import SplashScreen from './components/SplashScreen';
import Footer from './components/Footer';
import Icon from './components/Icon';
import UpdateNotification from './components/UpdateNotification';
import BackupNotifier from './components/BackupNotifier';
import WhatsNewModal from './components/WhatsNewModal';
import { NotificationProvider } from './components/Notifications';
import { translations, Language } from './translations';
import { FileEntry } from '../shared/types';
import { releaseForVersion, shouldShowWhatsNew } from '../shared/release-notes';

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
  | 'conowego';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('converter');
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
  const [converterTab, setConverterTab] = useState<'convert' | 'history'>('convert');
  const [odczytyTab, setOdczytyTab] = useState<'convert' | 'history'>('convert');
  const [mailingTab, setMailingTab] = useState<'send' | 'templates' | 'fields' | 'history'>('send');
  // The send form lives here so a detour to Adresy (to attach a missing city
  // unit) or to the templates tab doesn't throw away a half-filled mailing.
  const [mailingDraft, setMailingDraft] = useState<MailingDraft>(emptyMailingDraft);
  // When the Converter asks "+ Add address with this account", we switch to the
  // Adresy view and pass this value through one render so the modal can prefill it.
  const [adresyPrefillAccount, setAdresyPrefillAccount] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('1.0.0');
  const [session, setSession] = useState<{ email: string; userId: string } | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
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
      } finally {
        setSessionChecked(true);
      }
    })();
  }, []);

  const handleSignOut = async () => {
    await window.electronAPI.authSignOut();
    setSession(null);
  };

  const handleSignedIn = async () => {
    const s = await window.electronAPI.authGetSession();
    setSession(s);
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
          <Login onSignedIn={handleSignedIn} />
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
        </div>
        <div className="sidebar-nav">
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
          <NavItem
            icon="users"
            label={`Wyloguj (${session.email})`}
            title={session.email}
            onClick={handleSignOut}
            style={{ fontSize: 12, opacity: 0.7 }}
          />
        </div>
      </div>

      <div className="main-content">
        {currentView === 'converter' && (
          <>
            <ModuleTabs
              tabs={[
                { id: 'convert', label: t.tabConversion, icon: 'folder' },
                { id: 'history', label: t.tabHistory, icon: 'history' },
              ]}
              active={converterTab}
              onChange={(id) => setConverterTab(id as 'convert' | 'history')}
            />
            {converterTab === 'convert' ? (
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
            ) : (
              <History language={language} />
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
        {currentView === 'conowego' && (
          <CoNowego language={language} appVersion={appVersion} />
        )}
        {currentView === 'settings' && (
          <Settings
            darkMode={darkMode}
            language={language}
            onDarkModeChange={handleDarkModeChange}
            onLanguageChange={handleLanguageChange}
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
