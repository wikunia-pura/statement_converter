import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  AppUser,
  ConversionHistory,
  FileEntry,
  KontoTyp,
  KsiegowaniePlik,
  KsiegowaniePriorytet,
  KsiegowaniePrzypisanie,
  KsiegowanieUwaga,
  Spotkanie,
  SpotkanieMailing,
  SpotkanieTyp,
} from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import Select from '../components/Select';
import SearchableSelect from '../components/SearchableSelect';
import { comparePeople, personColor, personLabel } from '../../shared/app-users';
import MonthIllustration, { monthAccent } from '../components/MonthIllustration';
import {
  countAlerts,
  formatStamp,
  hasAnyAlert,
  sentByMailingIds,
  spotkaniaFromToday,
  SpotkaniaAlerts,
  SpotkanieStateFilter,
  upcomingSpotkania,
} from '../../shared/calendar';
import MeetingsIllustration from '../components/MeetingsIllustration';
import PriorityOrderModal from '../components/PriorityOrderModal';
import OverflowMenu from '../components/OverflowMenu';
import { NoteEditor, uwagaMeta, uwagaResolvedMeta } from '../components/PostingNotes';
import { resolveOutputFilePath } from '../../shared/outputPaths';
import { joinScanPath } from '../../shared/statement-scan';
import { generateId } from '../../shared/utils';
import StatementScanModal, { formatPeriod } from '../components/StatementScanModal';
import ConversionModal from '../components/ConversionModal';
import {
  AddressBookingGroup,
  BookingFilter,
  BookingRow,
  BookingSort,
  BookingTotals,
  PlikStatus,
  attributeToStatementMonths,
  currentMonthKey,
  groupByAddress,
  matchesBookingFilter,
  matchesBookingSearch,
  monthLabel,
  monthsWithData,
  pinPriorities,
  resolveBookingTileOrder,
  shiftMonthKey,
  sortGroups,
  toBookingRows,
} from '../../shared/bookings';
import { plural } from '../plural';

/** The "Kto" filter: everyone, the signed-in person, nobody, or one person. */
type WhoFilter = { kind: 'all' } | { kind: 'mine' } | { kind: 'none' } | { kind: 'person'; email: string };

const WHO_FILTER_KEY = 'ksiegowania.whoFilter';

function whoFilterValue(f: WhoFilter): string {
  return f.kind === 'person' ? `p:${f.email}` : f.kind;
}

function parseWhoFilter(value: string): WhoFilter {
  if (value.startsWith('p:')) return { kind: 'person', email: value.slice(2) };
  if (value === 'mine' || value === 'none') return { kind: value };
  return { kind: 'all' };
}

/** The pickers' "Przypisz do mnie" entry — resolved to the signed-in mailbox on pick. */
const ASSIGN_TO_ME = '__me__';
/** The batch picker's "Nieprzypisane" entry. */
const UNASSIGN = '__none__';

const sameMailbox = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

interface Props {
  language: Language;
  /** Month being viewed (`YYYY-MM`); lifted so switching views keeps the place. */
  monthKey: string;
  setMonthKey: (key: string) => void;
  filter: BookingFilter;
  setFilter: (filter: BookingFilter) => void;
  /** E-mail of the signed-in user, shown next to the ticks they set. */
  userEmail?: string;
  /** Jump to the Converter's Historia tab with this text already searched. */
  onShowInHistory?: (query: string) => void;
  /** Jump to the Kalendarz with one of its "needs doing" filters already on. */
  onShowInCalendar?: (filter: SpotkanieStateFilter) => void;
  /** Show the meetings/calendar area. Off in the Converter's tab — the calendar lives on the dashboard only. */
  showCalendar?: boolean;
  /** A band rendered between the calendar and the bookings — the dashboard's task list. */
  tasksArea?: React.ReactNode;
  /**
   * Makes the bookings area collapsible: the month banner always stays, the rest
   * folds away. Left out in the Converter's tab, where the bookings ARE the page
   * and folding them would leave it empty.
   */
  bookingsCollapsed?: boolean;
  onToggleBookings?: () => void;
  /** The filter tiles' saved order (filter ids, set in Ustawienia); null = the default. */
  tileOrder?: string[] | null;
}

/** Last path segment, both separators — what the user recognises as "the file". */
function baseName(filePath: string): string {
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return cut < 0 ? filePath : filePath.slice(cut + 1);
}

type Trans = (typeof translations)['pl' | 'en'];

/** Explicit rather than a lookup, so both language objects stay type-checked. */
function stateLabel(state: AddressBookingGroup['state'], t: Trans): string {
  if (state === 'done') return t.ksStateDone;
  if (state === 'partial') return t.ksStatePartial;
  if (state === 'todo') return t.ksStateTodo;
  return t.ksStateMissing;
}

const STATE_ICON: Record<AddressBookingGroup['state'], React.ComponentProps<typeof Icon>['name']> = {
  done: 'check-circle',
  partial: 'clipboard',
  todo: 'clipboard',
  missing: 'file-text',
};

/**
 * "Księgowania" — the app's dashboard, and the Converter's third tab.
 *
 * The same conversions the Historia tab lists, pivoted onto the communities and
 * one month at a time. A booking is defined by its artifact: a conversion that
 * produced an accounting file. Whether that file has then been entered in the
 * external DOM program is something the app cannot know, so every file carries a
 * tick the user sets here — per file, or for a whole community at once.
 */
/* ========================= Kalendarz, from the dashboard ==================== */

/**
 * The dashboard's first area: the calendar's four "needs doing" states.
 *
 * Its own banner and its own box, above the month's bookings and separate from
 * them, because it answers a different question. Sitting between the booking
 * tiles and the booking list it read as a third row of the same thing — and as
 * though it were scoped to the month on screen, which it is not: these are
 * counted from today forward, whatever month the bookings below are showing.
 *
 * Each tile is also the way in: it opens the Kalendarz with that filter already
 * applied, because a tile that only navigated would leave the user to find the
 * meetings it had just counted.
 */
