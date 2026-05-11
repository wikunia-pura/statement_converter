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
import Login from './views/Login';
import Logo from './components/Logo';
import Footer from './components/Footer';
import Icon from './components/Icon';
import UpdateNotification from './components/UpdateNotification';
import { translations, Language } from './translations';
import { FileEntry } from '../shared/types';

type View =
  | 'converter'
  | 'settings'
  | 'history'
  | 'kontrahenci'
  | 'adresy'
  | 'banki'
  | 'podsumowanie'
  | 'noty'
  | 'scalanie'
  | 'homebanking';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('converter');
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState<Language>('pl');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedBank, setSelectedBank] = useState<number | null>(null);
  const [zaliczkiFiles, setZaliczkiFiles] = useState<ZaliczkiFileEntry[]>([]);
  const [zaliczkiGeneratedPath, setZaliczkiGeneratedPath] = useState<string | null>(null);
  const [notyFiles, setNotyFiles] = useState<NotyFileEntry[]>([]);
  const [scalanieFiles, setScalanieFiles] = useState<ScalanieFileEntry[]>([]);
  const [homebankingFiles, setHomebankingFiles] = useState<HomebankingFileEntry[]>([]);
  const [appVersion, setAppVersion] = useState<string>('1.0.0');
  const [session, setSession] = useState<{ email: string; userId: string } | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);

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

  const t = translations[language];

  if (!sessionChecked) {
    return <div className="app" />;
  }

  if (!session) {
    return (
      <div className="app">
        <Login onSignedIn={handleSignedIn} />
      </div>
    );
  }

  return (
    <div className="app">
      <UpdateNotification language={language} />
      <div className="app-body">
      <div className="sidebar">
        <Logo />
        <div className="sidebar-nav">
          <div
            className={`nav-item ${currentView === 'converter' ? 'active' : ''}`}
            onClick={() => setCurrentView('converter')}
          >
            <Icon name="folder" /> {t.converter}
          </div>
          <div
            className={`nav-item ${currentView === 'podsumowanie' ? 'active' : ''}`}
            onClick={() => setCurrentView('podsumowanie')}
          >
            <Icon name="bar-chart" /> {t.podsumowanieZaliczek}
          </div>
          <div
            className={`nav-item ${currentView === 'noty' ? 'active' : ''}`}
            onClick={() => setCurrentView('noty')}
          >
            <Icon name="file-text" /> {t.notySwiadczenia}
          </div>
          <div
            className={`nav-item ${currentView === 'scalanie' ? 'active' : ''}`}
            onClick={() => setCurrentView('scalanie')}
          >
            <Icon name="wallet" /> {t.scalanieWplat}
          </div>
          <div
            className={`nav-item ${currentView === 'homebanking' ? 'active' : ''}`}
            onClick={() => setCurrentView('homebanking')}
          >
            <Icon name="briefcase" /> {t.homebanking}
          </div>
          <div className="nav-divider" />
          <div
            className={`nav-item ${currentView === 'adresy' ? 'active' : ''}`}
            onClick={() => setCurrentView('adresy')}
          >
            <Icon name="map-pin" /> {t.adresy}
          </div>
          <div
            className={`nav-item ${currentView === 'kontrahenci' ? 'active' : ''}`}
            onClick={() => setCurrentView('kontrahenci')}
          >
            <Icon name="users" /> {t.kontrahenci}
          </div>
          <div
            className={`nav-item ${currentView === 'banki' ? 'active' : ''}`}
            onClick={() => setCurrentView('banki')}
          >
            <Icon name="building" /> {t.banki}
          </div>
          <div className="nav-divider" />
          <div
            className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentView('settings')}
          >
            <Icon name="settings" /> {t.settings}
          </div>
          <div
            className={`nav-item ${currentView === 'history' ? 'active' : ''}`}
            onClick={() => setCurrentView('history')}
          >
            <Icon name="history" /> {t.history}
          </div>
          <div className="nav-divider" />
          <div
            className="nav-item"
            onClick={handleSignOut}
            title={session.email}
            style={{ fontSize: 12, opacity: 0.7 }}
          >
            <Icon name="users" /> Wyloguj ({session.email})
          </div>
        </div>
      </div>

      <div className="main-content">
        {currentView === 'converter' && (
          <Converter
            language={language}
            files={files}
            setFiles={setFiles}
            selectedBank={selectedBank}
            setSelectedBank={setSelectedBank}
          />
        )}
        {currentView === 'kontrahenci' && <Kontrahenci language={language} />}
        {currentView === 'adresy' && <Adresy language={language} />}
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
        {currentView === 'settings' && (
          <Settings
            darkMode={darkMode}
            language={language}
            onDarkModeChange={handleDarkModeChange}
            onLanguageChange={handleLanguageChange}
          />
        )}
        {currentView === 'history' && <History language={language} />}
      </div>
      </div>
      <Footer language={language} appVersion={appVersion} />
    </div>
  );
};

export default App;
