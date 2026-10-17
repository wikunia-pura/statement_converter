import React from 'react';
import {
  AppUser,
  Spotkanie,
  SpotkanieMailing,
  SpotkanieTerminStatus,
  SpotkanieMaterialyStatus,
  SpotkanieMaterialyKrok,
  SPOTKANIE_MATERIALY_KROKI,
  ZEBRANIE_DOKUMENTY,
  SPOTKANIE_MATERIALY_POPRZEDNI,
  SpotkanieTyp,
  Zadanie,
  ZebranieStatusRow,
} from '../../../shared/types';
import { personLabel } from '../../../shared/app-users';
import { translations, Language } from '../../translations';
import Icon, { type IconName } from '../Icon';
import { dokumentLabel } from '../../views/Zebrania';
import Tip from '../Tip';
import {
  formatStamp,
  formatTimeRange,
  hasUnreadTerminChange,
  isTerminWstepny,
  normalizeHexColor,
  spotkanieWhen,
  DEFAULT_TYP_COLOR,
} from '../../../shared/calendar';
import { materialyStatusLabel } from './kalendarzShared';
import { SpotkanieZadania } from './SpotkanieZadania';

/** The materials state as a short badge word — the section title says "Materiały". */
function materialyStepLabel(
  t: (typeof translations)['pl'],
  status: SpotkanieMaterialyStatus,
): string {
  return {
    brak: t.kalMaterialsNo,
    potrzebne: t.kalMaterialsYes,
    do_przygotowania: t.kalMatStepDo,
    przygotowane: t.kalMatStepPrzygotowane,
    wyslane: t.kalMatStepWyslane,
  }[status];
}

/** How far along the materials are, as a badge tone. */
const MATERIALY_TONE: Record<SpotkanieMaterialyStatus, string> = {
  brak: 'status-neutral',
  potrzebne: 'status-neutral',
  do_przygotowania: 'status-pending',
  przygotowane: 'status-info',
  wyslane: 'status-success',
};

/* =========================== One meeting, expanded ========================== */

