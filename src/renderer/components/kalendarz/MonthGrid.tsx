import React, { memo } from 'react';
import { Spotkanie, SpotkanieLokalizacja, SpotkanieTyp } from '../../../shared/types';
import { personLabel } from '../../../shared/app-users';
import { translations, Language } from '../../translations';
import Icon from '../Icon';
import {
  buildMonthGrid,
  formatStamp,
  formatTimeRange,
  hasUnreadTerminChange,
  isTerminWstepny,
  lokalizacjaLabel,
  monthLabel,
  normalizeHexColor,
  toDayKey,
  typOf,
  DEFAULT_TYP_COLOR,
} from '../../../shared/calendar';
import {
  type HoverStore,
  useHover,
  type CountTipState,
  meetingsCount,
  type TipState,
  materialyStatusLabel,
} from './kalendarzShared';

/**
 * One formatter per locale and pattern, for the month grid: its 42 cells and
 * their chips are labelled on every render of the grid, and building a fresh
 * `Intl.DateTimeFormat` behind every `toLocale…String` call was most of that
 * cost. Same output as `formatDayLabel` / `formatTime` in shared/calendar.
 */
const gridFormats = new Map<string, Intl.DateTimeFormat>();
function gridFormat(locale: string, kind: 'day' | 'time'): Intl.DateTimeFormat {
  const key = `${locale}|${kind}`;
  let format = gridFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(
      locale,
      kind === 'day' ? { weekday: 'long', day: 'numeric', month: 'long' } : { hour: '2-digit', minute: '2-digit' },
    );
    gridFormats.set(key, format);
  }
  return format;
}
const gridDayLabel = (dayKey: string, locale: string): string => {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  return gridFormat(locale, 'day').format(new Date(y, m - 1, d));
};
const gridTime = (iso: string, locale: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return gridFormat(locale, 'time').format(d);
};
const gridTimeRange = (spotkanie: Spotkanie, locale: string): string => {
  const start = gridTime(spotkanie.startsAt, locale);
  return spotkanie.endsAt ? `${start} – ${gridTime(spotkanie.endsAt, locale)}` : start;
};

/** How many meetings a day cell shows before collapsing into "+N". */
const CHIPS_PER_CELL = 3;

/**
 * The hover card for a chip in the grid. A native `title` waits about a second
 * before it appears, and a cell is exactly where the user is scanning quickly —
 * so this is drawn here, positioned in the viewport, and therefore never clipped
 * by the grid's rounded overflow. Subscribed to its own store: the pointer
 * crossing chips re-renders this card, not the calendar.
 */
export const MeetingHoverCard: React.FC<{
  store: HoverStore<TipState>;
  typy: SpotkanieTyp[];
  lokalizacje: SpotkanieLokalizacja[];
  language: Language;
  locale: string;
}> = ({ store, typy, lokalizacje, language, locale }) => {
  const t = translations[language];
  const tip = useHover(store);
  if (!tip) return null;
  return (
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
  );
};

/** The month/year count card under a filter chip — its own subscriber, like the hover card. */
export const CountHoverCard: React.FC<{
  store: HoverStore<CountTipState>;
  monthKey: string;
  language: Language;
  locale: string;
}> = ({ store, monthKey, language, locale }) => {
  const t = translations[language];
  const countTip = useHover(store);
  if (!countTip) return null;
  const year = monthKey.split('-')[0];
  return (
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
  );
};

/**
 * The month as a grid of days, each with its first few meetings. Memoized: it
 * is the heaviest part of the calendar (42 cells, their chips and labels), and
 * it only has to change with the month, the filter's result or the selected
 * day — not with a hover card, a form being typed in, or a meeting card's
 * buttons. Its handlers come from the view with stable identities.
 */
export const MonthGrid = memo(function MonthGrid({
  cells,
  weekdays,
  byDay,
  selectedDay,
  typy,
  hoverCard,
  language,
  locale,
  onSelectDay,
  onOpenForm,
  onShowTip,
  onHideTip,
}: {
  cells: ReturnType<typeof buildMonthGrid>;
  weekdays: string[];
  byDay: Map<string, Spotkanie[]>;
  selectedDay: string;
  typy: SpotkanieTyp[];
  hoverCard: boolean;
  language: Language;
  locale: string;
  onSelectDay: (dayKey: string, highlight?: number | null) => void;
  onOpenForm: (day: string, editing?: Spotkanie | null) => void;
  onShowTip: (event: React.MouseEvent<HTMLElement>, spotkanie: Spotkanie) => void;
  onHideTip: () => void;
}) {
  const t = translations[language];
  return (
    <div className="kal-grid">
      {/* Head and body scroll together in one container so their seven
          columns stay aligned when a scrollbar appears, and the head is
          sticky so it stays readable while they do. */}
      <div className="kal-grid__scroll" onScroll={onHideTip}>
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
            const dayLabel = gridDayLabel(cell.dayKey, locale);
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
                aria-label={dayLabel}
                data-tip={`${dayLabel} — ${t.kalDayDoubleClick}`}
                onClick={() => onSelectDay(cell.dayKey)}
                // One click reads the day, two write to it — the same
                // convention as every other calendar. The hover "+" stays,
                // because a double-click is a gesture nobody can see.
                onDoubleClick={() => {
                  onSelectDay(cell.dayKey);
                  onOpenForm(cell.dayKey);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectDay(cell.dayKey);
                  }
                }}
              >
                <div className="kal-cell__head">
                  <span className="kal-cell__num">{cell.dayOfMonth}</span>
                  <button
                    type="button"
                    className="kal-cell__add"
                    data-tip={t.kalDayAdd}
                    aria-label={t.kalDayAdd}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDay(cell.dayKey);
                      onOpenForm(cell.dayKey);
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
                        /* With the card on, the hint must be empty —
                         not absent: an empty hint on the chip stops the
                         cell's own hint (the day) from showing over the
                         card. With the card off, the hint is the
                         fallback, so the full name is still reachable. */
                      data-tip={
                        hoverCard
                          ? ''
                          : `${gridTimeRange(s, locale)} — ${s.nazwa}\n${t.kalChipDoubleClick}`
                      }
                      onMouseEnter={(e) => onShowTip(e, s)}
                      onMouseLeave={onHideTip}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDay(cell.dayKey, s.id);
                        }}
                        // Stopped from bubbling, or the cell underneath
                        // would open a *new* meeting over this edit.
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          onSelectDay(cell.dayKey, s.id);
                          onOpenForm(toDayKey(s.startsAt), s);
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
                          {gridTime(s.startsAt, locale)}
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
                        onSelectDay(cell.dayKey);
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
  );
});
