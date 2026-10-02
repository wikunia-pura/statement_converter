import React, { useEffect, useMemo, useState } from 'react';
import { Zadanie, ZadanieStatus } from '../../shared/types';
import { ZadaniaFilterSeed, dayKey, dueBucket, formatDayKey } from '../../shared/zadania';
import { translations, Language } from '../translations';
import Icon from './Icon';
import TasksIllustration from './TasksIllustration';

/** Hover card geometry — kept in step with `.zp-tip` in the stylesheet. */
const TIP_WIDTH = 340;
const TIP_MARGIN = 8;
/** Cards a hover card lists before it collapses the rest into "+N więcej". */
const TIP_CARDS = 4;

/** An open hover card: which tile, and the viewport edges it hangs off. */
interface TipState {
  key: string;
  left: number;
  top?: number;
  bottom?: number;
}

/** Soonest deadline first; a task with no date goes after every dated one. */
function byDeadline(a: Zadanie, b: Zadanie): number {
  if (a.termin === b.termin) return a.id - b.id;
  if (!a.termin) return 1;
  if (!b.termin) return -1;
  return a.termin < b.termin ? -1 : 1;
}

interface Props {
  language: Language;
  /** The signed-in mailbox — the dashboard shows only what is assigned to it. */
  userEmail: string;
  /** Open the board, already filtered the way the tile that was clicked says. */
  onOpen: (seed: ZadaniaFilterSeed) => void;
}

/**
 * The dashboard's slice of "Zadania", built like the calendar's band above it: a
 * rounded banner (what and how much, and what is due next) and a row of tiles,
 * each the way into the board with the matching filter already on.
 *
 * Three tiles split MY open tasks by where the deadline stands — overdue, today,
 * upcoming — and a fourth, "Wszystkie", opens everything assigned to me, done
 * and undated included. A task with no date has no place in the split, so only
 * the last tile counts it; a finished task is never counted as something to do.
 *
 * Reads its own data and fails quietly: the dashboard is the first screen, and
 * a missing task list must not cost the person their bookings.
 */
