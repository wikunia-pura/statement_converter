import React, { useEffect, useMemo, useState } from 'react';
import {
  Adres,
  AppUser,
  MailingHistoryEntry,
  Spotkanie,
  SpotkanieInput,
  SpotkanieLokalizacja,
  SpotkanieMailing,
  SpotkanieTerminStatus,
  SpotkanieTyp,
  SpotkanieUczestnik,
} from '../../shared/types';
import { comparePeople, personLabel, personName } from '../../shared/app-users';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import Select from '../components/Select';
import SearchableSelect from '../components/SearchableSelect';
import ModalDismiss from '../components/Modal';
import MailingDetailsModal from '../components/MailingDetailsModal';
import MonthIllustration, { monthAccent } from '../components/MonthIllustration';
import {
  buildMonthGrid,
  currentMonthKey,
  formatDayLabel,
  formatStamp,
  formatTime,
  formatTimeRange,
  groupByDay,
  countAlerts,
  daysToDokumentyDeadline,
  hasAnyAlert,
  hasDokumentyOut,
  hasUnreadTerminChange,
  isDokumentyOverdue,
  isTerminWstepny,
  sentByMailingIds,
  SpotkaniaDocsContext,
  lokalizacjaLabel,
  matchesSpotkanieSearch,
  matchesStateFilter,
  matchesTypFilter,
  SpotkaniaAlerts,
  SpotkanieStateFilter,
  monthLabel,
  monthOfDayKey,
  monthsWithSpotkania,
  normalizeHexColor,
  partsToIso,
  shiftMonthKey,
  shiftTime,
  sortSpotkania,
  spotkaniaInMonth,
  suggestSpotkanieTitle,
  spotkanieWhen,
  toDayKey,
  toParts,
  todayKey,
  weekdayLabels,
  typOf,
  upcomingSpotkania,
  DEFAULT_TYP_COLOR,
} from '../../shared/calendar';

interface Props {
  language: Language;
  /** Month being viewed (`YYYY-MM`); lifted so switching views keeps the place. */
  monthKey: string;
  setMonthKey: (key: string) => void;
  /** E-mail of the signed-in user — offered first in the participant picker. */
  userEmail?: string;
  /**
   * The state filter, lifted so the dashboard can send the user here with one
   * already on — that is the whole point of its tiles.
   */
  stateFilter: SpotkanieStateFilter;
  setStateFilter: (filter: SpotkanieStateFilter) => void;
  /** Jump to the module's "Typy spotkań" tab. */
  onManageTypes?: () => void;
  /** Jump to the module's "Lokalizacje" tab. */
  onManagePlaces?: () => void;
  /**
   * Hand a meeting over to the Mailing module. Deliberately not the mailing
   * draft itself: the calendar knows which meeting and which community, and
   * nothing about how a mailing is composed.
   */
  onSendDocuments?: (context: {
    spotkanieId: number;
    spotkanieNazwa: string;
    adresIds: number[];
  }) => void;
}

/**
 * The four things that can be wrong with a meeting, in the order they matter.
 *
 * One table rather than four copies of the same button: they are the same
 * control four times over, and the dashboard renders the same four from the
 * same shared counts.
 */
const ALERT_KINDS: {
  filter: SpotkanieStateFilter;
  count: (alerts: SpotkaniaAlerts) => number;
  tone: 'changed' | 'tentative' | 'nodocs' | 'overdue';
  icon: React.ComponentProps<typeof Icon>['name'];
  label: 'kalWarnOverdue' | 'kalWarnChanged' | 'kalWarnTentative' | 'kalWarnNoDocs';
}[] = [
  {
    filter: 'overdue',
    count: (a) => a.overdue,
    tone: 'overdue',
    icon: 'alert-circle',
    label: 'kalWarnOverdue',
  },
  {
    filter: 'changed',
    count: (a) => a.changed,
    tone: 'changed',
    icon: 'alert-triangle',
    label: 'kalWarnChanged',
  },
  {
    filter: 'nodocs',
    count: (a) => a.noDocs,
    tone: 'nodocs',
    icon: 'mail',
    label: 'kalWarnNoDocs',
  },
  {
    filter: 'tentative',
    count: (a) => a.tentative,
    tone: 'tentative',
    icon: 'clock',
    label: 'kalWarnTentative',
  },
];

/** How many meetings a day cell shows before collapsing into "+N". */
const CHIPS_PER_CELL = 3;

/** Default start for a meeting created by clicking an empty day. */
const DEFAULT_START = '10:00';

/** Hover card geometry — kept in step with `.kal-tip` in the stylesheet. */
const TIP_WIDTH = 300;
const TIP_MARGIN = 8;

/** An open hover card: which meeting, and the viewport edges it hangs off. */
interface TipState {
  spotkanie: Spotkanie;
  left: number;
  top?: number;
  bottom?: number;
}

/* ============================ The add/edit form ============================ */

interface FormProps {
  language: Language;
  /** Meeting being edited, or null when adding a new one. */
  editing: Spotkanie | null;
  /** Day the form opens on (`YYYY-MM-DD`) — the cell the user clicked. */
  defaultDay: string;
  typy: SpotkanieTyp[];
  lokalizacje: SpotkanieLokalizacja[];
  adresy: Adres[];
  users: AppUser[];
  userEmail?: string;
  isSaving: boolean;
  error: string | null;
  onSubmit: (input: SpotkanieInput) => void;
  onCancel: () => void;
  onManageTypes?: () => void;
  onManagePlaces?: () => void;
}

