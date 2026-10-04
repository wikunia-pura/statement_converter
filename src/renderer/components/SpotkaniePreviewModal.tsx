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
import ModalDismiss, { ModalFooter, ModalHeader } from './Modal';
import { FormSection } from './FormSection';

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
  const materialyTone: Record<SpotkanieMaterialyStatus, string> = {
    brak: 'status-neutral',
    potrzebne: 'status-neutral',
    do_przygotowania: 'status-pending',
    przygotowane: 'status-info',
    wyslane: 'status-success',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <ModalDismiss onClose={onClose} ariaLabel={t.close} />
        {/* The meeting is the subject, its moment the second line. */}
        <ModalHeader
          icon="calendar"
          title={s.nazwa}
          subtitle={`${formatDayLabel(toDayKey(s.startsAt), locale)} · ${formatTimeRange(s, locale)}`}
        />
        <div className="modal-body modal-body--sectioned">
          {isTerminWstepny(s) && (
            <div className="callout callout--info">
              <Icon name="clock" size={16} />
              <div className="callout__body">
                <div className="callout__title">{t.kalTerminTentative}</div>
                {t.kalTerminUnconfirmHint}
              </div>
            </div>
          )}

          <FormSection icon="map-pin" title={t.kalSectionWhere}>
            <dl className="facts">
              <dt>{t.kalFieldType}</dt>
              <dd>
                <span className="kal-chip" style={{ ['--chip' as string]: color }}>
                  <span className="kal-chip__dot" />
                  <span className="kal-chip__name">{typ ? typ.nazwa : t.kalNoType}</span>
                </span>
              </dd>
              {s.adresNazwa && (
                <>
                  <dt>{t.kalFieldAdres}</dt>
                  <dd>{s.adresNazwa}</dd>
                </>
              )}
              {s.lokalizacjaNazwa && (
                <>
                  <dt>{t.kalFieldPlace}</dt>
                  <dd>{s.lokalizacjaNazwa}</dd>
                </>
              )}
              {s.zgnNazwa && (
                <>
                  <dt>{t.kalFieldZgn}</dt>
                  <dd>{s.zgnNazwa}</dd>
                </>
              )}
            </dl>
            {s.opis && <p className="kal-card__desc kal-preview__desc">{s.opis}</p>}
          </FormSection>

          {(s.uczestnicy.length > 0 || s.zarzad.length > 0) && (
            <FormSection icon="users" title={t.kalSectionPeople}>
              {s.uczestnicy.length > 0 && (
                <div className="kal-card__group">
                  <span className="kal-card__label">{t.kalFieldParticipants}</span>
                  <div className="kal-people">
                    {s.uczestnicy.map((person) => (
                      <span key={person.userId} className="kal-person kal-person--static" title={person.email}>
                        <Icon name="users" size={12} />
                        <span className="kal-person__label">{personLabel(person)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {s.zarzad.length > 0 && (
                <div className="kal-card__group">
                  <span className="kal-card__label">{t.kalFieldZarzad}</span>
                  <div className="kal-people">
                    {s.zarzad.map((m) => (
                      <span
                        key={`z-${m.imieNazwisko}`}
                        className="kal-person kal-person--static kal-person--board"
                        title={m.email ?? undefined}
                      >
                        <Icon name="home" size={12} />
                        <span className="kal-person__label">{m.imieNazwisko}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </FormSection>
          )}

          <FormSection icon="briefcase" title={t.kalSectionWork}>
            <dl className="facts facts--center">
              <dt>{t.kalMaterialsLabel}</dt>
              <dd>
                <span className={`status-badge ${materialyTone[s.materialyStatus]}`}>
                  {materialyLabels[s.materialyStatus]}
                </span>
              </dd>
              <dt>{t.kalPreviewDocs}</dt>
              <dd>
                <span className={`status-badge ${s.dokumentyWyslaneAt ? 'status-success' : 'status-neutral'}`}>
                  {s.dokumentyWyslaneAt ? t.kalPreviewDocsSent : t.kalPreviewDocsNotSent}
                </span>
                {s.dokumentyWyslaneAt && (
                  <span className="kal-preview__stamp">{formatStamp(s.dokumentyWyslaneAt, locale)}</span>
                )}
              </dd>
            </dl>
          </FormSection>
        </div>
        <ModalFooter
          note={
            onShowInCalendar ? (
              <button type="button" className="button button-small button-subtle" onClick={onShowInCalendar}>
                <Icon name="calendar" size={13} /> {t.zadMeetingOpen}
              </button>
            ) : undefined
          }
          onCancel={onClose}
          cancelLabel={t.close}
          onSubmit={onEdit}
          submitLabel={t.edit}
          submitIcon="edit"
        />
      </div>
    </div>
  );
};

export default SpotkaniePreviewModal;