const CalendarAlerts: React.FC<{
  alerts: SpotkaniaAlerts;
  language: Language;
  locale: string;
  /** The next meeting from now on, or null when nothing is scheduled. */
  next: Spotkanie | null;
  /** How many are still ahead, for the line shown when there is no next one. */
  upcomingCount: number;
  onOpen?: (filter: SpotkanieStateFilter) => void;
}> = ({ alerts, language, locale, next, upcomingCount, onOpen }) => {
  const t = translations[language];
  const anything = hasAnyAlert(alerts);
  const outstanding = alerts.overdue + alerts.changed + alerts.noDocs + alerts.tentative;

  // Two facts, the same shape the month bar uses: how much is waiting, and the
  // one thing that happens next — which is what a dashboard is asked first.
  const facts = [
    anything ? t.ksKalFactsOutstanding.replace('{count}', String(outstanding)) : t.ksKalFactsNone,
    next
      ? t.ksKalFactsNext
          .replace('{when}', formatStamp(next.startsAt, locale))
          .replace('{name}', next.nazwa)
      : t.ksKalFactsNoUpcoming.replace('{count}', String(upcomingCount)),
  ];

  const kinds: {
    filter: SpotkanieStateFilter;
    count: number;
    tone: string;
    icon: React.ComponentProps<typeof Icon>['name'];
    label: string;
    hint: string;
  }[] = [
    {
      filter: 'overdue',
      count: alerts.overdue,
      tone: 'overdue',
      icon: 'alert-circle',
      label: t.ksKalOverdue,
      hint: t.ksKalOverdueHint,
    },
    {
      filter: 'changed',
      count: alerts.changed,
      tone: 'changed',
      icon: 'alert-triangle',
      label: t.ksKalChanged,
      hint: t.ksKalChangedHint,
    },
    {
      filter: 'nodocs',
      count: alerts.noDocs,
      tone: 'nodocs',
      icon: 'mail',
      label: t.ksKalNoDocs,
      hint: t.ksKalNoDocsHint,
    },
    {
      filter: 'tentative',
      count: alerts.tentative,
      tone: 'tentative',
      icon: 'clock',
      label: t.ksKalTentative,
      hint: t.ksKalTentativeHint,
    },
  ];

  return (
    <section className="ks-area ks-area--kal">
      {/* Built like the month bar below it — art, tint, glow, then the type —
          so the two banners read as one family. */}
      <header className="ks-kal-hero">
        <div className="ks-kal-hero__art">
          <MeetingsIllustration />
        </div>

        <div className="ks-kal-hero__id">
          <span className="ks-kal-hero__eyebrow">
            <Icon name="calendar" size={13} /> {t.ksKalEyebrow}
          </span>
          <h2 className="ks-kal-hero__title">{t.ksKalTitle}</h2>
          <p className="ks-kal-hero__facts">{facts.join(' · ')}</p>
          <p className="ks-kal-hero__sub">{t.ksKalNote}</p>
        </div>

        {onOpen && (
          <div className="ks-kal-hero__nav">
            <button type="button" className="ks-area__action" onClick={() => onOpen('all')}>
              {t.ksKalOpenAll} <Icon name="arrow-right" size={13} />
            </button>
          </div>
        )}
      </header>

      {/* Nothing outstanding means nothing to show: no tiles, and no reassurance
          bar either — a band that says "all clear" is still a band to read. The
          banner's own facts line already says so. */}
      {anything && (
        <div className="ks-kal__tiles">
          {kinds.map((kind) => (
            <button
              key={kind.filter}
              type="button"
              className={`ks-kal-tile ks-kal-tile--${kind.tone}${
                kind.count === 0 ? ' is-empty' : ''
              }`}
              onClick={() => onOpen?.(kind.filter)}
              disabled={!onOpen || kind.count === 0}
              title={kind.count === 0 ? kind.hint : t.ksKalOpen.replace('{what}', kind.label)}
            >
              <span className="ks-kal-tile__icon">
                <Icon name={kind.icon} size={16} />
              </span>
              <span className="ks-kal-tile__count">{kind.count}</span>
              <span className="ks-kal-tile__label">{kind.label}</span>
              <span className="ks-kal-tile__hint">{kind.hint}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

const Ksiegowania: React.FC<Props> = ({
  language,
  monthKey,
  setMonthKey,
  filter,
  setFilter,
  userEmail,
  onShowInHistory,
  onShowInCalendar,
  showCalendar = true,
  tasksArea,
  bookingsCollapsed = false,
  onToggleBookings,
  tileOrder = null,
}) => {
  const t = translations[language];
  // Folding needs a host that can remember it; without one the area never folds.
  const folded = !!onToggleBookings && bookingsCollapsed;
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [history, setHistory] = useState<ConversionHistory[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  // The calendar's side of the dashboard: enough to count the four states the
  // section reports, read from the same three sources the Kalendarz reads.
  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [spotkaniaTypy, setSpotkaniaTypy] = useState<SpotkanieTyp[]>([]);
  const [spotkaniaMailingi, setSpotkaniaMailingi] = useState<SpotkanieMailing[]>([]);
  // The month's queue and the notes on communities — see `groupByAddress`.
  const [priorities, setPriorities] = useState<KsiegowaniePriorytet[]>([]);
  const [uwagi, setUwagi] = useState<KsiegowanieUwaga[]>([]);
  // Files pinned by "Znajdź pliki księgowe", and what is needed to open them:
  // this machine's statements folder and the account types (for the Converter).
  const [pliki, setPliki] = useState<KsiegowaniePlik[]>([]);
  const [kontoTypy, setKontoTypy] = useState<KontoTyp[]>([]);
  const [statementsFolder, setStatementsFolder] = useState('');
  const [showScan, setShowScan] = useState(false);
  // The conversion dialog's files, and the communities ticked for converting together.
  const [conversion, setConversion] = useState<{ title: string; entries: FileEntry[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showOrder, setShowOrder] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const tiles = resolveBookingTileOrder(tileOrder);
  // Rows (by group key) with a priority / note write in flight.
  const [noteBusy, setNoteBusy] = useState<Set<string>>(new Set());
  // Who posts which community, every month; the view picks its own month.
  const [przypisania, setPrzypisania] = useState<KsiegowaniePrzypisanie[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  // Remembered on this computer — the filter one person uses every day.
  const [whoFilter, setWhoFilterState] = useState<WhoFilter>(() => {
    try {
      return parseWhoFilter(localStorage.getItem(WHO_FILTER_KEY) ?? 'all');
    } catch {
      return { kind: 'all' };
    }
  });
  const setWhoFilter = (f: WhoFilter) => {
    setWhoFilterState(f);
    try {
      localStorage.setItem(WHO_FILTER_KEY, whoFilterValue(f));
    } catch {
      // a convenience only
    }
  };
  const [isLoading, setIsLoading] = useState(true);
  // A refresh must not blank the dashboard — only the first load shows a loader.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<BookingSort>('todo-first');
  // Bumped to re-settle the list order on demand — see `orderKey` below.
  const [settleId, setSettleId] = useState(0);
  // Explicit user overrides only; untouched rows follow the default below.
  const [rowOverrides, setRowOverrides] = useState<Record<string, boolean>>({});
  // Rows with a tick in flight — their control is disabled until it lands.
  const [saving, setSaving] = useState<Set<number>>(new Set());

  useEffect(() => {
    void load();
  }, []);

  const load = async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const [
        historyData,
        adresyData,
        spotkaniaData,
        typyData,
        mailingiData,
        priorityData,
        uwagiData,
        plikiData,
        kontoTypyData,
        settings,
        przypisaniaData,
        usersData,
      ] = await Promise.all([
          // The dashboard's own records — the history log may be cleared.
          window.electronAPI.getKsiegowaniaKonwersje(),
          window.electronAPI.getAdresy(),
          window.electronAPI.getSpotkania(),
          window.electronAPI.getSpotkaniaTypy(),
          window.electronAPI.getSpotkaniaMailingi(),
          // Priorities and notes are extras: a table that is not there yet (the
          // migration not run) must not take the whole dashboard down with it.
          window.electronAPI.getKsiegowaniaPriorytety().catch(() => [] as KsiegowaniePriorytet[]),
          window.electronAPI.getKsiegowaniaUwagi().catch(() => [] as KsiegowanieUwaga[]),
          window.electronAPI.getKsiegowaniaPliki().catch(() => [] as KsiegowaniePlik[]),
          window.electronAPI.getKontoTypy().catch(() => [] as KontoTyp[]),
          window.electronAPI.getSettings().catch(() => null),
          window.electronAPI.getKsiegowaniaPrzypisania().catch(() => [] as KsiegowaniePrzypisanie[]),
          window.electronAPI.getAppUsers().catch(() => [] as AppUser[]),
        ]);
      setHistory(historyData);
      setAdresy(adresyData);
      setSpotkania(spotkaniaData);
      setSpotkaniaTypy(typyData);
      setSpotkaniaMailingi(mailingiData);
      setPriorities(priorityData);
      setUwagi(uwagiData);
      setPliki(plikiData);
      setKontoTypy(kontoTypyData);
      setStatementsFolder(settings?.statementsFolder ?? '');
      setPrzypisania(przypisaniaData);
      setUsers(usersData);
    } catch (err: unknown) {
      // Said out loud: a dashboard quietly showing stale numbers is worse than none.
      notify.error(`${t.ksLoadError}\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  /** Reload and re-sort — the one gesture that re-settles the frozen order. */
  const refresh = async () => {
    setSettleId((id) => id + 1);
    await load(true);
  };

  /**
   * The four calendar states, counted from today on.
   *
   * A dashboard is about what can still be done: a notice period that ran out
   * on a meeting held in March is a fact, not a task, and letting those pile up
   * would make the tile a number nobody can bring back to zero. Browsing to
   * March in the calendar still shows them, which is where looking at what
   * already happened belongs.
   */
  const kalAlerts: SpotkaniaAlerts = useMemo(
    () =>
      countAlerts(spotkaniaFromToday(spotkania), {
        sentByMailing: sentByMailingIds(spotkaniaMailingi),
        typy: spotkaniaTypy,
      }),
    [spotkania, spotkaniaTypy, spotkaniaMailingi],
  );

  /** What is next, and how much is ahead — the banner's two facts. */
  const kalUpcoming = useMemo(() => upcomingSpotkania(spotkania, 5), [spotkania]);
  const kalNext = kalUpcoming[0] ?? null;

  // A conversion of a statement the folder scan pinned counts in that
  // statement's month, not in the month it happened to be converted in.
  const rows = useMemo(
    () => attributeToStatementMonths(toBookingRows(history, adresy), pliki),
    [history, adresy, pliki],
  );
  const months = useMemo(() => monthsWithData(rows), [rows]);
  const { groups, totals } = useMemo(
    () => groupByAddress(rows, adresy, monthKey, priorities, uwagi, pliki),
    [rows, adresy, monthKey, priorities, uwagi, pliki],
  );
  /** The month's flagged communities, in queue order — the order dialog's list. */
  const priorityGroups = useMemo(
    () =>
      groups
        .filter((g) => g.priorityRank !== null)
        .sort((a, b) => a.priorityRank! - b.priorityRank!),
    [groups],
  );

  /**
   * Sorting plans the work; it must not happen *while* the work is being done.
   * Ticking a file changes its community's state, so a live re-sort would move
   * the row that was just clicked — under "Do zrobienia najpierw" it lands at
   * the bottom of the list, and under a filter it disappears altogether, which
   * reads as "my click did nothing". So the order AND the set of rows are
   * settled once per month/filter/search/sort and then held: the row stays put
   * and turns green in place. The list re-settles only when the user asks for
   * it — another filter, another sort, "Przesortuj", or "Odśwież dane".
   */
  /** This month's assignee of each community, by its name (as the table keys it). */
  const assigneeByName = useMemo(() => {
    const map = new Map<string, KsiegowaniePrzypisanie>();
    for (const p of przypisania) {
      if (p.monthKey === monthKey) map.set(p.adresNazwa.trim().toLowerCase(), p);
    }
    return map;
  }, [przypisania, monthKey]);
  const assigneeOf = (g: AddressBookingGroup): string | null =>
    g.unassigned ? null : assigneeByName.get(g.nazwa.trim().toLowerCase())?.email ?? null;
  const matchesWho = (g: AddressBookingGroup): boolean => {
    if (whoFilter.kind === 'all') return true;
    const email = assigneeOf(g);
    if (whoFilter.kind === 'none') return !email && !g.unassigned;
    if (whoFilter.kind === 'mine') return sameMailbox(email, userEmail);
    return sameMailbox(email, whoFilter.email);
  };

  const orderKey = `${monthKey}|${filter}|${sort}|${search.trim().toLowerCase()}|${whoFilterValue(whoFilter)}|${settleId}`;
  const settled = useRef<{ key: string; keys: string[] }>({ key: '', keys: [] });

  const { visible, orderStale } = useMemo(() => {
    const matching = groups.filter(
      (g) => matchesBookingFilter(g, filter) && matchesBookingSearch(g, search) && matchesWho(g),
    );
    // The chosen sort decides the order; the priority queue is stuck on top of it
    // afterwards (`pinPriorities`) rather than being a sort of its own.
    const sortedPlain = sortGroups(matching, sort, locale);
    const sorted = pinPriorities(sortedPlain);
    // A different key means the user asked for a new order — settle it afresh.
    const remembered = settled.current.key === orderKey ? settled.current.keys : [];
    const byKey = new Map(groups.map((g) => [g.key, g]));
    // Held in their settled places, filter or no filter — a row the user has
    // just worked on must not vanish from under the cursor.
    const held = remembered
      .map((key) => byKey.get(key))
      .filter((g): g is AddressBookingGroup => g !== undefined);
    const heldKeys = new Set(held.map((g) => g.key));
    // Rows that were not on screen yet: the whole list on the first load, or
    // whatever a later load added. They take their sorted places at the end.
    const fresh = sortedPlain.filter((g) => !heldKeys.has(g.key));
    const heldOrder = [...held, ...fresh];
    // Remember what is actually on screen, every time — remembering only at
    // settle time would freeze the empty list of the very first render, and the
    // list would go on re-sorting itself under every tick. The order is kept
    // WITHOUT the queue on top, so a priority that is taken off drops back to the
    // place the list was holding it in, and a flag pulls a row up without
    // re-sorting everything under it.
    settled.current = { key: orderKey, keys: heldOrder.map((g) => g.key) };
    const list = pinPriorities(heldOrder);
    const stale = list.length !== sorted.length || list.some((g, i) => g.key !== sorted[i]?.key);
    return { visible: list, orderStale: stale };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, filter, search, sort, locale, orderKey, assigneeByName]);

  /** How many of the rows on screen are the queue (they are pinned to the top). */
  const queueLength = visible.filter((g) => g.priorityRank !== null).length;
  const searchActive = search.trim().length > 0;
  /** A lone result needs no second click; searching surfaces every hit. */
  const openByDefault = visible.length === 1;

  const isOpen = (key: string): boolean => {
    if (searchActive) return true;
    if (key in rowOverrides) return rowOverrides[key];
    return openByDefault;
  };

  const toggleRow = (key: string) => {
    setRowOverrides((prev) => {
      const currentlyOpen = key in prev ? prev[key] : openByDefault;
      return { ...prev, [key]: !currentlyOpen };
    });
  };

  const monthOptions = useMemo(() => {
    const keys = new Set(months);
    keys.add(monthKey);
    keys.add(currentMonthKey());
    return [...keys]
      .sort((a, b) => b.localeCompare(a))
      .map((key) => ({ value: key, label: monthLabel(key, locale) }));
  }, [months, monthKey, locale]);

  const formatDateTime = (iso: string): string =>
    new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  /* ------------------------------- Actions ------------------------------- */

  const setBooked = async (ids: number[], booked: boolean, announce: boolean) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setSaving((prev) => new Set([...prev, ...ids]));
    // Optimistic: the tick is a user statement, not a computation — it should
    // feel instant. A failed write reloads the authoritative rows.
    const stamp = booked ? new Date().toISOString() : null;
    setHistory((prev) =>
      prev.map((h) =>
        idSet.has(h.id)
          ? {
              ...h,
              bookedInDom: booked,
              bookedInDomAt: stamp,
              bookedInDomBy: booked ? userEmail ?? null : null,
            }
          : h,
      ),
    );
    try {
      const result = await window.electronAPI.setKsiegowanieBookedInDom(ids, booked);
      if (!result.success) {
        notify.error(`${t.ksMarkError}: ${result.error ?? ''}`.trim());
        await load(true);
        return;
      }
      if (announce) {
        const message = booked ? t.ksMarkSuccess : t.ksUnmarkSuccess;
        notify.success(message.replace('{count}', String(ids.length)));
      }
    } catch (error) {
      notify.error(t.ksMarkError);
      await load(true);
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  };

  /* ----------------------- Priorities and notes ------------------------- */

  /** Re-read the two small tables; the lists are short and the team shares them. */
  const loadNotes = async () => {
    const [priorityData, uwagiData] = await Promise.all([
      window.electronAPI.getKsiegowaniaPriorytety().catch(() => null),
      window.electronAPI.getKsiegowaniaUwagi().catch(() => null),
    ]);
    if (priorityData) setPriorities(priorityData);
    if (uwagiData) setUwagi(uwagiData);
  };

  /**
   * One write to the priority / note tables for one row, then a re-read. Not
   * optimistic like the DOM tick: these are shared with the team, and what the
   * row should show next (the rank, who wrote it) is only known to the table.
   */
  const runNoteAction = async (
    key: string,
    action: () => Promise<unknown>,
    errorMessage: string,
  ): Promise<boolean> => {
    setNoteBusy((prev) => new Set(prev).add(key));
    try {
      await action();
      await loadNotes();
      return true;
    } catch {
      notify.error(errorMessage);
      await loadNotes();
      return false;
    } finally {
      setNoteBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const noteActionsFor = (group: AddressBookingGroup): NoteActions => ({
    busy: noteBusy.has(group.key),
    togglePriority: async () => {
      const current = group.priority;
      if (current) {
        // A note is somebody's explanation — do not drop it on a stray click.
        if (current.notatka.trim()) {
          const ok = await notify.confirm(t.ksPrioRemoveConfirm.replace('{name}', group.nazwa), {
            confirmLabel: t.ksPrioRemoveConfirmLabel,
            danger: true,
          });
          if (!ok) return;
        }
        await runNoteAction(
          group.key,
          () => window.electronAPI.removeKsiegowaniePriorytet(current.id),
          t.ksPrioError,
        );
      } else {
        await runNoteAction(
          group.key,
          () => window.electronAPI.addKsiegowaniePriorytet(monthKey, group.adresId, group.nazwa, ''),
          t.ksPrioError,
        );
      }
    },
    savePriorityNote: (text) =>
      group.priority
        ? runNoteAction(
            group.key,
            () => window.electronAPI.setKsiegowaniePriorytetNotatka(group.priority!.id, text),
            t.ksPrioNoteError,
          )
        : Promise.resolve(false),
    clearPriorityNote: async () => {
      if (!group.priority) return false;
      const id = group.priority.id;
      const ok = await notify.confirm(t.ksPrioNoteDeleteConfirm, {
        confirmLabel: t.ksPrioNoteDeleteConfirmLabel,
        danger: true,
      });
      if (!ok) return false;
      return runNoteAction(
        group.key,
        () => window.electronAPI.setKsiegowaniePriorytetNotatka(id, ''),
        t.ksPrioNoteError,
      );
    },
    addUwaga: (text) =>
      runNoteAction(
        group.key,
        () => window.electronAPI.addKsiegowanieUwaga(group.adresId, group.nazwa, text),
        t.ksUwagaError,
      ),
    updateUwaga: (id, text) =>
      runNoteAction(group.key, () => window.electronAPI.updateKsiegowanieUwaga(id, text), t.ksUwagaError),
    setUwagaResolved: (id, resolved) =>
      runNoteAction(
        group.key,
        () => window.electronAPI.setKsiegowanieUwagaResolved(id, resolved),
        t.ksUwagaError,
      ),
    deleteUwaga: async (id) => {
      const ok = await notify.confirm(t.ksUwagaDeleteConfirm, {
        confirmLabel: t.ksUwagaDeleteConfirmLabel,
        danger: true,
      });
      if (!ok) return false;
      return runNoteAction(group.key, () => window.electronAPI.deleteKsiegowanieUwaga(id), t.ksUwagaError);
    },
  });

  const saveOrder = async (orderedPriorityIds: number[]) => {
    setOrderSaving(true);
    try {
      await window.electronAPI.reorderKsiegowaniaPriorytety(monthKey, orderedPriorityIds);
      await loadNotes();
      setShowOrder(false);
      notify.success(t.ksPrioOrderSaved);
    } catch {
      notify.error(t.ksPrioError);
      await loadNotes();
    } finally {
      setOrderSaving(false);
    }
  };

  const openFile = async (filePath: string) => {
    const ok = await window.electronAPI.openFile(filePath);
    if (!ok) notify.error(t.fileNotFound);
  };

  /* -------------------- Files pinned by the folder scan ------------------ */

  const loadPliki = async () => {
    const [data, settings] = await Promise.all([
      window.electronAPI.getKsiegowaniaPliki().catch(() => null),
      window.electronAPI.getSettings().catch(() => null),
    ]);
    if (data) setPliki(data);
    if (settings) setStatementsFolder(settings.statementsFolder ?? '');
  };

  const plikActions: PlikActions = {
    open: (plik) => {
      if (!statementsFolder) {
        notify.warning(t.ksConvertNoFolder);
        return;
      }
      void openFile(joinScanPath(statementsFolder, plik.relPath));
    },
    unpin: async (plik) => {
      const ok = await notify.confirm(t.ksFileUnpinConfirm.replace('{name}', plik.fileName), {
        confirmLabel: t.ksFileUnpin,
        danger: true,
      });
      if (!ok) return;
      try {
        await window.electronAPI.deleteKsiegowaniePlik(plik.id);
      } catch {
        notify.error(t.ksFileUnpinError);
      }
      await loadPliki();
    },
    // The fallback when a statement went into DOM some other way: a record with
    // no accounting file, already ticked — the community counts it as posted.
    markBooked: async ({ plik }) => {
      const ok = await notify.confirm(t.ksFileMarkBookedConfirm.replace('{name}', plik.fileName), {
        title: t.ksFileMarkBooked,
        confirmLabel: t.ksFileMarkBooked,
      });
      if (!ok) return;
      const result = await window.electronAPI.markKsiegowaniePlikBooked(plik.id);
      if (!result.success) notify.error(`${t.ksFileMarkBookedError}${result.error ? `\n${result.error}` : ''}`);
      else notify.success(t.ksFileMarkBookedDone);
      await load(true);
    },
    undoManual: async (row) => {
      const ok = await notify.confirm(t.ksManualUndoConfirm.replace('{name}', row.entry.fileName), {
        confirmLabel: t.ksManualUndo,
        danger: true,
      });
      if (!ok) return;
      const result = await window.electronAPI.undoKsiegowanieManual(row.entry.id);
      if (!result.success) notify.error(`${t.ksManualUndoError}${result.error ? `\n${result.error}` : ''}`);
      await load(true);
    },
  };

  /**
   * A pinned statement as the Converter's list takes it: the community, bank
   * and account type already set and its PDF attached — exactly as if it had
   * been dropped in and recognised.
   */
  const entryFor = ({ plik, pdf }: PlikStatus): FileEntry => {
    const adres = adresy.find((a) => a.id === plik.adresId) ?? null;
    const defaultTypeId = kontoTypy.find((k) => k.isDefault)?.id ?? kontoTypy[0]?.id ?? null;
    const account = plik.accountNumber;
    return {
      id: generateId(),
      fileName: plik.fileName,
      filePath: joinScanPath(statementsFolder, plik.relPath),
      bankId: plik.bankId,
      bankName: plik.bankName,
      adresId: adres?.id ?? plik.adresId,
      status: 'pending',
      ...(pdf ? { pdfPath: joinScanPath(statementsFolder, pdf.relPath) } : {}),
      adresAutoMatched: true,
      ...(account ? { detectedAccounts: [account] } : {}),
      accountTypeId: (account ? adres?.accountTypes?.[account] : undefined) ?? defaultTypeId,
    };
  };

  /** Open the conversion dialog over the dashboard with these statements. */
  const openConversion = (statuses: PlikStatus[], title: string) => {
    if (statuses.length === 0) return;
    if (!statementsFolder) {
      notify.warning(t.ksConvertNoFolder);
      return;
    }
    setConversion({ title, entries: statuses.map(entryFor) });
  };

  const waitingOf = (group: AddressBookingGroup) => group.statements.filter((s) => !s.conversion);

  const convertGroup = (group: AddressBookingGroup) => openConversion(waitingOf(group), group.nazwa);

  const convertOne = (group: AddressBookingGroup, status: PlikStatus) =>
    openConversion([status], `${group.nazwa} · ${status.plik.fileName}`);

  /** The ticked communities that still have something to convert. */
  /** Every ticked community — what "Przypisz" acts on. */
  const tickedGroups = groups.filter((g) => selected.has(g.key) && !g.unassigned);
  /** …of which those with something to convert — what "Konwertuj zaznaczone" acts on. */
  const selectedGroups = tickedGroups.filter((g) => g.ready > 0);
  const selectedFiles = selectedGroups.reduce((n, g) => n + g.ready, 0);

  // What can be ticked: every community on screen — under the current filter and
  // search. A tick serves both batch actions: converting and assigning.
  const selectable = visible.filter((g) => !g.unassigned);
  const selectedVisible = selectable.filter((g) => selected.has(g.key)).length;
  const allVisibleSelected = selectable.length > 0 && selectedVisible === selectable.length;

  /** The row ticked last — the start of a Shift+click range. */
  const lastTickedRef = useRef<string | null>(null);

  const toggleSelected = (key: string, range = false) => {
    const turnOn = !selected.has(key);
    const from = range && lastTickedRef.current ? selectable.findIndex((g) => g.key === lastTickedRef.current) : -1;
    const to = selectable.findIndex((g) => g.key === key);
    setSelected((prev) => {
      const next = new Set(prev);
      // Shift+click: every row between the last tick and this one takes this
      // row's new state, as in any file list.
      const keys =
        from >= 0 && to >= 0
          ? selectable.slice(Math.min(from, to), Math.max(from, to) + 1).map((g) => g.key)
          : [key];
      for (const k of keys) {
        if (turnOn) next.add(k);
        else next.delete(k);
      }
      return next;
    });
    lastTickedRef.current = key;
  };

  /** The head checkbox: all rows on screen, or none of them. */
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const g of selectable) {
        if (allVisibleSelected) next.delete(g.key);
        else next.add(g.key);
      }
      return next;
    });
    lastTickedRef.current = null;
  };

  const convertSelected = () => {
    if (selectedGroups.length === 0) return;
    openConversion(
      selectedGroups.flatMap(waitingOf),
      selectedGroups.length === 1
        ? selectedGroups[0].nazwa
        : t.ksConvModalTitleMany.replace('{n}', String(selectedGroups.length)),
    );
  };

  /**
   * Assign the community's month to a person (or nobody). Optimistic, like a
   * DOM tick: the row changes at once; a failed write reloads what is stored.
   */
  const assign = async (group: AddressBookingGroup, email: string | null) => {
    const nazwa = group.nazwa.trim();
    const key = nazwa.toLowerCase();
    setPrzypisania((prev) => {
      const rest = prev.filter((p) => !(p.monthKey === monthKey && p.adresNazwa.trim().toLowerCase() === key));
      if (!email) return rest;
      return [
        ...rest,
        {
          id: -Date.now(),
          monthKey,
          adresId: group.adresId,
          adresNazwa: nazwa,
          email,
          assignedBy: userEmail ?? '',
          assignedAt: new Date().toISOString(),
        },
      ];
    });
    try {
      await window.electronAPI.setKsiegowaniePrzypisanie(monthKey, group.adresId, nazwa, email);
    } catch (err: unknown) {
      notify.error(`${t.ksAssignError}\n${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      setPrzypisania(await window.electronAPI.getKsiegowaniaPrzypisania());
    } catch {
      // the optimistic state stays; the next load corrects it
    }
  };

  /** "Przypisz" on the batch bar: one person (or nobody) for every ticked community. */
  const assignTicked = async (email: string | null) => {
    const targets = tickedGroups;
    if (targets.length === 0) return;
    const keys = new Set(targets.map((g) => g.nazwa.trim().toLowerCase()));
    setPrzypisania((prev) => {
      const rest = prev.filter((p) => !(p.monthKey === monthKey && keys.has(p.adresNazwa.trim().toLowerCase())));
      if (!email) return rest;
      const stamp = new Date().toISOString();
      return [
        ...rest,
        ...targets.map((g, i) => ({
          id: -Date.now() - i,
          monthKey,
          adresId: g.adresId,
          adresNazwa: g.nazwa.trim(),
          email,
          assignedBy: userEmail ?? '',
          assignedAt: stamp,
        })),
      ];
    });
    const results = await Promise.allSettled(
      targets.map((g) => window.electronAPI.setKsiegowaniePrzypisanie(monthKey, g.adresId, g.nazwa.trim(), email)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) notify.error(t.ksAssignManyError.replace('{n}', String(failed)));
    else
      notify.success(
        (email ? t.ksAssignManyDone : t.ksUnassignManyDone).replace('{n}', String(targets.length)),
      );
    try {
      setPrzypisania(await window.electronAPI.getKsiegowaniaPrzypisania());
    } catch {
      // the optimistic state stays; the next load corrects it
    }
  };

  const peopleOptions = [...users]
    .sort(comparePeople)
    .map((u) => ({ value: u.email, label: personLabel(u), hint: u.email }));

  /* ------------------------------- Rendering ----------------------------- */

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

  /**
   * How much of the month is left, on exactly the measure the progress bar
   * uses: every community in the book, minus the ones whose files are all
   * ticked in DOM. So it counts a community with nothing generated yet the same
   * as one whose files are waiting — both are still to do — and it hits zero at
   * the same moment the bar hits 100%.
   *
   * Not `todo` (files of the conversions that happened to run), which is what
   * this used to say: in a month where half the communities had no file at all,
   * "zostało plików: 37" made the remaining work look like a fraction of what
   * it was.
   */
  const remaining = Math.max(0, totals.addresses - totals.dom);

  /**
   * Bookings, counted by community rather than by file: how many communities
   * produced at least one accounting file this month. `unbooked` is the ones
   * that produced none, so this is its complement.
   *
   * A community's month is usually several files (one per account type), so the
   * file count answered a question nobody asks — thirty-seven files across how
   * many communities? — while every other number on this screen is a community.
   */
  const withBooking = Math.max(0, totals.addresses - totals.unbooked);

  /**
   * What this month holds. It used to open with `totals.rows` — the whole
   * address book plus the "bez przypisanej wspólnoty" row — so a header reading
   * "Wrzesień 2026" said "63 wspólnoty" whether September had work for sixty of
   * them or for four, and counted a row that is not a community at all.
   *
   * The two figures can land on the same number (32 with a booking, 31 of them
   * ticked, so 32 of 63 still to mark) — hence labels that say plainly which is
   * which rather than leaving two identical numbers side by side.
   */
  const facts = [
    `${plural(
      withBooking,
      language,
      ['wspólnota', 'wspólnoty', 'wspólnot'],
      ['community', 'communities'],
    )} ${t.ksFactsWithBooking}`,
    `${remaining} ${t.ksFactsLeft}`,
  ];
  // The unit is the community, exactly as in the "Błędy" tile below: that tile
  // counts communities with a failed conversion (2), while `totals.errors` counts
  // the failed FILES behind them (5) — and a banner that said "5 błędy" over a
  // tile that said 2 contradicted it. Only when every failure sits in the row
  // with no community (so the tile reads 0) does the banner fall back to files,
  // and then it says so.
  const errorsOnlyInFiles = totals.withErrors === 0 && totals.errors > 0;
  if (totals.withErrors > 0) facts.push(`${totals.withErrors} ${t.ksFactsErrors}`);
  else if (errorsOnlyInFiles) facts.push(`${totals.errors} ${t.ksFactsErrorFiles}`);

  /**
   * The banner's last line is about priorities and nothing else: which
   * communities are flagged this month, in queue order. The month's other
   * numbers are the facts line above and the tiles below, and the old "what to do
   * next" sentence repeated them — so it gave way to the one thing the banner has
   * that the rest of the screen does not summarise.
   */
  const PRIORITY_SHOWN = 4;
  const shownPriorities = priorityGroups.slice(0, PRIORITY_SHOWN);
  const hiddenPriorities = priorityGroups.length - shownPriorities.length;

  return (
    // `--fill` so the lower band reaches the bottom of the window on a short
    // month; the page still scrolls once the list outgrows it.
    <div className="content-body content-body--fill">
      <div className="ksieg">
        {/* -------------------- Area one: the calendar ---------------------- */}
        {showCalendar && (
          <CalendarAlerts
            alerts={kalAlerts}
            language={language}
            locale={locale}
            next={kalNext}
            upcomingCount={kalUpcoming.length}
            onOpen={onShowInCalendar}
          />
        )}

        {tasksArea}

        {/* -------------------- Area two: the month's bookings -------------- */}
        <section
          className={`ks-area ks-area--ksieg${showCalendar ? '' : ' ks-area--ksieg-solo'}${
            folded ? ' ks-area--folded' : ''
          }`}
          // On the section, not the banner: the band's ground takes the month's
          // colour too, and the banner inherits it from here.
          style={{ ['--month-accent' as string]: monthAccent(monthNumber) }}
        >
        {/* ---------------------------- Month bar --------------------------- */}
        {/* The month's colour is the ground of the banner only; the content below
            stands on the bookings' usual ground. */}
        <div className="ksieg-banner-band">
        <header className="ksieg-hero">
          <div className="ksieg-hero__art">
            <MonthIllustration month={monthNumber} />
          </div>

          <div className="ksieg-hero__id">
            <span className="ksieg-hero__eyebrow">
              <Icon name="book" size={13} /> {t.ksTitle}
            </span>
            <h1 className="ksieg-hero__month">
              {monthName}
              <span>{year}</span>
            </h1>
            <p className="ksieg-hero__facts">{facts.join(' · ')}</p>
            {/* The month's priority queue — order and communities, nothing else. */}
            <p
              className={`ksieg-hero__nudge ksieg-hero__prio${
                priorityGroups.length === 0 ? ' is-empty' : ''
              }`}
            >
              <Icon name="flag" size={14} />
              {priorityGroups.length === 0 ? (
                t.ksPrioNone
              ) : (
                <>
                  <span className="ksieg-hero__prio-label">{t.ksPrioLine}</span>
                  {shownPriorities.map((g) => (
                    <span key={g.key} className="ksieg-hero__prio-item">
                      <b>{g.priorityRank}</b> {g.nazwa}
                    </span>
                  ))}
                  {hiddenPriorities > 0 && (
                    <span className="ksieg-hero__prio-more">
                      {t.ksPrioMore.replace('{n}', String(hiddenPriorities))}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>

          <div className="ksieg-hero__nav">
            <button
              type="button"
              className="ksieg-nav-arrow"
              onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}
              title={t.ksMonthPrev}
              aria-label={t.ksMonthPrev}
            >
              <Icon name="chevron-left" size={17} />
            </button>
            <Select
              overlay
              value={monthKey}
              options={monthOptions}
              onChange={setMonthKey}
              ariaLabel={t.ksMonthPick}
              className="ksieg-nav-select"
            />
            <button
              type="button"
              className="ksieg-nav-arrow"
              onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}
              title={t.ksMonthNext}
              aria-label={t.ksMonthNext}
            >
              <Icon name="chevron-right" size={17} />
            </button>
            <button
              type="button"
              className="ksieg-nav-today"
              onClick={() => setMonthKey(currentMonthKey())}
              disabled={monthKey === currentMonthKey()}
            >
              {t.ksThisMonth}
            </button>
            <button
              type="button"
              className="ksieg-scan-btn"
              onClick={() => setShowScan(true)}
              title={t.ksScanButtonHint}
            >
              <Icon name="search" size={15} />
              <span>{t.ksScanButton}</span>
            </button>
            <button
              type="button"
              className="ksieg-nav-arrow"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              title={t.ksRefresh}
              aria-label={t.ksRefresh}
            >
              <Icon name="refresh" size={16} />
            </button>
            {onToggleBookings && (
              <button
                type="button"
                className="ksieg-nav-arrow ksieg-fold"
                onClick={onToggleBookings}
                title={folded ? t.ksExpand : t.ksCollapse}
                aria-label={folded ? t.ksExpand : t.ksCollapse}
                aria-expanded={!folded}
              >
                <Icon name="chevron-down" size={17} />
              </button>
            )}
          </div>

          <div className="ksieg-hero__progress">
            <div className="ksieg-progress__head">
              <span className="ksieg-progress__label">{t.ksProgressLabel}</span>
              <span className="ksieg-progress__value">
                {t.ksProgressDone
                  .replace('{done}', String(totals.dom))
                  .replace('{total}', String(totals.addresses))}
                <strong>{totals.domPercent}%</strong>
              </span>
            </div>
            <div className="ksieg-progress__track">
              <div className="ksieg-progress__fill" style={{ width: `${totals.domPercent}%` }} />
            </div>
          </div>
        </header>
        </div>

        {!folded && (
        <div className="ksieg-content">
        {/* ------------------------ Categories / filters -------------------- */}
        <BookingTiles totals={totals} language={language} filter={filter} onFilter={setFilter} order={tiles} />

        {/* ----------------------------- Toolbar ---------------------------- */}
        <div className="ksieg-toolbar">
          <div className="ksieg-search">
            <Icon name="search" size={15} />
            <input
              type="text"
              placeholder={t.ksSearch}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {searchActive && (
              <button type="button" onClick={() => setSearch('')} title={t.close} aria-label={t.close}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
          <span className="ksieg-toolbar__count">
            {plural(visible.length, language, ['wspólnota', 'wspólnoty', 'wspólnot'], ['community', 'communities'])}
          </span>
          <Select
            value={sort}
            size="sm"
            options={[
              { value: 'todo-first', label: t.ksSortTodo },
              { value: 'name', label: t.ksSortName },
              { value: 'recent', label: t.ksSortRecent },
            ]}
            onChange={(value) => setSort(value as BookingSort)}
            className="ksieg-toolbar__sort"
          />
          {/* Kto: whose communities this month — like the Zadania board's filter. */}
          <SearchableSelect
            size="sm"
            overlay
            className={`ksieg-toolbar__who${whoFilter.kind === 'all' ? '' : ' is-active'}`}
            menuMinWidth={240}
            value={whoFilterValue(whoFilter)}
            options={[
              { value: 'all', label: t.ksWhoAll },
              { value: 'mine', label: t.ksWhoMine },
              { value: 'none', label: t.ksWhoNone },
              ...peopleOptions.map((o) => ({ ...o, value: `p:${o.value}` })),
            ]}
            onChange={(value) => setWhoFilter(parseWhoFilter(value))}
            searchPlaceholder={t.zadSearchPerson}
            emptyText={t.zadNoPersonFound}
            ariaLabel={t.ksWhoLabel}
            title={t.ksWhoLabel}
          />
          {priorityGroups.length > 0 && (
            <button
              type="button"
              className="ksieg-prio-order"
              onClick={() => setShowOrder(true)}
              title={t.ksPrioOrderHint}
            >
              <Icon name="flag" size={13} />
              <span>{t.ksPrioOrderButton}</span>
              <span className="ksieg-prio-order__count">{priorityGroups.length}</span>
            </button>
          )}
          {orderStale && (
            <button
              type="button"
              className="ksieg-resort"
              onClick={() => setSettleId((id) => id + 1)}
              title={t.ksResortHint}
            >
              <Icon name="refresh" size={13} />
              <span>{t.ksResort}</span>
            </button>
          )}
        </div>

        {/* -------------------------- The communities ------------------------ */}
        {visible.length === 0 ? (
          <div className="ksieg-empty">
            <Icon name={totals.rows === 0 ? 'calendar' : 'search'} size={34} />
            <span>{totals.rows === 0 ? t.ksMonthEmpty : t.ksNoResults}</span>
          </div>
        ) : (
          <div className="ksieg-rows">
            {/* Ticks every community the filter shows that has something to
                convert — aligned over the rows' own ticks. */}
            {selectable.length > 0 && (
              <div className="ksieg-selall">
                <span className="ksieg-row__select">
                  <label
                    className={`ks-check${allVisibleSelected ? ' is-on' : ''}${
                      selectedVisible > 0 && !allVisibleSelected ? ' is-mixed' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="ks-check__input"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedVisible > 0 && !allVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                      aria-label={t.ksSelectAll}
                    />
                    <span className="ks-check__box" aria-hidden="true">
                      <Icon name={selectedVisible > 0 && !allVisibleSelected ? 'minus' : 'check'} size={12} strokeWidth={3} />
                    </span>
                  </label>
                </span>
                <button type="button" className="ksieg-selall__label" onClick={toggleAllVisible}>
                  {allVisibleSelected ? t.ksSelectNone : t.ksSelectAll}
                </button>
                <span className="ksieg-selall__hint">{t.ksSelectRangeHint}</span>
              </div>
            )}
            {visible.map((group, index) => (
              <React.Fragment key={group.key}>
                {/* The queue is set apart from the rest by a heading above it
                    and a divider under it — the numbers on the rows say WHICH
                    order, these say WHERE the queue ends. */}
                {index === 0 && queueLength > 0 && (
                  <div className="ksieg-queue-head">
                    <Icon name="flag" size={14} />
                    <b>{t.ksPrioQueueTitle}</b>
                    <span>{t.ksPrioQueueSub}</span>
                  </div>
                )}
                {index === queueLength && queueLength > 0 && (
                  <div className="ksieg-queue-divider">
                    <span>{t.ksPrioRest}</span>
                  </div>
                )}
                <CommunityRow
                  group={group}
                  language={language}
                  locale={locale}
                  open={isOpen(group.key)}
                  onToggle={() => toggleRow(group.key)}
                  saving={saving}
                  formatDateTime={formatDateTime}
                  onSetBooked={setBooked}
                  onOpenFile={openFile}
                  onShowInHistory={onShowInHistory}
                  notes={noteActionsFor(group)}
                  plikActions={plikActions}
                  onConvert={() => convertGroup(group)}
                  onConvertOne={(status) => convertOne(group, status)}
                  selected={selected.has(group.key)}
                  onToggleSelected={(range) => toggleSelected(group.key, range)}
                  assignee={assigneeOf(group)}
                  users={users}
                  peopleOptions={peopleOptions}
                  onAssign={(email) => void assign(group, email)}
                  userEmail={userEmail}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ------- Ticked communities, converted together: floats at the bottom ------- */}
        {tickedGroups.length > 0 && (
          <div className="ksieg-selbar">
            <Icon name="check-circle" size={16} />
            <span className="ksieg-selbar__text">
              {t.ksSelectionBar
                .replace('{k}', String(tickedGroups.length))
                .replace('{n}', String(selectedFiles))}
            </span>
            <button type="button" className="ksieg-selbar__clear" onClick={() => setSelected(new Set())}>
              {t.ksSelectClear}
            </button>
            {/* Assign every ticked community to one person — a picker that acts on
                pick, dressed as a button beside "Konwertuj zaznaczone". */}
            <span className="ksieg-selbar__assign-wrap">
            <Icon name="user-plus" size={15} className="ksieg-selbar__assign-icon" />
            <SearchableSelect
              className="ksieg-selbar__assign"
              overlay
              menuMinWidth={260}
              value=""
              options={[
                ...(userEmail ? [{ value: ASSIGN_TO_ME, label: t.ksAssignToMe, hint: '' }] : []),
                // Not '': the picker's own value is empty, so that would show as chosen.
                { value: UNASSIGN, label: t.ksAssignNobody, hint: '' },
                ...peopleOptions,
              ]}
              onChange={(v) =>
                void assignTicked(v === ASSIGN_TO_ME ? userEmail ?? null : v === UNASSIGN ? null : v || null)
              }
              placeholder={t.ksAssignTicked}
              searchPlaceholder={t.zadSearchPerson}
              emptyText={t.zadNoPersonFound}
              ariaLabel={t.ksAssignTicked}
            />
            </span>
            {selectedFiles > 0 && (
              <button type="button" className="ksieg-convert" onClick={convertSelected}>
                <Icon name="zap" size={16} />
                <span>{t.ksConvertSelected.replace('{n}', String(selectedFiles))}</span>
              </button>
            )}
          </div>
        )}
        </div>
        )}
        </section>
      </div>

      {conversion && (
        <ConversionModal
          language={language}
          title={conversion.title}
          entries={conversion.entries}
          onClose={(converted) => {
            setConversion(null);
            if (converted) {
              setSelected(new Set());
              void load(true);
            }
          }}
        />
      )}

      {showScan && (
        <StatementScanModal
          language={language}
          monthKey={monthKey}
          monthLabel={monthLabel(monthKey, locale)}
          locale={locale}
          onClose={(changed) => {
            setShowScan(false);
            if (changed) void loadPliki();
          }}
        />
      )}

      {showOrder && (
        <PriorityOrderModal
          groups={priorityGroups}
          monthLabel={monthLabel(monthKey, locale)}
          language={language}
          saving={orderSaving}
          onSave={(ids) => void saveOrder(ids)}
          onClose={() => setShowOrder(false)}
        />
      )}
    </div>
  );
};

/* ---------------------------- Category tiles ------------------------------ */

interface TileProps {
  icon: React.ComponentProps<typeof Icon>['name'];
  value: number;
  label: string;
  hint: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  active: boolean;
  onClick: () => void;
}

/**
 * A tile is a filter, and every tile counts the same unit — communities. Mixing
 * files and communities in one row of numbers is what made this unreadable; the
 * file counts live in the month bar and the progress bar instead.
 */
const Tile: React.FC<TileProps> = ({ icon, value, label, hint, tone, active, onClick }) => (
  <button
    type="button"
    className={`ksieg-tile ksieg-tile--${tone} ${active ? 'is-active' : ''}`}
    onClick={onClick}
    aria-pressed={active}
  >
    <span className="ksieg-tile__icon">
      <Icon name={icon} size={16} />
    </span>
    <span className="ksieg-tile__value">{value}</span>
    <span className="ksieg-tile__label">{label}</span>
    <span className="ksieg-tile__hint">{hint}</span>
  </button>
);

/** Each filter tile's icon, tone and words — everything but its count. */
function bookingTileLooks(
  t: (typeof translations)[Language],
): Record<BookingFilter, Pick<TileProps, 'icon' | 'tone' | 'label' | 'hint'>> {
  return {
    all: { icon: 'map-pin', tone: 'neutral', label: t.ksTileAll, hint: t.ksTileAllHint },
    unbooked: { icon: 'file-text', tone: 'accent', label: t.ksTileUnbooked, hint: t.ksTileUnbookedHint },
    // The files "Znajdź pliki księgowe" pinned — same unit, communities.
    ready: { icon: 'file-check', tone: 'accent', label: t.ksTileReady, hint: t.ksTileReadyHint },
    waiting: { icon: 'clipboard', tone: 'warning', label: t.ksTileWaiting, hint: t.ksTileWaitingHint },
    dom: { icon: 'check-circle', tone: 'success', label: t.ksTileDom, hint: t.ksTileDomHint },
    nofiles: { icon: 'folder', tone: 'neutral', label: t.ksTileNoFiles, hint: t.ksTileNoFilesHint },
    nopdf: { icon: 'file-text', tone: 'warning', label: t.ksTileNoPdf, hint: t.ksTileNoPdfHint },
    errors: { icon: 'alert-triangle', tone: 'danger', label: t.ksTileErrors, hint: t.ksTileErrorsHint },
  };
}

/** The tiles as the order dialog (Ustawienia → Kolejność filtrów) lists them. */
export function bookingTileOrderItems(
  language: Language,
  order: BookingFilter[],
): { id: string; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[] {
  const looks = bookingTileLooks(translations[language]);
  return order.map((id) => ({ id, label: looks[id].label, icon: looks[id].icon }));
}

function tileCount(totals: BookingTotals, id: BookingFilter): number {
  return {
    all: totals.rows,
    unbooked: totals.unbooked,
    ready: totals.ready,
    waiting: totals.waiting,
    dom: totals.dom,
    nofiles: totals.noFiles,
    nopdf: totals.noPdf,
    errors: totals.withErrors,
  }[id];
}

const BookingTiles: React.FC<{
  totals: BookingTotals;
  language: Language;
  filter: BookingFilter;
  onFilter: (filter: BookingFilter) => void;
  /** Left to right, as the person arranged them. */
  order: BookingFilter[];
}> = ({ totals, language, filter, onFilter, order }) => {
  const looks = bookingTileLooks(translations[language]);
  return (
    <div className="ksieg-tiles">
      {order.map((id) => (
        <Tile
          key={id}
          {...looks[id]}
          value={tileCount(totals, id)}
          active={filter === id}
          onClick={() => onFilter(id)}
        />
      ))}
    </div>
  );
};

/* --------------------------- One community row ---------------------------- */

const Metric: React.FC<{ value: number; label: string; tone?: 'ok' | 'wait' | 'err' }> = ({
  value,
  label,
  tone,
}) => (
  <span className={`ksieg-metric ${tone ? `ksieg-metric--${tone}` : ''}`}>
    <b>{value}</b>
    <i>{label}</i>
  </span>
);

/**
 * What a row can do to its own priority and notes. Built per row by the view —
 * which owns the data and the writes — so the row stays a presentation of one
 * community and never learns about the month, the lists or the IPC.
 */
interface NoteActions {
  /** A write for this row is in flight; its controls wait for it to land. */
  busy: boolean;
  /** Flag the community (end of the queue) or take the flag off. */
  togglePriority: () => Promise<void>;
  savePriorityNote: (text: string) => Promise<boolean>;
  /** Empty the priority's note (asks first); the flag itself stays. */
  clearPriorityNote: () => Promise<boolean>;
  addUwaga: (text: string) => Promise<boolean>;
  updateUwaga: (id: number, text: string) => Promise<boolean>;
  setUwagaResolved: (id: number, resolved: boolean) => Promise<boolean>;
  deleteUwaga: (id: number) => Promise<boolean>;
}

const CommunityRow: React.FC<{
  group: AddressBookingGroup;
  language: Language;
  locale: string;
  open: boolean;
  onToggle: () => void;
  saving: Set<number>;
  formatDateTime: (iso: string) => string;
  onSetBooked: (ids: number[], booked: boolean, announce: boolean) => Promise<void>;
  onOpenFile: (filePath: string) => void;
  onShowInHistory?: (query: string) => void;
  notes: NoteActions;
  plikActions: PlikActions;
  /** Convert the community's waiting statements, in the dialog over the dashboard. */
  onConvert: () => void;
  /** Convert one of them. */
  onConvertOne: (status: PlikStatus) => void;
  /** Ticked for converting together with other communities. */
  selected: boolean;
  /** `range`: Shift was held — tick everything since the last tick. */
  onToggleSelected: (range: boolean) => void;
  /** Who posts this community this month (a mailbox), or nobody. */
  assignee: string | null;
  users: AppUser[];
  peopleOptions: { value: string; label: string; hint: string }[];
  onAssign: (email: string | null) => void;
  /** The signed-in mailbox, for "Przypisz do mnie". */
  userEmail?: string;
}> = ({
  group,
  language,
  locale,
  open,
  onToggle,
  saving,
  formatDateTime,
  onSetBooked,
  onOpenFile,
  onShowInHistory,
  notes,
  plikActions,
  onConvert,
  onConvertOne,
  selected,
  onToggleSelected,
  assignee,
  users,
  peopleOptions,
  onAssign,
  userEmail,
}) => {
  const t = translations[language];
  const assigneeUser = assignee ? users.find((u) => sameMailbox(u.email, assignee)) : undefined;
  // Which editor is open on this row. Local on purpose: it is a draft, and the
  // row below the one being typed in must not care.
  const [editingPrioNote, setEditingPrioNote] = useState(false);
  const [composing, setComposing] = useState(false);
  const [editingUwagaId, setEditingUwagaId] = useState<number | null>(null);
  const openUwagi = group.uwagi.filter((u) => !u.resolvedAt);
  const resolvedUwagi = group.uwagi.filter((u) => u.resolvedAt);
  const canNote = !group.unassigned;
  const showExtras = canNote && (group.priority !== null || openUwagi.length > 0 || composing);
  const bookings = group.rows.filter((r) => r.isBooking);
  const pendingIds = bookings.filter((r) => !r.bookedInDom).map((r) => r.entry.id);
  // "Cofnij wszystko" unticks real conversions only: a manual mark is taken back
  // on its own row, where undoing it removes it.
  const bookedIds = bookings.filter((r) => r.bookedInDom && !r.manual).map((r) => r.entry.id);
  const pct = group.generated === 0 ? 0 : Math.round((group.booked / group.generated) * 100);
  const busy = group.rows.some((r) => saving.has(r.entry.id));

  const subtitle = [
    group.banks.length > 0 ? group.banks.join(', ') : null,
    group.lastAt
      ? `${t.ksLastActivity} ${formatDateTime(group.lastAt)}`
      : group.lastBookingEverAt
        ? `${t.ksLastBooking} ${new Date(group.lastBookingEverAt).toLocaleDateString(locale, {
            month: 'long',
            year: 'numeric',
          })}`
        : t.ksLastBookingNever,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      className={`ksieg-row ksieg-row--${group.state} ${open ? 'is-open' : ''}${
        group.priorityRank !== null ? ' ksieg-row--priority' : ''
      }`}
    >
      {/* The tick for batch actions (convert, assign) sits left of the head —
          outside it, as the head is a button and cannot hold a control of its
          own. The whole head opens the row; there is no chevron to aim at. */}
      <div className={`ksieg-row__headwrap${canNote ? '' : ' is-plain'}`}>
      {canNote && (
        <span className="ksieg-row__select">
          <label
            className={`ks-check${selected ? ' is-on' : ''}`}
            title={t.ksSelectForConvert}
            // Shift+click selects a range; without this it also selects text.
            onMouseDown={(e) => {
              if (e.shiftKey) e.preventDefault();
            }}
          >
            <input
              type="checkbox"
              className="ks-check__input"
              checked={selected}
              // React fires a checkbox's change on its click, so the click's Shift is here.
              onChange={(e) => onToggleSelected((e.nativeEvent as MouseEvent).shiftKey === true)}
              aria-label={`${t.ksSelectForConvert}: ${group.nazwa}`}
            />
            <span className="ks-check__box" aria-hidden="true">
              <Icon name="check" size={12} strokeWidth={3} />
            </span>
        </label>
        </span>
      )}
      <button
        type="button"
        className="ksieg-row__head"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? t.ksCollapseRow : t.ksExpandRow}
      >
        <span className="ksieg-row__glyph">
          <Icon name={STATE_ICON[group.state]} size={17} />
        </span>
        <span className="ksieg-row__id">
          <span className="ksieg-row__name">
            <span className="ksieg-row__name-text">
              {group.unassigned ? t.ksUnassigned : group.nazwa}
            </span>
            <span className={`status-badge ksieg-state ksieg-state--${group.state}`}>
              {stateLabel(group.state, t)}
            </span>
            {group.priorityRank !== null && (
              <span
                className="ksieg-prio-badge"
                title={t.ksPrioBadgeHint.replace('{n}', String(group.priorityRank))}
              >
                <Icon name="flag" size={11} />
                {t.ksPrioBadge.replace('{n}', String(group.priorityRank))}
              </span>
            )}
            {group.statements.length > 0 && (
              <span
                className={`ksieg-files-badge${group.noPdf > 0 ? ' is-missing-pdf' : ''}`}
                title={t.ksFilesBadgeHint
                  .replace('{n}', String(group.statements.length))
                  .replace('{pdf}', String(group.statements.length - group.noPdf))
                  .replace('{ready}', String(group.ready))}
              >
                <Icon name="folder" size={11} />
                {t.ksFilesBadge.replace('{n}', String(group.statements.length))}
                {group.noPdf > 0 && <b>· {t.ksFileNoPdf}</b>}
              </span>
            )}
            {group.openUwagi > 0 && (
              <span className="ksieg-uwaga-badge" title={t.ksUwagaTitle}>
                <Icon name="message-square" size={11} />
                {group.openUwagi > 1 ? `${t.ksUwagaBadge} ${group.openUwagi}` : t.ksUwagaBadge}
              </span>
            )}
          </span>
          <span className="ksieg-row__sub">{subtitle}</span>
        </span>
        <span className="ksieg-row__metrics">
          <Metric value={group.generated} label={t.ksMetricFiles} />
          <Metric value={group.booked} label={t.ksMetricDom} tone="ok" />
          <Metric value={group.todo} label={t.ksMetricWaiting} tone="wait" />
          {group.ready > 0 && <Metric value={group.ready} label={t.ksMetricReady} tone="wait" />}
          {group.errors > 0 && <Metric value={group.errors} label={t.ksMetricErrors} tone="err" />}
        </span>
        <span className="ksieg-row__gauge" aria-hidden="true">
          <span className="ksieg-row__gauge-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="ksieg-row__gauge-val">{group.generated === 0 ? '—' : `${pct}%`}</span>
        </span>
      </button>
      </div>

      {/* The one action this view exists for — same place in every row. */}
      <div className="ksieg-row__cta">
        {canNote && (
          <span className="ksieg-row__tools">
            {/* Who posts it this month: the person IS the control, as on a task card. */}
            <span className="ksieg-who" title={assignee ?? t.ksAssignHint}>
              <span
                className={`zad-avatar${assignee ? '' : ' zad-avatar--none'}`}
                style={
                  assignee
                    ? { ['--avatar' as string]: personColor(assigneeUser ?? { email: assignee }) }
                    : undefined
                }
                aria-hidden="true"
              />
              <SearchableSelect
                className="zad-who-select ksieg-who__select"
                size="sm"
                overlay
                menuMinWidth={240}
                value={assignee ?? ''}
                options={[
                  ...(userEmail && !sameMailbox(assignee, userEmail)
                    ? [{ value: ASSIGN_TO_ME, label: t.ksAssignToMe, hint: '' }]
                    : []),
                  { value: '', label: t.ksAssignNobody, hint: '' },
                  ...peopleOptions,
                  ...(assignee && !assigneeUser ? [{ value: assignee, label: assignee, hint: '' }] : []),
                ]}
                onChange={(email) => onAssign(email === ASSIGN_TO_ME ? userEmail ?? null : email || null)}
                placeholder={t.ksAssignNobody}
                searchPlaceholder={t.zadSearchPerson}
                emptyText={t.zadNoPersonFound}
                ariaLabel={`${t.ksAssignLabel}: ${group.nazwa}`}
                title={t.ksAssignHint}
              />
            </span>
            <button
              type="button"
              className={`ksieg-tool ksieg-tool--flag${group.priority ? ' is-on' : ''}`}
              disabled={notes.busy}
              onClick={() => void notes.togglePriority()}
              title={group.priority ? t.ksPrioUnflag : t.ksPrioFlag}
              aria-label={group.priority ? t.ksPrioUnflag : t.ksPrioFlag}
              aria-pressed={group.priority !== null}
            >
              <Icon name="flag" size={16} />
            </button>
            <button
              type="button"
              className={`ksieg-tool ksieg-tool--note${openUwagi.length > 0 ? ' is-on' : ''}`}
              disabled={notes.busy}
              onClick={() => setComposing(true)}
              title={
                openUwagi.length > 0
                  ? t.ksUwagaButtonOpen.replace('{n}', String(openUwagi.length))
                  : t.ksUwagaButton
              }
              aria-label={t.ksUwagaButton}
            >
              <Icon name="message-square" size={16} />
            </button>
          </span>
        )}
        {/* One thing in the slot, in the order the work is done: convert what the
            scan pinned first — its file then goes to DOM in the same sitting as
            the rest — then post, then the "done" state. A row never shows a
            convert button beside "Zaksięgowane w DOM": that row is not done. */}
        {group.ready > 0 ? (
          <button
            type="button"
            className="ksieg-convert"
            onClick={onConvert}
            title={t.ksConvertReadyHint}
            aria-label={t.ksConvertReady.replace('{n}', String(group.ready))}
          >
            <Icon name="zap" size={16} />
            <span>{t.ksConvertShort}</span>
            <span className="ksieg-book__count">{group.ready}</span>
          </button>
        ) : pendingIds.length > 0 ? (
          <button
            type="button"
            className="ksieg-book"
            disabled={busy}
            onClick={() => void onSetBooked(pendingIds, true, true)}
          >
            <Icon name="check-circle" size={16} />
            <span>{t.ksBookInDom}</span>
          </button>
        ) : group.generated > 0 ? (
          <div className="ksieg-book-done">
            <span className="ksieg-book-done__label">
              <Icon name="check-circle" size={15} /> {t.ksAllInDom}
            </span>
            {bookedIds.length > 0 && (
              <button
                type="button"
                className="ksieg-book-undo"
                disabled={busy}
                onClick={() => void onSetBooked(bookedIds, false, true)}
              >
                {t.ksUnmarkAll}
              </button>
            )}
          </div>
        ) : (
          <span className="ksieg-book-none">{t.ksNoFileYet}</span>
        )}
      </div>

      {showExtras && (
        <div className="ksieg-row__extras">
          {/* The reason this community is in the queue, written for whoever does
              the posting — in its own field so it is read without a click. */}
          {group.priority && (
            <div className={`ksieg-prionote${editingPrioNote ? ' is-editing' : ''}`}>
              <span className="ksieg-prionote__label">
                <Icon name="flag" size={13} />
                {t.ksPrioNoteLabel}
              </span>
              {editingPrioNote ? (
                <NoteEditor
                  initial={group.priority.notatka}
                  placeholder={t.ksPrioNotePlaceholder}
                  saveLabel={t.save}
                  cancelLabel={t.cancel}
                  busy={notes.busy}
                  allowEmpty
                  onSave={async (text) => {
                    if (await notes.savePriorityNote(text)) setEditingPrioNote(false);
                  }}
                  onCancel={() => setEditingPrioNote(false)}
                />
              ) : (
                <>
                  <p className={`ksieg-prionote__text${group.priority.notatka ? '' : ' is-empty'}`}>
                    {group.priority.notatka || t.ksPrioNoteEmpty}
                  </p>
                  {/* The same two controls a posting note has. */}
                  <div className="ksieg-uwaga__actions">
                    <button
                      type="button"
                      className="button button-small button-ghost"
                      disabled={notes.busy}
                      onClick={() => setEditingPrioNote(true)}
                      title={group.priority.notatka ? t.edit : t.ksPrioNoteAdd}
                      aria-label={group.priority.notatka ? t.edit : t.ksPrioNoteAdd}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    {group.priority.notatka && (
                      <button
                        type="button"
                        className="button button-small button-danger"
                        disabled={notes.busy}
                        onClick={() => void notes.clearPriorityNote()}
                        title={t.delete}
                        aria-label={t.delete}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Remarks about posting this community. Independent of the queue. */}
          {openUwagi.map((uwaga) => (
            <div
              key={uwaga.id}
              className={`ksieg-uwaga${editingUwagaId === uwaga.id ? ' is-editing' : ''}`}
            >
              <span className="ksieg-uwaga__icon">
                <Icon name="message-square" size={15} />
              </span>
              {editingUwagaId === uwaga.id ? (
                <NoteEditor
                  initial={uwaga.tresc}
                  placeholder={t.ksUwagaPlaceholder}
                  saveLabel={t.save}
                  cancelLabel={t.cancel}
                  busy={notes.busy}
                  onSave={async (text) => {
                    if (await notes.updateUwaga(uwaga.id, text)) setEditingUwagaId(null);
                  }}
                  onCancel={() => setEditingUwagaId(null)}
                />
              ) : (
                <>
                  <div className="ksieg-uwaga__main">
                    <p className="ksieg-uwaga__text">{uwaga.tresc}</p>
                    <span className="ksieg-uwaga__meta">{uwagaMeta(uwaga, language, formatDateTime)}</span>
                    {group.state === 'done' && (
                      <span className="ksieg-uwaga__hint">{t.ksUwagaResolveHint}</span>
                    )}
                  </div>
                  <div className="ksieg-uwaga__actions">
                    <button
                      type="button"
                      className="button button-small button-success"
                      disabled={notes.busy}
                      title={t.ksUwagaResolveTip}
                      onClick={() => void notes.setUwagaResolved(uwaga.id, true)}
                    >
                      <Icon name="check-circle" size={13} /> {t.ksUwagaResolve}
                    </button>
                    <button
                      type="button"
                      className="button button-small button-ghost"
                      disabled={notes.busy}
                      onClick={() => setEditingUwagaId(uwaga.id)}
                      title={t.edit}
                      aria-label={t.edit}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      type="button"
                      className="button button-small button-danger"
                      disabled={notes.busy}
                      onClick={() => void notes.deleteUwaga(uwaga.id)}
                      title={t.delete}
                      aria-label={t.delete}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {composing && (
            <div className="ksieg-uwaga ksieg-uwaga--new is-editing">
              <span className="ksieg-uwaga__icon">
                <Icon name="message-square" size={15} />
              </span>
              <NoteEditor
                placeholder={t.ksUwagaPlaceholder}
                saveLabel={t.ksUwagaAddSave}
                cancelLabel={t.cancel}
                busy={notes.busy}
                onSave={async (text) => {
                  if (await notes.addUwaga(text)) setComposing(false);
                }}
                onCancel={() => setComposing(false)}
              />
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="ksieg-row__body">
          {group.unassigned && <p className="ksieg-row__note">{t.ksUnassignedHint}</p>}
          {resolvedUwagi.length > 0 && (
            <details className="ksieg-resolved">
              <summary>{t.ksUwagaResolvedHeading.replace('{n}', String(resolvedUwagi.length))}</summary>
              {resolvedUwagi.map((uwaga) => (
                <div key={uwaga.id} className="ksieg-resolved__item">
                  <div className="ksieg-resolved__main">
                    <p>{uwaga.tresc}</p>
                    <span>
                      {uwagaMeta(uwaga, language, formatDateTime)} · {uwagaResolvedMeta(uwaga, language, formatDateTime)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button button-small button-ghost"
                    disabled={notes.busy}
                    onClick={() => void notes.setUwagaResolved(uwaga.id, false)}
                  >
                    <Icon name="refresh" size={13} /> {t.ksUwagaReopen}
                  </button>
                </div>
              ))}
            </details>
          )}
          <PlikiSection
            group={group}
            language={language}
            formatDateTime={formatDateTime}
            actions={plikActions}
            onConvertOne={onConvertOne}
          />
          {group.rows.length === 0 ? (
            <div className="ksieg-files-empty">
              <Icon name="calendar" size={16} /> {t.ksNothingThisMonth}
            </div>
          ) : (
            <div className="ksieg-files">
              <div className="ksieg-files__head">
                <span>{t.ksColWhen}</span>
                <span>{t.ksColFiles}</span>
                <span>{t.ksColActions}</span>
                <span>{t.ksColDom}</span>
              </div>
              {group.rows.map((row) => (
                <FileRow
                  key={row.entry.id}
                  row={row}
                  pdf={group.pdfByConversionId.get(row.entry.id) ?? null}
                  onOpenPlik={plikActions.open}
                  language={language}
                  saving={saving.has(row.entry.id)}
                  formatDateTime={formatDateTime}
                  onSetBooked={onSetBooked}
                  onOpenFile={onOpenFile}
                  onShowInHistory={onShowInHistory}
                  onUndoManual={(r) => void plikActions.undoManual(r)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
};

/* ---------------------- Files pinned by the folder scan --------------------- */

/** What a row can do with a pinned file; the view owns the IPC. */
interface PlikActions {
  open: (plik: KsiegowaniePlik) => void;
  unpin: (plik: KsiegowaniePlik) => Promise<void>;
  /** Posted without converting: a DOM-ticked record with no accounting file. */
  markBooked: (status: PlikStatus) => Promise<void>;
  /** Take such a mark back — the statement is waiting again. */
  undoManual: (row: BookingRow) => Promise<void>;
}

/**
 * "Pliki z folderu" inside an open row: each pinned statement with its period,
 * where it stands (waiting / converted / in DOM) and its PDF; then the
 * unreadable ones, then PDFs that match no statement.
 */
const PlikiSection: React.FC<{
  group: AddressBookingGroup;
  language: Language;
  formatDateTime: (iso: string) => string;
  actions: PlikActions;
  onConvertOne: (status: PlikStatus) => void;
}> = ({ group, language, formatDateTime, actions, onConvertOne }) => {
  const t = translations[language];
  // PDFs already shown beside a statement or an accounting file are not "alone".
  const pairedPdfIds = new Set([
    ...group.statements.map((s) => s.pdf?.id).filter((id): id is number => id != null),
    ...[...group.pdfByConversionId.values()].map((p) => p.id),
  ]);
  const lonePdfs = group.pdfs.filter((p) => !pairedPdfIds.has(p.id));
  if (group.statements.length === 0 && group.fileErrors.length === 0 && lonePdfs.length === 0) return null;

  const fileButton = (plik: KsiegowaniePlik, icon: React.ComponentProps<typeof Icon>['name'], extraClass = '') => (
    <button
      type="button"
      className={`ksieg-node ${extraClass}`}
      title={`${t.ksFileOpen}: ${plik.relPath}`}
      onClick={() => actions.open(plik)}
    >
      <Icon name={icon} size={13} />
      <span className="ksieg-node__label">{plik.fileName}</span>
    </button>
  );

  // Said in words: an unlabelled × read as "close", not "unpin from the community".
  const unpin = (plik: KsiegowaniePlik) => (
    <button
      type="button"
      className="button button-small button-secondary"
      onClick={() => void actions.unpin(plik)}
      title={t.ksFileUnpinHint}
    >
      <Icon name="x" size={13} /> {t.ksFileUnpin}
    </button>
  );

  const statusChip = (s: PlikStatus) => {
    if (!s.conversion) return <span className="ksieg-plik-chip ksieg-plik-chip--wait">{t.ksFileWaiting}</span>;
    if (s.conversion.manual) {
      return (
        <span className="ksieg-plik-chip ksieg-plik-chip--dom" title={t.ksManualHint}>
          {t.ksFileInDomManual}
        </span>
      );
    }
    if (s.conversion.bookedInDom) return <span className="ksieg-plik-chip ksieg-plik-chip--dom">{t.ksFileInDom}</span>;
    return (
      <span className="ksieg-plik-chip ksieg-plik-chip--ok">
        {t.ksFileConverted.replace('{date}', formatDateTime(s.conversion.entry.convertedAt))}
      </span>
    );
  };

  return (
    <div className="ksieg-pliki">
      <div className="ksieg-pliki__head">
        <Icon name="folder" size={14} /> {t.ksFilesHeading}
      </div>
      {group.statements.map((s) => (
        <div key={s.plik.id} className="ksieg-plik">
          <div className="ksieg-plik__main">
            {/* The statement and its PDF side by side, read left to right. */}
            <div className="ksieg-plik__files">
              {fileButton(s.plik, 'file-text')}
              <span className="ksieg-plik__plus" aria-hidden="true">+</span>
              {s.pdf ? (
                fileButton(s.pdf, 'paperclip', 'ksieg-node--pdf')
              ) : (
                <span className="ksieg-plik-chip ksieg-plik-chip--warn">{t.ksFileNoPdf}</span>
              )}
              {/* What the file is and where it stands, read with its name. */}
              {statusChip(s)}
            </div>
            <span className="ksieg-plik__meta">
              {s.plik.accountTypeName && <span>{s.plik.accountTypeName}</span>}
              <span>{formatPeriod(s.plik.periodFrom, s.plik.periodTo)}</span>
              {s.plik.bankName && <span>{s.plik.bankName}</span>}
            </span>
          </div>
          <div className="ksieg-plik__actions">
            {!s.conversion && (
              // The single-file twin of the row's "Konwertuj pliki", the way a
              // file has its own "Zaksięguj w DOM".
              <button
                type="button"
                className="ksieg-convert ksieg-convert--sm"
                onClick={() => onConvertOne(s)}
                title={t.ksFileConvertHint}
              >
                <Icon name="zap" size={13} />
                <span>{t.ksFileConvert}</span>
              </button>
            )}
            {/* The rare ones behind "⋯": posting without converting (the
                fallback), taking that back, unpinning. */}
            <OverflowMenu
              label={t.convMoreActions}
              items={[
                ...(!s.conversion
                  ? [
                      {
                        icon: 'check-circle' as const,
                        label: t.ksFileMarkBooked,
                        title: t.ksFileMarkBookedHint,
                        onClick: () => void actions.markBooked(s),
                      },
                    ]
                  : []),
                ...(s.conversion?.manual
                  ? [
                      {
                        icon: 'undo' as const,
                        label: t.ksManualUndo,
                        onClick: () => void actions.undoManual(s.conversion!),
                      },
                    ]
                  : []),
                {
                  icon: 'x' as const,
                  label: t.ksFileUnpin,
                  title: t.ksFileUnpinHint,
                  onClick: () => void actions.unpin(s.plik),
                  danger: true,
                },
              ]}
            />
          </div>
        </div>
      ))}
      {group.fileErrors.map((plik) => (
        <div key={plik.id} className="ksieg-plik ksieg-plik--error">
          <div className="ksieg-plik__main">
            <div className="ksieg-plik__files">
              {fileButton(plik, 'alert-triangle')}
              <span className="ksieg-plik-chip ksieg-plik-chip--err">{t.ksFileUnreadable}</span>
            </div>
            <span className="ksieg-plik__meta">
              {plik.accountTypeName && <span>{plik.accountTypeName}</span>}
              <span className="ksieg-plik__error">{plik.errorMessage}</span>
            </span>
          </div>
          <div className="ksieg-plik__actions">{unpin(plik)}</div>
        </div>
      ))}
      {lonePdfs.map((plik) => (
        <div key={plik.id} className="ksieg-plik">
          <div className="ksieg-plik__main">
            <div className="ksieg-plik__files">
              {fileButton(plik, 'paperclip', 'ksieg-node--pdf')}
              <span className="ksieg-plik-chip ksieg-plik-chip--warn" title={t.ksFilePdfAloneHint}>
                {t.ksFilePdfAlone}
              </span>
            </div>
            <span className="ksieg-plik__meta">
              {plik.accountTypeName && <span>{plik.accountTypeName}</span>}
              <span>{formatPeriod(plik.periodFrom, plik.periodTo)}</span>
            </span>
          </div>
          <div className="ksieg-plik__actions">{unpin(plik)}</div>
        </div>
      ))}
    </div>
  );
};

/* ------------------------- One booking (one file) ------------------------- */

const FileRow: React.FC<{
  row: BookingRow;
  /** The statement's PDF found by the folder scan, when there is one. */
  pdf: KsiegowaniePlik | null;
  onOpenPlik: (plik: KsiegowaniePlik) => void;
  language: Language;
  saving: boolean;
  formatDateTime: (iso: string) => string;
  onSetBooked: (ids: number[], booked: boolean, announce: boolean) => Promise<void>;
  onOpenFile: (filePath: string) => void;
  onShowInHistory?: (query: string) => void;
  /** Take back a "posted without converting" mark. */
  onUndoManual: (row: BookingRow) => void;
}> = ({ row, pdf, onOpenPlik, language, saving, formatDateTime, onSetBooked, onOpenFile, onShowInHistory, onUndoManual }) => {
  const t = translations[language];
  const { entry } = row;
  const accountingPath = entry.outputPath ? resolveOutputFilePath(entry.outputPath, 'accounting') : '';
  const previewPath = entry.outputPath ? resolveOutputFilePath(entry.outputPath, 'preview') : '';

  const stamp = (): string | null => {
    if (!row.bookedInDom || !entry.bookedInDomAt) return null;
    const date = formatDateTime(entry.bookedInDomAt);
    return entry.bookedInDomBy
      ? t.ksBookedAtBy.replace('{date}', date).replace('{who}', entry.bookedInDomBy)
      : t.ksBookedAt.replace('{date}', date);
  };

  return (
    <div
      className={`ksieg-file ${row.isBooking ? '' : 'ksieg-file--failed'} ${
        row.bookedInDom ? 'is-booked' : ''
      }`}
    >
      <div className="ksieg-file__when">{formatDateTime(entry.convertedAt)}</div>

      <div className="ksieg-file__files">
        <div className="ksieg-flow">
          <button
            type="button"
            className="ksieg-node"
            title={entry.inputPath || entry.fileName}
            onClick={() => entry.inputPath && onOpenFile(entry.inputPath)}
            disabled={!entry.inputPath}
          >
            <Icon name="file-text" size={13} />
            <span className="ksieg-node__label">{entry.fileName}</span>
          </button>
          <Icon name="arrow-right" size={14} className="ksieg-flow__arrow" />
          {row.manual ? (
            // No accounting file: it was posted without one.
            <span className="ksieg-node ksieg-node--manual" title={t.ksManualHint}>
              <Icon name="check-circle" size={13} />
              <span className="ksieg-node__label">{t.ksManualNode}</span>
            </span>
          ) : row.isBooking ? (
            <button
              type="button"
              className="ksieg-node ksieg-node--out"
              title={accountingPath}
              onClick={() => onOpenFile(accountingPath)}
            >
              <Icon name="file-check" size={13} />
              <span className="ksieg-node__label">{baseName(accountingPath)}</span>
            </button>
          ) : (
            <span className="ksieg-node ksieg-node--missing">
              <Icon name="x-circle" size={13} />
              <span className="ksieg-node__label">{t.ksErrorRow}</span>
            </span>
          )}
          {row.isBooking && pdf && (
            <button
              type="button"
              className="ksieg-node ksieg-node--pdf"
              title={`${t.ksFileOpen}: ${pdf.relPath}`}
              onClick={() => onOpenPlik(pdf)}
            >
              <Icon name="paperclip" size={13} />
              <span className="ksieg-node__label">{pdf.fileName}</span>
            </button>
          )}
        </div>
        <div className="ksieg-file__meta">
          {entry.bankName && <span>{entry.bankName}</span>}
          {entry.converterName && <span>{entry.converterName}</span>}
          {stamp() && <span className="ksieg-file__stamp">{stamp()}</span>}
          {entry.status === 'error' && entry.errorMessage && (
            <span className="ksieg-file__error">{entry.errorMessage}</span>
          )}
        </div>
      </div>

      <div className="ksieg-file__actions">
        {row.isBooking && !row.manual && (
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={() => onOpenFile(previewPath)}
          >
            <Icon name="eye" size={13} /> {t.openPreview}
          </button>
        )}
        {/* A manual mark is not a conversion, so the history has nothing on it. */}
        {onShowInHistory && !row.manual && (
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={() => onShowInHistory(entry.fileName)}
            title={t.ksShowInHistory}
            aria-label={t.ksShowInHistory}
          >
            <Icon name="history" size={13} />
          </button>
        )}
      </div>

      {/* The community's button, scoped to this one file — same action, same
          place in every row, so a single exception costs one click. */}
      <div className="ksieg-file__book">
        {!row.isBooking ? (
          <span className="status-badge status-error">{t.error}</span>
        ) : row.manual ? (
          <div className="ksieg-book-done ksieg-book-done--sm">
            <span className="ksieg-book-done__label">
              <Icon name="check-circle" size={14} /> {t.ksInDom}
            </span>
            <button type="button" className="ksieg-book-undo" disabled={saving} onClick={() => onUndoManual(row)}>
              {t.ksManualUndoShort}
            </button>
          </div>
        ) : row.bookedInDom ? (
          <div className="ksieg-book-done ksieg-book-done--sm">
            <span className="ksieg-book-done__label">
              <Icon name="check-circle" size={14} /> {t.ksInDom}
            </span>
            <button
              type="button"
              className="ksieg-book-undo"
              disabled={saving}
              onClick={() => void onSetBooked([entry.id], false, false)}
            >
              {t.ksUnmarkAll}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="ksieg-book ksieg-book--sm"
            disabled={saving}
            title={t.ksToggleDom}
            onClick={() => void onSetBooked([entry.id], true, false)}
          >
            <Icon name="check-circle" size={14} />
            <span>{t.ksBookInDom}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default Ksiegowania;
