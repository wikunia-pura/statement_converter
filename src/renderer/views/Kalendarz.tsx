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
  SpotkanieMaterialyStatus,
  SPOTKANIE_MATERIALY_STATUSES,
  SpotkanieTyp,
  Zadanie,
  ZadanieInput,
  ZgnJednostka,
  ZgnPelnomocnik,
  Zebranie,
  ZebranieStatusRow,
} from '../../shared/types';
import { latestWersja } from '../../shared/zebrania';
import { useRequestSeq } from '../hooks/useRequestSeq';
import { ipcErrorMessage, isIpcError } from '../ipcError';
import { useStableCallback } from '../hooks/useStableCallback';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import Select from '../components/Select';
import ModalDismiss from '../components/Modal';
import MailingDetailsModal from '../components/MailingDetailsModal';
import { ZadanieFormModal, ZadaniePreviewModal } from './Zadania';
import ZawiadomienieModal from '../components/ZawiadomienieModal';
import KalendarzPdfModal from '../components/KalendarzPdfModal';
import { formatDayKey } from '../../shared/zadania';
import MonthIllustration, { monthAccent } from '../components/MonthIllustration';
import {
  buildMonthGrid,
  currentMonthKey,
  formatDayLabel,
  formatStamp,
  groupByDay,
  countAlerts,
  lokalizacjaLabel,
  matchesSpotkanieSearch,
  isMaterialyOverdue,
  matchesMaterialyFilter,
  matchesStateFilter,
  matchesTypFilter,
  SpotkaniaAlerts,
  SpotkanieStateFilter,
  monthLabel,
  monthOfDayKey,
  monthsWithSpotkania,
  normalizeHexColor,
  shiftMonthKey,
  sortSpotkania,
  spotkaniaInMonth,
  toDayKey,
  todayKey,
  weekdayLabels,
  typOf,
  upcomingSpotkania,
} from '../../shared/calendar';
import { reloadFromServer } from '../dataCache';
import {
  type KalendarzPreloaded,
  createHoverStore,
  type CountTipState,
  meetingsCount,
  type TipState,
  materialyStatusLabel,
} from '../components/kalendarz/kalendarzShared';
import { SpotkanieFormModal } from '../components/kalendarz/SpotkanieFormModal';
import { MeetingCard } from '../components/kalendarz/MeetingCard';
import { MeetingHoverCard, CountHoverCard, MonthGrid } from '../components/kalendarz/MonthGrid';

// Names other screens import from this view.
export { SpotkanieEditModal } from '../components/kalendarz/SpotkanieEditModal';
export { materialyStatusLabel } from '../components/kalendarz/kalendarzShared';
export type { KalendarzPreloaded } from '../components/kalendarz/kalendarzShared';

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
  /** Open a meeting's materials entry in the Zebrania module. */
  onOpenZebranie?: (zebranieId: number) => void;
  /** "Mailing → Szablony" — the notice flow's way out when no notice template exists. */
  onOpenSzablony?: () => void;
  /**
   * Show just one meeting's card, in a window — the same card, with the same
   * buttons, as the day panel — for a screen that is not the calendar (Zebrania).
   */
  cardOnly?: {
    spotkanieId: number;
    onClose: () => void;
    /**
     * What the host screen already holds, so the one card does not load the
     * whole calendar to show itself: Zebrania has the meetings, places,
     * communities, city units and its own entries at hand.
     */
    preloaded?: KalendarzPreloaded;
  };
}

/** A full Zebrania entry as the calendar keeps it — see `ZebranieStatusRow`. */
const zebranieStatusOf = (z: Zebranie): ZebranieStatusRow => {
  const w = latestWersja(z);
  return {
    id: z.id,
    spotkanieId: z.spotkanieId,
    wersja: w ? { id: w.id, major: w.major, minor: w.minor, status: w.status, gotowe: w.gotowe } : null,
  };
};

/**
 * The two things that can be wrong with a meeting's date, in the order they
 * matter — the warning strip above the month. Materials past their deadline are
 * not here: they are a chip in the materials row, beside the other materials
 * states, so one state never has two controls.
 */
