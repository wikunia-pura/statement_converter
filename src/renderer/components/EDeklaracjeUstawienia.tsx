import React, { useEffect, useState } from 'react';
import { EDeklaracjeSrodowisko, normalizeSrodowisko } from '../../shared/e-deklaracje';
import { translations, Language } from '../translations';
import { FormSection } from './FormSection';
import { useNotify } from './Notifications';
import { ipcErrorMessage } from '../ipcError';
import Icon from './Icon';

/**
 * Settings → Administracja → "Wysyłka e-Deklaracji": which gateway signed returns go to. Test by default —
 * it answers like the real one and files nothing; switching to production asks first, because from then on
 * "Wyślij" files with the tax office. Machine-local, like the rest of these settings.
 */
const EDeklaracjeUstawienia: React.FC<{ language: Language }> = ({ language }) => {
  const t = translations[language];
  const notify = useNotify();
  const [srodowisko, setSrodowisko] = useState<EDeklaracjeSrodowisko>('test');

  useEffect(() => {
    void window.electronAPI.getSettings().then((s) => setSrodowisko(normalizeSrodowisko(s.eDeklaracjeSrodowisko)));
  }, []);

  const zmien = async (prod: boolean) => {
    if (prod && !(await notify.confirm(t.edeklProdConfirm, { danger: true, confirmLabel: t.edeklProdConfirmButton }))) return;
    try {
      setSrodowisko(await window.electronAPI.setEDeklaracjeSrodowisko(prod ? 'prod' : 'test'));
      notify.success(prod ? t.edeklSwitchedProd : t.edeklSwitchedTest);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected));
    }
  };

  return (
    <FormSection icon="landmark" title={t.edeklTitle} description={t.edeklDesc}>
      <label className="switch-row">
        <span className="switch-row__text">
          <span className="switch-row__label">{t.edeklProd}</span>
          <span className="switch-row__hint">{t.edeklProdHint}</span>
        </span>
        <span className="toggle-switch">
          <input type="checkbox" checked={srodowisko === 'prod'} onChange={(e) => void zmien(e.target.checked)} />
          <span className="toggle-slider"></span>
        </span>
      </label>
      <div className={`callout ${srodowisko === 'prod' ? 'callout--warning' : ''}`}>
        <Icon name={srodowisko === 'prod' ? 'alert-triangle' : 'info'} size={16} />
        <div className="callout__body">{srodowisko === 'prod' ? t.edeklNowProd : t.edeklNowTest}</div>
      </div>
    </FormSection>
  );
};

export default EDeklaracjeUstawienia;
