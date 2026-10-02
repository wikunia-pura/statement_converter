import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Adres,
  AppUser,
  MailingHistoryEntry,
  Spotkanie,
  SpotkanieInput,
  SpotkanieLokalizacja,
  SpotkanieMailing,
  SpotkanieTerminStatus,
  SpotkanieMaterialyStatus,
  SpotkanieMaterialyKrok,
  SPOTKANIE_MATERIALY_KROKI,
  SPOTKANIE_MATERIALY_POPRZEDNI,
  SpotkanieTyp,
  SpotkanieUczestnik,
  Zadanie,
  ZadanieInput,
  ZgnJednostka,
  ZgnPelnomocnik,
  SpotkanieZarzadOsoba,
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
import { ZadanieFormModal, ZadaniePreviewModal } from './Zadania';
import { formatDayKey } from '../../shared/zadania';
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
  /** Open a linked task on the Zadania board. */
  onOpenZadanie?: (zadanieId: number) => void;
  /**
   * Land on this meeting — a task's meeting link was followed from the board. A
   * fresh `nonce` makes the same meeting land again.
   */
  focusRequest?: { spotkanieId: number; nonce: number; edit?: boolean } | null;
  /** The request has landed — so a later visit to the calendar is not pulled back to it. */
  onFocusHandled?: () => void;
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

/** Where the month/list choice is remembered (per computer). */
const VIEW_MODE_KEY = 'kalendarz.viewMode';

/** Width of the month/year count card — kept in step with `.kal-count-tip`. */
const COUNT_TIP_WIDTH = 240;

/**
 * An open month/year count card: what it counts (a type, or every meeting), the
 * two numbers, and where it hangs — under the chip or figure it explains.
 */
interface CountTipState {
  label: string;
  color: string | null;
  month: number;
  year: number;
  left: number;
  top: number;
}