const ALERT_KINDS: {
  filter: SpotkanieStateFilter;
  count: (alerts: SpotkaniaAlerts) => number;
  tone: 'changed' | 'tentative';
  icon: React.ComponentProps<typeof Icon>['name'];
  label: 'kalWarnChanged' | 'kalWarnTentative';
}[] = [
  {
    filter: 'changed',
    count: (a) => a.changed,
    tone: 'changed',
    icon: 'alert-triangle',
    label: 'kalWarnChanged',
  },
  {
    filter: 'tentative',
    count: (a) => a.tentative,
    tone: 'tentative',
    icon: 'clock',
    label: 'kalWarnTentative',
  },
];

/** Hover card geometry — kept in step with `.kal-tip` in the stylesheet. */
const TIP_WIDTH = 300;
const TIP_MARGIN = 8;

/** Where the month/list choice is remembered (per computer). */
const VIEW_MODE_KEY = 'kalendarz.viewMode';

/** Width of the month/year count card — kept in step with `.kal-count-tip`. */
const COUNT_TIP_WIDTH = 240;

/** The materials state as a filter chip — the row is already titled "Materiały". */
function materialyFilterLabel(
  t: (typeof translations)['pl'],
  status: SpotkanieMaterialyStatus,
): string {
  return {
    brak: t.kalMatFilterBrak,
    potrzebne: t.kalMatFilterPotrzebne,
    do_przygotowania: t.kalMatFilterDo,
    przygotowane: t.kalMatFilterPrzygotowane,
    wyslane: t.kalMatFilterWyslane,
  }[status];
}

/** A materials filter chip's colour — the tone its badge on the card wears. */
const MATERIALY_DOT: Record<SpotkanieMaterialyStatus, string> = {
  brak: 'var(--text-tertiary)',
  potrzebne: 'var(--text-tertiary)',
  do_przygotowania: 'var(--warning)',
  przygotowane: 'var(--info)',
  wyslane: 'var(--success)',
};

/* ================================ The view ================================= */

/**
 * A meeting's Kalendarz card in a window, from anywhere: the calendar's own
 * component in its one-card mode, so every button on it works as it does there.
 */
