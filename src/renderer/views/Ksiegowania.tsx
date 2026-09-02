import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Adres,
  ConversionHistory,
  Spotkanie,
  SpotkanieMailing,
  SpotkanieTyp,
} from '../../shared/types';
import { translations, Language } from '../translations';
import { useNotify } from '../components/Notifications';
import Loader from '../components/Loader';
import Icon from '../components/Icon';
import Select from '../components/Select';
import MonthIllustration, { monthAccent } from '../components/MonthIllustration';
import {
  countAlerts,
  hasAnyAlert,
  sentByMailingIds,
  spotkaniaFromToday,
  SpotkaniaAlerts,
  SpotkanieStateFilter,
} from '../../shared/calendar';
import { resolveOutputFilePath } from '../../shared/outputPaths';
import {
  AddressBookingGroup,
  BookingFilter,
  BookingRow,
  BookingSort,
  BookingTotals,
  currentMonthKey,
  groupByAddress,
  matchesBookingFilter,
  matchesBookingSearch,
  monthLabel,
  monthsWithData,
  shiftMonthKey,
  sortGroups,
  toBookingRows,
} from '../../shared/bookings';

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
}

/** Polish plural: [one, few (2-4), many]. English: [singular, plural]. */
function plural(n: number, language: Language, pl: [string, string, string], en: [string, string]): string {
  if (language === 'en') return `${n} ${n === 1 ? en[0] : en[1]}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (n === 1) word = pl[0];
  else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) word = pl[1];
  else word = pl[2];
  return `${n} ${word}`;
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
  onOpen?: (filter: SpotkanieStateFilter) => void;
}> = ({ alerts, language, onOpen }) => {
  const t = translations[language];
  const anything = hasAnyAlert(alerts);

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
      <header className="ks-area__banner">
        <span className="ks-area__icon" aria-hidden="true">
          <Icon name="calendar" size={22} />
        </span>
        <div className="ks-area__id">
          <span className="ks-area__eyebrow">{t.ksKalEyebrow}</span>
          <h2 className="ks-area__title">{t.ksKalTitle}</h2>
          <p className="ks-area__sub">{t.ksKalNote}</p>
        </div>
        {onOpen && (
          <button type="button" className="ks-area__action" onClick={() => onOpen('all')}>
            {t.ksKalOpenAll} <Icon name="arrow-right" size={13} />
          </button>
        )}
      </header>

      {/* Nothing outstanding is worth saying outright — four zeros would leave
          the reader counting them to find that out. */}
      {anything ? (
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
      ) : (
        <div className="ks-kal__clear">
          <Icon name="check-circle" size={16} />
          <span>{t.ksKalAllClear}</span>
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
}) => {
  const t = translations[language];
  const notify = useNotify();
  const locale = language === 'en' ? 'en-GB' : 'pl-PL';

  const [history, setHistory] = useState<ConversionHistory[]>([]);
  const [adresy, setAdresy] = useState<Adres[]>([]);
  // The calendar's side of the dashboard: enough to count the four states the
  // section reports, read from the same three sources the Kalendarz reads.
  const [spotkania, setSpotkania] = useState<Spotkanie[]>([]);
  const [spotkaniaTypy, setSpotkaniaTypy] = useState<SpotkanieTyp[]>([]);
  const [spotkaniaMailingi, setSpotkaniaMailingi] = useState<SpotkanieMailing[]>([]);
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
      const [historyData, adresyData, spotkaniaData, typyData, mailingiData] = await Promise.all([
        window.electronAPI.getHistory(),
        window.electronAPI.getAdresy(),
        window.electronAPI.getSpotkania(),
        window.electronAPI.getSpotkaniaTypy(),
        window.electronAPI.getSpotkaniaMailingi(),
      ]);
      setHistory(historyData);
      setAdresy(adresyData);
      setSpotkania(spotkaniaData);
      setSpotkaniaTypy(typyData);
      setSpotkaniaMailingi(mailingiData);
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

  const rows = useMemo(() => toBookingRows(history, adresy), [history, adresy]);
  const months = useMemo(() => monthsWithData(rows), [rows]);
  const { groups, totals } = useMemo(
    () => groupByAddress(rows, adresy, monthKey),
    [rows, adresy, monthKey],
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
  const orderKey = `${monthKey}|${filter}|${sort}|${search.trim().toLowerCase()}|${settleId}`;
  const settled = useRef<{ key: string; keys: string[] }>({ key: '', keys: [] });

  const { visible, orderStale } = useMemo(() => {
    const matching = groups.filter(
      (g) => matchesBookingFilter(g, filter) && matchesBookingSearch(g, search),
    );
    const sorted = sortGroups(matching, sort, locale);
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
    const fresh = sorted.filter((g) => !heldKeys.has(g.key));
    const list = [...held, ...fresh];
    // Remember what is actually on screen, every time — remembering only at
    // settle time would freeze the empty list of the very first render, and the
    // list would go on re-sorting itself under every tick.
    settled.current = { key: orderKey, keys: list.map((g) => g.key) };
    const stale = list.length !== sorted.length || list.some((g, i) => g.key !== sorted[i]?.key);
    return { visible: list, orderStale: stale };
  }, [groups, filter, search, sort, locale, orderKey]);

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
      const result = await window.electronAPI.setHistoryBookedInDom(ids, booked);
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

  const openFile = async (filePath: string) => {
    const ok = await window.electronAPI.openFile(filePath);
    if (!ok) notify.error(t.fileNotFound);
  };

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

  const facts = [
    plural(totals.rows, language, ['wspólnota', 'wspólnoty', 'wspólnot'], ['community', 'communities']),
    plural(
      totals.generated,
      language,
      ['plik księgowy', 'pliki księgowe', 'plików księgowych'],
      ['accounting file', 'accounting files'],
    ),
    `${totals.todo} ${t.ksFactsWaiting}`,
  ];
  if (totals.errors > 0) facts.push(`${totals.errors} ${t.ksFactsErrors}`);

  // One sentence naming the next move, in the same order the work happens.
  // Errors outrank everything — a month with a failed conversion is not
  // finished even when nothing is left to tick. And it only says "done" where
  // the progress bar beside it can read 100%: every community posted, not
  // merely every file that happens to exist.
  const nudge = ((): { text: string; done: boolean } => {
    if (totals.errors > 0) {
      return { text: t.ksNudgeErrors.replace('{n}', String(totals.errors)), done: false };
    }
    if (totals.generated === 0) return { text: t.ksNudgeEmpty, done: false };
    if (totals.todo > 0) {
      return { text: t.ksNudgeTodo.replace('{n}', String(totals.todo)), done: false };
    }
    if (totals.unbooked > 0) {
      return { text: t.ksNudgeMissing.replace('{n}', String(totals.unbooked)), done: false };
    }
    return { text: t.ksNudgeDone, done: true };
  })();

  return (
    <div className="content-body">
      <div className="ksieg">
        {/* -------------------- Area one: the calendar ---------------------- */}
        <CalendarAlerts alerts={kalAlerts} language={language} onOpen={onShowInCalendar} />

        {/* -------------------- Area two: the month's bookings -------------- */}
        <section className="ks-area ks-area--ksieg">
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
              <Icon name="book" size={13} /> {t.ksTitle}
            </span>
            <h1 className="ksieg-hero__month">
              {monthName}
              <span>{year}</span>
            </h1>
            <p className="ksieg-hero__facts">{facts.join(' · ')}</p>
            {/* What to do next, read off the month's actual state. The tiles
                and the bar give the numbers; this says what to do with them. */}
            <p className={`ksieg-hero__nudge${nudge.done ? ' is-done' : ''}`}>
              <Icon name={nudge.done ? 'check-circle' : 'arrow-right'} size={14} />
              {nudge.text}
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
              className="ksieg-nav-arrow"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              title={t.ksRefresh}
              aria-label={t.ksRefresh}
            >
              <Icon name="refresh" size={16} />
            </button>
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

        {/* ------------------------ Categories / filters -------------------- */}
        <BookingTiles totals={totals} language={language} filter={filter} onFilter={setFilter} />

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
            {visible.map((group) => (
              <CommunityRow
                key={group.key}
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
              />
            ))}
          </div>
        )}
        </section>
      </div>
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

const BookingTiles: React.FC<{
  totals: BookingTotals;
  language: Language;
  filter: BookingFilter;
  onFilter: (filter: BookingFilter) => void;
}> = ({ totals, language, filter, onFilter }) => {
  const t = translations[language];
  return (
    <div className="ksieg-tiles">
      <Tile
        icon="map-pin"
        tone="neutral"
        value={totals.rows}
        label={t.ksTileAll}
        hint={t.ksTileAllHint}
        active={filter === 'all'}
        onClick={() => onFilter('all')}
      />
      <Tile
        icon="file-text"
        tone="accent"
        value={totals.unbooked}
        label={t.ksTileUnbooked}
        hint={t.ksTileUnbookedHint}
        active={filter === 'unbooked'}
        onClick={() => onFilter('unbooked')}
      />
      <Tile
        icon="clipboard"
        tone="warning"
        value={totals.waiting}
        label={t.ksTileWaiting}
        hint={t.ksTileWaitingHint}
        active={filter === 'waiting'}
        onClick={() => onFilter('waiting')}
      />
      <Tile
        icon="check-circle"
        tone="success"
        value={totals.dom}
        label={t.ksTileDom}
        hint={t.ksTileDomHint}
        active={filter === 'dom'}
        onClick={() => onFilter('dom')}
      />
      <Tile
        icon="alert-triangle"
        tone="danger"
        value={totals.withErrors}
        label={t.ksTileErrors}
        hint={t.ksTileErrorsHint}
        active={filter === 'errors'}
        onClick={() => onFilter('errors')}
      />
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
}) => {
  const t = translations[language];
  const bookings = group.rows.filter((r) => r.isBooking);
  const pendingIds = bookings.filter((r) => !r.bookedInDom).map((r) => r.entry.id);
  const bookedIds = bookings.filter((r) => r.bookedInDom).map((r) => r.entry.id);
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
    <article className={`ksieg-row ksieg-row--${group.state} ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="ksieg-row__head"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? t.ksCollapseRow : t.ksExpandRow}
      >
        <span className="ksieg-row__chev">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
        </span>
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
          </span>
          <span className="ksieg-row__sub">{subtitle}</span>
        </span>
        <span className="ksieg-row__metrics">
          <Metric value={group.generated} label={t.ksMetricFiles} />
          <Metric value={group.booked} label={t.ksMetricDom} tone="ok" />
          <Metric value={group.todo} label={t.ksMetricWaiting} tone="wait" />
          {group.errors > 0 && <Metric value={group.errors} label={t.ksMetricErrors} tone="err" />}
        </span>
        <span className="ksieg-row__gauge" aria-hidden="true">
          <span className="ksieg-row__gauge-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="ksieg-row__gauge-val">{group.generated === 0 ? '—' : `${pct}%`}</span>
        </span>
      </button>

      {/* The one action this view exists for — same place in every row. */}
      <div className="ksieg-row__cta">
        {pendingIds.length > 0 ? (
          <button
            type="button"
            className="ksieg-book"
            disabled={busy}
            onClick={() => void onSetBooked(pendingIds, true, true)}
          >
            <Icon name="check-circle" size={16} />
            <span>{t.ksBookInDom}</span>
            <span className="ksieg-book__count">{pendingIds.length}</span>
          </button>
        ) : group.generated > 0 ? (
          <div className="ksieg-book-done">
            <span className="ksieg-book-done__label">
              <Icon name="check-circle" size={15} /> {t.ksAllInDom}
            </span>
            <button
              type="button"
              className="ksieg-book-undo"
              disabled={busy}
              onClick={() => void onSetBooked(bookedIds, false, true)}
            >
              {t.ksUnmarkAll}
            </button>
          </div>
        ) : (
          <span className="ksieg-book-none">{t.ksNoFileYet}</span>
        )}
      </div>

      {open && (
        <div className="ksieg-row__body">
          {group.unassigned && <p className="ksieg-row__note">{t.ksUnassignedHint}</p>}
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
                  language={language}
                  saving={saving.has(row.entry.id)}
                  formatDateTime={formatDateTime}
                  onSetBooked={onSetBooked}
                  onOpenFile={onOpenFile}
                  onShowInHistory={onShowInHistory}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
};

/* ------------------------- One booking (one file) ------------------------- */

const FileRow: React.FC<{
  row: BookingRow;
  language: Language;
  saving: boolean;
  formatDateTime: (iso: string) => string;
  onSetBooked: (ids: number[], booked: boolean, announce: boolean) => Promise<void>;
  onOpenFile: (filePath: string) => void;
  onShowInHistory?: (query: string) => void;
}> = ({ row, language, saving, formatDateTime, onSetBooked, onOpenFile, onShowInHistory }) => {
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
          {row.isBooking ? (
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
        {row.isBooking && (
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={() => onOpenFile(previewPath)}
          >
            <Icon name="eye" size={13} /> {t.openPreview}
          </button>
        )}
        {onShowInHistory && (
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