/** "3 spotkania" / "5 spotkań" — the count with the word that fits it. */
function meetingsCount(n: number, language: Language): string {
  if (language === 'en') return `${n} ${n === 1 ? 'meeting' : 'meetings'}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return `${n} spotkanie`;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return `${n} spotkania`;
  return `${n} spotkań`;
}

/** An open hover card: which meeting, and the viewport edges it hangs off. */
interface TipState {
  spotkanie: Spotkanie;
  left: number;
  top?: number;
  bottom?: number;
}

/* ========================= A meeting's linked tasks ======================== */

/**
 * The tasks that belong to one meeting — in its form and on its card. Saved
 * tasks can be edited, deleted and followed to the board; a new meeting's
 * tasks are `pending`: kept in the form and added once the meeting exists,
 * because until then there is no meeting for them to point at.
 */
const SpotkanieZadania: React.FC<{
  zadania: Zadanie[];
  pending?: ZadanieInput[];
  users: AppUser[];
  language: Language;
  disabled?: boolean;
  onAdd: () => void;
  onPreview: (zadanie: Zadanie) => void;
  onEdit: (zadanie: Zadanie) => void;
  onDelete: (zadanie: Zadanie) => void;
  onOpenBoard?: (zadanie: Zadanie) => void;
  onRemovePending?: (index: number) => void;
}> = ({
  zadania,
  pending = [],
  users,
  language,
  disabled = false,
  onAdd,
  onPreview,
  onEdit,
  onDelete,
  onOpenBoard,
  onRemovePending,
}) => {
  const t = translations[language];
  const dayLocale = language === 'en' ? 'en' : 'pl';
  const statusLabel: Record<Zadanie['status'], string> = {
    todo: t.zadColTodo,
    in_progress: t.zadColInProgress,
    done: t.zadColDone,
  };
  const who = (email: string | null): string | null => {
    if (!email) return null;
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    return user ? personLabel(user) : email;
  };
  const meta = (z: Pick<ZadanieInput, 'przypisanyEmail' | 'termin'>): string =>
    [who(z.przypisanyEmail), z.termin ? formatDayKey(z.termin, dayLocale) : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="kal-tasks">
      <div className="kal-tasks__head">
        <span className="kal-tasks__title">
          <Icon name="clipboard" size={13} /> {t.kalTasksTitle}
          {zadania.length + pending.length > 0 && (
            <span className="kal-tasks__count">{zadania.length + pending.length}</span>
          )}
        </span>
        <button
          type="button"
          className="link-button"
          onClick={onAdd}
          disabled={disabled}
          title={t.kalAddTaskHint}
        >
          <Icon name="plus" size={12} /> {t.kalAddTask}
        </button>
      </div>
      {zadania.length === 0 && pending.length === 0 ? (
        <div className="kal-tasks__empty">{t.kalTasksEmpty}</div>
      ) : (
        <ul className="kal-tasks__list">
          {zadania.map((z) => (
            <li key={z.id} className={`kal-task kal-task--${z.status}`}>
              <span className="kal-task__dot" title={statusLabel[z.status]} />
              <button
                type="button"
                className="kal-task__body kal-task__body--open"
                onClick={() => onPreview(z)}
                title={t.kalTaskPreview}
              >
                <span className="kal-task__name">{z.tytul}</span>
                <span className="kal-task__meta">
                  {statusLabel[z.status]}
                  {meta(z) && ` · ${meta(z)}`}
                </span>
              </button>
              <span className="kal-task__actions">
                {onOpenBoard && (
                  <button
                    type="button"
                    onClick={() => onOpenBoard(z)}
                    title={t.kalTaskOpenBoard}
                    aria-label={t.kalTaskOpenBoard}
                  >
                    <Icon name="arrow-right" size={13} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(z)}
                  disabled={disabled}
                  title={t.edit}
                  aria-label={t.edit}
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => onDelete(z)}
                  disabled={disabled}
                  title={t.delete}
                  aria-label={t.delete}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </li>
          ))}
          {pending.map((p, i) => (
            <li key={`pending-${i}`} className="kal-task kal-task--pending">
              <span className="kal-task__dot" />
              <span className="kal-task__body">
                <span className="kal-task__name">{p.tytul}</span>
                <span className="kal-task__meta">
                  {t.kalTaskPending}
                  {meta(p) && ` · ${meta(p)}`}
                </span>
              </span>
              {onRemovePending && (
                <span className="kal-task__actions">
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => onRemovePending(i)}
                    disabled={disabled}
                    title={t.kalTaskRemovePending}
                    aria-label={t.kalTaskRemovePending}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ============================ City unit / proxy ============================ */

/** Where a meeting's materials stand, in words — card, chip card and preview. */
export function materialyStatusLabel(
  t: (typeof translations)['pl'],
  status: SpotkanieMaterialyStatus,
): string {
  return {
    brak: t.kalMatStateBrak,
    potrzebne: t.kalMatStatePotrzebne,
    do_przygotowania: t.kalMatStateDo,
    przygotowane: t.kalMatStatePrzygotowane,
    wyslane: t.kalMatStateWyslane,
  }[status];
}

/** The picker's value for a unit (`j:12`) or a proxy (`p:7`); '' for none. */
function zgnPickValue(jednostkaId: number | null, pelnomocnikId: number | null): string {
  if (pelnomocnikId != null) return `p:${pelnomocnikId}`;
  if (jednostkaId != null) return `j:${jednostkaId}`;
  return '';
}

/** What a meeting shows for a proxy: their name and the unit they act for. */
function pelnomocnikLabel(p: ZgnPelnomocnik, jednostki: ZgnJednostka[]): string {
  const unit = jednostki.find((j) => j.id === p.jednostkaId);
  return unit ? `${p.imieNazwisko} (${unit.nazwa})` : p.imieNazwisko;
}

/* ============================ The add/edit form ============================ */

interface FormProps {
  language: Language;
  /** Meeting being edited, or null when adding a new one. */
  editing: Spotkanie | null;
  /**
   * With `editing` null: the meeting being cloned. The new one starts with all
   * of its fields; saving adds a meeting and leaves the original untouched.
   */
  template?: Spotkanie | null;
  /** Day the form opens on (`YYYY-MM-DD`) — the cell the user clicked. */
  defaultDay: string;
  typy: SpotkanieTyp[];
  lokalizacje: SpotkanieLokalizacja[];
  adresy: Adres[];
  users: AppUser[];
  userEmail?: string;
  isSaving: boolean;
  error: string | null;
  /**
   * `pendingZadania`: tasks written for a meeting that did not exist yet.
   * `materialyPotrzebne`: whether the meeting needs materials — saved through
   * the materials action (it records who moved it), so it travels beside the input.
   */
  onSubmit: (
    input: SpotkanieInput,
    pendingZadania: ZadanieInput[],
    materialyPotrzebne: boolean,
  ) => void;
  onCancel: () => void;
  onManageTypes?: () => void;
  onManagePlaces?: () => void;
  /** While editing: start a new meeting from this one instead. */
  onClone?: () => void;
  /** City units, and their proxies — the "with whom from the city" picker. */
  zgnJednostki: ZgnJednostka[];
  zgnPelnomocnicy: ZgnPelnomocnik[];
  /** Tasks already linked to the meeting being edited. */
  linkedZadania: Zadanie[];
  /** A linked task was added, changed or deleted here — reload them. */
  onZadaniaChanged: () => void;
  onDeleteZadanie: (zadanie: Zadanie) => void;
  onOpenZadanie?: (zadanie: Zadanie) => void;
}

const SpotkanieFormModal: React.FC<FormProps> = ({
  language,
  editing,
  template = null,
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
  onClone,
  zgnJednostki,
  zgnPelnomocnicy,
  linkedZadania,
  onZadaniaChanged,
  onDeleteZadanie,
  onOpenZadanie,
}) => {
  const t = translations[language];
  // Where the fields start: the meeting being edited, else the one being cloned.
  const base = editing ?? template;
  const startParts = toParts(base?.startsAt ?? null);
  const endParts = toParts(base?.endsAt ?? null);

  const [typId, setTypId] = useState(base?.typId != null ? String(base.typId) : '');
  const [adresId, setAdresId] = useState(base?.adresId != null ? String(base.adresId) : '');
  const [nazwa, setNazwa] = useState(base?.nazwa ?? '');
  /**
   * Whether the title has been written by hand and must stop following the two
   * pickers. An existing meeting counts as hand-written only when its name is
   * not what its own type and community would have produced — so a generated
   * name keeps tracking a type change, and a name someone chose is never
   * silently overwritten.
   */
  const [nameEdited, setNameEdited] = useState(
    base
      ? base.nazwa.trim() !==
        suggestSpotkanieTitle(
          typy.find((typ) => typ.id === base.typId)?.nazwa ?? null,
          base.adresNazwa,
        )
      : false,
  );
  const [date, setDate] = useState(startParts.date || defaultDay);
  const [timeFrom, setTimeFrom] = useState(startParts.time || DEFAULT_START);
  // A new meeting gets a one-hour default; an existing one with no end keeps
  // none, so editing it doesn't invent an end time nobody asked for.
  const [timeTo, setTimeTo] = useState(
    base ? endParts.time : shiftTime(DEFAULT_START, 60),
  );
  const [opis, setOpis] = useState(base?.opis ?? '');
  const [lokalizacjaId, setLokalizacjaId] = useState(
    base?.lokalizacjaId != null ? String(base.lokalizacjaId) : '',
  );
  /**
   * Confirmed or still being agreed. A new meeting starts confirmed — that is
   * what most of them are, and calling every fresh entry tentative would make
   * the mark meaningless by the end of the first week.
   */
  const [terminStatus, setTerminStatus] = useState<SpotkanieTerminStatus>(
    base?.terminStatus ?? 'potwierdzony',
  );
  const [uczestnicy, setUczestnicy] = useState<SpotkanieUczestnik[]>(base?.uczestnicy ?? []);
  // The community's board on this meeting: filled in from the community when it
  // is picked, then the user's to trim.
  const [zarzad, setZarzad] = useState<SpotkanieZarzadOsoba[]>(base?.zarzad ?? []);
  // A new meeting needs materials unless the user says otherwise.
  const [materialyPotrzebne, setMaterialyPotrzebne] = useState(
    base ? base.materialyStatus !== 'brak' : true,
  );
  // A unit or one of its proxies, as one picker value (see `zgnPickValue`).
  const [zgnPick, setZgnPick] = useState(
    zgnPickValue(base?.zgnJednostkaId ?? null, base?.zgnPelnomocnikId ?? null),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  // The task form, over this one: null = closed, otherwise the task being
  // edited (or null for a new one). The meeting form stays open underneath and
  // keeps whatever has been typed into it so far.
  const notify = useNotify();
  const [taskForm, setTaskForm] = useState<{ editing: Zadanie | null } | null>(null);
  const [taskPreview, setTaskPreview] = useState<Zadanie | null>(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  // A meeting that is not saved yet has no id to link to: its tasks wait here.
  const [pendingZadania, setPendingZadania] = useState<ZadanieInput[]>([]);

  const closeTask = () => {
    setTaskForm(null);
    setTaskError(null);
  };

  const handleTaskSubmit = async (input: ZadanieInput) => {
    if (!editing && !taskForm?.editing) {
      setPendingZadania((prev) => [...prev, input]);
      closeTask();
      return;
    }
    setTaskSaving(true);
    setTaskError(null);
    try {
      if (taskForm?.editing) {
        await window.electronAPI.updateZadanie(taskForm.editing.id, input);
        notify.success(t.kalTaskUpdated);
      } else if (editing) {
        await window.electronAPI.addZadanie({ ...input, spotkanieId: editing.id });
        notify.success(t.kalTaskAdded);
      }
      closeTask();
      onZadaniaChanged();
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : t.zadSaveError);
    } finally {
      setTaskSaving(false);
    }
  };

  /** Files of a pending task are already in the bucket; nothing else would remove them. */
  const discardPending = (list: ZadanieInput[]) => {
    const paths = list.flatMap((p) => p.zalaczniki.map((z) => z.sciezka));
    if (paths.length > 0) void window.electronAPI.zadaniaDiscardAttachments(paths).catch(() => {});
  };

  const handleCancel = () => {
    discardPending(pendingZadania);
    onCancel();
  };

  const chosen = new Set(uczestnicy.map((u) => u.userId));
  // Offered by name, in name order — the dropdown is read down, and mailbox
  // order stops making sense the moment the labels are people's names.
  const available = users.filter((u) => !chosen.has(u.id)).sort(comparePeople);

  const typNazwa = (id: string): string | null =>
    typy.find((typ) => String(typ.id) === id)?.nazwa ?? null;
  const adresNazwa = (id: string): string | null =>
    adresy.find((a) => String(a.id) === id)?.nazwa ?? null;

  /** A community's board, as a meeting snapshots it. */
  const boardOf = (id: string): SpotkanieZarzadOsoba[] =>
    (adresy.find((a) => String(a.id) === id)?.zarzad ?? []).map(({ imieNazwisko, email }) => ({
      imieNazwisko,
      email,
    }));

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

  /**
   * The unit or proxy picked, resolved for saving. A pick that no longer exists
   * (deleted since) keeps the meeting's own snapshot rather than dropping it.
   */
  const resolveZgn = (): Pick<
    SpotkanieInput,
    'zgnJednostkaId' | 'zgnPelnomocnikId' | 'zgnNazwa'
  > => {
    const none = { zgnJednostkaId: null, zgnPelnomocnikId: null, zgnNazwa: '' };
    if (!zgnPick) return none;
    const [kind, raw] = zgnPick.split(':');
    const id = Number(raw);
    if (kind === 'p') {
      const p = zgnPelnomocnicy.find((x) => x.id === id);
      if (p) {
        return {
          zgnJednostkaId: p.jednostkaId,
          zgnPelnomocnikId: p.id,
          zgnNazwa: pelnomocnikLabel(p, zgnJednostki),
        };
      }
    } else {
      const j = zgnJednostki.find((x) => x.id === id);
      if (j) return { zgnJednostkaId: j.id, zgnPelnomocnikId: null, zgnNazwa: j.nazwa };
    }
    return base && zgnPick === zgnPickValue(base.zgnJednostkaId, base.zgnPelnomocnikId)
      ? {
          zgnJednostkaId: base.zgnJednostkaId,
          zgnPelnomocnikId: base.zgnPelnomocnikId,
          zgnNazwa: base.zgnNazwa,
        }
      : none;
  };

  /**
   * Units first, each followed by its proxies — the picker reads as "the unit,
   * or somebody acting for it". A pick that is no longer in the dictionaries
   * stays selectable under its snapshot name, so opening and saving the meeting
   * never silently drops it.
   */
  const zgnOptions: { value: string; label: string; hint?: string; keywords?: string }[] = [
    { value: '', label: t.kalNoZgn },
  ];
  for (const j of zgnJednostki) {
    zgnOptions.push({ value: `j:${j.id}`, label: j.nazwa, hint: j.email || undefined });
    for (const p of zgnPelnomocnicy.filter((x) => x.jednostkaId === j.id)) {
      zgnOptions.push({
        value: `p:${p.id}`,
        label: `↳ ${p.imieNazwisko}`,
        hint: [t.kalZgnProxyOf.replace('{unit}', j.nazwa), p.email].filter(Boolean).join(' · '),
        keywords: `${j.nazwa} ${p.email}`,
      });
    }
  }
  if (zgnPick && !zgnOptions.some((o) => o.value === zgnPick) && base?.zgnNazwa) {
    zgnOptions.push({ value: zgnPick, label: base.zgnNazwa });
  }

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
    onSubmit(
      {
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
        ...resolveZgn(),
        zarzad,
      },
      pendingZadania,
      materialyPotrzebne,
    );
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(860px, 94vw)', maxWidth: 860 }}>
        <ModalDismiss onClose={handleCancel} ariaLabel={t.close} />
        <div className="modal-header">
          {editing ? t.kalEditMeeting : template ? t.kalCloneMeeting : t.kalNewMeeting}
        </div>
        <div className="modal-body">
          {/* The two decisions the user actually makes, first — the title below
              is written from them. */}
          <div className="kal-form-row kal-form-row--two">
            <div className="form-group">
              <label>{t.kalFieldType}</label>
              <Select
                overlay
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
                overlay
                value={adresId}
                options={[
                  { value: '', label: t.kalNoAdres },
                  ...adresy.map((a) => ({ value: String(a.id), label: a.nazwa })),
                ]}
                onChange={(value) => {
                  applyPickers(typId, value);
                  // A different community brings its own board: the list is
                  // replaced, not appended to — the previous board was not
                  // invited to this community's meeting.
                  if (value !== adresId) setZarzad(boardOf(value));
                  // The community's own city unit, offered when nothing is picked
                  // yet — it is almost always the one the meeting is with.
                  const unit = adresy.find((a) => String(a.id) === value)?.zgnJednostkaId;
                  if (!zgnPick && unit != null) setZgnPick(`j:${unit}`);
                }}
                placeholder={t.kalNoAdres}
                searchPlaceholder={t.searchAdres}
                emptyText={t.kalNoResults}
                ariaLabel={t.kalFieldAdres}
              />
            </div>
          </div>

          <div className="form-group">
            <label>{t.kalMaterialsNeeded}</label>
            <div className="kal-pill-switch" role="group" aria-label={t.kalMaterialsNeeded}>
              {[true, false].map((needed) => (
                <button
                  key={String(needed)}
                  type="button"
                  className={`kal-pill-switch__opt${needed ? ' is-yes' : ''}${
                    materialyPotrzebne === needed ? ' is-active' : ''
                  }`}
                  aria-pressed={materialyPotrzebne === needed}
                  onClick={() => setMaterialyPotrzebne(needed)}
                >
                  {needed ? t.kalMaterialsYes : t.kalMaterialsNo}
                </button>
              ))}
            </div>
            <div className="kal-check__hint" style={{ marginTop: '6px' }}>
              {t.kalMaterialsNeededHint}
            </div>
          </div>

          <div className="form-group">
            <label>{t.kalFieldZgn}</label>
            <SearchableSelect
              overlay
              value={zgnPick}
              options={zgnOptions}
              onChange={setZgnPick}
              placeholder={t.kalNoZgn}
              searchPlaceholder={t.kalZgnSearch}
              emptyText={t.kalNoResults}
              ariaLabel={t.kalFieldZgn}
            />
            {zgnJednostki.length === 0 && (
              <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '6px' }}>
                {t.kalZgnNoneYet}
              </div>
            )}
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
                overlay
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

          {(zarzad.length > 0 || boardOf(adresId).length > 0) && (
            <div className="form-group">
              <div className="kal-label-row">
                <label>{t.kalFieldZarzad}</label>
                {/* Back to the community's whole board after people were removed. */}
                {boardOf(adresId).some(
                  (m) => !zarzad.some((z) => z.imieNazwisko === m.imieNazwisko),
                ) && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setZarzad(boardOf(adresId))}
                  >
                    {t.kalZarzadRestore}
                  </button>
                )}
              </div>
              {/* One by one, like the participants: the members not on the
                  meeting yet. A permanently empty value makes it an action
                  picker — each pick adds a person below. */}
              {boardOf(adresId).length > 0 && (
                <SearchableSelect
                  overlay
                  value=""
                  options={boardOf(adresId)
                    .filter((m) => !zarzad.some((z) => z.imieNazwisko === m.imieNazwisko))
                    .map((m) => ({
                      value: m.imieNazwisko,
                      label: m.imieNazwisko,
                      hint: m.email || undefined,
                    }))}
                  onChange={(name) => {
                    const member = boardOf(adresId).find((m) => m.imieNazwisko === name);
                    if (member) setZarzad((prev) => [...prev, member]);
                  }}
                  placeholder={
                    boardOf(adresId).every((m) => zarzad.some((z) => z.imieNazwisko === m.imieNazwisko))
                      ? t.kalZarzadAllAdded
                      : t.kalZarzadAdd
                  }
                  searchPlaceholder={t.kalZarzadSearch}
                  emptyText={t.kalParticipantsNoMatch}
                  disabled={boardOf(adresId).every((m) =>
                    zarzad.some((z) => z.imieNazwisko === m.imieNazwisko),
                  )}
                  ariaLabel={t.kalZarzadAdd}
                />
              )}
              {zarzad.length > 0 ? (
                <div className="kal-people">
                  {zarzad.map((m) => (
                    <span key={m.imieNazwisko} className="kal-person kal-person--board" title={m.email || undefined}>
                      <Icon name="home" size={12} />
                      <span className="kal-person__label">{m.imieNazwisko}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setZarzad((prev) => prev.filter((p) => p.imieNazwisko !== m.imieNazwisko))
                        }
                        title={t.kalParticipantRemove}
                        aria-label={t.kalParticipantRemove}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '12px', opacity: 0.65 }}>{t.kalZarzadNone}</div>
              )}
            </div>
          )}

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
                overlay
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

          <SpotkanieZadania
            zadania={editing ? linkedZadania : []}
            pending={pendingZadania}
            users={users}
            language={language}
            disabled={isSaving}
            onAdd={() => setTaskForm({ editing: null })}
            onPreview={setTaskPreview}
            onEdit={(z) => setTaskForm({ editing: z })}
            onDelete={onDeleteZadanie}
            onOpenBoard={onOpenZadanie}
            onRemovePending={(i) => {
              discardPending([pendingZadania[i]]);
              setPendingZadania((prev) => prev.filter((_, k) => k !== i));
            }}
          />

          {(localError || error) && (
            <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>
              {localError || error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {editing && onClone && (
            <button
              type="button"
              className="button button-secondary"
              style={{ marginRight: 'auto' }}
              onClick={onClone}
              disabled={isSaving}
              title={t.kalCloneHint}
            >
              <Icon name="copy" size={14} /> {t.kalClone}
            </button>
          )}
          <button className="button button-secondary" onClick={handleCancel} disabled={isSaving}>
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

        {/* On document.body so the meeting modal's entry animation (a transform)
            cannot become the task modal's containing block. Kept inside this
            .modal in the React tree: portal clicks bubble through it, and its
            stopPropagation is what keeps them from closing the meeting form. */}
        {taskPreview &&
          createPortal(
            <ZadaniePreviewModal
              key={taskPreview.id}
              language={language}
              zadanie={taskPreview}
              users={users}
              userEmail={userEmail ?? ''}
              onCommentsChange={() => {}}
              onEdit={() => {
                setTaskForm({ editing: taskPreview });
                setTaskPreview(null);
              }}
              onClose={() => setTaskPreview(null)}
            />,
            document.body,
          )}

        {taskForm &&
          createPortal(
            <ZadanieFormModal
              key={taskForm.editing ? `edit-${taskForm.editing.id}` : 'new'}
              language={language}
              editing={taskForm.editing}
              initialStatus="todo"
              initialValues={{
                termin: date || null,
                spotkanieId: editing ? editing.id : null,
              }}
              users={users}
              userEmail={userEmail ?? ''}
              onCommentsChange={() => {}}
              isSaving={taskSaving}
              error={taskError}
              onSubmit={handleTaskSubmit}
              onCancel={closeTask}
            />,
            document.body,
          )}
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
  onClone: () => void;
  onDelete: () => void;
  /** "I have seen that the date moved." */
  onAckTermin: () => void;
  /** Settle a tentative date, or put a settled one back to tentative. */
  onTerminStatus: (status: SpotkanieTerminStatus) => void;
  /** Tick or untick "documents sent", with a note of what went out. */
  onDokumenty: (sent: boolean, opis: string) => void;
  /** Move the materials status: none needed / to prepare / ready. */
  onMaterialy: (status: SpotkanieMaterialyStatus) => void;
  /** Hand this meeting to the Mailing module. Absent when it has no community. */
  onSendMailing?: () => void;
  /** Open one recorded send in the mailing-details window. */
  onOpenMailing: (mailing: SpotkanieMailing) => void;
  /** Which meetings a mailing went out for, plus the types that carry deadlines. */
  docsCtx: SpotkaniaDocsContext;
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
  mailings,
  language,
  locale,
  highlighted,
  busy,
  onEdit,
  onClone,
  onDelete,
  onAckTermin,
  onTerminStatus,
  onDokumenty,
  onSendMailing,
  onOpenMailing,
  docsCtx,
  onMaterialy,
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
  // Either path counts as sent: the manual tick, or a mailing that went out.
  const sent = hasDokumentyOut(spotkanie, docsCtx);
  const overdue = isDokumentyOverdue(spotkanie, docsCtx);
  const daysLeft = daysToDokumentyDeadline(spotkanie, docsCtx);
  // Open only while the user is writing the note; a card is a summary, and this
  // is the one thing on it that takes typing.
  const [editingDocs, setEditingDocs] = useState(false);
  const [docsOpis, setDocsOpis] = useState(spotkanie.dokumentyOpis);
  const materialyMark: Record<SpotkanieMaterialyKrok, string> = {
    do_przygotowania: t.kalMatMarkDo,
    przygotowane: t.kalMatMarkPrzygotowane,
    wyslane: t.kalMatMarkWyslane,
  };
  const materialyBy = (email: string): string => {
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    return user ? personLabel(user) : email;
  };

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
        {spotkanie.zgnNazwa && (
          <span className="kal-place" title={t.kalFieldZgn}>
            <Icon name="shield" size={13} /> {spotkanie.zgnNazwa}
          </span>
        )}
      </div>

      {spotkanie.opis && <p className="kal-card__desc">{spotkanie.opis}</p>}

      {(spotkanie.uczestnicy.length > 0 || spotkanie.zarzad.length > 0) && (
        <div className="kal-people">
          {spotkanie.uczestnicy.map((person) => (
            <span key={person.userId} className="kal-person kal-person--static" title={person.email}>
              <Icon name="users" size={12} />
              <span className="kal-person__label">{personLabel(person)}</span>
            </span>
          ))}
          {spotkanie.zarzad.map((m) => (
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

      <div className="kal-card__foot">
        {spotkanie.createdBy && (
          <span className="kal-card__author">
            {t.kalCreatedBy.replace('{who}', spotkanie.createdBy)}
          </span>
        )}
        <div className="kal-card__actions">
          {tentative ? (
            <button
              className="button button-small button-warning kal-card__action--wide"
              onClick={() => onTerminStatus('potwierdzony')}
              disabled={busy}
              title={t.kalTerminConfirmHint}
            >
              <Icon name="check-circle" size={13} /> {t.kalTerminConfirm}
            </button>
          ) : (
            <button
              className="button button-small button-info kal-card__action--wide"
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
          <button
            className="button button-small button-secondary"
            onClick={onClone}
            disabled={busy}
            title={t.kalCloneHint}
          >
            <Icon name="copy" size={13} /> {t.kalClone}
          </button>
          <button className="button button-small button-danger" onClick={onDelete} disabled={busy}>
            <Icon name="trash" size={13} /> {t.delete}
          </button>
        </div>
      </div>

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

      {/* Materials, walled off like the paperwork below and run the same way:
          where they stand, who moved them last, and one button per step. Each
          step is announced to everyone (Ustawienia → Powiadomienia). Absent
          when the meeting needs none. */}
      {spotkanie.materialyStatus !== 'brak' && (
        <div className={`kal-docs kal-mats kal-mats--${spotkanie.materialyStatus}`}>
          <div className="kal-docs__head">
            <span className="kal-docs__state kal-mats__state">
              <Icon name="briefcase" size={14} />
              {materialyStatusLabel(t, spotkanie.materialyStatus)}
            </span>
          </div>
          {spotkanie.materialyZmienioneAt && spotkanie.materialyZmienioneBy && (
            <span className="kal-docs__stamp">
              {t.kalMaterialsChangedBy
                .replace('{who}', materialyBy(spotkanie.materialyZmienioneBy))
                .replace('{when}', formatStamp(spotkanie.materialyZmienioneAt, locale))}
            </span>
          )}
          <div className="kal-mats__actions">
            {SPOTKANIE_MATERIALY_KROKI.map((krok) => (
              <button
                key={krok}
                type="button"
                className={`button button-small ${
                  spotkanie.materialyStatus === krok ? 'button-success' : 'button-secondary'
                }`}
                onClick={() => onMaterialy(krok)}
                disabled={busy || spotkanie.materialyStatus === krok}
                aria-pressed={spotkanie.materialyStatus === krok}
              >
                <Icon name={spotkanie.materialyStatus === krok ? 'check' : 'arrow-right'} size={13} />{' '}
                {materialyMark[krok]}
              </button>
            ))}
            {SPOTKANIE_MATERIALY_POPRZEDNI[spotkanie.materialyStatus] && (
              <button
                type="button"
                className="button button-small button-secondary kal-mats__undo"
                onClick={() => onMaterialy(SPOTKANIE_MATERIALY_POPRZEDNI[spotkanie.materialyStatus]!)}
                disabled={busy}
                title={t.kalMatUndoHint.replace(
                  '{step}',
                  materialyStatusLabel(t, SPOTKANIE_MATERIALY_POPRZEDNI[spotkanie.materialyStatus]!),
                )}
              >
                <Icon name="undo" size={13} /> {t.kalMatUndo}
              </button>
            )}
          </div>
        </div>
      )}

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
  onOpenZadanie,
  focusRequest = null,
  onFocusHandled,
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
  const [zadania, setZadania] = useState<Zadanie[]>([]);
  const [zgnJednostki, setZgnJednostki] = useState<ZgnJednostka[]>([]);
  const [zgnPelnomocnicy, setZgnPelnomocnicy] = useState<ZgnPelnomocnik[]>([]);
  // The task form opened from a meeting card: which meeting, and the task being
  // edited (null for a new one).
  const [cardTask, setCardTask] = useState<{
    spotkanie: Spotkanie;
    editing: Zadanie | null;
  } | null>(null);
  const [cardTaskSaving, setCardTaskSaving] = useState(false);
  // A task opened to read from a meeting card, with the meeting it belongs to.
  const [taskPreview, setTaskPreview] = useState<{ spotkanie: Spotkanie; zadanie: Zadanie } | null>(
    null,
  );
  const [cardTaskError, setCardTaskError] = useState<string | null>(null);
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
  // null = closed; otherwise the meeting being edited (or null), the day, and —
  // for a clone — the meeting whose fields the new one starts with.
  const [form, setForm] = useState<{
    editing: Spotkanie | null;
    day: string;
    template?: Spotkanie;
  } | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [countTip, setCountTip] = useState<CountTipState | null>(null);
  /**
   * The month as a grid with one day open beside it, or every meeting of the
   * month as full cards, one after another. Remembered on this computer only — a
   * way of looking, not data.
   */
  const [viewMode, setViewModeState] = useState<'month' | 'list'>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'month';
    } catch {
      return 'month';
    }
  });
  const setViewMode = (mode: 'month' | 'list') => {
    setViewModeState(mode);
    setTip(null);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Storage refused: the choice simply lasts until the view closes.
    }
  };
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
    await Promise.all([loadZadania(), loadZgn()]);
  };

  /** Apart too: without the units the picker is only empty, the calendar still works. */
  const loadZgn = async () => {
    try {
      const [jednostki, pelnomocnicy] = await Promise.all([
        window.electronAPI.mailingGetZgn(),
        window.electronAPI.getZgnPelnomocnicy(),
      ]);
      setZgnJednostki(jednostki);
      setZgnPelnomocnicy(pelnomocnicy);
    } catch {
      setZgnPelnomocnicy([]);
    }
  };

  /** Apart from the calendar: a board that fails to load only hides the meetings' tasks. */
  const loadZadania = async () => {
    try {
      setZadania(await window.electronAPI.getZadania());
    } catch {
      setZadania([]);
    }
  };

  /* ------------------------------ Derived data ----------------------------- */

  /** Each meeting's tasks, archived ones left out — they are off the board too. */
  const zadaniaBySpotkanie = useMemo(() => {
    const map = new Map<number, Zadanie[]>();
    for (const z of zadania) {
      if (z.spotkanieId === null || z.zarchiwizowane) continue;
      const bucket = map.get(z.spotkanieId);
      if (bucket) bucket.push(z);
      else map.set(z.spotkanieId, [z]);
    }
    return map;
  }, [zadania]);

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
  /**
   * Per type, how many meetings the month on screen and its whole year hold —
   * the "3/13" on each filter chip. Like the month bar, these count what is
   * scheduled, not what the search lets through. Key `null` is every type.
   */
  const typCounts = useMemo(() => {
    const yearPrefix = `${monthKey.slice(0, 4)}-`;
    const counts = new Map<number | null, { month: number; year: number }>();
    const bump = (key: number | null, inMonth: boolean) => {
      const c = counts.get(key) ?? { month: 0, year: 0 };
      c.year += 1;
      if (inMonth) c.month += 1;
      counts.set(key, c);
    };
    for (const s of spotkania) {
      const day = toDayKey(s.startsAt);
      if (!day.startsWith(yearPrefix)) continue;
      const inMonth = monthOfDayKey(day) === monthKey;
      bump(null, inMonth);
      if (s.typId !== null) bump(s.typId, inMonth);
    }
    return counts;
  }, [spotkania, monthKey]);
  const countOf = (key: number | null) => typCounts.get(key) ?? { month: 0, year: 0 };

  const byDay = useMemo(() => groupByDay(filtered, locale), [filtered, locale]);
  /** The list view: the month's filtered meetings, by day, earliest first. */
  const listDays = useMemo(() => {
    if (viewMode !== 'list') return [];
    const grouped = groupByDay(spotkaniaInMonth(filtered, monthKey), locale);
    return [...grouped.keys()].sort().map((day) => ({ day, meetings: grouped.get(day) ?? [] }));
  }, [viewMode, filtered, monthKey, locale]);
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

  /** A new meeting with every field of `source` — saving adds, never overwrites. */
  const openClone = (source: Spotkanie) => {
    setFormError(null);
    setForm({ editing: null, day: toDayKey(source.startsAt), template: source });
    // The modal covers the chip, so its mouseleave may never fire.
    setTip(null);
  };

  /** Hang the month/year count card under whatever it explains. */
  const showCountTip = (
    event: React.SyntheticEvent<HTMLElement>,
    label: string,
    color: string | null,
    key: number | null,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCountTip({
      label,
      color,
      ...countOf(key),
      left: Math.max(
        TIP_MARGIN,
        Math.min(rect.left, window.innerWidth - COUNT_TIP_WIDTH - TIP_MARGIN),
      ),
      top: rect.bottom + TIP_MARGIN,
    });
  };
  const hideCountTip = () => setCountTip(null);

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

  const handleSubmit = async (
    input: SpotkanieInput,
    pendingZadania: ZadanieInput[],
    materialyPotrzebne: boolean,
  ) => {
    setIsSaving(true);
    setFormError(null);
    try {
      if (form?.editing) {
        await window.electronAPI.updateSpotkanie(form.editing.id, input);
        // The form only says needed or not: unticking drops the materials,
        // ticking a meeting that had none makes them needed, and a meeting
        // already under way keeps the step it reached.
        const was = form.editing.materialyStatus;
        if (!materialyPotrzebne && was !== 'brak') {
          await window.electronAPI.setSpotkanieMaterialy(form.editing.id, 'brak');
        } else if (materialyPotrzebne && was === 'brak') {
          await window.electronAPI.setSpotkanieMaterialy(form.editing.id, 'potrzebne');
        }
      } else {
        const created = await window.electronAPI.addSpotkanie(input);
        if (materialyPotrzebne) {
          await window.electronAPI.setSpotkanieMaterialy(created.id, 'potrzebne');
        }
        // The meeting exists now, so the tasks written for it can point at it.
        // One that fails is said out loud; the meeting itself is already saved.
        for (const z of pendingZadania) {
          try {
            await window.electronAPI.addZadanie({ ...z, spotkanieId: created.id });
          } catch (err: unknown) {
            notify.error(err instanceof Error ? err.message : t.zadSaveError);
          }
        }
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

  const handleMaterialy = (spotkanie: Spotkanie, status: SpotkanieMaterialyStatus) =>
    runOnMeeting(
      spotkanie.id,
      () => window.electronAPI.setSpotkanieMaterialy(spotkanie.id, status),
      t.kalMaterialsSavedDone,
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

  /** Delete a meeting's task — from its card or from its form. */
  const handleDeleteZadanie = async (z: Zadanie) => {
    if (!(await notify.confirm(t.zadConfirmDelete.replace('{title}', z.tytul), { danger: true }))) {
      return;
    }
    try {
      await window.electronAPI.deleteZadanie(z.id);
      notify.success(t.kalTaskDeleted);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : t.zadSaveError);
    }
    await loadZadania();
  };

  const handleCardTaskSubmit = async (input: ZadanieInput) => {
    if (!cardTask) return;
    setCardTaskSaving(true);
    setCardTaskError(null);
    try {
      if (cardTask.editing) {
        await window.electronAPI.updateZadanie(cardTask.editing.id, input);
        notify.success(t.kalTaskUpdated);
      } else {
        await window.electronAPI.addZadanie({ ...input, spotkanieId: cardTask.spotkanie.id });
        notify.success(t.kalTaskAdded);
      }
      setCardTask(null);
      await loadZadania();
    } catch (err: unknown) {
      setCardTaskError(err instanceof Error ? err.message : t.zadSaveError);
    } finally {
      setCardTaskSaving(false);
    }
  };

  const openCardTask = (spotkanie: Spotkanie, editing: Zadanie | null) => {
    setCardTaskError(null);
    setCardTask({ spotkanie, editing });
  };

  // A meeting link followed from the board: its month, its day, the card lit.
  useEffect(() => {
    if (!focusRequest || isLoading) return;
    const target = spotkania.find((s) => s.id === focusRequest.spotkanieId);
    if (target) {
      selectDay(toDayKey(target.startsAt), target.id);
      if (focusRequest.edit) openForm(toDayKey(target.startsAt), target);
    }
    onFocusHandled?.();
    // Only a new request moves the view; later reloads must not pull it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, isLoading]);

  /* ------------------------------- Rendering ------------------------------- */

  if (isLoading) {
    return (
      <div className="content-body">
        <Loader label={t.loading} />
      </div>
    );
  }

  /** One meeting, in full — the day panel and the list view show the same card. */
  const renderMeetingCard = (s: Spotkanie) => (
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
      onClone={() => openClone(s)}
      onDelete={() => void handleDelete(s)}
      onAckTermin={() => void handleAckTermin(s)}
      onTerminStatus={(status) => void handleTerminStatus(s, status)}
      onDokumenty={(sent, opis) => void handleDokumenty(s, sent, opis)}
      onMaterialy={(status) => void handleMaterialy(s, status)}
      onSendMailing={
        onSendDocuments && s.adresId !== null
          ? () => handleSendMailing(s)
          : undefined
      }
      onOpenMailing={(m) => void openMailingDetails(m)}
      docsCtx={docsCtx}
      zadania={zadaniaBySpotkanie.get(s.id) ?? []}
      users={users}
      onAddTask={() => openCardTask(s, null)}
      onPreviewTask={(z) => setTaskPreview({ spotkanie: s, zadanie: z })}
      onEditTask={(z) => openCardTask(s, z)}
      onDeleteTask={(z) => void handleDeleteZadanie(z)}
      onOpenTask={onOpenZadanie ? (z) => onOpenZadanie(z.id) : undefined}
    />
  );

  const monthNumber = Number(monthKey.split('-')[1]) || 1;
  const monthName = monthLabel(monthKey, locale).replace(/\s*\d{4}$/, '');
  const year = monthKey.split('-')[0];
  const searchActive = search.trim().length > 0;

  const facts = [`${t.kalFactsUpcoming}: ${upcoming.length}`];
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
            <p className="ksieg-hero__facts">
              {/* Month / year, explained on hover — the same figure the type
                  chips carry, for every type at once. */}
              <span
                className="kal-count-fact"
                tabIndex={0}
                onMouseEnter={(e) => showCountTip(e, t.kalAllTypes, null, null)}
                onMouseLeave={hideCountTip}
                onFocus={(e) => showCountTip(e, t.kalAllTypes, null, null)}
                onBlur={hideCountTip}
              >
                {t.kalFactsCount}:{' '}
                <strong>
                  {countOf(null).month}/{countOf(null).year}
                </strong>
              </span>
              {facts.map((f) => ` · ${f}`).join('')}
            </p>
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
              overlay
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
              onMouseEnter={(e) => showCountTip(e, t.kalAllTypes, null, null)}
              onMouseLeave={hideCountTip}
              onFocus={(e) => showCountTip(e, t.kalAllTypes, null, null)}
              onBlur={hideCountTip}
            >
              {t.kalAllTypes}
              <span className="kal-filter__count">
                {countOf(null).month}/{countOf(null).year}
              </span>
            </button>
            {typy.map((typ) => (
              <button
                key={typ.id}
                type="button"
                className={`kal-filter${typFilter === typ.id ? ' is-active' : ''}`}
                style={{ ['--chip' as string]: normalizeHexColor(typ.kolor) }}
                onClick={() => setTypFilter(typFilter === typ.id ? null : typ.id)}
                aria-pressed={typFilter === typ.id}
                onMouseEnter={(e) =>
                  showCountTip(e, typ.nazwa, normalizeHexColor(typ.kolor), typ.id)
                }
                onMouseLeave={hideCountTip}
                onFocus={(e) => showCountTip(e, typ.nazwa, normalizeHexColor(typ.kolor), typ.id)}
                onBlur={hideCountTip}
              >
                <span className="kal-chip__dot" />
                {typ.nazwa}
                <span className="kal-filter__count">
                  {countOf(typ.id).month}/{countOf(typ.id).year}
                </span>
              </button>
            ))}

          </div>

          <div className="kal-view-toggle" role="group" aria-label={t.kalViewLabel}>
            <button
              type="button"
              className={viewMode === 'month' ? 'is-active' : ''}
              aria-pressed={viewMode === 'month'}
              onClick={() => setViewMode('month')}
            >
              <Icon name="calendar" size={14} /> {t.kalViewMonth}
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'is-active' : ''}
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            >
              <Icon name="menu" size={14} /> {t.kalViewList}
            </button>
          </div>

          <button
            type="button"
            className="button button-primary kal-new"
            onClick={() => openForm(selectedDay)}
          >
            <Icon name="plus" size={14} /> {t.kalNewMeeting}
          </button>
        </div>

        {/* ------------------- The list: the whole month ------------------- */}
        {viewMode === 'list' && (
          <div className="kal-list">
            {listDays.length === 0 ? (
              <div className="kal-side__empty">
                <Icon name="calendar" size={26} />
                <span>
                  {searchActive || typFilter !== null || stateFilter !== 'all'
                    ? t.kalNoResults
                    : t.kalMonthEmpty}
                </span>
              </div>
            ) : (
              listDays.map(({ day, meetings }) => (
                <section key={day} className="kal-list__day">
                  <div className={`kal-list__head${day === todayKey() ? ' is-today' : ''}`}>
                    <h3>{formatDayLabel(day, locale)}</h3>
                    <span className="kal-list__count">{meetingsCount(meetings.length, language)}</span>
                    <button
                      type="button"
                      className="button button-small button-secondary"
                      onClick={() => openForm(day)}
                    >
                      <Icon name="plus" size={13} /> {t.add}
                    </button>
                  </div>
                  <div className="kal-list__cards">{meetings.map(renderMeetingCard)}</div>
                </section>
              ))
            )}
          </div>
        )}

        {/* ---------------------- The month and the day --------------------- */}
        {viewMode === 'month' && (
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
                                {s.materialyStatus !== 'brak' && (
                                  <span
                                    className={`kal-chip__mat kal-chip__mat--${s.materialyStatus}`}
                                    aria-label={materialyStatusLabel(t, s.materialyStatus)}
                                  >
                                    <Icon name="briefcase" size={11} />
                                  </span>
                                )}
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
                    {dayMeetings.map(renderMeetingCard)}
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
        )}
      </div>

      {/* Hover card for a chip in the grid. A native `title` waits about a
          second before it appears, and a cell is exactly where the user is
          scanning quickly — so this is rendered here, positioned in the
          viewport, and therefore never clipped by the grid's rounded overflow. */}
      {countTip && (
        <div
          className="kal-count-tip"
          role="tooltip"
          style={{
            left: countTip.left,
            top: countTip.top,
            ['--chip' as string]: countTip.color ?? 'var(--accent)',
          }}
        >
          <div className="kal-count-tip__head">
            <span className="kal-chip__dot" />
            {countTip.label}
          </div>
          <div className="kal-count-tip__row">
            <span>
              {t.kalCountTipMonth} · {monthLabel(monthKey, locale)}
            </span>
            <strong>{meetingsCount(countTip.month, language)}</strong>
          </div>
          <div className="kal-count-tip__row">
            <span>{t.kalCountTipYear.replace('{year}', year)}</span>
            <strong>{meetingsCount(countTip.year, language)}</strong>
          </div>
          {countTip.year > 0 && (
            <>
              <div className="kal-count-tip__bar">
                <span
                  style={{ width: `${Math.round((countTip.month / countTip.year) * 100)}%` }}
                />
              </div>
              <div className="kal-count-tip__share">
                {t.kalCountTipShare.replace(
                  '{pct}',
                  String(Math.round((countTip.month / countTip.year) * 100)),
                )}
              </div>
            </>
          )}
        </div>
      )}

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
          {tip.spotkanie.materialyStatus !== 'brak' && (
            <div className="kal-tip__line">
              <span className={`kal-chip__mat kal-chip__mat--${tip.spotkanie.materialyStatus}`}>
                <Icon name="briefcase" size={12} />
                {materialyStatusLabel(t, tip.spotkanie.materialyStatus)}
              </span>
            </div>
          )}
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
          key={
            form.editing
              ? `edit-${form.editing.id}`
              : form.template
                ? `clone-${form.template.id}`
                : `new-${form.day}`
          }
          language={language}
          editing={form.editing}
          template={form.template ?? null}
          onClone={form.editing ? () => openClone(form.editing as Spotkanie) : undefined}
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
          zgnJednostki={zgnJednostki}
          zgnPelnomocnicy={zgnPelnomocnicy}
          linkedZadania={form.editing ? zadaniaBySpotkanie.get(form.editing.id) ?? [] : []}
          onZadaniaChanged={() => void loadZadania()}
          onDeleteZadanie={(z) => void handleDeleteZadanie(z)}
          onOpenZadanie={onOpenZadanie ? (z) => onOpenZadanie(z.id) : undefined}
        />
      )}

      {taskPreview && (
        <ZadaniePreviewModal
          key={taskPreview.zadanie.id}
          language={language}
          zadanie={taskPreview.zadanie}
          spotkanie={taskPreview.spotkanie}
          users={users}
          userEmail={userEmail ?? ''}
          onCommentsChange={() => {}}
          onEdit={() => {
            openCardTask(taskPreview.spotkanie, taskPreview.zadanie);
            setTaskPreview(null);
          }}
          onClose={() => setTaskPreview(null)}
        />
      )}

      {cardTask && (
        <ZadanieFormModal
          key={cardTask.editing ? `edit-${cardTask.editing.id}` : `new-${cardTask.spotkanie.id}`}
          language={language}
          editing={cardTask.editing}
          initialStatus="todo"
          initialValues={{
            termin: toDayKey(cardTask.spotkanie.startsAt),
            spotkanieId: cardTask.spotkanie.id,
          }}
          users={users}
          userEmail={userEmail ?? ''}
          onCommentsChange={() => {}}
          isSaving={cardTaskSaving}
          error={cardTaskError}
          onSubmit={(input) => void handleCardTaskSubmit(input)}
          onCancel={() => setCardTask(null)}
        />
      )}
    </div>
  );
};

export default Kalendarz;