const ZadaniaPulpit: React.FC<Props> = ({ language, userEmail, onOpen }) => {
  const t = translations[language];
  const locale = language === 'en' ? 'en' : 'pl';
  const [zadania, setZadania] = useState<Zadanie[] | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  // The card is anchored to the viewport, so it would be left hanging in place
  // while the dashboard moves underneath it: close it on any scroll.
  useEffect(() => {
    if (!tip) return undefined;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [tip]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getZadania()
      .then((rows) => {
        if (!cancelled) setZadania(rows);
      })
      .catch(() => {
        if (!cancelled) setZadania([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const today = dayKey();
    const me = userEmail.trim().toLowerCase();
    const all = (zadania ?? []).filter(
      (z) => !z.zarchiwizowane && (z.przypisanyEmail ?? '').trim().toLowerCase() === me
    );
    const open = all.filter((z) => z.status !== 'done');
    const count = { overdue: 0, today: 0, upcoming: 0 };
    const lists: Record<'overdue' | 'today' | 'upcoming', Zadanie[]> = {
      overdue: [],
      today: [],
      upcoming: [],
    };
    let next: Zadanie | null = null;
    for (const z of open) {
      const bucket = dueBucket(z.termin, today);
      if (!bucket) continue;
      count[bucket] += 1;
      lists[bucket].push(z);
      // The nearest deadline that has not passed — what the banner says is next.
      if (bucket !== 'overdue' && (!next || (z.termin ?? '') < (next.termin ?? ''))) next = z;
    }
    // What the "Wszystkie" card previews: what is still to do first, finished last.
    const everything = [...open]
      .sort(byDeadline)
      .concat(all.filter((z) => z.status === 'done').sort(byDeadline));
    const byStatus: Record<ZadanieStatus, number> = { todo: 0, in_progress: 0, done: 0 };
    for (const z of all) byStatus[z.status] += 1;
    return {
      ...count,
      lists: {
        overdue: lists.overdue.sort(byDeadline),
        today: lists.today.sort(byDeadline),
        upcoming: lists.upcoming.sort(byDeadline),
        all: everything,
      },
      byStatus,
      total: all.length,
      open: open.length,
      undated: open.filter((z) => !z.termin).length,
      next,
    };
  }, [zadania, userEmail]);

  const today = dayKey();

  // Nothing until the read answers: a flash of zeros that then fills in is worse
  // than a band that appears a beat late.
  if (zadania === null) return null;

  const facts = [
    t.zadDashFactsOpen.replace('{count}', String(stats.open)),
    stats.next
      ? t.zadDashFactsNext
          .replace('{when}', formatDayKey(stats.next.termin ?? '', locale))
          .replace('{name}', stats.next.tytul)
      : t.zadDashFactsNoNext,
  ];

  /**
   * Position the hover card off the tile's own box. Anchoring from whichever
   * viewport edge is further away means the card never has to be measured
   * before it is placed, so it appears on the first frame (as the calendar's does).
   */
  const showTip = (event: React.SyntheticEvent<HTMLElement>, key: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(
      TIP_MARGIN,
      Math.min(rect.left, window.innerWidth - TIP_WIDTH - TIP_MARGIN),
    );
    const below = rect.bottom <= window.innerHeight / 2;
    setTip({
      key,
      left,
      top: below ? rect.bottom + TIP_MARGIN : undefined,
      bottom: below ? undefined : window.innerHeight - rect.top + TIP_MARGIN,
    });
  };

  const tiles: {
    key: string;
    seed: ZadaniaFilterSeed;
    count: number;
    tone: string;
    icon: React.ComponentProps<typeof Icon>['name'];
    label: string;
    hint: string;
  }[] = [
    {
      key: 'overdue',
      seed: { who: 'mine', due: 'overdue' },
      count: stats.overdue,
      tone: 'overdue',
      icon: 'alert-circle',
      label: t.zadDashOverdue,
      hint: t.zadDashOverdueHint,
    },
    {
      key: 'today',
      seed: { who: 'mine', due: 'today' },
      count: stats.today,
      tone: 'today',
      icon: 'clock',
      label: t.zadDashToday,
      hint: t.zadDashTodayHint,
    },
    {
      key: 'upcoming',
      seed: { who: 'mine', due: 'upcoming' },
      count: stats.upcoming,
      tone: 'upcoming',
      icon: 'calendar',
      label: t.zadDashUpcoming,
      hint: t.zadDashUpcomingHint,
    },
    {
      key: 'all',
      seed: { who: 'mine', due: 'all' },
      count: stats.total,
      tone: 'all',
      icon: 'clipboard',
      label: t.zadDashAll,
      hint: t.zadDashAllHint
        .replace('{open}', String(stats.open))
        .replace('{undated}', String(stats.undated)),
    },
  ];

  return (
    <section className="ks-area ks-area--zad">
      {/* The calendar's banner, in the tasks' own blue: same grid, same glow. */}
      <header className="ks-kal-hero ks-kal-hero--zad">
        <div className="ks-kal-hero__art">
          <TasksIllustration />
        </div>

        <div className="ks-kal-hero__id">
          <span className="ks-kal-hero__eyebrow">
            <Icon name="clipboard" size={13} /> {t.zadania}
          </span>
          <h2 className="ks-kal-hero__title">{t.zadDashTitle}</h2>
          <p className="ks-kal-hero__facts">{facts.join(' · ')}</p>
          <p className="ks-kal-hero__sub">{t.zadDashHint}</p>
        </div>

        <div className="ks-kal-hero__nav">
          <button
            type="button"
            className="ks-area__action"
            onClick={() => onOpen({ who: 'mine', due: 'all' })}
          >
            {t.zadDashOpen} <Icon name="arrow-right" size={13} />
          </button>
        </div>
      </header>

      <div className="ks-kal__tiles">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            className={`ks-kal-tile ks-kal-tile--${tile.tone}${tile.count === 0 ? ' is-empty' : ''}`}
            onClick={() => {
              setTip(null);
              onOpen(tile.seed);
            }}
            disabled={tile.count === 0}
            // A tile with something behind it gets the hover card instead of the
            // native tooltip; an empty one is disabled, never fires hover, and
            // keeps the plain hint.
            title={tile.count === 0 ? tile.hint : undefined}
            onMouseEnter={tile.count > 0 ? (e) => showTip(e, tile.key) : undefined}
            onMouseLeave={() => setTip(null)}
            onFocus={tile.count > 0 ? (e) => showTip(e, tile.key) : undefined}
            onBlur={() => setTip(null)}
          >
            <span className="ks-kal-tile__icon">
              <Icon name={tile.icon} size={16} />
            </span>
            <span className="ks-kal-tile__count">{tile.count}</span>
            <span className="ks-kal-tile__label">{tile.label}</span>
            <span className="ks-kal-tile__hint">{tile.hint}</span>
          </button>
        ))}
      </div>

      {tip && (() => {
        const tile = tiles.find((x) => x.key === tip.key);
        const cards = stats.lists[tip.key as keyof typeof stats.lists] ?? [];
        if (!tile) return null;
        const columns: { status: ZadanieStatus; label: string }[] = [
          { status: 'todo', label: t.zadColTodo },
          { status: 'in_progress', label: t.zadColInProgress },
          { status: 'done', label: t.zadColDone },
        ];
        return (
          <div
            className={`zp-tip zp-tip--${tile.tone}`}
            role="tooltip"
            style={{ left: tip.left, top: tip.top, bottom: tip.bottom }}
          >
            <div className="zp-tip__head">
              <span className="zp-tip__icon">
                <Icon name={tile.icon} size={13} />
              </span>
              <span className="zp-tip__title">{tile.label}</span>
              <span className="zp-tip__count">{tile.count}</span>
            </div>

            {/* The board in miniature: how the tasks split across its three columns. */}
            {tip.key === 'all' && (
              <div className="zp-tip__strip">
                {columns.map((col) => (
                  <span key={col.status} className={`zp-tip__col zp-tip__col--${col.status}`}>
                    <span className="zp-tip__col-count">{stats.byStatus[col.status]}</span>
                    <span className="zp-tip__col-label">{col.label}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="zp-tip__cards">
              {cards.slice(0, TIP_CARDS).map((z) => {
                const done = z.status === 'done';
                const bucket = dueBucket(z.termin, today);
                const statusLabel = columns.find((c) => c.status === z.status)?.label;
                return (
                  <div key={z.id} className={`zp-card zp-card--${z.status}`}>
                    <div className="zp-card__head">
                      <span className="zp-card__title">{z.tytul}</span>
                      {z.termin && (
                        <span
                          className={`zad-due zad-due--${done ? 'done' : (bucket ?? 'upcoming')}`}
                        >
                          <Icon name="calendar" size={11} />
                          {!done && bucket === 'today'
                            ? t.zadDueToday
                            : formatDayKey(z.termin, locale)}
                        </span>
                      )}
                    </div>
                    {z.opis && <div className="zp-card__desc">{z.opis}</div>}
                    <div className="zp-card__meta">
                      <span className="zp-card__status">{statusLabel}</span>
                      {z.zalaczniki.length > 0 && (
                        <span className="zp-card__attach">
                          <Icon name="paperclip" size={11} /> {z.zalaczniki.length}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {cards.length > TIP_CARDS && (
                <div className="zp-tip__more">
                  {t.zadDashMore.replace('{count}', String(cards.length - TIP_CARDS))}
                </div>
              )}
            </div>

            <div className="zp-tip__hint">{t.zadDashOpenWhat.replace('{what}', tile.label)}</div>
          </div>
        );
      })()}
    </section>
  );
};

export default ZadaniaPulpit;
