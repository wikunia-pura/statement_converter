import React, { useState, useEffect } from 'react';
import Converter from './views/Converter';
import Settings from './views/Settings';
import History from './views/History';
import Kontrahenci from './views/Kontrahenci';
import Adresy from './views/Adresy';
import PodsumowanieZaliczek, { ZaliczkiFileEntry } from './views/PodsumowanieZaliczek';
import Logo from './components/Logo';
import Footer from './components/Footer';
import UpdateNotification from './components/UpdateNotification';
import { translations, Language } from './translations';
import { FileEntry } from '../shared/types';

type View = 'converter' | 'settings' | 'history' | 'kontrahenci' | 'adresy' | 'podsumowanie';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('converter');
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState<Language>('pl');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedBank, setSelectedBank] = useState<number | null>(null);
  const [zaliczkiFiles, setZaliczkiFiles] = useState<ZaliczkiFileEntry[]>([]);
  const [zaliczkiGeneratedPath, setZaliczkiGeneratedPath] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>('1.0.0');

  useEffect(() => {
    loadSettings();
    loadAppVersion();
  }, []);

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

  return (
    <div className="app">
      <UpdateNotification language={language} />
      <div className="sidebar">
        <Logo />
        <div className="sidebar-nav">
          <div
            className={`nav-item ${currentView === 'converter' ? 'active' : ''}`}
            onClick={() => setCurrentView('converter')}
          >
            <span>📁</span> {t.converter}
          </div>
          <div
            className={`nav-item ${currentView === 'podsumowanie' ? 'active' : ''}`}
            onClick={() => setCurrentView('podsumowanie')}
          >
            <span>📊</span> {t.podsumowanieZaliczek}
          </div>
          <div className="nav-divider" />
          <div
            className={`nav-item ${currentView === 'adresy' ? 'active' : ''}`}
            onClick={() => setCurrentView('adresy')}
          >
            <span>📍</span> {t.adresy}
          </div>
          <div
            className={`nav-item ${currentView === 'kontrahenci' ? 'active' : ''}`}
            onClick={() => setCurrentView('kontrahenci')}
          >
            <span>👥</span> {t.kontrahenci}
          </div>
          <div className="nav-divider" />
          <div
            className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentView('settings')}
          >
            <span>⚙️</span> {t.settings}
          </div>
          <div
            className={`nav-item ${currentView === 'history' ? 'active' : ''}`}
            onClick={() => setCurrentView('history')}
          >
            <span>📜</span> {t.history}
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
        {currentView === 'podsumowanie' && (
          <PodsumowanieZaliczek
            language={language}
            files={zaliczkiFiles}
            setFiles={setZaliczkiFiles}
            generatedFilePath={zaliczkiGeneratedPath}
            setGeneratedFilePath={setZaliczkiGeneratedPath}
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
        <Footer language={language} appVersion={appVersion} />
      </div>
    </div>
  );
};

export default App;
