import React, { useState, useEffect } from 'react';
import Converter from './views/Converter';
import Settings from './views/Settings';
import History from './views/History';
import { translations, Language } from './translations';

type View = 'converter' | 'settings' | 'history';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('converter');
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState<Language>('pl');

  useEffect(() => {
    console.log('App mounted, loading settings...');
    loadSettings();
  }, []);

  const loadSettings = async () => {
    console.log('electronAPI available:', !!window.electronAPI);
    console.log('electronAPI methods:', window.electronAPI);
    try {
      const settings = await window.electronAPI.getSettings();
      console.log('Settings loaded:', settings);
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
      <div className="sidebar">
        <div className="sidebar-header">Statement Converter</div>
        <div className="sidebar-nav">
          <div
            className={`nav-item ${currentView === 'converter' ? 'active' : ''}`}
            onClick={() => setCurrentView('converter')}
          >
            {t.converter}
          </div>
          <div
            className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentView('settings')}
          >
            {t.settings}
          </div>
          <div
            className={`nav-item ${currentView === 'history' ? 'active' : ''}`}
            onClick={() => setCurrentView('history')}
          >
            {t.history}
          </div>
        </div>
      </div>

      <div className="main-content">
        {currentView === 'converter' && <Converter language={language} />}
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
  );
};

export default App;
