import React, { useEffect, useMemo, useState } from 'react';
import { Zadanie } from '../../shared/types';
import { ZadaniaFilterSeed, dayKey, dueBucket, formatDayKey } from '../../shared/zadania';
import { translations, Language } from '../translations';
import Icon from './Icon';
import TasksIllustration from './TasksIllustration';

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
    const all = (zadania ?? []).filter((z) => (z.przypisanyEmail ?? '').trim().toLowerCase() === me);
    const open = all.filter((z) => z.status !== 'done');
    const count = { overdue: 0, today: 0, upcoming: 0 };
    let next: Zadanie | null = null;
    for (const z of open) {
      const bucket = dueBucket(z.termin, today);
      if (!bucket) continue;
      count[bucket] += 1;
      // The nearest deadline that has not passed — what the banner says is next.
      if (bucket !== 'overdue' && (!next || (z.termin ?? '') < (next.termin ?? ''))) next = z;
    }
    return {
      ...count,
      total: all.length,
      open: open.length,
      undated: open.filter((z) => !z.termin).length,
      next,
    };
  }, [zadania, userEmail]);

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
      seed: { who: 'mine', overdue: true },
      count: stats.overdue,
      tone: 'overdue',
      icon: 'alert-circle',
      label: t.zadDashOverdue,
      hint: t.zadDashOverdueHint,
    },
    {
      key: 'today',
      seed: { who: 'mine', overdue: false },
      count: stats.today,
      tone: 'today',
      icon: 'clock',
      label: t.zadDashToday,
      hint: t.zadDashTodayHint,
    },
    {
      key: 'upcoming',
      seed: { who: 'mine', overdue: false },
      count: stats.upcoming,
      tone: 'upcoming',
      icon: 'calendar',
      label: t.zadDashUpcoming,
      hint: t.zadDashUpcomingHint,
    },
    {
      key: 'all',
      seed: { who: 'mine', overdue: false },
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
            onClick={() => onOpen({ who: 'mine', overdue: false })}
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
            onClick={() => onOpen(tile.seed)}
            disabled={tile.count === 0}
            title={tile.count === 0 ? tile.hint : t.zadDashOpenWhat.replace('{what}', tile.label)}
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
    </section>
  );
};

export default ZadaniaPulpit;
