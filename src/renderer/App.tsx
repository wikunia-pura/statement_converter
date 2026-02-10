import React, { useState, useEffect } from 'react';
import Converter from './views/Converter';
import Settings from './views/Settings';
import History from './views/History';
import Logo from './components/Logo';
import UpdateNotification from './components/UpdateNotification';
import { translations, Language } from './translations';
import { FileEntry } from '../shared/types';

type View = 'converter' | 'settings' | 'history';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('converter');
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState<Language>('pl');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedBank, setSelectedBank] = useState<number | null>(null);
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
        {currentView === 'settings' && (
          <Settings
            darkMode={darkMode}
            language={language}
            onDarkModeChange={handleDarkModeChange}
            onLanguageChange={handleLanguageChange}
          />
        )}
        {currentView === 'history' && <History language={language} />}
        <div className="app-footer">
          <span style={{ fontSize: '11px', opacity: 0.6 }}>
            © 2026 FileFunky | v{appVersion}
          </span>
        </div>
      </div>
    </div>
  );
};

export default App;
