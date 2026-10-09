import React, { useEffect, useState } from 'react';
import { PodpisHistoriaEntry } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import PodpisHistoryTimeline from '../components/PodpisHistoryTimeline';
import { FormSection } from '../components/FormSection';
import Icon from '../components/Icon';

interface Props {
  language: Language;
}

/** Podpis kwalifikowany → Historia: every run of signing, who did it and with which certificate. */
const PodpisHistoria: React.FC<Props> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [history, setHistory] = useState<PodpisHistoriaEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadHistory = async () => {
    try {
      setHistory(await window.electronAPI.podpisGetHistoria());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const handleClear = async () => {
    if (await notify.confirm(t.podpisPdfConfirmClearHistory, { danger: true })) {
      await window.electronAPI.podpisClearHistoria();
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
      <FormSection
        icon="history"
        title={t.podpisTitle}
        description={t.podpisPdfHistoryDesc}
        aside={
          history.length > 0 ? (
            <button className="button button-ghost icon-danger" onClick={handleClear}>
              <Icon name="trash" size={14} /> {t.odczytyClearHistory}
            </button>
          ) : undefined
        }
      >
        <PodpisHistoryTimeline history={history} language={language} />
      </FormSection>
    </div>
  );
};

export default PodpisHistoria;
