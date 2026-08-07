import React, { useEffect, useState } from 'react';
import { OdczytyHistoryEntry } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import OdczytyHistoryTimeline from '../components/OdczytyHistoryTimeline';
import Icon from '../components/Icon';

interface Props {
  language: Language;
}

/** Operation history of the meter-readings module — the module's "Historia" tab. */
const OdczytyHistoria: React.FC<Props> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [history, setHistory] = useState<OdczytyHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadHistory();
  }, []);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      setHistory(await window.electronAPI.odczytyGetHistory());
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = async () => {
    if (await notify.confirm(t.odczytyConfirmClearHistory, { danger: true })) {
      await window.electronAPI.odczytyClearHistory();
      void loadHistory();
    }
  };

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  return (
    <div className="content-body">
      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px',
          }}
        >
          <h2 style={{ margin: 0 }}>{t.odczytyTitle}</h2>
          {history.length > 0 && (
            <button className="button button-danger" onClick={handleClear}>
              <Icon name="trash" size={14} />{' '}{t.odczytyClearHistory}
            </button>
          )}
        </div>

        <OdczytyHistoryTimeline history={history} language={language} />
      </div>
    </div>
  );
};

export default OdczytyHistoria;
