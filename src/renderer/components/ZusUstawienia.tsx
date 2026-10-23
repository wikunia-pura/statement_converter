import React, { useEffect, useState } from 'react';
import { ZusSrodowisko, normalizeZusSrodowisko } from '../../shared/zus-ewd';
import { translations, Language } from '../translations';
import { FormSection } from './FormSection';
import { useNotify } from './Notifications';
import { ipcErrorMessage } from '../ipcError';
import Icon from './Icon';

/**
 * Settings → Administracja → "Wysyłka do ZUS": which ZUS service (EWD) documents go to. Test by default — it
 * answers like the real one and files nothing; switching to production asks first, because from then on
 * "Podpisz i wyślij do ZUS" files with ZUS. Machine-local and apart from the e-Deklaracje switch.
 * "Sprawdź połączenie" is ZUS's own echo — nothing but a few bytes is sent.
 */
const ZusUstawienia: React.FC<{ language: Language }> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [srodowisko, setSrodowisko] = useState<ZusSrodowisko>('test');
  const [sprawdzam, setSprawdzam] = useState(false);

  useEffect(() => {
    void window.electronAPI.getSettings().then((s) => setSrodowisko(normalizeZusSrodowisko(s.zusSrodowisko)));
  }, []);

  const zmien = async (prod: boolean) => {
    if (prod && !(await notify.confirm(t.zusEwdProdConfirm, { danger: true, confirmLabel: t.zusEwdProdConfirmButton }))) return;
    try {
      setSrodowisko(await window.electronAPI.setZusSrodowisko(prod ? 'prod' : 'test'));
      notify.success(prod ? t.zusEwdSwitchedProd : t.zusEwdSwitchedTest);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected));
    }
  };

  const sprawdz = async () => {
    setSprawdzam(true);
    try {
      const s = await window.electronAPI.sprawdzPolaczenieZus();
      notify.success(t.zusEwdPingOk.replace('{env}', s === 'prod' ? t.citEnvProd : t.citEnvTest));
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.zusEwdPingError);
    } finally {
      setSprawdzam(false);
    }
  };

  return (
    <FormSection icon="shield" title={t.zusEwdTitle} description={t.zusEwdDesc}>
      <label className="switch-row">
        <span className="switch-row__text">
          <span className="switch-row__label">{t.zusEwdProd}</span>
          <span className="switch-row__hint">{t.zusEwdProdHint}</span>
        </span>
        <span className="toggle-switch">
          <input type="checkbox" checked={srodowisko === 'prod'} onChange={(e) => void zmien(e.target.checked)} />
          <span className="toggle-slider"></span>
        </span>
      </label>
      <div className={`callout ${srodowisko === 'prod' ? 'callout--warning' : ''}`}>
        <Icon name={srodowisko === 'prod' ? 'alert-triangle' : 'info'} size={16} />
        <div className="callout__body">{srodowisko === 'prod' ? t.zusEwdNowProd : t.zusEwdNowTest}</div>
        <button type="button" className="button button-small button-secondary" onClick={() => void sprawdz()} disabled={sprawdzam}>
          <Icon name={sprawdzam ? 'loader' : 'refresh'} size={13} /> {t.zusEwdPing}
        </button>
      </div>
    </FormSection>
  );
};

export default ZusUstawienia;
