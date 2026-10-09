import React, { useState } from 'react';
import { AdresyZasilenieResult } from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import { FormSection } from '../components/FormSection';
import ModalDismiss, { ModalFooter, ModalHeader } from '../components/Modal';
import { bezPrefiksu } from '../components/PodpisKarta';
import Icon from '../components/Icon';

/*
 * One-time fill of the tax identification of Adresy from the DN-1 declarations
 * the app already holds. Self-contained on purpose — this file, the one line
 * that mounts it in Adresy and the `adresyZasil*` translations go away together
 * once the data is kept by hand.
 */

const Lista: React.FC<{ icon: 'alert-triangle' | 'info'; title: string; desc: string; names: string[] }> = ({
  icon,
  title,
  desc,
  names,
}) => (
  <FormSection icon={icon} title={`${title} (${names.length})`} description={desc}>
    <ul className="podpis-sum__list">
      {names.map((n) => (
        <li key={n}>
          <span className="podpis-sum__name">{n}</span>
        </li>
      ))}
    </ul>
  </FormSection>
);

const ZasilWynik: React.FC<{ language: Language; wynik: AdresyZasilenieResult; onClose: () => void }> = ({
  language,
  wynik,
  onClose,
}) => {
  const t = translations[language];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <ModalHeader icon="check-circle" title={t.adresyZasilResultTitle} subtitle={t.adresyZasilResultSubtitle} />
        <div className="modal-body modal-body--sectioned">
          <div className="podpis-sum__stats" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div className={`podpis-sum__stat is-${wynik.zasilone > 0 ? 'success' : 'neutral'}`}>
              <span className="podpis-sum__stat-value">{wynik.zasilone}</span>
              <span className="podpis-sum__stat-label">{t.adresyZasilFilled}</span>
            </div>
            <div className="podpis-sum__stat is-neutral">
              <span className="podpis-sum__stat-value">{wynik.bezZmian}</span>
              <span className="podpis-sum__stat-label">{t.adresyZasilUnchanged}</span>
            </div>
          </div>
          {wynik.bezDopasowania.length > 0 && (
            <Lista
              icon="alert-triangle"
              title={t.adresyZasilNoMatch}
              desc={t.adresyZasilNoMatchDesc}
              names={wynik.bezDopasowania}
            />
          )}
          {wynik.niejednoznaczne.length > 0 && (
            <Lista
              icon="alert-triangle"
              title={t.adresyZasilAmbiguous}
              desc={t.adresyZasilAmbiguousDesc}
              names={wynik.niejednoznaczne}
            />
          )}
        </div>
        <ModalFooter onCancel={onClose} cancelLabel={t.close} />
      </div>
    </div>
  );
};

/** The toolbar button of Adresy: confirms, runs the fill, reloads the list and reports what it did. */
const AdresyZasilDn1: React.FC<{ language: Language; onDone: () => void; disabled?: boolean }> = ({
  language,
  onDone,
  disabled,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [wynik, setWynik] = useState<AdresyZasilenieResult | null>(null);

  const run = async () => {
    if (!(await notify.confirm(t.adresyZasilConfirm, { confirmLabel: t.adresyZasilConfirmBtn }))) return;
    setBusy(true);
    try {
      setWynik(await window.electronAPI.zasilAdresyZDn1());
      onDone();
    } catch (err: unknown) {
      notify.error(bezPrefiksu(err), t.adresyZasilError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="button button-import"
        onClick={() => void run()}
        disabled={busy || disabled}
        title={t.adresyZasilHint}
      >
        <Icon name={busy ? 'loader' : 'copy'} size={14} /> {t.adresyZasil}
      </button>
      {wynik && <ZasilWynik language={language} wynik={wynik} onClose={() => setWynik(null)} />}
    </>
  );
};

export default AdresyZasilDn1;