export const SpotkanieKartaModal: React.FC<{
  language: Language;
  userEmail?: string;
  spotkanieId: number;
  onClose: () => void;
  onOpenSzablony?: () => void;
  /** What the host already holds — see `KalendarzPreloaded`. */
  preloaded?: KalendarzPreloaded;
}> = ({ language, userEmail, spotkanieId, onClose, onOpenSzablony, preloaded }) => {
  const [monthKey, setMonthKey] = useState(() => monthOfDayKey(todayKey()));
  const [stateFilter, setStateFilter] = useState<SpotkanieStateFilter>('all');
  return (
    <Kalendarz
      language={language}
      monthKey={monthKey}
      setMonthKey={setMonthKey}
      stateFilter={stateFilter}
      setStateFilter={setStateFilter}
      userEmail={userEmail}
      onOpenSzablony={onOpenSzablony}
      cardOnly={{ spotkanieId, onClose, preloaded }}
    />
  );
};

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
  onOpenZebranie,
  onOpenSzablony,
  cardOnly,
}) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  /** Zebrania entries — which meetings already have one, and at which version. */
  const [zebrania, setZebrania] = useState<ZebranieStatusRow[]>([]);
  /** The meeting whose notice is open in the full-screen editor. */
  const [zawiadomienieFor, setZawiadomienieFor] = useState<number | null>(null);
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
  const [materialyFilter, setMaterialyFilter] = useState<SpotkanieMaterialyStatus | null>(null);
  /** Meeting id being written to, so its own buttons disable and nothing else does. */
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  /** The "PDF" window — which month or period goes into the file. */
  const [pdfOpen, setPdfOpen] = useState(false);
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
  // The two hover cards live in stores of their own, so showing one re-renders
  // the card and not the calendar — see `HoverStore`.
  const [tipStore] = useState(() => createHoverStore<TipState>());
  const [countTipStore] = useState(() => createHoverStore<CountTipState>());
  const setTip = tipStore.set;
  const setCountTip = countTipStore.set;
  /** Overlapping reloads: only the newest one's answer lands (see useRequestSeq). */
  const loadSeq = useRequestSeq();
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
    const ticket = loadSeq.next();
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    // The one-card mode opened from Zebrania starts from what that screen holds;
    // a later full refresh reads everything again.
    const pre = !silent ? cardOnly?.preloaded : undefined;
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
        pre?.spotkania ?? window.electronAPI.getSpotkania(),
        window.electronAPI.getSpotkaniaTypy(),
        pre?.lokalizacje ?? window.electronAPI.getSpotkaniaLokalizacje(),
        pre?.adresy ?? window.electronAPI.getAdresy(),
        window.electronAPI.getAppUsers(),
        window.electronAPI.getSpotkaniaMailingi(),
        // The hover card belongs to the month grid, which one card does not show.
        cardOnly ? null : window.electronAPI.getSettings(),
      ]);
      if (!loadSeq.isLatest(ticket)) return;
      setSpotkania(spotkaniaData);
      setTypy(typyData);
      setLokalizacje(lokalizacjeData);
      setAdresy(adresyData);
      setUsers(usersData);
      setMailingi(mailingiData);
      if (settings) setHoverCard(settings.calendarHoverCard ?? false);
    } catch (err) {
      if (loadSeq.isLatest(ticket)) notify.error(t.kalLoadError);
    } finally {
      // An older load ending must not end the newer one's loader.
      if (loadSeq.isLatest(ticket)) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
    if (!loadSeq.isLatest(ticket)) return;
    await Promise.all([
      loadZadania(),
      loadZgn(pre?.zgnJednostki),
      pre ? setZebrania(pre.zebrania.map(zebranieStatusOf)) : loadZebrania(),
    ]);
  };

  /**
   * Apart as well: without the entries the cards only lose their Zebrania line.
   * Reloaded after every write that can move them — a materials status moved
   * here has moved the newest version with it (main process). Only what the
   * cards show: which meeting, and the newest version's state.
   */
  const loadZebrania = async () => {
    try {
      setZebrania(await window.electronAPI.getZebraniaStatus());
    } catch {
      setZebrania([]);
    }
  };

  /** Apart too: without the units the picker is only empty, the calendar still works. */
  const loadZgn = async (jednostkiPreloaded?: ZgnJednostka[]) => {
    try {
      const [jednostki, pelnomocnicy] = await Promise.all([
        jednostkiPreloaded ?? window.electronAPI.mailingGetZgn(),
        window.electronAPI.getZgnPelnomocnicy(),
      ]);
      setZgnJednostki(jednostki);
      setZgnPelnomocnicy(pelnomocnicy);
    } catch {
      setZgnPelnomocnicy([]);
    }
  };

  /** The meetings' sends, after one was made from here. */
  const loadMailingi = async () => {
    try {
      setMailingi(await window.electronAPI.getSpotkaniaMailingi());
    } catch {
      // The card keeps the list it had; a full refresh reads it again.
    }
  };

  /**
   * Re-read one meeting after a write to it, rather than the whole calendar —
   * the row may have moved under us (shared data), so it is read back, not
   * patched from what was sent. Gone (deleted elsewhere) = taken off the list.
   */
  const refreshSpotkanie = async (id: number) => {
    let fresh: Spotkanie | null;
    try {
      fresh = await window.electronAPI.getSpotkanie(id);
    } catch {
      // The write itself went through; only reading it back failed — as with a
      // failed reload, the calendar says so and keeps what it shows.
      notify.error(t.kalLoadError);
      return;
    }
    putSpotkanie(id, fresh);
  };

  /** One meeting in place of the copy on screen; null takes it off the list. */
  const putSpotkanie = (id: number, row: Spotkanie | null) => {
    setSpotkania((prev) => {
      const rest = prev.filter((s) => s.id !== id);
      if (!row) return rest;
      // Same order as the table hands them over: newest first, then by id.
      return [...rest, row].sort(
        (a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt) || a.id - b.id,
      );
    });
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

  /** Each meeting's Zebrania entry, by meeting. */
  const zebranieBySpotkanie = useMemo(() => {
    const map = new Map<number, ZebranieStatusRow>();
    for (const z of zebrania) if (z.spotkanieId !== null && !map.has(z.spotkanieId)) map.set(z.spotkanieId, z);
    return map;
  }, [zebrania]);

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


  const filtered = useMemo(
    () =>
      spotkania.filter(
        (s) =>
          matchesTypFilter(s, typFilter) &&
          matchesMaterialyFilter(s, materialyFilter) &&
          matchesStateFilter(s, stateFilter, typy) &&
          matchesSpotkanieSearch(s, typy, search),
      ),
    [spotkania, typy, typFilter, materialyFilter, stateFilter, search],
  );

  /**
   * What the strip above the month announces, counted over the month on screen
   * rather than the whole database — the answer should be about the month you
   * are looking at.
   */
  const alerts = useMemo(
    () => countAlerts(spotkaniaInMonth(spotkania, monthKey), typy),
    [spotkania, monthKey, typy],
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

  /** The same month/year figures per materials state — the materials chips' "3/13". */
  const materialyCounts = useMemo(() => {
    const yearPrefix = `${monthKey.slice(0, 4)}-`;
    const counts = new Map<SpotkanieMaterialyStatus, { month: number; year: number }>();
    for (const s of spotkania) {
      const day = toDayKey(s.startsAt);
      if (!day.startsWith(yearPrefix)) continue;
      const c = counts.get(s.materialyStatus) ?? { month: 0, year: 0 };
      c.year += 1;
      if (monthOfDayKey(day) === monthKey) c.month += 1;
      counts.set(s.materialyStatus, c);
    }
    return counts;
  }, [spotkania, monthKey]);
  const materialyCountOf = (status: SpotkanieMaterialyStatus) =>
    materialyCounts.get(status) ?? { month: 0, year: 0 };

  /** Materials past their deadline, month / year — the "Po terminie" chip. */
  const overdueCounts = useMemo(() => {
    const yearPrefix = `${monthKey.slice(0, 4)}-`;
    const now = new Date();
    const c = { month: 0, year: 0 };
    for (const s of spotkania) {
      const day = toDayKey(s.startsAt);
      if (!day.startsWith(yearPrefix) || !isMaterialyOverdue(s, typy, now)) continue;
      c.year += 1;
      if (monthOfDayKey(day) === monthKey) c.month += 1;
    }
    return c;
  }, [spotkania, typy, monthKey]);

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
   * "PDF": a month or a period, filters and all, as a file in Downloads. Only
   * which meetings and why travels — main reads them again from the database.
   */
  const downloadPdf = async (okresOd: string, okresDo: string) => {
    setPdfBusy(true);
    try {
      const { filePath } = await window.electronAPI.exportKalendarzPdf({
        okresOd,
        okresDo,
        spotkanieIds: filtered
          .filter((s) => {
            const day = toDayKey(s.startsAt);
            return day >= okresOd && day <= okresDo;
          })
          .map((s) => s.id),
        typId: typFilter,
        stan: stateFilter,
        materialy: materialyFilter,
        szukaj: search,
      });
      notify.success(t.kalPdfDone.replace('{file}', filePath.split(/[\\/]/).pop() ?? filePath), {
        file: filePath,
      });
      setPdfOpen(false);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected), t.kalPdfError);
    } finally {
      setPdfBusy(false);
    }
  };

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
    counts: { month: number; year: number },
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCountTip({
      label,
      color,
      ...counts,
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

  // For the memoized grid: one identity each for the view's whole life.
  const selectDayStable = useStableCallback(selectDay);
  const openFormStable = useStableCallback(openForm);
  const showTipStable = useStableCallback(showTip);
  const hideTip = useStableCallback(() => setTip(null));

  /**
   * A meeting that needs materials gets its entry in Zebrania as soon as it is
   * saved — that is where the materials are prepared. Unticking materials later
   * leaves the entry alone: it may already hold a prepared notice.
   *
   * The meeting itself is already saved by then, so a failure here is said out
   * loud but does not fail the save; "Przygotuj materiały" on the card can still
   * create the entry later.
   */
  const ensureZebranie = async (spotkanieId: number) => {
    const had = zebranieBySpotkanie.has(spotkanieId);
    try {
      await window.electronAPI.ensureZebranieForSpotkanie(spotkanieId);
      if (!had) notify.success(t.zebraniaAutoCreated);
    } catch (err: unknown) {
      notify.error(
        `${t.zebraniaAutoCreateError}: ${ipcErrorMessage(err, t.errorUnexpected)}`,
      );
    }
  };

  const handleSubmit = async (
    input: SpotkanieInput,
    pendingZadania: ZadanieInput[],
    materialyPotrzebne: boolean,
  ) => {
    setIsSaving(true);
    setFormError(null);
    try {
      let savedId: number;
      // The meeting as the save returned it — null once a later write (the
      // materials status) has moved it on, and it has to be read back instead.
      let saved: Spotkanie | null;
      if (form?.editing) {
        savedId = form.editing.id;
        // Only over the meeting as the form loaded it: one saved since by somebody else is refused.
        saved = await window.electronAPI.updateSpotkanie(form.editing.id, input, form.editing.updatedAt);
        // The form only says needed or not: unticking drops the materials,
        // ticking a meeting that had none makes them needed, and a meeting
        // already under way keeps the step it reached.
        const was = form.editing.materialyStatus;
        if (!materialyPotrzebne && was !== 'brak') {
          await window.electronAPI.setSpotkanieMaterialy(form.editing.id, 'brak');
          saved = null;
        } else if (materialyPotrzebne && was === 'brak') {
          await window.electronAPI.setSpotkanieMaterialy(form.editing.id, 'potrzebne');
          saved = null;
        }
        if (materialyPotrzebne) await ensureZebranie(form.editing.id);
      } else {
        const created = await window.electronAPI.addSpotkanie(input);
        savedId = created.id;
        saved = created;
        if (materialyPotrzebne) {
          await window.electronAPI.setSpotkanieMaterialy(created.id, 'potrzebne');
          saved = null;
          await ensureZebranie(created.id);
        }
        // The meeting exists now, so the tasks written for it can point at it.
        // One that fails is said out loud; the meeting itself is already saved.
        for (const z of pendingZadania) {
          try {
            await window.electronAPI.addZadanie({ ...z, spotkanieId: created.id });
          } catch (err: unknown) {
            notify.error(ipcErrorMessage(err, t.zadSaveError));
          }
        }
      }
      setForm(null);
      // Only what the save can have changed: the meeting itself, its Zebrania
      // entry (when it needs materials) and its tasks (a new meeting's).
      if (saved) putSpotkanie(savedId, saved);
      await Promise.all([
        saved ? null : refreshSpotkanie(savedId),
        materialyPotrzebne ? loadZebrania() : null,
        !form?.editing && pendingZadania.length > 0 ? loadZadania() : null,
      ]);
      // Land on the meeting that was just saved, even when it was moved into
      // another month — otherwise saving looks like it did nothing.
      selectDay(toDayKey(input.startsAt));
      notify.success(form?.editing ? t.kalUpdated : t.kalSaved);
    } catch (err: unknown) {
      if (form?.editing && isIpcError(err, 'concurrentEdit')) {
        // Nothing was written. The form keeps the person's fields and takes the
        // meeting as it now is, so "Zapisz" again saves over it knowingly.
        const id = form.editing.id;
        const fresh = await window.electronAPI.getSpotkanie(id).catch(() => null);
        if (fresh) {
          putSpotkanie(id, fresh);
          setForm((prev) => (prev?.editing?.id === id ? { ...prev, editing: fresh } : prev));
        }
        setFormError(t.kalConflict);
      } else {
        setFormError(ipcErrorMessage(err, t.errorUnexpected));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (spotkanie: Spotkanie) => {
    const message =
      t.kalConfirmDelete
        .replace('{name}', spotkanie.nazwa)
        .replace('{when}', formatStamp(spotkanie.startsAt, locale)) +
      (zebranieBySpotkanie.has(spotkanie.id) ? t.kalConfirmDeleteZebranie : '');
    if (!(await notify.confirm(message, { danger: true }))) return;
    try {
      await window.electronAPI.deleteSpotkanie(spotkanie.id);
      // The meeting goes from the list; its entry and its tasks' links went with it.
      setSpotkania((prev) => prev.filter((s) => s.id !== spotkanie.id));
      await Promise.all([loadZebrania(), loadZadania()]);
      notify.success(t.kalDeleted);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected));
    }
  };

  /**
   * One wrapper for the small per-meeting writes: they all set the same busy
   * flag, reload the same way, and report the same failure. Reads the meeting
   * back rather than patching state in place — the meetings are shared, and the
   * row may have moved under us while the card was on screen — but only that
   * meeting, not the eleven lists the calendar holds. `zebrania`: the write can
   * move the meeting's Zebrania entry too (the materials status does).
   */
  const runOnMeeting = async (
    id: number,
    action: () => Promise<unknown>,
    done: string,
    zebraniaToo = false,
  ) => {
    setBusyId(id);
    try {
      await action();
      await Promise.all([refreshSpotkanie(id), zebraniaToo ? loadZebrania() : null]);
      notify.success(done);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected));
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
      true,
    );

  /**
   * "Przygotuj materiały": the meeting's entry in Zebrania, version 1.0, opened
   * at once — the entry is where the work continues.
   */
  const handlePrzygotuj = async (spotkanie: Spotkanie) => {
    setBusyId(spotkanie.id);
    let created: Zebranie | null = null;
    try {
      created = await window.electronAPI.zebranieFromSpotkanie(spotkanie.id);
      await Promise.all([refreshSpotkanie(spotkanie.id), loadZebrania()]);
    } catch (err: unknown) {
      notify.error(ipcErrorMessage(err, t.errorUnexpected));
    } finally {
      setBusyId(null);
    }
    if (!created) return;
    if (!onOpenZebranie) {
      notify.success(t.zebraniaKalPreparedDone);
      return;
    }
    onOpenZebranie(created.id);
  };

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
      notify.error(ipcErrorMessage(err, t.errorUnexpected));
    }
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
      notify.error(ipcErrorMessage(err, t.zadSaveError));
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
      if (cardTask.editing && isIpcError(err, 'zadanieConflict')) {
        // As in the meeting form above: keep the edits, rebase on the fresh card.
        setCardTaskError(t.zadConflict);
        const id = cardTask.editing.id;
        const card = await window.electronAPI.getZadanie(id).catch(() => null);
        if (card) setCardTask((prev) => (prev?.editing?.id === id ? { ...prev, editing: card } : prev));
        await loadZadania();
      } else {
        setCardTaskError(ipcErrorMessage(err, t.zadSaveError));
      }
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

  // One-card mode: once the meeting is gone (deleted from this very card), the
  // window has nothing left to show — it closes instead of saying so.
  const cardGone = !!cardOnly && !isLoading && !spotkania.some((x) => x.id === cardOnly.spotkanieId);
  useEffect(() => {
    if (cardGone) cardOnly?.onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardGone]);

  /* ------------------------------- Rendering ------------------------------- */

  if (isLoading) {
    if (cardOnly) return null;
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
      onMaterialy={(status) => void handleMaterialy(s, status)}
      zebranie={zebranieBySpotkanie.get(s.id)}
      onPrzygotuj={() => void handlePrzygotuj(s)}
      onOpenZebranie={
        onOpenZebranie
          ? () => {
              const z = zebranieBySpotkanie.get(s.id);
              if (z) onOpenZebranie(z.id);
            }
          : undefined
      }
      // Shown always; the card greys it out until every document of the newest
      // version is marked ready in Zebrania.
      onZawiadomienie={s.adresId !== null ? () => setZawiadomienieFor(s.id) : undefined}
      onSendMailing={
        onSendDocuments && s.adresId !== null
          ? () => handleSendMailing(s)
          : undefined
      }
      onOpenMailing={(m) => void openMailingDetails(m)}
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

  // The materials row is one choice: a status, or "past the deadline" (which is
  // the state filter, so the dashboard can send it), or neither — "Wszystkie".
  const overdueActive = stateFilter === 'overdue';
  const materialyAll = materialyFilter === null && !overdueActive;
  const pickMaterialy = (status: SpotkanieMaterialyStatus | null) => {
    setMaterialyFilter(status);
    if (overdueActive) setStateFilter('all');
  };

  const facts = [`${t.kalFactsUpcoming}: ${upcoming.length}`];
  if (typy.length > 0) facts.push(`${t.kalFactsTypes}: ${typy.length}`);

  const overlays = (
    <>
      <MeetingHoverCard store={tipStore} typy={typy} lokalizacje={lokalizacje} language={language} locale={locale} />

      {pdfOpen && (
        <KalendarzPdfModal
          language={language}
          monthKey={monthKey}
          filtersActive={
            search.trim().length > 0 ||
            typFilter !== null ||
            materialyFilter !== null ||
            stateFilter !== 'all'
          }
          busy={pdfBusy}
          onClose={() => setPdfOpen(false)}
          onSubmit={(od, doDnia) => void downloadPdf(od, doDnia)}
        />
      )}

      {zawiadomienieFor !== null && (
        <ZawiadomienieModal
          key={zawiadomienieFor}
          language={language}
          userEmail={userEmail ?? ''}
          spotkanieId={zawiadomienieFor}
          onClose={() => setZawiadomienieFor(null)}
          // A notice saved or sent moves its meeting, its Zebrania entry and the
          // meeting's sends — those three, not the whole calendar.
          onChanged={() => {
            const id = zawiadomienieFor;
            void Promise.all([refreshSpotkanie(id), loadZebrania(), loadMailingi()]);
          }}
          onOpenSzablony={onOpenSzablony}
          sending
        />
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
          spotkania={spotkania}
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
    </>
  );

  if (cardOnly) {
    const s = spotkania.find((x) => x.id === cardOnly.spotkanieId) ?? null;
    if (!s) return null;
    return (
      <>
        <div className="modal-overlay" onClick={cardOnly.onClose}>
          <div
            className="modal kal-card-modal"
            role="dialog"
            aria-label={s?.nazwa ?? t.kalendarz}
            onClick={(e) => e.stopPropagation()}
          >
            <ModalDismiss onClose={cardOnly.onClose} ariaLabel={t.close} />
            {/* The card itself shows only the hours — out of the calendar, the day goes on top. */}
            <div className="kal-card-modal__head">
              <Icon name="calendar" size={14} />
              {s ? formatDayKey(toDayKey(s.startsAt), language) : t.kalendarz}
            </div>
            <div className="modal-body kal-card-modal__body">
              {s && renderMeetingCard(s)}
            </div>
          </div>
        </div>
        {overlays}
      </>
    );
  }

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
                onMouseEnter={(e) => showCountTip(e, t.kalAllTypes, null, countOf(null))}
                onMouseLeave={hideCountTip}
                onFocus={(e) => showCountTip(e, t.kalAllTypes, null, countOf(null))}
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

          {/* One line: the month navigation, then "Pobierz PDF", and "Nowe
              spotkanie" last, at the right edge — the banner carries everything
              that is about the month as a whole. */}
          <div className="ksieg-hero__nav">
            <button
              type="button"
              className="ksieg-nav-arrow"
              onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}
              data-tip={t.kalMonthPrev}
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
              data-tip={t.kalMonthNext}
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
              onClick={() => void reloadFromServer(() => load(true))}
              disabled={isRefreshing}
              data-tip={t.kalRefresh}
              aria-label={t.kalRefresh}
            >
              <Icon name="refresh" size={16} />
            </button>
            <button
              type="button"
              className="button button-secondary kal-new"
              onClick={() => setPdfOpen(true)}
              disabled={pdfBusy || isLoading}
              data-tip={t.kalPdfHint}
            >
              <Icon name={pdfBusy ? 'loader' : 'download'} size={14} /> {t.kalPdf}
            </button>
            <button
              type="button"
              className="button button-primary kal-new"
              onClick={() => openForm(selectedDay)}
            >
              <Icon name="plus" size={14} /> {t.kalNewMeeting}
            </button>
          </div>
        </header>

        {/* ------------------------- What needs attention -------------------
            The date states, one shape each: a tick box that shows whether the
            filter is on, and the same click turns it off again. This is also
            the only place these filters live — a second set among the type
            filters was two controls for one state, and the strip is where the
            user is already looking, because it is the thing that told them
            there was something to look at. */}
        {/* The active filter's own switch always stays on screen, even at zero:
            arriving here from the dashboard and then paging to a month with
            none of them would otherwise leave the filter on with nothing to
            turn it off with, and an empty calendar as the only clue. */}
        {ALERT_KINDS.some((k) => k.count(alerts) > 0 || stateFilter === k.filter) && (
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
                  data-tip={stateFilter === filter ? t.kalFilterOnHint : t.kalFilterOffHint}
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
                data-tip={t.close}
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
              onMouseEnter={(e) => showCountTip(e, t.kalAllTypes, null, countOf(null))}
              onMouseLeave={hideCountTip}
              onFocus={(e) => showCountTip(e, t.kalAllTypes, null, countOf(null))}
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
                  showCountTip(e, typ.nazwa, normalizeHexColor(typ.kolor), countOf(typ.id))
                }
                onMouseLeave={hideCountTip}
                onFocus={(e) =>
                  showCountTip(e, typ.nazwa, normalizeHexColor(typ.kolor), countOf(typ.id))
                }
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

        </div>

        {/* Materials: one chip per state, in the words of the card's materials
            badge, so a month can be swept for what is still open. Counted like
            the type chips: month / year. */}
        <div
          className="kal-filters kal-filters--materialy"
          role="group"
          aria-label={t.kalMatFilterLabel}
        >
          <span className="kal-filters__label">
            <Icon name="briefcase" size={13} /> {t.kalMatFilterLabel}
          </span>
          <button
            type="button"
            className={`kal-filter${materialyAll ? ' is-active' : ''}`}
            onClick={() => pickMaterialy(null)}
            aria-pressed={materialyAll}
            onMouseEnter={(e) => showCountTip(e, t.kalMatFilterLabel, null, countOf(null))}
            onMouseLeave={hideCountTip}
            onFocus={(e) => showCountTip(e, t.kalMatFilterLabel, null, countOf(null))}
            onBlur={hideCountTip}
          >
            {t.kalMatFilterAll}
            <span className="kal-filter__count">
              {countOf(null).month}/{countOf(null).year}
            </span>
          </button>
          {SPOTKANIE_MATERIALY_STATUSES.map((status) => {
            const counts = materialyCountOf(status);
            const showTip = (e: React.SyntheticEvent<HTMLElement>) =>
              showCountTip(e, materialyStatusLabel(t, status), MATERIALY_DOT[status], counts);
            return (
              <button
                key={status}
                type="button"
                className={`kal-filter${materialyFilter === status ? ' is-active' : ''}`}
                style={{ ['--chip' as string]: MATERIALY_DOT[status] }}
                onClick={() => pickMaterialy(materialyFilter === status ? null : status)}
                aria-pressed={materialyFilter === status}
                onMouseEnter={showTip}
                onMouseLeave={hideCountTip}
                onFocus={showTip}
                onBlur={hideCountTip}
              >
                <span className="kal-chip__dot" />
                {materialyFilterLabel(t, status)}
                <span className="kal-filter__count">
                  {counts.month}/{counts.year}
                </span>
              </button>
            );
          })}
          {/* Past the deadline: not a status of its own but a state across the
              unsent ones, so it sits at the end and is the state filter the
              dashboard's tile sends here. Red once the month has any. */}
          <button
            type="button"
            className={
              'kal-filter kal-filter--overdue' +
              (overdueActive ? ' is-active' : '') +
              (overdueCounts.month > 0 ? ' is-alert' : '')
            }
            style={{ ['--chip' as string]: 'var(--danger)' }}
            onClick={() => {
              setMaterialyFilter(null);
              setStateFilter(overdueActive ? 'all' : 'overdue');
            }}
            aria-pressed={overdueActive}
            onMouseEnter={(e) =>
              showCountTip(e, t.kalMatFilterOverdueTip, 'var(--danger)', overdueCounts)
            }
            onMouseLeave={hideCountTip}
            onFocus={(e) =>
              showCountTip(e, t.kalMatFilterOverdueTip, 'var(--danger)', overdueCounts)
            }
            onBlur={hideCountTip}
          >
            <Icon name="alert-circle" size={13} />
            {t.kalMatFilterOverdue}
            <span className="kal-filter__count">
              {overdueCounts.month}/{overdueCounts.year}
            </span>
          </button>
        </div>

        {/* ------------------- The list: the whole month ------------------- */}
        {viewMode === 'list' && (
          <div className="kal-list">
            {listDays.length === 0 ? (
              <div className="kal-side__empty">
                <Icon name="calendar" size={26} />
                <span>
                  {searchActive ||
                  typFilter !== null ||
                  materialyFilter !== null ||
                  stateFilter !== 'all'
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
            <MonthGrid
              cells={cells}
              weekdays={weekdays}
              byDay={byDay}
              selectedDay={selectedDay}
              typy={typy}
              hoverCard={hoverCard}
              language={language}
              locale={locale}
              onSelectDay={selectDayStable}
              onOpenForm={openFormStable}
              onShowTip={showTipStable}
              onHideTip={hideTip}
            />

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
                      {searchActive ||
                      typFilter !== null ||
                      materialyFilter !== null ||
                      stateFilter !== 'all'
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
            </aside>
          </div>
        )}
      </div>

      {/* The month/year count card of the filter chips — see CountHoverCard. */}
      <CountHoverCard store={countTipStore} monthKey={monthKey} language={language} locale={locale} />

      {overlays}
    </div>
  );
};

export default Kalendarz;