const SpotkanieFormModal: React.FC<FormProps> = ({
  language,
  editing,
  defaultDay,
  typy,
  lokalizacje,
  adresy,
  users,
  userEmail,
  isSaving,
  error,
  onSubmit,
  onCancel,
  onManageTypes,
  onManagePlaces,
}) => {
  const t = translations[language];
  const startParts = toParts(editing?.startsAt ?? null);
  const endParts = toParts(editing?.endsAt ?? null);

  const [typId, setTypId] = useState(editing?.typId != null ? String(editing.typId) : '');
  const [adresId, setAdresId] = useState(editing?.adresId != null ? String(editing.adresId) : '');
  const [nazwa, setNazwa] = useState(editing?.nazwa ?? '');
  /**
   * Whether the title has been written by hand and must stop following the two
   * pickers. An existing meeting counts as hand-written only when its name is
   * not what its own type and community would have produced — so a generated
   * name keeps tracking a type change, and a name someone chose is never
   * silently overwritten.
   */
  const [nameEdited, setNameEdited] = useState(
    editing
      ? editing.nazwa.trim() !==
        suggestSpotkanieTitle(
          typy.find((typ) => typ.id === editing.typId)?.nazwa ?? null,
          editing.adresNazwa,
        )
      : false,
  );
  const [date, setDate] = useState(startParts.date || defaultDay);
  const [timeFrom, setTimeFrom] = useState(startParts.time || DEFAULT_START);
  // A new meeting gets a one-hour default; an existing one with no end keeps
  // none, so editing it doesn't invent an end time nobody asked for.
  const [timeTo, setTimeTo] = useState(
    editing ? endParts.time : shiftTime(DEFAULT_START, 60),
  );
  const [opis, setOpis] = useState(editing?.opis ?? '');
  const [lokalizacjaId, setLokalizacjaId] = useState(
    editing?.lokalizacjaId != null ? String(editing.lokalizacjaId) : '',
  );
  /**
   * Confirmed or still being agreed. A new meeting starts confirmed — that is
   * what most of them are, and calling every fresh entry tentative would make
   * the mark meaningless by the end of the first week.
   */
  const [terminStatus, setTerminStatus] = useState<SpotkanieTerminStatus>(
    editing?.terminStatus ?? 'potwierdzony',
  );
  const [uczestnicy, setUczestnicy] = useState<SpotkanieUczestnik[]>(editing?.uczestnicy ?? []);
  const [localError, setLocalError] = useState<string | null>(null);

  const chosen = new Set(uczestnicy.map((u) => u.userId));
  // Offered by name, in name order — the dropdown is read down, and mailbox
  // order stops making sense the moment the labels are people's names.
  const available = users.filter((u) => !chosen.has(u.id)).sort(comparePeople);

  const typNazwa = (id: string): string | null =>
    typy.find((typ) => String(typ.id) === id)?.nazwa ?? null;
  const adresNazwa = (id: string): string | null =>
    adresy.find((a) => String(a.id) === id)?.nazwa ?? null;

  /** The title the current pair of pickers would write. */
  const suggestion = suggestSpotkanieTitle(typNazwa(typId), adresNazwa(adresId));

  /**
   * Answering a picker rewrites the title, unless the user has taken it over.
   * Both pickers go through here so neither can drift out of step with it.
   */
  const applyPickers = (nextTypId: string, nextAdresId: string) => {
    setTypId(nextTypId);
    setAdresId(nextAdresId);
    if (nameEdited) return;
    setNazwa(suggestSpotkanieTitle(typNazwa(nextTypId), adresNazwa(nextAdresId)));
    if (localError) setLocalError(null);
  };

  /** Hand the title back to the pickers after a manual edit. */
  const restoreSuggestedTitle = () => {
    setNazwa(suggestion);
    setNameEdited(false);
    if (localError) setLocalError(null);
  };

  /**
   * Add every account that isn't on the list yet. Appends rather than replaces:
   * an existing meeting can carry a participant whose account has since been
   * removed, and "add everyone" must not be the thing that drops them.
   */
  const addAllParticipants = () => {
    setUczestnicy((prev) => [
      ...prev,
      ...users
        .filter((u) => !prev.some((p) => p.userId === u.id))
        .map((u) => ({ userId: u.id, email: u.email, displayName: personName(u) })),
    ]);
  };

  /** Keep the end after the start when the start moves past it. */
  const handleStartChange = (value: string) => {
    setTimeFrom(value);
    if (timeTo && timeTo <= value) setTimeTo(shiftTime(value, 60));
    if (localError) setLocalError(null);
  };

  const addParticipant = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user || chosen.has(user.id)) return;
    setUczestnicy((prev) => [
      ...prev,
      { userId: user.id, email: user.email, displayName: personName(user) },
    ]);
  };

  const handleSubmit = () => {
    const name = nazwa.trim();
    if (!name) {
      setLocalError(t.kalNameRequired);
      return;
    }
    const startsAt = partsToIso(date, timeFrom);
    if (!startsAt) {
      setLocalError(t.kalDateRequired);
      return;
    }
    const endsAt = timeTo ? partsToIso(date, timeTo) : null;
    if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      setLocalError(t.kalEndBeforeStart);
      return;
    }
    const adres = adresy.find((a) => String(a.id) === adresId) ?? null;
    const lokalizacja = lokalizacje.find((l) => String(l.id) === lokalizacjaId) ?? null;
    onSubmit({
      nazwa: name,
      typId: typId ? Number(typId) : null,
      adresId: adres ? adres.id : null,
      // The name travels with the meeting: a restore renumbers the addresses,
      // and this is what the link is re-pointed through afterwards.
      adresNazwa: adres ? adres.nazwa : '',
      lokalizacjaId: lokalizacja ? lokalizacja.id : null,
      lokalizacjaNazwa: lokalizacja ? lokalizacja.nazwa : '',
      startsAt,
      endsAt,
      opis: opis.trim(),
      uczestnicy,
      terminStatus,
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <ModalDismiss onClose={onCancel} ariaLabel={t.close} />
        <div className="modal-header">{editing ? t.kalEditMeeting : t.kalNewMeeting}</div>
        <div className="modal-body">
          {/* The two decisions the user actually makes, first — the title below
              is written from them. */}
          <div className="kal-form-row kal-form-row--two">
            <div className="form-group">
              <label>{t.kalFieldType}</label>
              <Select
                value={typId}
                options={[
                  { value: '', label: t.kalNoType },
                  ...typy.map((typ) => ({ value: String(typ.id), label: typ.nazwa })),
                ]}
                onChange={(value) => applyPickers(value, adresId)}
                placeholder={t.kalNoType}
                ariaLabel={t.kalFieldType}
              />
              {typy.length === 0 && (
                <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '6px' }}>
                  {t.kalNoTypesYet}{' '}
                  {onManageTypes && (
                    <button type="button" className="link-button" onClick={onManageTypes}>
                      {t.kalTypyTitle}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="form-group">
              <label>{t.kalFieldAdres}</label>
              <SearchableSelect
                value={adresId}
                options={[
                  { value: '', label: t.kalNoAdres },
                  ...adresy.map((a) => ({ value: String(a.id), label: a.nazwa })),
                ]}
                onChange={(value) => applyPickers(typId, value)}
                placeholder={t.kalNoAdres}
                searchPlaceholder={t.searchAdres}
                emptyText={t.kalNoResults}
                ariaLabel={t.kalFieldAdres}
              />
            </div>
          </div>

          <div className="form-group">
            <div className="kal-label-row">
              <label>
                {t.kalFieldName} <span style={{ color: 'red' }}>*</span>
              </label>
              {/* Only offered once it would actually change something — after a
                  manual edit, with a suggestion available to go back to. */}
              {nameEdited && suggestion && suggestion !== nazwa.trim() && (
                <button type="button" className="link-button" onClick={restoreSuggestedTitle}>
                  {t.kalTitleRestore}
                </button>
              )}
            </div>
            <input
              type="text"
              value={nazwa}
              onChange={(e) => {
                setNazwa(e.target.value);
                setNameEdited(true);
                if (localError) setLocalError(null);
              }}
              placeholder={suggestion || t.kalFieldNamePlaceholder}
            />
            <div style={{ fontSize: '11px', opacity: 0.65, marginTop: '4px' }}>
              {nameEdited ? t.kalFieldNameHintEdited : t.kalFieldNameHint}
            </div>
          </div>

          {/* When. */}
          <div className="kal-form-row">
            <div className="form-group">
              <label>
                {t.kalFieldDate} <span style={{ color: 'red' }}>*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (localError) setLocalError(null);
                }}
              />
            </div>
            <div className="form-group">
              <label>
                {t.kalFieldTimeFrom} <span style={{ color: 'red' }}>*</span>
              </label>
              <input
                type="time"
                value={timeFrom}
                onChange={(e) => handleStartChange(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>{t.kalFieldTimeTo}</label>
              <input
                type="time"
                value={timeTo}
                onChange={(e) => {
                  setTimeTo(e.target.value);
                  if (localError) setLocalError(null);
                }}
              />
              <div style={{ fontSize: '11px', opacity: 0.65, marginTop: '4px' }}>
                {t.kalFieldTimeToHint}
              </div>
            </div>
          </div>

          {/* Is that date settled? Two radios rather than a checkbox: "wstępny"
              is a real state somebody chose, not the absence of a tick. */}
          <div className="form-group">
            <label>{t.kalFieldTermin}</label>
            <div className="kal-termin-choice">
              {(['potwierdzony', 'wstepny'] as SpotkanieTerminStatus[]).map((value) => (
                <label
                  key={value}
                  className={`kal-termin-option${terminStatus === value ? ' is-active' : ''}`}
                >
                  <input
                    type="radio"
                    name="kal-termin-status"
                    value={value}
                    checked={terminStatus === value}
                    onChange={() => setTerminStatus(value)}
                  />
                  <Icon name={value === 'potwierdzony' ? 'check-circle' : 'clock'} size={14} />
                  <span>{value === 'potwierdzony' ? t.kalTerminConfirmed : t.kalTerminTentative}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize: '11px', opacity: 0.65, marginTop: '4px' }}>
              {t.kalFieldTerminHint}
            </div>
          </div>

          {/* Where. Picked from the dictionary, never typed — three spellings of
              one address is exactly what the dictionary exists to prevent. */}
          <div className="form-group">
            <div className="kal-label-row">
              <label>{t.kalFieldPlace}</label>
              {onManagePlaces && (
                <button type="button" className="link-button" onClick={onManagePlaces}>
                  {t.kalManagePlaces}
                </button>
              )}
            </div>
            {lokalizacje.length === 0 ? (
              <div style={{ fontSize: '12px', opacity: 0.7 }}>{t.kalNoPlaces}</div>
            ) : (
              <SearchableSelect
                value={lokalizacjaId}
                options={[
                  { value: '', label: t.kalNoPlaceOption },
                  ...lokalizacje.map((lok) => ({
                    value: String(lok.id),
                    label: lok.nazwa,
                    hint: lok.adres || undefined,
                    keywords: `${lok.nazwa} ${lok.adres} ${lok.opis}`,
                  })),
                ]}
                onChange={setLokalizacjaId}
                placeholder={t.kalPlacePlaceholder}
                searchPlaceholder={t.kalPlaceSearch}
                emptyText={t.kalPlaceNoMatch}
                ariaLabel={t.kalFieldPlace}
              />
            )}
          </div>

          <div className="form-group">
            <div className="kal-label-row">
              <label>{t.kalFieldParticipants}</label>
              {users.length > 0 && (
                <div className="kal-bulk">
                  {/* "Everyone" is one of the two common answers here — a
                      committee meeting is for the whole office — so it is a
                      button, not fifteen picks from the dropdown. */}
                  <button
                    type="button"
                    className="link-button"
                    onClick={addAllParticipants}
                    disabled={available.length === 0}
                  >
                    {t.kalParticipantsAddAll.replace('{count}', String(users.length))}
                  </button>
                  {uczestnicy.length > 0 && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setUczestnicy([])}
                    >
                      {t.kalParticipantsClear}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
              {t.kalFieldParticipantsHint}
            </div>
            {users.length === 0 ? (
              <div style={{ fontSize: '12px', opacity: 0.7 }}>{t.kalNoAccounts}</div>
            ) : (
              <SearchableSelect
                // A permanently empty value turns the dropdown into an action
                // picker: the trigger keeps its placeholder, each pick adds a
                // person below instead of replacing a selection.
                value=""
                options={available.map((u) => ({
                  value: u.id,
                  // Pick people by name; the mailbox drops to the hint line and
                  // stays searchable, so it is still there when two people
                  // share a first name — or when nobody has named them yet.
                  label: personLabel(u),
                  hint: personName(u) ? u.email : undefined,
                  // Searchable by name, by mailbox, and by whatever name the
                  // account itself carries — someone may still look for the
                  // label they saw before anyone was named here.
                  keywords: `${u.email} ${personName(u) ?? ''} ${u.displayName ?? ''}${
                    u.email === userEmail ? ' ja me' : ''
                  }`,
                }))}
                onChange={addParticipant}
                placeholder={
                  available.length === 0 ? t.kalParticipantsAllAdded : t.kalParticipantsAdd
                }
                searchPlaceholder={t.kalParticipantsSearch}
                emptyText={t.kalParticipantsNoMatch}
                disabled={available.length === 0}
                ariaLabel={t.kalParticipantsAdd}
              />
            )}
            {uczestnicy.length > 0 && (
              <div className="kal-people">
                {uczestnicy.map((person) => (
                  <span key={person.userId} className="kal-person">
                    <Icon name="users" size={12} />
                    <span className="kal-person__label">
                      {personLabel(person)}
                      {person.email === userEmail && (
                        <em className="kal-person__you"> ({t.kalYou})</em>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setUczestnicy((prev) => prev.filter((p) => p.userId !== person.userId))
                      }
                      title={t.kalParticipantRemove}
                      aria-label={t.kalParticipantRemove}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>{t.kalFieldDesc}</label>
            <textarea
              value={opis}
              onChange={(e) => setOpis(e.target.value)}
              placeholder={t.kalFieldDescPlaceholder}
              rows={3}
            />
          </div>

          {(localError || error) && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>
              {localError || error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="button button-secondary" onClick={onCancel} disabled={isSaving}>
            <Icon name="x" size={14} /> {t.cancel}
          </button>
          <button
            className="button button-success"
            onClick={handleSubmit}
            disabled={isSaving || !nazwa.trim()}
          >
            <Icon name="save" size={14} /> {editing ? t.update : t.add}
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================== One meeting, expanded ========================== */

const MeetingCard: React.FC<{
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
  onDelete: () => void;
  /** "I have seen that the date moved." */
  onAckTermin: () => void;
  /** Settle a tentative date, or put a settled one back to tentative. */
  onTerminStatus: (status: SpotkanieTerminStatus) => void;
  /** Tick or untick "documents sent", with a note of what went out. */
  onDokumenty: (sent: boolean, opis: string) => void;
  /** Hand this meeting to the Mailing module. Absent when it has no community. */
  onSendMailing?: () => void;
  /** Open one recorded send in the mailing-details window. */
  onOpenMailing: (mailing: SpotkanieMailing) => void;
  /** Which meetings a mailing went out for, plus the types that carry deadlines. */
  docsCtx: SpotkaniaDocsContext;
}> = ({
  spotkanie,
  typ,
  place,
  mailings,
  language,
  locale,
  highlighted,
  busy,
  onEdit,
  onDelete,
  onAckTermin,
  onTerminStatus,
  onDokumenty,
  onSendMailing,
  onOpenMailing,
  docsCtx,
}) => {
  const t = translations[language];
  const when = spotkanieWhen(spotkanie);
  const color = normalizeHexColor(typ?.kolor ?? DEFAULT_TYP_COLOR);
  const changed = hasUnreadTerminChange(spotkanie);
  const tentative = isTerminWstepny(spotkanie);
  // Either path counts as sent: the manual tick, or a mailing that went out.
  const sent = hasDokumentyOut(spotkanie, docsCtx);
  const overdue = isDokumentyOverdue(spotkanie, docsCtx);
  const daysLeft = daysToDokumentyDeadline(spotkanie, docsCtx);
  // Open only while the user is writing the note; a card is a summary, and this
  // is the one thing on it that takes typing.
  const [editingDocs, setEditingDocs] = useState(false);
  const [docsOpis, setDocsOpis] = useState(spotkanie.dokumentyOpis);

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
      <div className="kal-card__head">
        <span className="kal-card__time">
          <Icon name="clock" size={13} /> {formatTimeRange(spotkanie, locale)}
        </span>
        {tentative && (
          <span className="status-badge kal-badge kal-badge--tentative">
            <Icon name="clock" size={11} /> {t.kalTerminTentative}
          </span>
        )}
        {when === 'now' && <span className="status-badge kal-badge kal-badge--now">{t.kalNow}</span>}
        {when === 'today' && (
          <span className="status-badge kal-badge kal-badge--today">{t.kalTodayBadge}</span>
        )}
        {when === 'past' && (
          <span className="status-badge kal-badge kal-badge--past">{t.kalPast}</span>
        )}
      </div>

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

      <h4 className="kal-card__name">{spotkanie.nazwa}</h4>

      <div className="kal-card__meta">
        <span className="kal-chip" style={{ ['--chip' as string]: color }}>
          <span className="kal-chip__dot" />
          <span className="kal-chip__name">{typ ? typ.nazwa : t.kalNoType}</span>
        </span>
        {spotkanie.adresNazwa && (
          <span className="kal-card__adres">
            <Icon name="building" size={13} /> {spotkanie.adresNazwa}
          </span>
        )}
        {place && (
          <span className="kal-place">
            <Icon name="map-pin" size={13} /> {place}
          </span>
        )}
      </div>

      {spotkanie.opis && <p className="kal-card__desc">{spotkanie.opis}</p>}

      {spotkanie.uczestnicy.length > 0 && (
        <div className="kal-people">
          {spotkanie.uczestnicy.map((person) => (
            <span key={person.userId} className="kal-person kal-person--static" title={person.email}>
              <Icon name="users" size={12} />
              <span className="kal-person__label">{personLabel(person)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="kal-card__foot">
        {spotkanie.createdBy && (
          <span className="kal-card__author">
            {t.kalCreatedBy.replace('{who}', spotkanie.createdBy)}
          </span>
        )}
        <div className="kal-card__actions">
          {tentative ? (
            <button
              className="button button-small button-warning"
              onClick={() => onTerminStatus('potwierdzony')}
              disabled={busy}
              title={t.kalTerminConfirmHint}
            >
              <Icon name="check-circle" size={13} /> {t.kalTerminConfirm}
            </button>
          ) : (
            <button
              className="button button-small button-info"
              onClick={() => onTerminStatus('wstepny')}
              disabled={busy}
              title={t.kalTerminUnconfirmHint}
            >
              <Icon name="clock" size={13} /> {t.kalTerminUnconfirm}
            </button>
          )}
          <button className="button button-small button-primary" onClick={onEdit} disabled={busy}>
            <Icon name="edit" size={13} /> {t.edit}
          </button>
          <button className="button button-small button-danger" onClick={onDelete} disabled={busy}>
            <Icon name="trash" size={13} /> {t.delete}
          </button>
        </div>
      </div>

      {/* Paperwork, last on the card and walled off from it: it is the one part
          that is about what happened AFTER the meeting was arranged, and the one
          part with its own controls. Two ways in, one question answered — did it
          go out? */}
      <div className={`kal-docs${overdue ? ' is-overdue' : ''}`}>
        <div className="kal-docs__head">
          <span className={`kal-docs__state${sent ? ' is-sent' : ''}`}>
            <Icon name={sent ? 'file-check' : 'file-text'} size={14} />
            {sent ? t.kalDocsSent : t.kalDocsNotSent}
          </span>
          <div className="kal-docs__actions">
            {!editingDocs && (
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => {
                  setDocsOpis(spotkanie.dokumentyOpis);
                  setEditingDocs(true);
                }}
                disabled={busy}
              >
                <Icon name={sent ? 'edit' : 'check'} size={13} />{' '}
                {sent ? t.kalDocsEdit : t.kalDocsMark}
              </button>
            )}
            {onSendMailing && (
              <button
                type="button"
                className="button button-small button-info"
                onClick={onSendMailing}
                disabled={busy}
              >
                <Icon name="mail" size={13} /> {t.kalDocsSendMailing}
              </button>
            )}
          </div>
        </div>

        {/* The notice period, but only for a kind of meeting that has one — and
            only while it still says something: once the papers are out, when
            they were due stops being the question. */}
        {!sent && daysLeft !== null && (
          <div className={`kal-docs__deadline${overdue ? ' is-overdue' : ''}`}>
            <Icon name={overdue ? 'alert-circle' : 'clock'} size={13} />
            <span>
              {overdue
                ? t.kalDocsOverdue.replace('{days}', String(Math.abs(daysLeft)))
                : t.kalDocsDueIn.replace('{days}', String(daysLeft))}
            </span>
          </div>
        )}

        {sent && !editingDocs && (
          <div className="kal-docs__note">
            {spotkanie.dokumentyOpis && <p>{spotkanie.dokumentyOpis}</p>}
            <span className="kal-docs__stamp">
              {t.kalDocsStamp
                .replace('{when}', formatStamp(spotkanie.dokumentyWyslaneAt ?? '', locale))
                .replace('{who}', spotkanie.dokumentyWyslaneBy || '—')}
            </span>
          </div>
        )}

        {editingDocs && (
          <div className="kal-docs__form">
            <textarea
              rows={2}
              value={docsOpis}
              placeholder={t.kalDocsPlaceholder}
              onChange={(e) => setDocsOpis(e.target.value)}
              autoFocus
            />
            <div className="kal-docs__form-actions">
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => {
                  onDokumenty(true, docsOpis);
                  setEditingDocs(false);
                }}
                disabled={busy}
              >
                <Icon name="check" size={13} /> {t.kalDocsSave}
              </button>
              <button
                type="button"
                className="button button-small button-secondary"
                onClick={() => setEditingDocs(false)}
                disabled={busy}
              >
                {t.cancel}
              </button>
              {sent && (
                <button
                  type="button"
                  className="button button-small button-danger"
                  onClick={() => {
                    onDokumenty(false, '');
                    setEditingDocs(false);
                  }}
                  disabled={busy}
                >
                  <Icon name="x" size={13} /> {t.kalDocsUndo}
                </button>
              )}
            </div>
          </div>
        )}

        {/* What the Mailing module actually sent for this meeting. Each row
            opens the same details window the mailing history opens, because a
            send recorded here and the same send in the history are one thing. */}
        {mailings.length > 0 && (
          <ul className="kal-docs__mailings">
            {mailings.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`kal-docs__mailing${m.status === 'error' ? ' is-error' : ''}`}
                  onClick={() => onOpenMailing(m)}
                  title={t.kalDocsMailingOpen}
                >
                  <Icon name={m.status === 'error' ? 'alert-circle' : 'mail'} size={12} />
                  <span className="kal-docs__mailing-main">
                    {m.templateName || m.subject || '—'}
                    {m.jednostkaNazwa ? ` → ${m.jednostkaNazwa}` : ''}
                  </span>
                  {m.attachmentNames.length > 0 && (
                    <span className="kal-docs__mailing-files" title={m.attachmentNames.join(', ')}>
                      <Icon name="paperclip" size={11} /> {m.attachmentNames.length}
                    </span>
                  )}
                  <span className="kal-docs__mailing-when">{formatStamp(m.sentAt, locale)}</span>
                  <Icon name="chevron-right" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
};

/* ================================ The view ================================= */

/**
 * "Kalendarz" — the month, its meetings, and one panel showing the selected day.
 *
 * A meeting is a name, a moment, a kind and (usually) a community: the same four
 * things this office writes on a wall planner. The grid answers "what is this
 * month like"; the panel next to it answers "what exactly is on this day",
 * because a day cell can only ever hold a couple of lines before it stops being
 * a calendar.
 */
const Kalendarz: React.FC<Props> = ({
  language,
  monthKey,
  setMonthKey,
  stateFilter,
  setStateFilter,
  userEmail,
  onManageTypes,
  onManagePlaces,
  onSendDocuments,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [typy, setTypy] = useState<SpotkanieTyp[]>([]);
  const [lokalizacje, setLokalizacje] = useState<SpotkanieLokalizacja[]>([]);
  const [mailingi, setMailingi] = useState<SpotkanieMailing[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // A refresh must not blank the month — only the first load shows a loader.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typFilter, setTypFilter] = useState<number | null>(null);
  /** Meeting id being written to, so its own buttons disable and nothing else does. */
  const [busyId, setBusyId] = useState<number | null>(null);
  /**
   * The send being read in full, and the history it came from.
   *
   * The calendar itself only carries a slim projection of each send — enough for
   * a one-line summary — so the full row is fetched the first time somebody
   * asks for details, and then kept: the same window opens instantly for every
   * other send on the screen.
   */
  const [mailingDetails, setMailingDetails] = useState<MailingHistoryEntry | null>(null);
  const [mailingHistory, setMailingHistory] = useState<MailingHistoryEntry[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>(todayKey());
  // Set when a chip in the grid is clicked, so the panel says which of the day's
  // meetings the user actually pointed at.
  const [highlightId, setHighlightId] = useState<number | null>(null);
  // null = closed; otherwise the meeting being edited (or null) and the day.
  const [form, setForm] = useState<{ editing: Spotkanie | null; day: string } | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  /**
   * Whether the hover card is switched on (Ustawienia → Wygląd). Read here
   * rather than threaded down from the app shell: this view is the only reader,
   * it reloads whenever it is opened, and the setting cannot change while it is
   * on screen — Ustawienia is a different view.
   */
  const [hoverCard, setHoverCard] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  // Keep the panel inside the month on view: switching months must not leave it
  // describing a day that is no longer on screen.
  useEffect(() => {
    if (monthOfDayKey(selectedDay) === monthKey) return;
    const today = todayKey();
    setSelectedDay(monthOfDayKey(today) === monthKey ? today : `${monthKey}-01`);
    setHighlightId(null);
  }, [monthKey, selectedDay]);

  // Switching months replaces the cells under the cursor, so the chip the hover
  // card belongs to may never fire its mouseleave.
  useEffect(() => setTip(null), [monthKey]);

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const [
        spotkaniaData,
        typyData,
        lokalizacjeData,
        adresyData,
        usersData,
        mailingiData,
        settings,
      ] = await Promise.all([
        window.electronAPI.getSpotkania(),
        window.electronAPI.getSpotkaniaTypy(),
        window.electronAPI.getSpotkaniaLokalizacje(),
        window.electronAPI.getAdresy(),
        window.electronAPI.getAppUsers(),
        window.electronAPI.getSpotkaniaMailingi(),
        window.electronAPI.getSettings(),
      ]);
      setSpotkania(spotkaniaData);
      setTypy(typyData);
      setLokalizacje(lokalizacjeData);
      setAdresy(adresyData);
      setUsers(usersData);
      setMailingi(mailingiData);
      setHoverCard(settings.calendarHoverCard ?? false);
    } catch (err) {
      notify.error(t.kalLoadError);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  /* ------------------------------ Derived data ----------------------------- */

  /**
   * What the document questions need beyond the meeting: which meetings a
   * mailing actually went out for, and the types that carry the notice periods.
   */
  const docsCtx: SpotkaniaDocsContext = useMemo(
    () => ({ sentByMailing: sentByMailingIds(mailingi), typy }),
    [mailingi, typy],
  );

  const filtered = useMemo(
    () =>
      spotkania.filter(
        (s) =>
          matchesTypFilter(s, typFilter) &&
          matchesStateFilter(s, stateFilter, docsCtx) &&
          matchesSpotkanieSearch(s, typy, search),
      ),
    [spotkania, typy, typFilter, stateFilter, search, docsCtx],
  );

  /**
   * What the strip above the month announces, counted over the month on screen
   * rather than the whole database — the answer should be about the month you
   * are looking at.
   */
  const alerts = useMemo(
    () => countAlerts(spotkaniaInMonth(spotkania, monthKey), docsCtx),
    [spotkania, monthKey, docsCtx],
  );

  const mailingiBySpotkanie = useMemo(() => {
    const map = new Map<number, SpotkanieMailing[]>();
    for (const m of mailingi) {
      const bucket = map.get(m.spotkanieId);
      if (bucket) bucket.push(m);
      else map.set(m.spotkanieId, [m]);
    }
    return map;
  }, [mailingi]);

  // The month bar and "coming up" describe what is actually scheduled, so they
  // ignore the search and the type filter — a filter that hid everything would
  // otherwise make the header claim the month is empty. The grid and the day
  // panel are the working view and do follow the filter; the grid groups every
  // meeting, not just the month's, because its first and last row show days
  // belonging to the neighbouring months.
  const monthSpotkania = useMemo(
    () => spotkaniaInMonth(spotkania, monthKey),
    [spotkania, monthKey],
  );
  const byDay = useMemo(() => groupByDay(filtered, locale), [filtered, locale]);
  const cells = useMemo(() => buildMonthGrid(monthKey), [monthKey]);
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);

  const dayMeetings = useMemo(
    () => sortSpotkania(byDay.get(selectedDay) ?? [], locale),
    [byDay, selectedDay, locale],
  );
  const upcoming = useMemo(() => upcomingSpotkania(spotkania, 5), [spotkania]);

  const monthOptions = useMemo(() => {
    const keys = new Set(monthsWithSpotkania(spotkania));
    keys.add(monthKey);
    keys.add(currentMonthKey());
    return [...keys]
      .sort((a, b) => b.localeCompare(a))
      .map((key) => ({ value: key, label: monthLabel(key, locale) }));
  }, [spotkania, monthKey, locale]);

  /* -------------------------------- Actions -------------------------------- */

  /**
   * Select a day, following it into a neighbouring month when the user clicks
   * one of the grid's borrowed cells. Everything that moves the panel goes
   * through here, so the panel and the month on screen can never disagree.
   */
  const selectDay = (dayKey: string, highlight: number | null = null) => {
    const month = monthOfDayKey(dayKey);
    if (month !== monthKey) setMonthKey(month);
    setSelectedDay(dayKey);
    setHighlightId(highlight);
  };

  const openForm = (day: string, editing: Spotkanie | null = null) => {
    setFormError(null);
    setForm({ editing, day });
    // The modal covers the chip, so its mouseleave may never fire.
    setTip(null);
  };

  /**
   * Position the hover card off the chip's own box. Anchoring from whichever
   * viewport edge is further away means the card never has to be measured
   * before it is placed — which is what lets it appear on the first frame
   * instead of after a native tooltip's delay.
   */
  const showTip = (event: React.MouseEvent<HTMLElement>, spotkanie: Spotkanie) => {
    if (!hoverCard) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(
      TIP_MARGIN,
      Math.min(rect.left, window.innerWidth - TIP_WIDTH - TIP_MARGIN),
    );
    const below = rect.bottom <= window.innerHeight / 2;
    setTip({
      spotkanie,
      left,
      top: below ? rect.bottom + TIP_MARGIN : undefined,
      bottom: below ? undefined : window.innerHeight - rect.top + TIP_MARGIN,
    });
  };

  const handleSubmit = async (input: SpotkanieInput) => {
    setIsSaving(true);
    setFormError(null);
    try {
      if (form?.editing) {
        await window.electronAPI.updateSpotkanie(form.editing.id, input);
      } else {
        await window.electronAPI.addSpotkanie(input);
      }
      setForm(null);
      await load(true);
      // Land on the meeting that was just saved, even when it was moved into
      // another month — otherwise saving looks like it did nothing.
      selectDay(toDayKey(input.startsAt));
      notify.success(form?.editing ? t.kalUpdated : t.kalSaved);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (spotkanie: Spotkanie) => {
    const message = t.kalConfirmDelete
      .replace('{name}', spotkanie.nazwa)
      .replace('{when}', formatStamp(spotkanie.startsAt, locale));
    if (!(await notify.confirm(message, { danger: true }))) return;
    try {
      await window.electronAPI.deleteSpotkanie(spotkanie.id);
      await load(true);
      notify.success(t.kalDeleted);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  /**
   * One wrapper for the small per-meeting writes: they all set the same busy
   * flag, reload the same way, and report the same failure. Reloads rather than
   * patching state in place — the meetings are shared, and the row may have
   * moved under us while the card was on screen.
   */
  const runOnMeeting = async (id: number, action: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    try {
      await action();
      await load(true);
      notify.success(done);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  };

  const handleAckTermin = (spotkanie: Spotkanie) =>
    runOnMeeting(
      spotkanie.id,
      () => window.electronAPI.ackSpotkanieTermin(spotkanie.id),
      t.kalTerminAckDone,
    );

  const handleTerminStatus = (spotkanie: Spotkanie, status: SpotkanieTerminStatus) =>
    runOnMeeting(
      spotkanie.id,
      () => window.electronAPI.setSpotkanieTerminStatus(spotkanie.id, status),
      status === 'potwierdzony' ? t.kalTerminConfirmedDone : t.kalTerminTentativeDone,
    );

  const handleDokumenty = (spotkanie: Spotkanie, sent: boolean, opis: string) =>
    runOnMeeting(
      spotkanie.id,
      () => window.electronAPI.setSpotkanieDokumenty(spotkanie.id, sent, opis),
      sent ? t.kalDocsSavedDone : t.kalDocsUndoneDone,
    );

  /**
   * Hand a meeting to the Mailing module. Only offered for a meeting with a
   * community: a mailing goes to that community's city unit, so without one
   * there is nobody to send to.
   */
  const handleSendMailing = (spotkanie: Spotkanie) => {
    if (!onSendDocuments || spotkanie.adresId === null) return;
    onSendDocuments({
      spotkanieId: spotkanie.id,
      spotkanieNazwa: spotkanie.nazwa,
      adresIds: [spotkanie.adresId],
    });
  };

  /**
   * Open one recorded send in the same window the mailing history uses. Falls
   * back to a plain error rather than a half-filled modal: the row exists in
   * the calendar because the send happened, so a miss here means the history
   * row was cleared, and saying so is better than showing an empty record.
   */
  const openMailingDetails = async (mailing: SpotkanieMailing) => {
    try {
      const history = mailingHistory ?? (await window.electronAPI.mailingGetHistory());
      if (!mailingHistory) setMailingHistory(history);
      const entry = history.find((h) => h.id === mailing.id);
      if (!entry) {
        notify.error(t.kalDocsMailingMissing);
        return;
      }
      setMailingDetails(entry);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  /** Follow a meeting from the "coming up" list to its own day. */
  const goToSpotkanie = (spotkanie: Spotkanie) => {
    selectDay(toDayKey(spotkanie.startsAt), spotkanie.id);
  };

  /* ------------------------------- Rendering ------------------------------- */

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  const monthNumber = Number(monthKey.split('-')[1]) || 1;
  const monthName = monthLabel(monthKey, locale).replace(/\s*\d{4}$/, '');
  const year = monthKey.split('-')[0];
  const searchActive = search.trim().length > 0;

  const facts = [
    `${t.kalFactsMeetings}: ${monthSpotkania.length}`,
    `${t.kalFactsUpcoming}: ${upcoming.length}`,
  ];
  if (typy.length > 0) facts.push(`${t.kalFactsTypes}: ${typy.length}`);

  return (
    <div className="content-body content-body--fill">
      <div className="kal">
        {/* ---------------------------- Month bar --------------------------- */}
        <header
          className="ksieg-hero"
          style={{ ['--month-accent' as string]: monthAccent(monthNumber) }}
        >
          <div className="ksieg-hero__art">
            <MonthIllustration month={monthNumber} />
          </div>

          <div className="ksieg-hero__id">
            <span className="ksieg-hero__eyebrow">
              <Icon name="calendar" size={13} /> {t.kalTitle}
            </span>
            <h1 className="ksieg-hero__month">
              {monthName}
              <span>{year}</span>
            </h1>
            <p className="ksieg-hero__facts">{facts.join(' · ')}</p>
          </div>

          <div className="ksieg-hero__nav">
            <button
              type="button"
              className="ksieg-nav-arrow"
              onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}
              title={t.kalMonthPrev}
              aria-label={t.kalMonthPrev}
            >
              <Icon name="chevron-left" size={17} />
            </button>
            <Select
              value={monthKey}
              options={monthOptions}
              onChange={setMonthKey}
              ariaLabel={t.kalMonthPick}
              className="ksieg-nav-select"
            />
            <button
              type="button"
              className="ksieg-nav-arrow"
              onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}
              title={t.kalMonthNext}
              aria-label={t.kalMonthNext}
            >
              <Icon name="chevron-right" size={17} />
            </button>
            <button
              type="button"
              className="ksieg-nav-today"
              onClick={() => selectDay(todayKey())}
              disabled={monthKey === currentMonthKey() && selectedDay === todayKey()}
            >
              {t.kalToday}
            </button>
            <button
              type="button"
              className="ksieg-nav-arrow"
              onClick={() => void load(true)}
              disabled={isRefreshing}
              title={t.kalRefresh}
              aria-label={t.kalRefresh}
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
        </header>

        {/* ------------------------- What needs attention -------------------
            Four states, one shape each: a tick box that shows whether the
            filter is on, and the same click turns it off again. This is also
            the only place these filters live — a second set among the type
            filters was two controls for one state, and the strip is where the
            user is already looking, because it is the thing that told them
            there was something to look at. */}
        {/* The active filter's own switch always stays on screen, even at zero:
            arriving here from the dashboard and then paging to a month with
            none of them would otherwise leave the filter on with nothing to
            turn it off with, and an empty calendar as the only clue. */}
        {(hasAnyAlert(alerts) || stateFilter !== 'all') && (
          <div className="kal-warnings">
            {ALERT_KINDS.map(({ filter, count, tone, icon, label }) =>
              count(alerts) === 0 && stateFilter !== filter ? null : (
                <button
                  key={filter}
                  type="button"
                  className={
                    `kal-warning kal-warning--${tone}` +
                    (stateFilter === filter ? ' is-active' : '') +
                    (count(alerts) === 0 ? ' is-empty' : '')
                  }
                  onClick={() => setStateFilter(stateFilter === filter ? 'all' : filter)}
                  aria-pressed={stateFilter === filter}
                  title={stateFilter === filter ? t.kalFilterOnHint : t.kalFilterOffHint}
                >
                  <span className="kal-warning__box" aria-hidden="true">
                    {stateFilter === filter && <Icon name="check" size={12} />}
                  </span>
                  <Icon name={icon} size={16} />
                  <span className="kal-warning__text">
                    {t[label].replace('{count}', String(count(alerts)))}
                  </span>
                </button>
              ),
            )}
          </div>
        )}

        {/* ----------------------------- Toolbar ---------------------------- */}
        <div className="ksieg-toolbar">
          <div className="ksieg-search">
            <Icon name="search" size={15} />
            <input
              type="text"
              placeholder={t.kalSearch}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {searchActive && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title={t.close}
                aria-label={t.close}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>

          <div className="kal-filters" role="group" aria-label={t.kalFieldType}>
            <button
              type="button"
              className={`kal-filter${typFilter === null ? ' is-active' : ''}`}
              onClick={() => setTypFilter(null)}
              aria-pressed={typFilter === null}
            >
              {t.kalAllTypes}
            </button>
            {typy.map((typ) => (
              <button
                key={typ.id}
                type="button"
                className={`kal-filter${typFilter === typ.id ? ' is-active' : ''}`}
                style={{ ['--chip' as string]: normalizeHexColor(typ.kolor) }}
                onClick={() => setTypFilter(typFilter === typ.id ? null : typ.id)}
                aria-pressed={typFilter === typ.id}
              >
                <span className="kal-chip__dot" />
                {typ.nazwa}
              </button>
            ))}

          </div>

          <button
            type="button"
            className="button button-primary kal-new"
            onClick={() => openForm(selectedDay)}
          >
            <Icon name="plus" size={14} /> {t.kalNewMeeting}
          </button>
        </div>

        {/* ---------------------- The month and the day --------------------- */}
        <div className="kal-layout">
          <div className="kal-grid">
            {/* Head and body scroll together in one container so their seven
                columns stay aligned when a scrollbar appears, and the head is
                sticky so it stays readable while they do. */}
            <div className="kal-grid__scroll" onScroll={() => setTip(null)}>
              <div className="kal-grid__head">
                {weekdays.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="kal-grid__body">
                {cells.map((cell) => {
                  const meetings = byDay.get(cell.dayKey) ?? [];
                  const shown = meetings.slice(0, CHIPS_PER_CELL);
                  const more = meetings.length - shown.length;
                  return (
                    <div
                      key={cell.dayKey}
                      className={
                        'kal-cell' +
                        (cell.inMonth ? '' : ' kal-cell--outside') +
                        (cell.isWeekend ? ' kal-cell--weekend' : '') +
                        (cell.isToday ? ' kal-cell--today' : '') +
                        (cell.dayKey === selectedDay ? ' is-selected' : '')
                      }
                      role="button"
                      tabIndex={0}
                      aria-label={formatDayLabel(cell.dayKey, locale)}
                      title={`${formatDayLabel(cell.dayKey, locale)} — ${t.kalDayDoubleClick}`}
                      onClick={() => selectDay(cell.dayKey)}
                      // One click reads the day, two write to it — the same
                      // convention as every other calendar. The hover "+" stays,
                      // because a double-click is a gesture nobody can see.
                      onDoubleClick={() => {
                        selectDay(cell.dayKey);
                        openForm(cell.dayKey);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectDay(cell.dayKey);
                        }
                      }}
                    >
                      <div className="kal-cell__head">
                        <span className="kal-cell__num">{cell.dayOfMonth}</span>
                        <button
                          type="button"
                          className="kal-cell__add"
                          title={t.kalDayAdd}
                          aria-label={t.kalDayAdd}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectDay(cell.dayKey);
                            openForm(cell.dayKey);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <Icon name="plus" size={12} />
                        </button>
                      </div>
                      <div className="kal-cell__chips">
                        {shown.map((s) => {
                          const typ = typOf(s, typy);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={
                                'kal-chip kal-chip--button' +
                                (hasUnreadTerminChange(s) ? ' is-changed' : '') +
                                (isTerminWstepny(s) ? ' is-tentative' : '')
                              }
                              style={{
                                ['--chip' as string]: normalizeHexColor(
                                  typ?.kolor ?? DEFAULT_TYP_COLOR,
                                ),
                              }}
                              /* With the card on, the title must be empty —
                               not absent: that suppresses the native tooltip
                               AND stops the browser falling back to the cell's
                               title, which would otherwise arrive a second
                               later on top of the card. With the card off, the
                               native tooltip is the fallback, so the full name
                               is still reachable. */
                            title={
                              hoverCard
                                ? ''
                                : `${formatTimeRange(s, locale)} — ${s.nazwa}\n${t.kalChipDoubleClick}`
                            }
                            onMouseEnter={(e) => showTip(e, s)}
                            onMouseLeave={() => setTip(null)}
                              onClick={(e) => {
                                e.stopPropagation();
                                selectDay(cell.dayKey, s.id);
                              }}
                              // Stopped from bubbling, or the cell underneath
                              // would open a *new* meeting over this edit.
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                selectDay(cell.dayKey, s.id);
                                openForm(toDayKey(s.startsAt), s);
                              }}
                            >
                              <span className="kal-chip__dot" />
                              {hasUnreadTerminChange(s) && (
                                <Icon name="alert-triangle" size={11} />
                              )}
                              {isTerminWstepny(s) && <Icon name="clock" size={11} />}
                              <span className="kal-chip__time">
                                {formatTime(s.startsAt, locale)}
                              </span>
                              <span className="kal-chip__name">{s.nazwa}</span>
                            </button>
                          );
                        })}
                        {more > 0 && (
                          <button
                            type="button"
                            className="kal-cell__more"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectDay(cell.dayKey);
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            {t.kalMore.replace('{count}', String(more))}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="kal-side">
            <div className="kal-side__block kal-side__block--day">
              <div className="kal-side__head">
                <h3>{formatDayLabel(selectedDay, locale)}</h3>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => openForm(selectedDay)}
                >
                  <Icon name="plus" size={13} /> {t.add}
                </button>
              </div>
              {dayMeetings.length === 0 ? (
                <div className="kal-side__empty">
                  <Icon name="calendar" size={26} />
                  <span>
                    {searchActive || typFilter !== null || stateFilter !== 'all'
                      ? t.kalNoResults
                      : t.kalDayEmpty}
                  </span>
                </div>
              ) : (
                <div className="kal-side__list">
                  {dayMeetings.map((s) => (
                    <MeetingCard
                      key={s.id}
                      spotkanie={s}
                      typ={typOf(s, typy)}
                      place={lokalizacjaLabel(s, lokalizacje)}
                      mailings={mailingiBySpotkanie.get(s.id) ?? []}
                      language={language}
                      locale={locale}
                      highlighted={highlightId === s.id}
                      busy={busyId === s.id}
                      onEdit={() => openForm(toDayKey(s.startsAt), s)}
                      onDelete={() => void handleDelete(s)}
                      onAckTermin={() => void handleAckTermin(s)}
                      onTerminStatus={(status) => void handleTerminStatus(s, status)}
                      onDokumenty={(sent, opis) => void handleDokumenty(s, sent, opis)}
                      onSendMailing={
                        onSendDocuments && s.adresId !== null
                          ? () => handleSendMailing(s)
                          : undefined
                      }
                      onOpenMailing={(m) => void openMailingDetails(m)}
                      docsCtx={docsCtx}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="kal-side__block kal-side__block--next">
              <div className="kal-side__head">
                <h3>{t.kalUpcoming}</h3>
              </div>
              {upcoming.length === 0 ? (
                <div className="kal-side__empty kal-side__empty--sm">
                  <span>{t.kalUpcomingEmpty}</span>
                </div>
              ) : (
                <div className="kal-next">
                  {upcoming.map((s) => {
                    const typ = typOf(s, typy);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className="kal-next__item"
                        style={{
                          ['--chip' as string]: normalizeHexColor(typ?.kolor ?? DEFAULT_TYP_COLOR),
                        }}
                        onClick={() => goToSpotkanie(s)}
                      >
                        <span className="kal-next__bar" />
                        <span className="kal-next__body">
                          <span className="kal-next__name">{s.nazwa}</span>
                          <span className="kal-next__when">
                            {formatStamp(s.startsAt, locale)}
                            {s.adresNazwa ? ` · ${s.adresNazwa}` : ''}
                          </span>
                        </span>
                        <Icon name="chevron-right" size={15} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Hover card for a chip in the grid. A native `title` waits about a
          second before it appears, and a cell is exactly where the user is
          scanning quickly — so this is rendered here, positioned in the
          viewport, and therefore never clipped by the grid's rounded overflow. */}
      {tip && (
        <div
          className="kal-tip"
          role="tooltip"
          style={{ left: tip.left, top: tip.top, bottom: tip.bottom }}
        >
          <div className="kal-tip__time">
            <Icon name="clock" size={12} /> {formatTimeRange(tip.spotkanie, locale)}
          </div>
          <div className="kal-tip__name">{tip.spotkanie.nazwa}</div>
          <div className="kal-tip__meta">
            <span
              className="kal-chip"
              style={{
                ['--chip' as string]: normalizeHexColor(
                  typOf(tip.spotkanie, typy)?.kolor ?? DEFAULT_TYP_COLOR,
                ),
              }}
            >
              <span className="kal-chip__dot" />
              <span className="kal-chip__name">
                {typOf(tip.spotkanie, typy)?.nazwa ?? t.kalNoType}
              </span>
            </span>
          </div>
          {tip.spotkanie.adresNazwa && (
            <div className="kal-tip__line">
              <Icon name="map-pin" size={12} /> {tip.spotkanie.adresNazwa}
            </div>
          )}
          {tip.spotkanie.uczestnicy.length > 0 && (
            <div className="kal-tip__line">
              <Icon name="users" size={12} />{' '}
              {tip.spotkanie.uczestnicy.map((person) => personLabel(person)).join(', ')}
            </div>
          )}
          {lokalizacjaLabel(tip.spotkanie, lokalizacje) && (
            <div className="kal-tip__line">
              <Icon name="map-pin" size={12} />
              {lokalizacjaLabel(tip.spotkanie, lokalizacje)}
            </div>
          )}
          {isTerminWstepny(tip.spotkanie) && (
            <div className="kal-tip__line kal-tip__line--warn">
              <Icon name="clock" size={12} /> {t.kalTerminTentative}
            </div>
          )}
          {hasUnreadTerminChange(tip.spotkanie) && (
            <div className="kal-tip__line kal-tip__line--warn">
              <Icon name="alert-triangle" size={12} />
              {tip.spotkanie.terminZmienionyZ
                ? t.kalTerminChangedFrom.replace(
                    '{from}',
                    formatStamp(tip.spotkanie.terminZmienionyZ, locale),
                  )
                : t.kalTerminChangedTitle}
            </div>
          )}
          {tip.spotkanie.opis && <p className="kal-tip__desc">{tip.spotkanie.opis}</p>}
          <div className="kal-tip__hint">{t.kalChipDoubleClick}</div>
        </div>
      )}

      {mailingDetails && (
        <MailingDetailsModal
          entry={mailingDetails}
          language={language}
          onClose={() => setMailingDetails(null)}
        />
      )}

      {form && (
        <SpotkanieFormModal
          // Remounting per target keeps the form's own state honest: opening a
          // different meeting must not inherit the previous one's fields.
          key={form.editing ? `edit-${form.editing.id}` : `new-${form.day}`}
          language={language}
          editing={form.editing}
          defaultDay={form.day}
          typy={typy}
          lokalizacje={lokalizacje}
          adresy={adresy}
          users={users}
          userEmail={userEmail}
          isSaving={isSaving}
          error={formError}
          onSubmit={handleSubmit}
          onCancel={() => {
            setForm(null);
            setFormError(null);
          }}
          onManageTypes={onManageTypes}
          onManagePlaces={onManagePlaces}
        />
      )}
    </div>
  );
};

export default Kalendarz;
