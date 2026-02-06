import React, { useState } from 'react';
import Converter from './views/Converter';
import Settings from './views/Settings';
import History from './views/History';

type View = 'converter' | 'settings' | 'history';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('converter');

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sidebar-header">Statement Converter</div>
        <div className="sidebar-nav">
          <div
            className={`nav-item ${currentView === 'converter' ? 'active' : ''}`}
            onClick={() => setCurrentView('converter')}
          >
            Converter
          </div>
          <div
            className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentView('settings')}
          >
            Settings
          </div>
          <div
            className={`nav-item ${currentView === 'history' ? 'active' : ''}`}
            onClick={() => setCurrentView('history')}
          >
            History
          </div>
        </div>
      </div>

      <div className="main-content">
        {currentView === 'converter' && <Converter />}
        {currentView === 'settings' && <Settings />}
        {currentView === 'history' && <History />}
      </div>
    </div>
  );
};

export default App;