export const MeetingCard: React.FC<{
  spotkanie: Spotkanie;
  typ: SpotkanieTyp | null;
  /** Resolved place name — the live dictionary entry, or the snapshot. */
  place: string;
  /** Mailings recorded against this meeting, newest first. */
  mailings: SpotkanieMailing[];
  language: Language;
  locale: string;
  highlighted: boolean;
  busy: boolean;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  /** "I have seen that the date moved." */
  onAckTermin: () => void;
  /** Settle a tentative date, or put a settled one back to tentative. */
  onTerminStatus: (status: SpotkanieTerminStatus) => void;
  /** Move the materials status: none needed / to prepare / ready. */
  onMaterialy: (status: SpotkanieMaterialyStatus) => void;
  /** The meeting's entry in the Zebrania module, once "Przygotuj materiały" made one. */
  zebranie?: ZebranieStatusRow;
  /** "Przygotuj materiały": create the meeting's Zebrania entry. */
  onPrzygotuj?: () => void;
  /** Open the meeting's entry in the Zebrania module. */
  onOpenZebranie?: () => void;
  /** "Zawiadomienie o zebraniu". Absent when the meeting has no community. */
  onZawiadomienie?: () => void;
  /** Hand this meeting to the Mailing module. Absent when it has no community. */
  onSendMailing?: () => void;
  /** Open one recorded send in the mailing-details window. */
  onOpenMailing: (mailing: SpotkanieMailing) => void;
  /** Tasks linked to this meeting, and what can be done with them. */
  zadania: Zadanie[];
  users: AppUser[];
  onAddTask: () => void;
  onPreviewTask: (zadanie: Zadanie) => void;
  onEditTask: (zadanie: Zadanie) => void;
  onDeleteTask: (zadanie: Zadanie) => void;
  onOpenTask?: (zadanie: Zadanie) => void;
}> = ({
  spotkanie,
  typ,
  place,
  language,
  locale,
  highlighted,
  busy,
  onEdit,
  onClone,
  onDelete,
  onAckTermin,
  onTerminStatus,
  onMaterialy,
  zebranie,
  onPrzygotuj,
  onOpenZebranie,
  onZawiadomienie,
  zadania,
  users,
  onAddTask,
  onPreviewTask,
  onEditTask,
  onDeleteTask,
  onOpenTask,
}) => {
  const t = translations[language];
  const when = spotkanieWhen(spotkanie);
  const color = normalizeHexColor(typ?.kolor ?? DEFAULT_TYP_COLOR);
  const changed = hasUnreadTerminChange(spotkanie);
  const tentative = isTerminWstepny(spotkanie);
  const materialyMark: Record<SpotkanieMaterialyKrok, string> = {
    do_przygotowania: t.kalMatMarkDo,
    przygotowane: t.kalMatMarkPrzygotowane,
    wyslane: t.kalMatMarkWyslane,
  };
  const materialyBy = (email: string): string => {
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    return user ? personLabel(user) : email;
  };
  const zebranieWersja = zebranie?.wersja ?? null;
  // "Przygotowane" (and "Wysłane", which implies it) only once every document of
  // the newest version is marked ready in Zebrania — these are what is not yet.
  const notReady = ZEBRANIE_DOKUMENTY.filter((d) => zebranieWersja?.gotowe[d] !== true).map((d) =>
    dokumentLabel(t, d),
  );
  // "Przygotuj materiały" only once the meeting says its materials are to be
  // prepared, and only while it has no entry yet — after that the button is
  // "Otwórz w Zebraniach": one meeting, one entry.
  const canPrzygotuj = !zebranie && !!onPrzygotuj && spotkanie.materialyStatus === 'do_przygotowania';
  // Same rule as the Zebrania list: the entry opens only once work on the
  // materials has started ("Przygotuj" or later).
  const openBlocked = spotkanie.materialyStatus === 'brak' || spotkanie.materialyStatus === 'potrzebne';
  // In the materials section, the way into Zebrania and the notice: a tile each — a coloured icon, what
  // it opens and a line on what is there — so the two read apart at a glance.
  const zebAction = (
    tone: 'accent' | 'info',
    icon: IconName,
    label: string,
    sub: string,
    onClick: () => void,
    title?: string,
    blocked = false,
  ) => (
    <button
      type="button"
      className={`kal-action kal-action--${tone}`}
      onClick={onClick}
      disabled={busy || blocked}
      data-tip={title}
    >
      <span className="kal-action__icon">
        <Icon name={icon} size={15} />
      </span>
      <span className="kal-action__text">
        <span className="kal-action__label">{label}</span>
        <span className="kal-action__sub">{sub}</span>
      </span>
      <Icon name="chevron-right" size={14} className="kal-action__chevron" />
    </button>
  );

  const materialyStep = SPOTKANIE_MATERIALY_KROKI.indexOf(
    spotkanie.materialyStatus as SpotkanieMaterialyKrok,
  );
  const materialyPrev = SPOTKANIE_MATERIALY_POPRZEDNI[spotkanie.materialyStatus];

  return (
    <article
      className={
        `kal-card kal-card--${when}` +
        (highlighted ? ' is-highlight' : '') +
        (changed ? ' is-changed' : '') +
        (tentative ? ' is-tentative' : '')
      }
      style={{ ['--chip' as string]: color }}
    >
      {/* When, and the three things done to a meeting — always in view, as
          icons in the corner (each says what it does on hover). */}
      <div className="kal-card__head">
        <span className="kal-card__time">
          <Icon name="clock" size={14} /> {formatTimeRange(spotkanie, locale)}
        </span>
        {when === 'now' && <span className="status-badge kal-badge kal-badge--now">{t.kalNow}</span>}
        {when === 'today' && (
          <span className="status-badge kal-badge kal-badge--today">{t.kalTodayBadge}</span>
        )}
        {when === 'past' && (
          <span className="status-badge kal-badge kal-badge--past">{t.kalPast}</span>
        )}
        <div className="kal-card__tools">
          <button
            type="button"
            className="button button-ghost button-icon"
            onClick={onEdit}
            disabled={busy}
            data-tip={t.edit}
            aria-label={`${t.edit}: ${spotkanie.nazwa}`}
          >
            <Icon name="edit" size={15} />
          </button>
          <button
            type="button"
            className="button button-ghost button-icon"
            onClick={onClone}
            disabled={busy}
            data-tip={t.kalCloneHint}
            aria-label={`${t.kalClone}: ${spotkanie.nazwa}`}
          >
            <Icon name="copy" size={15} />
          </button>
          <button
            type="button"
            className="button button-ghost button-icon icon-danger"
            onClick={onDelete}
            disabled={busy}
            data-tip={t.delete}
            aria-label={`${t.delete}: ${spotkanie.nazwa}`}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      <h4 className="kal-card__name">{spotkanie.nazwa}</h4>
      <span className="kal-chip kal-card__type" style={{ ['--chip' as string]: color }}>
        <span className="kal-chip__dot" />
        <span className="kal-chip__name">{typ ? typ.nazwa : t.kalNoType}</span>
      </span>

      {/* The moved date, said out loud. Everyone wrote the old one down, so this
          outranks everything else on the card until somebody acknowledges it. */}
      {changed && (
        <div className="kal-alert kal-alert--changed">
          <Icon name="alert-triangle" size={15} />
          <div className="kal-alert__body">
            <strong>{t.kalTerminChangedTitle}</strong>
            <span>
              {spotkanie.terminZmienionyZ
                ? t.kalTerminChangedFrom.replace(
                    '{from}',
                    formatStamp(spotkanie.terminZmienionyZ, locale),
                  )
                : t.kalTerminChangedNoPrevious}
              {spotkanie.terminZmienionyBy
                ? ` ${t.kalTerminChangedBy.replace('{who}', spotkanie.terminZmienionyBy)}`
                : ''}
            </span>
          </div>
          <button
            type="button"
            className="button button-small button-warning"
            onClick={onAckTermin}
            disabled={busy}
          >
            <Icon name="check" size={13} /> {t.kalTerminAck}
          </button>
        </div>
      )}

      {/* A tentative date is a state with one way out, so the strip carries it. */}
      {tentative && (
        <div className="kal-alert kal-alert--tentative">
          <Icon name="clock" size={15} />
          <div className="kal-alert__body">
            <strong>{t.kalTerminTentative}</strong>
            <span>{t.kalTerminUnconfirmHint}</span>
          </div>
          <button
            type="button"
            className="button button-small button-info"
            onClick={() => onTerminStatus('potwierdzony')}
            disabled={busy}
            data-tip={t.kalTerminConfirmHint}
          >
            <Icon name="check-circle" size={13} /> {t.kalTerminConfirm}
          </button>
        </div>
      )}

      {/* Every fact under a label, one per line — read without guessing what an
          icon stands for. */}
      <section className="kal-section">
        <div className="kal-section__head">
          <span className="kal-section__title">
            <Icon name="info" size={13} /> {t.kalSectionDetails}
          </span>
          {!tentative && (
            <div className="kal-section__actions">
              <button
                type="button"
                className="button button-small button-subtle"
                onClick={() => onTerminStatus('wstepny')}
                disabled={busy}
                data-tip={t.kalTerminUnconfirmHint}
              >
                <Icon name="clock" size={13} /> {t.kalTerminUnconfirm}
              </button>
            </div>
          )}
        </div>
        <dl className="kal-details">
          {spotkanie.adresNazwa && (
            <>
              <dt>{t.kalDetAdres}</dt>
              <dd>{spotkanie.adresNazwa}</dd>
            </>
          )}
          {place && (
            <>
              <dt>{t.kalDetPlace}</dt>
              <dd>{place}</dd>
            </>
          )}
          {spotkanie.zgnNazwa && (
            <>
              <dt>{t.kalDetZgn}</dt>
              <dd>{spotkanie.zgnNazwa}</dd>
            </>
          )}
        </dl>
        {spotkanie.opis && <p className="kal-card__desc">{spotkanie.opis}</p>}
      </section>

      {/* Who comes: the office's people and the community's board, each under
          its own label rather than told apart by an icon. */}
      {(spotkanie.uczestnicy.length > 0 || spotkanie.zarzad.length > 0) && (
        <section className="kal-section">
          <div className="kal-section__head">
            <span className="kal-section__title">
              <Icon name="users" size={13} /> {t.kalSectionPeople}
            </span>
          </div>
          {spotkanie.uczestnicy.length > 0 && (
            <div className="kal-card__group">
              <span className="kal-card__label">{t.kalPeopleOffice}</span>
              <div className="kal-people">
                {spotkanie.uczestnicy.map((person) => (
                  <span key={person.userId} className="kal-person kal-person--static" data-tip={person.email}>
                    <Icon name="users" size={12} />
                    <span className="kal-person__label">{personLabel(person)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {spotkanie.zarzad.length > 0 && (
            <div className="kal-card__group">
              <span className="kal-card__label">{t.kalFieldZarzad}</span>
              <div className="kal-people">
                {spotkanie.zarzad.map((m) => (
                  <span
                    key={`z-${m.imieNazwisko}`}
                    className="kal-person kal-person--static kal-person--board"
                    data-tip={m.email ?? undefined}
                  >
                    <Icon name="home" size={12} />
                    <span className="kal-person__label">{m.imieNazwisko}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Materials: where they stand as a badge, the three steps as a stepper —
          each step is one click and is announced to everyone (Ustawienia →
          Powiadomienia). Absent when the meeting needs none. */}
      {spotkanie.materialyStatus !== 'brak' && (
        <section className="kal-section">
          <div className="kal-section__head">
            <span className="kal-section__title">
              <Icon name="briefcase" size={13} /> {t.kalMaterialsLabel}
            </span>
            <span className={`status-badge kal-section__badge ${MATERIALY_TONE[spotkanie.materialyStatus]}`}>
              {materialyStepLabel(t, spotkanie.materialyStatus)}
            </span>
            {materialyPrev && (
              <div className="kal-section__actions">
                <button
                  type="button"
                  className="button button-small button-subtle"
                  onClick={() => onMaterialy(materialyPrev)}
                  disabled={busy}
                  data-tip={t.kalMatUndoHint.replace('{step}', materialyStatusLabel(t, materialyPrev))}
                >
                  <Icon name="undo" size={13} /> {t.kalMatUndo}
                </button>
              </div>
            )}
          </div>
          <ol className="kal-steps">
            {SPOTKANIE_MATERIALY_KROKI.map((krok, i) => {
              const done = i < materialyStep;
              const current = i === materialyStep;
              const blocked =
                !current && !done && (krok === 'przygotowane' || krok === 'wyslane') && notReady.length > 0;
              const button = (
                <button
                  type="button"
                  className={`kal-step${done ? ' is-done' : ''}${current ? ' is-current' : ''}`}
                  onClick={() => onMaterialy(krok)}
                  disabled={busy || current || blocked}
                  aria-pressed={current}
                  data-tip={current || blocked ? undefined : materialyMark[krok]}
                >
                  <span className="kal-step__dot">
                    {done || current ? <Icon name="check" size={11} /> : i + 1}
                  </span>
                  <span className="kal-step__label">{materialyStepLabel(t, krok)}</span>
                </button>
              );
              return (
                <li key={krok}>
                  {blocked ? (
                    <Tip
                      className="kal-step-tip"
                      ariaLabel={`${t.kalMatNotReadyTitle}: ${notReady.join(', ')}`}
                      content={
                        <>
                          <div className="tip__title">{t.kalMatNotReadyTitle}</div>
                          <ul className="tip__list">
                            {notReady.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                          <div className="tip__note">{t.kalMatNotReadyHint}</div>
                        </>
                      }
                    >
                      {button}
                    </Tip>
                  ) : (
                    button
                  )}
                </li>
              );
            })}
          </ol>
          {spotkanie.materialyZmienioneAt && spotkanie.materialyZmienioneBy && (
            <span className="kal-section__stamp">
              {t.kalMaterialsChangedBy
                .replace('{who}', materialyBy(spotkanie.materialyZmienioneBy))
                .replace('{when}', formatStamp(spotkanie.materialyZmienioneAt, locale))}
            </span>
          )}
          {/* Where the materials themselves are made: the meeting's entry in
              Zebrania (its newest version and that version's state — the same
              state as above, kept in step by the main process) and the notice. */}
          {(zebranie || canPrzygotuj || onZawiadomienie) && (
            <div className="kal-zeb">
              <div className="kal-zeb__actions">
                {zebranie &&
                  onOpenZebranie &&
                  (openBlocked ? (
                    <Tip
                      className="kal-action-tip"
                      ariaLabel={`${t.zebraniaNoMaterials}: ${t.kalOpenNotStartedHint}`}
                      content={
                        <>
                          <div className="tip__title">{t.zebraniaNoMaterials}</div>
                          <div>{t.kalOpenNotStartedHint}</div>
                        </>
                      }
                    >
                      {zebAction('accent', 'folder', t.zebraniaKalOpen, t.zebraniaKalOpenSub, onOpenZebranie, undefined, true)}
                    </Tip>
                  ) : (
                    zebAction('accent', 'folder', t.zebraniaKalOpen, t.zebraniaKalOpenSub, onOpenZebranie)
                  ))}
                {canPrzygotuj &&
                  onPrzygotuj &&
                  zebAction(
                    'accent',
                    'briefcase',
                    t.zebraniaKalPrepare,
                    t.zebraniaKalPrepareSub,
                    onPrzygotuj,
                    t.zebraniaKalPrepareHint,
                  )}
                {onZawiadomienie &&
                  (notReady.length > 0 ? (
                    <Tip
                      className="kal-action-tip"
                      ariaLabel={`${t.kalNoticeNotReadyTitle}: ${notReady.join(', ')}`}
                      content={
                        <>
                          <div className="tip__title">{t.kalNoticeNotReadyTitle}</div>
                          <ul className="tip__list">
                            {notReady.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                          <div className="tip__note">{t.kalMatNotReadyHint}</div>
                        </>
                      }
                    >
                      {zebAction('info', 'mail', t.zebraniaKalNotice, t.zebraniaKalNoticeSub, onZawiadomienie, undefined, true)}
                    </Tip>
                  ) : (
                    zebAction(
                      'info',
                      'mail',
                      t.zebraniaKalNotice,
                      t.zebraniaKalNoticeSub,
                      onZawiadomienie,
                      t.zebraniaKalNoticeHint,
                    )
                  ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tasks last: follow-ups to the meeting, not facts about it. */}
      <section className="kal-section">
        <SpotkanieZadania
          zadania={zadania}
          users={users}
          language={language}
          disabled={busy}
          onAdd={onAddTask}
          onPreview={onPreviewTask}
          onEdit={onEditTask}
          onDelete={onDeleteTask}
          onOpenBoard={onOpenTask}
        />
      </section>
    </article>
  );
};
