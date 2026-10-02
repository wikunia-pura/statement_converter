import React from 'react';
import { Spotkanie, SpotkanieMaterialyStatus, SpotkanieTyp } from '../../shared/types';
import {
  DEFAULT_TYP_COLOR,
  formatDayLabel,
  formatStamp,
  formatTimeRange,
  isTerminWstepny,
  normalizeHexColor,
  toDayKey,
} from '../../shared/calendar';
import { personLabel } from '../../shared/app-users';
import { translations, Language } from '../translations';
import Icon from './Icon';
import ModalDismiss from './Modal';

interface Props {
  language: Language;
  spotkanie: Spotkanie;
  /** The meeting's type, when it still exists — its name and colour. */
  typ: SpotkanieTyp | null;
  /** Switch to editing — the calendar's own form, with everything it needs. */
  onEdit?: () => void;
  /** Show the meeting on its day in Kalendarz. */
  onShowInCalendar?: () => void;
  onClose: () => void;
}

/**
 * A meeting to read, not to change: what a task's meeting link opens. The same
 * facts as the calendar's card, as text — the way into the form is "Edytuj".
 */
const SpotkaniePreviewModal: React.FC<Props> = ({
  language,
  spotkanie: s,
  typ,
  onEdit,
  onShowInCalendar,
  onClose,
}) => {
  const t = translations[language];
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';
  const color = normalizeHexColor(typ?.kolor ?? DEFAULT_TYP_COLOR);
  const materialyLabels: Record<SpotkanieMaterialyStatus, string> = {
    brak: t.kalMatStateBrak,
    potrzebne: t.kalMatStatePotrzebne,
    do_przygotowania: t.kalMatStateDo,
    przygotowane: t.kalMatStatePrzygotowane,
    wyslane: t.kalMatStateWyslane,
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(620px, 94vw)', maxWidth: 620 }}
      >
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        <div className="modal-header">{t.kalPreviewTitle}</div>
        <div className="modal-body">
          <div className="kal-card kal-card--preview" style={{ ['--chip' as string]: color }}>
            <div className="kal-card__head">
              <span className="kal-card__time">
                <Icon name="calendar" size={13} /> {formatDayLabel(toDayKey(s.startsAt), locale)}
              </span>
              <span className="kal-card__time">
                <Icon name="clock" size={13} /> {formatTimeRange(s, locale)}
              </span>
              {isTerminWstepny(s) && (
                <span className="status-badge kal-badge kal-badge--tentative">
                  <Icon name="clock" size={11} /> {t.kalTerminTentative}
                </span>
              )}
            </div>

            <h4 className="kal-card__name">{s.nazwa}</h4>

            <div className="kal-card__meta">
              <span className="kal-chip" style={{ ['--chip' as string]: color }}>
                <span className="kal-chip__dot" />
                <span className="kal-chip__name">{typ ? typ.nazwa : t.kalNoType}</span>
              </span>
              {s.adresNazwa && (
                <span className="kal-card__adres">
                  <Icon name="building" size={13} /> {s.adresNazwa}
                </span>
              )}
              {s.lokalizacjaNazwa && (
                <span className="kal-place">
                  <Icon name="map-pin" size={13} /> {s.lokalizacjaNazwa}
                </span>
              )}
              {s.zgnNazwa && (
                <span className="kal-place" title={t.kalFieldZgn}>
                  <Icon name="shield" size={13} /> {s.zgnNazwa}
                </span>
              )}
            </div>

            {s.opis && <p className="kal-card__desc">{s.opis}</p>}

            {(s.uczestnicy.length > 0 || s.zarzad.length > 0) && (
              <div className="kal-people">
                {s.uczestnicy.map((person) => (
                  <span key={person.userId} className="kal-person kal-person--static" title={person.email}>
                    <Icon name="users" size={12} />
                    <span className="kal-person__label">{personLabel(person)}</span>
                  </span>
                ))}
                {s.zarzad.map((m) => (
                  <span
                    key={`z-${m.imieNazwisko}`}
                    className="kal-person kal-person--static kal-person--board"
                    title={[t.kalFieldZarzad, m.email].filter(Boolean).join(' · ')}
                  >
                    <Icon name="home" size={12} />
                    <span className="kal-person__label">{m.imieNazwisko}</span>
                  </span>
                ))}
              </div>
            )}

            <dl className="zad-preview__facts">
              <dt>{t.kalMaterialsLabel}</dt>
              <dd>{materialyLabels[s.materialyStatus]}</dd>
              <dt>{t.kalPreviewDocs}</dt>
              <dd>
                {s.dokumentyWyslaneAt
                  ? `${t.kalPreviewDocsSent} · ${formatStamp(s.dokumentyWyslaneAt, locale)}`
                  : t.kalPreviewDocsNotSent}
              </dd>
            </dl>
          </div>
        </div>
        <div className="modal-footer">
          {onShowInCalendar && (
            <button
              type="button"
              className="button button-secondary"
              style={{ marginRight: 'auto' }}
              onClick={onShowInCalendar}
            >
              <Icon name="calendar" size={14} /> {t.zadMeetingOpen}
            </button>
          )}
          <button type="button" className="button button-secondary" onClick={onClose}>
            <Icon name="x" size={14} /> {t.close}
          </button>
          {onEdit && (
            <button type="button" className="button button-primary" onClick={onEdit}>
              <Icon name="edit" size={14} /> {t.edit}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpotkaniePreviewModal;
