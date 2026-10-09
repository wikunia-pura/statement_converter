import React from 'react';
import {
  ZEBRANIE_DOKUMENTY,
  ZebranieDokumentKlucz,
  ZebranieStatus,
  ZebranieWersja,
} from '../../shared/types';
import type { IconName } from './Icon';
import { translations, Language } from '../translations';
import { FormSection } from './FormSection';
import Icon from './Icon';

const STATUSY: { status: ZebranieStatus; icon: IconName }[] = [
  { status: 'w_przygotowaniu', icon: 'clock' },
  { status: 'przygotowane', icon: 'check' },
];

/**
 * The status of ONE document of a version (the notice, the statement, the plan,
 * the resolutions), at the foot of its tab. The version itself is prepared only
 * once every document is — the description says how many are.
 */
const ZebranieStatusBox: React.FC<{
  language: Language;
  wersja: ZebranieWersja;
  dokument: ZebranieDokumentKlucz;
  busy: boolean;
  onChange: (dokument: ZebranieDokumentKlucz, gotowe: boolean) => void;
}> = ({ language, wersja, dokument, busy, onChange }) => {
  const t = translations[language];
  const ready = wersja.gotowe[dokument] === true;
  const current: ZebranieStatus = ready ? 'przygotowane' : 'w_przygotowaniu';
  const count = ZEBRANIE_DOKUMENTY.filter((k) => wersja.gotowe[k] === true).length;
  return (
    <FormSection
      icon="flag"
      title={t.zebraniaStatusBoxTitle}
      description={t.zebraniaStatusBoxHint
        .replace('{n}', String(count))
        .replace('{total}', String(ZEBRANIE_DOKUMENTY.length))}
    >
      <div className="zeb-status-cards" role="radiogroup" aria-label={t.zebraniaStatusBoxTitle}>
        {STATUSY.map(({ status, icon }) => {
          const active = current === status;
          const isReady = status === 'przygotowane';
          return (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={active}
              className={`zeb-status-card zeb-status-card--${status}${active ? ' is-active' : ''}`}
              disabled={busy}
              onClick={() => !active && onChange(dokument, isReady)}
            >
              <span className="zeb-status-card__icon">
                <Icon name={icon} size={18} />
              </span>
              <span className="zeb-status-card__text">
                <strong>{isReady ? t.zebraniaStatusPrzygotowane : t.zebraniaStatusW}</strong>
                <span>{isReady ? t.zebraniaStatusReadyText : t.zebraniaStatusDraftText}</span>
              </span>
              <span className="zeb-status-card__check" aria-hidden="true">
                {active && <Icon name="check" size={14} />}
              </span>
            </button>
          );
        })}
      </div>
    </FormSection>
  );
};

export default ZebranieStatusBox;
